/**
 * Interactive 3D move-preview overlay on the board: highlights the exact stepping path
 * and landing tile when a player hovers/focuses a movable pawn (or when only one move is legal).
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TEAM_COLORS, TILE_SURFACE_Y, YARD_SLOT_POSITIONS } from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import { getMovePreview } from '../engine/ludoRules';

const CAPTURE_COLOR = '#ff3b6b';
const HOME_COLOR = '#ffc93c';
const SAFE_COLOR = '#2ec4b6';

export function BoardPreview() {
  const game = useGameStore((s) => s.game);
  const legalMoves = useGameStore((s) => s.legalMoves);
  const hoveredPawnId = useGameStore((s) => s.hoveredPawnId);
  const isAnimating = useGameStore((s) => s.isAnimating);

  const ringRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const dotsRef = useRef<THREE.Group>(null);

  const activePawnId = useMemo(() => {
    if (isAnimating || game.phase !== 'MOVE' || legalMoves.length === 0) return null;
    if (hoveredPawnId && legalMoves.includes(hoveredPawnId)) return hoveredPawnId;
    if (legalMoves.length === 1) return legalMoves[0];
    return null;
  }, [isAnimating, game.phase, legalMoves, hoveredPawnId]);

  const preview = useMemo(() => (activePawnId ? getMovePreview(game, activePawnId) : null), [game, activePawnId]);

  const breadcrumbs = useMemo(() => {
    if (!preview) return [];
    if (preview.kind === 'SPAWN') {
      const pawn = game.pawns.find((p) => p.id === preview.pawnId);
      if (!pawn) return [];
      const from = YARD_SLOT_POSITIONS[pawn.team][pawn.slot];
      const to = preview.destination;
      return [
        { x: THREE.MathUtils.lerp(from.x, to.x, 0.35), z: THREE.MathUtils.lerp(from.z, to.z, 0.35) },
        { x: THREE.MathUtils.lerp(from.x, to.x, 0.7), z: THREE.MathUtils.lerp(from.z, to.z, 0.7) },
      ];
    }
    return preview.waypoints.slice(0, -1);
  }, [preview, game.pawns]);

  const accentColor = useMemo(() => {
    if (!preview) return '#ffffff';
    if (preview.willCapture.length > 0) return CAPTURE_COLOR;
    if (preview.reachesHome) return HOME_COLOR;
    if (preview.isSafeLanding) return SAFE_COLOR;
    return TEAM_COLORS[game.currentTeam];
  }, [preview, game.currentTeam]);

  useFrame(({ clock }) => {
    if (!preview) return;
    const t = clock.elapsedTime;
    if (ringRef.current) {
      const pulse = 1 + Math.sin(t * 6) * 0.1;
      ringRef.current.scale.set(pulse, pulse, 1);
    }
    if (outerRingRef.current) {
      const wave = 1 + Math.sin(t * 6 + Math.PI * 0.5) * 0.16;
      outerRingRef.current.scale.set(wave, wave, 1);
      outerRingRef.current.rotation.z = t * 1.4;
    }
    if (dotsRef.current) {
      dotsRef.current.children.forEach((child, index) => {
        const s = 0.85 + Math.sin(t * 7 - index * 0.7) * 0.25;
        child.scale.setScalar(s);
      });
    }
  });

  if (!preview) return null;
  const isCapture = preview.willCapture.length > 0;

  return (
    <group>
      {/* Stepping-stone breadcrumbs along the path */}
      <group ref={dotsRef}>
        {breadcrumbs.map((pt, idx) => (
          <mesh key={`${pt.x},${pt.z},${idx}`} position={[pt.x, TILE_SURFACE_Y + 0.014, pt.z]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.13, 20]} />
            <meshBasicMaterial color={accentColor} transparent opacity={0.85} toneMapped={false} />
          </mesh>
        ))}
      </group>

      {/* Landing target reticle */}
      <group position={[preview.destination.x, TILE_SURFACE_Y + 0.018, preview.destination.z]}>
        <mesh ref={ringRef} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.28, 0.42, 32]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        <mesh ref={outerRingRef} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.45, 0.5, isCapture ? 6 : 32]} />
          <meshBasicMaterial color={isCapture ? '#2b213a' : accentColor} transparent opacity={isCapture ? 0.85 : 0.55} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
