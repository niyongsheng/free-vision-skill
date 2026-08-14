import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cordis/index': 'src/cordis/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: 'node20',
})
