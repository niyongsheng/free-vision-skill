/**
 * DeepSeek-Harness 扩展类型声明
 * DSH 内置的 tools 服务不在 @cordisjs/core 中定义，
 * 通过 Context 接口增强声明，插件代码可获得完整类型。
 */
declare module '@cordisjs/core' {
  interface Context {
    /** DSH 内置工具注册服务（依赖注入声明见插件 `inject: ['tools']`） */
    tools: {
      /**
       * 注册一个工具，返回取消注册的 dispose 函数
       * @param options 工具定义
       */
      register(options: DshToolOptions): () => void
    }
  }
}

/** DSH 工具定义 */
export interface DshToolOptions {
  /** 工具名（agent 可见） */
  name: string
  /** 工具描述（agent 根据描述决定何时调用） */
  description: string
  /** JSON Schema 风格参数定义 */
  parameters: Record<string, unknown>
  /** 工具执行体，返回结果文本 */
  invoke(params: Record<string, unknown>): Promise<string> | string
}
