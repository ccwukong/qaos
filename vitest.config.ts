import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node', // We can test node code mainly, but use jsdom for components if needed
    globals: true,
    setupFiles: [],
  },
})
