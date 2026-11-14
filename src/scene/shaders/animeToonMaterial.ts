/**
 * Anime cel-shading: MeshToonMaterial with a hard 3-band ramp plus a Fresnel rim light
 * injected into the fragment shader and tinted to an accent colour.
 *
 * Target: three.js WebGL2 forward renderer, desktop and mobile. Budget: the stock toon shader
 * plus one dot product and one pow per fragment; no extra texture samples, no branching, and a
 * single compiled variant shared by all rim materials.
 */
import * as THREE from 'three';

/** Light multipliers for the shadow, mid and lit bands. */
const TOON_BANDS = [150, 208, 255];

let gradientMap: THREE.DataTexture | null = null;

/** Shared 3x1 ramp texture. NearestFilter keeps the band edges crisp. */
export function getToonGradientMap(): THREE.DataTexture {
  if (!gradientMap) {
    const data = new Uint8Array(TOON_BANDS.flatMap((v) => [v, v, v, 255]));
    gradientMap = new THREE.DataTexture(data, TOON_BANDS.length, 1, THREE.RGBAFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

export interface AnimeToonOptions extends THREE.MeshToonMaterialParameters {
  /** Rim tint. Defaults to a lightened version of `color`. */
  rimColor?: THREE.ColorRepresentation;
  /** How strongly the rim adds to the lit colour. */
  rimStrength?: number;
}

const RIM_UNIFORMS = /* glsl */ `
uniform vec3 uRimColor; // rim tint, linear RGB
uniform float uRimStrength; // additive weight of the rim, 0..1
const float RIM_POWER = 3.0; // higher = thinner rim hugging the silhouette
`;

/** Runs just before the final colour is written, where `normal` and `outgoingLight` are in scope. */
const RIM_FRAGMENT = /* glsl */ `
{
  vec3 viewDir = normalize(vViewPosition);
  float rim = pow(1.0 - max(dot(normal, viewDir), 0.0), RIM_POWER);
  outgoingLight += uRimColor * rim * uRimStrength;
}
`;

export function createAnimeToonMaterial({ rimColor, rimStrength = 0.4, ...params }: AnimeToonOptions = {}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ gradientMap: getToonGradientMap(), ...params });
  const tint = rimColor !== undefined ? new THREE.Color(rimColor) : material.color.clone().lerp(new THREE.Color('#ffffff'), 0.4);
  const uniforms = { uRimColor: { value: tint }, uRimStrength: { value: rimStrength } };
  material.userData.rimUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${RIM_UNIFORMS}\n#include <common>`)
      .replace('#include <opaque_fragment>', `${RIM_FRAGMENT}\n#include <opaque_fragment>`);
  };
  // Every rim material compiles to the same program; only the uniform values differ.
  material.customProgramCacheKey = () => 'anime-toon-rim';
  return material;
}

const sharedMaterials = new Map<string, THREE.MeshToonMaterial>();

/** Cached flat-colour anime material, shared by every mesh asking for the same colours. */
export function getAnimeToonMaterial(color: string, rimColor?: string): THREE.MeshToonMaterial {
  const key = `${color}|${rimColor ?? ''}`;
  let material = sharedMaterials.get(key);
  if (!material) {
    material = createAnimeToonMaterial({ color, rimColor });
    sharedMaterials.set(key, material);
  }
  return material;
}

type SourceMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  alphaMap?: THREE.Texture | null;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
};

const converted = new WeakMap<THREE.Material, Map<string, THREE.MeshToonMaterial>>();

function convertMaterial(source: SourceMaterial, accent: string): THREE.MeshToonMaterial {
  let byAccent = converted.get(source);
  if (!byAccent) converted.set(source, (byAccent = new Map()));
  let material = byAccent.get(accent);
  if (!material) {
    material = createAnimeToonMaterial({
      name: source.name,
      color: source.color ?? new THREE.Color('#ffffff'),
      map: source.map ?? null,
      alphaMap: source.alphaMap ?? null,
      emissive: source.emissive ?? new THREE.Color('#000000'),
      emissiveMap: source.emissiveMap ?? null,
      emissiveIntensity: source.emissiveIntensity ?? 1,
      transparent: source.transparent,
      opacity: source.opacity,
      alphaTest: source.alphaTest,
      side: source.side,
      vertexColors: source.vertexColors,
      rimColor: accent,
    });
    byAccent.set(accent, material);
  }
  return material;
}

/**
 * Swaps every mesh material under `root` (e.g. a loaded GLTF scene) for the anime toon
 * material, keeping base colour, `map` texture, transparency and emissive settings, and
 * generating normals for meshes that were exported without them.
 * Conversions are cached per source material, so clones of one model share materials.
 */
export function applyAnimeToon(root: THREE.Object3D, accent: string): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Toon shading has no flat-shaded mode, so meshes exported without normals get smooth ones.
    // Undefined normals would turn into NaNs that black out the bloom pass.
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => convertMaterial(m, accent))
      : convertMaterial(mesh.material, accent);
  });
}
