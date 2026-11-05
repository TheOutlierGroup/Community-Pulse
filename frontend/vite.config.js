import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// RED-069: index.html is shared by both builds, so its static <title> read
// "Outlier" on the Rhythm Engine site too (survey pages and admin screens
// alike) until a page set its own. The Rhythm Engine build now ships with
// a Rhythm Engine title from the first paint.
function surfaceTabTitle(mode) {
  const env = loadEnv(mode, process.cwd(), '');
  const surface = String(env.VITE_APP_SURFACE || process.env.VITE_APP_SURFACE || 'crm').toLowerCase();
  return surface === 'pulse' ? 'Rhythm Engine' : 'Outlier';
}

export default defineConfig(({ mode }) => {
  const tabTitle = surfaceTabTitle(mode);
  return {
    plugins: [
      react(),
      {
        name: 'surface-tab-title',
        transformIndexHtml(html) {
          return html.replace(/<title>[^<]*<\/title>/, `<title>${tabTitle}</title>`);
        },
      },
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
