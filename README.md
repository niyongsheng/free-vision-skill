# free-vision-skill

[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![Framework](https://img.shields.io/badge/Framework-Vision-blueviolet)](https://developer.apple.com/documentation/vision)
[![Privacy](https://img.shields.io/badge/Fully%20Local-Yes-success)](https://en.wikipedia.org/wiki/Local_computing)

Fully-local image understanding (OCR / table extraction / description) via macOS Vision. Images never leave your Mac.

## Install (DSH-Plugin)

```bash
dsh plugin add @niyongsheng/free-vision-skill
```

Then add to `cordis.patch.yml`:

```yaml
- insert:
    - id: free-vision-skill
      name: '@niyongsheng/free-vision-skill'
      config:
        timeout: 120000
```

## Tools

- `view_image` — describe image content (scene, people, QR, composition)
- `ocr_image` — extract text; `layout=true` for table structure + coordinates

Input: http(s) URL / base64 / local path.

## Usage (Claude Code Skill)

```bash
swift scripts/ocr.swift image.png          # OCR
swift scripts/ocr.swift --layout image.png # table + coordinates
swift scripts/ocr.swift --describe image.png # describe image
```

## Notes

- Requires macOS 11+ & Xcode Command Line Tools
- First run compiles ~5–10s, cached afterwards

## License

[MIT](LICENSE) © 2026 Nico
