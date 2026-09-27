#!/bin/sh
# 生成《始得西山宴遊記》預告片：trailer/xishan_trailer.mp4（1920x1080，30fps，約 102 秒）
# 需要：python3、pip install numpy pillow scipy imageio-ffmpeg
set -e
cd "$(dirname "$0")"
mkdir -p fonts
B=https://raw.githubusercontent.com/google/fonts/main/ofl
[ -f fonts/WenKai.ttf ] || curl -sSL -o fonts/WenKai.ttf $B/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf
[ -f fonts/WenKaiBold.ttf ] || curl -sSL -o fonts/WenKaiBold.ttf $B/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf
[ -f fonts/NotoSerifTC.ttf ] || curl -sSL -o fonts/NotoSerifTC.ttf "$B/notoseriftc/NotoSerifTC%5Bwght%5D.ttf"
FFMPEG=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
python3 music.py music.wav
python3 video.py | "$FFMPEG" -y -loglevel error -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - -i music.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -tune film \
  -af loudnorm=I=-14:TP=-1.0:LRA=11 -c:a aac -b:a 256k -ar 48000 -shortest master.mp4
# 顆粒質感令檔案很大：兩遍編碼壓到約 85MB（低於 GitHub 單檔 100MB 上限）
"$FFMPEG" -y -loglevel error -i master.mp4 -c:v libx264 -preset slow -b:v 6500k -pass 1 -passlogfile x264pass -an -f null /dev/null
"$FFMPEG" -y -loglevel error -i master.mp4 -c:v libx264 -preset slow -b:v 6500k -maxrate 12M -bufsize 16M -pass 2 -passlogfile x264pass \
  -pix_fmt yuv420p -profile:v high -c:a copy -movflags +faststart xishan_trailer.mp4
rm -f music.wav master.mp4 x264pass*
echo "完成：$(pwd)/xishan_trailer.mp4"
