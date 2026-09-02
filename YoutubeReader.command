#!/bin/bash

PORT="${PORT:-3000}"

pause_and_close() {
  echo
  echo "창을 닫으려면 아무 키나 누르세요."
  read -n 1 -s
  echo
}

trap '' INT

SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
PROJECT_DIR="$(cd "$(dirname "$SELF")" 2>/dev/null && pwd)"
if [ ! -f "$PROJECT_DIR/package.json" ] && [ -f "/Users/picxenk/Sandbox/YoutubeReader/package.json" ]; then
  PROJECT_DIR="/Users/picxenk/Sandbox/YoutubeReader"
fi
if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "[오류] YoutubeReader 프로젝트 폴더를 찾을 수 없습니다."
  pause_and_close
  exit 1
fi
cd "$PROJECT_DIR" || exit 1

echo "YoutubeReader"
echo "폴더: $PROJECT_DIR"
echo

if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
  echo "이미 실행 중입니다 (http://localhost:$PORT). 브라우저를 엽니다."
  open "http://localhost:$PORT"
  pause_and_close
  exit 0
fi

if ! command -v node > /dev/null 2>&1; then
  echo "[오류] Node.js를 찾을 수 없습니다."
  echo "설치: brew install node  (또는 https://nodejs.org)"
  pause_and_close
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "의존성을 설치합니다 (최초 실행 1회)..."
  if ! npm install; then
    echo "[오류] 의존성 설치에 실패했습니다."
    pause_and_close
    exit 1
  fi
  echo
fi

echo "서버를 시작합니다: http://localhost:$PORT"
echo "중지하려면 Ctrl+C 를 누르거나 이 창을 닫으면 됩니다."
echo
( sleep 1.5; open "http://localhost:$PORT" ) &

npm start
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  echo "서버가 중지되었습니다."
else
  echo "서버가 종료되었습니다 (exit $STATUS). 오류가 있었다면 위 메시지를 확인해 주세요."
fi
pause_and_close
