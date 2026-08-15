/**
 * 粘贴/拖拽图片落盘服务端
 *
 * DSH web 客户端插件（client.ts）捕获输入框的图片粘贴后，
 * POST 到 webServer 的 `/fvs/images` 路由，本模块把图片字节写入
 * 本地目录并返回绝对路径 —— 模型可直接用该路径调用 view_image / ocr_image。
 *
 * 安全边界：
 * - 仅接受 loopback 来源（DSH 默认监听 127.0.0.1，图片不出本机）
 * - 请求体受 maxImageSize 上限约束
 * - 扩展名按内容魔数嗅探（不信任客户端文件名）
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sniffExt, sniffImageExt } from './swift.js'

// ---------- 默认值与配置 ----------

export interface UploadConfig {
  /** 图片保存目录；留空使用 ~/Pictures/free-vision */
  saveDir?: string
  /** 单张图片大小上限(字节)，默认 20MB */
  maxImageSize?: number
}

export const DEFAULT_SAVE_DIR = join(homedir(), 'Pictures', 'free-vision')
export const DEFAULT_MAX_IMAGE_SIZE = 20 * 1024 * 1024

// ---------- 落盘逻辑（纯函数，可单测） ----------

/** 时间戳文件名：fvs-YYYYMMDD-HHmmss-xxxx<ext>，随机后缀防同名覆盖 */
export function stampName(now: Date, buf: Buffer): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `fvs-${stamp}-${randomBytes(2).toString('hex')}${sniffExt(buf)}`
}

/** 把图片字节写入 saveDir（目录自动创建），返回绝对路径 */
export async function handleImageUpload(body: Buffer, saveDir: string): Promise<string> {
  await mkdir(saveDir, { recursive: true })
  const file = join(saveDir, stampName(new Date(), body))
  await writeFile(file, body)
  return file
}

// ---------- HTTP handler ----------

/** 仅接受本机来源（IPv4/IPv6 loopback） */
export function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 构造 POST /fvs/images 的 handler */
export function createUploadHandler(config: Required<UploadConfig>) {
  const { saveDir, maxImageSize } = config
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      return json(res, 405, { error: `仅支持 POST，收到 ${req.method}` })
    }
    if (!isLoopback(req)) {
      return json(res, 403, { error: '仅允许本机访问' })
    }
    // 边读边限流：超限立即回 413 并 destroy 请求（客户端还在上传时立刻感知错误，
    // 不会等整个 body 传完才被拒绝）。响应先于 destroy 排入 socket，顺序对齐
    // modlens 的 paste 路由。
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > maxImageSize) {
        json(res, 413, { error: `图片超过大小上限 ${Math.floor(maxImageSize / 1024 / 1024)}MB` })
        req.destroy()
        return
      }
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    if (!body.length) {
      return json(res, 400, { error: '请求体为空' })
    }
    // 严格嗅探：字节不匹配任何已知图片头即拒绝（不信任客户端文件名，
    // 未知内容不得以 .png 兜底落盘）
    if (!sniffImageExt(body)) {
      return json(res, 400, { error: '无法识别的图片格式（支持 png/jpeg/gif/webp/heic/heif）' })
    }
    try {
      const path = await handleImageUpload(body, saveDir)
      json(res, 201, { path })
    } catch (err) {
      json(res, 500, { error: `图片保存失败: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
}

/**
 * 在 DSH webServer 上注册上传路由，返回 disposer（插件卸载时注销）
 * @param webServer ctx.get('webServer') 得到的服务
 */
export function registerUploadRoute(
  webServer: { register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void },
  config: UploadConfig,
): () => void {
  const resolved: Required<UploadConfig> = {
    saveDir: resolve(config.saveDir ?? DEFAULT_SAVE_DIR),
    maxImageSize: config.maxImageSize ?? DEFAULT_MAX_IMAGE_SIZE,
  }
  return webServer.register({
    kind: 'exact',
    path: '/fvs/images',
    handler: createUploadHandler(resolved),
  })
}
