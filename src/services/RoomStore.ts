import { roomCode, randomId } from '../utils/id';
import type { Room, Player, RoomStatus } from '../models/types';

export class RoomStore {
  private rooms = new Map<string, Room>();

  constructor(private now: () => number = () => Date.now()) {}

  listRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): void {
    this.rooms.delete(id);
  }

  updateActivity(room: Room) {
    room.lastActivityAt = this.now();
  }

  findRoomByPlayer(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.id === playerId)) return room;
    }
    return undefined;
  }

  createRoom(maxPlayers: number, hostNickname: string, playerId?: string) {
    const id = this.generateUniqueRoomId();
    const host: Player = {
      id: playerId || randomId(16),
      nickname: hostNickname.slice(0, 15),
      connected: true,
      ready: false,
      score: 0,
      rack: [],
      stats: { wordsPlayed: 0, bestWordScore: 0, bestWord: null, totalTurns: 0, passes: 0 },
    };
    const room: Room = {
      id,
      hostId: host.id,
      status: 'waiting',
      maxPlayers: Math.max(1, Math.min(4, maxPlayers)),
      players: [host],
      lastActivityAt: this.now(),
    };
    this.rooms.set(id, room);
    console.log(`[room] Created ${id} with host ${host.nickname} (${host.id})`);
    return { room, player: host };
  }

  joinRoom(roomId: string, nickname: string, playerId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.players.length >= room.maxPlayers) throw new Error('ROOM_FULL');
    if (room.status !== 'waiting') throw new Error('ROOM_NOT_JOINABLE');
    if (room.players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) throw new Error('NICKNAME_TAKEN');

    // Reattach existing player by playerId if provided and found (edge case)
    let player: Player | undefined;
    if (playerId) player = room.players.find((p) => p.id === playerId);
    if (!player) {
      player = {
        id: playerId || randomId(16),
        nickname: nickname.slice(0, 15),
        connected: true,
        ready: false,
        score: 0,
        rack: [],
        stats: { wordsPlayed: 0, bestWordScore: 0, bestWord: null, totalTurns: 0, passes: 0 },
      };
      room.players.push(player);
    }
    this.updateActivity(room);
    console.log(`[room:${roomId}] Player joined ${player.nickname} (${player.id})`);
    return { room, player };
  }

  removePlayerFromRoom(roomId: string, playerId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx >= 0) {
      const [removed] = room.players.splice(idx, 1);
      this.updateActivity(room);
      console.log(`[room:${roomId}] Removed player ${removed.nickname} (${removed.id})`);
      if (room.players.length === 0) {
        this.rooms.delete(roomId);
        console.log(`[room:${roomId}] Deleted (empty)`);
      } else if (playerId === room.hostId) {
        // Assign new host
        room.hostId = room.players[0].id;
        console.log(`[room:${roomId}] Host changed to ${room.hostId}`);
      }
    }
  }

  setRoomStatus(roomId: string, status: RoomStatus) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.status = status;
    this.updateActivity(room);
  }

  private generateUniqueRoomId(): string {
    for (let i = 0; i < 1000; i++) {
      const id = roomCode(4);
      if (!this.rooms.has(id)) return id;
    }
    // fallback to 6 chars if collisions are absurdly high
    for (let i = 0; i < 1000; i++) {
      const id = roomCode(6);
      if (!this.rooms.has(id)) return id;
    }
    throw new Error('ROOM_ID_GENERATION_FAILED');
  }
}

