/**
 * Shared client <-> server WebSocket protocol for authoritative Ludo rooms.
 * Imported by both the Vite React frontend and the Cloudflare Durable Object worker.
 */
import type { TeamId } from './boardMap';
import type { GameMode, GameState } from './ludoRules';

export type RoomEmoteId = 'heart' | 'shock' | 'coffee' | 'fire';

export interface SeatInfo {
  team: TeamId;
  occupant: 'human' | 'bot' | 'open';
  playerId: string | null;
  label: string;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  mode: GameMode;
  hostId: string;
  started: boolean;
  seats: SeatInfo[];
  game: GameState;
  yourPlayerId: string;
  yourTeam: TeamId | null;
  isHost: boolean;
}

export type ClientMessage =
  | { type: 'join'; playerId: string }
  | { type: 'set_mode'; mode: GameMode }
  | { type: 'start'; mode: GameMode }
  | { type: 'roll' }
  | { type: 'move'; pawnId: string }
  | { type: 'reset' }
  | { type: 'emote'; emote: RoomEmoteId };

export type ServerMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'roll'; value: number; team: TeamId }
  | { type: 'move'; pawnId: string; team: TeamId }
  | { type: 'reset'; mode: GameMode }
  | { type: 'emote'; emote: RoomEmoteId; fromTeam: TeamId | null }
  | { type: 'error'; message: string };
