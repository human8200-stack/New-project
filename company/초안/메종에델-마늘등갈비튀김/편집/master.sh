#!/bin/bash
# usage: master.sh raw.mp4 out.mp4 gain_dB
# v7 (11/22): gentler compressor (ratio 2.5) and ONE soft oversampled limiter (was ratio 5 + two hard limiters)
set -e
T=$(mktemp -d)
ffmpeg -v error -y -i "$1" -vn -af "acompressor=threshold=0.1:ratio=2.5:attack=8:release=120:makeup=1" -ar 48000 $T/c.wav
ffmpeg -v error -y -i $T/c.wav -af "volume=${3}dB,aresample=192000,alimiter=limit=0.70:attack=3:release=80:level=false,aresample=48000" -ar 48000 $T/l.wav
ffmpeg -v error -y -i "$1" -i $T/l.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$2"
rm -rf "${T:?}"
ffmpeg -hide_banner -nostats -i "$2" -af loudnorm=print_format=summary -f null - 2>&1 | grep -E "Input Integrated|Input True Peak" | sed 's/.*: *//' | tr '\n' ' '; echo
