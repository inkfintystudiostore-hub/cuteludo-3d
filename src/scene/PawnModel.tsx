/**
 * Picks what a pawn looks like:
 *   1. Per-character GLTF `/models/pawn_<team>_<slot>.glb` (e.g. pawn_pink_0.glb)
 *   2. Per-team GLTF `/models/pawn_<team>.glb` (e.g. pawn_pink.glb)
 *   3. Built-in high-detail procedural anime kid character (`ChibiFigure`)
 *
 * A missing or broken file never takes the game down.
 */
import { Component, Suspense, use, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TEAM_COLORS, type TeamId } from '../engine/boardMap';
import { ChibiFigure, type PicnicActivity } from './ChibiFigure';
import { applyAnimeToon } from './shaders/animeToonMaterial';

/** Animation clips a pawn model may provide. Missing clips fall back to Idle, then to none. */
export type PawnClip = 'Idle' | 'Hop' | 'SipCoffee' | 'Picnic';

/** Matches the procedural anime character (5% smaller overall) so mixed teams look consistent. */
const MODEL_HEIGHT = 1.55 * 0.95;
const CROSSFADE = 0.25;

const STATIC_MODEL_PATHS = new Set(
  Object.keys(import.meta.glob('/public/models/*.glb')).map((p) => p.replace(/^\/public/, '')),
);
const resolvedUrls = new Map<string, Promise<string | null>>();

/** Checks build-indexed custom `.glb` assets in `/public/models` without firing noisy 404 HEAD requests. */
function modelExists(url: string): Promise<boolean> {
  return Promise.resolve(STATIC_MODEL_PATHS.has(url));
}

/** Resolves the highest-priority custom GLB available for (team, slot), or null for procedural fallback. */
function resolveModelUrl(team: TeamId, slot: number): Promise<string | null> {
  const key = `${team}:${slot}`;
  let pending = resolvedUrls.get(key);
  if (!pending) {
    const t = team.toLowerCase();
    const perSlot = `/models/pawn_${t}_${slot}.glb`;
    const perTeam = `/models/pawn_${t}.glb`;
    pending = modelExists(perSlot).then((hasSlot) => {
      if (hasSlot) return perSlot;
      return modelExists(perTeam).then((hasTeam) => (hasTeam ? perTeam : null));
    });
    resolvedUrls.set(key, pending);
  }
  return pending;
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Pawn model failed to load; using the built-in anime figure instead.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function GltfFigure({ url, team, clip }: { url: string; team: TeamId; clip: PawnClip }) {
  const gltf = useGLTF(url);
  const rootRef = useRef<THREE.Group>(null);

  // Each pawn needs its own skeleton, so clone; boost texture anisotropy for 4K clarity; fit to standard height.
  const { model, scale, offset } = useMemo(() => {
    const model = cloneSkinned(gltf.scene);
    applyAnimeToon(model, TEAM_COLORS[team]);
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const textured = m as THREE.MeshStandardMaterial;
        if (textured.map) textured.map.anisotropy = 8;
      }
    });
    const box = new THREE.Box3().setFromObject(model);
    const height = box.max.y - box.min.y;
    const scale = height > 0 ? MODEL_HEIGHT / height : 1;
    const centre = box.getCenter(new THREE.Vector3());
    // Feet on the ground, centred over the tile.
    const offset: [number, number, number] = [-centre.x * scale, -box.min.y * scale, -centre.z * scale];
    return { model, scale, offset };
  }, [gltf.scene, team]);

  const { actions } = useAnimations(gltf.animations, rootRef);

  useEffect(() => {
    const action = actions[clip] ?? actions.Idle;
    if (!action) return;
    action.reset().fadeIn(CROSSFADE).play();
    return () => {
      action.fadeOut(CROSSFADE);
    };
  }, [actions, clip]);

  return (
    <group ref={rootRef} position={offset} scale={scale}>
      <primitive object={model} />
    </group>
  );
}

function ResolvedFigure({ team, slot, clip, holdingCup, isMovable, isHovered, isSitting, picnicActivity, finalRank, isLastPlace, isLaughing, isDizzy }: PawnModelProps) {
  const url = use(resolveModelUrl(team, slot));
  return url ? (
    <GltfFigure url={url} team={team} clip={clip} />
  ) : (
    <ChibiFigure
      team={team}
      slot={slot}
      holdingCup={holdingCup}
      isMovable={isMovable}
      isHovered={isHovered}
      isSitting={isSitting}
      picnicActivity={picnicActivity}
      finalRank={finalRank}
      isLastPlace={isLastPlace}
      isLaughing={isLaughing}
      isDizzy={isDizzy}
    />
  );
}

interface PawnModelProps {
  team: TeamId;
  /** Yard slot 0..3; gives each of a team's pawns its own character and optional .glb slot. */
  slot: number;
  clip: PawnClip;
  /** Only the procedural figure shows a cup; GLTF models express this through the SipCoffee clip. */
  holdingCup: boolean;
  isMovable?: boolean;
  isHovered?: boolean;
  isSitting?: boolean;
  picnicActivity?: PicnicActivity;
  finalRank?: number | null;
  isLastPlace?: boolean;
  isLaughing?: boolean;
  isDizzy?: boolean;
}

export function PawnModel(props: PawnModelProps) {
  const fallback = (
    <ChibiFigure
      team={props.team}
      slot={props.slot}
      holdingCup={props.holdingCup}
      isMovable={props.isMovable}
      isHovered={props.isHovered}
      isSitting={props.isSitting}
      picnicActivity={props.picnicActivity}
      finalRank={props.finalRank}
      isLastPlace={props.isLastPlace}
      isLaughing={props.isLaughing}
      isDizzy={props.isDizzy}
    />
  );
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ResolvedFigure {...props} />
      </Suspense>
    </ModelErrorBoundary>
  );
}
