/**
 * 客户端插件（DSH web 浏览器侧）
 *
 * 在输入框粘贴（⌘V）图片时自动保存到本地并插入纯绝对路径：
 * 1. document 级 capture 监听 paste，仅当事件目标是输入框（textarea/input）
 *    且剪贴板含 image/* 文件时接管（preventDefault + stopPropagation，
 *    避免 DSH InputBar 的合成事件把剪贴板文本插进草稿）
 * 2. 逐张 POST /fvs/images（Node 侧 upload.ts 落盘，仅 loopback、限大小）
 * 3. 成功后 `inputActions.setDraft(草稿 + '\n' + 绝对路径)`，模型可直接用
 *    该路径调用 view_image / ocr_image；图片不出本机
 *
 * 不做拖拽接管：drop 事件被阻止会让 DSH 原生拖拽状态机残留遮罩/附件，
 * 与 modlens 一致只处理 paste（拖拽图片保持 DSH 原生附件行为）。
 *
 * 构建：tsup 用 banner/footer 包装成
 * `window.__ModuleLoader__.load({ id: '<包名>', factory: function (req) {...} })`
 * —— id 必须与包名一致（client-modules 的 graph row id = loader 条目名）。
 *
 * 类型来源（均为 type-only，构建后擦除）：
 * - `@deepseek-ai/dsh-client-ui-slots`：PropsRuntime / SlotComponent
 * - `@deepseek-ai/dsh-client-runtime/client`：Context.slots、SessionStandardProps
 * - `@deepseek-ai/dsh-client-ui-conversation/client`：SlotMap（input.right）、
 *   useInput / inputActions kit
 */

import { useEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 插件名（cordis 约定；客户端 loader 默认用 graph entry id = 包名，name 可选覆盖） */
export const name = 'free-vision-skill'

/**
 * 声明 slots 服务：dsh-cordis-client-runner 的守卫按对象形式插件的 inject
 * 解锁 ctx.slots 访问（无声明抛 `cannot get property "slots" without inject`）
 */
export const inject = ['slots'] as const

/** 上传路由（与 Node 侧 upload.ts 的 registerUploadRoute 路径一致） */
const UPLOAD_URL = '/fvs/images'

/** 输入框粘贴图片 → 落盘路径（多图换行分隔追加到草稿末尾） */
export function apply(ctx: Context): void {
  ctx.slots.register(
    { name: 'conversation.input.right', id: 'fvs-paste-to-path', order: 999 },
    PasteToPath,
  )
}

type RightProps = PropsRuntime<'conversation.input.right'>

/** 渲染 null 的槽位组件：只在输入框上接管图片粘贴 */
function PasteToPath({ input, inputActions }: RightProps) {
  // owner 传入的 input 快照随 store 变更自动重渲染，用 ref 镜像最新 draft，
  // 事件闭包（mount 时挂一次监听）读取的永远是当前草稿
  const draftRef = useRef('')
  draftRef.current = input.draft

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isInputTarget(e.target)) return
      const files = imageFiles(e.clipboardData?.files)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      void saveToDraft(files)
    }

    // 仅 paste：拖拽交给 DSH 原生附件流程（避免 drop 状态机冲突）
    // inputActions 身份 per-session 稳定，空依赖安全
    document.addEventListener('paste', handlePaste, true)
    return () => {
      document.removeEventListener('paste', handlePaste, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 逐张串行上传并追加路径（串行保证多图插入顺序稳定）
  const saveToDraft = async (files: File[]) => {
    for (const file of files) {
      try {
        const path = await uploadImage(file)
        const base = draftRef.current
        const sep = base && !base.endsWith('\n') ? '\n' : ''
        const next = base + sep + path
        inputActions.setDraft(next)
        draftRef.current = next
      } catch (err) {
        // 槽位 kit 无通知通道（notify 属会话内部），失败走 console 便于诊断
        console.error(`[free-vision-skill] 图片保存失败: ${file.name}`, err)
      }
    }
  }

  return null
}

function isInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
  )
}

function imageFiles(files: FileList | undefined | null): File[] {
  if (!files) return []
  return [...files].filter((f) => f.type.startsWith('image/'))
}

/** POST 图片字节到本机 DSH webServer，返回保存后的绝对路径 */
async function uploadImage(file: File): Promise<string> {
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* 非 JSON 错误体，保留状态码 */
    }
    throw new Error(detail)
  }
  const { path } = (await res.json()) as { path: string }
  return path
}
