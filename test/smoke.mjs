/**
 * Cordis 插件冒烟测试（无需 DSH 环境）
 *
 * 用 fake Context 模拟 DSH 的 tools 服务与 effect 生命周期，
 * 覆盖：工具注册、本地路径/base64 输入、layout 模式、describe 模式、
 * 错误路径、dispose 清理。Swift 链路为真实执行（需要 macOS + Xcode CLT）。
 *
 * 契约与 @deepseek-ai/dsh-tools 对齐：
 * - execute(args, exec) 返回结果值
 * - output.render(args, value) 生成展示内容
 * - parameters 为完整 JSON Schema（schemaOf 原样投影给模型 API）
 */

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')

import { apply, name, inject, Config, stampName, handleImageUpload, DEFAULT_SAVE_DIR } from '../dist/cordis/index.js'

// ---------- 生成测试图片 ----------

const tmp = mkdtempSync(join(tmpdir(), 'fvs-smoke-'))
const imagePath = join(tmp, 'hello.png')
execFileSync('swift', [fileURLToPath(new URL('./fixtures/gen-image.swift', import.meta.url)), imagePath], {
  timeout: 120_000,
})

// ---------- fake Context ----------

const registered = []
const disposed = []
let disposer = null

const ctx = {
  tools: {
    register(def) {
      registered.push(def)
      return () => disposed.push(def.name)
    },
  },
  // 可选服务探测：无 webServer 组成（headless）时应降级而非抛错
  get() {
    return undefined
  },
  effect(fn) {
    disposer = fn()
  },
  // 动态依赖：headless 下 webServer 永不出现，fork 保持 pending、零副作用
  inject() {
    return {}
  },
}

apply(ctx, { timeout: 120_000 })

const tool = (n) => registered.find((d) => d.name === n)

/** 模拟 DSH 执行链：execute 得值 → render 得内容 */
const run = async (toolName, params) => {
  const def = tool(toolName)
  const value = await def.execute(params, {})
  return { value, content: def.output.render(params, value) }
}

// ---------- 测试用例 ----------

test('插件元信息: name / inject / Config Schema', () => {
  assert.equal(name, 'free-vision-skill')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof Config, 'function')
  assert.equal(typeof apply, 'function')
})

test('注册两个工具并声明 output / parameters 契约', () => {
  assert.deepEqual(registered.map((d) => d.name), ['view_image', 'ocr_image'])
  for (const def of registered) {
    assert.equal(def.output.schema.type, 'string')
    assert.equal(typeof def.output.render, 'function')
    assert.equal(typeof def.execute, 'function')
    // parameters 为完整 JSON Schema（模型 API 原样接收）
    assert.equal(def.parameters.type, 'object')
    assert.equal(def.parameters.properties.image_url.type, 'string')
    assert.deepEqual(def.parameters.required, ['image_url'])
  }
})

test('ocr_image 提取本地图片文字', async () => {
  const { value, content } = await run('ocr_image', { image_url: imagePath })
  assert.match(value, /Hello Vision 123/)
  // render 输出 tool-result blocks（dsh-session 校验 block.content 为数组）
  assert.deepEqual(content, [{ type: 'text', text: value }])
})

test('ocr_image 支持 base64 输入', async () => {
  const b64 = readFileSync(imagePath).toString('base64')
  const { value } = await run('ocr_image', { image_url: b64 })
  assert.match(value, /Hello Vision 123/)
})

test('ocr_image layout 模式输出坐标', async () => {
  const { value } = await run('ocr_image', { image_url: imagePath, layout: true })
  assert.match(value, /confidence/)
})

test('view_image 输出图像描述', async () => {
  const { value } = await run('view_image', { image_url: imagePath })
  assert.match(value, /Image Description/)
  assert.match(value, /Text: \d+ text region/)
})

test('不存在的文件报错清晰', async () => {
  await assert.rejects(
    () => tool('ocr_image').execute({ image_url: join(tmp, 'missing.png') }, {}),
    /图片文件不存在/,
  )
})

test('dispose 注销两个工具', () => {
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.deepEqual(disposed.sort(), ['ocr_image', 'view_image'])
})

// ---------- 粘贴图片上传落盘（upload.ts） ----------

const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const jpgHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49])

test('stampName 按魔数嗅探扩展名且时间戳格式正确', () => {
  const now = new Date('2026-08-15T09:30:45')
  const png = stampName(now, pngHead)
  assert.match(png, /^fvs-20260815-093045-[0-9a-f]{4}\.png$/)
  const jpg = stampName(now, jpgHead)
  assert.match(jpg, /^fvs-20260815-093045-[0-9a-f]{4}\.jpg$/)
  // 同一时间戳不同内容 → 随机后缀防覆盖
  assert.notEqual(stampName(now, pngHead), stampName(now, pngHead))
})

test('stampName 支持 gif/webp/heic/heif 嗅探', () => {
  const now = new Date('2026-08-15T09:30:45')
  const gif = stampName(now, Buffer.from('GIF89a\x00\x00\x00'))
  assert.match(gif, /\.gif$/)
  const webp = stampName(now, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))
  assert.match(webp, /\.webp$/)
  const heic = stampName(
    now,
    Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('heic')]),
  )
  assert.match(heic, /\.heic$/)
  const heif = stampName(
    now,
    Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('mif1')]),
  )
  assert.match(heif, /\.heif$/)
})

test('handleImageUpload 自动建目录并返回绝对路径', async () => {
  const dir = join(tmp, 'uploads', 'nested')
  const path = await handleImageUpload(pngHead, dir)
  assert.ok(path.startsWith(dir + '/'))
  assert.match(path, /\.png$/)
  const bytes = readFileSync(path)
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('sniffImageExt 严格模式拒绝非图片字节', async () => {
  const { sniffImageExt } = await import('../dist/cordis/index.js')
  assert.equal(sniffImageExt(Buffer.from('plain text, not an image')), null)
  assert.equal(sniffImageExt(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])), null) // ftypmp42 视频
  assert.equal(sniffImageExt(jpgHead), '.jpg')
})

test('isBlockedDownloadUrl 拒绝本机/内网，放行公网', async () => {
  const { isBlockedDownloadUrl } = await import('../dist/cordis/index.js')
  const blocked = [
    'http://127.0.0.1:3080/secret',
    'http://localhost/x.png',
    'http://10.0.0.1/x.png',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/x.png',
    'http://172.16.0.1/x.png',
    'http://[::1]/x.png',
    'not a url',
  ]
  for (const url of blocked) {
    assert.equal(isBlockedDownloadUrl(url), true, url)
  }
  const allowed = [
    'http://example.com/x.png',
    'https://avatars.githubusercontent.com/u/1?v=4',
    'http://8.8.8.8/x.png', // 公网 IP 字面量
  ]
  for (const url of allowed) {
    assert.equal(isBlockedDownloadUrl(url), false, url)
  }
  // prepareImage 对被拒 URL 直接报错，不发起网络请求
  await assert.rejects(
    () => tool('ocr_image').execute({ image_url: 'http://127.0.0.1:1/x.png' }, {}),
    /拒绝下载本机\/内网地址/,
  )
})

test('默认保存目录为 ~/Pictures/free-vision', () => {
  assert.equal(DEFAULT_SAVE_DIR, join(homedir(), 'Pictures', 'free-vision'))
})

// ---------- 客户端 bundle 冒烟 ----------

test('dist/cordis/client.js 为 DSH client-modules 注册形态', () => {
  const bundle = readFileSync(join(repoRoot, 'dist', 'cordis', 'client.js'), 'utf8')
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(bundle, /id: "@niyongsheng\/free-vision-skill"/)
  // 运行时依赖只允许 seed 词（react），不能有 Node 端/第三方依赖
  const requires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'])
  // classic script 语法合法
  execFileSync('node', ['--check', join(repoRoot, 'dist', 'cordis', 'client.js')])
})

after(() => rmSync(tmp, { recursive: true, force: true }))
