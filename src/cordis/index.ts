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
 */

import type { Context } from '@cordisjs/core'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_SCRIPT, prepareImage, runSwift } from './swift.js'

// ---------- 插件配置定义 ----------

export interface Config {
  /** ocr.swift 绝对路径；留空使用插件内置脚本 */
  scriptPath?: string
  /** swift 执行超时(ms)。首次运行需编译约 5~10s，请留足余量 */
  timeout: number
}

/** Schemastery Schema — DSH 据此自动渲染配置面板 */
export const Config = Schema.object({
  scriptPath: Schema.string()
    .required(false)
    .description('ocr.swift 脚本绝对路径，留空使用插件内置脚本'),
  timeout: Schema.number()
    .default(120000)
    .description('swift 执行超时(ms)，首次运行需编译约 5~10s'),
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
      async invoke(params) {
        const { path, cleanup } = await prepareImage(String(params.image_url))
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
      async invoke(params) {
        const { path, cleanup } = await prepareImage(String(params.image_url))
        try {
          const args = params.layout ? ['--layout', path] : [path]
          return await runSwift(script, args, config.timeout)
        } finally {
          await cleanup()
        }
      },
    })

    // 返回清理函数：插件卸载时注销这两个工具
    return () => {
      disposeViewImage()
      disposeOcrImage()
    }
  })
}

/** 解析 ocr.swift 路径：配置优先，其次插件内置脚本 */
function resolveScript(config: Config): string {
  if (config.scriptPath) return config.scriptPath
  if (DEFAULT_SCRIPT) return DEFAULT_SCRIPT
  throw new Error('无法定位内置 scripts/ocr.swift，请在配置中指定 scriptPath')
}
