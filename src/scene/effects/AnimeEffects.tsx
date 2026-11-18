/**
 * Billboard particle effects. Each sprite shape is one InstancedMesh; particles are plain
 * objects simulated on the CPU and written into instance matrices every frame. Sprites pop in
 * and shrink out instead of fading, so no per-instance alpha is needed.
 *
 * Anything can request an effect through `emitEffect`; this component also listens to the
 * game store and fires the effects that belong to each game event.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  HOME_PROGRESS,
  getHomePicnicPosition,
  getPawnWorldPosition,
  getProgressPosition,
  getTileKey,
  type SharedState,
  type WorldPoint,
} from '../../engine/boardMap';
import { useGameStore } from '../../engine/gameStore';
import { areAllies } from '../../engine/ludoRules';
import { CAPTURE_FLIGHT_DURATION, CAPTURE_GRAB_DURATION, CAPTURE_TWIRL_DURATION, SPAWN_DURATION } from '../animationTiming';
import { INK, heartPath, inkFill, starPath } from './canvasShapes';

export type EffectRequest = {
  type: 'confetti' | 'sparkle' | 'bang' | 'speedRing' | 'dustLanding' | 'steam' | 'squabble' | 'picnicNote';
  x: number;
  z: number;
  /** Height of the emitter; each effect has a sensible default. */
  y?: number;
  /** Seconds to wait before the effect appears. */
  delay?: number;
};

const pendingRequests: EffectRequest[] = [];

/** Queues an effect; it appears on the next rendered frame. */
export function emitEffect(request: EffectRequest): void {
  pendingRequests.push(request);
}

type SpriteKind = 'star' | 'heart' | 'puff' | 'steam' | 'note' | 'anger' | 'bang' | 'line';

const TEXTURE_SIZE = 128;
const PASTELS = ['#ff8fab', '#72efdd', '#ffd166', '#80ed99', '#cdb4ff', '#ffffff'];
const TAU = Math.PI * 2;

/** Sprites are drawn white with an ink outline so instance colours can tint the fill. */
const SPRITE_PAINTERS: Record<SpriteKind, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  star: (ctx, s) => {
    starPath(ctx, s / 2, s / 2 + s * 0.03, s * 0.4, s * 0.19);
    inkFill(ctx, '#ffffff', s * 0.09);
  },
  heart: (ctx, s) => {
    heartPath(ctx, s / 2, s / 2, s * 0.34);
    inkFill(ctx, '#ffffff', s * 0.09);
  },
  puff: (ctx, s) => {
    const blobs: [number, number, number][] = [
      [0.36, 0.56, 0.2],
      [0.6, 0.58, 0.22],
      [0.48, 0.4, 0.22],
    ];
    ctx.fillStyle = INK;
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, r * s + s * 0.045, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (const [x, y, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, r * s, 0, TAU);
      ctx.fill();
    }
  },
  steam: (ctx, s) => {
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.86);
      ctx.bezierCurveTo(s * 0.22, s * 0.66, s * 0.78, s * 0.5, s * 0.5, s * 0.34);
      ctx.bezierCurveTo(s * 0.36, s * 0.26, s * 0.44, s * 0.16, s * 0.56, s * 0.12);
    };
    ctx.lineCap = 'round';
    trace();
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.16;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = s * 0.08;
    ctx.stroke();
  },
  note: (ctx, s) => {
    ctx.beginPath();
    ctx.ellipse(s * 0.38, s * 0.72, s * 0.15, s * 0.11, -0.4, 0, TAU);
    ctx.rect(s * 0.47, s * 0.2, s * 0.06, s * 0.52);
    ctx.moveTo(s * 0.5, s * 0.2);
    ctx.quadraticCurveTo(s * 0.78, s * 0.24, s * 0.74, s * 0.48);
    ctx.quadraticCurveTo(s * 0.68, s * 0.36, s * 0.5, s * 0.36);
    ctx.closePath();
    inkFill(ctx, '#ffffff', s * 0.08);
  },
  anger: (ctx, s) => {
    // The classic four-bracket anime vein mark.
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * TAU + Math.PI / 4;
        const cx = s / 2 + Math.cos(angle) * s * 0.3;
        const cy = s / 2 + Math.sin(angle) * s * 0.3;
        ctx.moveTo(cx + Math.cos(angle + 2.2) * s * 0.2, cy + Math.sin(angle + 2.2) * s * 0.2);
        ctx.quadraticCurveTo(s / 2 + Math.cos(angle) * s * 0.1, s / 2 + Math.sin(angle) * s * 0.1, cx + Math.cos(angle - 2.2) * s * 0.2, cy + Math.sin(angle - 2.2) * s * 0.2);
      }
    };
    ctx.lineCap = 'round';
    trace();
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.17;
    ctx.stroke();
    trace();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = s * 0.08;
    ctx.stroke();
  },
  bang: (ctx, s) => {
    ctx.font = `900 ${s * 0.92}px "Fredoka", "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.2;
    ctx.strokeText('!', s / 2, s * 0.54);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = s * 0.1;
    ctx.strokeText('!', s / 2, s * 0.54);
    ctx.fillStyle = '#ff3d6e';
    ctx.fillText('!', s / 2, s * 0.54);
  },
  line: (ctx, s) => {
    ctx.beginPath();
    ctx.roundRect(s * 0.08, s * 0.44, s * 0.84, s * 0.12, s * 0.06);
    inkFill(ctx, '#ffffff', s * 0.05);
  },
};

function makeSpriteTexture(kind: SpriteKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  SPRITE_PAINTERS[kind](canvas.getContext('2d')!, TEXTURE_SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface Orbit {
  cx: number;
  cz: number;
  radius: number;
  angle: number;
  /** Radians per second. */
  speed: number;
}

interface Particle {
  delay: number;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  /** Fraction of velocity lost per second. */
  drag: number;
  size: number;
  /** Size multiplier reached at the end of life. */
  grow: number;
  rot: number;
  spin: number;
  /** Side-to-side sway amplitude in world units. */
  sway: number;
  phase: number;
  color: THREE.Color;
  orbit?: Orbit;
}

const CAPACITY = 96;
const SPRITE_KINDS = Object.keys(SPRITE_PAINTERS) as SpriteKind[];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

function particle(overrides: Partial<Particle> & Pick<Particle, 'x' | 'y' | 'z' | 'life' | 'size'>, color = '#ffffff'): Particle {
  return {
    delay: 0,
    age: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    gravity: 0,
    drag: 0,
    grow: 1,
    rot: 0,
    spin: 0,
    sway: 0,
    phase: rand(0, TAU),
    color: new THREE.Color(color),
    ...overrides,
  };
}

type Spawn = (kind: SpriteKind, p: Particle) => void;

/** Turns one effect request into particles. */
function buildEffect(request: EffectRequest, spawn: Spawn): void {
  const { x, z, delay = 0 } = request;
  switch (request.type) {
    case 'confetti': {
      const y = request.y ?? 0.6;
      for (let i = 0; i < 30; i++) {
        const angle = rand(0, TAU);
        const speed = rand(0.5, 2.3);
        spawn(
          i % 2 === 0 ? 'star' : 'heart',
          particle(
            {
              x, y, z, delay: delay + rand(0, 0.12),
              vx: Math.cos(angle) * speed, vy: rand(4.5, 7.8), vz: Math.sin(angle) * speed,
              gravity: -11, drag: 0.5, life: rand(1.1, 1.7), size: rand(0.24, 0.42), rot: rand(0, TAU), spin: rand(-7, 7),
            },
            pick(PASTELS),
          ),
        );
      }
      break;
    }
    case 'sparkle': {
      const y = request.y ?? 1;
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * TAU + rand(-0.15, 0.15);
        const speed = rand(2.2, 4.2);
        spawn(
          'star',
          particle(
            {
              x, y, z, delay,
              vx: Math.cos(angle) * speed, vy: rand(1.5, 4.5), vz: Math.sin(angle) * speed * 0.7,
              gravity: -5, drag: 1.6, life: rand(0.5, 0.85), size: rand(0.22, 0.4), rot: rand(0, TAU), spin: rand(-9, 9),
            },
            i % 3 === 0 ? '#ffffff' : '#ffd166',
          ),
        );
      }
      break;
    }
    case 'bang':
      spawn('bang', particle({ x: x + 0.25, y: request.y ?? 2.15, z, delay, vy: 0.9, drag: 2.5, life: 0.75, size: 1.15, rot: -0.22 }));
      break;
    case 'speedRing':
      for (let i = 0; i < 12; i++) {
        spawn(
          'line',
          particle({
            x, z, delay, y: (request.y ?? 0.35) + (i % 3) * 0.32, life: CAPTURE_TWIRL_DURATION, size: 0.46,
            orbit: { cx: x, cz: z, radius: 0.68, angle: (i / 12) * TAU, speed: 19 },
          }),
        );
      }
      break;
    case 'dustLanding': {
      for (let i = 0; i < 9; i++) {
        const angle = (i / 9) * TAU + rand(-0.2, 0.2);
        const speed = rand(1.7, 2.6);
        spawn(
          'puff',
          particle({
            x, y: request.y ?? 0.3, z, delay,
            vx: Math.cos(angle) * speed, vy: rand(0.4, 1), vz: Math.sin(angle) * speed,
            drag: 3.2, life: rand(0.55, 0.8), size: rand(0.5, 0.78), grow: 1.3,
          }),
        );
      }
      for (let i = 0; i < 4; i++) {
        spawn(
          'star',
          particle(
            { x, z, delay: delay + 0.08, y: 1.45, life: 1.45, size: 0.28, spin: 4.5, orbit: { cx: x, cz: z, radius: 0.44, angle: (i / 4) * TAU, speed: 7 } },
            '#ffd166',
          ),
        );
      }
      break;
    }
    case 'steam':
      spawn(
        'steam',
        particle({ x: x + rand(-0.22, 0.22), y: request.y ?? 0.95, z: z + rand(-0.1, 0.1), delay, vy: 0.55, life: 1.6, size: 0.3, grow: 1.5, sway: 0.08 }),
      );
      break;
    case 'squabble': {
      const angry = Math.random() < 0.5;
      spawn(
        angry ? 'anger' : 'note',
        particle(
          { x: x + rand(-0.3, 0.3), y: request.y ?? 1.05, z: z + rand(-0.1, 0.1), delay, vy: 0.85, drag: 0.6, life: 1.2, size: 0.36, sway: 0.1, rot: rand(-0.35, 0.35) },
          angry ? '#ff5c7a' : '#b79cff',
        ),
      );
      break;
    }
    case 'picnicNote':
      spawn(
        'note',
        particle(
          { x: x + rand(-0.12, 0.12), y: request.y ?? 0.62, z: z + rand(-0.12, 0.12), delay, vy: 0.65, drag: 0.4, life: 1.35, size: 0.24, sway: 0.08, rot: rand(-0.25, 0.25) },
          pick(PASTELS),
        ),
      );
      break;
  }
}

/** Pop in with a little overshoot, hold, then shrink away. */
function envelope(t: number): number {
  const inT = Math.min(t / 0.18, 1) - 1;
  const popIn = 1 + 2.70158 * inT * inT * inT + 1.70158 * inT * inT;
  const outT = t > 0.72 ? (t - 0.72) / 0.28 : 0;
  return popIn * (1 - outT * outT);
}

const AMBIENT_INTERVAL = 0.55;

export function AnimeEffects() {
  const pawns = useGameStore((s) => s.game.pawns);
  const mode = useGameStore((s) => s.game.mode);
  const phase = useGameStore((s) => s.game.phase);
  const rankings = useGameStore((s) => s.game.rankings);
  const lastEvent = useGameStore((s) => s.lastEvent);
  const ambientClock = useRef(0);
  const picnicClock = useRef(0);

  const layers = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    return SPRITE_KINDS.map((kind) => {
      const material = new THREE.MeshBasicMaterial({ map: makeSpriteTexture(kind), transparent: true, alphaTest: 0.02, depthWrite: false, toneMapped: false });
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      return { kind, mesh, particles: [] as Particle[] };
    });
  }, []);

  useEffect(
    () => () => {
      layers[0].mesh.geometry.dispose();
      for (const { mesh } of layers) {
        (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        (mesh.material as THREE.MeshBasicMaterial).dispose();
      }
    },
    [layers],
  );

  /** Tiles where pawns currently keep each other company, for the ambient steam and squabble marks. */
  const sharedTiles = useMemo(() => {
    const tiles = new Map<string, WorldPoint & { state: SharedState }>();
    for (const pawn of pawns) {
      const key = getTileKey(pawn);
      if (!key || key.startsWith('G') || tiles.has(key)) continue;
      const { sharedState } = getPawnWorldPosition(pawn, pawns, (a, b) => areAllies(mode, a, b));
      if (sharedState !== 'solo') tiles.set(key, { ...getProgressPosition(pawn.team, pawn.progress), state: sharedState });
    }
    return [...tiles.values()];
  }, [pawns, mode]);

  const picnicSpots = useMemo(() => {
    const spots: (WorldPoint & { kind: 'steam' | 'picnicNote' })[] = [];
    for (const pawn of pawns) {
      if (pawn.progress !== HOME_PROGRESS) continue;
      const seat = getHomePicnicPosition(pawn.team, pawn.slot);
      if (pawn.slot === 1) spots.push({ ...seat, kind: 'steam' });
      else if (pawn.slot === 3) spots.push({ ...seat, kind: 'picnicNote' });
    }
    if (spots.length > 0 || pawns.some((p) => p.progress === HOME_PROGRESS)) {
      spots.push({ x: -0.46, z: 0.46, kind: 'picnicNote' });
    }
    return spots;
  }, [pawns]);

  // Effects that accompany each game event, timed against the pawn animations.
  useEffect(() => {
    if (!lastEvent) return;
    switch (lastEvent.type) {
      case 'SPAWN_6': {
        const { x, z } = lastEvent.pathWaypoints[0];
        emitEffect({ type: 'confetti', x, z, delay: SPAWN_DURATION });
        break;
      }
      case 'REACH_HOME': {
        const pawn = useGameStore.getState().game.pawns.find((p) => p.id === lastEvent.pawnId);
        if (pawn) emitEffect({ type: 'sparkle', ...getHomePicnicPosition(pawn.team, pawn.slot), y: 0.65 });
        break;
      }
      case 'CAPTURE': {
        const [tile, yard] = lastEvent.pathWaypoints;
        const releaseAt = CAPTURE_GRAB_DURATION + CAPTURE_TWIRL_DURATION;
        emitEffect({ type: 'bang', x: tile.x, z: tile.z, delay: 0.04 });
        emitEffect({ type: 'sparkle', x: tile.x, z: tile.z, y: 0.85, delay: CAPTURE_GRAB_DURATION });
        emitEffect({ type: 'speedRing', x: tile.x, z: tile.z, delay: CAPTURE_GRAB_DURATION });
        emitEffect({ type: 'sparkle', x: tile.x, z: tile.z, y: 1.25, delay: releaseAt });
        emitEffect({ type: 'dustLanding', x: yard.x, z: yard.z, delay: releaseAt + CAPTURE_FLIGHT_DURATION });
        break;
      }
      case 'SHARED_STAR': {
        const placements = Object.values(lastEvent.placements);
        const x = placements.reduce((sum, p) => sum + p.x, 0) / placements.length;
        const z = placements.reduce((sum, p) => sum + p.z, 0) / placements.length;
        const type = lastEvent.sharedState === 'coffee' ? 'steam' : 'squabble';
        for (let i = 0; i < 4; i++) emitEffect({ type, x, z, delay: 0.2 + i * 0.12 });
        break;
      }
    }
  }, [lastEvent]);

  // Distinct end-of-game burst for 1st place celebration vs last-place comic rage!
  useEffect(() => {
    if (phase !== 'GAME_OVER' || rankings.length === 0) return;
    const firstTeam = rankings[0];
    const lastTeam = rankings.length > 1 ? rankings[rankings.length - 1] : null;
    for (let s = 0; s < 2; s++) {
      const seat = getHomePicnicPosition(firstTeam, s);
      emitEffect({ type: 'confetti', x: seat.x, z: seat.z, y: 0.9, delay: s * 0.15 });
    }
    if (lastTeam) {
      const statePawns = useGameStore.getState().game.pawns.filter((p) => p.team === lastTeam);
      for (const p of statePawns.slice(0, 2)) {
        const pos = getPawnWorldPosition(p, useGameStore.getState().game.pawns);
        emitEffect({ type: 'squabble', x: pos.x, z: pos.z, y: 1.15, delay: 0.2 });
      }
    }
  }, [phase, rankings]);

  const scratch = useMemo(
    () => ({ matrix: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), roll: new THREE.Quaternion(), scale: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1) }),
    [],
  );

  useFrame(({ camera }, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05); // a backgrounded tab must not fling particles on return

    ambientClock.current += dt;
    if (ambientClock.current >= AMBIENT_INTERVAL) {
      ambientClock.current = 0;
      for (const tile of sharedTiles) emitEffect({ type: tile.state === 'coffee' ? 'steam' : 'squabble', x: tile.x, z: tile.z });
    }

    picnicClock.current += dt;
    if (picnicClock.current >= 0.85) {
      picnicClock.current = 0;
      if (picnicSpots.length > 0) {
        const spot = picnicSpots[Math.floor(Math.random() * picnicSpots.length)];
        emitEffect({ type: spot.kind, x: spot.x, z: spot.z, y: 0.55 });
      }
    }

    if (pendingRequests.length > 0) {
      const spawn: Spawn = (kind, p) => {
        const layer = layers.find((l) => l.kind === kind)!;
        if (layer.particles.length < CAPACITY) layer.particles.push(p);
      };
      for (const request of pendingRequests.splice(0)) buildEffect(request, spawn);
    }

    for (const { mesh, particles } of layers) {
      if (particles.length === 0 && mesh.count === 0) continue;
      let alive = 0;
      let drawn = 0;
      for (const p of particles) {
        if (p.delay > 0) {
          p.delay -= dt;
          particles[alive++] = p;
          continue;
        }
        p.age += dt;
        if (p.age >= p.life) continue;
        particles[alive++] = p;

        if (p.orbit) {
          p.orbit.angle += p.orbit.speed * dt;
          p.x = p.orbit.cx + Math.cos(p.orbit.angle) * p.orbit.radius;
          p.z = p.orbit.cz + Math.sin(p.orbit.angle) * p.orbit.radius;
        } else {
          const damping = Math.max(0, 1 - p.drag * dt);
          p.vx *= damping;
          p.vy = p.vy * damping + p.gravity * dt;
          p.vz *= damping;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
        }
        p.rot += p.spin * dt;

        const t = p.age / p.life;
        const size = p.size * envelope(t) * (1 + (p.grow - 1) * t);
        scratch.position.set(p.x + Math.sin(p.age * 4 + p.phase) * p.sway, p.y, p.z);
        scratch.quaternion.copy(camera.quaternion).multiply(scratch.roll.setFromAxisAngle(scratch.forward, p.rot));
        scratch.scale.set(size, size, size);
        mesh.setMatrixAt(drawn, scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale));
        mesh.setColorAt(drawn, p.color);
        drawn++;
      }
      particles.length = alive;
      mesh.count = drawn;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {layers.map(({ kind, mesh }) => (
        <primitive key={kind} object={mesh} />
      ))}
    </>
  );
}
