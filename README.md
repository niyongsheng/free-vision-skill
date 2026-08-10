# free-vision-skill

[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![Language](https://img.shields.io/badge/Language-Swift-FA7343?logo=swift&logoColor=white)](https://swift.org)
[![Framework](https://img.shields.io/badge/Framework-Vision-blueviolet)](https://developer.apple.com/documentation/vision)
[![Privacy](https://img.shields.io/badge/Fully%20Local-Yes-success)](https://en.wikipedia.org/wiki/Local_computing)

A fully-local image understanding skill for Claude Code, powered by macOS Vision Framework. Helps models **without vision capabilities** (e.g. DeepSeek v4 Flash) read text, extract tables, and describe image content.

## Features

- **Fully local** — no network, images never leave your Mac
- **OCR** — Chinese & English text extraction in reading order
- **Table detection** — `--layout` reconstructs table structure with coordinates
- **Content description** — `--describe` turns textless images into structured text
- **QR / barcode decoding** — decoded content output directly

## Requirements

- macOS 11.0+
- Xcode Command Line Tools

## Install

```bash
git clone <your-repo-url> free-vision-skill
mkdir -p ~/.claude/skills/free-vision-skill
cp -r SKILL.md scripts examples ~/.claude/skills/free-vision-skill/
```

## Usage

```bash
# OCR: extract text
swift ~/.claude/skills/free-vision-skill/scripts/ocr.swift image.png

# Layout: detect table structure + coordinates
swift ~/.claude/skills/free-vision-skill/scripts/ocr.swift --layout image.png

# Describe: understand textless image content
swift ~/.claude/skills/free-vision-skill/scripts/ocr.swift --describe image.png
```

Or just ask Claude to recognize or describe an image — the skill is invoked automatically. See `examples/usage_demo.sh` for more.

## Notes

- First run compiles (~5-10s), cached afterwards
- Supports PNG, JPG, JPEG, TIFF

## License

[MIT](LICENSE) © 2026 Nico
