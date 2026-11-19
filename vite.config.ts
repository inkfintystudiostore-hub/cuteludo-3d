import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function pokiHtmlPlugin(): Plugin {
  return {
    name: 'poki-html-transform',
    transformIndexHtml(html) {
      return html
        .replace(/<meta\s+name="google-adsense-account"[^>]*>\s*/i, '')
        .replace(/<link\s+rel="manifest"[^>]*>\s*/i, '')
        .replace(/<script[\s\S]*?pagead2\.googlesyndication\.com[\s\S]*?<\/script>\s*/i, '')
        .replace(/<script>\s*window\.adsbygoogle[\s\S]*?<\/script>\s*/i, '')
        .replace(/<a\s+href="https?:\/\/[^"]*"[^>]*>(.*?)<\/a>/gi, '$1')
        .replace(/<a\s+href="mailto:[^"]*"[^>]*>(.*?)<\/a>/gi, '$1')
        .replace(
          '</head>',
          '    <script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>\n  </head>',
        );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isPoki = mode === 'poki' || process.env.VITE_PORTAL === 'poki';

  return {
    base: isPoki ? './' : '/',
    define: isPoki ? { 'import.meta.env.VITE_PORTAL': JSON.stringify('poki') } : undefined,
    plugins: [react(), tailwindcss(), ...(isPoki ? [pokiHtmlPlugin()] : [])],
    build: {
      outDir: isPoki ? 'dist-poki' : 'dist',
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('firebase')) {
                return 'vendor-firebase';
              }
              if (id.includes('three') || id.includes('@react-three')) {
                return 'vendor-three';
              }
              if (id.includes('gsap')) {
                return 'vendor-gsap';
              }
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/ws': {
          target: 'ws://127.0.0.1:8787',
          ws: true,
        },
        '/api': {
          target: 'http://127.0.0.1:8787',
        },
      },
    },
  };
});
