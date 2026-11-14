import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  HOME_COLUMN_CELLS,
  LAST_TRACK_PROGRESS,
  SAFE_TRACK_INDICES,
  START_INDEX,
  TEAM_COLORS,
  TEAM_IDS,
  TILE_SURFACE_Y,
  TRACK_CELLS,
  YARD_ORIGINS,
  YARD_SLOT_POSITIONS,
  cellToWorld,
  getProgressPosition,
  type TeamId,
  type WorldPoint,
} from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import { BoardPreview } from './BoardPreview';
import { getPicnicBlanketTexture, getTeamEmblemTexture, getWoodTexture } from './boardTextures';
import { getAnimeToonMaterial } from './shaders/animeToonMaterial';

const WOOD = '#fff4e0';
const WOOD_RIM = '#f7e4c4';
const GROOVE_BED = '#e6cbb7';
const NEUTRAL = '#fff8f0';
const GOLD = '#ffc93c';
const INK = '#2b213a';

const TILE_HEIGHT = 0.1;
const TILE_Y = TILE_SURFACE_Y - TILE_HEIGHT / 2;
/** The rim stands taller than the tiles, so the whole play field reads as sunken into the wood. */
const RIM_TOP = 0.26;
const FIELD_HALF = 7.6;
const RIM_WIDTH = 0.9;

interface TileSpec extends WorldPoint {
  color: string;
}

function buildTiles(): TileSpec[] {
  const startTeamByIndex = new Map<number, TeamId>(TEAM_IDS.map((team) => [START_INDEX[team], team]));
  const track = TRACK_CELLS.map((cell, index) => {
    const team = startTeamByIndex.get(index);
    return { ...cellToWorld(cell), color: team ? TEAM_COLORS[team] : NEUTRAL };
  });
  const homeColumns = TEAM_IDS.flatMap((team) =>
    HOME_COLUMN_CELLS[team].map((cell) => ({ ...cellToWorld(cell), color: TEAM_COLORS[team] })),
  );
  return [...track, ...homeColumns];
}

function starShape(outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Upward-pointing chevron in XY plane (rotated -PI/2 on X to lie flat on the board). */
function chevronShape(size: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, size * 0.65);
  shape.lineTo(size * 0.65, -size * 0.25);
  shape.lineTo(size * 0.35, -size * 0.55);
  shape.lineTo(0, -size * 0.1);
  shape.lineTo(-size * 0.35, -size * 0.55);
  shape.lineTo(-size * 0.65, -size * 0.25);
  shape.closePath();
  return shape;
}

/** Cel-shaded pastel plastic with a rim glow in its own colour; one shared material per colour. */
function Acrylic({ color }: { color: string }) {
  return <primitive object={getAnimeToonMaterial(color)} attach="material" />;
}

/** Renders all tiles of a single colour in one GPU instanced draw call. */
function InstancedTileGroup({ color, tiles, geometry }: { color: string; tiles: TileSpec[]; geometry: THREE.BufferGeometry }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const material = useMemo(() => getAnimeToonMaterial(color), [color]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    tiles.forEach((tile, i) => {
      matrix.makeTranslation(tile.x, TILE_Y, tile.z);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles]);

  return <instancedMesh ref={meshRef} args={[geometry, material, tiles.length]} receiveShadow />;
}

function Tiles() {
  const geometry = useMemo(() => new RoundedBoxGeometry(0.9, TILE_HEIGHT, 0.9, 3, 0.035), []);
  const groups = useMemo(() => {
    const byColor = new Map<string, TileSpec[]>();
    for (const tile of buildTiles()) byColor.set(tile.color, [...(byColor.get(tile.color) ?? []), tile]);
    return [...byColor.entries()];
  }, []);

  return (
    <group>
      {groups.map(([color, tiles]) => (
        <InstancedTileGroup key={color} color={color} tiles={tiles} geometry={geometry} />
      ))}
    </group>
  );
}

function Stars() {
  const starGeo = useMemo(() => new THREE.ShapeGeometry(starShape(0.3, 0.13)), []);
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.31, 0.37, 28), []);
  const starMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 2.0, toneMapped: false }),
    [],
  );

  useFrame(({ clock }) => {
    starMat.emissiveIntensity = 2.0 + Math.sin(clock.elapsedTime * 2.2) * 0.65;
  });

  return (
    <group>
      {SAFE_TRACK_INDICES.map((index) => {
        const { x, z } = cellToWorld(TRACK_CELLS[index]);
        return (
          <group key={index} position={[x, TILE_SURFACE_Y + 0.005, z]}>
            <mesh geometry={ringGeo} rotation-x={-Math.PI / 2}>
              <meshBasicMaterial color={INK} transparent opacity={0.22} />
            </mesh>
            <mesh geometry={starGeo} material={starMat} position-y={0.002} rotation-x={-Math.PI / 2} />
          </group>
        );
      })}
    </group>
  );
}

const ENTER_ARROW_COLORS: Record<TeamId, string> = {
  PINK: '#ff4d7e',
  CYAN: '#1fb6b8',
  YELLOW: '#e59500',
  MINT: '#2eb866',
};

/** Directional chevrons on start tiles, home-column entrances, and home lanes. */
function TrackArrows() {
  const chevronGeo = useMemo(() => new THREE.ShapeGeometry(chevronShape(0.24)), []);
  const smallChevronGeo = useMemo(() => new THREE.ShapeGeometry(chevronShape(0.16)), []);

  const markers = useMemo(() => {
    const list: { key: string; x: number; z: number; rotY: number; color: string; small?: boolean }[] = [];

    for (const team of TEAM_IDS) {
      // Clockwise flow arrow just beside the start star.
      const startPos = getProgressPosition(team, 0);
      const nextPos = getProgressPosition(team, 1);
      const startYaw = Math.atan2(nextPos.x - startPos.x, -(nextPos.z - startPos.z));
      list.push({
        key: `start-${team}`,
        x: startPos.x + (nextPos.x - startPos.x) * 0.34,
        z: startPos.z + (nextPos.z - startPos.z) * 0.34,
        rotY: -startYaw,
        color: '#ffffff',
        small: true,
      });

      // Home-entrance turn-in arrow pointing into each team's private lane.
      const enterPos = getProgressPosition(team, LAST_TRACK_PROGRESS);
      const lanePos = getProgressPosition(team, LAST_TRACK_PROGRESS + 1);
      const enterYaw = Math.atan2(lanePos.x - enterPos.x, -(lanePos.z - enterPos.z));
      list.push({
        key: `enter-${team}`,
        x: enterPos.x,
        z: enterPos.z,
        rotY: -enterYaw,
        color: ENTER_ARROW_COLORS[team],
      });

      // Subtle guide chevrons down the home lane toward the center goal.
      for (let step = 1; step <= 4; step++) {
        const pos = getProgressPosition(team, LAST_TRACK_PROGRESS + step);
        list.push({
          key: `lane-${team}-${step}`,
          x: pos.x,
          z: pos.z,
          rotY: -enterYaw,
          color: '#ffffff',
          small: true,
        });
      }
    }
    return list;
  }, []);

  return (
    <group>
      {markers.map((m) => (
        <mesh
          key={m.key}
          geometry={m.small ? smallChevronGeo : chevronGeo}
          position={[m.x, TILE_SURFACE_Y + 0.004, m.z]}
          rotation={[-Math.PI / 2, 0, m.rotY]}
        >
          <meshBasicMaterial color={m.color} transparent opacity={m.small ? 0.55 : 0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Yard({ team }: { team: TeamId }) {
  const origin = YARD_ORIGINS[team];
  const centre = cellToWorld({ row: origin.row + 2.5, col: origin.col + 2.5 });
  const color = TEAM_COLORS[team];
  const emblemTexture = useMemo(() => getTeamEmblemTexture(team), [team]);
  const spawnReadyRef = useRef<THREE.Group>(null);

  const canSpawnHere = useGameStore(
    (s) =>
      !s.isAnimating &&
      s.game.phase === 'MOVE' &&
      s.game.currentTeam === team &&
      s.legalMoves.some((id) => {
        const pawn = s.game.pawns.find((p) => p.id === id);
        return pawn && pawn.progress === -1;
      }),
  );

  useFrame(({ clock }) => {
    const group = spawnReadyRef.current;
    if (!group) return;
    const pulse = canSpawnHere ? 1 + Math.sin(clock.elapsedTime * 7) * 0.09 : 1;
    group.children.forEach((child) => {
      child.scale.set(pulse, pulse, 1);
    });
  });

  return (
    <group>
      {/* Outer team-colored yard base */}
      <RoundedBox args={[5.8, 0.07, 5.8]} radius={0.03} position={[centre.x, 0.035, centre.z]} receiveShadow>
        <Acrylic color={color} />
      </RoundedBox>
      {/* Ink trim frame around the inner pad */}
      <RoundedBox args={[4.16, 0.044, 4.16]} radius={0.012} position={[centre.x, 0.072, centre.z]} receiveShadow>
        <meshStandardMaterial color={INK} roughness={0.85} />
      </RoundedBox>
      {/* Inner cream pad */}
      <RoundedBox args={[3.96, 0.03, 3.96]} radius={0.012} position={[centre.x, 0.08, centre.z]} receiveShadow>
        <Acrylic color={NEUTRAL} />
      </RoundedBox>
      {/* Subtle mascot emblem watermark */}
      <mesh position={[centre.x, TILE_SURFACE_Y - 0.002, centre.z]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1.85, 1.85]} />
        <meshBasicMaterial map={emblemTexture} transparent depthWrite={false} />
      </mesh>
      {/* Pawn cradles with spawn-ready pulse rings */}
      <group ref={spawnReadyRef}>
        {YARD_SLOT_POSITIONS[team].map((slot, i) => (
          <group key={i} position={[slot.x, TILE_SURFACE_Y - 0.002, slot.z]}>
            <mesh receiveShadow>
              <cylinderGeometry args={[0.5, 0.5, 0.014, 36]} />
              <Acrylic color={color} />
            </mesh>
            <mesh position-y={0.009} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[0.45, 0.53, 32]} />
              <meshBasicMaterial
                color={canSpawnHere ? GOLD : INK}
                transparent
                opacity={canSpawnHere ? 0.9 : 0.25}
                toneMapped={!canSpawnHere}
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

/** One team's triangular wedge of the 3x3 centre floor, pointing at the middle. */
function wedgeGeometry(team: TeamId): THREE.BufferGeometry {
  const h = 1.45;
  const corners: Record<TeamId, [number, number, number, number]> = {
    PINK: [-h, h, -h, -h],
    CYAN: [-h, -h, h, -h],
    YELLOW: [h, -h, h, h],
    MINT: [h, h, -h, h],
  };
  const [ax, az, bx, bz] = corners[team];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, bx, 0, bz, ax, 0, az], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  return geometry;
}

const STONE_ANGLES = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);

/** The 3x3 Home picnic clearing: four coloured wedges, gingham blanket, animated bonfire & snacks. */
function HomeCentre() {
  const wedges = useMemo(() => TEAM_IDS.map((team) => ({ team, geometry: wedgeGeometry(team) })), []);
  const blanketMap = useMemo(() => getPicnicBlanketTexture(), []);
  const flameMainRef = useRef<THREE.Mesh>(null);
  const flameLeftRef = useRef<THREE.Mesh>(null);
  const flameRightRef = useRef<THREE.Mesh>(null);
  const emberRef = useRef<THREE.Mesh>(null);
  const fireLightRef = useRef<THREE.PointLight>(null);
  const radioRef = useRef<THREE.Group>(null);
  const speakerLRef = useRef<THREE.Mesh>(null);
  const speakerRRef = useRef<THREE.Mesh>(null);
  const reelLRef = useRef<THREE.Group>(null);
  const reelRRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (flameMainRef.current) {
      flameMainRef.current.scale.set(1 + Math.sin(t * 9) * 0.08, 1 + Math.sin(t * 11.5) * 0.14, 1 + Math.cos(t * 8) * 0.08);
      flameMainRef.current.rotation.z = Math.sin(t * 6.5) * 0.09;
    }
    if (flameLeftRef.current) {
      flameLeftRef.current.scale.setScalar(1 + Math.cos(t * 10.2) * 0.12);
      flameLeftRef.current.rotation.z = 0.25 + Math.sin(t * 7.8) * 0.1;
    }
    if (flameRightRef.current) {
      flameRightRef.current.scale.setScalar(1 + Math.sin(t * 8.7 + 1.2) * 0.12);
      flameRightRef.current.rotation.z = -0.25 + Math.cos(t * 7.1) * 0.1;
    }
    if (emberRef.current) {
      (emberRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.45 + Math.sin(t * 7) * 0.25;
    }
    if (fireLightRef.current) {
      fireLightRef.current.intensity = 0.55 + Math.sin(t * 8.5) * 0.12;
    }
    // Visual-only retro cassette radio groove (zero sound).
    const beat = Math.pow(Math.abs(Math.sin(t * 7.2)), 2);
    if (radioRef.current) {
      radioRef.current.position.y = TILE_SURFACE_Y + 0.012 + beat * 0.016;
      radioRef.current.scale.set(1 + beat * 0.04, 1 - beat * 0.045, 1 + beat * 0.04);
      radioRef.current.rotation.z = Math.sin(t * 3.6) * 0.055;
    }
    if (speakerLRef.current) speakerLRef.current.scale.setScalar(1 + beat * 0.22);
    if (speakerRRef.current) speakerRRef.current.scale.setScalar(1 + beat * 0.22);
    if (reelLRef.current) reelLRef.current.rotation.z = -t * 4.5;
    if (reelRRef.current) reelRRef.current.rotation.z = -t * 4.5;
  });

  return (
    <group>
      {wedges.map(({ team, geometry }) => (
        <mesh key={team} geometry={geometry} position-y={TILE_SURFACE_Y} receiveShadow>
          <Acrylic color={TEAM_COLORS[team]} />
        </mesh>
      ))}
      {/* Diagonal ink dividers separating the four team picnic wedges */}
      {[Math.PI / 4, -Math.PI / 4].map((angle, idx) => (
        <mesh key={idx} position={[0, TILE_SURFACE_Y + 0.004, 0]} rotation-y={angle}>
          <boxGeometry args={[4.06, 0.008, 0.045]} />
          <meshBasicMaterial color={INK} transparent opacity={0.22} />
        </mesh>
      ))}

      {/* Cozy pastel gingham picnic blanket in the middle */}
      <group position={[0, TILE_SURFACE_Y + 0.007, 0]}>
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[0.88, 36]} />
          <meshStandardMaterial map={blanketMap} roughness={0.85} />
        </mesh>
        <mesh position-y={0.001} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.85, 0.89, 36]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      </group>

      {/* Central miniature bonfire */}
      <group position={[0, TILE_SURFACE_Y + 0.01, 0]}>
        {/* River stone ring */}
        {STONE_ANGLES.map((angle, i) => (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.2, 0.028, Math.sin(angle) * 0.2]}
            scale={[1, 0.68, 0.9]}
            receiveShadow
          >
            <sphereGeometry args={[0.048, 10, 8]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#a89f99' : '#8f8681'} roughness={0.85} />
          </mesh>
        ))}

        {/* Crossed campfire logs */}
        {[0, Math.PI / 2, Math.PI / 4, -Math.PI / 4].map((rot, idx) => (
          <mesh
            key={idx}
            position={[0, 0.048 + (idx % 2) * 0.015, 0]}
            rotation={[Math.PI / 2 - 0.22, rot, 0]}
            castShadow
          >
            <capsuleGeometry args={[0.024, 0.24, 4, 8]} />
            <meshStandardMaterial color={idx % 2 === 0 ? '#8c5a3c' : '#6f432a'} roughness={0.9} />
          </mesh>
        ))}

        {/* Warm glowing ember bed */}
        <mesh ref={emberRef} position={[0, 0.045, 0]} scale={[1, 0.45, 1]}>
          <sphereGeometry args={[0.11, 12, 10]} />
          <meshStandardMaterial color="#ff5a36" emissive="#ff6b2b" emissiveIntensity={1.45} toneMapped={false} />
        </mesh>

        {/* Stylized flickering flames */}
        <mesh ref={flameMainRef} position={[0, 0.16, 0]}>
          <coneGeometry args={[0.082, 0.24, 10]} />
          <meshStandardMaterial color="#ffd166" emissive="#ff9f1c" emissiveIntensity={1.7} toneMapped={false} />
        </mesh>
        <mesh ref={flameLeftRef} position={[-0.045, 0.13, 0.02]} rotation-z={0.25}>
          <coneGeometry args={[0.05, 0.16, 8]} />
          <meshStandardMaterial color="#ff6b6b" emissive="#ff5436" emissiveIntensity={1.55} toneMapped={false} />
        </mesh>
        <mesh ref={flameRightRef} position={[0.045, 0.13, -0.02]} rotation-z={-0.25}>
          <coneGeometry args={[0.05, 0.16, 8]} />
          <meshStandardMaterial color="#ff9f1c" emissive="#ff7b29" emissiveIntensity={1.55} toneMapped={false} />
        </mesh>

        <pointLight ref={fireLightRef} position={[0, 0.35, 0]} color="#ff9e44" intensity={0.55} distance={2.8} decay={2} />
      </group>

      {/* Picnic props placed neatly on the 4 diagonals so they never overlap pawn seats */}
      {/* 1. Woven Picnic Basket (-X, -Z) */}
      <group position={[-0.48, TILE_SURFACE_Y + 0.012, -0.48]} rotation-y={0.45}>
        <mesh position-y={0.055} castShadow>
          <boxGeometry args={[0.19, 0.11, 0.14]} />
          <meshStandardMaterial color="#d49b57" roughness={0.8} />
        </mesh>
        <mesh position-y={0.112}>
          <boxGeometry args={[0.205, 0.02, 0.155]} />
          <meshStandardMaterial color="#b97f3d" roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.115, 0]} rotation-z={Math.PI / 2}>
          <torusGeometry args={[0.068, 0.01, 6, 14, Math.PI]} />
          <meshStandardMaterial color="#8c5a3c" roughness={0.75} />
        </mesh>
      </group>

      {/* 2. Cake & Berries Plate (+X, -Z) */}
      <group position={[0.48, TILE_SURFACE_Y + 0.012, -0.48]}>
        <mesh position-y={0.012} receiveShadow>
          <cylinderGeometry args={[0.11, 0.095, 0.018, 16]} />
          <meshStandardMaterial color="#fffaf5" roughness={0.3} />
        </mesh>
        <mesh position-y={0.042} castShadow>
          <cylinderGeometry args={[0.068, 0.072, 0.048, 14]} />
          <meshStandardMaterial color="#ffe5b4" roughness={0.65} />
        </mesh>
        <mesh position-y={0.068}>
          <cylinderGeometry args={[0.07, 0.07, 0.014, 14]} />
          <meshStandardMaterial color="#ff8fab" roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.088, 0]}>
          <sphereGeometry args={[0.02, 10, 8]} />
          <meshStandardMaterial color="#e63946" roughness={0.35} />
        </mesh>
      </group>

      {/* 3. Coffee Thermos & Cup (+X, +Z) */}
      <group position={[0.48, TILE_SURFACE_Y + 0.012, 0.48]} rotation-y={-0.6}>
        <mesh position={[-0.035, 0.065, 0]} castShadow>
          <cylinderGeometry args={[0.036, 0.04, 0.13, 14]} />
          <meshStandardMaterial color="#72efdd" roughness={0.35} />
        </mesh>
        <mesh position={[-0.035, 0.135, 0]}>
          <cylinderGeometry args={[0.038, 0.038, 0.025, 14]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        <mesh position={[0.045, 0.028, 0.02]} castShadow>
          <cylinderGeometry args={[0.028, 0.022, 0.052, 12]} />
          <meshStandardMaterial color="#ffd166" roughness={0.3} />
        </mesh>
      </group>

      {/* 4. Cozy Snack Tray & Marshmallow Box beside basket (-X, -Z) */}
      <group position={[-0.26, TILE_SURFACE_Y + 0.012, -0.56]} rotation-y={0.2}>
        <mesh position-y={0.02} castShadow>
          <boxGeometry args={[0.14, 0.032, 0.1]} />
          <meshStandardMaterial color="#ffb5c5" roughness={0.5} />
        </mesh>
        {[-0.03, 0.03].map((ox, i) => (
          <mesh key={i} position={[ox, 0.044, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.018, 0.018, 0.032, 10]} />
            <meshStandardMaterial color="#ffffff" roughness={0.6} />
          </mesh>
        ))}
      </group>

      {/* 5. Animated Retro Cassette Radio (-X, +Z) — visual groove only, zero audio */}
      <group ref={radioRef} position={[-0.46, TILE_SURFACE_Y + 0.012, 0.46]} rotation-y={0.65}>
        {/* Boombox body */}
        <mesh position-y={0.075} castShadow>
          <boxGeometry args={[0.28, 0.14, 0.1]} />
          <meshStandardMaterial color="#4ecdc4" roughness={0.45} />
        </mesh>
        {/* Top trim & carrying handle */}
        <mesh position-y={0.148}>
          <boxGeometry args={[0.26, 0.016, 0.09]} />
          <meshStandardMaterial color="#ffe66d" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.155, 0]}>
          <torusGeometry args={[0.055, 0.008, 6, 14, Math.PI]} />
          <meshStandardMaterial color="#2b213a" roughness={0.5} />
        </mesh>
        {/* Slanted antenna */}
        <mesh position={[-0.1, 0.21, -0.025]} rotation-z={0.22}>
          <cylinderGeometry args={[0.004, 0.004, 0.14, 6]} />
          <meshStandardMaterial color="#d8dee9" metalness={0.5} roughness={0.3} />
        </mesh>
        {/* Thumping left & right speaker grilles */}
        <mesh ref={speakerLRef} position={[-0.088, 0.072, 0.052]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.036, 0.036, 0.01, 16]} />
          <meshStandardMaterial color="#2b213a" roughness={0.55} />
        </mesh>
        <mesh ref={speakerRRef} position={[0.088, 0.072, 0.052]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.036, 0.036, 0.01, 16]} />
          <meshStandardMaterial color="#2b213a" roughness={0.55} />
        </mesh>
        {/* Cassette deck window & spinning reels */}
        <mesh position={[0, 0.068, 0.051]}>
          <boxGeometry args={[0.085, 0.056, 0.008]} />
          <meshStandardMaterial color="#fff8f0" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.068, 0.055]}>
          <boxGeometry args={[0.064, 0.034, 0.004]} />
          <meshStandardMaterial color="#3b2f4d" roughness={0.5} />
        </mesh>
        <group ref={reelLRef} position={[-0.017, 0.068, 0.058]}>
          <mesh>
            <ringGeometry args={[0.005, 0.012, 12]} />
            <meshBasicMaterial color="#ffd166" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.02, 0.003, 0.002]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
        <group ref={reelRRef} position={[0.017, 0.068, 0.058]}>
          <mesh>
            <ringGeometry args={[0.005, 0.012, 12]} />
            <meshBasicMaterial color="#ffd166" />
          </mesh>
          <mesh>
            <boxGeometry args={[0.02, 0.003, 0.002]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
        {/* Glowing power / play indicator */}
        <mesh position={[0, 0.116, 0.052]}>
          <sphereGeometry args={[0.008, 8, 8]} />
          <meshStandardMaterial color="#ff5d8f" emissive="#ff5d8f" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function WoodBase() {
  const span = FIELD_HALF * 2 + RIM_WIDTH * 2;
  const rimY = RIM_TOP / 2;
  const rimOffset = FIELD_HALF + RIM_WIDTH / 2;
  const woodMap = useMemo(() => getWoodTexture(), []);
  const cornerPinOffset = FIELD_HALF + RIM_WIDTH * 0.5;

  return (
    <group>
      {/* Shadow-only tabletop catcher so the board's shadow blends seamlessly into #ffeef4 */}
      <mesh position-y={-0.805} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[44, 44]} />
        <shadowMaterial transparent opacity={0.12} color="#2b213a" />
      </mesh>
      {/* Main wooden slab */}
      <RoundedBox args={[span, 0.8, span]} radius={0.3} smoothness={5} position-y={-0.4} receiveShadow castShadow>
        <meshStandardMaterial color={WOOD} map={woodMap} roughness={0.62} />
      </RoundedBox>
      {/* Sunken playfield liner bed under tiles */}
      <mesh position={[0, 0.006, 0]} receiveShadow>
        <boxGeometry args={[FIELD_HALF * 2 - 0.1, 0.012, FIELD_HALF * 2 - 0.1]} />
        <meshStandardMaterial color={GROOVE_BED} roughness={0.85} />
      </mesh>
      {/* Raised wooden rim */}
      {[-1, 1].map((side) => (
        <group key={side}>
          <RoundedBox args={[span, RIM_TOP, RIM_WIDTH]} radius={0.12} position={[0, rimY, side * rimOffset]} receiveShadow castShadow>
            <meshStandardMaterial color={WOOD_RIM} map={woodMap} roughness={0.58} />
          </RoundedBox>
          <RoundedBox args={[RIM_WIDTH, RIM_TOP, span]} radius={0.12} position={[side * rimOffset, rimY, 0]} receiveShadow castShadow>
            <meshStandardMaterial color={WOOD_RIM} map={woodMap} roughness={0.58} />
          </RoundedBox>
        </group>
      ))}
      {/* Four corner brass/ink inlay studs */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <group key={`${sx},${sz}`} position={[sx * cornerPinOffset, RIM_TOP + 0.004, sz * cornerPinOffset]}>
            <mesh>
              <cylinderGeometry args={[0.2, 0.22, 0.015, 24]} />
              <meshStandardMaterial color={INK} roughness={0.7} />
            </mesh>
            <mesh position-y={0.005}>
              <cylinderGeometry args={[0.15, 0.16, 0.015, 24]} />
              <meshStandardMaterial color={GOLD} roughness={0.35} metalness={0.25} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

export function BoardMesh() {
  return (
    <group>
      <WoodBase />
      <Tiles />
      <TrackArrows />
      <Stars />
      {TEAM_IDS.map((team) => (
        <Yard key={team} team={team} />
      ))}
      <HomeCentre />
      <BoardPreview />
    </group>
  );
}
