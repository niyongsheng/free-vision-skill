import { defineConfig } from 'tsup'

/**
 * 双产物：
 * - cordis/index（ESM）：Node 端插件（tools + 上传路由），dts 随附
 * - cordis/client（CJS classic script）：浏览器端 bundle，
 *   用 banner/footer 包装成 DSH client-modules 的注册调用
 *
 * 客户端 bundle 契约（对照官方 @deepseek-ai/dsh-client-runtime/lib/client.js）：
 * `window.__ModuleLoader__.load({ id, factory })`，id 必须与包名一致
 * （graph row id = loader 条目名），factory 收同步 require、返回 module.exports。
 * 依赖（react 等）由平台 seed/staticModules 提供，全部 external。
 */
const PKG_ID = '@niyongsheng/free-vision-skill'

export default defineConfig([
  {
    entry: {
      'cordis/index': 'src/cordis/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: false,
    target: 'node20',
  },
  {
    entry: {
      'cordis/client': 'src/cordis/client.ts',
    },
    format: ['cjs'],
    dts: false,
    clean: false,
    sourcemap: false,
    target: 'es2022',
    // 运行时由 DSH 平台提供（seed words），不打包
    external: ['react', 'react-dom', '@deepseek-ai/*', '@cordisjs/*'],
    // package type=module 下 tsup cjs 默认 .cjs；exports["./client"] 指向 .js
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.banner = {
        js:
          `window.__ModuleLoader__.load({\n` +
          `  id: ${JSON.stringify(PKG_ID)},\n` +
          `  factory: function (require) {\n` +
          `    var module = { exports: {} };\n` +
          `    var exports = module.exports;\n`,
      }
      options.footer = {
        js: `\n    return module.exports;\n  }\n});\n`,
      }
    },
  },
])
