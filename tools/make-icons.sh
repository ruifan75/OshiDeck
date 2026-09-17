#!/bin/sh
# Rebuilds icons/*.png from the two SVGs beside them.
#
# Two drawings, not one. The fan is the panel's own shape — three cards
# overlapping, each with its 推し色 stripe — and it is what the extension
# looks like. At 16 and 32 pixels it is a smear: the toolbar is where the icon
# has to be *found*, so there it is a single card, same ground, same stripe,
# same palette. Chrome takes a different file per size and this is what that
# is for.
set -e
cd "$(dirname "$0")/.."
for size in 16 32; do
  magick -background none icons/card.svg -resize ${size}x${size} -depth 8 -strip icons/${size}.png
done
for size in 48 128; do
  magick -background none icons/fan.svg -resize ${size}x${size} -depth 8 -strip icons/${size}.png
done
magick identify icons/*.png
