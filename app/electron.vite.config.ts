import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // The MCP runtime dependencies are bundled into out/main rather than
    // externalized, so the packaged app can launch the shim without a
    // node_modules tree beside it.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod'],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The stdio MCP server an agent client launches -> out/main/mcp.js
          mcp: resolve(__dirname, 'src/main/mcp/shim.ts'),
        },
        // The native addon must not be bundled — it is loaded at runtime via require().
        external: [/\.node$/],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
