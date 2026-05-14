--- NATS Core reference server in Curry.
---
--- Curry implementations differ by distribution (PAKCS/KiCS2), especially for
--- networking modules. This source keeps the protocol engine pure and uses the
--- conventional Socket-style API names used by Curry distributions.

module Main where

import Char(toUpper)
import List(isPrefixOf, tails)
import Read(readNat)
import System(getArgs)
import Socket

maxPayload :: Int
maxPayload = 1024 * 1024

data Sub = Sub String String String Int Int -- subject queue sid delivered maxMsgs; maxMsgs -1 means unlimited
data Client = Client Int Handle [Sub] Bool Bool Bool -- id handle subs verbose echo headers
data Broker = Broker Int [Client] [(String, Int)]

main :: IO ()
main = do
  args <- getArgs
  let port = case args of [] -> 4222; p:_ -> readInt p
  sock <- listenOn port
  putStrLn ("universal-queues Curry NATS core server listening on 0.0.0.0:" ++ show port)
  acceptLoop port sock (Broker 1 [] [])

acceptLoop :: Int -> Socket -> Broker -> IO ()
acceptLoop port sock broker = do
  (h,_,_) <- accept sock
  let Broker next clients cursors = broker
      client = Client next h [] False True False
  hPutStr h (infoLine port)
  spawn (clientLoop (Broker (next+1) (client:clients) cursors) client)
  acceptLoop port sock (Broker (next+1) (client:clients) cursors)

clientLoop :: Broker -> Client -> IO ()
clientLoop broker client@(Client cid h _ _ _ _) = do
  line <- hGetLine h
  broker' <- processLine broker client (stripCR line)
  clientLoop broker' client

processLine :: Broker -> Client -> String -> IO Broker
processLine broker client@(Client cid h subs verbose echo headers) line =
  case words line of
    [] -> return broker
    (op0:xs) -> case map toUpper op0 of
      "PING" -> hPutStr h "PONG\r\n" >> return broker
      "PONG" -> ok client >> return broker
      "CONNECT" -> let v = contains "\"verbose\":true" line
                         e = not (contains "\"echo\":false" line)
                         hd = contains "\"headers\":true" line
                     in ok (Client cid h subs v e hd) >> return (replaceClient broker (Client cid h subs v e hd))
      "SUB" -> case xs of
        [subject,sid] -> let c = Client cid h (subs ++ [Sub subject "" sid 0 (-1)]) verbose echo headers in ok c >> return (replaceClient broker c)
        [subject,queue,sid] -> let c = Client cid h (subs ++ [Sub subject queue sid 0 (-1)]) verbose echo headers in ok c >> return (replaceClient broker c)
        _ -> err h >> return broker
      "UNSUB" -> case xs of
        [sid] -> let c = Client cid h (filterSub sid Nothing subs) verbose echo headers in ok c >> return (replaceClient broker c)
        [sid,maxMsgs] -> let c = Client cid h (filterSub sid (Just (readInt maxMsgs)) subs) verbose echo headers in ok c >> return (replaceClient broker c)
        _ -> err h >> return broker
      "PUB" -> case xs of
        [subject,sizeText] -> publishFromHandle broker client subject "" (readInt sizeText)
        [subject,reply,sizeText] -> publishFromHandle broker client subject reply (readInt sizeText)
        _ -> err h >> return broker
      _ -> err h >> return broker

publishFromHandle :: Broker -> Client -> String -> String -> Int -> IO Broker
publishFromHandle broker client@(Client _ h _ _ _ _) subject reply size = do
  payload <- hGetN h size
  _ <- hGetN h 2
  broker' <- publish broker client subject reply payload
  ok client
  return broker'

publish :: Broker -> Client -> String -> String -> String -> IO Broker
publish broker@(Broker next clients cursors) publisher@(Client pubId _ _ _ pubEcho _) subject reply payload = do
  mapIO_ deliver matches
  return broker
 where
  matches = [(c,s) | c@(Client cid _ subs _ _ _) <- clients, pubEcho || cid /= pubId, s@(Sub pat _ _ _ _) <- subs, subjectMatches pat subject]
  deliver (Client _ h _ _ _ _, Sub _ _ sid _ _) =
    hPutStr h ("MSG " ++ subject ++ " " ++ sid ++ replyPart ++ " " ++ show (length payload) ++ "\r\n" ++ payload ++ "\r\n")
  replyPart = if reply == "" then "" else " " ++ reply

subjectMatches :: String -> String -> Bool
subjectMatches pat subj = go 0 (splitDots pat) (splitDots subj)
 where
  go _ [] ys = null ys
  go n (">":_) ys = n == 0 || not (null ys)
  go _ _ [] = False
  go n (x:xs) (y:ys) = (x == "*" || x == y) && go (n+1) xs ys

splitDots :: String -> [String]
splitDots [] = [""]
splitDots xs = case break (=='.') xs of
  (a,[]) -> [a]
  (a,_:b) -> a : splitDots b

replaceClient :: Broker -> Client -> Broker
replaceClient (Broker n clients cursors) c@(Client cid _ _ _ _ _) = Broker n (c : filter (\(Client id _ _ _ _ _) -> id /= cid) clients) cursors

filterSub :: String -> Maybe Int -> [Sub] -> [Sub]
filterSub sid Nothing subs = filter (\(Sub _ _ s _ _) -> s /= sid) subs
filterSub sid (Just m) subs = map (\sub@(Sub a b s d _) -> if s == sid then Sub a b s d m else sub) subs

infoLine :: Int -> String
infoLine port = "INFO {\"server_id\":\"UCURRYNATS00000000001\",\"server_name\":\"universal-queues-curry\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":" ++ show port ++ ",\"headers\":true,\"max_payload\":" ++ show maxPayload ++ "}\r\n"

stripCR :: String -> String
stripCR xs = if not (null xs) && last xs == '\r' then init xs else xs
contains :: String -> String -> Bool
contains needle haystack = any (isPrefixOf needle) (tails haystack)
readInt :: String -> Int
readInt s = case readNat s of [(n, _)] -> n; _ -> 0
ok :: Client -> IO ()
ok (Client _ h _ verbose _ _) = if verbose then hPutStr h "+OK\r\n" else return ()
err :: Handle -> IO ()
err h = hPutStr h "-ERR 'Invalid Protocol'\r\n"
mapIO_ :: (a -> IO b) -> [a] -> IO ()
mapIO_ _ [] = return ()
mapIO_ f (x:xs) = f x >> mapIO_ f xs
