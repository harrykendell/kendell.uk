#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist
zip -q -X -j "dist/kendell-desktop-clipboard-0.1.0-unsigned.xpi" \
    manifest.json page.js content.js
printf 'Built %s\n' "dist/kendell-desktop-clipboard-0.1.0-unsigned.xpi"
