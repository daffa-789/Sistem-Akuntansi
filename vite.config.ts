import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Hasil build ditulis ke internal/web/dist agar ikut tertanam ke biner Go
// (lihat internal/web/web.go). Jangan memindahkan folder ini tanpa menyesuaikan
// pola //go:embed pada package web.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Port API Go dipilih scripts/dev.mjs setelah backend benar-benar bind; tanpa
  // nilai itu tidak ada proxy yang masuk akal, jadi lebih baik diberi tahu.
  const apiPort = Number(env.VITE_API_PORT || env.PORT || 0)
  if (!apiPort) {
    console.log('[vite] VITE_API_PORT kosong: /api tidak diproksikan. Jalankan `npm run dev`.')
  }
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, './shared')
      }
    },
    server: {
      // 0 = sistem yang memilih port, jadi `npm run dev` tidak lagi merebut 3000
      // yang merupakan port default semua proyek Vite lain di mesin ini.
      port: Number(env.VITE_PORT || 0),
      strictPort: false,
      proxy: apiPort
        ? { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } }
        : undefined
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
