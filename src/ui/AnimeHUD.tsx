/**
 * Visual-novel style HUD: ink-outlined panels with hard offset shadows around the 3D board.
 * Features the homepage setup pop-up, a compact top-left game menu dropdown (Pause, Restart,
 * Camera Reset, Sound, Room Invite, Quit to Home), and mouse/touch/keyboard gameplay controls.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import gsap from 'gsap';
import { HOME_PROGRESS, PAWNS_PER_TEAM, TEAM_COLORS, TEAM_LABELS, YARD_PROGRESS, type TeamId } from '../engine/boardMap';
import { canLocalPlayerAct, useGameStore } from '../engine/gameStore';
import { pickSmartBotMove } from '../engine/ludoRules';
import { buildRoomShareUrl, formatRoomCode, resolveShareBaseUrl } from '../engine/roomCode';
import { DiceTray } from '../scene/Dice3D';
import { CHARACTER_PROFILES } from '../scene/ChibiFigure';
import { EMOTES, emitEffect } from '../scene/effects/AnimeEffects';
import { soundManager } from '../utils/soundManager';
import { HomeLobbyModal } from './HomeLobbyModal';
import {
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  DoorExitIcon,
  HistoryIcon,
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
const GRID_AREA: Record<TeamId, string> = { PINK: 'pink', CYAN: 'cyan', YELLOW: 'yellow', MINT: 'mint' };

/** How much faster animations run while simulation mode is active. */
const SIMULATION_SPEED = 4;
const SIMULATION_STEP_MS = 80;
const AI_ROLL_DELAY_MS = 360;
const AI_MOVE_DELAY_MS = 420;

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BUTTON =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** Drives simulation mode, AI opponent turns, and keyboard shortcuts while actively playing & unpaused. */
function useAutomationAndShortcuts() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const simulation = useGameStore((s) => s.simulation);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const phase = useGameStore((s) => s.game.phase);
  const currentTeam = useGameStore((s) => s.game.currentTeam);

  useEffect(() => {
    const activeSim = screen === 'playing' && !paused && simulation;
    gsap.globalTimeline.timeScale(activeSim ? SIMULATION_SPEED : 1);
    return () => {
      gsap.globalTimeline.timeScale(1);
    };
  }, [screen, paused, simulation]);

  useEffect(() => {
    if (screen !== 'playing' || paused || isAnimating || phase === 'GAME_OVER') return;

    if (simulation) {
      const timer = setTimeout(() => {
        const state = useGameStore.getState();
        if (state.paused || state.screen !== 'playing') return;
        if (state.game.phase === 'ROLL') state.rollDice();
        else if (state.legalMoves.length > 0) {
          state.selectPawn(state.legalMoves[Math.floor(Math.random() * state.legalMoves.length)]);
        }
      }, SIMULATION_STEP_MS);
      return () => clearTimeout(timer);
    }

    const onlineBotTurn =
      Boolean(room?.online && room.isHost && room.seats.find((s) => s.team === currentTeam)?.occupant === 'bot');
    const localBotTurn = !room?.online && vsAi && currentTeam !== 'PINK';
    if (onlineBotTurn || localBotTurn) {
      const delay = phase === 'ROLL' ? AI_ROLL_DELAY_MS : AI_MOVE_DELAY_MS;
      const timer = setTimeout(() => {
        const state = useGameStore.getState();
        if (state.paused || state.screen !== 'playing') return;
        if (state.game.phase === 'ROLL') state.rollDice();
        else if (state.legalMoves.length > 0) state.selectPawn(pickSmartBotMove(state.game, state.legalMoves));
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [screen, paused, simulation, vsAi, room, isAnimating, phase, currentTeam]);

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
  const room = useGameStore((s) => s.room);
  const muted = useSyncExternalStore(soundManager.subscribe, soundManager.isMuted);
  const setPaused = useGameStore((s) => s.setPaused);
  const resetGame = useGameStore((s) => s.resetGame);
  const triggerCameraReset = useGameStore((s) => s.triggerCameraReset);
  const exitToHome = useGameStore((s) => s.exitToHome);

  const [open, setOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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
    <div ref={wrapRef} style={{ gridArea: 'menu' }} className="relative z-30 flex w-max items-center gap-2 self-start">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold tracking-wide whitespace-nowrap uppercase ${INK_BUTTON}`}
      >
        <MenuIcon className="size-4" />
        <span>Menu</span>
        <ChevronDownIcon className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {room && (
        <button
          type="button"
          onClick={copyRoomInvite}
          title="Copy room invite link"
          className={`flex min-h-9 shrink-0 items-center gap-1 rounded-xl bg-[#a9f0ff] px-2.5 font-mono text-[11px] font-bold whitespace-nowrap ${INK_BUTTON}`}
        >
          {copiedLink ? <CheckIcon className="size-3.5" /> : <LinkIcon className="size-3.5" />}
          <span>{copiedLink ? 'Copied Link!' : formatRoomCode(room.code)}</span>
        </button>
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
  const home = useGameStore((s) => s.game.pawns.filter((p) => p.team === team && p.progress === HOME_PROGRESS).length);
  const yard = useGameStore((s) => s.game.pawns.filter((p) => p.team === team && p.progress === YARD_PROGRESS).length);
  const onRight = team === 'CYAN' || team === 'YELLOW';
  if (!active) return <div style={{ gridArea: GRID_AREA[team] }} />;

  const rankIndex = rankings.indexOf(team);
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;
  const seat = room?.online ? room.seats.find((s) => s.team === team) : undefined;
  const isMe = Boolean(room?.online && room.myTeam === team);
  const isBot = room?.online ? seat?.occupant === 'bot' : vsAi && team !== 'PINK';
  const summary = `${TEAM_LABELS[team]}${isMe ? ' (You)' : isBot ? ' (AI)' : ''}: ${home} of ${PAWNS_PER_TEAM} home, ${yard} in the yard${rank ? `, finished ${rank}` : isTurn ? ', current turn' : ''}`;
  return (
    <div style={{ gridArea: GRID_AREA[team] }} className={`flex ${onRight ? 'justify-end' : 'justify-start'} landscape:justify-center`}>
      <div
        role="status"
        aria-label={summary}
        className={`relative flex items-center gap-2 rounded-2xl bg-white py-1.5 pr-3 pl-1.5 transition-transform duration-200 ${INK_BOX} ${isTurn ? '-rotate-2 scale-105' : ''}`}
      >
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-xl border-[3px] border-ink text-ink"
          style={{ backgroundColor: TEAM_COLORS[team] }}
        >
          <MascotIcon team={team} className="size-5" />
        </span>
        <span aria-hidden className="leading-tight">
          <span className="flex items-center gap-1 text-sm font-bold tracking-wide uppercase">
            {TEAM_LABELS[team]}
            {isMe && <span className="rounded bg-[#80ed99] px-1 text-[10px] font-bold">YOU</span>}
            {isBot && <span className="rounded bg-[#ffe0ea] px-1 text-[10px] font-bold">AI</span>}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs font-semibold whitespace-nowrap">
            <span className="inline-flex items-center gap-0.5">
              <HomeIcon className="size-3.5" />
              {home}/{PAWNS_PER_TEAM}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <YardIcon className="size-3.5" />
              {yard}
            </span>
          </span>
        </span>
        {rank !== null ? (
          <span
            aria-hidden
            className={`absolute -top-3 -right-2 rotate-6 rounded-md border-2 border-ink px-1.5 py-0.5 text-[11px] font-bold tracking-wider uppercase ${
              rank === 1 ? 'bg-[#ffd875] text-ink' : rank === totalTeams && totalTeams > 1 ? 'bg-[#ff8fab] text-ink' : 'bg-[#e8eef5] text-ink'
            }`}
          >
            {rankBadgeText(rank, totalTeams)}
          </span>
        ) : (
          isTurn && (
            <span aria-hidden className="absolute -top-3 -right-2 rotate-6 rounded-md bg-ink px-1.5 py-0.5 text-xs font-bold tracking-wider text-white uppercase">
              Turn
            </span>
          )
        )}
      </div>
    </div>
  );
}

/** Numbered pawn chips shown during a human move so players can hover-preview or tap/key-pick any legal pawn. */
function QuickPawnChips() {
  const canAct = useGameStore((s) => canLocalPlayerAct(s) && s.game.phase === 'MOVE' && s.legalMoves.length > 0);
  const legalMoves = useGameStore((s) => s.legalMoves);
  const hoveredPawnId = useGameStore((s) => s.hoveredPawnId);
  const selectPawn = useGameStore((s) => s.selectPawn);
  const setHoveredPawn = useGameStore((s) => s.setHoveredPawn);

  if (!canAct) {
    return null;
  }

  return (
    <div role="group" aria-label="Quick select movable pawn" className="flex flex-wrap gap-1.5">
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
            className={`min-h-7 cursor-pointer rounded-lg border-2 border-ink px-2 text-xs font-bold transition-transform hover:-translate-y-0.5 ${
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
  return (
    <div role="group" aria-label="Send a sticker" className="flex justify-center gap-1.5">
      {EMOTES.map(({ id, emoji, label }) => (
        <button
          key={id}
          type="button"
          aria-label={`Send ${label} sticker`}
          onClick={() => {
            if (!sendEmote(id)) emitEffect({ type: 'emote', emote: id });
          }}
          className={`grid size-9 place-items-center rounded-full bg-[#fff8f0] text-base landscape:size-8 ${INK_BUTTON}`}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
    </div>
  );
}

function MoveLog({ open }: { open: boolean }) {
  const log = useGameStore((s) => s.log);
  if (!open || log.length === 0) return null;
  return (
    <ol aria-label="Recent moves" className="sim-log max-h-20 overflow-y-auto rounded-lg border-2 border-ink/20 bg-[#fff8f0] px-2 py-1 text-[11px] leading-snug font-medium">
      {log.slice(-5).map((entry, i) => (
        <li key={`${log.length - i}-${entry}`} className="truncate">
          {entry}
        </li>
      ))}
    </ol>
  );
}

/** The dialogue box: whose line it is, what just happened, quick pawn chips, and the dice tray. */
function DialogueDock() {
  const team = useGameStore((s) => s.game.currentTeam);
  const mode = useGameStore((s) => s.game.mode);
  const vsAi = useGameStore((s) => s.vsAi);
  const simulation = useGameStore((s) => s.simulation);
  const notice = useGameStore((s) => s.notice);
  const [showLog, setShowLog] = useState(false);

  const isBotTurn = !simulation && vsAi && team !== 'PINK';
  const effectiveShowLog = simulation || showLog;

  return (
    <section
      aria-label="Turn controls"
      style={{ gridArea: 'dock' }}
      className={`relative flex items-stretch gap-3 rounded-2xl bg-white p-2.5 pt-5 landscape:flex-col landscape:gap-2 landscape:self-center ${INK_BOX}`}
    >
      <span
        className="absolute -top-4 left-3 -skew-x-6 rounded-md border-[3px] border-ink px-2.5 py-0.5 text-sm font-bold tracking-wider whitespace-nowrap uppercase shadow-ink-sm"
        style={{ backgroundColor: TEAM_COLORS[team] }}
      >
        {TEAM_LABELS[team]}
        {mode === '2V2_TEAM' && ` + ${TEAM_LABELS[PARTNER[team]]}`}
        {isBotTurn && ' (AI)'}
      </span>
      <button
        type="button"
        aria-pressed={effectiveShowLog}
        aria-label="Toggle move history"
        title="Toggle move history"
        onClick={() => setShowLog((v) => !v)}
        className={`absolute -top-3.5 right-2 grid size-7 cursor-pointer place-items-center rounded-md border-2 border-ink text-xs shadow-ink-sm ${
          effectiveShowLog ? 'bg-ink text-white' : 'bg-white text-ink'
        }`}
      >
        <HistoryIcon className="size-3.5" />
      </button>
      <DiceTray className="aspect-square w-28 shrink-0 landscape:mx-auto landscape:w-full landscape:max-w-32" />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <p aria-live="polite" className="min-h-9 text-sm leading-snug font-semibold">
          {isBotTurn ? `${TEAM_LABELS[team]} AI is thinking…` : notice}
        </p>
        <QuickPawnChips />
        <MoveLog open={effectiveShowLog} />
        <EmoteBar />
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
  const resetGame = useGameStore((s) => s.resetGame);
  const exitToHome = useGameStore((s) => s.exitToHome);
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    if (phase !== 'GAME_OVER') setPeeking(false);
  }, [phase]);

  if (screen !== 'playing' || phase !== 'GAME_OVER' || rankings.length === 0) return null;

  const myTeam: TeamId | null = room?.online ? room.myTeam : vsAi ? 'PINK' : null;
  const is2v2 = mode === '2V2_TEAM';
  const iWon = Boolean(myTeam && winners.includes(myTeam));
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
                    <span className="text-sm font-bold uppercase">{TEAM_LABELS[team]}</span>
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
      </div>
    </div>
  );
}

export function AnimeHUD({ children }: { children: ReactNode }) {
  useAutomationAndShortcuts();
  return (
    <main className="hud-grid relative select-none">
      <TopLeftGameMenu />
      <StatusBadge team="PINK" />
      <StatusBadge team="CYAN" />
      <div style={{ gridArea: 'board' }} className="relative min-h-0 min-w-0">
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
