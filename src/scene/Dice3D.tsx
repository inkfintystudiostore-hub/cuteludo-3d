/**
 * The 3D die. It lives in its own small canvas inside a button, so it sits in the HUD beside
 * the board rather than on it, and clicking (or pressing Enter on) the tray rolls it. A roll
 * tosses the die up, tumbles it, and lands it with the rolled face pointing straight up.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TEAM_COLORS, TEAM_LABELS } from '../engine/boardMap';
import { canLocalPlayerAct, useGameStore } from '../engine/gameStore';
import { soundManager } from '../utils/soundManager';
import { DICE_AIR_TIME } from './animationTiming';
import { useIsMobileGpu } from './deviceProfile';
import { emitEffect } from './effects/AnimeEffects';
import { INK, heartPath, starPath } from './effects/canvasShapes';
import { createAnimeToonMaterial } from './shaders/animeToonMaterial';

const SIZE = 1;
const TAU = Math.PI * 2;
const TOSS_HEIGHT = 1.15;
const HIT_STOP = 0.035;

/** Value painted on each box face, in BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z. */
const FACE_VALUES = [2, 5, 1, 6, 3, 4];

/** Cube rotation [x, z] that turns each value's face to +Y. */
const FACE_UP: Record<number, [number, number]> = {
  1: [0, 0],
  6: [Math.PI, 0],
  2: [0, Math.PI / 2],
  5: [0, -Math.PI / 2],
  3: [-Math.PI / 2, 0],
  4: [Math.PI / 2, 0],
};

const PIP_COLORS: Record<number, [fill: string, shade: string]> = {
  2: ['#72dfe0', '#3fa9b5'],
  3: ['#80ed99', '#45b56a'],
  4: ['#ffc857', '#e0962a'],
  5: ['#c9a7ff', '#9370db'],
};

/** Pip centres as fractions of the face. Every face shows as many marks as its value. */
const PIP_LAYOUT: Record<number, [number, number][]> = {
  2: [[0.3, 0.3], [0.7, 0.7]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.3, 0.25], [0.7, 0.25], [0.3, 0.5], [0.7, 0.5], [0.3, 0.75], [0.7, 0.75]],
};

function makeFaceTexture(value: number): THREE.CanvasTexture {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fffaf3';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#ffc9da';
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.roundRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8, s * 0.14);
  ctx.stroke();

  ctx.lineJoin = 'round';
  if (value === 1) {
    // One glowing pink heart.
    const gradient = ctx.createLinearGradient(0, s * 0.25, 0, s * 0.75);
    gradient.addColorStop(0, '#ff9ebb');
    gradient.addColorStop(1, '#ff4d7e');
    ctx.shadowColor = '#ff6f9c';
    ctx.shadowBlur = s * 0.14;
    heartPath(ctx, s / 2, s / 2, s * 0.27);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.fill(); // second pass thickens the glow
    ctx.shadowBlur = 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.028;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(s * 0.39, s * 0.4, s * 0.05, s * 0.032, -0.6, 0, TAU);
    ctx.fill();
  } else if (value === 6) {
    // Six golden stars, so the lucky face still counts out as a six.
    const gradient = ctx.createLinearGradient(0, s * 0.15, 0, s * 0.85);
    gradient.addColorStop(0, '#ffe58a');
    gradient.addColorStop(1, '#ffb11b');
    for (const [px, py] of PIP_LAYOUT[6]) {
      ctx.shadowColor = '#ffc93c';
      ctx.shadowBlur = s * 0.07;
      starPath(ctx, px * s, py * s + s * 0.008, s * 0.115, s * 0.055);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = INK;
      ctx.lineWidth = s * 0.018;
      ctx.stroke();
    }
  } else {
    const [fill, shade] = PIP_COLORS[value];
    const radius = s * 0.085;
    for (const [px, py] of PIP_LAYOUT[value]) {
      ctx.beginPath();
      ctx.arc(px * s, py * s, radius, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = shade;
      ctx.lineWidth = s * 0.022;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(px * s - radius * 0.3, py * s - radius * 0.35, radius * 0.26, 0, TAU);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

function Die() {
  const groupRef = useRef<THREE.Group>(null);
  const cubeRef = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);

  const activeRoll = useGameStore((s) => s.activeRoll);
  const waitingRollAck = useGameStore((s) => s.waitingRollAck);
  const dice = useGameStore((s) => s.game.dice);
  const canRoll = useGameStore((s) => s.game.phase === 'ROLL' && !s.isAnimating && !s.waitingRollAck);
  const completeRoll = useGameStore((s) => s.completeRoll);

  const geometry = useMemo(() => new RoundedBoxGeometry(SIZE, SIZE, SIZE, 3, SIZE * 0.17), []);
  const materials = useMemo(
    () => FACE_VALUES.map((value) => createAnimeToonMaterial({ map: makeFaceTexture(value), rimColor: '#ff8fab', rimStrength: 0.25 })),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
    [geometry, materials],
  );

  useEffect(() => {
    if (waitingRollAck && !activeRoll) {
      soundManager.playDiceTap();
    }
  }, [waitingRollAck, activeRoll]);

  // Snap the resting die to its authoritative face if an animation was interrupted or watchdog-resolved.
  useEffect(() => {
    if (activeRoll || waitingRollAck || dice === null) return;
    const cube = cubeRef.current;
    const face = FACE_UP[dice];
    if (!cube || !face) return;
    cube.rotation.set(face[0], 0, face[1]);
    cube.scale.setScalar(1);
  }, [activeRoll, waitingRollAck, dice]);

  // Toss and tumble for a roll, then report back so the rules can apply the value.
  useEffect(() => {
    if (!activeRoll) return;
    const group = groupRef.current!;
    const cube = cubeRef.current!;
    const [faceX, faceZ] = FACE_UP[activeRoll.value];
    const startY = group.position.y;
    const upDuration = DICE_AIR_TIME * 0.42;
    const downDuration = DICE_AIR_TIME - upDuration;

    cube.rotation.set(((cube.rotation.x % TAU) + TAU) % TAU, 0, ((cube.rotation.z % TAU) + TAU) % TAU);
    cube.scale.setScalar(1);
    soundManager.playDiceRoll(DICE_AIR_TIME);

    const timeline = gsap
      .timeline({ onComplete: () => completeRoll(activeRoll.id) })
      .fromTo(group.position, { y: startY }, { y: TOSS_HEIGHT, duration: upDuration, ease: 'power2.out' }, 0)
      .to(group.position, { y: 0, duration: downDuration, ease: 'power2.in' }, upDuration)
      // Whole extra turns on every axis; the remainder leaves the rolled face on top.
      .to(cube.rotation, { x: faceX + TAU * 2, y: TAU, z: faceZ + TAU, duration: DICE_AIR_TIME, ease: 'power2.out' }, 0)
      .to(cube.scale, { x: 1.16, y: 0.8, z: 1.16, duration: 0.04, ease: 'power1.out' }, DICE_AIR_TIME)
      .to(cube.scale, { x: 1, y: 1, z: 1, duration: 0.12, ease: 'back.out(3)' }, DICE_AIR_TIME + 0.04);

    if (activeRoll.value === 6) {
      timeline
        .to({}, { duration: HIT_STOP }) // crisp beat before the 6 payoff
        .call(() => {
          emitEffect({ type: 'sparkle', x: 0, z: 0, y: 1.6 });
          soundManager.playStarChime();
        })
        .to(cube.scale, { x: 1.26, y: 1.26, z: 1.26, duration: 0.05, ease: 'power2.out' })
        .to(cube.scale, { x: 1, y: 1, z: 1, duration: 0.13, ease: 'back.out(3)' });
    }

    return () => {
      // Also runs when a new game interrupts a roll: put the die back on the tray.
      timeline.kill();
      group.position.y = 0;
      cube.scale.setScalar(1);
    };
  }, [activeRoll, completeRoll]);

  useFrame(({ clock }, rawDelta) => {
    const cube = cubeRef.current;
    const group = groupRef.current;
    const shadow = shadowRef.current;
    if (!cube || !group || !shadow) return;
    const dt = Math.min(rawDelta, 0.05);
    if (waitingRollAck && !activeRoll) {
      // Instant anticipation spin while waiting for live server roll confirmation.
      const liftAlpha = 1 - Math.exp(-18 * dt);
      group.position.y += (0.65 - group.position.y) * liftAlpha;
      cube.position.y += (0 - cube.position.y) * liftAlpha;
      cube.rotation.x += dt * 16;
      cube.rotation.z += dt * 11;
    } else if (!activeRoll) {
      // An inviting bob while the die is waiting to be thrown.
      const alpha = 1 - Math.exp(-14 * dt);
      group.position.y += (0 - group.position.y) * alpha;
      const bob = canRoll ? 0.12 + Math.sin(clock.elapsedTime * 3.6) * 0.075 : 0;
      cube.position.y += (bob - cube.position.y) * alpha;
    }
    // The contact shadow shrinks and fades as the die leaves the tray.
    const lift = group.position.y + cube.position.y;
    const spread = 1 - Math.min(lift / (TOSS_HEIGHT * 1.6), 0.6);
    shadow.scale.setScalar(spread);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.22 * spread;
  });

  return (
    <>
      <mesh ref={shadowRef} position-y={-SIZE / 2 + 0.01} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.72, 32]} />
        <meshBasicMaterial color={INK} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <group ref={groupRef}>
        <mesh ref={cubeRef} geometry={geometry} material={materials} />
      </group>
    </>
  );
}

/** Requests one demand frame when static die state updates while resting. */
function DiceFrameInvalidator({ dice, team }: { dice: number | null; team: string }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [dice, team, invalidate]);
  return null;
}

/** The dice tray: a button holding the 3D die. Sits in the HUD, never on the board. */
export function DiceTray({ className = '' }: { className?: string }) {
  const mobile = useIsMobileGpu();
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const simulation = useGameStore((s) => s.simulation);
  const vsAi = useGameStore((s) => s.vsAi);
  const room = useGameStore((s) => s.room);
  const phase = useGameStore((s) => s.game.phase);
  const team = useGameStore((s) => s.game.currentTeam);
  const dice = useGameStore((s) => s.game.dice);
  const sixStreak = useGameStore((s) => s.game.sixStreak);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const turnDeadlineAt = useGameStore((s) => s.turnDeadlineAt);
  const rolling = useGameStore((s) => s.activeRoll !== null || s.waitingRollAck);
  const canRoll = useGameStore((s) => s.game.phase === 'ROLL' && !s.waitingRollAck && canLocalPlayerAct(s));
  const rollDice = useGameStore((s) => s.rollDice);

  const [settling, setSettling] = useState(false);
  const needsContinuousFrames = screen === 'playing' && !paused && (rolling || canRoll);

  useEffect(() => {
    if (needsContinuousFrames) {
      setSettling(true);
      return;
    }
    const timer = setTimeout(() => setSettling(false), 650);
    return () => clearTimeout(timer);
  }, [needsContinuousFrames]);

  const seat = room ? room.seats.find((s) => s.team === team) : undefined;
  const isHumanTurn = room ? (seat?.occupant === 'human' && !seat?.botTakeover) : !vsAi || team === 'PINK';
  const timerActive =
    screen === 'playing' &&
    !paused &&
    !simulation &&
    !isAnimating &&
    !rolling &&
    phase !== 'GAME_OVER' &&
    isHumanTurn &&
    turnDeadlineAt !== null;

  const [secsLeft, setSecsLeft] = useState<number>(() =>
    turnDeadlineAt ? Math.max(0, Math.ceil((turnDeadlineAt - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!timerActive || turnDeadlineAt === null) return;
    const sync = () => setSecsLeft(Math.max(0, Math.ceil((turnDeadlineAt - Date.now()) / 1000)));
    sync();
    const id = setInterval(sync, 250);
    return () => clearInterval(id);
  }, [timerActive, turnDeadlineAt]);

  const clickable = canRoll;
  const status = rolling ? 'rolling' : dice ? `showing ${dice}` : 'not rolled yet';
  const [canvasKey, setCanvasKey] = useState(0);
  const cleanupCanvasRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupCanvasRef.current?.(), []);

  return (
    <button
      type="button"
      onClick={() => {
        if (clickable) rollDice();
      }}
      aria-disabled={!clickable}
      aria-label={`Roll the dice for ${TEAM_LABELS[team]}. Dice ${status}.`}
      className={`relative touch-manipulation overflow-hidden rounded-2xl border-[3px] border-ink shadow-ink transition-transform focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        clickable
          ? 'cursor-pointer ring-3 ring-[#ffc93c]/90 hover:-translate-y-0.5 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none'
          : rolling
            ? 'translate-x-[2px] translate-y-[2px] shadow-ink-sm cursor-default'
            : 'cursor-default'
      } ${className}`}
      style={{ backgroundColor: TEAM_COLORS[team] }}
    >
      <div className="pointer-events-none size-full">
        <Canvas
          key={canvasKey}
          flat
          frameloop={needsContinuousFrames || settling ? 'always' : 'demand'}
          dpr={mobile ? [1, 1.5] : [1, 2]}
          gl={{ antialias: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false }}
          camera={{ position: [0, 3.3, 2.5], fov: 34 }}
          onCreated={({ gl, camera }) => {
            cleanupCanvasRef.current?.();
            const canvasEl = gl.domElement;
            const onLost = (e: Event) => {
              e.preventDefault();
            };
            const onRestored = () => setCanvasKey((k) => k + 1);
            canvasEl.addEventListener('webglcontextlost', onLost);
            canvasEl.addEventListener('webglcontextrestored', onRestored);
            cleanupCanvasRef.current = () => {
              canvasEl.removeEventListener('webglcontextlost', onLost);
              canvasEl.removeEventListener('webglcontextrestored', onRestored);
            };
            camera.lookAt(0, 0.25, 0);
          }}
        >
          <hemisphereLight args={['#ffffff', '#f6d6bd', 1.1]} />
          <directionalLight color="#fff6e6" intensity={2.1} position={[2, 5, 3]} />
          <DiceFrameInvalidator dice={dice} team={team} />
          <Die />
        </Canvas>
      </div>
      {sixStreak > 0 && (
        <span
          aria-label={`Six streak: ${sixStreak} of 3`}
          className={`absolute top-1 left-1 rounded-md border-2 border-ink px-1 py-0.5 text-[9px] sm:px-1.5 sm:text-[10px] leading-none font-bold uppercase ${
            sixStreak >= 2 ? 'bg-[#ff4d6d] text-white' : 'bg-[#ffc93c] text-ink'
          }`}
        >
          6×{sixStreak}
        </span>
      )}
      {timerActive && (
        <span
          aria-label={`${secsLeft} seconds before auto-roll`}
          className={`absolute top-1 right-1 rounded-md border-2 border-ink px-1 py-0.5 text-[9px] sm:px-1.5 sm:text-[10px] leading-none font-bold tabular-nums ${
            secsLeft <= 5 ? 'bg-[#ff4d6d] text-white motion-safe:animate-pulse' : 'bg-white/95 text-ink'
          }`}
        >
          {secsLeft}s
        </span>
      )}
      {clickable && (
        <>
          <span
            aria-hidden
            className="absolute bottom-1 left-1 rounded-md border-2 border-ink bg-[#ffc93c] px-1 py-0.5 text-[8px] leading-none font-bold tracking-wide text-ink uppercase sm:hidden"
          >
            Roll
          </span>
          <span
            aria-hidden
            className="absolute bottom-1 left-1 hidden rounded-md border-2 border-ink bg-white/90 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide uppercase sm:inline-block"
          >
            Space
          </span>
        </>
      )}
      <span
        aria-hidden
        className="absolute right-1 bottom-1 grid size-5 sm:size-7 place-items-center rounded-md sm:rounded-lg border-2 sm:border-[3px] border-ink bg-white text-[11px] sm:text-sm leading-none font-bold"
      >
        {rolling ? '…' : (dice ?? '?')}
      </span>
    </button>
  );
}
