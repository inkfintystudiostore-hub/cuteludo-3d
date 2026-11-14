/**
 * One pawn on the board. Three nested groups keep the animation layers from fighting:
 *   root   – board position, facing and layout scale (shrinks on shared tiles)
 *   tilt   – spins, hop tilt and idle bobbing
 *   squash – squash-and-stretch
 * The figure inside is a GLTF model playing its own skeletal clips, or the procedural chibi.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import gsap from 'gsap';
import * as THREE from 'three';
import { HOME_PROGRESS, TILE_SURFACE_Y, getPawnWorldPosition, type Pawn, type SharedState } from '../engine/boardMap';
import { areAllies } from '../engine/ludoRules';
import { canLocalPlayerAct, useGameStore } from '../engine/gameStore';
import { soundManager } from '../utils/soundManager';
import { CAPTURE_FLIGHT_DURATION, CAPTURE_TWIRL_DURATION, HOP_DURATION, SPAWN_DURATION } from './animationTiming';
import { PawnModel, type PawnClip } from './PawnModel';

const TAU = Math.PI * 2;
const HOP_HEIGHT = 0.6;
const HOP_TILT = THREE.MathUtils.degToRad(12);
const CAPTURE_APEX_Y = 5.5;
const HOME_DANCE_SCALE = 1.0;
const HOME_SETTLED_SCALE = 0.5;
const HOME_DANCE_MS = 5000;

/** Squash-and-stretch poses as [x, y, z] scale. */
const STRETCH = { x: 0.9, y: 1.16, z: 0.9 };
const SQUASH = { x: 1.2, y: 0.78, z: 1.2 };
const NEUTRAL = { x: 1, y: 1, z: 1 };

/** The angle equal to `target` (mod 2π) that is closest to `current`, so turns take the short way. */
function nearestAngle(current: number, target: number): number {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

/** Looping idle for a pawn at rest. Animates only the inner `tilt` group. */
function buildIdle(tilt: THREE.Group, mood: SharedState | 'home', stagger: number): gsap.core.Timeline | null {
  if (mood === 'home') {
    // Victory dance: bounce while spinning a full turn, breathe, repeat.
    return gsap
      .timeline({ repeat: -1, repeatDelay: 0.25, delay: stagger })
      .fromTo(tilt.position, { y: 0 }, { y: 0.45, duration: 0.3, ease: 'power2.out' }, 0)
      .to(tilt.position, { y: 0, duration: 0.3, ease: 'power2.in' }, 0.3)
      .fromTo(tilt.rotation, { y: 0 }, { y: TAU, duration: 0.6, ease: 'none' }, 0);
  }
  if (mood === 'coffee') {
    // Gentle bob, then lean back for a sip.
    return gsap
      .timeline({ repeat: -1, delay: stagger })
      .to(tilt.position, { y: 0.05, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: 1 })
      .to(tilt.rotation, { x: -0.24, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: 1, repeatDelay: 0.35 });
  }
  if (mood === 'squabble') {
    // Rapid side-to-side wiggle with a little indignant bounce.
    return gsap
      .timeline({ repeat: -1, repeatDelay: 0.45, delay: stagger })
      .fromTo(tilt.rotation, { z: -0.2 }, { z: 0.2, duration: 0.08, ease: 'sine.inOut', yoyo: true, repeat: 7 }, 0)
      .to(tilt.position, { y: 0.16, duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 3 }, 0)
      .to(tilt.rotation, { z: 0, duration: 0.1 });
  }
  return null;
}

export function PawnActor({ pawn }: { pawn: Pawn }) {
  const rootRef = useRef<THREE.Group>(null);
  const tiltRef = useRef<THREE.Group>(null);
  const squashRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const idleRef = useRef<gsap.core.Timeline | null>(null);
  /** True once an event animation has moved this actor away from its last settled pose. */
  const dirtyRef = useRef(true);
  const placedRef = useRef(false);
  const settledKeyRef = useRef('');
  /** True while this pawn is travelling, so skeletal models switch to their Hop clip. */
  const [travelling, setTravelling] = useState(false);

  const pawns = useGameStore((s) => s.game.pawns);
  const mode = useGameStore((s) => s.game.mode);
  const simulation = useGameStore((s) => s.simulation);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const lastEvent = useGameStore((s) => s.lastEvent);
  const movable = useGameStore((s) => canLocalPlayerAct(s) && s.legalMoves.includes(pawn.id));
  const isHovered = useGameStore((s) => s.hoveredPawnId === pawn.id);
  const selectPawn = useGameStore((s) => s.selectPawn);
  const setHoveredPawn = useGameStore((s) => s.setHoveredPawn);
  const completeEvent = useGameStore((s) => s.completeEvent);

  const isHome = pawn.progress === HOME_PROGRESS;
  const [homeSettled, setHomeSettled] = useState(false);

  // Once a pawn arrives home, dance for 5 seconds, then settle calmly at 50% size.
  useEffect(() => {
    if (!isHome) {
      setHomeSettled(false);
      return;
    }
    if (isAnimating || homeSettled) return;
    const delay = simulation ? HOME_DANCE_MS / 4 : HOME_DANCE_MS;
    const timer = setTimeout(() => setHomeSettled(true), delay);
    return () => clearTimeout(timer);
  }, [isHome, isAnimating, homeSettled, simulation]);

  const layout = useMemo(() => getPawnWorldPosition(pawn, pawns, (a, b) => areAllies(mode, a, b)), [pawn, pawns, mode]);
  const mood: SharedState | 'home' = isHome ? (homeSettled ? 'solo' : 'home') : layout.sharedState;
  const restScale = layout.scale * (isHome ? (homeSettled ? HOME_SETTLED_SCALE : HOME_DANCE_SCALE) : 1);
  const clip: PawnClip = travelling ? 'Hop' : isHome && !homeSettled ? 'Dance' : mood === 'coffee' ? 'SipCoffee' : 'Idle';

  // Settle into the committed layout whenever the board is at rest, then start the idle loop.
  useEffect(() => {
    if (isAnimating) return;
    const root = rootRef.current!;
    const tilt = tiltRef.current!;
    const squash = squashRef.current!;
    const key = [layout.x, layout.z, layout.rotationY, restScale, mood, homeSettled].join('|');
    if (!dirtyRef.current && key === settledKeyRef.current) return;
    dirtyRef.current = false;
    settledKeyRef.current = key;
    setTravelling(false);

    idleRef.current?.kill();
    gsap.killTweensOf([root.position, root.rotation, root.scale, tilt.position, tilt.rotation, squash.scale]);
    tilt.rotation.y %= TAU;

    if (!placedRef.current) {
      placedRef.current = true;
      root.position.set(layout.x, TILE_SURFACE_Y, layout.z);
      root.rotation.y = layout.rotationY;
      root.scale.setScalar(restScale);
    } else {
      const ease = 'power2.out';
      gsap.to(root.position, { x: layout.x, y: TILE_SURFACE_Y, z: layout.z, duration: 0.3, ease });
      gsap.to(root.rotation, { y: nearestAngle(root.rotation.y, layout.rotationY), duration: 0.3, ease });
      gsap.to(root.scale, { x: restScale, y: restScale, z: restScale, duration: 0.3, ease });
    }
    gsap.to(tilt.position, { y: 0, duration: 0.2 });
    gsap.to(tilt.rotation, { x: 0, y: 0, z: 0, duration: 0.2 });
    gsap.to(squash.scale, { ...NEUTRAL, duration: 0.2 });
    idleRef.current = buildIdle(tilt, mood, 0.3 + pawn.slot * 0.15);
  }, [isAnimating, layout, restScale, mood, homeSettled, pawn.slot]);

  // Play this actor's part in the current event.
  useEffect(() => {
    if (!lastEvent) return;
    const root = rootRef.current!;
    const tilt = tiltRef.current!;
    const squash = squashRef.current!;
    const id = pawn.id;
    const done = () => completeEvent(lastEvent.id);

    /** Stops the idle loop and returns the inner groups to neutral before acting. */
    const takeStage = () => {
      dirtyRef.current = true;
      idleRef.current?.kill();
      idleRef.current = null;
      gsap.killTweensOf([root.position, root.rotation, root.scale, tilt.position, tilt.rotation, squash.scale]);
      tilt.position.y = 0;
      tilt.rotation.set(0, 0, 0);
      squash.scale.setScalar(1);
    };

    /** Flatten on impact, then spring back. */
    const land = (timeline: gsap.core.Timeline, at?: number) =>
      timeline
        .to(squash.scale, { ...SQUASH, duration: 0.07, ease: 'power1.out' }, at)
        .to(squash.scale, { ...NEUTRAL, duration: 0.38, ease: 'elastic.out(1, 0.4)' });

    let timeline: gsap.core.Timeline | undefined;

    switch (lastEvent.type) {
      case 'SPAWN_6': {
        if (lastEvent.pawnId !== id) break;
        takeStage();
        setTravelling(true);
        soundManager.playSpawnSix();
        const to = lastEvent.pathWaypoints[0];
        const yaw = nearestAngle(root.rotation.y, Math.atan2(to.x - root.position.x, to.z - root.position.z));
        const half = SPAWN_DURATION / 2;
        timeline = gsap
          .timeline({ onComplete: done })
          .fromTo(root.scale, { x: 0.45, y: 0.45, z: 0.45 }, { x: 1, y: 1, z: 1, duration: SPAWN_DURATION, ease: 'elastic.out(1.1, 0.4)' }, 0)
          .to(root.rotation, { y: yaw, duration: 0.2 }, 0)
          .to(root.position, { x: to.x, z: to.z, duration: SPAWN_DURATION, ease: 'power1.inOut' }, 0)
          .to(root.position, { y: TILE_SURFACE_Y + 1.8, duration: half, ease: 'power2.out' }, 0)
          .to(root.position, { y: TILE_SURFACE_Y, duration: half, ease: 'power2.in' }, half)
          .to(squash.scale, { ...STRETCH, duration: half, ease: 'sine.out' }, 0)
          // The 360° mid-air flip.
          .to(tilt.rotation, { y: TAU, duration: SPAWN_DURATION, ease: 'power1.inOut' }, 0)
          .set(tilt.rotation, { y: 0 });
        land(timeline, SPAWN_DURATION).call(() => soundManager.playHop(5), [], SPAWN_DURATION);
        break;
      }

      case 'HOP': {
        if (lastEvent.pawnId !== id) break;
        takeStage();
        setTravelling(true);
        const hop = gsap.timeline({ onComplete: done });
        timeline = hop;
        hop.to(root.scale, { x: 1, y: 1, z: 1, duration: 0.15 }, 0);
        let previous = { x: root.position.x, z: root.position.z };
        let yaw = root.rotation.y;
        const half = HOP_DURATION / 2;
        lastEvent.pathWaypoints.forEach((waypoint, step) => {
          const at = step * HOP_DURATION;
          yaw = nearestAngle(yaw, Math.atan2(waypoint.x - previous.x, waypoint.z - previous.z));
          hop
            .to(root.position, { x: waypoint.x, z: waypoint.z, duration: HOP_DURATION, ease: 'none' }, at)
            .to(root.position, { y: TILE_SURFACE_Y + HOP_HEIGHT, duration: half, ease: 'power2.out' }, at)
            .to(root.position, { y: TILE_SURFACE_Y, duration: half, ease: 'power2.in' }, at + half)
            .to(root.rotation, { y: yaw, duration: half }, at)
            .to(tilt.rotation, { z: step % 2 === 0 ? HOP_TILT : -HOP_TILT, duration: half, ease: 'sine.out' }, at)
            // Stretch tall at the apex, widen as the feet touch down.
            .to(squash.scale, { ...STRETCH, duration: half, ease: 'sine.out' }, at)
            .to(squash.scale, { ...SQUASH, duration: half * 0.45, ease: 'power1.in' }, at + half * 1.55)
            .call(() => soundManager.playHop(step), [], at + HOP_DURATION);
          previous = waypoint;
        });
        hop.to(tilt.rotation, { z: 0, duration: 0.12 }).to(squash.scale, { ...NEUTRAL, duration: 0.3, ease: 'elastic.out(1, 0.4)' }, '<');
        break;
      }

      case 'CAPTURE': {
        if (lastEvent.attackerId === id) {
          // The attacker is the hammer thrower: spin on the spot with the victim in tow.
          takeStage();
          timeline = gsap
            .timeline()
            .to(tilt.rotation, { y: TAU * 2, duration: CAPTURE_TWIRL_DURATION, ease: 'power1.inOut' })
            .set(tilt.rotation, { y: 0 });
          break;
        }
        if (lastEvent.victimId !== id) break;
        takeStage();
        soundManager.playCapture(CAPTURE_TWIRL_DURATION, CAPTURE_FLIGHT_DURATION);
        const [tile, yard] = lastEvent.pathWaypoints;
        const radius = 0.4;
        const startAngle = Math.atan2(root.position.z - tile.z, root.position.x - tile.x);
        const orbit = { angle: 0 };
        const launch = CAPTURE_TWIRL_DURATION;
        const halfFlight = CAPTURE_FLIGHT_DURATION / 2;
        timeline = gsap
          .timeline({ onComplete: done })
          // Whirled around the attacker: two full laps, stretched outwards by the spin.
          .to(
            orbit,
            {
              angle: TAU * 2,
              duration: CAPTURE_TWIRL_DURATION,
              ease: 'power1.in',
              onUpdate: () => {
                root.position.x = tile.x + Math.cos(startAngle + orbit.angle) * radius;
                root.position.z = tile.z + Math.sin(startAngle + orbit.angle) * radius;
              },
            },
            0,
          )
          .to(tilt.rotation, { y: TAU * 2, duration: CAPTURE_TWIRL_DURATION, ease: 'power1.in' }, 0)
          .to(root.position, { y: TILE_SURFACE_Y + 0.3, duration: CAPTURE_TWIRL_DURATION, ease: 'power1.out' }, 0)
          .to(squash.scale, { ...STRETCH, duration: CAPTURE_TWIRL_DURATION }, 0)
          // Released: a ballistic arc back to the yard, tumbling all the way.
          .to(root.position, { x: yard.x, z: yard.z, duration: CAPTURE_FLIGHT_DURATION, ease: 'none' }, launch)
          .to(root.position, { y: CAPTURE_APEX_Y, duration: halfFlight, ease: 'power2.out' }, launch)
          .to(root.position, { y: TILE_SURFACE_Y, duration: halfFlight, ease: 'power2.in' }, launch + halfFlight)
          .to(tilt.rotation, { y: TAU * 5, duration: CAPTURE_FLIGHT_DURATION, ease: 'none' }, launch)
          .to(root.scale, { x: 1, y: 1, z: 1, duration: 0.3 }, launch)
          .set(tilt.rotation, { y: 0 });
        land(timeline);
        break;
      }

      case 'REACH_HOME': {
        if (lastEvent.pawnId !== id) break;
        takeStage();
        setTravelling(false);
        soundManager.playVictory();
        timeline = gsap
          .timeline({ onComplete: done })
          .to(root.scale, { x: HOME_DANCE_SCALE, y: HOME_DANCE_SCALE, z: HOME_DANCE_SCALE, duration: 0.45, ease: 'back.out(3)' }, 0)
          .to(tilt.position, { y: 0.6, duration: 0.25, ease: 'power2.out', yoyo: true, repeat: 1 }, 0)
          .to(squash.scale, { ...STRETCH, duration: 0.25, ease: 'sine.out' }, 0)
          .to(tilt.rotation, { y: TAU, duration: 0.5, ease: 'power1.inOut' }, 0)
          .set(tilt.rotation, { y: 0 });
        land(timeline, 0.5);
        break;
      }

      case 'SHARED_STAR': {
        const placement = lastEvent.placements[id];
        if (!placement) break;
        takeStage();
        const arriving = lastEvent.pawnId === id;
        if (arriving) soundManager.playStarChime();
        const { x, z, scale } = placement;
        const ease = 'power2.out';
        timeline = gsap
          .timeline({ onComplete: arriving ? done : undefined })
          .to(root.position, { x, z, duration: 0.35, ease }, 0)
          .to(root.scale, { x: scale, y: scale, z: scale, duration: 0.35, ease }, 0)
          .to(root.rotation, { y: nearestAngle(root.rotation.y, placement.rotationY), duration: 0.35, ease }, 0);
        break;
      }
    }

    return () => {
      timeline?.kill();
    };
  }, [lastEvent, pawn.id, completeEvent]);

  useEffect(
    () => () => {
      idleRef.current?.kill();
      dirtyRef.current = true; // StrictMode re-runs effects after this cleanup; force a re-settle
      document.body.style.cursor = '';
    },
    [],
  );

  useFrame(({ clock }) => {
    const ring = ringRef.current;
    const squash = squashRef.current;
    if (!ring || !squash) return;
    // Pawns that can be clicked bounce on a pulsing ring so the choice is obvious.
    const beat = clock.elapsedTime * 6 + pawn.slot;
    const bounce = movable ? Math.abs(Math.sin(beat)) * 0.2 : 0;
    squash.position.y += (bounce - squash.position.y) * 0.3;
    if (movable) {
      const pulse = 1 + Math.sin(beat) * 0.12;
      ring.scale.set(pulse, pulse, 1);
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!movable) return;
    event.stopPropagation();
    document.body.style.cursor = '';
    setHoveredPawn(null);
    selectPawn(pawn.id);
  };

  return (
    <group
      ref={rootRef}
      onClick={handleClick}
      onPointerOver={(event) => {
        if (!movable) return;
        event.stopPropagation();
        document.body.style.cursor = 'pointer';
        setHoveredPawn(pawn.id);
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
        if (isHovered) setHoveredPawn(null);
      }}
    >
      {/* Grounded comic-ink contact ring under the pawn */}
      <mesh position-y={0.008} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.38, 28]} />
        <meshBasicMaterial color="#2b213a" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef} visible={movable} position-y={0.02} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[isHovered ? 0.44 : 0.42, isHovered ? 0.64 : 0.58, 40]} />
        <meshStandardMaterial
          color={isHovered ? '#ff6f9c' : '#ffc93c'}
          emissive={isHovered ? '#ff6f9c' : '#ffc93c'}
          emissiveIntensity={isHovered ? 2.8 : 2.2}
          toneMapped={false}
        />
      </mesh>
      {/* Generous invisible hit area so shrunken pawns stay easy to tap. */}
      <mesh position-y={0.8}>
        <cylinderGeometry args={[0.5, 0.5, 1.6, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={tiltRef}>
        <group ref={squashRef}>
          <PawnModel
            team={pawn.team}
            slot={pawn.slot}
            clip={clip}
            holdingCup={mood === 'coffee'}
            isMovable={movable}
            isHovered={isHovered}
          />
        </group>
      </group>
    </group>
  );
}
