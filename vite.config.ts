import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Hasil build ditulis ke internal/web/dist agar ikut tertanam ke biner Go
// (lihat internal/web/web.go). Jangan memindahkan folder ini tanpa menyesuaikan
// pola //go:embed pada package web.
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
      // Backend API kini berjalan pada Go (go run ./cmd/finova) di port yang sama.
      proxy: { '/api': { target: `http://localhost:${env.PORT || 5000}`, changeOrigin: true } }
    },
    build: {
      outDir: 'internal/web/dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            charts: ['recharts']
          }
        }
      }
    },
    test: { environment: 'node', globals: true, include: ['src/**/*.test.{ts,tsx}'] }
  } as any
})
