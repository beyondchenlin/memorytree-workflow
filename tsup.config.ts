import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli/main.ts' },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
})
