import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT || 3000),
      proxy: { '/api': { target: `http://localhost:${env.PORT || 5000}`, changeOrigin: true } }
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
            export: ['xlsx', 'jspdf', 'jspdf-autotable']
          }
        }
      }
    },
    test: { environment: 'node', globals: true }
  }
})
