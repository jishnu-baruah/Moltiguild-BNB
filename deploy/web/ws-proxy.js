#!/usr/bin/env node
/**
 * WebSocket proxy wrapper for Next.js standalone server.
 *
 * Starts the Next.js server (server.js) as a child process, then
 * listens for HTTP upgrade requests on /gateway and proxies them
 * to the OpenClaw gateway container (ws://openclaw:18789).
 */
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const url = require('url');

const PORT = parseInt(process.env.PORT || '3000');
const GATEWAY_HOST = process.env.OPENCLAW_HOST || 'openclaw';
const GATEWAY_PORT = parseInt(process.env.OPENCLAW_PORT || '18789');
const NEXT_PORT = PORT + 1; // Next.js listens on internal port

// Start Next.js on the internal port
const nextEnv = { ...process.env, PORT: String(NEXT_PORT), HOSTNAME: '127.0.0.1' };
const next = spawn('node', ['server.js'], { env: nextEnv, stdio: 'inherit' });
next.on('exit', (code) => { console.log(`[ws-proxy] Next.js exited (${code})`); process.exit(code || 0); });

// Create the front-facing HTTP server that proxies everything to Next.js
const server = http.createServer((req, res) => {
    const opts = { hostname: '127.0.0.1', port: NEXT_PORT, path: req.url, method: req.method, headers: req.headers };
    const proxy = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxy.on('error', (err) => { res.writeHead(502); res.end('Bad Gateway'); });
    req.pipe(proxy);
});

// Handle WebSocket upgrade: /gateway → openclaw container
server.on('upgrade', (req, socket, head) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/gateway' || pathname.startsWith('/gateway/')) {
        // Proxy to OpenClaw gateway
        const gwSocket = net.connect(GATEWAY_PORT, GATEWAY_HOST, () => {
            // Rewrite the path — OpenClaw expects /
            const newPath = pathname.replace(/^\/gateway/, '') || '/';
            const reqLine = `GET ${newPath} HTTP/1.1\r\n`;
            const headers = Object.entries(req.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n');
            gwSocket.write(reqLine + headers + '\r\n\r\n');
            if (head.length) gwSocket.write(head);
            gwSocket.pipe(socket);
            socket.pipe(gwSocket);
        });
        gwSocket.on('error', (err) => {
            console.error('[ws-proxy] Gateway connection failed:', err.message);
            socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        });
        socket.on('error', () => gwSocket.destroy());
    } else {
        // Proxy other WebSocket upgrades to Next.js
        const nextSocket = net.connect(NEXT_PORT, '127.0.0.1', () => {
            const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            const headers = Object.entries(req.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\r\n');
            nextSocket.write(reqLine + headers + '\r\n\r\n');
            if (head.length) nextSocket.write(head);
            nextSocket.pipe(socket);
            socket.pipe(nextSocket);
        });
        nextSocket.on('error', () => socket.end());
        socket.on('error', () => nextSocket.destroy());
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ws-proxy] Listening on :${PORT}, Next.js on :${NEXT_PORT}, gateway → ${GATEWAY_HOST}:${GATEWAY_PORT}`);
});

process.on('SIGTERM', () => { next.kill(); server.close(); });
process.on('SIGINT', () => { next.kill(); server.close(); });
