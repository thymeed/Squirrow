/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { stampSwPlugin } from './scripts/stamp-sw.mjs'

export default defineConfig({
  plugins: [react(), stampSwPlugin()],
  test: { environment: 'jsdom', setupFiles: ['fake-indexeddb/auto'] },
})
