#!/bin/bash
# 정답 후보 채널 탐색: 자막 의무·관행이 있는 채널의 최근 영상에
# "사람이 올린 자막"(automatic captions 아님)이 실제로 붙어있는지 확인한다.
cd "$(dirname "$0")" || exit 1
YTDLP="./.venv/bin/yt-dlp"
ARGS="youtube:player_client=android;player_skip=webpage,configs;innertube_host=youtubei.googleapis.com;lang=ko"
N=3

check_channel() {
  local name="$1" url="$2"
  local ids hit=0 tot=0 langs=""
  ids=$("$YTDLP" --flat-playlist --playlist-end $N --extractor-args "$ARGS" --print "%(id)s" "$url" 2>/dev/null)
  if [ -z "$ids" ]; then
    printf "%-24s 채널 접근 실패\n" "$name"
    return
  fi
  while IFS= read -r id; do
    [ -z "$id" ] && continue
    tot=$((tot + 1))
    # "Available subtitles"(사람이 올린 것) 아래 줄들의 언어 코드를 모은다.
    # 자막이 있어도 영어 번역본이면 한국어 정답으로 못 쓰므로 언어까지 확인해야 한다.
    local out
    out=$("$YTDLP" --list-subs --extractor-args "$ARGS" "https://www.youtube.com/watch?v=$id" 2>/dev/null \
          | sed -n '/Available subtitles/,$p' | tail -n +3 | awk '{print $1}' | tr '\n' ' ')
    if [ -n "$out" ]; then
      hit=$((hit + 1))
      langs="$langs $out"
    fi
  done <<< "$ids"
  printf "%-24s %d/%d편  %s\n" "$name" "$hit" "$tot" "$(echo $langs | tr ' ' '\n' | sort -u | tr '\n' ' ')"
}

while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  check_channel "$name" "$url"
done << 'LIST'
HYBE LABELS|https://www.youtube.com/@HYBELABELS/videos
SMTOWN|https://www.youtube.com/@SMTOWN/videos
JYP Entertainment|https://www.youtube.com/@JYPEntertainment/videos
tvN|https://www.youtube.com/@tvN/videos
스브스캐치|https://www.youtube.com/@SBSCatch/videos
삼성전자|https://www.youtube.com/@SamsungKorea/videos
서울시|https://www.youtube.com/@seoullive/videos
LIST
