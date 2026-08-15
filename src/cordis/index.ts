/**
 * free-vision-skill — DeepSeek-Harness (Cordis) 原生插件
 *
 * 复用仓库内 fully-local 的 macOS Vision 脚本（scripts/ocr.swift），
 * 通过 DSH tools 服务把本地 OCR / 图像理解暴露为 agent 可调用工具。
 *
 * 设计要点：
 * - `inject: ['tools']`：声明依赖 DSH 内置 tools 服务，未就绪时插件自动 pending
 * - `ctx.effect()`：工具注册副作用，插件卸载 / Fiber 销毁时自动注销，无残留
 * - Schema 驱动配置：DSH 自动生成网页配置表单，支持热重载
 * - 业务逻辑全部在 scripts/ocr.swift（Swift / macOS Vision），本层只做外壳
 *
 * 工具定义契约（DSH @deepseek-ai/dsh-tools）：
 * - parameters: property-map，`required: true` 在属性级声明
 * - output: { schema, render } — schema 校验结果值，render 生成展示内容
 * - execute: 执行体，返回值需符合 output.schema
 */

import type { Context } from '@cordisjs/core'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_SCRIPT, prepareImage, runSwift } from './swift.js'
import { registerUploadRoute } from './upload.js'

// 上传落盘纯函数（单测与外部复用入口）
export {
  DEFAULT_SAVE_DIR,
  DEFAULT_MAX_IMAGE_SIZE,
  handleImageUpload,
  isLoopback,
  stampName,
} from './upload.js'
export type { UploadConfig } from './upload.js'
// 魔数嗅探（单测与外部复用入口）
export { sniffExt, sniffImageExt } from './swift.js'
// SSRF 边界（单测与外部复用入口）
export { isBlockedDownloadUrl } from './swift.js'

// ---------- 插件配置定义 ----------

export interface Config {
  /** ocr.swift 绝对路径；留空使用插件内置脚本 */
  scriptPath?: string
  /** swift 执行超时(ms)。首次运行需编译约 5~10s，请留足余量 */
  timeout: number
  /** 输入框粘贴图片的保存目录；留空使用 ~/Pictures/free-vision */
  saveDir?: string
  /** 粘贴图片大小上限(字节)，默认 20MB */
  maxImageSize?: number
}

/** Schemastery Schema — DSH 据此自动渲染配置面板 */
export const Config = Schema.object({
  scriptPath: Schema.string()
    .required(false)
    .description('ocr.swift 脚本绝对路径，留空使用插件内置脚本'),
  timeout: Schema.number()
    .default(120000)
    .description('swift 执行超时(ms)，首次运行需编译约 5~10s'),
  saveDir: Schema.string()
    .required(false)
    .description('输入框粘贴图片的保存目录，默认 ~/Pictures/free-vision'),
  maxImageSize: Schema.number()
    .default(20 * 1024 * 1024)
    .description('粘贴图片大小上限(字节)，默认 20MB'),
})

// ---------- 插件元信息 ----------

/** cordis 插件名 */
export const name = 'free-vision-skill'

/** 声明依赖 DSH 内置 tools 服务，没有该服务插件不会激活 */
export const inject = ['tools'] as const

// ---------- 插件入口 ----------

/**
 * Cordis 标准插件入口
 * @param ctx Cordis 上下文
 * @param config 用户配置（由 DSH 配置系统注入）
 */
export function apply(ctx: Context, config: Config) {
  // 解析脚本路径一次，失败时插件激活即报错（错误在 Fiber 状态可见）
  const script = resolveScript(config)

  // ctx.effect：注册副作用，卸载时自动执行返回的 dispose
  ctx.effect(() => {
    // 粘贴图片落盘路由：DSH web 组成提供 webServer 时注册；
    // 无该服务（headless/Electron）则跳过，工具功能不受影响
    const disposeUpload = mountUploadRoute(ctx, config)
    // 工具一：图像理解（--describe）
    const disposeViewImage = ctx.tools.register({
      name: 'view_image',
      description:
        '对图片进行语义理解：场景分类、人物/动物/人脸检测、二维码解码、构图焦点、美学评分。完全本地执行（macOS Vision），图片不出本机。适合无视觉能力的模型先理解图片内容',
      parameters: {
        type: 'object',
        required: ['image_url'],
        properties: {
          image_url: {
            type: 'string',
            description: '图片 http(s) 链接 / base64 编码 / 本机绝对路径',
          },
        },
      },
      timeoutMs: config.timeout,
      output: {
        schema: { type: 'string' },
        // content 必须是 blocks 数组（dsh-session 校验 tool-result 块：
        // `!Array.isArray(block.content)` 即拒）；裸字符串会让会话持久化
        // 校验失败、第二轮无法执行，甚至损坏历史会话
        render(_args, value) {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute(args) {
        const { path, cleanup } = await prepareImage(String(args.image_url))
        try {
          return await runSwift(script, ['--describe', path], config.timeout)
        } finally {
          await cleanup()
        }
      },
    })

    // 工具二：纯文字提取（--layout 可选）
    const disposeOcrImage = ctx.tools.register({
      name: 'ocr_image',
      description:
        '提取图片内全部文字（阅读顺序，支持中英文）。layout=true 时输出表格结构与坐标，适合长截图、文档照片、表格页面识别。完全本地执行，图片不出本机',
      parameters: {
        type: 'object',
        required: ['image_url'],
        properties: {
          image_url: {
            type: 'string',
            description: '图片 http(s) 链接 / base64 编码 / 本机绝对路径',
          },
          layout: {
            type: 'boolean',
            description: '是否检测表格结构并输出坐标（默认 false）',
          },
        },
      },
      timeoutMs: config.timeout,
      output: {
        schema: { type: 'string' },
        // 同 view_image：content 必须是 blocks 数组（tool-result 契约）
        render(_args, value) {
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute(args) {
        const { path, cleanup } = await prepareImage(String(args.image_url))
        try {
          const scriptArgs = args.layout ? ['--layout', path] : [path]
          return await runSwift(script, scriptArgs, config.timeout)
        } finally {
          await cleanup()
        }
      },
    })

    // 返回清理函数：插件卸载时注销工具与上传路由
    return () => {
      disposeViewImage()
      disposeOcrImage()
      disposeUpload()
    }
  })
}

/**
 * 可选挂载粘贴图片上传路由（webServer 服务为 web 组成独有，不做硬依赖）。
 *
 * 用 `ctx.inject(['webServer'], cb)` 声明动态依赖：服务可用时执行回调
 * （bundle 层激活后），headless/Electron 无该服务时 fork 永远 pending，
 * 工具功能不受影响。fork 作用域随本插件 ctx 卸载自动清理。
 */
function mountUploadRoute(ctx: Context, config: Config): () => void {
  ctx.inject(['webServer'], (webServerCtx) => {
    webServerCtx.effect(() => registerUploadRoute(webServerCtx.webServer, config))
  })
  return () => {}
}

/** 解析 ocr.swift 路径：配置优先，其次插件内置脚本 */
function resolveScript(config: Config): string {
  if (config.scriptPath) return config.scriptPath
  if (DEFAULT_SCRIPT) return DEFAULT_SCRIPT
  throw new Error('无法定位内置 scripts/ocr.swift，请在配置中指定 scriptPath')
}
