#!/usr/bin/env bash
set +e

echo "HEALING docker"
echo "HEALING docker listing docker containers"
containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null)
target=${TARGET_CONTAINER:-$(echo "$containers" | head -n 1)}
if [ -n "$target" ]; then
  echo "HEALING docker find ${target}"
  docker start "$target" >/dev/null 2>&1
  echo "HEALING docker start ${target}"
fi
echo "HEALED docker"
