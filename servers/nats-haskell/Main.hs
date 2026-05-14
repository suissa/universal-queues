{-# LANGUAGE OverloadedStrings #-}
-- NATS Core reference server in Haskell.
module Main where

import Control.Concurrent
import Control.Concurrent.MVar
import Control.Monad
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C
import Data.Char (toUpper)
import Data.List (isInfixOf)
import qualified Data.Map.Strict as M
import Network.Socket
import Network.Socket.ByteString (recv, sendAll)
import System.Environment (getArgs)
import System.IO (hPutStrLn, stderr)

maxPayload :: Int
maxPayload = 1024 * 1024

data Sub = Sub { subject :: String, queue :: Maybe String, sid :: String, delivered :: Int, maxMsgs :: Maybe Int } deriving Show
data Client = Client { cid :: Int, sock :: Socket, subs :: [Sub], verbose :: Bool, echo :: Bool, headers :: Bool }
data Broker = Broker { nextId :: Int, clients :: M.Map Int Client, cursors :: M.Map String Int }

type BrokerRef = MVar Broker

main :: IO ()
main = do
  args <- getArgs
  let port = maybe 4222 read (safeHead args)
  ref <- newMVar (Broker 1 M.empty M.empty)
  addr:_ <- getAddrInfo (Just defaultHints {addrFlags=[AI_PASSIVE], addrSocketType=Stream}) Nothing (Just (show port))
  listener <- socket (addrFamily addr) Stream defaultProtocol
  setSocketOption listener ReuseAddr 1
  bind listener (addrAddress addr)
  listen listener 256
  hPutStrLn stderr $ "universal-queues Haskell NATS core server listening on 0.0.0.0:" ++ show port
  forever $ do
    (s, _) <- accept listener
    client <- modifyMVar ref $ \b -> let i=nextId b; c=Client i s [] False True False in pure (b{nextId=i+1, clients=M.insert i c (clients b)}, c)
    _ <- forkIO (handleClient ref client port)
    pure ()

handleClient :: BrokerRef -> Client -> Int -> IO ()
handleClient ref c port = do
  sendLine (sock c) $ C.pack $ "INFO {\"server_id\":\"UHSNATS0000000000000001\",\"server_name\":\"universal-queues-haskell\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":" ++ show port ++ ",\"headers\":true,\"max_payload\":" ++ show maxPayload ++ "}"
  loop B.empty
  where
    loop pending = do
      chunk <- recv (sock c) 8192
      if B.null chunk then remove else drain (pending <> chunk)
    drain bytes = case C.elemIndex '\n' bytes of
      Nothing -> loop bytes
      Just n -> do
        let (line0, rest0) = B.splitAt n bytes
            line = C.unpack $ C.dropWhileEnd (=='\r') line0
            rest = B.drop 1 rest0
        continue <- process ref (cid c) line rest
        if continue then loop B.empty else remove
    remove = do
      modifyMVar_ ref $ \b -> pure b{clients=M.delete (cid c) (clients b)}
      close (sock c)

process :: BrokerRef -> Int -> String -> B.ByteString -> IO Bool
process ref id line pending = case words line of
  [] -> pure True
  (op0:xs) -> case map toUpper op0 of
    "PING" -> writeRaw ref id "PONG\r\n" >> pure True
    "PONG" -> writeOk ref id >> pure True
    "CONNECT" -> do
      let v = "\"verbose\":true" `isInfixOf` line; e = not ("\"echo\":false" `isInfixOf` line); h = "\"headers\":true" `isInfixOf` line
      modifyMVar_ ref $ \b -> pure b{clients=M.adjust (\c -> c{verbose=v, echo=e, headers=h}) id (clients b)}
      writeOk ref id >> pure True
    "SUB" | length xs == 2 || length xs == 3 -> do
      let (subj,q,s) = if length xs == 3 then (xs!!0, Just (xs!!1), xs!!2) else (xs!!0, Nothing, xs!!1)
      modifyMVar_ ref $ \b -> pure b{clients=M.adjust (\c -> c{subs=subs c ++ [Sub subj q s 0 Nothing]}) id (clients b)}
      writeOk ref id >> pure True
    "UNSUB" | length xs == 1 || length xs == 2 -> do
      let s = head xs; m = if length xs == 2 then Just (read (xs!!1)) else Just 0
      modifyMVar_ ref $ \b -> pure b{clients=M.adjust (\c -> c{subs=filter ((/= Just 0) . maxMsgs) [if sid sub == s then sub{maxMsgs=m} else sub | sub <- subs c]}) id (clients b)}
      writeOk ref id >> pure True
    "PUB" | length xs == 2 || length xs == 3 -> do
      let subj = head xs; reply = if length xs == 3 then Just (xs!!1) else Nothing; size = read (last xs)
      if size > maxPayload || B.length pending < size + 2 then writeErr ref id "Invalid Protocol" >> pure False else do
        publish ref id subj reply (B.take size pending) Nothing
        writeOk ref id >> pure True
    "HPUB" | length xs == 3 || length xs == 4 -> do
      let subj=head xs; reply=if length xs==4 then Just (xs!!1) else Nothing; h=read (xs!!(length xs-2)); total=read (last xs)
      if total > maxPayload || h > total || B.length pending < total + 2 then writeErr ref id "Invalid Protocol" >> pure False else do
        publish ref id subj reply (B.take total pending) (Just h)
        writeOk ref id >> pure True
    _ -> writeErr ref id "Invalid Protocol" >> pure False

publish :: BrokerRef -> Int -> String -> Maybe String -> B.ByteString -> Maybe Int -> IO ()
publish ref pub subj reply payload mh = modifyMVar_ ref $ \b -> do
  let pubEcho = maybe True echo (M.lookup pub (clients b))
      targets = [(i,idx) | (i,c) <- M.toList (clients b), pubEcho || i /= pub, (idx,s) <- zip [0..] (subs c), matches (subject s) subj]
      direct = [(i,idx) | (i,idx) <- targets, maybe True (const False) (queue ((subs (clients b M.! i))!!idx))]
      queued = M.fromListWith (++) [(subject s ++ "\0" ++ q, [(i,idx)]) | (i,idx) <- targets, let s=(subs (clients b M.! i))!!idx, Just q <- [queue s]]
  mapM_ (deliver b subj reply payload mh) direct
  let choose (cs, curs) key ms = let cur=M.findWithDefault 0 key curs; t=ms !! (cur `mod` length ms) in (t:cs, M.insert key (cur+1) curs)
      (chosen, curs') = M.foldlWithKey' choose ([], cursors b) queued
  mapM_ (deliver b subj reply payload mh) chosen
  pure b{cursors=curs'}

deliver :: Broker -> String -> Maybe String -> B.ByteString -> Maybe Int -> (Int,Int) -> IO ()
deliver b subj reply payload mh (i,idx) = case M.lookup i (clients b) of
  Nothing -> pure ()
  Just c | idx >= length (subs c) -> pure ()
  Just c -> do
    let s = subs c !! idx; body = maybe payload (\h -> if headers c then payload else B.drop h payload) mh
        prefix = case (mh, headers c, reply) of
          (Just h, True, Just r) -> "HMSG " ++ subj ++ " " ++ sid s ++ " " ++ r ++ " " ++ show h ++ " " ++ show (B.length payload)
          (Just h, True, Nothing) -> "HMSG " ++ subj ++ " " ++ sid s ++ " " ++ show h ++ " " ++ show (B.length payload)
          (_, _, Just r) -> "MSG " ++ subj ++ " " ++ sid s ++ " " ++ r ++ " " ++ show (B.length body)
          _ -> "MSG " ++ subj ++ " " ++ sid s ++ " " ++ show (B.length body)
    sendLine (sock c) (C.pack prefix)
    sendAll (sock c) body >> sendAll (sock c) "\r\n"

matches :: String -> String -> Bool
matches p s = go 0 (tokens p) (tokens s) where tokens = splitOn '.'; go _ [] ys = null ys; go n (">":_) ys = n == 0 || not (null ys); go _ _ [] = False; go n (x:xs) (y:ys) = (x == "*" || x == y) && go (n+1) xs ys
splitOn :: Char -> String -> [String]
splitOn _ [] = [""]; splitOn d xs = case break (==d) xs of (a,[]) -> [a]; (a,_:b) -> a:splitOn d b
safeHead :: [a] -> Maybe a
safeHead [] = Nothing; safeHead (x:_) = Just x
sendLine :: Socket -> B.ByteString -> IO (); sendLine s b = sendAll s b >> sendAll s "\r\n"
writeRaw :: BrokerRef -> Int -> B.ByteString -> IO (); writeRaw ref id bytes = withMVar ref $ \b -> maybe (pure ()) (\c -> sendAll (sock c) bytes) (M.lookup id (clients b))
writeOk :: BrokerRef -> Int -> IO (); writeOk ref id = withMVar ref $ \b -> case M.lookup id (clients b) of Just c | verbose c -> sendAll (sock c) "+OK\r\n"; _ -> pure ()
writeErr :: BrokerRef -> Int -> String -> IO (); writeErr ref id e = writeRaw ref id (C.pack ("-ERR '" ++ e ++ "'\r\n"))
