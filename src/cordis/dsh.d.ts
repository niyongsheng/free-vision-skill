import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * DeepSeek-Harness 扩展类型声明
 * DSH 内置的 tools / webServer 服务不在 @cordisjs/core 中定义，
 * 通过 Context 接口增强声明，插件代码可获得完整类型。
 *
 * 工具定义契约（对照 @deepseek-ai/dsh-tools 源码，schemaOf 原样投影 parameters 到模型 API）：
 * - parameters: 完整 JSON Schema，根节点必须是 `{ type: 'object', properties, required }`
 *   （dsh-tools 对 register() 路径不编译参数，property-map 形式只适用于官方 defineTool()）
 * - output: { schema, render, presentationMeta? }，schema 为结果值的 JSON Schema
 * - execute: 执行体，返回值必须符合 output.schema；render 负责渲染展示内容
 * - timeoutMs: 可选，正整数毫秒
 */
declare module '@cordisjs/core' {
  interface Context {
    /** DSH 内置工具注册服务（依赖注入声明见插件 `inject: ['tools']`） */
    tools: {
      /**
       * 注册一个工具，返回取消注册的 dispose 函数
       * @param definition 工具定义
       */
      register(definition: DshToolDefinition): () => void
    }
    /**
     * DSH host webserver（@deepseek-ai/dsh-host-webserver）：HTTP 路由注册服务。
     * web 组成提供；无该服务的组成（如 headless/Electron）中 `ctx.get('webServer')`
     * 返回 undefined，粘贴上传功能自动降级，工具不受影响。
     */
    webServer: {
      /**
       * 注册一条命名路由；重复 (kind, path) 会抛错。
       * @returns 移除该路由的 disposer
       */
      register(route: DshWebRoute): () => void
    }
  }
}

/** webServer 路由定义（对齐 @deepseek-ai/dsh-host-webserver 的 WebRoute） */
export interface DshWebRoute {
  /** 'exact' 精确匹配 pathname；'prefix' 匹配 p 及 p/<anything> */
  kind: 'exact' | 'prefix'
  /** 绝对 pathname，无尾斜杠 */
  path: string
  /** 拥有完整响应生命周期（可 hold 住响应，如 SSE） */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** DSH 工具定义 */
export interface DshToolDefinition {
  /** 工具名（agent 可见） */
  name: string
  /** 工具描述（agent 根据描述决定何时调用） */
  description: string
  /** 参数完整 JSON Schema：根节点 `{ type: 'object', properties, required? }`（原样投影给模型 API） */
  parameters: Record<string, unknown>
  /** 可选：单次执行超时(ms) */
  timeoutMs?: number
  /** 输出契约：schema 校验结果值，render 生成展示内容 */
  output: {
    /** 结果值的 JSON Schema（本插件为 `{ type: 'string' }`） */
    schema: Record<string, unknown>
    /** 把执行结果渲染为展示内容（通常返回 markdown 字符串） */
    render(args: Record<string, unknown>, value: unknown): unknown
    /** 可选：附加展示元信息 */
    presentationMeta?(args: Record<string, unknown>, value: unknown): unknown
  }
  /** 工具执行体；返回值必须通过 output.schema 校验 */
  execute(args: Record<string, unknown>, exec: unknown): Promise<unknown> | unknown
}
