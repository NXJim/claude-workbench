import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import http from 'http';

const frontendPort = parseInt(process.env.CWB_FRONTEND_PORT || '5173');
const backendPort = parseInt(process.env.CWB_BACKEND_PORT || '8084');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ttyd-proxy',
      configureServer(server) {
        // Proxy /ttyd/{port}/... → http://127.0.0.1:{port}/...
        // Keeps the iframe same-origin, fixing Firefox cross-port blocking.
        server.middlewares.use((req, res, next) => {
          const match = req.url?.match(/^\/ttyd\/(\d+)(\/.*)?$/);
          if (!match) return next();

          const port = parseInt(match[1]);
          const targetPath = match[2] || '/';

          const proxyReq = http.request(
            {
              hostname: '127.0.0.1',
              port,
              path: targetPath,
              method: req.method,
              headers: { ...req.headers, host: `127.0.0.1:${port}` },
            },
            (proxyRes) => {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              proxyRes.pipe(res);
            },
          );

          proxyReq.on('error', () => {
            res.writeHead(502);
            res.end('ttyd proxy error');
          });

          req.pipe(proxyReq);
        });

        // Also handle WebSocket upgrades for ttyd
        server.httpServer?.on('upgrade', (req, socket, head) => {
          const match = req.url?.match(/^\/ttyd\/(\d+)(\/.*)?$/);
          if (!match) return;

          const port = parseInt(match[1]);
          const targetPath = match[2] || '/';

          const proxyReq = http.request({
            hostname: '127.0.0.1',
            port,
            path: targetPath,
            method: 'GET',
            headers: { ...req.headers, host: `127.0.0.1:${port}` },
          });

          proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            socket.write(
              `HTTP/1.1 101 Switching Protocols\r\n` +
              Object.entries(proxyRes.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n') +
              '\r\n\r\n',
            );
            if (proxyHead.length) socket.write(proxyHead);
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);

            proxySocket.on('error', () => socket.destroy());
            socket.on('error', () => proxySocket.destroy());
          });

          proxyReq.on('error', () => socket.destroy());
          proxyReq.end();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
