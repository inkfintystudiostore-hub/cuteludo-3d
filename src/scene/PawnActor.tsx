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
import {
  HOME_PICNIC_SCALE,
  HOME_PROGRESS,
  TILE_SURFACE_Y,
  YARD_PROGRESS,
  getBoardYawForTeam,
  getPawnWorldPosition,
  type Pawn,
  type SharedState,
} from '../engine/boardMap';
import { areAllies } from '../engine/ludoRules';
import { canLocalPlayerAct, getLocalAnchorTeam, useGameStore } from '../engine/gameStore';
import { soundManager } from '../utils/soundManager';
import {
  CAPTURE_DIZZY_DURATION,
  CAPTURE_FLIGHT_DURATION,
  CAPTURE_GRAB_DURATION,
  CAPTURE_TWIRL_DURATION,
  HOP_DURATION,
  SPAWN_DURATION,
} from './animationTiming';
import { HOME_ACTIVITIES, type CapturePose } from './ChibiFigure';
import { PawnModel, type PawnClip } from './PawnModel';

const TAU = Math.PI * 2;
const HOP_HEIGHT = 0.6;
const HOP_TILT = THREE.MathUtils.degToRad(12);
const CAPTURE_APEX_Y = 5.5;

/** Squash-and-stretch poses as [x, y, z] scale. */
const STRETCH = { x: 0.9, y: 1.16, z: 0.9 };
const SQUASH = { x: 1.2, y: 0.78, z: 1.2 };
const NEUTRAL = { x: 1, y: 1, z: 1 };

/** The angle equal to `target` (mod 2π) that is closest to `current`, so turns take the short way. */
function nearestAngle(current: number, target: number): number {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

/** Looping idle for a pawn at rest. Animates only the inner `tilt` group. */
function buildIdle(tilt: THREE.Group, mood: SharedState | 'picnic', stagger: number): gsap.core.Timeline | null {
  if (mood === 'picnic') {
    // Seated peacefully around the campfire — no standing/spinning dance.
    return null;
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

export function PawnActor({ pawn, boardYaw: propBoardYaw }: { pawn: Pawn; boardYaw?: number }) {
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
  /** Expressive capture pose triggered mid-timeline (grab, hand-held twirl, throw, flail, laugh, dizzy). */
  const [capturePose, setCapturePose] = useState<CapturePose>('none');

  const pawns = useGameStore((s) => s.game.pawns);
  const mode = useGameStore((s) => s.game.mode);
  const phase = useGameStore((s) => s.game.phase);
  const rankings = useGameStore((s) => s.game.rankings);
  const isAnimating = useGameStore((s) => s.isAnimating);
  const lastEvent = useGameStore((s) => s.lastEvent);
  const hasYardEmote = useGameStore((s) => Boolean(s.yardEmotes[pawn.team]));
  const movable = useGameStore((s) => canLocalPlayerAct(s) && s.legalMoves.includes(pawn.id));
  const hiddenInYard =
    hasYardEmote &&
    pawn.progress === -1 &&
    !movable &&
    !(lastEvent?.type === 'SPAWN_6' && lastEvent.pawnId === pawn.id) &&
    !(lastEvent?.type === 'CAPTURE' && lastEvent.victimId === pawn.id);
  const isHovered = useGameStore((s) => s.hoveredPawnId === pawn.id);
  const selectPawn = useGameStore((s) => s.selectPawn);
  const setHoveredPawn = useGameStore((s) => s.setHoveredPawn);
  const completeEvent = useGameStore((s) => s.completeEvent);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastSelectAtRef = useRef(0);

  const anchorTeam = useGameStore((s) => getLocalAnchorTeam(s));
  const boardYaw = propBoardYaw ?? getBoardYawForTeam(anchorTeam);

  const isHomeGoal = pawn.progress === HOME_PROGRESS;
  const isInYard = pawn.progress === YARD_PROGRESS;
  const isAtHome = !travelling && (isHomeGoal || isInYard);
  const homeActivity = HOME_ACTIVITIES[pawn.slot % HOME_ACTIVITIES.length];
  const finalRank = phase === 'GAME_OVER' ? rankings.indexOf(pawn.team) + 1 : null;
  const validRank = finalRank && finalRank > 0 ? finalRank : null;
  const isLastPlace = Boolean(validRank && rankings.length > 1 && validRank === rankings.length);

  const layout = useMemo(
    () => getPawnWorldPosition(pawn, pawns, (a, b) => areAllies(mode, a, b), boardYaw),
    [pawn, pawns, mode, boardYaw],
  );
  const mood: SharedState | 'picnic' = isHomeGoal ? 'picnic' : layout.sharedState;
  const restScale = layout.scale;
  const clip: PawnClip = travelling ? 'Hop' : isAtHome ? 'Picnic' : mood === 'coffee' ? 'SipCoffee' : 'Idle';

  // Settle into the committed layout whenever the board is at rest, then start the idle loop.
  useEffect(() => {
    if (isAnimating) return;
    const root = rootRef.current!;
    const tilt = tiltRef.current!;
    const squash = squashRef.current!;
    const key = [layout.x, layout.z, layout.rotationY, restScale, mood].join('|');
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
      gsap.to(root.position, { x: layout.x, y: TILE_SURFACE_Y, z: layout.z, duration: 0.24, ease });
      gsap.to(root.rotation, { y: nearestAngle(root.rotation.y, layout.rotationY), duration: 0.24, ease });
      gsap.to(root.scale, { x: restScale, y: restScale, z: restScale, duration: 0.24, ease });
    }
    gsap.to(tilt.position, { y: 0, duration: 0.16 });
    gsap.to(tilt.rotation, { x: 0, y: 0, z: 0, duration: 0.16 });
    gsap.to(squash.scale, { ...NEUTRAL, duration: 0.16 });
    idleRef.current = buildIdle(tilt, mood, 0.24 + pawn.slot * 0.12);
  }, [isAnimating, layout, restScale, mood, pawn.slot]);

  // Play this actor's part in the current event.
  useEffect(() => {
    if (!lastEvent) {
      setCapturePose('none');
      return;
    }
    if (lastEvent.type !== 'CAPTURE') setCapturePose('none');

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
        .to(squash.scale, { ...SQUASH, duration: 0.056, ease: 'power1.out' }, at)
        .to(squash.scale, { ...NEUTRAL, duration: 0.3, ease: 'elastic.out(1, 0.4)' });

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
          .to(root.rotation, { y: yaw, duration: 0.16 }, 0)
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
        hop.to(root.scale, { x: 1, y: 1, z: 1, duration: 0.12 }, 0);
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
        hop.to(tilt.rotation, { z: 0, duration: 0.1 }).to(squash.scale, { ...NEUTRAL, duration: 0.24, ease: 'elastic.out(1, 0.4)' }, '<');
        break;
      }

      case 'CAPTURE': {
        const isAttacker = lastEvent.attackerId === id;
        const isVictim = lastEvent.victimId === id;
        if (!isAttacker && !isVictim) break;

        takeStage();
        setTravelling(false);
        setCapturePose('grab');

        const [tile, yard] = lastEvent.pathWaypoints;
        const startAngle = 0.55;
        const grabRadiusA = 0.18;
        const grabRadiusV = 0.68;
        const spinRadiusA = 0.14;
        const spinRadiusV = 0.44;
        const totalSpin = TAU * 3.5;
        const twirlStart = CAPTURE_GRAB_DURATION;
        const releaseAt = twirlStart + CAPTURE_TWIRL_DURATION;
        const halfFlight = CAPTURE_FLIGHT_DURATION / 2;
        const impactAt = releaseAt + CAPTURE_FLIGHT_DURATION;
        const yawA0 = Math.atan2(Math.cos(startAngle), Math.sin(startAngle));
        const yawV0 = yawA0 + Math.PI;

        if (isAttacker) {
          // Beat 1: Step in, face victim, reach hands forward to clasp victim's hands.
          // Beat 2: Lean back & whirl victim gol-gol 3.5x hand-in-hand!
          // Beat 3: Fling arms open to launch victim home, then bounce & belly-laugh!
          const yawBaseA = nearestAngle(root.rotation.y, yawA0);
          const orbit = { angle: 0, progress: 0 };
          timeline = gsap
            .timeline()
            .to(
              root.position,
              {
                x: tile.x - Math.cos(startAngle) * grabRadiusA,
                z: tile.z - Math.sin(startAngle) * grabRadiusA,
                duration: CAPTURE_GRAB_DURATION * 0.85,
                ease: 'power2.out',
              },
              0,
            )
            .to(root.rotation, { y: yawBaseA, duration: CAPTURE_GRAB_DURATION * 0.75, ease: 'power2.out' }, 0)
            .to(tilt.rotation, { x: 0.1, duration: CAPTURE_GRAB_DURATION * 0.5, ease: 'power1.out' }, 0)
            .to(tilt.rotation, { x: 0, duration: CAPTURE_GRAB_DURATION * 0.5, ease: 'power1.in' }, CAPTURE_GRAB_DURATION * 0.5)
            .to(squash.scale, { x: 1.08, y: 0.92, z: 1.08, duration: CAPTURE_GRAB_DURATION * 0.45 }, 0)
            .to(squash.scale, { ...NEUTRAL, duration: CAPTURE_GRAB_DURATION * 0.5 }, CAPTURE_GRAB_DURATION * 0.45)
            .call(() => setCapturePose('twirl_attacker'), [], twirlStart)
            .to(
              orbit,
              {
                angle: totalSpin,
                progress: 1,
                duration: CAPTURE_TWIRL_DURATION,
                ease: 'power2.in',
                onUpdate: () => {
                  const ang = startAngle + orbit.angle;
                  const r = THREE.MathUtils.lerp(grabRadiusA, spinRadiusA, orbit.progress);
                  root.position.x = tile.x - Math.cos(ang) * r;
                  root.position.z = tile.z - Math.sin(ang) * r;
                  root.rotation.y = yawBaseA - orbit.angle;
                },
              },
              twirlStart,
            )
            .to(tilt.rotation, { x: -0.14, duration: CAPTURE_TWIRL_DURATION * 0.45, ease: 'power1.out' }, twirlStart)
            .call(() => setCapturePose('throw'), [], releaseAt)
            .to(root.position, { x: tile.x, z: tile.z, duration: 0.2, ease: 'power2.out' }, releaseAt)
            .to(tilt.rotation, { x: 0, duration: 0.16, ease: 'back.out(2)' }, releaseAt)
            .to(squash.scale, { ...STRETCH, duration: 0.12, ease: 'power2.out' }, releaseAt)
            .to(squash.scale, { ...NEUTRAL, duration: 0.12 }, releaseAt + 0.12)
            .call(() => setCapturePose('laugh'), [], releaseAt + 0.2)
            .to(tilt.position, { y: 0.22, duration: 0.085, ease: 'power2.out', yoyo: true, repeat: 5 }, releaseAt + 0.2)
            .to(squash.scale, { x: 1.1, y: 0.9, z: 1.1, duration: 0.085, yoyo: true, repeat: 5 }, releaseAt + 0.2)
            .to(squash.scale, { ...NEUTRAL, duration: 0.14, ease: 'power2.out' });
          break;
        }

        // Victim: clasp hands with attacker, lift off into a centrifugal gol-gol twirl,
        // get flung sky-high back to yard, and crash-land dizzy!
        soundManager.playCapture(CAPTURE_TWIRL_DURATION, CAPTURE_FLIGHT_DURATION, CAPTURE_GRAB_DURATION);
        const yawBaseV = nearestAngle(root.rotation.y, yawV0);
        const orbit = { angle: 0, progress: 0 };
        timeline = gsap
          .timeline({ onComplete: done })
          .to(root.scale, { x: 1, y: 1, z: 1, duration: 0.16, ease: 'power2.out' }, 0)
          .to(
            root.position,
            {
              x: tile.x + Math.cos(startAngle) * grabRadiusV,
              z: tile.z + Math.sin(startAngle) * grabRadiusV,
              duration: CAPTURE_GRAB_DURATION * 0.85,
              ease: 'power2.out',
            },
            0,
          )
          .to(root.position, { y: TILE_SURFACE_Y + 0.22, duration: CAPTURE_GRAB_DURATION * 0.45, ease: 'power2.out' }, 0)
          .to(root.position, { y: TILE_SURFACE_Y, duration: CAPTURE_GRAB_DURATION * 0.45, ease: 'power2.in' }, CAPTURE_GRAB_DURATION * 0.45)
          .to(root.rotation, { y: yawBaseV, duration: CAPTURE_GRAB_DURATION * 0.75, ease: 'power2.out' }, 0)
          .call(() => setCapturePose('twirl_victim'), [], twirlStart)
          .to(
            orbit,
            {
              angle: totalSpin,
              progress: 1,
              duration: CAPTURE_TWIRL_DURATION,
              ease: 'power2.in',
              onUpdate: () => {
                const ang = startAngle + orbit.angle;
                const r = THREE.MathUtils.lerp(grabRadiusV, spinRadiusV, orbit.progress);
                root.position.x = tile.x + Math.cos(ang) * r;
                root.position.z = tile.z + Math.sin(ang) * r;
                root.rotation.y = yawBaseV - orbit.angle;
              },
            },
            twirlStart,
          )
          .to(root.position, { y: TILE_SURFACE_Y + 0.28, duration: CAPTURE_TWIRL_DURATION * 0.65, ease: 'power1.out' }, twirlStart)
          .to(tilt.rotation, { x: -0.32, duration: CAPTURE_TWIRL_DURATION * 0.55, ease: 'power1.out' }, twirlStart)
          .to(squash.scale, { ...STRETCH, duration: CAPTURE_TWIRL_DURATION * 0.6 }, twirlStart)
          // Fling back to yard with wild gol-gol & head-over-heels tumble.
          .call(() => setCapturePose('flail'), [], releaseAt)
          .to(root.position, { x: yard.x, z: yard.z, duration: CAPTURE_FLIGHT_DURATION, ease: 'none' }, releaseAt)
          .to(root.position, { y: CAPTURE_APEX_Y, duration: halfFlight, ease: 'power2.out' }, releaseAt)
          .to(root.position, { y: TILE_SURFACE_Y, duration: halfFlight, ease: 'power2.in' }, releaseAt + halfFlight)
          .to(tilt.rotation, { y: TAU * 6, z: TAU * 3, x: -TAU * 2, duration: CAPTURE_FLIGHT_DURATION, ease: 'none' }, releaseAt)
          .set(tilt.rotation, { x: 0, y: 0, z: 0 }, impactAt)
          // Crash-land into a dizzy chakkar-kha-ke wobble!
          .call(() => setCapturePose('dizzy'), [], impactAt);
        land(timeline, impactAt);
        timeline
          .to(
            tilt.rotation,
            { z: 0.25, duration: CAPTURE_DIZZY_DURATION * 0.18, ease: 'sine.inOut', yoyo: true, repeat: 4 },
            impactAt + 0.05,
          )
          .to(tilt.rotation, { x: 0, z: 0, duration: 0.12, ease: 'power2.out' });
        break;
      }

      case 'REACH_HOME': {
        if (lastEvent.pawnId !== id) break;
        takeStage();
        setTravelling(false);
        soundManager.playVictory();
        // Settle straight onto the picnic blanket at small sitting scale facing the player.
        timeline = gsap
          .timeline({ onComplete: done })
          .to(root.scale, { x: HOME_PICNIC_SCALE, y: HOME_PICNIC_SCALE, z: HOME_PICNIC_SCALE, duration: 0.3, ease: 'power2.out' }, 0)
          .to(root.rotation, { y: nearestAngle(root.rotation.y, layout.rotationY), duration: 0.3, ease: 'power2.out' }, 0)
          .to(squash.scale, { ...SQUASH, duration: 0.08, ease: 'power1.out' }, 0)
          .to(squash.scale, { ...NEUTRAL, duration: 0.25, ease: 'elastic.out(1, 0.45)' }, 0.08);
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
          .to(root.position, { x, z, duration: 0.28, ease }, 0)
          .to(root.scale, { x: scale, y: scale, z: scale, duration: 0.28, ease }, 0)
          .to(root.rotation, { y: nearestAngle(root.rotation.y, placement.rotationY), duration: 0.28, ease }, 0);
        break;
      }
    }

    return () => {
      timeline?.kill();
      setCapturePose('none');
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

  useFrame(({ clock }, rawDelta) => {
    const ring = ringRef.current;
    const squash = squashRef.current;
    if (!ring || !squash) return;
    // Pawns that can be clicked bounce on a pulsing ring so the choice is obvious.
    const dt = Math.min(rawDelta, 0.05);
    const alpha = 1 - Math.exp(-18 * dt);
    const beat = clock.elapsedTime * 6 + pawn.slot;
    const bounce = movable ? Math.abs(Math.sin(beat)) * 0.2 : 0;
    squash.position.y += (bounce - squash.position.y) * alpha;
    if (movable) {
      const pulse = 1 + Math.sin(beat) * 0.12;
      ring.scale.set(pulse, pulse, 1);
    }
  });

  const triggerSelectPawn = (event: ThreeEvent<MouseEvent | PointerEvent>) => {
    if (!movable) return;
    event.stopPropagation();
    const now = performance.now();
    if (now - lastSelectAtRef.current < 150) return;
    lastSelectAtRef.current = now;
    document.body.style.cursor = '';
    setHoveredPawn(null);
    selectPawn(pawn.id);
  };

  return (
    <group
      ref={rootRef}
      visible={!hiddenInYard}
      onPointerDown={(event) => {
        if (!movable) return;
        pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const down = pointerDownPosRef.current;
        pointerDownPosRef.current = null;
        if (!movable || !down) return;
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 14) {
          triggerSelectPawn(event);
        }
      }}
      onClick={triggerSelectPawn}
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
      {/* Generous invisible hit area so shrunken & mobile-tapped pawns stay effortless to select. */}
      <mesh position-y={0.85}>
        <cylinderGeometry args={[movable ? 0.62 : 0.5, movable ? 0.62 : 0.5, 1.75, 12]} />
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
            isSitting={isAtHome}
            picnicActivity={homeActivity}
            finalRank={validRank}
            isLastPlace={isLastPlace}
            isLaughing={capturePose === 'laugh'}
            isDizzy={capturePose === 'dizzy'}
            capturePose={capturePose}
          />
        </group>
      </group>
    </group>
  );
}
