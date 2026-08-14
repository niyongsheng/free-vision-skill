/**
 * Cordis 插件冒烟测试（无需 DSH 环境）
 *
 * 用 fake Context 模拟 DSH 的 tools 服务与 effect 生命周期，
 * 覆盖：工具注册、本地路径/base64 输入、layout 模式、describe 模式、
 * 错误路径、dispose 清理。Swift 链路为真实执行（需要 macOS + Xcode CLT）。
 */

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply, name, inject, Config } from '../dist/cordis/index.js'

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
  effect(fn) {
    disposer = fn()
  },
}

apply(ctx, { timeout: 120_000 })

const tool = (name) => registered.find((d) => d.name === name)

// ---------- 测试用例 ----------

test('插件元信息: name / inject / Config Schema', () => {
  assert.equal(name, 'free-vision-skill')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof Config, 'function')
  assert.equal(typeof apply, 'function')
})

test('注册两个工具: view_image / ocr_image', () => {
  assert.deepEqual(registered.map((d) => d.name), ['view_image', 'ocr_image'])
})

test('ocr_image 提取本地图片文字', async () => {
  const out = await tool('ocr_image').invoke({ image_url: imagePath })
  assert.match(out, /Hello Vision 123/)
})

test('ocr_image 支持 base64 输入', async () => {
  const b64 = readFileSync(imagePath).toString('base64')
  const out = await tool('ocr_image').invoke({ image_url: b64 })
  assert.match(out, /Hello Vision 123/)
})

test('ocr_image layout 模式输出坐标', async () => {
  const out = await tool('ocr_image').invoke({ image_url: imagePath, layout: true })
  assert.match(out, /confidence/)
})

test('view_image 输出图像描述', async () => {
  const out = await tool('view_image').invoke({ image_url: imagePath })
  assert.match(out, /Image Description/)
  assert.match(out, /Text: \d+ text region/)
})

test('不存在的文件报错清晰', async () => {
  await assert.rejects(
    () => tool('ocr_image').invoke({ image_url: join(tmp, 'missing.png') }),
    /图片文件不存在/,
  )
})

test('dispose 注销两个工具', () => {
  assert.equal(typeof disposer, 'function')
  disposer()
  assert.deepEqual(disposed.sort(), ['ocr_image', 'view_image'])
})

after(() => rmSync(tmp, { recursive: true, force: true }))
