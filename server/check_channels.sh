#!/bin/bash
# 정답 후보 채널 탐색: 자막 의무·관행이 있는 채널의 최근 영상에
# "사람이 올린 자막"(automatic captions 아님)이 실제로 붙어있는지 확인한다.
cd "$(dirname "$0")" || exit 1
YTDLP="./.venv/bin/yt-dlp"
ARGS="youtube:player_client=android;player_skip=webpage,configs;innertube_host=youtubei.googleapis.com;lang=ko"
N=3

check_channel() {
  local name="$1" url="$2"
  local ids hit=0 tot=0
  ids=$("$YTDLP" --flat-playlist --playlist-end $N --extractor-args "$ARGS" --print "%(id)s" "$url" 2>/dev/null)
  if [ -z "$ids" ]; then
    printf "%-22s 채널 접근 실패\n" "$name"
    return
  fi
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    tot=$((tot + 1))
    if "$YTDLP" --list-subs --extractor-args "$ARGS" "https://www.youtube.com/watch?v=$id" 2>/dev/null | grep -q "Available subtitles"; then
      hit=$((hit + 1))
    fi
  done <<< "$ids"
  printf "%-22s %d/%d편에 사람 자막\n" "$name" "$hit" "$tot"
}

while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  check_channel "$name" "$url"
done << 'LIST'
국회방송|https://www.youtube.com/@natv_korea/videos
K-MOOC|https://www.youtube.com/@kmooc/videos
연세대|https://www.youtube.com/@yonseiuniv/videos
고려대|https://www.youtube.com/@KoreaUniv/videos
POSTECH|https://www.youtube.com/@postechofficial/videos
마이크임팩트|https://www.youtube.com/@micimpact/videos
MIT OpenCourseWare|https://www.youtube.com/@mitocw/videos
LIST
