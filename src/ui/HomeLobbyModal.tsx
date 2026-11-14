/**
 * Inspired online-Ludo homepage pop-up modal matching the comic pastel ink aesthetic.
 * Lets players pick Solo/AI/Pass & Play modes or create/join a live 9-digit Friend Room
 * powered by Cloudflare Durable Objects WebSockets (with graceful offline local fallback).
 */
import { useEffect, useState } from 'react';
import { TEAM_COLORS, TEAM_IDS, TEAM_LABELS, type TeamId } from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import type { GameMode } from '../engine/ludoRules';
import {
  connectMultiplayerRoom,
  disconnectMultiplayerRoom,
  notifyParentRoomCode,
  reserveUniqueRoomCode,
  sendRoomMode,
  sendRoomStart,
} from '../engine/multiplayerClient';
import { buildRoomShareUrl, formatRoomCode, parseRoomCodeInput, resolveShareBaseUrl } from '../engine/roomCode';
import { BotIcon, CheckIcon, CopyIcon, LinkIcon, MascotIcon, PlayIcon, UsersIcon } from './Icons';

type LobbyTab = 'local' | 'friends';
type LocalPlayStyle = 'ai' | 'pass' | 'sim';

const FORMATS: { id: GameMode; label: string; hint: string }[] = [
  { id: '2P_COUPLES', label: '2P Couples', hint: 'Pink vs Yellow' },
  { id: '4P_FFA', label: '4P Friends', hint: 'All 4 Animals' },
  { id: '2V2_TEAM', label: '2v2 Teams', hint: 'Team Up!' },
];

const LOCAL_STYLES: { id: LocalPlayStyle; label: string; desc: string }[] = [
  { id: 'ai', label: 'vs Computer', desc: 'You play Pink vs smart bots' },
  { id: 'pass', label: 'Pass & Play', desc: 'Share one screen together' },
  { id: 'sim', label: 'Watch Sim', desc: '4x fast animal bot match' },
];

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BTN =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';

function readInitialRoomFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return parseRoomCodeInput(window.location.search);
}

export function HomeLobbyModal() {
  const screen = useGameStore((s) => s.screen);
  const room = useGameStore((s) => s.room);
  const startMatch = useGameStore((s) => s.startMatch);

  const [tab, setTab] = useState<LobbyTab>(() => (readInitialRoomFromUrl() ? 'friends' : 'local'));
  const [format, setFormat] = useState<GameMode>('4P_FFA');
  const [localStyle, setLocalStyle] = useState<LocalPlayStyle>('ai');

  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [reservingRoom, setReservingRoom] = useState(false);
  const [joinInput, setJoinInput] = useState<string>(() => {
    const urlCode = readInitialRoomFromUrl();
    return urlCode ? formatRoomCode(urlCode) : '';
  });
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<'code' | 'link' | null>(null);

  // Sync URL ?room= auto-join if present or clear disconnected local state when returning Home.
  useEffect(() => {
    if (screen !== 'home') return;
    if (room && room.online) {
      setFormat(useGameStore.getState().game.mode);
    }
  }, [screen, room]);

  if (screen !== 'home') return null;

  const shareOrigin = resolveShareBaseUrl();
  const liveCode = room?.code ?? createdCode;
  const shareUrl = liveCode ? buildRoomShareUrl(shareOrigin, liveCode) : '';

  const copyText = async (text: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind((cur) => (cur === kind ? null : cur)), 1800);
    } catch {
      // Clipboard blocked gracefully ignored.
    }
  };

  const handleSelectFormat = (nextFormat: GameMode) => {
    setFormat(nextFormat);
    if (room?.online && room.isHost) {
      sendRoomMode(nextFormat);
    }
  };

  const handleStartLocal = () => {
    disconnectMultiplayerRoom();
    startMatch({
      mode: format,
      vsAi: localStyle === 'ai',
      simulation: localStyle === 'sim',
      room: null,
    });
  };

  const handleCreateRoom = async () => {
    if (reservingRoom) return;
    setReservingRoom(true);
    setJoinError(null);
    try {
      const code = await reserveUniqueRoomCode(format);
      setCreatedCode(code);
      connectMultiplayerRoom(code, 'host', format);
    } finally {
      setReservingRoom(false);
    }
  };

  const handleStartHostedRoom = () => {
    if (!liveCode) return;
    if (room?.online) {
      sendRoomStart(format);
      return;
    }
    startMatch({
      mode: format,
      vsAi: false,
      simulation: false,
      room: { code: liveCode, role: 'host', peers: 1 },
    });
  };

  const handleJoinRoom = () => {
    const parsed = parseRoomCodeInput(joinInput);
    if (!parsed) {
      setJoinError('Enter a valid 9-digit room code or share link.');
      return;
    }
    setJoinError(null);
    connectMultiplayerRoom(parsed, 'guest', format);
  };

  const handleLeaveLobbyRoom = () => {
    disconnectMultiplayerRoom();
    notifyParentRoomCode(null);
    setCreatedCode(null);
    useGameStore.setState({ room: null });
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setJoinInput(text.trim());
        setJoinError(null);
      }
    } catch {
      // Paste via keyboard remains available.
    }
  };

  const activeTeams: TeamId[] = format === '2P_COUPLES' ? ['PINK', 'YELLOW'] : [...TEAM_IDS];
  const connectedGuestWaiting = room?.role === 'guest' && room.online && !room.started;
  const offlineFallbackReady = room?.role === 'guest' && room.status === 'offline';

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-ink/38 p-3 backdrop-blur-xs sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-lobby-title"
        className={`relative flex max-h-[95dvh] w-full max-w-xl flex-col gap-2.5 overflow-y-auto rounded-3xl bg-[#fff8f5] p-4 motion-safe:animate-[pop-in_0.35s_ease-out] sm:p-5 ${INK_BOX}`}
      >
        {/* Hero Header */}
        <header className="flex flex-col items-center gap-1.5 text-center">
          <div className="flex items-center gap-1.5" aria-hidden>
            {activeTeams.map((team) => (
              <span
                key={team}
                className="grid size-8 place-items-center rounded-xl border-[2.5px] border-ink shadow-ink-sm"
                style={{ backgroundColor: TEAM_COLORS[team] }}
              >
                <MascotIcon team={team} className="size-4.5 text-ink" />
              </span>
            ))}
          </div>
          <h1
            id="home-lobby-title"
            className={`-skew-x-6 rounded-xl bg-[#ff8fab] px-4 py-0.5 text-xl font-bold tracking-wider uppercase sm:text-2xl ${INK_BOX}`}
          >
            Chibi Ludo 3D
          </h1>
          <p className="text-xs font-semibold text-ink/80">
            Pick your animal squad &amp; mode, or invite friends with a 9-digit room link.
          </p>
        </header>

        {/* Top Mode Hub Switcher */}
        <div role="tablist" aria-label="Play options" className="grid grid-cols-2 gap-2 rounded-2xl border-[3px] border-ink bg-white p-1 shadow-ink-sm">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'local'}
            onClick={() => setTab('local')}
            className={`flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors ${
              tab === 'local' ? 'bg-ink text-white' : 'text-ink hover:bg-[#ffe0ea]'
            }`}
          >
            <BotIcon className="size-4" />
            Solo &amp; Local
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'friends'}
            onClick={() => setTab('friends')}
            className={`flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-bold transition-colors ${
              tab === 'friends' ? 'bg-ink text-white' : 'text-ink hover:bg-[#e0fbfc]'
            }`}
          >
            <UsersIcon className="size-4" />
            Play With Friends
          </button>
        </div>

        {/* Shared Board Format Picker */}
        <section aria-label="Board player format" className="flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">Players &amp; Teams</span>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                aria-pressed={format === id}
                onClick={() => handleSelectFormat(id)}
                className={`flex flex-col items-center rounded-2xl px-2 py-1.5 text-center ${INK_BTN} ${
                  format === id ? 'bg-[#ffe0ea]' : 'bg-white'
                }`}
              >
                <span className="text-xs font-bold sm:text-sm">{label}</span>
                <span className="text-[10px] font-semibold text-ink/65">{hint}</span>
              </button>
            ))}
          </div>
        </section>

        {tab === 'local' ? (
          <div className="flex flex-col gap-3">
            <section aria-label="Game style" className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">Match Style</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {LOCAL_STYLES.map(({ id, label, desc }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={localStyle === id}
                    onClick={() => setLocalStyle(id)}
                    className={`flex flex-col items-start rounded-2xl px-3 py-2 text-left ${INK_BTN} ${
                      localStyle === id ? 'bg-[#ffd875]' : 'bg-white'
                    }`}
                  >
                    <span className="text-sm font-bold">{label}</span>
                    <span className="mt-0.5 text-[11px] leading-tight font-medium text-ink/75">{desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <button
              type="button"
              onClick={handleStartLocal}
              className={`mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#ff8fab] px-6 text-lg font-bold tracking-wide uppercase ${INK_BTN}`}
            >
              <PlayIcon className="size-4" />
              Start Game
            </button>
          </div>
        ) : connectedGuestWaiting ? (
          /* Joined Friend Waiting View */
          <div className="flex flex-col gap-2.5 rounded-2xl border-[3px] border-ink bg-white p-3.5 shadow-ink-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-ink/65 uppercase">Connected to Live Room</span>
                <div className="font-mono text-lg font-bold tracking-wider">{formatRoomCode(room.code)}</div>
              </div>
              {room.myTeam && (
                <span
                  className="rounded-xl border-2 border-ink px-2.5 py-1 text-xs font-bold uppercase"
                  style={{ backgroundColor: TEAM_COLORS[room.myTeam] }}
                >
                  You: {TEAM_LABELS[room.myTeam]}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {room.seats.map((seat) => (
                <div
                  key={seat.team}
                  className="flex items-center gap-1.5 rounded-xl border-2 border-ink/25 bg-[#fff8f0] px-2 py-1.5 text-[11px] font-bold"
                >
                  <span className="size-2.5 shrink-0 rounded-full border border-ink" style={{ backgroundColor: TEAM_COLORS[seat.team] }} />
                  <span className="truncate">{seat.occupant === 'human' ? seat.label : 'Waiting…'}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink/75">Waiting for host to launch the match…</span>
              <button
                type="button"
                onClick={handleLeaveLobbyRoom}
                className={`rounded-xl bg-[#ffe0ea] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
              >
                Leave
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {/* Create Room Panel */}
            <div className="flex flex-col justify-between gap-2 rounded-2xl border-[3px] border-ink bg-white p-3 shadow-ink-sm">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="text-xs font-bold tracking-wide uppercase sm:text-sm">Create Room</h2>
                  {room && (
                    <span
                      className={`rounded-full border border-ink px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        room.status === 'connected' ? 'bg-[#80ed99]' : room.status === 'connecting' ? 'bg-[#ffd875]' : 'bg-[#ffe0ea]'
                      }`}
                    >
                      {room.status === 'connected' ? `Live (${room.peers})` : room.status === 'connecting' ? 'Connecting' : 'Local'}
                    </span>
                  )}
                </div>

                {!createdCode ? (
                  <p className="text-xs font-medium text-ink/75">
                    Generate a 9-digit room code &amp; share link to invite friends.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="rounded-xl border-2 border-ink bg-[#fff8f0] px-2 py-1 text-center">
                      <span className="block text-[10px] font-bold tracking-wider text-ink/65 uppercase">
                        9-Digit Code ({room?.peers ?? 1} ready)
                      </span>
                      <span className="font-mono text-base font-bold tracking-wider tabular-nums sm:text-lg">
                        {formatRoomCode(createdCode)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyText(createdCode, 'code')}
                        className={`flex min-h-7 items-center justify-center gap-1 rounded-xl bg-white px-2 text-xs font-bold ${INK_BTN}`}
                      >
                        {copiedKind === 'code' ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                        {copiedKind === 'code' ? 'Copied' : 'Copy Code'}
                      </button>
                      <button
                        type="button"
                        onClick={() => copyText(shareUrl, 'link')}
                        className={`flex min-h-7 items-center justify-center gap-1 rounded-xl bg-[#a9f0ff] px-2 text-xs font-bold ${INK_BTN}`}
                      >
                        {copiedKind === 'link' ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
                        {copiedKind === 'link' ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                    <input
                      type="text"
                      readOnly
                      aria-label="Shareable invite link"
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full rounded-lg border-2 border-ink/25 bg-[#fff8f5] px-2 py-0.5 text-[11px] font-medium text-ink/80"
                    />
                  </div>
                )}
              </div>

              {!createdCode ? (
                <button
                  type="button"
                  disabled={reservingRoom}
                  onClick={handleCreateRoom}
                  className={`min-h-9 w-full rounded-xl bg-[#ffd875] px-3 text-sm font-bold uppercase disabled:opacity-60 ${INK_BTN}`}
                >
                  {reservingRoom ? 'Reserving…' : 'Generate Room Code'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartHostedRoom}
                  className={`min-h-9 w-full rounded-xl bg-[#ff8fab] px-3 text-sm font-bold uppercase ${INK_BTN}`}
                >
                  Open Room Board
                </button>
              )}
            </div>

            {/* Join Room Panel */}
            <div className="flex flex-col justify-between gap-2 rounded-2xl border-[3px] border-ink bg-white p-3 shadow-ink-sm">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xs font-bold tracking-wide uppercase sm:text-sm">Join Room</h2>
                <p className="text-xs font-medium text-ink/75">
                  Paste your friend&apos;s 9-digit code or full invite URL.
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    aria-label="9-digit room code or invite link"
                    placeholder="e.g. 482-910-375 or link"
                    value={joinInput}
                    onChange={(e) => {
                      setJoinInput(e.target.value);
                      if (joinError) setJoinError(null);
                    }}
                    className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1.5 text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePaste}
                    title="Paste from clipboard"
                    className={`rounded-xl bg-[#fff8f0] px-2.5 text-xs font-bold ${INK_BTN}`}
                  >
                    Paste
                  </button>
                </div>
                {joinError && (
                  <p role="alert" className="text-[11px] font-bold text-[#d90429]">
                    {joinError}
                  </p>
                )}
              </div>

              {offlineFallbackReady ? (
                <button
                  type="button"
                  onClick={() =>
                    startMatch({
                      mode: format,
                      vsAi: false,
                      simulation: false,
                      room: { code: room!.code, role: 'guest', peers: 1 },
                    })
                  }
                  className={`min-h-9 w-full rounded-xl bg-[#ffd875] px-3 text-xs font-bold uppercase ${INK_BTN}`}
                >
                  Open Offline Preview
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleJoinRoom}
                  className={`min-h-9 w-full rounded-xl bg-[#9bf6d0] px-3 text-sm font-bold uppercase ${INK_BTN}`}
                >
                  Join Room
                </button>
              )}
            </div>

            <p className="sm:col-span-2 rounded-xl border-2 border-ink/20 bg-white/80 px-2.5 py-1 text-center text-[11px] font-semibold text-ink/75">
              {room?.statusNote ?? 'Powered by Cloudflare Durable Objects Free Tier — empty room seats automatically run smart bots.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
