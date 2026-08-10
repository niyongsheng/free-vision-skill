---
name: free-vision-skill
description: Understand images: text recognition (OCR), table structure extraction, content description of textless images (macOS Vision Framework, fully local). Use when a vision-less model needs to read or describe an image.
license: MIT
metadata:
  author: niyongsheng
  version: "1.0.0"
  category: utilities
  allowed-tools:
    - Bash
---

# Vision Skill

Understand images using macOS's built-in Vision framework. Fully local, no network required, supports Chinese and English.

## Script Path

- The script is at `scripts/ocr.swift` in this skill's directory (same level as SKILL.md)
- `<skill-dir>` is this skill's actual installation directory; run `ls` to confirm the path if unsure

## Choosing a Mode

Pick a mode based on the request:

| Scenario | Mode |
|---|---|
| Need the text content in the image | Normal mode |
| Table / list / report / config-page screenshot | `--layout` |
| Textless image, photo, or need to understand the scene | `--describe` |
| Unsure about the image | Run `--describe` first; if it reports text, follow up with normal mode |

## Usage

```bash
# Normal mode: extract text (in reading order)
swift <skill-dir>/scripts/ocr.swift /path/to/image.png

# Layout mode: detect table structure, output coordinates
swift <skill-dir>/scripts/ocr.swift --layout /path/to/image.png

# Describe mode: understand the semantic content of textless images
swift <skill-dir>/scripts/ocr.swift --describe /path/to/image.png
```

## Normal Mode

Outputs plain text in reading order (rows top-to-bottom, left-to-right within a row). Works for any image containing text.

## Layout Mode (--layout)

Outputs layout information:

1. **Table structure** — when rows/columns align, prints "Table (N rows × M columns)" and reconstructs the content row by row
2. **Coordinates** — normalized bounding box `[x1,y1,x2,y2]` and confidence for each text block

- Use cases: table screenshots, list/dict config pages, data reports
- Limitation: Chinese columns aligned with spaces may be merged into one block, breaking table detection; tables with clear gaps or borders are most reliable
- When recognition is inaccurate, coordinates help infer the text context

## Describe Mode (--describe)

For models **without vision capabilities** (e.g. DeepSeek v4 Flash): converts multi-dimensional perception of the image into structured text so the model can "see" the image. Outputs:

1. **Scene categories** — image classification labels (with confidence)
2. **People / faces / animals** — detections with nine-grid position descriptions (top-left / center / bottom-right...)
3. **Barcodes / QR codes** — decoded content directly (links, WiFi configs, etc.)
4. **Focus of the image** — saliency region position
5. **Aesthetics score / image nature** — value from -1 to 1 (closer to 1 = more pleasing), plus whether it's an ordinary content image
6. **Text hint** — when text is detected, suggests running normal mode for exact content

**Reading confidence**: ≥40% is trustworthy and can be quoted directly; 20%~40% is flagged as "maybe"; <20% is filtered out.

Models without vision should run `--describe` first to understand the image; if it reports text, follow up with normal mode for exact content.

## Notes

1. First run compiles (about 5-10 seconds); cached afterwards and much faster
2. Supports PNG, JPG, JPEG, TIFF and other common formats
3. Small text (< 20pt) may be missed; upscale the image first if needed
4. Use only one mode flag per invocation (`--layout` or `--describe`, not both)
