/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin } from 'vite'

/** `/play` (no trailing slash) is the playground page, in dev and preview too (vercel.json does it in production). */
function playRoute(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path, query] = (req.url ?? '').split('?')
    if (path === '/play') req.url = '/play/index.html' + (query ? `?${query}` : '')
    next()
  }
  return {
    name: 'play-route',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

export default defineConfig({
  plugins: [react(), playRoute()],
  build: {
    rollupOptions: {
      // Two pages: the landing at / and the playground at /play.
      input: {
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
