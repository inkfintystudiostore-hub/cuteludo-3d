/**
 * Visual-novel style HUD: ink-outlined panels with hard offset shadows around the 3D board.
 * Features the homepage setup pop-up, a compact top-left game menu dropdown (Pause, Restart,
 * Camera Reset, Sound, Room Invite, Quit to Home), and mouse/touch/keyboard gameplay controls.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import gsap from 'gsap';
import {
  HOME_PROGRESS,
  PAWNS_PER_TEAM,
  TEAM_COLORS,
  TEAM_LABELS,
  YARD_PROGRESS,
  getCornerSlotForTeam,
  type TeamId,
} from '../engine/boardMap';
import { SIMULATION_SPEEDS, canLocalPlayerAct, getLocalAnchorTeam, useGameStore } from '../engine/gameStore';
import { showInterstitialAd, showRewardedAd } from '../engine/adAdapter';
import { calculatePlacementPayout, getEmoteCost, useWalletStore } from '../engine/walletStore';
import { pickSmartBotMove } from '../engine/ludoRules';
import { retryMultiplayerConnection } from '../engine/multiplayerClient';
import { buildRoomShareUrl, formatRoomCode, resolveShareBaseUrl } from '../engine/roomCode';
import { DiceTray } from '../scene/Dice3D';
import { CAPTURE_GRAB_DURATION, CAPTURE_TWIRL_DURATION, SPAWN_DURATION } from '../scene/animationTiming';
import { CHARACTER_PROFILES } from '../scene/ChibiFigure';
import { EMOTES, playEmoteMedia, preloadEmoteMedia, syncActiveEmoteMedia } from '../scene/emoteMedia';
import {
  isFullscreenSupported,
  isInFullscreen,
  requestGameFullscreen,
  subscribeFullscreenChange,
  toggleGameFullscreen,
} from '../utils/fullscreen';
import { triggerHaptic } from '../utils/haptics';
import { soundManager } from '../utils/soundManager';
import { HomeLobbyModal } from './HomeLobbyModal';
import { LegalInfoModal } from './LegalInfoModal';
import { RoomChatBox } from './RoomChatBox';
import { VoiceChatPanel } from './VoiceChatPanel';
import { useVoiceStore } from '../engine/voiceStore';
import {
  CameraIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  DoorExitIcon,
  FullscreenIcon,
  HomeIcon,
  LinkIcon,
  MascotIcon,
  MenuIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  SoundIcon,
  TrophyIcon,
  YardIcon,
} from './Icons';

const PARTNER: Record<TeamId, TeamId> = { PINK: 'YELLOW', YELLOW: 'PINK', CYAN: 'MINT', MINT: 'CYAN' };

/** Base delay (ms) between bot turns in simulation mode at 1x speed. */
const SIMULATION_BASE_STEP_MS = 280;
const AI_ROLL_DELAY_MS = 380;
const AI_MOVE_DELAY_MS = 450;

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BUTTON =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** Drives simulation mode, AI opponent turns, and keyboard shortcuts while actively playing & unpaused. */
function useAutomationAndShortcuts() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const simulation = useGameStore((s) => s.simulation);
  const simulationSpeed = useGameStore((s) => s.simulationSpeed);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const waitingRollAck = useGameStore((s) => s.waitingRollAck);
  const phase = useGameStore((s) => s.game.phase);
  const currentTeam = useGameStore((s) => s.game.currentTeam);
  const turnDeadlineAt = useGameStore((s) => s.turnDeadlineAt);
  const legalMovesCount = useGameStore((s) => s.legalMoves.length);
  const hasNamedBots = useGameStore((s) => Object.keys(s.botNames).length > 0);

  useEffect(() => {
    const activeSim = screen === 'playing' && !paused && simulation;
    gsap.globalTimeline.timeScale(activeSim ? simulationSpeed : 1);
    return () => {
      gsap.globalTimeline.timeScale(1);
    };
  }, [screen, paused, simulation, simulationSpeed]);

  useEffect(() => {
    if (screen !== 'playing' || paused || isAnimating || phase === 'GAME_OVER') return;

    if (simulation) {
      const stepMs = Math.round(SIMULATION_BASE_STEP_MS / Math.max(1, simulationSpeed));
      const timer = setTimeout(() => {
        const state = useGameStore.getState();
        if (state.paused || state.screen !== 'playing') return;
        if (state.game.phase === 'ROLL') state.rollDice();
        else if (state.legalMoves.length > 0) {
          state.selectPawn(state.legalMoves[Math.floor(Math.random() * state.legalMoves.length)]);
        }
      }, stepMs);
      return () => clearTimeout(timer);
    }

    const currentSeat = room?.seats.find((s) => s.team === currentTeam);
    const onlineBotTurn =
      Boolean(room?.online && room.isHost && (currentSeat?.occupant === 'bot' || currentSeat?.botTakeover));
    const localBotTurn = !room?.online && vsAi && currentTeam !== 'PINK';
    if (onlineBotTurn || localBotTurn) {
      let delay = phase === 'ROLL' ? AI_ROLL_DELAY_MS : AI_MOVE_DELAY_MS;
      if (localBotTurn && hasNamedBots) {
        if (phase === 'ROLL') {
          const distracted = Math.random() < 0.15;
          delay = distracted ? 2600 + Math.random() * 1100 : 950 + Math.random() * 1650;
        } else {
          delay = legalMovesCount <= 1 ? 700 + Math.random() * 600 : 1200 + Math.random() * 1600;
        }
      }
      const timer = setTimeout(() => {
        const state = useGameStore.getState();
        if (state.paused || state.screen !== 'playing') return;
        if (state.game.phase === 'ROLL') state.rollDice();
        else if (state.legalMoves.length > 0) state.selectPawn(pickSmartBotMove(state.game, state.legalMoves));
      }, delay);
      return () => clearTimeout(timer);
    }

    if (waitingRollAck || turnDeadlineAt === null) return;
    if (room?.online && (room.myTeam !== currentTeam || currentSeat?.botTakeover)) return;

    const isHumanTurn = room?.online ? room.myTeam === currentTeam && !currentSeat?.botTakeover : !vsAi || currentTeam === 'PINK';
    if (!isHumanTurn) return;

    // Server DO alarm is authoritative in online rooms; local client waits +1.5s only as a fallback.
    const baseDelay = Math.max(0, turnDeadlineAt - Date.now());
    const delay = room?.online ? baseDelay + 1500 : baseDelay;
    const timer = setTimeout(() => {
      const state = useGameStore.getState();
      if (state.paused || state.screen !== 'playing' || state.simulation || state.isAnimating || state.waitingRollAck) return;
      if (state.game.phase === 'ROLL') state.rollDice();
      else if (state.game.phase === 'MOVE' && state.legalMoves.length > 0) {
        state.selectPawn(pickSmartBotMove(state.game, state.legalMoves));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [
    screen,
    paused,
    simulation,
    simulationSpeed,
    vsAi,
    room?.online,
    room?.isHost,
    room?.myTeam,
    room?.seats,
    isAnimating,
    waitingRollAck,
    phase,
    currentTeam,
    turnDeadlineAt,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const state = useGameStore.getState();
      if (state.screen !== 'playing') return;

      if (event.key === 'Escape') {
        state.setPaused(!state.paused);
        return;
      }
      if (state.paused) return;

      if (event.key === 'r' || event.key === 'R') {
        state.triggerCameraReset();
        return;
      }
      if (!canLocalPlayerAct(state)) return;

      if (event.code === 'Space' && state.game.phase === 'ROLL') {
        if (target && target.tagName === 'BUTTON') return;
        event.preventDefault();
        state.rollDice();
        return;
      }

      if (state.game.phase === 'MOVE' && ['1', '2', '3', '4'].includes(event.key)) {
        const pawnId = `${state.game.currentTeam}-${Number(event.key) - 1}`;
        if (state.legalMoves.includes(pawnId)) {
          event.preventDefault();
          state.selectPawn(pawnId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Compact top-left dropdown menu for Pause, Restart, Camera Reset, Sound, Invite Link, and Quit to Home. */
function TopLeftGameMenu() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const simulation = useGameStore((s) => s.simulation);
  const simulationSpeed = useGameStore((s) => s.simulationSpeed);
  const setSimulationSpeed = useGameStore((s) => s.setSimulationSpeed);
  const room = useGameStore((s) => s.room);
  const setChatOpen = useGameStore((s) => s.setChatOpen);
  const balance = useWalletStore((s) => s.balance);
  const lastDelta = useWalletStore((s) => s.lastDelta);
  const muted = useSyncExternalStore(soundManager.subscribe, soundManager.isMuted);
  const inFullscreen = useSyncExternalStore(subscribeFullscreenChange, isInFullscreen, () => false);
  const fullscreenSupported = isFullscreenSupported();
  const setPaused = useGameStore((s) => s.setPaused);
  const resetGame = useGameStore((s) => s.resetGame);
  const triggerCameraReset = useGameStore((s) => s.triggerCameraReset);
  const exitToHome = useGameStore((s) => s.exitToHome);

  const [open, setOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [open]);

  if (screen !== 'playing') return <div style={{ gridArea: 'menu' }} />;

  const copyRoomInvite = async () => {
    if (!room || typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(buildRoomShareUrl(resolveShareBaseUrl(), room.code));
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1600);
    } catch {
      // Clipboard blocked cleanly ignored.
    }
  };

  return (
    <div ref={wrapRef} style={{ gridArea: 'menu' }} className="relative z-30 flex max-w-full flex-wrap items-center gap-1.5 sm:gap-2 landscape:w-max landscape:flex-nowrap self-start">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setChatOpen(false);
          setOpen((v) => !v);
        }}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white px-2.5 sm:px-3 text-xs font-bold tracking-wide whitespace-nowrap uppercase ${INK_BUTTON}`}
      >
        <MenuIcon className="size-4" />
        <span>Menu</span>
        <ChevronDownIcon className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <span
        aria-label={`Coin balance: ${balance}`}
        className={`relative flex min-h-9 shrink-0 items-center gap-1 rounded-xl bg-[#ffd875] px-2.5 text-xs font-extrabold whitespace-nowrap ${INK_BOX}`}
      >
        🪙 {balance.toLocaleString()}
        {lastDelta && lastDelta.amount > 0 && (
          <span
            key={lastDelta.id}
            className="rounded-full border border-ink bg-[#80ed99] px-1 text-[9px] font-extrabold text-ink motion-safe:animate-[pop-in_0.3s_ease-out]"
          >
            +{lastDelta.amount}
          </span>
        )}
      </span>

      {room && (() => {
        const humanSeats = room.seats.filter((s) => s.occupant === 'human');
        const onlineHumans = room.online ? humanSeats.filter((s) => s.connected).length : 0;
        return (
          <button
            type="button"
            onClick={copyRoomInvite}
            title="Copy room invite link"
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#a9f0ff] px-2 sm:px-2.5 font-mono text-[11px] font-bold whitespace-nowrap ${INK_BUTTON}`}
          >
            {copiedLink ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
            <span>{copiedLink ? 'Copied!' : formatRoomCode(room.code)}</span>
            {humanSeats.length > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border border-ink px-1.5 py-0 text-[10px] font-sans font-bold ${
                  room.online ? 'bg-[#d8f8e1] text-[#155d27]' : 'bg-[#ffd875] text-ink'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    room.online ? 'bg-[#2b9348] motion-safe:animate-pulse' : 'bg-[#e09f00]'
                  }`}
                />
                {onlineHumans}/{humanSeats.length}
              </span>
            )}
          </button>
        );
      })()}

      {room && !room.online && (
        <button
          type="button"
          onClick={retryMultiplayerConnection}
          title={room.statusNote ?? 'Reconnecting to live room'}
          className={`flex min-h-9 shrink-0 items-center gap-1 rounded-xl bg-[#ffd875] px-2.5 text-[11px] font-bold whitespace-nowrap uppercase ${INK_BUTTON}`}
        >
          <span>{room.status === 'connecting' ? 'Reconnecting…' : 'Reconnect'}</span>
        </button>
      )}

      {fullscreenSupported && !inFullscreen && (
        <button
          type="button"
          onClick={() => void requestGameFullscreen(true)}
          title="Enter Fullscreen"
          aria-label="Enter Fullscreen"
          className={`grid size-9 shrink-0 place-items-center rounded-xl bg-[#fff8f0] text-ink ${INK_BUTTON}`}
        >
          <FullscreenIcon className="size-4" />
        </button>
      )}

      {simulation && !room && (
        <div
          role="group"
          aria-label="Simulation speed"
          className="flex shrink-0 items-center gap-0.5 rounded-xl border-[3px] border-ink bg-white p-0.5 shadow-ink-sm"
        >
          {SIMULATION_SPEEDS.map((speed) => {
            const active = simulationSpeed === speed;
            return (
              <button
                key={speed}
                type="button"
                aria-pressed={active}
                onClick={() => setSimulationSpeed(speed)}
                className={`min-h-7 cursor-pointer rounded-lg px-1.5 sm:px-2 text-[11px] font-bold transition-colors ${
                  active ? 'bg-[#ffd875] text-ink' : 'text-ink/75 hover:bg-[#ffeef4]'
                }`}
              >
                {speed}x
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div
          role="menu"
          aria-label="Game options"
          className={`absolute top-11 left-0 flex w-52 flex-col gap-1.5 rounded-2xl bg-[#fff8f5] p-2 ${INK_BOX}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPaused(!paused);
              setOpen(false);
            }}
            className={`flex min-h-9 items-center gap-2 rounded-xl px-2.5 text-left text-xs font-bold ${INK_BUTTON} ${
              paused ? 'bg-[#ffd875]' : 'bg-white'
            }`}
          >
            {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
            <span>{paused ? 'Resume Game' : 'Pause Game'}</span>
          </button>

          {(!room?.online || room.isHost) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                resetGame();
                setOpen(false);
              }}
              className={`flex min-h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
            >
              <ResetIcon className="size-3.5" />
              <span>Restart Match</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              triggerCameraReset();
              setOpen(false);
            }}
            className={`flex min-h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
          >
            <CameraIcon className="size-3.5" />
            <span>Reset Camera (R)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={soundManager.toggleMute}
            className={`flex min-h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
          >
            <SoundIcon muted={muted} className="size-3.5" />
            <span>{muted ? 'Unmute Sound' : 'Mute Sound'}</span>
          </button>

          {fullscreenSupported && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void toggleGameFullscreen();
                setOpen(false);
              }}
              className={`flex min-h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
            >
              <FullscreenIcon exit={inFullscreen} className="size-3.5" />
              <span>{inFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
            </button>
          )}

          {room && (
            <button
              type="button"
              role="menuitem"
              onClick={copyRoomInvite}
              className={`flex min-h-9 items-center gap-2 rounded-xl bg-[#e0fbfc] px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
            >
              {copiedLink ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
              <span>{copiedLink ? 'Invite Copied!' : 'Copy Room Link'}</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setLegalOpen(true);
              setOpen(false);
            }}
            className={`flex min-h-9 items-center gap-2 rounded-xl bg-white px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
          >
            <span className="text-xs">📜</span>
            <span>Rules &amp; Privacy</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              exitToHome();
            }}
            className={`flex min-h-9 items-center gap-2 rounded-xl bg-[#ffe0ea] px-2.5 text-left text-xs font-bold ${INK_BUTTON}`}
          >
            <DoorExitIcon className="size-3.5" />
            <span>Quit to Home</span>
          </button>
        </div>
      )}

      {legalOpen && <LegalInfoModal onClose={() => setLegalOpen(false)} />}
    </div>
  );
}

function rankBadgeText(rank: number, total: number): string {
  if (rank === 1) return '👑 1st';
  if (rank === total && total > 1) return `🐢 ${rank}th`;
  if (rank === 2) return '🥈 2nd';
  if (rank === 3) return '🥉 3rd';
  return `#${rank}`;
}

function StatusBadge({ team }: { team: TeamId }) {
  const active = useGameStore((s) => s.game.activeTeams.includes(team));
  const isTurn = useGameStore((s) => s.game.currentTeam === team && s.game.phase !== 'GAME_OVER');
  const rankings = useGameStore((s) => s.game.rankings);
  const totalTeams = useGameStore((s) => s.game.activeTeams.length);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const anchorTeam = useGameStore((s) => getLocalAnchorTeam(s));
  const corner = getCornerSlotForTeam(team, anchorTeam);
  const home = useGameStore((s) => s.game.pawns.filter((p) => p.team === team && p.progress === HOME_PROGRESS).length);
  const yard = useGameStore((s) => s.game.pawns.filter((p) => p.team === team && p.progress === YARD_PROGRESS).length);
  const botName = useGameStore((s) => s.botNames[team]);
  const onRight = corner === 'tr' || corner === 'br';
  if (!active) return <div style={{ gridArea: corner }} />;

  const rankIndex = rankings.indexOf(team);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const seat = room ? room.seats.find((s) => s.team === team) : undefined;
  const isMe = Boolean(room && room.myTeam === team);
  const isBot = room ? (seat?.occupant === 'bot' || Boolean(seat?.botTakeover)) : vsAi && team !== 'PINK' && !botName;
  const isHumanSeat = Boolean(room && seat?.occupant === 'human');
  const isOnlineHuman = Boolean(isHumanSeat && (isMe ? room?.online && seat?.connected : seat?.connected));
  const displayName = seat?.playerName || botName || TEAM_LABELS[team];
  const isSpeaking = useVoiceStore((s) => Boolean(seat?.playerId && s.speakingIds[seat.playerId]));
  const presenceText = isHumanSeat ? (isOnlineHuman ? ', online' : ', offline') : '';
  const summary = `${displayName}${isMe ? ' (You)' : isBot ? ' (AI)' : ''}${presenceText}: ${home} of ${PAWNS_PER_TEAM} home, ${yard} in the yard${rank ? `, finished ${rank}` : isTurn ? ', current turn' : ''}`;
  return (
    <div
      style={{ gridArea: corner }}
      className={`flex items-center ${onRight ? 'justify-end' : 'justify-start'} landscape:justify-center ${
        corner === 'tl' || corner === 'tr' ? 'self-start' : 'self-end'
      }`}
    >
      <div
        role="status"
        aria-label={summary}
        className={`relative flex items-center gap-1.5 sm:gap-2 rounded-xl sm:rounded-2xl bg-white py-0.5 pr-2 pl-0.5 sm:py-1.5 sm:pr-3 sm:pl-1.5 transition-transform duration-200 ${INK_BOX} ${isTurn ? '-rotate-2 scale-105' : ''} ${isSpeaking ? 'ring-4 ring-[#80ed99]' : ''}`}
      >
        <span
          aria-hidden
          className="relative grid size-6 sm:size-9 place-items-center rounded-lg sm:rounded-xl border-2 sm:border-[3px] border-ink text-ink"
          style={{ backgroundColor: TEAM_COLORS[team] }}
        >
          <MascotIcon team={team} className="size-3.5 sm:size-5" />
          {isHumanSeat && (
            <span
              className={`absolute -right-1 -bottom-1 size-2.5 sm:size-3 rounded-full border-2 border-ink ${
                isOnlineHuman ? 'bg-[#38d969]' : 'bg-[#ffd875]'
              }`}
            />
          )}
        </span>
        <span aria-hidden className="min-w-0 leading-tight">
          <span className="flex items-center gap-1 text-[11px] sm:text-sm font-bold tracking-wide uppercase">
            <span className="max-w-20 sm:max-w-22 truncate">{displayName}</span>
            {isMe && <span className="rounded bg-[#80ed99] px-1 text-[9px] sm:text-[10px] font-bold">YOU</span>}
            {isBot && <span className="rounded bg-[#ffe0ea] px-1 text-[9px] sm:text-[10px] font-bold">AI</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5">
              <HomeIcon className="size-3 sm:size-3.5" />
              {home}/{PAWNS_PER_TEAM}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <YardIcon className="size-3 sm:size-3.5" />
              {yard}
            </span>
            {isHumanSeat && (
              <span
                className={`inline-flex items-center gap-1 rounded-full border border-ink px-1.5 py-0 text-[9px] sm:text-[10px] font-bold uppercase ${
                  isOnlineHuman ? 'bg-[#d8f8e1] text-[#155d27]' : 'bg-[#fff0c2] text-[#7c4d00]'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    isOnlineHuman ? 'bg-[#2b9348] motion-safe:animate-pulse' : 'bg-[#e09f00]'
                  }`}
                />
                {isOnlineHuman ? 'Online' : 'Offline'}
              </span>
            )}
          </span>
        </span>
        {rank !== null ? (
          <span
            aria-hidden
            className={`absolute -top-2.5 -right-1.5 rotate-6 rounded-md border-2 border-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-bold tracking-wider uppercase ${
              rank === 1 ? 'bg-[#ffd875] text-ink' : rank === totalTeams && totalTeams > 1 ? 'bg-[#ff8fab] text-ink' : 'bg-[#e8eef5] text-ink'
            }`}
          >
            {rankBadgeText(rank, totalTeams)}
          </span>
        ) : (
          isTurn && (
            <span aria-hidden className="absolute -top-2.5 -right-1.5 rotate-6 rounded-md bg-ink px-1.5 py-0.5 text-[10px] sm:text-xs font-bold tracking-wider text-white uppercase">
              Turn
            </span>
          )
        )}
      </div>
    </div>
  );
}

/** Numbered pawn chips shown during a human move so players can hover-preview or tap/key-pick any legal pawn. */
function QuickPawnChips({ className = '' }: { className?: string }) {
  const canAct = useGameStore((s) => canLocalPlayerAct(s) && s.game.phase === 'MOVE' && s.legalMoves.length > 0);
  const legalMoves = useGameStore((s) => s.legalMoves);
  const hoveredPawnId = useGameStore((s) => s.hoveredPawnId);
  const selectPawn = useGameStore((s) => s.selectPawn);
  const setHoveredPawn = useGameStore((s) => s.setHoveredPawn);

  if (!canAct) {
    return null;
  }

  return (
    <div role="group" aria-label="Quick select movable pawn" className={`flex flex-wrap gap-1 sm:gap-1.5 ${className}`}>
      {legalMoves.map((pawnId) => {
        const slot = Number(pawnId.split('-')[1]);
        const hovered = hoveredPawnId === pawnId;
        const char = CHARACTER_PROFILES[slot % CHARACTER_PROFILES.length];
        return (
          <button
            key={pawnId}
            type="button"
            onClick={() => selectPawn(pawnId)}
            onMouseEnter={() => setHoveredPawn(pawnId)}
            onMouseLeave={() => setHoveredPawn(null)}
            onFocus={() => setHoveredPawn(pawnId)}
            onBlur={() => setHoveredPawn(null)}
            title={`${char.name} (${char.role})`}
            className={`min-h-6 sm:min-h-7 cursor-pointer rounded-lg border-2 border-ink px-1.5 sm:px-2 text-[11px] sm:text-xs font-bold transition-transform hover:-translate-y-0.5 ${
              hovered ? 'bg-ink text-white' : 'bg-[#fff8f0] text-ink'
            }`}
          >
            {slot + 1} · {char.name}
          </button>
        );
      })}
    </div>
  );
}

function EmoteBar() {
  const sendEmote = useGameStore((s) => s.sendEmote);
  const emoteCooldownUntil = useGameStore((s) => s.emoteCooldownUntil);
  const yardEmotes = useGameStore((s) => s.yardEmotes);
  const paused = useGameStore((s) => s.paused);
  const screen = useGameStore((s) => s.screen);
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, emoteCooldownUntil - Date.now()));

  useEffect(() => {
    preloadEmoteMedia();
  }, []);

  useEffect(() => {
    const syncMedia = () => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      const activeIds = new Set(Object.values(useGameStore.getState().yardEmotes).map((e) => e.emote));
      syncActiveEmoteMedia(activeIds, hidden || paused || screen !== 'playing');
    };
    syncMedia();
    document.addEventListener('visibilitychange', syncMedia);
    return () => document.removeEventListener('visibilitychange', syncMedia);
  }, [yardEmotes, paused, screen]);

  useEffect(() => {
    const sync = () => setRemainingMs(Math.max(0, emoteCooldownUntil - Date.now()));
    sync();
    if (emoteCooldownUntil <= Date.now()) return;
    const timer = setInterval(sync, 100);
    return () => clearInterval(timer);
  }, [emoteCooldownUntil]);

  const balance = useWalletStore((s) => s.balance);
  const deductCoins = useWalletStore((s) => s.deduct);
  const coolingDown = remainingMs > 0;
  const secsLeft = Math.ceil(remainingMs / 1000);

  return (
    <div className="relative flex w-full items-center">
      <div
        role="group"
        aria-label="Send a reaction"
        className={`grid w-full grid-cols-8 gap-1 sm:gap-1.5 landscape:grid-cols-4 transition-opacity ${
          coolingDown ? 'opacity-50 grayscale' : ''
        }`}
      >
        {EMOTES.map(({ id, label, thumb }) => {
          const cost = getEmoteCost(id);
          const affordable = cost === 0 || balance >= cost;
          const disabled = coolingDown || !affordable;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              title={
                coolingDown
                  ? `Wait ${secsLeft}s before next reaction`
                  : !affordable
                    ? `Need ${cost} coins`
                    : cost > 0
                      ? `${label} (${cost} coins)`
                      : label
              }
              aria-label={`Send ${label} reaction${cost > 0 ? ` (${cost} coins)` : ''}`}
              onClick={() => {
                if (disabled) return;
                if (sendEmote(id)) {
                  if (cost > 0) deductCoins(cost);
                  playEmoteMedia(id);
                }
              }}
              className={`relative aspect-square w-full overflow-hidden rounded-md sm:rounded-lg border-2 border-ink bg-[#2b213a] p-0 shadow-[2px_2px_0px_#2b213a] transition-transform focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:-translate-y-0.5 active:scale-95'
              }`}
            >
              <img src={thumb} alt="" loading="eager" decoding="async" aria-hidden className="pointer-events-none size-full object-contain" />
              {cost > 0 && (
                <span className="pointer-events-none absolute right-0 bottom-0 rounded-tl bg-[#ffd875] px-1 text-[8px] leading-tight font-extrabold text-ink">
                  {cost}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {coolingDown && (
        <span
          aria-live="polite"
          className="pointer-events-none absolute -top-2 -right-1 rounded-full border-2 border-ink bg-[#ffd875] px-1.5 py-0 text-[10px] leading-tight font-bold text-ink shadow-ink-sm"
        >
          {secsLeft}s
        </span>
      )}
    </div>
  );
}

/** Bottom chat toggle, incoming-message popup toast, and keyboard-safe chat drawer. */
function BottomChatControl({ className = '' }: { className?: string }) {
  const room = useGameStore((s) => s.room);
  const vsAi = useGameStore((s) => s.vsAi);
  const hasNamedBots = useGameStore((s) => Object.keys(s.botNames).length > 0);
  const screen = useGameStore((s) => s.screen);
  const chatOpen = useGameStore((s) => s.chatOpen);
  const unreadChat = useGameStore((s) => s.unreadChat);
  const chatMessages = useGameStore((s) => s.chatMessages);
  const setChatOpen = useGameStore((s) => s.setChatOpen);

  const [toastChatId, setToastChatId] = useState<string | null>(null);
  const chatWrapRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const wasChatOpenRef = useRef(chatOpen);
  const lastSeenIdRef = useRef<string | null>(chatMessages[chatMessages.length - 1]?.id ?? null);
  const latestChat = chatMessages[chatMessages.length - 1] ?? null;

  useEffect(() => {
    if (wasChatOpenRef.current && !chatOpen) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    }
    wasChatOpenRef.current = chatOpen;
  }, [chatOpen]);

  useEffect(() => {
    if (!latestChat) return;
    const isNewMessage = lastSeenIdRef.current !== latestChat.id;
    lastSeenIdRef.current = latestChat.id;
    if (!isNewMessage || chatOpen) return;
    setToastChatId(latestChat.id);
    const timer = setTimeout(() => setToastChatId(null), 4500);
    return () => clearTimeout(timer);
  }, [latestChat?.id, chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    const handleOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (chatWrapRef.current?.contains(target) || drawerRef.current?.contains(target)) return;
      setChatOpen(false);
    };
    window.addEventListener('pointerdown', handleOutside);
    return () => window.removeEventListener('pointerdown', handleOutside);
  }, [chatOpen, setChatOpen]);

  if ((!room && !(vsAi && hasNamedBots)) || screen !== 'playing') return null;

  const showToast = !chatOpen && latestChat && toastChatId === latestChat.id;

  return (
    <>
      <div ref={chatWrapRef} className={`relative flex items-center ${className}`}>
        {showToast && (
          <button
            type="button"
            role="status"
            aria-label={`New message from ${latestChat.senderName}: ${latestChat.text}`}
            onClick={() => {
              setToastChatId(null);
              setChatOpen(true);
            }}
            className={`fixed right-3 bottom-[8.25rem] z-40 flex w-56 max-w-[calc(100vw-1.5rem)] sm:right-4 sm:bottom-4 sm:w-72 [@media(orientation:landscape)_and_(max-height:500px)]:right-2 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-2 [@media(orientation:landscape)_and_(max-height:500px)]:w-64 cursor-pointer flex-col gap-1 rounded-2xl bg-white p-2.5 text-left transition-transform hover:-translate-y-0.5 motion-safe:animate-[pop-in_0.25s_ease-out] ${INK_BOX}`}
          >
            <span className="flex items-center justify-between gap-2 text-[10px] font-bold tracking-wider uppercase">
              <span className="inline-flex items-center gap-1 text-[#ff3d6e]">
                <ChatIcon className="size-3" />
                New Message
              </span>
              <span
                className="max-w-28 truncate rounded-md border border-ink px-1.5 py-0.5 text-ink"
                style={{ backgroundColor: latestChat.team ? TEAM_COLORS[latestChat.team] : '#ffe0ea' }}
              >
                {latestChat.senderName}
              </span>
            </span>
            <span className="line-clamp-2 text-xs leading-snug font-bold text-ink">{latestChat.text}</span>
            <span className="text-[10px] font-semibold text-ink/60">Tap to open &amp; reply</span>
          </button>
        )}

        <button
          type="button"
          aria-expanded={chatOpen}
          aria-label="Toggle live chat"
          onClick={() => {
            setToastChatId(null);
            setChatOpen(!chatOpen);
          }}
          className={`relative flex min-h-7 sm:min-h-9 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-7 shrink-0 items-center gap-1 rounded-xl px-2 sm:px-2.5 [@media(orientation:landscape)_and_(max-height:500px)]:px-2 landscape:w-full landscape:justify-center text-xs font-bold whitespace-nowrap uppercase ${INK_BUTTON} ${
            chatOpen ? 'bg-ink text-white' : 'bg-[#ffd875] text-ink'
          }`}
        >
          <ChatIcon className="size-3.5" />
          <span>Chat</span>
          {unreadChat > 0 && !chatOpen && (
            <span className="grid min-w-4 place-items-center rounded-full bg-[#ff3d6e] px-1 text-[10px] font-bold text-white shadow-ink-sm">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
        </button>
      </div>

      {chatOpen && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-label="Live room chat"
          className={`fixed inset-x-3 top-14 z-40 flex max-h-[calc(100dvh-4.5rem)] flex-col gap-2 overflow-y-auto rounded-2xl bg-white p-2.5 select-text sm:inset-auto sm:right-4 sm:bottom-20 sm:w-80 [@media(orientation:landscape)_and_(max-height:500px)]:top-3 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-auto [@media(orientation:landscape)_and_(max-height:500px)]:right-3 ${INK_BOX}`}
        >
          <div className="flex items-center justify-between border-b-2 border-ink/10 pb-1">
            <span className="text-xs font-bold tracking-wider text-ink uppercase">Live Room Chat</span>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="cursor-pointer rounded-md px-1.5 text-xs font-bold text-ink/70 hover:bg-[#ffe0ea] hover:text-ink"
            >
              Close
            </button>
          </div>
          <VoiceChatPanel />
          <RoomChatBox />
        </div>
      )}
    </>
  );
}

/** The dialogue box: whose line it is, what just happened, quick pawn chips, the dice tray, and bottom chat. */
function DialogueDock() {
  const team = useGameStore((s) => s.game.currentTeam);
  const mode = useGameStore((s) => s.game.mode);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const simulation = useGameStore((s) => s.simulation);
  const notice = useGameStore((s) => s.notice);

  const seat = room ? room.seats.find((s) => s.team === team) : undefined;
  const botName = useGameStore((s) => s.botNames[team]);
  const displayName = seat?.playerName || botName || TEAM_LABELS[team];
  const isBotTurn = room
    ? (seat?.occupant === 'bot' || Boolean(seat?.botTakeover))
    : !simulation && vsAi && team !== 'PINK';
  const isWaitingDisconnected = Boolean(room && seat?.occupant === 'human' && !seat.connected && !seat.botTakeover);

  return (
    <section
      aria-label="Turn controls"
      style={{ gridArea: 'dock' }}
      className={`relative z-20 mt-1.5 sm:mt-2.5 landscape:mt-4 flex items-center gap-2 sm:gap-2.5 rounded-xl sm:rounded-2xl bg-white p-1.5 pt-2.5 sm:p-2 sm:pt-3.5 landscape:flex-col landscape:items-stretch landscape:gap-1.5 landscape:self-center [@media(orientation:landscape)_and_(max-height:500px)]:mt-4 [@media(orientation:landscape)_and_(max-height:500px)]:gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:p-1.5 [@media(orientation:landscape)_and_(max-height:500px)]:pt-3 ${INK_BOX}`}
    >
      <span
        className="absolute -top-2.5 sm:-top-3.5 left-2.5 sm:left-3 -skew-x-6 rounded-md border-2 sm:border-[3px] border-ink px-1.5 sm:px-2.5 py-0 sm:py-0.5 text-[10px] sm:text-xs font-bold tracking-wider whitespace-nowrap uppercase shadow-ink-sm"
        style={{ backgroundColor: TEAM_COLORS[team] }}
      >
        {displayName}
        {mode === '2V2_TEAM' && ` + ${TEAM_LABELS[PARTNER[team]]}`}
        {isBotTurn && !botName && ' (AI)'}
      </span>
      <DiceTray className="aspect-square size-[4.6rem] shrink-0 self-center sm:size-24 landscape:mx-auto landscape:size-20 [@media(orientation:landscape)_and_(max-height:500px)]:size-16" />
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1.5 gap-y-1 sm:gap-y-1.5 landscape:grid-cols-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-y-1">
        <p aria-live="polite" className="min-w-0 min-h-4 sm:min-h-6 [@media(orientation:landscape)_and_(max-height:500px)]:min-h-0 text-[11px] sm:text-sm leading-tight sm:leading-snug font-semibold">
          {isBotTurn
            ? `${seat?.botTakeover || botName ? displayName : `${TEAM_LABELS[team]} AI`} is playing…`
            : isWaitingDisconnected
              ? `Waiting for ${displayName} to reconnect… (AI takes over next turn)`
              : notice}
        </p>
        <QuickPawnChips className="col-span-2 landscape:col-span-1" />
        <div className="col-span-2 landscape:col-span-1">
          <EmoteBar />
        </div>
        <BottomChatControl className="col-start-2 row-start-1 justify-self-end landscape:col-start-1 landscape:row-auto landscape:w-full" />
      </div>
    </section>
  );
}

/** Transient comic callout banner floating over the top edge of the board for major plays. */
function EventBannerToast() {
  const lastBanner = useGameStore((s) => s.lastBanner);
  const [visibleId, setVisibleId] = useState<number | null>(null);

  useEffect(() => {
    if (!lastBanner) return;
    setVisibleId(lastBanner.id);
    const timer = setTimeout(() => setVisibleId(null), 2000);
    return () => clearTimeout(timer);
  }, [lastBanner]);

  if (!lastBanner || visibleId !== lastBanner.id) return null;

  const toneBg: Record<typeof lastBanner.tone, string> = {
    capture: 'bg-[#ff4d6d] text-white',
    home: 'bg-[#80ed99] text-ink',
    six: 'bg-[#ffc93c] text-ink',
    forfeit: 'bg-ink text-white',
  };

  return (
    <div className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
      <div
        className={`rounded-xl border-[3px] border-ink px-3.5 py-1 text-xs font-bold tracking-wider whitespace-nowrap uppercase shadow-ink-sm motion-safe:animate-[banner-pop_0.22s_ease-out] ${toneBg[lastBanner.tone]}`}
      >
        {lastBanner.text}
      </div>
    </div>
  );
}

function PauseOverlay() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const resetGame = useGameStore((s) => s.resetGame);
  const exitToHome = useGameStore((s) => s.exitToHome);

  if (screen !== 'playing' || !paused) return null;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/35 p-6 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        className={`flex w-full max-w-xs flex-col items-center gap-3 rounded-3xl bg-[#fff8f5] p-6 text-center motion-safe:animate-[pop-in_0.25s_ease-out] ${INK_BOX}`}
      >
        <h2 id="pause-title" className="text-2xl font-bold tracking-wide uppercase">
          Game Paused
        </h2>
        <button
          type="button"
          autoFocus
          onClick={() => setPaused(false)}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffd875] px-4 text-sm font-bold uppercase ${INK_BUTTON}`}
        >
          <PlayIcon className="size-3.5" />
          Resume Game
        </button>
        <button
          type="button"
          onClick={resetGame}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold uppercase ${INK_BUTTON}`}
        >
          <ResetIcon className="size-4" />
          Restart Match
        </button>
        <button
          type="button"
          onClick={exitToHome}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffe0ea] px-4 text-sm font-bold uppercase ${INK_BUTTON}`}
        >
          <DoorExitIcon className="size-4" />
          Quit to Home
        </button>
      </div>
    </div>
  );
}

interface PlacementMeta {
  badge: string;
  title: string;
  roast: string;
  cardBg: string;
  animClass: string;
}

function getPlacementMeta(rank: number, total: number, is2v2: boolean, isWinner: boolean): PlacementMeta {
  if (is2v2) {
    return isWinner
      ? {
          badge: '👑 1ST • CHAMPS',
          title: 'Victory Picnic!',
          roast: 'Dynamic duo toasted every marshmallow in VIP 🔥',
          cardBg: 'bg-[#fff2b2]',
          animClass: 'motion-safe:animate-[podium-cheer_0.95s_ease-in-out_infinite]',
        }
      : {
          badge: '💀 2ND • COOKED',
          title: 'Out-Rolled!',
          roast: 'Skill issue detected — cold marshmallows for this squad 😭',
          cardBg: 'bg-[#ffe0ea]',
          animClass: 'motion-safe:animate-[rage-wobble_0.48s_ease-in-out_infinite]',
        };
  }

  if (rank === 1) {
    return {
      badge: '👑 1ST PLACE',
      title: 'Picnic Royalty',
      roast: 'Main character energy! Too fast, too fur-ious 🔥',
      cardBg: 'bg-[#fff2b2]',
      animClass: 'motion-safe:animate-[podium-cheer_0.95s_ease-in-out_infinite]',
    };
  }
  if (rank === total && total > 1) {
    return {
      badge: `🐢 ${rank}TH • LAST`,
      title: 'Certified Board Warmer',
      roast: 'Still sightseeing on the track?! Have you tried rolling a 6? 💀',
      cardBg: 'bg-[#ffe0ea]',
      animClass: 'motion-safe:animate-[rage-wobble_0.48s_ease-in-out_infinite]',
    };
  }
  if (rank === 2) {
    return {
      badge: '🥈 2ND PLACE',
      title: 'Almost Gold!',
      roast: 'Missed 1st by THAT much — extra coffee earned ☕',
      cardBg: 'bg-[#e6f7ff]',
      animClass: '',
    };
  }
  return {
    badge: '🥉 3RD PLACE',
    title: 'Not Last!',
    roast: 'Beat the wooden spoon — cozy marshmallow secured 🏕️',
    cardBg: 'bg-[#ffecd9]',
    animClass: '',
  };
}

function WinnerOverlay() {
  const screen = useGameStore((s) => s.screen);
  const phase = useGameStore((s) => s.game.phase);
  const mode = useGameStore((s) => s.game.mode);
  const winners = useGameStore((s) => s.game.winners);
  const rankings = useGameStore((s) => s.game.rankings);
  const activeTeams = useGameStore((s) => s.game.activeTeams);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const stats = useGameStore((s) => s.stats);
  const matchStake = useGameStore((s) => s.matchStake);
  const matchSettled = useGameStore((s) => s.matchSettled);
  const markMatchSettled = useGameStore((s) => s.markMatchSettled);
  const creditCoins = useWalletStore((s) => s.credit);
  const resetGame = useGameStore((s) => s.resetGame);
  const exitToHome = useGameStore((s) => s.exitToHome);
  const [peeking, setPeeking] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const [doublingAd, setDoublingAd] = useState(false);
  const [closeNow, setCloseNow] = useState(() => Date.now());
  const endAdShownRef = useRef(false);

  const myTeam: TeamId | null = room?.online ? room.myTeam : vsAi ? 'PINK' : null;
  const is2v2 = mode === '2V2_TEAM';
  const iWon = Boolean(myTeam && winners.includes(myTeam));
  const myRank = myTeam ? rankings.indexOf(myTeam) + 1 : 0;
  const payout = calculatePlacementPayout(matchStake, activeTeams.length, myRank, winners.length, is2v2);

  useEffect(() => {
    if (phase !== 'GAME_OVER') {
      endAdShownRef.current = false;
      setPeeking(false);
      setDoubled(false);
      setDoublingAd(false);
    } else if (screen === 'playing' && !endAdShownRef.current) {
      endAdShownRef.current = true;
      void showInterstitialAd('match_complete');
    }
  }, [phase, screen]);

  useEffect(() => {
    if (screen === 'playing' && phase === 'GAME_OVER' && !matchSettled) {
      markMatchSettled();
      if (payout > 0) {
        creditCoins(payout);
        soundManager.playStarChime();
      }
    }
  }, [screen, phase, matchSettled, markMatchSettled, payout, creditCoins]);

  useEffect(() => {
    if (screen !== 'playing' || phase !== 'GAME_OVER' || !room?.online || !room.closeAt) return;
    setCloseNow(Date.now());
    const interval = setInterval(() => setCloseNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [screen, phase, room?.online, room?.closeAt]);

  if (screen !== 'playing' || phase !== 'GAME_OVER' || rankings.length === 0) return null;

  const closeRemainingSec =
    room?.online && room.closeAt ? Math.max(0, Math.ceil((room.closeAt - closeNow) / 1000)) : null;

  const iLostLast = Boolean(myTeam && !iWon && (is2v2 || (rankings.length > 1 && myTeam === rankings[rankings.length - 1])));

  const headerPill = iWon
    ? '👑 CERTIFIED PICNIC ROYALTY'
    : iLostLast
      ? '🤡 CERTIFIED BOARD WARMER'
      : '🏕️ FINAL PICNIC STANDINGS';
  const headline = iWon
    ? 'YOU COOKED EVERYONE!'
    : iLostLast
      ? 'YOU GOT COOKED! 💀'
      : `${winners.map((t) => TEAM_LABELS[t]).join(' & ')} ${winners.length > 1 ? 'WIN' : 'WINS'}!`;
  const subline = iWon
    ? 'Everyone else is still in traffic while you roast marshmallows by the fire.'
    : iLostLast
      ? 'Skill issue? The dice literally laughed at you. Run it back!'
      : 'Every animal’s fate is sealed — check the campfire vibes!';

  if (peeking) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <button
          type="button"
          onClick={() => setPeeking(false)}
          className={`pointer-events-auto flex items-center gap-2 rounded-full bg-[#ffd875] px-5 py-2 text-sm font-bold uppercase ${INK_BUTTON}`}
        >
          <TrophyIcon className="size-4" />
          Show Standings ({winners.map((t) => TEAM_LABELS[t]).join(' & ')} Won)
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="winner-title"
        className={`flex max-h-[92dvh] w-full max-w-md flex-col items-center gap-3 overflow-y-auto rounded-3xl bg-[#fff8f5] px-5 py-5 text-center motion-safe:animate-[pop-in_0.4s_ease-out] ${INK_BOX}`}
      >
        <div
          className={`inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-xs font-bold tracking-wider uppercase ${
            iLostLast ? 'bg-[#ff8fab]' : 'bg-[#ffc93c]'
          }`}
        >
          <TrophyIcon className="size-4" />
          {headerPill}
        </div>

        <div>
          <h2 id="winner-title" className="text-2xl font-bold tracking-wide uppercase sm:text-3xl">
            {headline}
          </h2>
          <p className="mt-0.5 text-xs font-semibold text-ink/75">{subline}</p>
        </div>

        {/* 1st / 2nd / 3rd / 4th Animated Podium List */}
        <ol aria-label="Final rankings" className="flex w-full flex-col gap-2 text-left">
          {rankings.map((team, idx) => {
            const rank = idx + 1;
            const meta = getPlacementMeta(rank, activeTeams.length, is2v2, winners.includes(team));
            const isMe = myTeam === team;
            const seat = room?.online ? room.seats.find((s) => s.team === team) : undefined;
            const botName = useGameStore.getState().botNames[team];
            const displayName = seat?.playerName || botName || TEAM_LABELS[team];
            return (
              <li
                key={team}
                className={`flex items-center gap-2.5 rounded-2xl border-[2.5px] border-ink px-3 py-2 shadow-ink-sm ${meta.cardBg} ${meta.animClass}`}
              >
                <span
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-ink"
                  style={{ backgroundColor: TEAM_COLORS[team] }}
                >
                  <MascotIcon team={team} className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md border border-ink bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase">
                      {meta.badge}
                    </span>
                    <span className="text-sm font-bold uppercase">{displayName}</span>
                    {isMe && <span className="rounded bg-[#80ed99] px-1 text-[10px] font-bold">YOU</span>}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight font-semibold text-ink/80">{meta.roast}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex gap-4 rounded-2xl border-2 border-ink/20 bg-white px-5 py-1.5 text-xs font-bold uppercase">
          <div>
            <span className="block text-sm">{stats.turns}</span>
            Rolls
          </div>
          <div>
            <span className="block text-sm">{stats.captures}</span>
            Captures
          </div>
          <div>
            <span className="block text-sm">{stats.sixes}</span>
            Sixes
          </div>
        </div>

        {payout > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-full border-2 border-ink bg-[#80ed99] px-3 py-1 text-xs font-bold">
              🪙 +{doubled ? payout * 2 : payout} Coins Won!
            </span>
            {!doubled && (
              <button
                type="button"
                disabled={doublingAd}
                onClick={async () => {
                  setDoublingAd(true);
                  const ok = await showRewardedAd();
                  setDoublingAd(false);
                  if (ok) {
                    creditCoins(payout);
                    setDoubled(true);
                  }
                }}
                className={`rounded-full bg-[#ffd875] px-3 py-1 text-xs font-bold uppercase disabled:opacity-60 ${INK_BUTTON}`}
              >
                {doublingAd ? 'Loading Ad…' : `Watch Ad for 2x (+${payout} 🪙)`}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" autoFocus onClick={resetGame} className={`min-h-10 rounded-full bg-[#ff8fab] px-5 text-sm font-bold tracking-wide uppercase ${INK_BUTTON}`}>
            Play Again
          </button>
          <button type="button" onClick={() => setPeeking(true)} className={`min-h-10 rounded-full bg-[#a9f0ff] px-4 text-sm font-bold tracking-wide uppercase ${INK_BUTTON}`}>
            View Picnic
          </button>
          <button type="button" onClick={exitToHome} className={`min-h-10 rounded-full bg-white px-4 text-sm font-bold tracking-wide uppercase ${INK_BUTTON}`}>
            Home
          </button>
        </div>

        {closeRemainingSec !== null && (
          <p className="rounded-full border-2 border-ink/25 bg-[#fff0f5] px-3 py-0.5 text-[11px] font-bold text-ink/75">
            Room closes automatically in {closeRemainingSec}s
          </p>
        )}
      </div>
    </div>
  );
}

/** Vibrates mobile devices on turn arrival and replaces camera shake with subtle event haptics. */
function useTurnAndEventHaptics() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const simulation = useGameStore((s) => s.simulation);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const phase = useGameStore((s) => s.game.phase);
  const currentTeam = useGameStore((s) => s.game.currentTeam);
  const lastEvent = useGameStore((s) => s.lastEvent);
  const lastTurnTeamRef = useRef<TeamId | null>(null);

  useEffect(() => {
    if (screen !== 'playing') {
      lastTurnTeamRef.current = null;
      return;
    }
    if (paused || simulation || phase === 'GAME_OVER') return;

    const canRollNow =
      !isAnimating &&
      phase === 'ROLL' &&
      canLocalPlayerAct({
        screen,
        paused,
        simulation,
        vsAi,
        isAnimating,
        game: useGameStore.getState().game,
        room,
      });

    if (lastTurnTeamRef.current === null) {
      if (room?.online && canRollNow) triggerHaptic('MY_TURN');
      lastTurnTeamRef.current = currentTeam;
      return;
    }

    if (lastTurnTeamRef.current !== currentTeam) {
      if (canRollNow) {
        triggerHaptic('MY_TURN');
        useGameStore.getState().triggerCameraReset();
        lastTurnTeamRef.current = currentTeam;
      } else if (!canLocalPlayerAct({ screen, paused, simulation, vsAi, isAnimating: false, game: useGameStore.getState().game, room })) {
        // Track opponent turn changes cleanly so returning to the local player's roll always triggers haptic.
        lastTurnTeamRef.current = currentTeam;
      }
    }
  }, [screen, paused, simulation, vsAi, room, isAnimating, phase, currentTeam]);

  useEffect(() => {
    if (!lastEvent || screen !== 'playing' || paused || simulation) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (lastEvent.type === 'CAPTURE') {
      timer = setTimeout(() => triggerHaptic('CAPTURE'), (CAPTURE_GRAB_DURATION + CAPTURE_TWIRL_DURATION) * 1000);
    } else if (lastEvent.type === 'SPAWN_6') {
      timer = setTimeout(() => triggerHaptic('SPAWN_6'), SPAWN_DURATION * 1000);
    } else if (lastEvent.type === 'REACH_HOME') {
      triggerHaptic('REACH_HOME');
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [lastEvent, screen, paused, simulation]);
}

/** Blocks iOS Safari gesture zoom and multi-finger pinch zoom across the game viewport so dice/UI never misalign. */
function usePreventPinchZoom() {
  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault();
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    document.addEventListener('gesturestart', preventDefault, { passive: false });
    document.addEventListener('gesturechange', preventDefault, { passive: false });
    document.addEventListener('gestureend', preventDefault, { passive: false });
    document.addEventListener('touchstart', onTouch, { passive: false });
    document.addEventListener('touchmove', onTouch, { passive: false });
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', preventDefault);
      document.removeEventListener('gesturechange', preventDefault);
      document.removeEventListener('gestureend', preventDefault);
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('touchmove', onTouch);
      document.removeEventListener('wheel', onWheel);
    };
  }, []);
}

export function AnimeHUD({ children }: { children: ReactNode }) {
  useAutomationAndShortcuts();
  useTurnAndEventHaptics();
  usePreventPinchZoom();
  return (
    <main className="hud-grid relative select-none">
      <TopLeftGameMenu />
      <StatusBadge team="PINK" />
      <StatusBadge team="CYAN" />
      <div style={{ gridArea: 'board' }} className="relative -mx-1 min-h-0 min-w-0 sm:mx-0">
        <div className="absolute inset-0">{children}</div>
        <EventBannerToast />
      </div>
      <StatusBadge team="MINT" />
      <StatusBadge team="YELLOW" />
      <DialogueDock />
      <PauseOverlay />
      <WinnerOverlay />
      <HomeLobbyModal />
    </main>
  );
}
