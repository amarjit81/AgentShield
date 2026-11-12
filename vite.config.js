import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // Keep the first-run scan bounded while pre-bundling the CommonJS React helpers.
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react-is', 'prop-types', 'hoist-non-react-statics'],
  },
});
