#!/bin/bash
# OCR usage examples
# Resolves the script path automatically, so it works wherever the skill is installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OCR_SCRIPT="$SCRIPT_DIR/../scripts/ocr.swift"

# 1. Extract text
swift "$OCR_SCRIPT" ~/Desktop/screenshot.png

# 2. Detect table structure and output coordinates (layout mode)
swift "$OCR_SCRIPT" --layout ~/Desktop/table.png

# 3. Describe image content (for models without vision capabilities)
swift "$OCR_SCRIPT" --describe ~/Desktop/photo.png
