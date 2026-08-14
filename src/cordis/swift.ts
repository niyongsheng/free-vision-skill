/**
 * 本地 Swift Vision 执行层
 * - 复用 scripts/ocr.swift（业务逻辑零改动）
 * - 处理三种输入：本地路径 / http(s) 链接 / base64
 * - 所有临时文件写入系统临时目录，用完即清
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

/** 插件内置脚本：dist/cordis/index.js 向上两级 = 包根目录 scripts/ocr.swift */
export const DEFAULT_SCRIPT = fileURLToPath(
  new URL('../../scripts/ocr.swift', import.meta.url),
)

export interface PreparedImage {
  /** 本地文件路径 */
  path: string
  /** 清理临时文件（本地路径时为 no-op） */
  cleanup: () => Promise<void>
}

/** 按内容魔数嗅探扩展名（ImageIO 也能自动识别，扩展名仅作兜底） */
function sniffExt(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  return '.png'
}

function isBase64(input: string): boolean {
  if (input.startsWith('data:image/')) return true
  if (/^https?:\/\//i.test(input)) return false
  // 本地路径不存在时，按 base64 尝试解码（要求长度合理且字符合法）
  if (existsSync(input)) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(input) && input.length > 32
}

/** 把 image_url 参数解析为本地文件路径；http/base64 输入落到临时文件 */
export async function prepareImage(imageUrl: string): Promise<PreparedImage> {
  if (/^https?:\/\//i.test(imageUrl)) {
    const dir = await mkdtemp(join(tmpdir(), 'free-vision-'))
    try {
      const resp = await fetch(imageUrl)
      if (!resp.ok) {
        throw new Error(`下载图片失败: HTTP ${resp.status} ${imageUrl}`)
      }
      const buf = Buffer.from(await resp.arrayBuffer())
      const file = join(dir, `image${sniffExt(buf)}`)
      await writeFile(file, buf)
      return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) }
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  if (isBase64(imageUrl)) {
    const dir = await mkdtemp(join(tmpdir(), 'free-vision-'))
    try {
      const b64 = imageUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length) {
        throw new Error('base64 图片解码失败: 内容为空')
      }
      const file = join(dir, `image${sniffExt(buf)}`)
      await writeFile(file, buf)
      return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) }
    } catch (err) {
      await rm(dir, { recursive: true, force: true })
      throw err
    }
  }

  // 本地路径
  if (!existsSync(imageUrl)) {
    throw new Error(`图片文件不存在: ${imageUrl}`)
  }
  return { path: imageUrl, cleanup: async () => {} }
}

/**
 * 执行 ocr.swift，返回 stdout（去首尾空白）。
 * stderr 仅当 stdout 为空时兜底返回（swift 首次运行会有编译输出）。
 */
export async function runSwift(
  scriptPath: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('swift', [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    })
    const text = stdout.trim()
    return text || stderr.trim()
  } catch (err) {
    const e = err as { killed?: boolean; stderr?: string; message?: string }
    if (e.killed) {
      throw new Error(`swift 执行超时(>${timeoutMs}ms)：首次运行需编译约 5~10s，可调大 timeout 配置`)
    }
    throw new Error(`swift 执行失败: ${e.stderr?.trim() || e.message || String(err)}`)
  }
}
