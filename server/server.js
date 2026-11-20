import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createGameServer } from './net/gameServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Em desenvolvimento o Vite faz proxy, então CORS nem é usado. Em produção,
  // defina CORS_ORIGIN (separado por vírgulas) se o cliente ficar em outro domínio.
  cors: { origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true },
});

const game = createGameServer(io);
setInterval(() => game.sweep(), 60_000).unref();

app.get('/health', (_req, res) => res.json({ ok: true, rooms: game.rooms.size }));

// Em produção, serve o cliente compilado (npm run build)
const dist = path.join(__dirname, '../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

server.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
