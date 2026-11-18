/**
 * Shared client <-> server WebSocket protocol for authoritative Ludo rooms.
 * Imported by both the Vite React frontend and the Cloudflare Durable Object worker.
 */
import type { TeamId } from './boardMap';
import type { GameMode, GameState } from './ludoRules';

export const ROOM_EMOTE_IDS = [
  'laugh',
  'loading',
  'wave',
  'grumpy',
  'angry',
  'chihuahuaside',
  'minionkiss',
  'dogbleh',
  'dogstare',
  'dogbeach',
  'dogdance',
  'dogsuspect',
  'doghands',
  'dogshock',
  'sadhamster',
  'huskydance',
] as const;

export const TURN_TIMEOUT_MS = 20_000;
export const DISCONNECTED_TURN_WAIT_MS = 15_000;
export const BOT_TURN_FALLBACK_MS = 5_000;
export const GAME_OVER_ROOM_CLOSE_MS = 60_000;

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
  disconnectedAt?: number;
  /** True when an offline/departed human player's seat is temporarily piloted by the AI bot until they reconnect. */
  botTakeover?: boolean;
  /** Missed turns while disconnected; after missing their 1st chance, AI bot takes over for 2nd+ turns. */
  missedTurns?: number;
}

export interface RoomSnapshot {
  code: string;
  mode: GameMode;
  stake?: number;
  hostId: string;
  started: boolean;
  seats: SeatInfo[];
  game: GameState;
  legalMoves?: string[];
  seq?: number;
  turnRemainingMs?: number;
  roomCloseRemainingMs?: number;
  yourPlayerId: string;
  yourTeam: TeamId | null;
  isHost: boolean;
}

export type VoiceSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | {
      kind: 'ice';
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      usernameFragment?: string | null;
    };

export type ClientMessage =
  | { type: 'join'; playerId: string; name?: string; deviceId?: string }
  | { type: 'leave' }
  | { type: 'ping' }
  | { type: 'set_name'; name: string }
  | { type: 'select_team'; team: TeamId }
  | { type: 'set_mode'; mode: GameMode }
  | { type: 'set_stake'; stake: number }
  | { type: 'start'; mode: GameMode; stake?: number }
  | { type: 'roll' }
  | { type: 'move'; pawnId: string }
  | { type: 'reset' }
  | { type: 'chat'; text: string }
  | { type: 'emote'; emote: RoomEmoteId }
  | { type: 'voice_signal'; targetPlayerId: string; signal: VoiceSignal }
  | { type: 'voice_block'; targetPlayerId: string; blocked: boolean }
  | { type: 'voice_state'; enabled: boolean; muted: boolean };

export type ServerMessage =
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'pong' }
  | { type: 'roll'; value: number; team: TeamId; seq?: number; game?: GameState; legalMoves?: string[]; turnRemainingMs?: number }
  | { type: 'move'; pawnId: string; team: TeamId; seq?: number; game?: GameState; legalMoves?: string[]; turnRemainingMs?: number }
  | { type: 'reset'; mode: GameMode; seq?: number; game?: GameState; turnRemainingMs?: number }
  | { type: 'chat'; chat: ChatMessage }
  | { type: 'emote'; emote: RoomEmoteId; fromTeam: TeamId | null }
  | { type: 'voice_signal'; fromPlayerId: string; signal: VoiceSignal }
  | { type: 'voice_blocked'; byPlayerId: string; blocked: boolean }
  | { type: 'voice_peer_state'; playerId: string; enabled: boolean; muted: boolean }
  | { type: 'room_closed'; message: string }
  | { type: 'error'; message: string };
