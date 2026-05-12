#!/bin/bash
set -euo pipefail

VIDEO_DIR="public/videos"
POSTER_WIDTH=640

echo "🔍 Searching for .webm files in $VIDEO_DIR..."

find "$VIDEO_DIR" -type f -name '*.webm' -print0 | while IFS= read -r -d '' video; do
    dir=$(dirname "$video")
    base=$(basename "$video" .webm)
    poster_webp="$dir/${base}_poster.webp"

    # Проверка, что постер свежее видео
    if [ -f "$poster_webp" ] && [ "$poster_webp" -nt "$video" ]; then
        echo "⏩ Skipping $base (up-to-date)"
        continue
    fi

    echo "🎬 Processing $base.webm → $poster_webp"

    ffmpeg -y -loglevel error \
        -ss 00:00:00.0 -i "$video" \
        -vframes 1 \
        -vf "scale=${POSTER_WIDTH}:-1" \
        -c:v libwebp -quality 75 -compression_level 6 \
        "$poster_webp"

    if [ $? -eq 0 ]; then
        echo "  ✅ $poster_webp"
    else
        echo "  ❌ Failed for $video"
    fi
done

echo "✨ All posters generated."