import { Server as IOServer, Socket } from 'socket.io';
import type { Room, RoomSummary, GameState, GameStateSummary, Player } from '../models/types';
import type { RoomStore } from '../services/RoomStore';
import type { GameService } from '../services/GameService';

export class WebSocketServer {
  constructor(private io: IOServer, private roomStore: RoomStore, private game: GameService) {
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  private onConnection(socket: Socket) {
    console.log(`[ws] connection ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[ws] disconnect ${socket.id}`);
      // Mark players using this connection as disconnected
      for (const room of this.roomStore.listRooms()) {
        let changed = false;
        for (const p of room.players) {
          if (p.connectionId === socket.id) {
            p.connected = false; p.connectionId = undefined; changed = true;
          }
        }
        if (changed) {
          this.roomStore.updateActivity(room);
          this.broadcastRoomUpdate(room.id);
        }
      }
    });

    socket.on('message', async (msg: any) => {
      try {
        const { type, payload } = msg || {};
        switch (type) {
          case 'createRoom':
            await this.handleCreateRoom(socket, payload);
            break;
          case 'joinRoom':
            await this.handleJoinRoom(socket, payload);
            break;
          case 'reconnect':
            await this.handleReconnect(socket, payload);
            break;
          case 'toggleReady':
            await this.handleToggleReady(socket, payload);
            break;
          case 'startGame':
            await this.handleStartGame(socket, payload);
            break;
          case 'playMove':
            await this.handlePlayMove(socket, payload);
            break;
          case 'leaveRoom':
            await this.handleLeaveRoom(socket, payload);
            break;
          default:
            socket.emit('message', { type: 'error', payload: { code: 'UNKNOWN_TYPE', message: 'Unknown message type' } });
        }
      } catch (e: any) {
        console.error('[ws] error handling message', e);
        const message = e?.message || 'Internal error';
        socket.emit('message', { type: 'error', payload: { code: 'SERVER_ERROR', message } });
      }
    });
  }

  private async handleCreateRoom(socket: Socket, payload: any) {
    const { nickname, maxPlayers = 4, playerId } = payload || {};
    if (!nickname) return this.error(socket, 'BAD_PAYLOAD', 'Missing nickname');
    const { room, player } = this.roomStore.createRoom(maxPlayers, nickname, playerId);
    player.connectionId = socket.id; player.connected = true;
    socket.join(room.id);
    this.roomStore.updateActivity(room);
    this.sendFullStateToSocket(socket, room.id, player.id);
    this.broadcastRoomUpdate(room.id);
  }

  private async handleJoinRoom(socket: Socket, payload: any) {
    const { nickname, roomId, playerId } = payload || {};
    if (!nickname || !roomId) return this.error(socket, 'BAD_PAYLOAD', 'Missing nickname or roomId');
    try {
      const { room, player } = this.roomStore.joinRoom(roomId, nickname, playerId);
      player.connectionId = socket.id; player.connected = true;
      socket.join(room.id);
      this.roomStore.updateActivity(room);
      this.sendFullStateToSocket(socket, room.id, player.id);
      this.broadcastRoomUpdate(room.id);
    } catch (e: any) {
      this.error(socket, e.message || 'JOIN_FAILED', 'Join failed');
    }
  }

  private async handleReconnect(socket: Socket, payload: any) {
    const { playerId, lastRoomId } = payload || {};
    const room = this.roomStore.getRoom(lastRoomId);
    if (!room) return this.error(socket, 'RECONNECT_FAILED', 'Room not found');
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return this.error(socket, 'RECONNECT_FAILED', 'Player not in room');
    player.connectionId = socket.id; player.connected = true;
    socket.join(room.id);
    this.roomStore.updateActivity(room);
    this.sendFullStateToSocket(socket, room.id, player.id);
    this.broadcastRoomUpdate(room.id);
  }

  private async handleToggleReady(socket: Socket, payload: any) {
    const { roomId, ready, playerId } = payload || {};
    const room = this.roomStore.getRoom(roomId);
    if (!room) return this.error(socket, 'ROOM_NOT_FOUND', 'Room not found');
    let player = this.playerBySocket(room, socket.id);
    if (!player && playerId) {
      // Fallback: attach this socket to the playerId provided (robustness on reconnects)
      const found = room.players.find((p) => p.id === playerId);
      if (found) {
        found.connectionId = socket.id;
        player = found;
        socket.join(room.id);
      }
    }
    if (!player) return this.error(socket, 'NOT_IN_ROOM', 'Not in room');
    player.ready = !!ready;
    this.roomStore.updateActivity(room);
    this.broadcastRoomUpdate(room.id);
  }

  private async handleStartGame(socket: Socket, payload: any) {
    const { roomId, playerId } = payload || {};
    const room = this.roomStore.getRoom(roomId);
    if (!room) return this.error(socket, 'ROOM_NOT_FOUND', 'Room not found');
    let player = this.playerBySocket(room, socket.id);
    if (!player && playerId) {
      const found = room.players.find((p) => p.id === playerId);
      if (found) {
        found.connectionId = socket.id;
        player = found;
        socket.join(room.id);
      }
    }
    if (!player || room.hostId !== player.id) return this.error(socket, 'NOT_HOST', 'Only host can start');
    if (room.players.length < 2) return this.error(socket, 'MIN_PLAYERS', 'Au moins 2 joueurs requis');
    if (room.players.length > room.maxPlayers) return this.error(socket, 'ROOM_FULL', 'Room has too many players');
    if (!room.players.every((p) => p.ready)) return this.error(socket, 'NOT_ALL_READY', 'All players must be ready');
    if (room.status !== 'waiting') return this.error(socket, 'INVALID_STATE', 'Game already started or finished');
    room.status = 'playing';
    this.game.startNewGame(room);
    this.roomStore.updateActivity(room);
    this.broadcastRoomUpdate(room.id);
    await this.broadcastGameState(room);
  }

  private async handlePlayMove(socket: Socket, payload: any) {
    const { roomId, action, placements, tileIdsToExchange } = payload || {};
    const room = this.roomStore.getRoom(roomId);
    if (!room) return this.error(socket, 'ROOM_NOT_FOUND', 'Room not found');
    const player = this.playerBySocket(room, socket.id);
    if (!player) return this.error(socket, 'NOT_IN_ROOM', 'Not in room');
    try {
      const { move, ended } = await this.game.playMove(room, player.id, action, placements, tileIdsToExchange);
      // move accepted
      this.io.to(roomId).emit('message', { type: 'moveAccepted', payload: { roomId, move } });
      // Broadcast new state to each player with personalized racks
      await this.broadcastGameState(room);
      // Turn update broadcast
      if (room.game) {
        this.io.to(roomId).emit('message', {
          type: 'turnUpdate',
          payload: { roomId, activePlayerId: room.game.activePlayerId, turnEndsAt: room.game.turnEndsAt, version: room.game.version },
        });
      }
      if (ended) {
        const scores: Record<string, number> = {};
        const statsByPlayer: any = {};
        for (const p of room.players) { scores[p.id] = p.score; statsByPlayer[p.id] = p.stats; }
        const max = Math.max(...Object.values(scores));
        const winnerIds = Object.entries(scores).filter(([,s]) => s === max).map(([id]) => id);
        this.io.to(roomId).emit('message', { type: 'gameEnded', payload: { roomId, scores, statsByPlayer, winnerIds } });
      }
    } catch (e: any) {
      const reason = e?.reason || e?.message || 'INVALID_MOVE';
      socket.emit('message', { type: 'invalidMove', payload: { roomId, reason } });
    }
  }

  private async handleLeaveRoom(socket: Socket, payload: any) {
    const { roomId } = payload || {};
    const room = this.roomStore.getRoom(roomId);
    if (!room) return;
    const player = this.playerBySocket(room, socket.id);
    if (!player) return;
    // If it's the active player during a game, force a pass to advance turn
    if (room.game && room.game.activePlayerId === player.id) {
      try {
        await this.game.playMove(room, player.id, 'pass');
      } catch (e) {
        // ignore
      }
    }
    // Remove player from room and leave socket room
    this.roomStore.removePlayerFromRoom(roomId, player.id);
    await socket.leave(roomId);
    // If room still exists, broadcast update (host may have changed)
    const remaining = this.roomStore.getRoom(roomId);
    if (remaining) {
      this.broadcastRoomUpdate(roomId);
      // Optionally broadcast game state if in playing state
      if (remaining.game) await this.broadcastGameState(remaining);
    }
    console.log(`[room:${roomId}] Player ${player.id} left room`);
  }

  // Broadcast helpers
  private broadcastRoomUpdate(roomId: string) {
    const room = this.roomStore.getRoom(roomId);
    if (!room) return;
    const summary = toRoomSummary(room);
    this.io.to(roomId).emit('message', { type: 'roomUpdate', payload: { room: summary } });
  }

  private async broadcastGameState(room: Room) {
    if (!room.game) return;
    for (const p of room.players) {
      if (!p.connectionId) continue;
      const gs = toGameStateSummaryForPlayer(room.game, room.players, p.id);
      this.io.to(p.connectionId).emit('message', { type: 'gameState', payload: { roomId: room.id, gameState: gs } });
    }
  }

  private sendFullStateToSocket(socket: Socket, roomId: string, playerId: string) {
    const room = this.roomStore.getRoom(roomId)!;
    const summary = toRoomSummary(room);
    const gs = room.game ? toGameStateSummaryForPlayer(room.game, room.players, playerId) : undefined;
    socket.emit('message', { type: 'fullState', payload: { room: summary, gameState: gs } });
  }

  private playerBySocket(room: Room, socketId: string): Player | undefined {
    return room.players.find((p) => p.connectionId === socketId);
  }

  private error(socket: Socket, code: string, message: string) {
    socket.emit('message', { type: 'error', payload: { code, message } });
  }
}

function toRoomSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    maxPlayers: room.maxPlayers,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      ready: p.ready,
      host: p.id === room.hostId,
      score: p.score,
    })),
  };
}

function toGameStateSummaryForPlayer(game: GameState, players: Player[], playerId: string): GameStateSummary {
  const board = game.board.map((row) =>
    row.map((c) => ({
      // Preserve jokers visually: show '?' for tiles with empty letter (isJoker)
      letter: c.tile ? (c.tile.isJoker ? '?' : (c.tile.letter || undefined)) : undefined,
      // Keep 0-point value for jokers (no || undefined here)
      points: c.tile ? c.tile.value : undefined,
      bonus: c.bonus,
    })),
  );
  const me = players.find((p) => p.id === playerId);
  const scoresByPlayer: Record<string, number> = {};
  for (const p of players) scoresByPlayer[p.id] = p.score;
  const name = (pid: string) => players.find((pp) => pp.id === pid)?.nickname || pid;
  const log = (game.log || []).map((m) => {
    if (m.action === 'play') {
      const words = m.words.filter(Boolean).join(', ');
      return { playerId: m.playerId, action: 'play' as const, summary: `${name(m.playerId)}: ${words} (+${m.score})` };
    }
    if (m.action === 'exchange') {
      return { playerId: m.playerId, action: 'exchange' as const, summary: `${name(m.playerId)}: échange de lettres` };
    }
    return { playerId: m.playerId, action: 'pass' as const, summary: `${name(m.playerId)}: passe` };
  });
  return {
    board,
    myRack: (me?.rack || []).map((t) => ({ tileId: t.id, letter: t.letter, points: t.value })),
    scoresByPlayer,
    activePlayerId: game.activePlayerId,
    turnEndsAt: game.turnEndsAt,
    turnDurationMs: game.turnDurationMs,
    bagCount: game.bag.length,
    log,
    version: game.version,
  };
}
