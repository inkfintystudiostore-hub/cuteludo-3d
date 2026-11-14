/**
 * Shared client <-> server WebSocket protocol for authoritative Ludo rooms.
 * Imported by both the Vite React frontend and the Cloudflare Durable Object worker.
 */
import type { TeamId } from './boardMap';
import type { GameMode, GameState } from './ludoRules';

export const ROOM_EMOTE_IDS = ['laugh', 'loading', 'wave', 'grumpy', 'angry'] as const;

export type RoomEmoteId = (typeof ROOM_EMOTE_IDS)[number];

export interface ChatMessage {
  id: string;
  team: TeamId | null;
  senderName: string;
  text: string;
  ts: number;
}

export interface SeatInfo {
  team: TeamId;
  occupant: 'human' | 'bot' | 'open';
  playerId: string | null;
  playerName?: string;
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
  | { type: 'join'; playerId: string; name?: string }
  | { type: 'set_name'; name: string }
  | { type: 'select_team'; team: TeamId }
  | { type: 'set_mode'; mode: GameMode }
  | { type: 'start'; mode: GameMode }
  | { type: 'roll' }
  | { type: 'move'; pawnId: string }
  | { type: 'reset' }
  | { type: 'chat'; text: string }
  | { type: 'emote'; emote: RoomEmoteId };

export type ServerMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'roll'; value: number; team: TeamId }
  | { type: 'move'; pawnId: string; team: TeamId }
  | { type: 'reset'; mode: GameMode }
  | { type: 'chat'; chat: ChatMessage }
  | { type: 'emote'; emote: RoomEmoteId; fromTeam: TeamId | null }
  | { type: 'error'; message: string };
