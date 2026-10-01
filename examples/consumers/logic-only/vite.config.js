import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // `npm run check` renders the app in Node. The Aglyn packages are ESM for a
  // bundler, and one of their dependencies (`mobx-utils`) imports its own
  // files without extensions, which Node cannot load directly, so the check
  // is bundled whole instead of leaving packages for Node to resolve.
  ssr: { noExternal: true },
})
