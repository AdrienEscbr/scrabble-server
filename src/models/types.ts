import type { BonusType } from '../config/constants';

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface PlayerStats {
  wordsPlayed: number;
  bestWordScore: number;
  bestWord: string | null;
  totalTurns: number;
  passes: number;
}

export interface Tile {
  id: string; // unique tile id
  letter: string; // 'A'..'Z' or '' for joker
  value: number; // letter points
  isJoker: boolean;
}

export interface TileOnBoard extends Tile {
  fromPlayerId: string;
  turnPlayed: number;
}

export interface BoardCell {
  x: number; // 0..14
  y: number; // 0..14
  bonus?: BonusType;
  tile?: TileOnBoard | null;
  bonusUsed: boolean; // true after first use
}

export interface MovePlacement {
  x: number;
  y: number;
  tileId: string; // reference to tile in player's rack
}

export interface MoveSummary {
  playerId: string;
  action: 'play' | 'pass' | 'exchange';
  words: string[];
  score: number;
  placements: MovePlacement[];
  turnNumber: number;
  createdAt: number;
}

export interface Player {
  id: string; // playerId stable (client may provide)
  nickname: string; // <= 15 chars
  connected: boolean;
  ready: boolean;
  score: number;
  rack: Tile[];
  stats: PlayerStats;
  connectionId?: string; // socket id
}

export interface GameState {
  board: BoardCell[][];
  bag: Tile[];
  turnIndex: number; // index in room.players
  activePlayerId: string;
  turnEndsAt: number; // ms epoch
  turnDurationMs: number; // e.g., 120000
  lastMove?: MoveSummary;
  log: MoveSummary[];
  consecutivePasses: number;
  startedAt: number;
  version: number;
}

export interface Room {
  id: string; // code like 'ABCD'
  hostId: string;
  status: RoomStatus;
  maxPlayers: number; // 1..4
  players: Player[];
  game?: GameState;
  lastActivityAt: number;
}

// Summaries sent to client
export interface PlayerSummary {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  host?: boolean;
  score: number;
}

export interface RoomSummary {
  id: string;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  players: PlayerSummary[];
}

export interface BoardCellSummary {
  letter?: string;
  points?: number;
  bonus?: BonusType;
}

export interface GameTileSummary {
  tileId: string;
  letter: string;
  points: number;
}

export interface GameStateSummary {
  board: BoardCellSummary[][];
  myRack: GameTileSummary[]; // only for the requesting player
  scoresByPlayer: Record<string, number>;
  activePlayerId: string;
  turnEndsAt: number;
  turnDurationMs: number;
  bagCount: number;
  log: Array<{ playerId: string; action: 'play'|'pass'|'exchange'; summary: string }>;
  version: number;
}

export interface Envelope {
  type: string;
  payload: any;
}
