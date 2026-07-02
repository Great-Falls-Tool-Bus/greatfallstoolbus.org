#!/usr/bin/env bash
set -euo pipefail
# Option B: Latin + common Nerd Font glyph blocks + all OpenType features.
# Codepoint ranges:
#   U+0000-00FF   Latin (basic + supplement)
#   U+2010-205E   General Punctuation (em-dash, ellipsis, primes)
#   U+2190-21FF   Arrows
#   U+2300-23FF   Misc Technical (terminal-style symbols)
#   U+25A0-25FF   Geometric Shapes
#   U+2580-259F   Block Elements (TUI box drawing)
#   U+2600-26FF   Misc Symbols
#   U+E000-E00A   Pomicons
#   U+E0A0-E0A2   Powerline (left)
#   U+E0B0-E0B3   Powerline (right)
#   U+EE00-EE0B   Devicons (file-type)
#   U+F000-F2FF   Font Awesome subset (Octicons-ish)
RANGES='U+0000-00FF,U+2010-205E,U+2190-21FF,U+2300-23FF,U+25A0-25FF,U+2580-259F,U+2600-26FF,U+E000-E00A,U+E0A0-E0A2,U+E0B0-E0B3,U+EE00-EE0B,U+F000-F2FF'

for w in Regular Bold; do
  pyftsubset "FiraCodeNerdFontMono-${w}.ttf" \
    --output-file="FiraCodeNerdFontMono-${w}-subset.woff2" \
    --flavor=woff2 \
    --unicodes="$RANGES" \
    --layout-features='*' \
    --notdef-outline \
    --recommended-glyphs \
    --name-IDs='*' \
    --no-hinting \
    --desubroutinize
  size=$(wc -c <"FiraCodeNerdFontMono-${w}-subset.woff2")
  echo "  ${w} subset: $((size/1024)) KB"
done
