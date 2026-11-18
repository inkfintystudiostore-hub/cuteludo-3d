/**
 * Inspired online-Ludo homepage pop-up modal matching the comic pastel ink aesthetic.
 * Lets players pick Solo/AI/Pass & Play modes or create/join a live 9-digit Friend Room
 * powered by Cloudflare Durable Objects WebSockets (with graceful offline local fallback).
 */
import { useEffect, useRef, useState } from 'react';
import { showInterstitialAd } from '../engine/adAdapter';
import { TEAM_COLORS, TEAM_LABELS, type TeamId } from '../engine/boardMap';
import { SIMULATION_SPEEDS, useGameStore, type SimulationSpeed } from '../engine/gameStore';
import { pickUniqueBotNames } from '../engine/botNames';
import {
  FRIENDS_STAKE_TIERS,
  MIN_FRIENDS_STAKE,
  STAKE_TIERS,
  calculatePlacementPayout,
  useWalletStore,
  type StakeTier,
} from '../engine/walletStore';
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
  sendRoomStake,
  sendRoomStart,
  syncWalletFromServer,
} from '../engine/multiplayerClient';
import {
  buildRoomShareUrl,
  buildStandaloneAppUrl,
  formatRoomCode,
  isEmbeddedInIframe,
  parseRoomCodeInput,
  resolveShareBaseUrl,
} from '../engine/roomCode';
import { requestGameFullscreen } from '../utils/fullscreen';
import { usePwaInstall } from '../utils/pwaInstall';
import { BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon, LinkIcon, MascotIcon, PlayIcon, UsersIcon } from './Icons';
import { RoomChatBox } from './RoomChatBox';
import { CoinShopModal } from './CoinShopModal';
import { WheelOfFortuneModal } from './WheelOfFortuneModal';
import { AuthModal } from './AuthModal';
import { LegalInfoModal, type LegalTab } from './LegalInfoModal';
import { useAuthStore } from '../engine/authStore';

type LobbyTab = 'local' | 'friends';
type LocalPlayStyle = 'ai' | 'pass' | 'sim';

const FORMATS: { id: GameMode; label: string; hint: string }[] = [
  { id: '2P_COUPLES', label: '2P Couples', hint: 'Pink vs Yellow' },
  { id: '3P_FFA', label: '3P Friends', hint: '3 Animals' },
  { id: '4P_FFA', label: '4P Friends', hint: 'All 4 Animals' },
  { id: '2V2_TEAM', label: '2v2 Teams', hint: 'Diagonal Teams' },
];

const LOCAL_STYLES: { id: LocalPlayStyle; label: string; desc: string }[] = [
  { id: 'ai', label: 'vs Computer', desc: 'You play Pink vs smart bots' },
  { id: 'pass', label: 'Pass & Play', desc: 'Share one screen together' },
  { id: 'sim', label: 'Watch Sim', desc: 'Auto bot match (1x–2x speed)' },
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
  mode,
  hostFallbackName,
  onSelectTeam,
}: {
  seats?: SeatInfo[];
  activeTeams: TeamId[];
  myTeam: TeamId | null;
  mode?: GameMode;
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

  const renderSeatButton = (seat: SeatInfo) => {
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
  };

  if (mode === '2V2_TEAM') {
    const seatFor = (team: TeamId): SeatInfo =>
      effectiveSeats.find((s) => s.team === team) ?? {
        team,
        occupant: 'open',
        playerId: null,
        label: 'Waiting…',
        connected: false,
      };
    return (
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-ink bg-[#fff0f5] p-2">
          <div className="flex items-center justify-between gap-1 text-[10px] font-extrabold tracking-wider text-ink/80 uppercase">
            <span>Team 1</span>
            <span className="rounded-full border border-ink bg-white px-1.5 py-0.5 text-[9px]">Diagonal • Pink + Yellow</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
            {renderSeatButton(seatFor('PINK'))}
            {renderSeatButton(seatFor('YELLOW'))}
          </div>
        </div>

        <div className="mx-auto grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-[#ffd875] text-[10px] font-black shadow-ink-sm">
          VS
        </div>

        <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-ink bg-[#e8fbff] p-2">
          <div className="flex items-center justify-between gap-1 text-[10px] font-extrabold tracking-wider text-ink/80 uppercase">
            <span>Team 2</span>
            <span className="rounded-full border border-ink bg-white px-1.5 py-0.5 text-[9px]">Diagonal • Cyan + Mint</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
            {renderSeatButton(seatFor('CYAN'))}
            {renderSeatButton(seatFor('MINT'))}
          </div>
        </div>
      </div>
    );
  }

  return <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{effectiveSeats.map(renderSeatButton)}</div>;
}

export function HomeLobbyModal() {
  const screen = useGameStore((s) => s.screen);
  const room = useGameStore((s) => s.room);
  const roomAlert = useGameStore((s) => s.roomAlert);
  const lastActiveRoomCode = useGameStore((s) => s.lastActiveRoomCode);
  const startMatch = useGameStore((s) => s.startMatch);

  const embedded = isEmbeddedInIframe();
  const { showInstallButton, hasNativePrompt, platform, promptInstall } = usePwaInstall();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);

  const dismissInstallPopup = () => {
    setInstallHelpOpen(false);
    setShowManualSteps(false);
    try {
      localStorage.setItem('chibi-ludo-install-dismissed', '1');
    } catch {
      // Ignore storage errors in restricted browsing modes.
    }
  };

  useEffect(() => {
    if (!showInstallButton || embedded) return;
    try {
      if (localStorage.getItem('chibi-ludo-install-dismissed') === '1') return;
    } catch {
      // Continue if storage is unavailable.
    }
    const timer = setTimeout(() => {
      setInstallHelpOpen(true);
    }, 800);
    return () => clearTimeout(timer);
  }, [showInstallButton, embedded]);
  const balance = useWalletStore((s) => s.balance);
  const lastDelta = useWalletStore((s) => s.lastDelta);
  const canFreeSpin = useWalletStore((s) => s.canFreeSpin());
  const canClaimStreak = useWalletStore((s) => s.canClaimStreak());
  const deductCoins = useWalletStore((s) => s.deduct);
  const [matchingPublic, setMatchingPublic] = useState(false);
  const [matchedOpponents, setMatchedOpponents] = useState<{ team: TeamId; name: string }[] | null>(null);
  const quickMatchTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const initialRoomCode = readInitialRoomFromUrl();

  const [tab, setTab] = useState<LobbyTab>(() => (initialRoomCode ? 'friends' : 'local'));
  const [format, setFormat] = useState<GameMode>('4P_FFA');
  const [stake, setStake] = useState<StakeTier>(0);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTab | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState<string | null>(null);
  const pendingAuthActionRef = useRef<(() => void) | null>(null);
  const account = useAuthStore((s) => s.account);
  const authReady = useAuthStore((s) => s.authReady);
  const checkSession = useAuthStore((s) => s.checkSession);

  const requireGoogleLogin = (reason: string, action: () => void): boolean => {
    if (useAuthStore.getState().account) return true;
    setAuthReason(reason);
    pendingAuthActionRef.current = action;
    setAuthOpen(true);
    return false;
  };

  const openWheel = () => {
    if (!requireGoogleLogin('Sign in with Google to access Spin & Streak.', () => setWheelOpen(true))) return;
    setWheelOpen(true);
  };
  const [localStyle, setLocalStyle] = useState<LocalPlayStyle>('ai');
  const [simSpeed, setSimSpeed] = useState<SimulationSpeed>(1);

  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [reservingRoom, setReservingRoom] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState<string>(() => loadPlayerDisplayName());
  const [joinInput, setJoinInput] = useState<string>(() => (initialRoomCode ? formatRoomCode(initialRoomCode) : ''));
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<'code' | 'link' | null>(null);
  const autoJoinedUrlRef = useRef<string | null>(null);
  const latestFormatRef = useRef(format);
  const latestNameRef = useRef(playerName);
  latestFormatRef.current = format;
  latestNameRef.current = playerName;

  useEffect(() => {
    void checkSession().then(() => syncWalletFromServer());
    return () => {
      quickMatchTimerRef.current.forEach((t) => clearTimeout(t));
    };
  }, [checkSession]);

  // Clear stale host lobby state once inside a match or after a room closes, and reset URL auto-join tracking when cleared.
  useEffect(() => {
    if (screen !== 'home' && createdCode) {
      setCreatedCode(null);
    }
    if (!room && roomAlert && createdCode) {
      setCreatedCode(null);
    }
    if (screen === 'home' && roomAlert) {
      setTab('friends');
    }
  }, [screen, createdCode, room, roomAlert]);

  useEffect(() => {
    if (screen !== 'home' || embedded || !authReady) return;
    const urlCode = readInitialRoomFromUrl();
    if (!urlCode) {
      autoJoinedUrlRef.current = null;
      return;
    }
    if (room || createdCode || autoJoinedUrlRef.current === urlCode) return;
    autoJoinedUrlRef.current = urlCode;
    setTab('friends');
    setJoinInput(formatRoomCode(urlCode));
    setJoinError(null);
    setCreateError(null);
    if (!useAuthStore.getState().account) {
      setAuthReason(`Sign in with Google to join room ${formatRoomCode(urlCode)}.`);
      pendingAuthActionRef.current = () => {
        connectMultiplayerRoom(urlCode, 'guest', latestFormatRef.current, latestNameRef.current);
      };
      setAuthOpen(true);
      return;
    }
    connectMultiplayerRoom(urlCode, 'guest', latestFormatRef.current, latestNameRef.current);
  }, [screen, embedded, authReady, room, createdCode]);

  // Keep selected format aligned with authoritative room mode from server.
  useEffect(() => {
    if (screen !== 'home') return;
    if (room?.online && room.mode) {
      setFormat(room.mode);
    }
  }, [screen, room?.online, room?.mode]);

  // Enforce minimum 100-coin stake when entering Play With Friends (no free rooms).
  useEffect(() => {
    if (tab === 'friends' && !room?.online && stake < MIN_FRIENDS_STAKE) {
      setStake(MIN_FRIENDS_STAKE);
    }
  }, [tab, room?.online, stake]);

  // Live-sync name edits while waiting inside an active private room.
  useEffect(() => {
    savePlayerDisplayName(playerName);
    if (!room?.online || room.started) return;
    const timer = setTimeout(() => sendRoomName(playerName), 240);
    return () => clearTimeout(timer);
  }, [playerName, room?.online, room?.started]);

  if (screen !== 'home') return null;

  if (embedded) {
    const standaloneUrl = buildStandaloneAppUrl();
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-ink/42 p-4 backdrop-blur-xs">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-lobby-title"
          className={`relative flex w-full max-w-md flex-col items-center gap-3.5 rounded-3xl bg-[#fff8f5] p-6 text-center motion-safe:animate-[pop-in_0.35s_ease-out] ${INK_BOX}`}
        >
          <div className="flex items-center gap-1.5" aria-hidden>
            {(['PINK', 'CYAN', 'MINT', 'YELLOW'] as const).map((team) => (
              <span
                key={team}
                className="grid size-9 place-items-center rounded-xl border-[2.5px] border-ink shadow-ink-sm"
                style={{ backgroundColor: TEAM_COLORS[team] }}
              >
                <MascotIcon team={team} className="size-5 text-ink" />
              </span>
            ))}
          </div>
          <h1
            id="home-lobby-title"
            className={`-skew-x-6 rounded-xl bg-[#ff8fab] px-4 py-1 text-2xl font-bold tracking-wider uppercase ${INK_BOX}`}
          >
            Chibi Ludo 3D
          </h1>
          {initialRoomCode ? (
            <div className="rounded-2xl border-[2.5px] border-ink bg-[#a9f0ff] px-4 py-2 shadow-ink-sm">
              <div className="text-[10px] font-bold tracking-wider text-ink/75 uppercase">Room Invite Ready</div>
              <div className="font-mono text-lg font-bold tracking-wider">{formatRoomCode(initialRoomCode)}</div>
            </div>
          ) : null}
          <p className="text-sm leading-snug font-semibold text-ink/80">
            {initialRoomCode
              ? 'Open the game in a full-screen tab to join your friend’s private room and play smoothly.'
              : 'Chibi Ludo 3D always plays in full-screen mode. Open a new tab for the full 3D board & multiplayer experience.'}
          </p>
          <a
            href={standaloneUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffd875] px-5 text-base font-bold tracking-wide text-ink no-underline uppercase ${INK_BTN}`}
          >
            <ExternalLinkIcon className="size-4.5" />
            {initialRoomCode ? 'Join Room in Fullscreen' : 'Play in Fullscreen Tab'}
          </a>
        </div>
      </div>
    );
  }

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

  const effectiveStake =
    tab === 'friends'
      ? Math.max(MIN_FRIENDS_STAKE, room?.online ? (room.stake ?? stake) : stake)
      : localStyle === 'ai'
        ? stake
        : 0;
  const canAffordMatch = effectiveStake <= 0 || balance >= effectiveStake;

  const handleSelectFormat = (nextFormat: GameMode) => {
    if (tab === 'friends' && room && !room.isHost) return;
    setFormat(nextFormat);
    if (room?.online && room.isHost) {
      sendRoomMode(nextFormat);
    }
  };

  const handleSelectStake = (nextStake: StakeTier) => {
    if (tab === 'friends' && room && !room.isHost) return;
    setStake(nextStake);
    if (room?.online && room.isHost) {
      sendRoomStake(nextStake);
    }
  };

  const handleStartLocal = () => {
    const matchStake = localStyle === 'ai' ? stake : 0;
    if (matchStake > 0 && !deductCoins(matchStake)) return;
    void requestGameFullscreen();
    disconnectMultiplayerRoom();
    setCreatedCode(null);
    startMatch({
      mode: format,
      stake: matchStake,
      vsAi: localStyle === 'ai',
      simulation: localStyle === 'sim',
      simulationSpeed: localStyle === 'sim' ? simSpeed : 1,
      room: null,
    });
  };

  const handleCreateRoom = async () => {
    if (reservingRoom) return;
    if (balance < effectiveStake) {
      setCreateError(`Need at least ${effectiveStake} 🪙 to play with friends.`);
      return;
    }
    if (!requireGoogleLogin('Sign in with Google to create a private room.', () => void handleCreateRoom())) return;
    void requestGameFullscreen();
    setReservingRoom(true);
    setJoinError(null);
    setCreateError(null);
    useGameStore.getState().setRoomAlert(null);
    try {
      await showInterstitialAd('create_private_room');
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
    if (!liveCode || !room?.online || !canAffordMatch) return;
    void requestGameFullscreen();
    sendRoomStart(format, effectiveStake);
  };

  const handleCancelQuickMatch = () => {
    quickMatchTimerRef.current.forEach((t) => clearTimeout(t));
    quickMatchTimerRef.current = [];
    setMatchingPublic(false);
    setMatchedOpponents(null);
  };

  const handleQuickMatch = () => {
    const matchStake = stake;
    if (matchingPublic || (matchStake > 0 && balance < matchStake)) return;
    void requestGameFullscreen();
    quickMatchTimerRef.current.forEach((t) => clearTimeout(t));
    quickMatchTimerRef.current = [];
    setMatchingPublic(true);
    setCreateError(null);
    useGameStore.getState().setRoomAlert(null);

    const opponentTeams = activeTeams.filter((t) => t !== 'PINK');
    const chosenNames = pickUniqueBotNames(opponentTeams.length, playerName.trim());
    const botNamesMap: Partial<Record<TeamId, string>> = {};
    if (playerName.trim()) botNamesMap.PINK = playerName.trim();
    setMatchedOpponents([]);

    // Random 2s - 7s matchmaking buffer
    const totalWaitMs = 2000 + Math.random() * 5000;
    const joinWindow = totalWaitMs - 550;
    let elapsed = 0;

    opponentTeams.forEach((team, idx) => {
      const name = chosenNames[idx] ?? `Player ${idx + 2}`;
      botNamesMap[team] = name;
      const slice = joinWindow / opponentTeams.length;
      elapsed = Math.min(joinWindow, elapsed + slice * (0.65 + Math.random() * 0.55));
      const t = setTimeout(() => {
        setMatchedOpponents((cur) => [...(cur ?? []), { team, name }]);
      }, Math.round(elapsed));
      quickMatchTimerRef.current.push(t);
    });

    const startTimer = setTimeout(() => {
      if (matchStake > 0 && !deductCoins(matchStake)) {
        setMatchingPublic(false);
        setMatchedOpponents(null);
        return;
      }
      disconnectMultiplayerRoom();
      setCreatedCode(null);
      setMatchingPublic(false);
      setMatchedOpponents(null);
      startMatch({
        mode: format,
        stake: matchStake,
        vsAi: true,
        simulation: false,
        simulationSpeed: 1,
        botNames: botNamesMap,
        room: null,
      });
    }, Math.round(totalWaitMs));
    quickMatchTimerRef.current.push(startTimer);
  };

  const handleJoinRoom = (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = parseRoomCodeInput(joinInput);
    if (!parsed) {
      setJoinError('Enter a valid 9-digit room code or share link.');
      return;
    }
    if (
      !requireGoogleLogin('Sign in with Google to join a created room.', () => {
        void requestGameFullscreen();
        setJoinError(null);
        setCreateError(null);
        useGameStore.getState().setRoomAlert(null);
        connectMultiplayerRoom(parsed, 'guest', latestFormatRef.current, latestNameRef.current);
      })
    ) {
      return;
    }
    void requestGameFullscreen();
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

  const effectiveFormat = room?.online && room.mode ? room.mode : format;
  const activeTeams: TeamId[] = [...MODE_TEAMS[effectiveFormat]];
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
        {/* Hero Header: Logo on top, single-line utility bar below */}
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

          <div className="mt-0.5 flex w-full items-center justify-between gap-1.5 overflow-x-auto rounded-2xl border-[2.5px] border-ink bg-white/95 px-2 py-1.5 shadow-ink-sm">
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="relative inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-2 border-ink bg-[#ffd875] px-2 py-0.5 text-[11px] font-bold shadow-ink-sm sm:px-2.5 sm:text-xs">
                🪙 {balance.toLocaleString()}
                {lastDelta && lastDelta.amount > 0 && (
                  <span
                    key={lastDelta.id}
                    className="ml-0.5 rounded-full border border-ink bg-[#80ed99] px-1 text-[9px] font-extrabold text-ink motion-safe:animate-[pop-in_0.3s_ease-out]"
                  >
                    +{lastDelta.amount}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setShopOpen(true)}
                className={`inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#ff8fab] px-2 py-0.5 text-[11px] font-bold uppercase sm:px-2.5 sm:text-xs ${INK_BTN}`}
              >
                + Shop
              </button>
              <button
                type="button"
                onClick={openWheel}
                className={`relative inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#80ed99] px-2 py-0.5 text-[11px] font-bold uppercase sm:px-2.5 sm:text-xs ${INK_BTN}`}
              >
                🎡 {balance < 50 ? 'Free' : 'Spin'}
                {(canFreeSpin || canClaimStreak) && (
                  <span className="rounded-full border border-ink bg-[#ff8fab] px-1 text-[8px] font-extrabold text-ink">
                    FREE
                  </span>
                )}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {showInstallButton && !embedded && (
                <button
                  type="button"
                  onClick={() => {
                    setShowManualSteps(!hasNativePrompt);
                    setInstallHelpOpen(true);
                  }}
                  title="Install App"
                  aria-label="Install App"
                  className={`inline-flex min-h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[#74c0fc] px-2 py-0.5 text-[11px] font-bold uppercase sm:px-2.5 sm:text-xs ${INK_BTN}`}
                >
                  📲
                </button>
              )}
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                title="Profile, Name & Google Account"
                className={`inline-flex min-h-7 max-w-28 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase sm:max-w-36 sm:text-xs ${INK_BTN} ${
                  account ? 'bg-[#a9f0ff]' : 'bg-[#ffe0ea]'
                }`}
              >
                <span>👤</span>
                <span className="truncate">{playerName.trim() || account?.displayName || 'Profile'}</span>
              </button>
            </div>
          </div>
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

        {/* Match Stake / Bet Selector */}
        {(tab === 'friends' || localStyle === 'ai') && (
          <section aria-label="Match stake" className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">
                Entry Stake {tab === 'friends' && isGuestLobby ? '(Set by Host)' : ''}
              </span>
              {effectiveStake > 0 && (
                <span className="rounded-full border border-ink/40 bg-[#ffd875]/45 px-2 py-0.5 text-[10px] font-bold text-ink">
                  {effectiveFormat === '2P_COUPLES' || effectiveFormat === '2V2_TEAM'
                    ? `Winner: ${calculatePlacementPayout(effectiveStake, activeTeams.length, 1, effectiveFormat === '2V2_TEAM' ? 2 : 1, effectiveFormat === '2V2_TEAM').toLocaleString()} 🪙`
                    : `1st: ${calculatePlacementPayout(effectiveStake, activeTeams.length, 1).toLocaleString()} • 2nd: ${calculatePlacementPayout(effectiveStake, activeTeams.length, 2).toLocaleString()} 🪙`}
                </span>
              )}
            </div>
            <div className={`grid gap-1.5 ${tab === 'friends' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3 sm:grid-cols-6'}`}>
              {(tab === 'friends' ? FRIENDS_STAKE_TIERS : STAKE_TIERS).map((tier) => {
                const lockedByHost = tab === 'friends' && isGuestLobby;
                const active = (tab === 'friends' ? effectiveStake : stake) === tier;
                const affordable = tier === 0 || balance >= tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    disabled={lockedByHost}
                    aria-pressed={active}
                    onClick={() => handleSelectStake(tier)}
                    className={`rounded-xl px-2 py-1 text-xs font-bold disabled:cursor-default disabled:opacity-75 ${INK_BTN} ${
                      active ? 'bg-[#ffd875]' : affordable ? 'bg-white' : 'bg-[#f4ece8] text-ink/50'
                    }`}
                  >
                    {tier === 0 ? 'Free' : `🪙 ${tier >= 1000 ? '1K' : tier}`}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'local' ? (
          <div className="flex flex-col gap-3">
            {/* 1-Tap Public Matchmaking (shown first in Solo & Local) */}
            <div className="flex flex-col gap-2 rounded-2xl border-[3px] border-ink bg-[#fff0b3] p-2.5 shadow-ink-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold uppercase">Public Quick Match</div>
                  <div className="text-[11px] font-semibold text-ink/75">
                    {matchingPublic
                      ? 'Finding online players…'
                      : `Auto-match players (${stake > 0 ? `${stake} 🪙 stake` : 'Free table'}).`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={matchingPublic || (stake > 0 && balance < stake)}
                  onClick={handleQuickMatch}
                  className={`min-h-9 shrink-0 rounded-xl bg-[#80ed99] px-4 text-xs font-bold uppercase disabled:opacity-60 ${INK_BTN}`}
                >
                  {matchingPublic ? 'Matching…' : stake > 0 && balance < stake ? `Need ${stake} 🪙` : 'Quick Match'}
                </button>
              </div>
              {matchingPublic && matchedOpponents && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-lg border border-ink bg-[#80ed99] px-2 py-0.5 text-[10px] font-bold">
                    {playerName.trim() || 'You'} (PINK)
                  </span>
                  {matchedOpponents.map((opp) => (
                    <span
                      key={opp.team}
                      className="rounded-lg border border-ink bg-white px-2 py-0.5 text-[10px] font-bold motion-safe:animate-[pop-in_0.25s_ease-out]"
                    >
                      {opp.name} ({opp.team})
                    </span>
                  ))}
                </div>
              )}
            </div>

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

            {localStyle === 'sim' && (
              <section aria-label="Simulation speed" className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">Simulation Speed</span>
                <div className="grid grid-cols-4 gap-2">
                  {SIMULATION_SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      aria-pressed={simSpeed === speed}
                      onClick={() => setSimSpeed(speed)}
                      className={`min-h-9 rounded-xl px-2 text-xs font-bold sm:text-sm ${INK_BTN} ${
                        simSpeed === speed ? 'bg-[#a9f0ff]' : 'bg-white'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </section>
            )}

            {!canAffordMatch ? (
              <button
                type="button"
                onClick={openWheel}
                className={`mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffd875] px-6 text-sm font-bold tracking-wide uppercase ${INK_BTN}`}
              >
                Need {effectiveStake} 🪙 — Spin Wheel for Coins!
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartLocal}
                className={`mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#ff8fab] px-6 text-lg font-bold tracking-wide uppercase ${INK_BTN}`}
              >
                <PlayIcon className="size-4" />
                {effectiveStake > 0 ? `Start Match (${effectiveStake} 🪙)` : 'Start Game'}
              </button>
            )}
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

            <div className="grid grid-cols-2 gap-1.5">
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
                mode={effectiveFormat}
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
              disabled={!room?.online || !canAffordMatch}
              onClick={handleStartHostedRoom}
              className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold tracking-wide uppercase disabled:cursor-not-allowed disabled:opacity-60 sm:text-base ${INK_BTN} ${
                joinedHumanCount >= activeTeams.length ? 'bg-[#80ed99]' : 'bg-[#ff8fab]'
              }`}
            >
              <PlayIcon className="size-4" />
              {!canAffordMatch
                ? `Need ${effectiveStake} 🪙 to Start`
                : !room?.online
                  ? room?.status === 'connecting'
                    ? 'Connecting to Live Server…'
                    : 'Reconnect to Start Match'
                  : joinedHumanCount >= activeTeams.length
                    ? `Start Game (All ${activeTeams.length} Joined!)`
                    : joinedHumanCount < 2
                      ? `Start Solo vs Bot (Friend Can Still Join Later)`
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

            {room.seats.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold tracking-wider text-ink/70 uppercase">
                  Tap any open color to switch
                </span>
                <RoomSeatsRoster
                  seats={room.seats}
                  activeTeams={activeTeams}
                  myTeam={room.myTeam}
                  mode={effectiveFormat}
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

            {effectiveStake > 0 && !canAffordMatch && (
              <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-[#ffe0ea] px-2.5 py-1.5 text-[11px] font-bold">
                <span>Need {effectiveStake} 🪙 for this room&apos;s stake!</span>
                <button
                  type="button"
                  onClick={openWheel}
                  className="cursor-pointer rounded-lg border border-ink bg-[#ffd875] px-2 py-0.5 text-[10px] font-extrabold uppercase"
                >
                  Get Coins
                </button>
              </div>
            )}

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
            {lastActiveRoomCode && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-[3px] border-ink bg-[#d8f3dc] px-3 py-2 shadow-ink-sm sm:col-span-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold uppercase">Match Still Running ({formatRoomCode(lastActiveRoomCode)})</div>
                  <p className="text-[11px] font-semibold text-ink/80">
                    AI bot is holding your seat — jump back in from where the bot is now.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !requireGoogleLogin('Sign in with Google to rejoin your room.', () => {
                        void requestGameFullscreen();
                        setJoinError(null);
                        setCreateError(null);
                        useGameStore.getState().setRoomAlert(null);
                        connectMultiplayerRoom(lastActiveRoomCode, 'guest', latestFormatRef.current, latestNameRef.current);
                      })
                    ) {
                      return;
                    }
                    void requestGameFullscreen();
                    setJoinError(null);
                    setCreateError(null);
                    useGameStore.getState().setRoomAlert(null);
                    connectMultiplayerRoom(lastActiveRoomCode, 'guest', format, playerName);
                  }}
                  className={`min-h-8 shrink-0 rounded-xl bg-[#80ed99] px-3 text-xs font-bold uppercase ${INK_BTN}`}
                >
                  Rejoin Match
                </button>
              </div>
            )}

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
                    className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-[#fff8f5] px-2.5 py-1.5 text-[16px] leading-5 sm:text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none"
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

        {/* Legal & Policy Footer */}
        <footer className="mt-0.5 flex flex-wrap items-center justify-between gap-1.5 border-t-2 border-ink/15 pt-2 text-[10px] font-bold text-ink/75 sm:text-[11px]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLegalModalTab('rules')}
              className="cursor-pointer underline hover:text-ink"
            >
              🎲 How to Play
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('privacy')}
              className="cursor-pointer underline hover:text-ink"
            >
              🛡️ Privacy Policy
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('terms')}
              className="cursor-pointer underline hover:text-ink"
            >
              ⚖️ Terms
            </button>
          </div>
          <a
            href="https://inkfinitystudio.store"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Inkfinity Studio ↗
          </a>
        </footer>
      </div>
      {legalModalTab && (
        <LegalInfoModal initialTab={legalModalTab} onClose={() => setLegalModalTab(null)} />
      )}
      {wheelOpen && <WheelOfFortuneModal onClose={() => setWheelOpen(false)} />}
      {shopOpen && <CoinShopModal onClose={() => setShopOpen(false)} />}
      {matchingPublic && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-3 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Finding matches"
            className={`flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-[#fff8f5] p-5 text-center motion-safe:animate-[pop-in_0.25s_ease-out] ${INK_BOX}`}
          >
            <div className="grid size-12 place-items-center rounded-2xl border-[3px] border-ink bg-[#ffd875] text-2xl shadow-ink-sm animate-bounce">
              🎲
            </div>
            <div>
              <h2 className="text-lg font-extrabold tracking-wide uppercase">Finding Matches…</h2>
              <p className="text-[11px] font-semibold text-ink/70">
                {stake > 0 ? `Matching players for ${stake} 🪙 table` : 'Matching players for Free table'}
              </p>
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              {activeTeams.map((team) => {
                const isMe = team === 'PINK';
                const opp = matchedOpponents?.find((o) => o.team === team);
                const joined = isMe || Boolean(opp);
                return (
                  <div
                    key={team}
                    className={`flex items-center gap-2 rounded-xl border-2 px-2.5 py-2 text-left text-xs font-bold ${
                      joined ? 'border-ink bg-white shadow-ink-sm' : 'border-dashed border-ink/35 bg-[#fff0f5] text-ink/50'
                    }`}
                  >
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-lg border border-ink"
                      style={{ backgroundColor: TEAM_COLORS[team] }}
                    >
                      <MascotIcon team={team} className="size-3.5 text-ink" />
                    </span>
                    <span className="truncate">
                      {isMe ? playerName.trim() || 'You' : opp ? opp.name : 'Searching…'}
                    </span>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleCancelQuickMatch}
              className={`min-h-9 rounded-full bg-white px-5 text-xs font-bold uppercase ${INK_BTN}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {installHelpOpen && showInstallButton && !embedded && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4 backdrop-blur-xs"
          onClick={dismissInstallPopup}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            onClick={(e) => e.stopPropagation()}
            className={`relative flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-[#fff8f5] p-5 text-center motion-safe:animate-[pop-in_0.28s_ease-out] ${INK_BOX}`}
          >
            <button
              type="button"
              aria-label="Close install popup"
              onClick={dismissInstallPopup}
              className={`absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-white text-sm font-extrabold ${INK_BTN}`}
            >
              ✕
            </button>
            <img
              src="/icons/icon-192.png"
              alt="Chibi Ludo 3D"
              className="size-16 rounded-2xl border-2 border-ink shadow-ink-sm"
            />
            <div className="flex flex-col gap-1">
              <h2 id="install-help-title" className="text-base font-extrabold uppercase tracking-wide">
                Install Chibi Ludo 3D
              </h2>
              <p className="text-xs font-semibold text-ink/75">
                Add it as an app icon on your {platform === 'desktop' ? 'desktop' : 'home screen'} for instant full-screen play!
              </p>
            </div>

            {showManualSteps ? (
              platform === 'ios' ? (
                <ol className="flex w-full flex-col gap-2 rounded-2xl border-2 border-ink bg-white p-3 text-left text-xs font-semibold">
                  <li>1. Tap the <strong>Share</strong> button (<span aria-hidden>⬆️</span>) in Safari&apos;s toolbar.</li>
                  <li>2. Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                  <li>3. Tap <strong>Add</strong> — the icon will appear on your iPhone/iPad!</li>
                </ol>
              ) : platform === 'android' ? (
                <ol className="flex w-full flex-col gap-2 rounded-2xl border-2 border-ink bg-white p-3 text-left text-xs font-semibold">
                  <li>1. Tap the browser menu (<strong>⋮</strong>) in the top-right corner.</li>
                  <li>2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                  <li>3. Confirm <strong>Install</strong> to place the icon on your home screen.</li>
                </ol>
              ) : (
                <ol className="flex w-full flex-col gap-2 rounded-2xl border-2 border-ink bg-white p-3 text-left text-xs font-semibold">
                  <li>1. Click the <strong>Install</strong> icon in your browser&apos;s address bar (or open the browser menu).</li>
                  <li>2. Choose <strong>Install Chibi Ludo 3D</strong> to add it to your Desktop / Apps.</li>
                </ol>
              )
            ) : null}

            <div className="flex w-full flex-col gap-2">
              {!showManualSteps && (
                <button
                  type="button"
                  onClick={() => {
                    void promptInstall().then((outcome) => {
                      if (outcome === 'accepted') {
                        dismissInstallPopup();
                      } else if (outcome === 'unavailable') {
                        setShowManualSteps(true);
                      }
                    });
                  }}
                  className={`min-h-10 w-full rounded-full bg-[#80ed99] px-5 text-sm font-extrabold uppercase ${INK_BTN}`}
                >
                  📲 {platform === 'desktop' ? 'Add to Desktop' : 'Add to Home Screen'}
                </button>
              )}
              <button
                type="button"
                onClick={dismissInstallPopup}
                className={`min-h-9 w-full rounded-full bg-white px-5 text-xs font-bold uppercase ${INK_BTN}`}
              >
                {showManualSteps ? 'Got it!' : 'Not Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AuthModal
        open={authOpen}
        reason={authReason}
        playerName={playerName}
        onSavePlayerName={(name) => {
          setPlayerName(name);
          savePlayerDisplayName(name);
        }}
        onClose={() => {
          setAuthOpen(false);
          setAuthReason(null);
          pendingAuthActionRef.current = null;
        }}
        onAuthenticated={(name) => {
          setPlayerName((cur) => (cur.trim() ? cur : name));
          const pending = pendingAuthActionRef.current;
          pendingAuthActionRef.current = null;
          setAuthReason(null);
          pending?.();
        }}
      />
    </div>
  );
}
