import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { qdadmVitePlugin } from '@quazardous/qdadm/vite'

// Served by the provider at /admin/; in development, its API is a running provider's
// (OIDC_URL, http://127.0.0.1:8080 by default).
export default defineConfig({
  base: '/admin/',
  plugins: [vue(), qdadmVitePlugin()],
  server: { proxy: { '/admin/api': process.env.OIDC_URL ?? 'http://127.0.0.1:8080' } },
})
