/**
 * High-detail 4K smooth 3D animal figurines with distinct team species
 * (Pink Kitty, Cyan Bunny, Yellow Bear, Mint Froggy) and four per-slot
 * color tones, crafted accessories, and lively personalities
 * (Sunny, Professor, Sleepy, Rascal).
 *
 * Feet sit at y = 0 and face looks along +Z so PawnModel can swap with .glb files.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TEAM_COLORS, TEAM_IDS, type TeamId } from '../engine/boardMap';
import {
  getAnimalHeadGeometry,
  getAnimalTorsoGeometry,
  getArmGeometry,
  getBearEarGeometry,
  getBeretGeometry,
  getBunnyEarGeometry,
  getCatEarGeometry,
  getCatTailGeometry,
  getFootGeometry,
  getScarfTieGeometry,
  getWhiskerGeometry,
  type AnimalSpecies,
} from './characterGeometry';
import { getAnimalCoatTexture, getAnimalFurBumpTexture, getAnimeEyeTexture, type EyeMood } from './characterTextures';

const BELLY_CREAM = '#fff6eb';
const INNER_EAR = '#ffc6d5';
const INK = '#2b213a';
const BLUSH = '#ff85a1';
const LEAF = '#40b883';
const GOLD_METAL = '#f4c95d';
const FIGURE_SCALE = 1.48;

const TEAM_SPECIES: Record<TeamId, AnimalSpecies> = {
  PINK: 'cat',
  CYAN: 'bunny',
  YELLOW: 'bear',
  MINT: 'frog',
};

export const CHARACTER_PROFILES = [
  {
    name: 'Sunny',
    role: 'Cheerful Leader',
    shade: 0,
    belly: '#fff9f0',
    accent: '#ff4d79',
    accessory: 'scarf' as const,
    eyeMood: 'sparkle' as EyeMood,
    iris: '#2e2242',
    mouth: 'smile' as const,
    winkRight: false,
    sway: 0.08,
    look: 0.28,
    nod: 0.03,
    hipWiggle: 0.09,
    blinkEvery: 3.3,
    tempo: 1.45,
  },
  {
    name: 'Professor',
    role: 'Smart Tactician',
    shade: 0.32,
    belly: '#ffffff',
    accent: '#2f7df6',
    accessory: 'glasses' as const,
    eyeMood: 'sharp' as EyeMood,
    iris: '#2b4a8f',
    mouth: 'small' as const,
    winkRight: false,
    sway: 0.035,
    look: 0.16,
    nod: 0.05,
    hipWiggle: 0.02,
    blinkEvery: 4.6,
    tempo: 0.85,
  },
  {
    name: 'Sleepy',
    role: 'Cozy Dreamer',
    shade: -0.22,
    belly: '#fff0e0',
    accent: '#f77f00',
    accessory: 'beret' as const,
    eyeMood: 'sleepy' as EyeMood,
    iris: '#3b2c4e',
    mouth: 'o' as const,
    winkRight: false,
    sway: 0.025,
    look: 0.08,
    nod: 0.1,
    hipWiggle: 0.015,
    blinkEvery: 2.5,
    tempo: 0.6,
  },
  {
    name: 'Rascal',
    role: 'Playful Rockstar',
    shade: 0.12,
    belly: '#f7e4ff',
    accent: '#7b2cbf',
    accessory: 'headphones' as const,
    eyeMood: 'cheeky' as EyeMood,
    iris: '#6a2c91',
    mouth: 'grin' as const,
    winkRight: true,
    sway: 0.11,
    look: 0.38,
    nod: 0.04,
    hipWiggle: 0.12,
    blinkEvery: 3.8,
    tempo: 1.75,
  },
] as const;

type Accessory = (typeof CHARACTER_PROFILES)[number]['accessory'];
type MouthKind = (typeof CHARACTER_PROFILES)[number]['mouth'];

const coatMatCache = new Map<string, THREE.MeshPhysicalMaterial>();
const satinMatCache = new Map<string, THREE.MeshPhysicalMaterial>();
const glossyMatCache = new Map<string, THREE.MeshPhysicalMaterial>();
const eyeMatCache = new Map<THREE.CanvasTexture, THREE.MeshPhysicalMaterial>();
let goldMetalMat: THREE.MeshStandardMaterial | null = null;
let blushMat: THREE.MeshPhysicalMaterial | null = null;

function shade(color: string, amount: number): string {
  const target = new THREE.Color(amount >= 0 ? '#ffffff' : INK);
  return `#${new THREE.Color(color).lerp(target, Math.abs(amount)).getHexString()}`;
}

/** Velvety plush coat material paired with 2048px coat shading and 1024px microfiber bump. */
function getCoatMaterial(species: AnimalSpecies, coatColor: string): THREE.MeshPhysicalMaterial {
  const key = `${species}|${coatColor}`;
  let mat = coatMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      map: getAnimalCoatTexture(species, coatColor),
      bumpMap: getAnimalFurBumpTexture(),
      bumpScale: 0.0045,
      roughness: 0.56,
      metalness: 0.0,
      sheen: 0.9,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(coatColor).lerp(new THREE.Color('#ffffff'), 0.55),
      clearcoat: 0.08,
      clearcoatRoughness: 0.45,
    });
    coatMatCache.set(key, mat);
  }
  return mat;
}

/** Soft matte satin-plush material for bellies, ear hollows, scarves, and berets. */
function getSoftSatinMaterial(color: string, bumpScale = 0.0025): THREE.MeshPhysicalMaterial {
  const key = `${color}|${bumpScale}`;
  let mat = satinMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color,
      bumpMap: getAnimalFurBumpTexture(),
      bumpScale,
      roughness: 0.5,
      metalness: 0.0,
      sheen: 0.78,
      sheenRoughness: 0.48,
      sheenColor: new THREE.Color('#ffffff'),
    });
    satinMatCache.set(key, mat);
  }
  return mat;
}

/** Smooth glossy vinyl/ceramic accent material for noses, headphone shells, and mugs. */
function getGlossyMaterial(color: string): THREE.MeshPhysicalMaterial {
  let mat = glossyMatCache.get(color);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.16,
      metalness: 0.04,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
    });
    glossyMatCache.set(color, mat);
  }
  return mat;
}

/** Crystal-clear glossy resin dome eye material. */
function getEyeMaterial(eyeMap: THREE.CanvasTexture): THREE.MeshPhysicalMaterial {
  let mat = eyeMatCache.get(eyeMap);
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color: '#faf6fc',
      map: eyeMap,
      roughness: 0.08,
      metalness: 0.0,
      clearcoat: 0.95,
      clearcoatRoughness: 0.05,
    });
    eyeMatCache.set(eyeMap, mat);
  }
  return mat;
}

function getGoldMetalMaterial(): THREE.MeshStandardMaterial {
  if (!goldMetalMat) {
    goldMetalMat = new THREE.MeshStandardMaterial({
      color: GOLD_METAL,
      metalness: 0.85,
      roughness: 0.22,
    });
  }
  return goldMetalMat;
}

function getBlushMaterial(): THREE.MeshPhysicalMaterial {
  if (!blushMat) {
    blushMat = new THREE.MeshPhysicalMaterial({
      color: BLUSH,
      roughness: 0.65,
      transparent: true,
      opacity: 0.68,
    });
  }
  return blushMat;
}

/** Smooth sculpted ears / amphibian crown crest per species. */
function AnimalEars({ species, coatMat }: { species: AnimalSpecies; coatMat: THREE.MeshPhysicalMaterial }) {
  const innerEarMat = getSoftSatinMaterial(INNER_EAR, 0.002);
  const creamMat = getSoftSatinMaterial(BELLY_CREAM, 0.002);

  switch (species) {
    case 'cat': {
      const earGeo = getCatEarGeometry();
      return (
        <>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.185, 0.175, -0.015]} rotation={[0.06, side * 0.12, -side * 0.36]}>
              <mesh geometry={earGeo} material={coatMat} castShadow />
              <mesh
                geometry={earGeo}
                material={innerEarMat}
                position={[0, 0.012, 0.028]}
                scale={[0.62, 0.68, 0.45]}
              />
            </group>
          ))}
        </>
      );
    }
    case 'bunny': {
      const earGeo = getBunnyEarGeometry();
      return (
        <>
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * 0.115, 0.215, -0.02]}
              rotation={[side > 0 ? 0.08 : -0.04, side * 0.1, -side * (side > 0 ? 0.22 : 0.15)]}
            >
              <mesh geometry={earGeo} material={coatMat} castShadow />
              <mesh
                geometry={earGeo}
                material={innerEarMat}
                position={[0, 0.015, 0.022]}
                scale={[0.58, 0.78, 0.4]}
              />
            </group>
          ))}
        </>
      );
    }
    case 'bear': {
      const earGeo = getBearEarGeometry();
      return (
        <>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.23, 0.21, -0.01]} rotation={[0, side * 0.16, -side * 0.18]}>
              <mesh geometry={earGeo} material={coatMat} castShadow />
              <mesh
                geometry={earGeo}
                material={creamMat}
                position={[0, -0.005, 0.032]}
                scale={[0.62, 0.62, 0.45]}
              />
            </group>
          ))}
        </>
      );
    }
    case 'frog': {
      const leafMat = getSoftSatinMaterial(LEAF, 0.0015);
      // Small delicate sprouted lotus-leaf accent gently tucked to left crown so glasses/berets never collide.
      return (
        <group position={[-0.06, 0.24, -0.035]} rotation={[0.1, 0, 0.22]}>
          <mesh material={leafMat} position-y={0.035} castShadow>
            <capsuleGeometry args={[0.014, 0.045, 6, 12]} />
          </mesh>
          <mesh material={leafMat} position={[-0.045, 0.072, 0]} rotation-z={0.5} scale={[1.1, 0.28, 0.65]} castShadow>
            <sphereGeometry args={[0.065, 20, 14]} />
          </mesh>
        </group>
      );
    }
  }
}

/** Animal-accurate smooth muzzles, noses, whisker pads, and curved whiskers. */
function AnimalMuzzle({ species, coatColor }: { species: AnimalSpecies; coatColor: string }) {
  const darkInkMat = getGlossyMaterial(INK);
  const creamMat = getSoftSatinMaterial(BELLY_CREAM, 0.002);
  const muzzleToneMat = getSoftSatinMaterial(shade(coatColor, 0.45), 0.002);

  if (species === 'bear') {
    return (
      <group position={[0, -0.06, 0.255]}>
        <mesh material={creamMat} scale={[1.3, 0.92, 0.72]} castShadow>
          <sphereGeometry args={[0.092, 32, 24]} />
        </mesh>
        <mesh material={darkInkMat} position={[0, 0.032, 0.056]} scale={[1.3, 0.9, 0.8]}>
          <sphereGeometry args={[0.027, 20, 14]} />
        </mesh>
        <mesh material={darkInkMat} position={[0, 0.002, 0.062]}>
          <capsuleGeometry args={[0.0055, 0.028, 6, 10]} />
        </mesh>
      </group>
    );
  }

  if (species === 'cat') {
    const whiskerGeo = getWhiskerGeometry();
    return (
      <group>
        {/* Two soft cat whisker-pad pillows */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            material={muzzleToneMat}
            position={[side * 0.034, -0.066, 0.256]}
            scale={[1.15, 0.85, 0.7]}
          >
            <sphereGeometry args={[0.04, 22, 16]} />
          </mesh>
        ))}
        {/* Coral-pink kitty nose */}
        <mesh material={getGlossyMaterial('#ff5c8a')} position={[0, -0.034, 0.284]} scale={[1.25, 0.85, 0.8]}>
          <sphereGeometry args={[0.02, 20, 14]} />
        </mesh>
        {/* Curved tapering cat whiskers */}
        {[-1, 1].map((side) =>
          [-0.08, 0.14].map((tilt, wi) => (
            <group
              key={`${side}-${wi}`}
              position={[side * 0.18, -0.048 + wi * 0.026, 0.22]}
              rotation={[0, -side * 0.35, tilt]}
              scale-x={side}
            >
              <mesh geometry={whiskerGeo} material={darkInkMat} />
            </group>
          )),
        )}
      </group>
    );
  }

  if (species === 'bunny') {
    return (
      <group>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            material={creamMat}
            position={[side * 0.03, -0.064, 0.256]}
            scale={[1.05, 0.85, 0.7]}
          >
            <sphereGeometry args={[0.036, 20, 14]} />
          </mesh>
        ))}
        <mesh material={getGlossyMaterial('#ff7597')} position={[0, -0.034, 0.282]} scale={[1.2, 0.9, 0.85]}>
          <sphereGeometry args={[0.021, 20, 14]} />
        </mesh>
      </group>
    );
  }

  // Froggy cute tiny nostril dimples along the wide snout.
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} material={darkInkMat} position={[side * 0.032, -0.008, 0.278]}>
          <sphereGeometry args={[0.0085, 12, 10]} />
        </mesh>
      ))}
    </group>
  );
}

/** Smooth animal tails tucked neatly behind hips. */
function AnimalTail({
  species,
  coatMat,
  coatColor,
}: {
  species: AnimalSpecies;
  coatMat: THREE.MeshPhysicalMaterial;
  coatColor: string;
}) {
  switch (species) {
    case 'cat':
      return <mesh geometry={getCatTailGeometry()} material={coatMat} castShadow />;
    case 'bunny': {
      // Fluffy multi-puff cotton tail!
      const fluffMat = getSoftSatinMaterial('#ffffff', 0.003);
      return (
        <group>
          <mesh material={fluffMat} castShadow>
            <sphereGeometry args={[0.072, 24, 18]} />
          </mesh>
          <mesh material={fluffMat} position={[-0.035, 0.032, 0.01]} castShadow>
            <sphereGeometry args={[0.048, 18, 14]} />
          </mesh>
          <mesh material={fluffMat} position={[0.035, 0.032, 0.01]} castShadow>
            <sphereGeometry args={[0.048, 18, 14]} />
          </mesh>
        </group>
      );
    }
    case 'bear':
      return (
        <mesh material={getSoftSatinMaterial(shade(coatColor, -0.1), 0.003)} castShadow>
          <sphereGeometry args={[0.068, 24, 18]} />
        </mesh>
      );
    case 'frog':
      return null;
  }
}

function MouthShape({ mouth, species }: { mouth: MouthKind; species: AnimalSpecies }) {
  const darkInkMat = getGlossyMaterial(INK);
  const zPos = species === 'bear' ? 0.302 : species === 'frog' ? 0.268 : 0.278;
  const yPos = species === 'bear' ? -0.088 : species === 'frog' ? -0.082 : -0.095;

  if (mouth === 'o') {
    return (
      <mesh material={darkInkMat} position={[0, yPos - 0.006, zPos]} scale={[1, 1.25, 0.55]}>
        <sphereGeometry args={[0.022, 18, 14]} />
      </mesh>
    );
  }
  const radius = species === 'frog' ? 0.065 : mouth === 'grin' ? 0.048 : mouth === 'smile' ? 0.036 : 0.023;
  return (
    <mesh material={darkInkMat} position={[0, yPos, zPos]} rotation-z={Math.PI}>
      <torusGeometry args={[radius, 0.0085, 12, 24, Math.PI]} />
    </mesh>
  );
}

/** Crafted 3D head accessories positioned cleanly for each species' head/eye geometry. */
function HeadAccessory({
  accessory,
  accent,
  species,
}: {
  accessory: Accessory;
  accent: string;
  species: AnimalSpecies;
}) {
  const accentMat = getSoftSatinMaterial(accent);
  const glossyAccent = getGlossyMaterial(accent);
  const metalMat = getGoldMetalMaterial();

  const eyeX = species === 'frog' ? 0.145 : 0.112;
  const eyeY = species === 'frog' ? 0.145 : 0.022;
  const eyeZ = species === 'frog' ? 0.235 : 0.276;

  switch (accessory) {
    case 'glasses':
      return (
        <group>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * eyeX, eyeY, eyeZ]} rotation-y={side * 0.14}>
              <mesh material={metalMat}>
                <torusGeometry args={[0.064, 0.009, 14, 32]} />
              </mesh>
            </group>
          ))}
          <mesh material={metalMat} position={[0, eyeY + 0.005, eyeZ + 0.012]} rotation-z={Math.PI / 2}>
            <capsuleGeometry args={[0.007, eyeX * 2 - 0.12, 6, 12]} />
          </mesh>
        </group>
      );
    case 'beret':
      return (
        <group position={[0.075, species === 'frog' ? 0.22 : 0.235, 0.02]} rotation={[0.05, 0, -0.25]}>
          <mesh geometry={getBeretGeometry()} material={accentMat} castShadow />
          <mesh material={accentMat} position-y={0.095}>
            <capsuleGeometry args={[0.011, 0.025, 6, 10]} />
          </mesh>
        </group>
      );
    case 'headphones': {
      const bandRadius = species === 'frog' ? 0.365 : 0.335;
      const cupX = species === 'frog' ? 0.355 : 0.325;
      return (
        <group position-y={0.01}>
          <mesh material={metalMat}>
            <torusGeometry args={[bandRadius, 0.016, 14, 36, Math.PI]} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * cupX, -0.01, 0]} rotation-z={Math.PI / 2}>
              <mesh material={glossyAccent} castShadow>
                <capsuleGeometry args={[0.078, 0.032, 12, 24]} />
              </mesh>
              <mesh material={getSoftSatinMaterial(BELLY_CREAM, 0.001)} position-y={side * 0.025}>
                <torusGeometry args={[0.066, 0.018, 12, 24]} />
              </mesh>
            </group>
          ))}
        </group>
      );
    }
    case 'scarf':
      return null;
  }
}

export interface ChibiFigureProps {
  team: TeamId;
  /** Yard slot 0..3; picks color shade, accessory & personality this animal friend has. */
  slot: number;
  holdingCup: boolean;
  isMovable?: boolean;
  isHovered?: boolean;
}

export function ChibiFigure({ team, slot, holdingCup, isMovable = false, isHovered = false }: ChibiFigureProps) {
  const species = TEAM_SPECIES[team];
  const charIdx = slot % CHARACTER_PROFILES.length;
  const char = CHARACTER_PROFILES[charIdx] ?? CHARACTER_PROFILES[0];

  const baseColor = TEAM_COLORS[team];
  const coatColor = char.shade === 0 ? baseColor : shade(baseColor, char.shade);

  const torsoGeo = useMemo(() => getAnimalTorsoGeometry(), []);
  const headGeo = useMemo(() => getAnimalHeadGeometry(species), [species]);
  const armGeo = useMemo(() => getArmGeometry(), []);
  const footGeo = useMemo(() => getFootGeometry(), []);
  const eyeMood: EyeMood = species === 'frog' && char.eyeMood !== 'sleepy' ? 'frog' : char.eyeMood;
  const eyeMap = useMemo(() => getAnimeEyeTexture(eyeMood, char.iris), [eyeMood, char.iris]);

  const coatMat = getCoatMaterial(species, coatColor);
  const bellyMat = getSoftSatinMaterial(char.belly, 0.002);
  const pawMat = getCoatMaterial(species, shade(coatColor, -0.14));
  const accentMat = getSoftSatinMaterial(char.accent, 0.002);
  const eyeMat = getEyeMaterial(eyeMap);

  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const eyeRefs = useRef<(THREE.Group | null)[]>([]);

  const phase = slot * 1.7 + TEAM_IDS.indexOf(team) * 0.9;

  useFrame(({ clock }) => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;

    const energy = isHovered ? 1.85 : isMovable ? 1.3 : 1;
    const t = clock.elapsedTime * char.tempo * energy + phase;

    body.scale.y = 1 + Math.sin(t * 2.2) * 0.025;
    body.rotation.z = Math.sin(t * 2.4) * char.hipWiggle * energy;
    head.rotation.z = Math.sin(t * 1.3) * char.sway;
    head.rotation.y = Math.sin(t * 0.6) * char.look;
    head.rotation.x = -0.11 - char.nod * 0.4 * (1 + Math.sin(t * 1.1));

    if (tailRef.current) tailRef.current.rotation.y = Math.sin(t * 4.0) * 0.42;

    const wave = isHovered ? -1.05 + Math.sin(t * 6) * 0.35 : Math.sin(t * 2.1) * 0.18;
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = wave;
      leftArmRef.current.rotation.z = 0.24;
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = isHovered ? -1.05 - Math.sin(t * 6) * 0.35 : -wave;
      rightArmRef.current.rotation.z = -0.24;
    }

    const blinking = (clock.elapsedTime + phase) % char.blinkEvery < 0.12;
    eyeRefs.current.forEach((eye, idx) => {
      if (!eye) return;
      const winkScale = char.winkRight && idx === 1 ? 0.22 : 1;
      eye.scale.y = blinking ? 0.1 : winkScale * (isHovered ? 1.12 : 1);
    });
  });

  const eyeX = species === 'frog' ? 0.145 : 0.11;
  const eyeY = species === 'frog' ? 0.145 : 0.022;
  const eyeZ = species === 'frog' ? 0.215 : 0.252;
  const eyeRadius = species === 'frog' ? 0.066 : 0.06;

  return (
    <group scale={FIGURE_SCALE}>
      <group ref={bodyRef}>
        {/* Smooth sculpted pear torso */}
        <mesh geometry={torsoGeo} material={coatMat} castShadow receiveShadow />

        {/* Soft plush belly patch curving with chest contour */}
        <mesh material={bellyMat} position={[0, 0.26, 0.135]} scale={[1.05, 1.25, 0.55]}>
          <sphereGeometry args={[0.135, 36, 28]} />
        </mesh>

        {/* Smooth teardrop animal arms & sculpted feet */}
        {[-1, 1].map((side) => (
          <group key={side}>
            <group ref={side < 0 ? leftArmRef : rightArmRef} position={[side * 0.195, 0.43, 0.03]}>
              <mesh geometry={armGeo} material={coatMat} castShadow />
            </group>
            <mesh geometry={footGeo} material={pawMat} position={[side * 0.105, 0.034, 0.055]} castShadow />
          </group>
        ))}

        {/* Species tail */}
        <group ref={tailRef} position={[0, 0.14, -0.2]}>
          <AnimalTail species={species} coatMat={coatMat} coatColor={coatColor} />
        </group>

        {/* Sunny's sculpted curved neckerchief scarf + smooth ribbon tie */}
        {char.accessory === 'scarf' && (
          <group>
            <mesh material={accentMat} position-y={0.545} rotation-x={Math.PI / 2} castShadow>
              <torusGeometry args={[0.15, 0.044, 18, 36]} />
            </mesh>
            <group position={[0.095, 0.525, 0.155]} rotation={[0.15, -0.2, 0.24]}>
              <mesh geometry={getScarfTieGeometry()} material={accentMat} castShadow />
            </group>
          </group>
        )}

        {/* Professor's sculpted bowtie */}
        {char.accessory === 'glasses' && (
          <group position={[0, 0.52, 0.155]}>
            {[-1, 1].map((side) => (
              <mesh key={side} material={accentMat} position={[side * 0.042, 0, 0]} rotation-z={side * 0.28} scale={[1.2, 0.85, 0.55]}>
                <sphereGeometry args={[0.034, 18, 14]} />
              </mesh>
            ))}
            <mesh material={accentMat}>
              <sphereGeometry args={[0.019, 14, 12]} />
            </mesh>
          </group>
        )}

        {/* Friendly coffee hangout cup */}
        <group position={[0.21, 0.39, 0.19]} visible={holdingCup}>
          <mesh material={getGlossyMaterial('#ffffff')} castShadow>
            <cylinderGeometry args={[0.058, 0.046, 0.1, 24]} />
          </mesh>
          <mesh material={getGlossyMaterial('#8d5a3b')} position-y={0.046}>
            <cylinderGeometry args={[0.048, 0.048, 0.01, 24]} />
          </mesh>
        </group>
      </group>

      {/* Smooth sculpted species head */}
      <group ref={headRef} position-y={0.75}>
        <mesh geometry={headGeo} material={coatMat} castShadow receiveShadow />

        <AnimalEars species={species} coatMat={coatMat} />
        <HeadAccessory accessory={char.accessory} accent={char.accent} species={species} />
        <AnimalMuzzle species={species} coatColor={coatColor} />

        {/* Glossy 2048px clearcoat eyes & soft blush cheeks */}
        {[-1, 1].map((side, i) => (
          <group key={side}>
            <group
              ref={(node) => {
                eyeRefs.current[i] = node;
              }}
              position={[side * eyeX, eyeY, eyeZ]}
              rotation-y={side * 0.18}
            >
              <mesh material={eyeMat} rotation-y={-Math.PI / 2} scale={[0.38, 1.08, 1]}>
                <sphereGeometry args={[eyeRadius, 36, 28]} />
              </mesh>
            </group>

            <mesh
              material={getBlushMaterial()}
              position={[side * (species === 'frog' ? 0.21 : 0.195), -0.065, 0.228]}
              rotation-y={side * 0.36}
              scale={[1.3, 0.72, 0.32]}
            >
              <sphereGeometry args={[0.044, 20, 14]} />
            </mesh>
          </group>
        ))}

        <MouthShape mouth={char.mouth} species={species} />
      </group>
    </group>
  );
}
