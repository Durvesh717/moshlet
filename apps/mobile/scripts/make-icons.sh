#!/usr/bin/env bash
# Renders the app icons and splash image from assets/brand/*.svg.
# Needs rsvg-convert (librsvg) and ImageMagick 7. Run from apps/mobile: scripts/make-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

brand=assets/brand
out=assets/images
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

svg() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# Android adaptive icon: 108-unit layers, the launcher masks and shows the middle 72.
svg $brand/mark.svg 1024 $out/android-icon-foreground.png
svg $brand/background.svg 1024 $out/android-icon-background.png
sed 's/#[0-9A-Fa-f]\{6\}/#FFFFFF/g' $brand/mark.svg > "$tmp/mono.svg"
svg "$tmp/mono.svg" 1024 $out/android-icon-monochrome.png

# Square icon (iOS and the store): both layers, cropped to the middle 90 units so the mark has room.
size=1024
full=$((size * 108 / 90))
svg $brand/background.svg $full "$tmp/bg.png"
svg $brand/mark.svg $full "$tmp/mark.png"
magick "$tmp/bg.png" "$tmp/mark.png" -composite -gravity center -crop ${size}x${size}+0+0 +repage \
  -background none -alpha remove -alpha off $out/icon.png

# Splash: the icon as a rounded tile, like the logo inside the app.
magick $out/icon.png -resize 512x512 -alpha set \
  \( -size 512x512 xc:none -fill white -draw "roundrectangle 0,0 511,511 115,115" \) \
  -compose DstIn -composite $out/splash-icon.png
