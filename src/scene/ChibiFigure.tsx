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
  getForearmGeometry,
  getHandGeometry,
  getLegGeometry,
  getNeckGeometry,
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
const FIGURE_SCALE = 1.48 * 0.95; // 5% smaller overall piece size

export type PicnicActivity = 'marshmallow' | 'coffee' | 'eat' | 'sing';
export const PICNIC_ACTIVITIES: readonly PicnicActivity[] = ['marshmallow', 'coffee', 'eat', 'sing'];

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

const coatMatCache = new Map<string, THREE.MeshStandardMaterial>();
const satinMatCache = new Map<string, THREE.MeshStandardMaterial>();
const glossyMatCache = new Map<string, THREE.MeshStandardMaterial>();
const eyeMatCache = new Map<THREE.CanvasTexture, THREE.MeshStandardMaterial>();
let goldMetalMat: THREE.MeshStandardMaterial | null = null;
let blushMat: THREE.MeshStandardMaterial | null = null;

function shade(color: string, amount: number): string {
  const target = new THREE.Color(amount >= 0 ? '#ffffff' : INK);
  return `#${new THREE.Color(color).lerp(target, Math.abs(amount)).getHexString()}`;
}

/** Velvety plush coat material paired with coat shading and microfiber bump. */
function getCoatMaterial(species: AnimalSpecies, coatColor: string): THREE.MeshStandardMaterial {
  const key = `${species}|${coatColor}`;
  let mat = coatMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      map: getAnimalCoatTexture(species, coatColor),
      bumpMap: getAnimalFurBumpTexture(),
      bumpScale: 0.004,
      roughness: 0.62,
      metalness: 0.0,
    });
    coatMatCache.set(key, mat);
  }
  return mat;
}

/** Soft matte satin-plush material for bellies, ear hollows, scarves, and berets. */
function getSoftSatinMaterial(color: string, bumpScale = 0.002): THREE.MeshStandardMaterial {
  const key = `${color}|${bumpScale}`;
  let mat = satinMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.56,
      metalness: 0.0,
    });
    satinMatCache.set(key, mat);
  }
  return mat;
}

/** Smooth glossy vinyl/ceramic accent material for noses, headphone shells, and mugs. */
function getGlossyMaterial(color: string): THREE.MeshStandardMaterial {
  let mat = glossyMatCache.get(color);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.16,
      metalness: 0.06,
    });
    glossyMatCache.set(color, mat);
  }
  return mat;
}

/** Crystal-clear glossy resin dome eye material. */
function getEyeMaterial(eyeMap: THREE.CanvasTexture): THREE.MeshStandardMaterial {
  let mat = eyeMatCache.get(eyeMap);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: '#faf6fc',
      map: eyeMap,
      roughness: 0.1,
      metalness: 0.04,
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

function getBlushMaterial(): THREE.MeshStandardMaterial {
  if (!blushMat) {
    blushMat = new THREE.MeshStandardMaterial({
      color: BLUSH,
      roughness: 0.65,
      transparent: true,
      opacity: 0.68,
    });
  }
  return blushMat;
}

/** Smooth sculpted ears / amphibian crown crest per species. */
function AnimalEars({ species, coatMat }: { species: AnimalSpecies; coatMat: THREE.MeshStandardMaterial }) {
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
  coatMat: THREE.MeshStandardMaterial;
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

export type CapturePose =
  | 'none'
  | 'grab'
  | 'twirl_attacker'
  | 'twirl_victim'
  | 'throw'
  | 'flail'
  | 'laugh'
  | 'dizzy';

function MouthShape({
  mouth,
  species,
  laughing = false,
  surprised = false,
  grinning = false,
}: {
  mouth: MouthKind;
  species: AnimalSpecies;
  laughing?: boolean;
  surprised?: boolean;
  grinning?: boolean;
}) {
  const darkInkMat = getGlossyMaterial(INK);
  const zPos = species === 'bear' ? 0.302 : species === 'frog' ? 0.268 : 0.278;
  const yPos = species === 'bear' ? -0.088 : species === 'frog' ? -0.082 : -0.095;

  if (laughing) {
    return (
      <group position={[0, yPos - 0.004, zPos]}>
        <mesh material={darkInkMat} scale={[1.35, 1.4, 0.55]}>
          <sphereGeometry args={[0.029, 16, 12]} />
        </mesh>
        <mesh material={getGlossyMaterial('#ff5c8a')} position={[0, -0.012, 0.009]} scale={[1, 0.65, 0.5]}>
          <sphereGeometry args={[0.02, 12, 10]} />
        </mesh>
      </group>
    );
  }

  if (surprised || mouth === 'o') {
    return (
      <mesh material={darkInkMat} position={[0, yPos - 0.006, zPos]} scale={[1, 1.25, 0.55]}>
        <sphereGeometry args={[0.024, 18, 14]} />
      </mesh>
    );
  }
  const effectiveMouth = grinning ? 'grin' : mouth;
  const radius = species === 'frog' ? 0.065 : effectiveMouth === 'grin' ? 0.048 : effectiveMouth === 'smile' ? 0.036 : 0.023;
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
  isSitting?: boolean;
  picnicActivity?: PicnicActivity;
  finalRank?: number | null;
  isLastPlace?: boolean;
  isLaughing?: boolean;
  isDizzy?: boolean;
  capturePose?: CapturePose;
}

export function ChibiFigure({
  team,
  slot,
  holdingCup,
  isMovable = false,
  isHovered = false,
  isSitting = false,
  picnicActivity,
  finalRank = null,
  isLastPlace = false,
  isLaughing = false,
  isDizzy = false,
  capturePose = 'none',
}: ChibiFigureProps) {
  const species = TEAM_SPECIES[team];
  const charIdx = slot % CHARACTER_PROFILES.length;
  const char = CHARACTER_PROFILES[charIdx] ?? CHARACTER_PROFILES[0];
  const activity: PicnicActivity = picnicActivity ?? PICNIC_ACTIVITIES[charIdx];

  const baseColor = TEAM_COLORS[team];
  const coatColor = char.shade === 0 ? baseColor : shade(baseColor, char.shade);

  const torsoGeo = useMemo(() => getAnimalTorsoGeometry(), []);
  const neckGeo = useMemo(() => getNeckGeometry(), []);
  const headGeo = useMemo(() => getAnimalHeadGeometry(species), [species]);
  const armGeo = useMemo(() => getArmGeometry(), []);
  const forearmGeo = useMemo(() => getForearmGeometry(), []);
  const handGeo = useMemo(() => getHandGeometry(), []);
  const legGeo = useMemo(() => getLegGeometry(), []);
  const footGeo = useMemo(() => getFootGeometry(), []);
  const eyeMood: EyeMood = species === 'frog' && char.eyeMood !== 'sleepy' ? 'frog' : char.eyeMood;
  const eyeMap = useMemo(() => getAnimeEyeTexture(eyeMood, char.iris), [eyeMood, char.iris]);

  const coatMat = getCoatMaterial(species, coatColor);
  const bellyMat = getSoftSatinMaterial(char.belly, 0.002);
  const pawMat = getCoatMaterial(species, shade(coatColor, -0.14));
  const innerPawMat = getSoftSatinMaterial(INNER_EAR, 0.002);
  const accentMat = getSoftSatinMaterial(char.accent, 0.002);
  const eyeMat = getEyeMaterial(eyeMap);

  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftForearmRef = useRef<THREE.Group>(null);
  const rightForearmRef = useRef<THREE.Group>(null);
  const marshmallowMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const eyeRefs = useRef<(THREE.Group | null)[]>([]);

  const phase = slot * 1.7 + TEAM_IDS.indexOf(team) * 0.9;
  const activeCapturePose: CapturePose =
    capturePose !== 'none' ? capturePose : isLaughing ? 'laugh' : isDizzy ? 'dizzy' : 'none';
  const showLaughPose = activeCapturePose === 'laugh';
  const showDizzyPose = activeCapturePose === 'dizzy';

  useFrame(({ clock }, rawDelta) => {
    const body = bodyRef.current;
    const head = headRef.current;
    if (!body || !head) return;

    // Counteract body y-squash so head remains perfectly spherical and cute
    if (body.scale.y !== 0) {
      head.scale.y = 1 / body.scale.y;
    }
    head.position.y = isSitting ? 0.61 : 0.65;

    const dt = Math.min(rawDelta, 0.05);
    const armBlend = 1 - Math.exp(-26 * dt);
    const elapsed = clock.elapsedTime;
    const energy = isHovered ? 1.85 : isMovable ? 1.3 : 1;
    const t = elapsed * char.tempo * energy + phase;

    const sitY = isSitting ? -0.055 : 0;
    const sitLean = isSitting ? -0.06 : 0;

    let leftAx = 0;
    let leftAz = -0.34;
    let leftFx = -0.22;
    let rightAx = 0;
    let rightAz = 0.34;
    let rightFx = -0.22;

    if (activeCapturePose === 'grab') {
      // Both characters reach arms eagerly forward so their palms clasp together.
      const reachT = elapsed * 18 + phase;
      body.position.y = sitY;
      body.scale.y = 1.03;
      body.rotation.z = Math.sin(reachT) * 0.04;
      body.rotation.x = sitLean + 0.08;
      head.rotation.z = Math.sin(reachT) * 0.05;
      head.rotation.y = 0;
      head.rotation.x = -0.06;
      leftAx = -1.48;
      leftAz = 0.18;
      leftFx = -0.08;
      rightAx = -1.48;
      rightAz = -0.18;
      rightFx = -0.08;
    } else if (activeCapturePose === 'twirl_attacker') {
      // Attacker plants feet, leans back as counterbalance, and grips victim's hands tight!
      const spinT = elapsed * 22 + phase;
      body.position.y = sitY;
      body.scale.y = 1.02;
      body.rotation.z = Math.sin(spinT) * 0.04;
      body.rotation.x = sitLean - 0.06;
      head.rotation.z = Math.sin(spinT * 0.5) * 0.05;
      head.rotation.y = 0;
      head.rotation.x = 0.08;
      leftAx = -1.72;
      leftAz = 0.22;
      leftFx = -0.05;
      rightAx = -1.72;
      rightAz = -0.22;
      rightFx = -0.05;
    } else if (activeCapturePose === 'twirl_victim') {
      // Victim leans out under centrifugal G-force, gripping attacker's hands while feet fly out!
      const spinT = elapsed * 26 + phase;
      body.position.y = sitY;
      body.scale.y = 1.06;
      body.rotation.z = Math.sin(spinT) * 0.1;
      body.rotation.x = sitLean - 0.06;
      head.rotation.z = Math.sin(spinT * 1.1) * 0.2;
      head.rotation.y = Math.cos(spinT * 0.7) * 0.16;
      head.rotation.x = 0.16;
      leftAx = -0.96;
      leftAz = 0.22;
      leftFx = -0.04;
      rightAx = -0.96;
      rightAz = -0.22;
      rightFx = -0.04;
    } else if (activeCapturePose === 'throw') {
      // Attacker flings both arms wide & skyward in a triumphant release follow-through!
      body.position.y = sitY + 0.06;
      body.scale.y = 1.08;
      body.rotation.z = 0;
      body.rotation.x = sitLean - 0.18;
      head.rotation.z = 0;
      head.rotation.y = 0;
      head.rotation.x = -0.28;
      leftAx = -2.35;
      leftAz = -0.62;
      leftFx = -0.05;
      rightAx = -2.35;
      rightAz = 0.62;
      rightFx = -0.05;
    } else if (activeCapturePose === 'flail') {
      // Victim tumbles through the air with frantically windmilling arms!
      const flailT = elapsed * 28 + phase;
      body.position.y = sitY;
      body.scale.y = 1.04;
      body.rotation.z = Math.sin(flailT * 0.6) * 0.14;
      body.rotation.x = sitLean;
      head.rotation.z = Math.sin(flailT * 0.9) * 0.26;
      head.rotation.y = Math.cos(flailT * 0.7) * 0.28;
      head.rotation.x = 0.14 + Math.sin(flailT) * 0.18;
      leftAx = -1.75 + Math.sin(flailT) * 0.95;
      leftAz = -0.52 - Math.cos(flailT * 0.8) * 0.22;
      leftFx = -0.35 + Math.sin(flailT * 1.1) * 0.3;
      rightAx = -1.75 - Math.sin(flailT) * 0.95;
      rightAz = 0.52 + Math.cos(flailT * 0.8) * 0.22;
      rightFx = -0.35 - Math.sin(flailT * 1.1) * 0.3;
    } else if (showLaughPose) {
      // Attacker hearty post-capture belly laugh!
      const laughT = elapsed * 14 + phase;
      body.position.y = sitY + Math.abs(Math.sin(laughT * 0.5)) * 0.09;
      body.scale.y = 1 + Math.sin(laughT) * 0.06;
      body.rotation.z = Math.sin(laughT * 0.6) * 0.09;
      body.rotation.x = sitLean - 0.14 + Math.sin(laughT) * 0.05;
      head.rotation.z = Math.sin(laughT * 0.7) * 0.1;
      head.rotation.y = Math.sin(laughT * 0.4) * 0.14;
      head.rotation.x = -0.32 + Math.sin(laughT) * 0.11;
      leftAx = -1.9 + Math.sin(laughT) * 0.28;
      leftAz = -0.45;
      leftFx = -0.25;
      rightAx = -0.78 + Math.sin(laughT) * 0.2;
      rightAz = -0.22;
      rightFx = -0.65;
    } else if (showDizzyPose) {
      // Victim woozy / chakkar-kha-ke wobble right after capture crash-landing!
      const dizzyT = elapsed * 12 + phase;
      body.position.y = sitY;
      body.scale.y = 0.94 + Math.sin(dizzyT * 0.8) * 0.04;
      body.rotation.z = Math.sin(dizzyT * 0.75) * 0.22;
      body.rotation.x = sitLean + Math.cos(dizzyT * 0.6) * 0.14;
      head.rotation.z = Math.sin(dizzyT) * 0.28;
      head.rotation.y = Math.sin(dizzyT * 0.65) * 0.35;
      head.rotation.x = 0.12 + Math.cos(dizzyT * 0.8) * 0.12;
      leftAx = -1.25 + Math.sin(dizzyT) * 0.4;
      leftAz = -0.38;
      leftFx = -0.75;
      rightAx = -1.25 - Math.sin(dizzyT) * 0.4;
      rightAz = 0.38;
      rightFx = -0.75;
    } else if (finalRank === 1) {
      // 1st place: joyful cheering hop & raised arms!
      const cheerT = elapsed * 5.4 + phase;
      body.position.y = sitY + Math.abs(Math.sin(cheerT)) * 0.14;
      body.scale.y = 1 + Math.sin(cheerT * 2) * 0.04;
      body.rotation.z = Math.sin(cheerT * 0.8) * 0.1;
      body.rotation.x = sitLean;
      head.rotation.z = Math.sin(cheerT * 1.1) * 0.12;
      head.rotation.y = Math.sin(cheerT * 0.7) * 0.18;
      head.rotation.x = -0.16;
      leftAx = -2.2 + Math.sin(cheerT * 2) * 0.3;
      leftAz = -0.46;
      leftFx = -0.15;
      rightAx = -2.2 - Math.sin(cheerT * 2) * 0.3;
      rightAz = 0.46;
      rightFx = -0.15;
    } else if (isLastPlace) {
      // Last place: comical sulking tantrum & frustrated wobble!
      const rageT = elapsed * 8.5 + phase;
      body.position.y = sitY;
      body.scale.y = 1 - Math.abs(Math.sin(rageT * 0.5)) * 0.05;
      body.rotation.z = Math.sin(rageT) * 0.12;
      body.rotation.x = sitLean + 0.12;
      head.rotation.z = Math.sin(rageT * 1.2) * 0.14;
      head.rotation.y = Math.sin(rageT * 0.9) * 0.32;
      head.rotation.x = 0.2;
      leftAx = -0.9 + Math.sin(rageT * 1.6) * 0.55;
      leftAz = -0.45;
      leftFx = -0.35;
      rightAx = -0.9 - Math.sin(rageT * 1.6) * 0.55;
      rightAz = 0.45;
      rightFx = -0.35;
    } else if (finalRank === 2) {
      // 2nd place: cheerful clapping & proud celebratory nod!
      const clapT = elapsed * 4.2 + phase;
      body.position.y = sitY + Math.abs(Math.sin(clapT * 0.8)) * 0.04;
      body.scale.y = 1 + Math.sin(clapT) * 0.025;
      body.rotation.z = Math.sin(clapT * 0.9) * 0.07;
      body.rotation.x = sitLean;
      head.rotation.z = Math.sin(clapT * 0.9) * 0.09;
      head.rotation.y = Math.sin(clapT * 0.5) * 0.2;
      head.rotation.x = -0.12 + Math.sin(clapT * 2) * 0.06;
      leftAx = -1.15;
      leftAz = 0.22 - Math.sin(clapT * 3) * 0.25;
      leftFx = -0.45;
      rightAx = -1.15;
      rightAz = -0.22 + Math.sin(clapT * 3) * 0.25;
      rightFx = -0.45;
    } else if (isSitting) {
      // Cozy seated picnic animation tailored to each friend's campfire activity.
      body.position.y = sitY;
      body.scale.y = 1 + Math.sin(t * 1.6) * 0.02;
      body.rotation.x = sitLean;
      if (activity === 'sing') {
        const singT = elapsed * 2.8 + phase;
        body.rotation.z = Math.sin(singT) * 0.1;
        head.rotation.z = Math.sin(singT) * 0.14;
        head.rotation.y = Math.sin(singT * 0.5) * 0.22;
        head.rotation.x = -0.16 + Math.sin(singT * 2) * 0.06;
        leftAx = -0.75 + Math.sin(singT * 2) * 0.25;
        leftAz = -0.38;
        leftFx = -0.45;
        rightAx = -0.75 - Math.sin(singT * 2) * 0.25;
        rightAz = 0.38;
        rightFx = -0.45;
      } else if (activity === 'marshmallow') {
        const mCycle = (elapsed * 0.25 + phase * 0.17) % 1;
        const eatPhase = mCycle > 0.7 ? Math.sin(((mCycle - 0.7) / 0.3) * Math.PI) : 0;
        const roastProgress = Math.min(1, mCycle / 0.7);
        body.rotation.z = Math.sin(t * 1.2) * 0.035;
        head.rotation.z = Math.sin(t * 1.1) * 0.05;
        head.rotation.y = Math.sin(t * 0.5) * 0.12 * (1 - eatPhase);
        head.rotation.x = -0.06 + eatPhase * 0.22;
        if (marshmallowMatRef.current) {
          marshmallowMatRef.current.color.setRGB(
            1 - roastProgress * 0.12,
            0.97 - roastProgress * 0.35,
            0.94 - roastProgress * 0.62,
          );
        }
        leftAx = -0.28;
        leftAz = -0.32;
        leftFx = -0.25;
        rightAx = -0.95 + Math.sin(elapsed * 2.2 + phase) * 0.1 - eatPhase * 0.52;
        rightAz = 0.12 - eatPhase * 0.24;
        rightFx = -0.35 - eatPhase * 0.35;
      } else if (activity === 'eat') {
        const eatT = elapsed * 2.6 + phase;
        const bite = Math.max(0, Math.sin(eatT));
        body.rotation.z = Math.sin(eatT * 0.6) * 0.04;
        head.rotation.z = Math.sin(eatT * 0.8) * 0.06;
        head.rotation.y = Math.sin(eatT * 0.4) * 0.12;
        head.rotation.x = -0.04 + bite * 0.18;
        leftAx = -0.62;
        leftAz = 0.12;
        leftFx = -0.35;
        rightAx = -0.82 - bite * 0.5;
        rightAz = -0.18 - bite * 0.12;
        rightFx = -0.45 - bite * 0.35;
      } else {
        // Cozy chai/coffee sipper around the campfire
        const sipCycle = (elapsed * 0.45 + phase * 0.2) % 1;
        const sipLift = sipCycle > 0.35 ? Math.sin(((sipCycle - 0.35) / 0.65) * Math.PI) : 0;
        const sipT = elapsed * 1.8 + phase;
        body.rotation.z = Math.sin(sipT) * 0.035;
        head.rotation.z = Math.sin(sipT * 0.9) * 0.045;
        head.rotation.y = Math.sin(sipT * 0.45) * 0.14 * (1 - sipLift * 0.8);
        head.rotation.x = -0.09 + sipLift * 0.18;
        leftAx = -0.28;
        leftAz = -0.3;
        leftFx = -0.25;
        rightAx = -0.68 - sipLift * 0.65;
        rightAz = -0.15 - sipLift * 0.15;
        rightFx = -0.4 - sipLift * 0.35;
      }
    } else {
      body.position.y = 0;
      body.rotation.x = 0;
      body.scale.y = 1 + Math.sin(t * 2.2) * 0.025;
      body.rotation.z = Math.sin(t * 2.4) * char.hipWiggle * energy;
      head.rotation.z = Math.sin(t * 1.3) * char.sway;
      head.rotation.y = Math.sin(t * 0.6) * char.look;
      head.rotation.x = -0.06 - char.nod * 0.3 * (1 + Math.sin(t * 1.1));

      const wave = isHovered ? -1.15 + Math.sin(t * 6) * 0.38 : Math.sin(t * 2.1) * 0.22;
      leftAx = wave;
      leftAz = isHovered ? -0.46 : -0.34;
      leftFx = isHovered ? -0.35 : -0.22;
      rightAx = isHovered ? -1.15 - Math.sin(t * 6) * 0.38 : -wave;
      rightAz = isHovered ? 0.46 : 0.34;
      rightFx = isHovered ? -0.35 : -0.22;
    }

    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, leftAx, armBlend);
      leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, leftAz, armBlend);
    }
    if (leftForearmRef.current) {
      leftForearmRef.current.rotation.x = THREE.MathUtils.lerp(leftForearmRef.current.rotation.x, leftFx, armBlend);
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, rightAx, armBlend);
      rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, rightAz, armBlend);
    }
    if (rightForearmRef.current) {
      rightForearmRef.current.rotation.x = THREE.MathUtils.lerp(rightForearmRef.current.rotation.x, rightFx, armBlend);
    }

    if (tailRef.current) tailRef.current.rotation.y = Math.sin(t * 4.0) * 0.42;

    const blinking = (elapsed + phase) % char.blinkEvery < 0.12;
    eyeRefs.current.forEach((eye, idx) => {
      if (!eye) return;
      if (showLaughPose || activeCapturePose === 'throw') {
        eye.scale.y = 0.22 + Math.abs(Math.sin(elapsed * 14 + phase)) * 0.08;
        return;
      }
      if (showDizzyPose) {
        eye.scale.y = idx === 0 ? 0.28 + Math.abs(Math.sin(elapsed * 10)) * 0.65 : 0.9 - Math.abs(Math.sin(elapsed * 10)) * 0.65;
        return;
      }
      if (activeCapturePose === 'twirl_victim' || activeCapturePose === 'flail') {
        eye.scale.y = 1.16 + Math.sin(elapsed * 26 + idx * Math.PI) * 0.16;
        return;
      }
      if (activeCapturePose === 'grab' || activeCapturePose === 'twirl_attacker') {
        eye.scale.y = 1.08;
        return;
      }
      const winkScale = char.winkRight && idx === 1 ? 0.22 : 1;
      eye.scale.y = blinking ? 0.1 : winkScale * (isHovered ? 1.12 : 1);
    });
  });

  const eyeX = species === 'frog' ? 0.145 : 0.112;
  const eyeY = species === 'frog' ? 0.145 : 0.022;
  const eyeZ = species === 'frog' ? 0.222 : 0.262;
  const eyeRadius = species === 'frog' ? 0.076 : 0.072;

  const showHandCoffee = isSitting && activity === 'coffee';
  const showStaticCoffee = holdingCup && !showHandCoffee;
  const showMarshmallow = isSitting && activity === 'marshmallow';
  const showSnack = isSitting && activity === 'eat';

  return (
    <group scale={FIGURE_SCALE}>
      <group ref={bodyRef}>
        {/* Smooth sculpted pear torso */}
        <mesh geometry={torsoGeo} material={coatMat} castShadow receiveShadow />

        {/* Sturdy rounded plush neck connector bridging torso and head */}
        <mesh geometry={neckGeo} material={coatMat} position={[0, 0.54, 0]} castShadow />

        {/* Soft plush belly patch curving with chest contour */}
        <mesh material={bellyMat} position={[0, 0.26, 0.14]} scale={[1.05, 1.25, 0.55]}>
          <sphereGeometry args={[0.138, 22, 16]} />
        </mesh>

        {/* Articulated plush arms + solid ball-and-socket shoulder + seamless wrists & paw pads */}
        {[-1, 1].map((side) => (
          <group key={side}>
            {/* Smooth plush shoulder socket joint anchored firmly inside torso wall */}
            <mesh
              material={coatMat}
              position={[side * 0.142, 0.435, 0.012]}
              castShadow
            >
              <sphereGeometry args={[0.064, 18, 14]} />
            </mesh>

            <group
              ref={side < 0 ? leftArmRef : rightArmRef}
              position={[side * 0.145, 0.435, 0.012]}
              rotation={[0, 0, side * 0.34]}
            >
              <mesh geometry={armGeo} material={coatMat} castShadow />

              {/* Forearm & Elbow Joint */}
              <group
                ref={side < 0 ? leftForearmRef : rightForearmRef}
                position={[0, -0.125, 0]}
                rotation={[-0.22, 0, 0]}
              >
                {/* Overlapping smooth elbow joint ball */}
                <mesh material={coatMat} castShadow>
                  <sphereGeometry args={[0.054, 16, 12]} />
                </mesh>
                <mesh geometry={forearmGeo} material={coatMat} castShadow />

                {/* Wrist & Paw Hand */}
                <group position={[0, -0.11, 0]}>
                  {/* Plush wrist transition cuff */}
                  <mesh material={coatMat} castShadow>
                    <sphereGeometry args={[0.056, 16, 12]} />
                  </mesh>

                  {/* Cute chubby paw hand */}
                  <mesh geometry={handGeo} material={pawMat} castShadow />

                  {/* Sculpted inner thumb */}
                  <mesh
                    material={pawMat}
                    position={[-side * 0.038, -0.018, 0.018]}
                    rotation={[-0.32, 0, -side * 0.58]}
                    castShadow
                  >
                    <capsuleGeometry args={[0.02, 0.024, 6, 12]} />
                  </mesh>

                  {/* Adorable paw pads / toe beans! */}
                  {/* Main heart-shaped palm pad */}
                  <mesh
                    material={innerPawMat}
                    position={[0, -0.025, 0.038]}
                    scale={[1.05, 0.9, 0.4]}
                  >
                    <sphereGeometry args={[0.026, 14, 10]} />
                  </mesh>
                  {/* 3 cute little toe bean pads */}
                  {[-0.022, 0, 0.022].map((bx, bIdx) => (
                    <mesh
                      key={bIdx}
                      material={innerPawMat}
                      position={[bx, -0.052 - (bIdx === 1 ? 0.005 : 0), 0.036]}
                      scale={[0.9, 0.9, 0.4]}
                    >
                      <sphereGeometry args={[0.011, 10, 8]} />
                    </mesh>
                  ))}

                  {/* Chai / coffee mug held in right hand when sipping at picnic */}
                  {side > 0 && showHandCoffee && (
                    <group position={[0, -0.045, 0.045]} rotation={[0.35, 0, 0]}>
                      <mesh material={getGlossyMaterial('#fff7eb')}>
                        <cylinderGeometry args={[0.056, 0.044, 0.095, 16]} />
                      </mesh>
                      <mesh position={[0.052, 0, 0]} material={getGlossyMaterial('#fff7eb')}>
                        <torusGeometry args={[0.025, 0.008, 8, 12]} />
                      </mesh>
                      <mesh material={getGlossyMaterial('#9a5b32')} position-y={0.044}>
                        <cylinderGeometry args={[0.047, 0.047, 0.01, 16]} />
                      </mesh>
                    </group>
                  )}
                  {/* Marshmallow roasting stick held in right hand */}
                  {side > 0 && showMarshmallow && (
                    <group position={[0, -0.035, 0.03]} rotation={[1.25, 0, 0]}>
                      <mesh position-y={0.18}>
                        <cylinderGeometry args={[0.008, 0.008, 0.38, 6]} />
                        <meshStandardMaterial color="#b07d4f" roughness={0.8} />
                      </mesh>
                      <mesh position-y={0.37} rotation-x={Math.PI / 2}>
                        <cylinderGeometry args={[0.036, 0.036, 0.055, 10]} />
                        <meshStandardMaterial ref={marshmallowMatRef} color="#fff8f0" roughness={0.6} />
                      </mesh>
                      <mesh position={[0, 0.37, 0.026]} rotation-x={Math.PI / 2}>
                        <cylinderGeometry args={[0.032, 0.032, 0.012, 10]} />
                        <meshStandardMaterial color="#e09f5a" roughness={0.7} />
                      </mesh>
                    </group>
                  )}
                  {/* Plate held in left hand & snack bite in right hand */}
                  {side < 0 && showSnack && (
                    <group position={[0.015, -0.04, 0.045]}>
                      <mesh>
                        <cylinderGeometry args={[0.068, 0.056, 0.014, 14]} />
                        <meshStandardMaterial color="#ffffff" roughness={0.3} />
                      </mesh>
                      <mesh position-y={0.02}>
                        <boxGeometry args={[0.055, 0.028, 0.05]} />
                        <meshStandardMaterial color="#ffd6a5" roughness={0.65} />
                      </mesh>
                    </group>
                  )}
                  {side > 0 && showSnack && (
                    <group position={[-0.015, -0.045, 0.04]}>
                      <mesh position-y={0.012}>
                        <boxGeometry args={[0.042, 0.028, 0.038]} />
                        <meshStandardMaterial color="#ffd6a5" roughness={0.65} />
                      </mesh>
                      <mesh position-y={0.03}>
                        <sphereGeometry args={[0.016, 8, 6]} />
                        <meshStandardMaterial color="#ff4d6d" roughness={0.35} />
                      </mesh>
                    </group>
                  )}
                </group>
              </group>
            </group>

            {/* Chubby stubby chibi legs connecting hip socket to foot */}
            <mesh
              geometry={legGeo}
              material={coatMat}
              position={isSitting ? [side * 0.135, 0.065, 0.1] : [side * 0.102, 0.068, 0.038]}
              rotation={isSitting ? [-0.55, side * 0.3, 0] : [0.08, 0, 0]}
              castShadow
            />
            {/* Plump animal foot paw */}
            <mesh
              geometry={footGeo}
              material={pawMat}
              position={isSitting ? [side * 0.145, 0.042, 0.165] : [side * 0.105, 0.034, 0.055]}
              rotation={isSitting ? [-0.42, side * 0.35, 0] : [0, 0, 0]}
              castShadow
            />
          </group>
        ))}

        {/* Species tail */}
        <group ref={tailRef} position={[0, 0.14, -0.2]}>
          <AnimalTail species={species} coatMat={coatMat} coatColor={coatColor} />
        </group>

        {/* Sunny's sculpted curved neckerchief scarf + smooth ribbon tie */}
        {char.accessory === 'scarf' && (
          <group>
            <mesh material={accentMat} position-y={0.535} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.142, 0.045, 12, 24]} />
            </mesh>
            <group position={[0.095, 0.515, 0.155]} rotation={[0.15, -0.2, 0.24]}>
              <mesh geometry={getScarfTieGeometry()} material={accentMat} />
            </group>
          </group>
        )}

        {/* Professor's sculpted bowtie */}
        {char.accessory === 'glasses' && (
          <group position={[0, 0.515, 0.155]}>
            {[-1, 1].map((side) => (
              <mesh key={side} material={accentMat} position={[side * 0.042, 0, 0]} rotation-z={side * 0.28} scale={[1.2, 0.85, 0.55]}>
                <sphereGeometry args={[0.034, 12, 10]} />
              </mesh>
            ))}
            <mesh material={accentMat}>
              <sphereGeometry args={[0.019, 10, 8]} />
            </mesh>
          </group>
        )}

        {/* Friendly coffee hangout / picnic mug (shared square) */}
        <group position={[0.21, 0.39, 0.19]} visible={showStaticCoffee}>
          <mesh material={getGlossyMaterial('#ffffff')}>
            <cylinderGeometry args={[0.058, 0.046, 0.1, 16]} />
          </mesh>
          <mesh material={getGlossyMaterial('#8d5a3b')} position-y={0.046}>
            <cylinderGeometry args={[0.048, 0.048, 0.01, 16]} />
          </mesh>
        </group>

        {/* Smooth sculpted species head anchored seamlessly atop neck */}
        <group ref={headRef} position={[0, isSitting ? 0.61 : 0.65, 0]}>
          <mesh geometry={headGeo} material={coatMat} castShadow receiveShadow />

          <AnimalEars species={species} coatMat={coatMat} />
          <HeadAccessory accessory={char.accessory} accent={char.accent} species={species} />
          <AnimalMuzzle species={species} coatColor={coatColor} />

          {/* Glossy clearcoat-feel anime eyes & soft blush cheeks */}
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
                  <sphereGeometry args={[eyeRadius, 22, 18]} />
                </mesh>
              </group>

              <mesh
                material={getBlushMaterial()}
                position={[side * (species === 'frog' ? 0.21 : 0.192), -0.065, 0.232]}
                rotation-y={side * 0.36}
                scale={[1.3, 0.72, 0.35]}
              >
                <sphereGeometry args={[0.046, 14, 10]} />
              </mesh>
            </group>
          ))}

          <MouthShape
            mouth={char.mouth}
            species={species}
            laughing={showLaughPose || activeCapturePose === 'throw'}
            surprised={activeCapturePose === 'twirl_victim' || activeCapturePose === 'flail'}
            grinning={activeCapturePose === 'twirl_attacker' || activeCapturePose === 'grab'}
          />
        </group>
      </group>
    </group>
  );
}
