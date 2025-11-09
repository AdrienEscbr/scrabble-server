import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server as IOServer } from 'socket.io';
import { RoomStore } from './services/RoomStore';
import { GameService } from './services/GameService';
import path from 'node:path';
import fs from 'node:fs';
import { WordValidatorStub, WordValidatorFile } from './services/WordValidator';
import { ROOM_IDLE_CLEANUP_MS, ROOM_SWEEP_INTERVAL_MS, TURN_TICK_INTERVAL_MS } from './config/constants';
import { WebSocketServer } from './ws/WebSocketServer';

const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);
const io = new IOServer(server, {
  cors: { origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN },
});

const roomStore = new RoomStore();
// Try to load French ODS dictionary if available; fallback to stub otherwise
function resolveDictionaryPath(): string | undefined {
  const envPath = process.env.WORD_LIST_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidate1 = path.resolve(__dirname, 'assets', 'French ODS dictionary.txt');
  if (fs.existsSync(candidate1)) return candidate1;
  const candidate2 = path.resolve(__dirname, '..', 'src', 'assets', 'French ODS dictionary.txt');
  if (fs.existsSync(candidate2)) return candidate2;
  return undefined;
}
const dictPath = resolveDictionaryPath();
const validator = dictPath ? new WordValidatorFile(dictPath) : new WordValidatorStub();
if (!dictPath) console.warn('[dict] No dictionary file found; using stub validator.');
const gameService = new GameService(validator);
const ws = new WebSocketServer(io, roomStore, gameService);

// Turn timeout enforcement loop
setInterval(async () => {
  const now = Date.now();
  for (const room of roomStore.listRooms()) {
    if (room.status !== 'playing' || !room.game) continue;
    if (now > room.game.turnEndsAt) {
      // Force pass for active player
      try {
        await gameService.playMove(room, room.game.activePlayerId, 'pass');
        // Broadcast state + turn update
        io.to(room.id).emit('message', {
          type: 'turnUpdate',
          payload: { roomId: room.id, activePlayerId: room.game.activePlayerId, turnEndsAt: room.game.turnEndsAt, version: room.game.version },
        });
        // Personalized game state per player
        // We reuse ws.broadcast of game state by creating a private method
        // Quick re-broadcast by emitting roomUpdate and letting clients fetch gameState via next ticks
        // But we have helper available:
        // @ts-ignore access private method for internal tick
        if (ws['broadcastGameState']) await ws['broadcastGameState'](room);
      } catch (e) {
        console.error('[turn] error forcing pass', e);
      }
    }
  }
}, TURN_TICK_INTERVAL_MS);

// Room cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const room of roomStore.listRooms()) {
    const anyConnected = room.players.some((p) => p.connected);
    if (!anyConnected && now - room.lastActivityAt > ROOM_IDLE_CLEANUP_MS) {
      console.log(`[cleanup] deleting idle room ${room.id}`);
      roomStore.deleteRoom(room.id);
    }
  }
}, ROOM_SWEEP_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[server] Game server listening on http://localhost:${PORT}`);
});
