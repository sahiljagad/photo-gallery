import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-photo-album')) return 'gallery';
          if (id.includes('yet-another-react-lightbox')) return 'lightbox';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
});
