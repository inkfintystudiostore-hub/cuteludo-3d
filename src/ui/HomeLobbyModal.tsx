/**
 * Inspired online-Ludo homepage pop-up modal matching the comic pastel ink aesthetic.
 * Lets players pick Solo/AI/Pass & Play modes or create/join a live 9-digit Friend Room
 * powered by Cloudflare Durable Objects WebSockets (with graceful offline local fallback).
 */
import { useEffect, useRef, useState } from 'react';
import { TEAM_COLORS, TEAM_LABELS, type TeamId } from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import { MODE_TEAMS, type GameMode } from '../engine/ludoRules';
import type { SeatInfo } from '../engine/multiplayerProtocol';
import {
  connectMultiplayerRoom,
  disconnectMultiplayerRoom,
  loadPlayerDisplayName,
  reserveUniqueRoomCode,
  retryMultiplayerConnection,
  savePlayerDisplayName,
  sendRoomMode,
  sendRoomName,
  sendRoomSelectTeam,
  sendRoomStart,
} from '../engine/multiplayerClient';
import { buildRoomShareUrl, formatRoomCode, parseRoomCodeInput, resolveShareBaseUrl } from '../engine/roomCode';
import { BotIcon, CheckIcon, CopyIcon, LinkIcon, MascotIcon, PlayIcon, UsersIcon } from './Icons';
import { RoomChatBox } from './RoomChatBox';

type LobbyTab = 'local' | 'friends';
type LocalPlayStyle = 'ai' | 'pass' | 'sim';

const FORMATS: { id: GameMode; label: string; hint: string }[] = [
  { id: '2P_COUPLES', label: '2P Couples', hint: 'Pink vs Yellow' },
  { id: '3P_FFA', label: '3P Friends', hint: '3 Animals' },
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

function RoomSeatsRoster({
  seats,
  activeTeams,
  myTeam,
  hostFallbackName,
  onSelectTeam,
}: {
  seats?: SeatInfo[];
  activeTeams: TeamId[];
  myTeam: TeamId | null;
  hostFallbackName?: string;
  onSelectTeam?: (team: TeamId) => void;
}) {
  const effectiveSeats: SeatInfo[] =
    seats && seats.length > 0
      ? seats
      : activeTeams.map((team, idx) => ({
          team,
          occupant: idx === 0 ? 'human' : 'open',
          playerId: idx === 0 ? 'local-host' : null,
          playerName: idx === 0 ? hostFallbackName || undefined : undefined,
          label: idx === 0 ? (hostFallbackName ? `${hostFallbackName} (Host)` : `${TEAM_LABELS[team]} (Host)`) : 'Waiting…',
          connected: idx === 0,
        }));

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {effectiveSeats.map((seat) => {
        const joined = seat.occupant === 'human';
        const isMe = myTeam === seat.team;
        const canClaim = Boolean(onSelectTeam && !joined);
        return (
          <button
            key={seat.team}
            type="button"
            disabled={!canClaim}
            onClick={() => canClaim && onSelectTeam?.(seat.team)}
            title={canClaim ? `Choose ${TEAM_LABELS[seat.team]}` : isMe ? 'Your selected color' : `${TEAM_LABELS[seat.team]} taken`}
            className={`flex items-center gap-1.5 rounded-xl border-2 px-2 py-1.5 text-left text-[11px] font-bold transition-transform ${
              isMe
                ? 'border-ink bg-[#fff8f0] ring-2 ring-ink/25'
                : joined
                  ? 'border-ink bg-[#fff8f0]'
                  : canClaim
                    ? 'cursor-pointer border-dashed border-ink/60 bg-[#fff8f5] text-ink hover:-translate-y-0.5 hover:border-solid hover:bg-white'
                    : 'border-dashed border-ink/30 bg-[#fff8f5] text-ink/55'
            } disabled:cursor-default`}
          >
            <span
              className="grid size-5 shrink-0 place-items-center rounded-md border border-ink"
              style={{ backgroundColor: TEAM_COLORS[seat.team] }}
            >
              <MascotIcon team={seat.team} className="size-3 text-ink" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1">
                <span className="truncate">{joined ? seat.label : canClaim ? `Pick ${TEAM_LABELS[seat.team]}` : 'Waiting…'}</span>
              </div>
              <div className="flex items-center gap-1 text-[9px] font-semibold uppercase">
                <span>{TEAM_LABELS[seat.team]}</span>
                {isMe && <span className="rounded bg-[#80ed99] px-1 text-ink">YOU</span>}
                {joined && seat.connected && <span className="size-1.5 rounded-full bg-[#2b9348]" title="Online" />}
                {joined && !seat.connected && <span className="rounded bg-[#ffd875] px-1 text-[8px] text-ink">Reconnecting</span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function HomeLobbyModal() {
  const screen = useGameStore((s) => s.screen);
  const room = useGameStore((s) => s.room);
  const roomAlert = useGameStore((s) => s.roomAlert);
  const startMatch = useGameStore((s) => s.startMatch);

  const [tab, setTab] = useState<LobbyTab>(() => (readInitialRoomFromUrl() ? 'friends' : 'local'));
  const [format, setFormat] = useState<GameMode>('4P_FFA');
  const [localStyle, setLocalStyle] = useState<LocalPlayStyle>('ai');

  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [reservingRoom, setReservingRoom] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerDisplayName());
  const [joinInput, setJoinInput] = useState<string>(() => {
    const urlCode = readInitialRoomFromUrl();
    return urlCode ? formatRoomCode(urlCode) : '';
  });
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<'code' | 'link' | null>(null);
  const autoJoinedUrlRef = useRef<string | null>(null);

  // Auto-join ?room= invite links as soon as the lobby mounts on Home.
  useEffect(() => {
    if (screen !== 'home') return;
    const urlCode = readInitialRoomFromUrl();
    if (!urlCode || room || createdCode || autoJoinedUrlRef.current === urlCode) return;
    autoJoinedUrlRef.current = urlCode;
    setTab('friends');
    setJoinInput(formatRoomCode(urlCode));
    setJoinError(null);
    setCreateError(null);
    connectMultiplayerRoom(urlCode, 'guest', format, playerName);
  }, [screen, room, createdCode, format, playerName]);

  // Keep selected format aligned with authoritative room mode from server.
  useEffect(() => {
    if (screen !== 'home') return;
    if (room?.online && room.mode) {
      setFormat(room.mode);
    }
  }, [screen, room?.online, room?.mode]);

  // Live-sync name edits while waiting inside an active private room.
  useEffect(() => {
    savePlayerDisplayName(playerName);
    if (!room?.online || room.started) return;
    const timer = setTimeout(() => sendRoomName(playerName), 240);
    return () => clearTimeout(timer);
  }, [playerName, room?.online, room?.started]);

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
    if (tab === 'friends' && room && !room.isHost) return;
    setFormat(nextFormat);
    if (room?.online && room.isHost) {
      sendRoomMode(nextFormat);
    }
  };

  const handleStartLocal = () => {
    disconnectMultiplayerRoom();
    setCreatedCode(null);
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
    setCreateError(null);
    useGameStore.getState().setRoomAlert(null);
    try {
      const reserved = await reserveUniqueRoomCode(format);
      if (!reserved.ok) {
        setCreateError(reserved.error);
        return;
      }
      setCreatedCode(reserved.code);
      connectMultiplayerRoom(reserved.code, 'host', format, playerName);
    } finally {
      setReservingRoom(false);
    }
  };

  const handleStartHostedRoom = () => {
    if (!liveCode || !room?.online) return;
    sendRoomStart(format);
  };

  const handleJoinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = parseRoomCodeInput(joinInput);
    if (!parsed) {
      setJoinError('Enter a valid 9-digit room code or share link.');
      return;
    }
    setJoinError(null);
    setCreateError(null);
    useGameStore.getState().setRoomAlert(null);
    connectMultiplayerRoom(parsed, 'guest', format, playerName);
  };

  const handleLeaveLobbyRoom = () => {
    disconnectMultiplayerRoom();
    setCreatedCode(null);
    useGameStore.setState({ room: null, roomAlert: null });
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

  const activeTeams: TeamId[] = [...MODE_TEAMS[format]];
  const isHostLobby = Boolean(!room?.started && (createdCode || room?.role === 'host'));
  const isGuestLobby = Boolean(!room?.started && room?.role === 'guest');
  const joinedHumanCount = room?.seats?.length
    ? room.seats.filter((s) => s.occupant === 'human').length
    : 1;

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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMATS.map(({ id, label, hint }) => {
              const lockedByHost = tab === 'friends' && isGuestLobby;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={lockedByHost}
                  aria-pressed={format === id}
                  onClick={() => handleSelectFormat(id)}
                  className={`flex flex-col items-center rounded-2xl px-2 py-1.5 text-center disabled:cursor-default disabled:opacity-75 ${INK_BTN} ${
                    format === id ? 'bg-[#ffe0ea]' : 'bg-white'
                  }`}
                >
                  <span className="text-xs font-bold sm:text-sm">{label}</span>
                  <span className="text-[10px] font-semibold text-ink/65">{hint}</span>
                </button>
              );
            })}
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
        ) : isHostLobby && liveCode ? (
          /* Host Private Room Lobby: live player roster + share controls + Start Game anytime */
          <div className="flex flex-col gap-2.5 rounded-2xl border-[3px] border-ink bg-white p-3.5 shadow-ink-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider text-ink/65 uppercase">Private Room Lobby</span>
                  <span
                    className={`rounded-full border border-ink px-2 py-0.5 text-[10px] font-bold uppercase ${
                      room?.status === 'connected' ? 'bg-[#80ed99]' : room?.status === 'connecting' ? 'bg-[#ffd875]' : 'bg-[#ffe0ea]'
                    }`}
                  >
                    {room?.status === 'connected'
                      ? `Live • ${joinedHumanCount}/${activeTeams.length} Joined`
                      : room?.status === 'connecting'
                        ? 'Connecting…'
                        : 'Disconnected'}
                  </span>
                </div>
                <div className="font-mono text-xl font-bold tracking-wider tabular-nums">{formatRoomCode(liveCode)}</div>
              </div>

              <div className="flex items-center gap-1.5">
                {room?.status === 'offline' && (
                  <button
                    type="button"
                    onClick={retryMultiplayerConnection}
                    className={`rounded-xl bg-[#ffd875] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLeaveLobbyRoom}
                  className={`rounded-xl bg-[#ffe0ea] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
                >
                  Close Room
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => copyText(liveCode, 'code')}
                className={`flex min-h-8 items-center justify-center gap-1 rounded-xl bg-white px-2 text-xs font-bold ${INK_BTN}`}
              >
                {copiedKind === 'code' ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                {copiedKind === 'code' ? 'Copied Code' : 'Copy Code'}
              </button>
              <button
                type="button"
                onClick={() => copyText(shareUrl, 'link')}
                className={`flex min-h-8 items-center justify-center gap-1 rounded-xl bg-[#a9f0ff] px-2 text-xs font-bold ${INK_BTN}`}
              >
                {copiedKind === 'link' ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
                {copiedKind === 'link' ? 'Copied Link!' : 'Copy Invite Link'}
              </button>
              <input
                type="text"
                aria-label="Your display name"
                maxLength={18}
                placeholder="Your name (Host)"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="col-span-2 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1 text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none sm:col-span-1"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-ink/70 uppercase">
                <span>Pick Your Color (First-Come, First-Served)</span>
                <span>
                  {joinedHumanCount} / {activeTeams.length} Ready
                </span>
              </div>
              <RoomSeatsRoster
                seats={room?.seats}
                activeTeams={activeTeams}
                myTeam={room?.myTeam ?? activeTeams[0]}
                hostFallbackName={playerName.trim()}
                onSelectTeam={room?.online ? sendRoomSelectTeam : undefined}
              />
              {roomAlert && (
                <p role="alert" className="text-[11px] font-bold text-[#d90429]">
                  {roomAlert}
                </p>
              )}
            </div>

            {room?.online && <RoomChatBox compact />}

            <button
              type="button"
              disabled={!room?.online}
              onClick={handleStartHostedRoom}
              className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold tracking-wide uppercase disabled:cursor-not-allowed disabled:opacity-60 sm:text-base ${INK_BTN} ${
                joinedHumanCount >= activeTeams.length ? 'bg-[#80ed99]' : 'bg-[#ff8fab]'
              }`}
            >
              <PlayIcon className="size-4" />
              {!room?.online
                ? room?.status === 'connecting'
                  ? 'Connecting to Live Server…'
                  : 'Reconnect to Start Match'
                : joinedHumanCount >= activeTeams.length
                  ? `Start Game (All ${activeTeams.length} Joined!)`
                  : `Start Game (${joinedHumanCount}/${activeTeams.length} Joined — Bots Fill Empty)`}
            </button>
          </div>
        ) : isGuestLobby && room ? (
          /* Guest Waiting / Joining View */
          <div className="flex flex-col gap-2.5 rounded-2xl border-[3px] border-ink bg-white p-3.5 shadow-ink-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider text-ink/65 uppercase">
                    {room.online ? 'Connected to Live Room' : room.status === 'connecting' ? 'Joining Live Room' : 'Connection Lost'}
                  </span>
                  <span
                    className={`rounded-full border border-ink px-2 py-0.5 text-[10px] font-bold uppercase ${
                      room.online ? 'bg-[#80ed99]' : room.status === 'connecting' ? 'bg-[#ffd875]' : 'bg-[#ffe0ea]'
                    }`}
                  >
                    {room.online
                      ? `Live • ${joinedHumanCount}/${activeTeams.length} Joined`
                      : room.status === 'connecting'
                        ? 'Connecting…'
                        : 'Offline'}
                  </span>
                </div>
                <div className="font-mono text-lg font-bold tracking-wider">{formatRoomCode(room.code)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {room.myTeam && (
                  <span
                    className="rounded-xl border-2 border-ink px-2.5 py-1 text-xs font-bold uppercase"
                    style={{ backgroundColor: TEAM_COLORS[room.myTeam] }}
                  >
                    You: {TEAM_LABELS[room.myTeam]}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="guest-name-input" className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">
                Name
              </label>
              <input
                id="guest-name-input"
                type="text"
                maxLength={18}
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1 text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none"
              />
            </div>

            {room.seats.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">
                  Tap any open color to switch
                </span>
                <RoomSeatsRoster
                  seats={room.seats}
                  activeTeams={activeTeams}
                  myTeam={room.myTeam}
                  onSelectTeam={room.online ? sendRoomSelectTeam : undefined}
                />
                {roomAlert && (
                  <p role="alert" className="text-[11px] font-bold text-[#d90429]">
                    {roomAlert}
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-xl border-2 border-dashed border-ink/30 bg-[#fff8f5] px-3 py-2.5 text-center text-xs font-bold text-ink/75">
                {room.statusNote ?? 'Connecting you directly to your friend’s room…'}
              </p>
            )}

            {room.online && <RoomChatBox compact />}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink/75">
                {room.online
                  ? 'Waiting for host to launch the match…'
                  : room.statusNote ?? 'Connecting to room…'}
              </span>
              <div className="flex items-center gap-1.5">
                {room.status === 'offline' && (
                  <button
                    type="button"
                    onClick={retryMultiplayerConnection}
                    className={`rounded-xl bg-[#ffd875] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleLeaveLobbyRoom}
                  className={`rounded-xl bg-[#ffe0ea] px-3 py-1.5 text-xs font-bold uppercase ${INK_BTN}`}
                >
                  Leave
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {/* Shared Player Name Bar */}
            <div className="flex items-center gap-2 rounded-2xl border-[3px] border-ink bg-white px-3 py-2 shadow-ink-sm sm:col-span-2">
              <label htmlFor="lobby-player-name" className="shrink-0 text-[11px] font-bold tracking-wider text-ink/75 uppercase">
                Your Name
              </label>
              <input
                id="lobby-player-name"
                type="text"
                maxLength={18}
                placeholder="Enter display name (optional)"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1 text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none"
              />
            </div>

            {/* Create Room Panel */}
            <div className="flex flex-col justify-between gap-2 rounded-2xl border-[3px] border-ink bg-white p-3 shadow-ink-sm">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xs font-bold tracking-wide uppercase sm:text-sm">Create Private Room</h2>
                <p className="text-xs font-medium text-ink/75">
                  Generate a 9-digit room code, see friends join live, and hit Start Game when everyone is ready.
                </p>
                {createError && (
                  <p role="alert" className="text-[11px] font-bold text-[#d90429]">
                    {createError}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={reservingRoom}
                onClick={handleCreateRoom}
                className={`min-h-9 w-full rounded-xl bg-[#ffd875] px-3 text-sm font-bold uppercase disabled:opacity-60 ${INK_BTN}`}
              >
                {reservingRoom ? 'Creating Room…' : 'Create Private Room'}
              </button>
            </div>

            {/* Join Room Panel */}
            <form onSubmit={handleJoinRoom} className="flex flex-col justify-between gap-2 rounded-2xl border-[3px] border-ink bg-white p-3 shadow-ink-sm">
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
                      if (roomAlert) useGameStore.getState().setRoomAlert(null);
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
                {(joinError || roomAlert) && (
                  <p role="alert" className="text-[11px] font-bold text-[#d90429]">
                    {joinError ?? roomAlert}
                  </p>
                )}
              </div>

              <button
                type="submit"
                className={`min-h-9 w-full rounded-xl bg-[#9bf6d0] px-3 text-sm font-bold uppercase ${INK_BTN}`}
              >
                Join Room
              </button>
            </form>

            <p className="sm:col-span-2 rounded-xl border-2 border-ink/20 bg-white/80 px-2.5 py-1 text-center text-[11px] font-semibold text-ink/75">
              {room?.statusNote ?? 'Share your 9-digit room code — empty seats automatically run smart bots if you start early.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
