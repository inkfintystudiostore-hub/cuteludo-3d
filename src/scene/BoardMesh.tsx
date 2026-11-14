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
import { getTeamEmblemTexture, getWoodTexture } from './boardTextures';
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

/** The 3x3 Home goal in the middle: four coloured wedges, ink dividers, and a central crest. */
function HomeCentre() {
  const wedges = useMemo(() => TEAM_IDS.map((team) => ({ team, geometry: wedgeGeometry(team) })), []);
  const crestStar = useMemo(() => new THREE.ShapeGeometry(starShape(0.22, 0.1)), []);

  return (
    <group>
      {wedges.map(({ team, geometry }) => (
        <mesh key={team} geometry={geometry} position-y={TILE_SURFACE_Y} receiveShadow>
          <Acrylic color={TEAM_COLORS[team]} />
        </mesh>
      ))}
      {/* Diagonal ink dividers separating the four goal triangles */}
      {[Math.PI / 4, -Math.PI / 4].map((angle, idx) => (
        <mesh key={idx} position={[0, TILE_SURFACE_Y + 0.004, 0]} rotation-y={angle}>
          <boxGeometry args={[4.06, 0.008, 0.045]} />
          <meshBasicMaterial color={INK} transparent opacity={0.32} />
        </mesh>
      ))}
      {/* Central jewel medallion (stays well inside the ±0.85 goal pawn spots) */}
      <group position={[0, TILE_SURFACE_Y + 0.02, 0]}>
        <mesh receiveShadow castShadow>
          <cylinderGeometry args={[0.34, 0.38, 0.04, 32]} />
          <meshStandardMaterial color={INK} roughness={0.6} />
        </mesh>
        <mesh position-y={0.022} receiveShadow>
          <cylinderGeometry args={[0.29, 0.31, 0.02, 32]} />
          <meshStandardMaterial color="#fff8f0" roughness={0.4} />
        </mesh>
        <mesh geometry={crestStar} position-y={0.036} rotation-x={-Math.PI / 2}>
          <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={1.6} toneMapped={false} />
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
