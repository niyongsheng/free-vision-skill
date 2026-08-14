# free-vision-skill

[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS-lightgrey?logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![Language](https://img.shields.io/badge/Language-Swift-FA7343?logo=swift&logoColor=white)](https://swift.org)
[![Framework](https://img.shields.io/badge/Framework-Vision-blueviolet)](https://developer.apple.com/documentation/vision)
[![Privacy](https://img.shields.io/badge/Fully%20Local-Yes-success)](https://en.wikipedia.org/wiki/Local_computing)

A fully-local image understanding skill powered by macOS Vision Framework. Helps models **without vision capabilities** (e.g. DeepSeek v4 Flash) read text, extract tables, and describe image content.

> ✨ **DSH-Plugin for DeepSeek-Harness** — 同时支持两种形态：Cordis 原生插件 | Claude Code Skill

## Features

- **Fully local** — no network, images never leave your Mac
- **OCR** — Chinese & English text extraction in reading order
- **Table detection** — `--layout` reconstructs table structure with coordinates
- **Content description** — `--describe` turns textless images into structured text
- **QR / barcode decoding** — decoded content output directly

## Requirements

- macOS 11.0+
- Xcode Command Line Tools

---

## DSH-Plugin 模式（DeepSeek-Harness 原生插件）

以 Cordis 插件形态运行：参与 DSH Fiber 生命周期、`ctx.effect` 自动清理工具注册、Schema 配置面板、热重载。

### 安装

```bash
dsh plugin add github:niyongsheng/free-vision-skill
```

（发布 npm 后可直接 `dsh plugin add @niyongsheng/free-vision-skill`）

### 提供工具

| 工具 | 说明 |
|---|---|
| `view_image` | 图像语义理解：场景分类、人物/动物/人脸、二维码解码、构图焦点、美学评分（`--describe`） |
| `ocr_image` | 图片文字提取（中英文，阅读顺序）；`layout=true` 时输出表格结构与坐标 |

输入 `image_url` 支持：**http(s) 链接** / **base64 编码** / **本机绝对路径**。图片在本地处理，不出本机。

### 配置项

配置示例（`cordis.patch.yml`）：

```yaml
plugins:
  - use: @niyongsheng/free-vision-skill
    with:
      scriptPath: ~/free-vision-skill/scripts/ocr.swift  # 留空使用插件内置脚本
      timeout: 120000                                     # swift 执行超时(ms)
```

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `scriptPath` | string | 内置脚本 | `ocr.swift` 绝对路径，留空使用插件自带脚本 |
| `timeout` | number | 120000 | swift 执行超时(ms)，首次运行需编译约 5~10s |

启动 DSH 后在 web 配置面板中即可看到 `free-vision-skill` 的配置表单。

### 开发联调

```bash
pnpm build         # 构建 dist/
pnpm typecheck     # 类型检查
pnpm test          # 冒烟测试（fake ctx + 真实 Swift 链路）
```

---

## Skill 模式（Claude Code）

### Install

```bash
git clone <your-repo-url> free-vision-skill
mkdir -p ~/.claude/skills/free-vision-skill
cp -r SKILL.md scripts examples ~/.claude/skills/free-vision-skill/
```

### Usage

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
- 两种形态共用同一套 `scripts/ocr.swift` 业务逻辑，互不干扰

## License

[MIT](LICENSE) © 2026 Nico
