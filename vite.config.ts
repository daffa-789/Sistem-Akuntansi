import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared')
      }
    },
    server: {
      port: Number(env.VITE_PORT || 3000),
      strictPort: false,
      proxy: { '/api': { target: `http://localhost:${env.PORT || 5000}`, changeOrigin: true } }
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            charts: ['recharts'],
            excel: ['exceljs'],
            pdf: ['jspdf', 'jspdf-autotable']
          }
        }
      }
    },
    test: { environment: 'node', globals: true }
  } as any
})
