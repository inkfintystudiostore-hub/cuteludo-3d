/**
 * Smooth high-segment procedural geometries for the cute 3D animal figurines.
 * Built with sculpted spheres, LatheGeometry contours, and CatmullRomCurve3 tubes
 * so every silhouette reads plush, rounded, and toy-like up close.
 */
import * as THREE from 'three';

export type AnimalSpecies = 'cat' | 'bunny' | 'bear' | 'frog';

const headCache = new Map<AnimalSpecies, THREE.BufferGeometry>();
let torsoGeo: THREE.BufferGeometry | null = null;
let armGeo: THREE.BufferGeometry | null = null;
let footGeo: THREE.BufferGeometry | null = null;
let catEarGeo: THREE.BufferGeometry | null = null;
let bunnyEarGeo: THREE.BufferGeometry | null = null;
let bearEarGeo: THREE.BufferGeometry | null = null;
let catTailGeo: THREE.BufferGeometry | null = null;
let whiskerGeo: THREE.BufferGeometry | null = null;
let scarfTieGeo: THREE.BufferGeometry | null = null;
let beretGeo: THREE.BufferGeometry | null = null;

/** Smoothly pear-shaped plush chibi animal body spanning y = 0.03..0.58. */
export function getAnimalTorsoGeometry(): THREE.BufferGeometry {
  if (torsoGeo) return torsoGeo;
  const pts: THREE.Vector2[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = bottom hip, 1 = neck crown
    const y = 0.035 + t * 0.545;
    // Soft bell/pear profile: plump seated belly at t ~ 0.35 tapering softly to neck.
    const cap = Math.sin(t * Math.PI);
    const pear = 1.08 - 0.34 * THREE.MathUtils.smoothstep(t, 0.25, 0.92);
    const r = Math.max(0.001, 0.225 * Math.pow(Math.max(cap, 0), 0.58) * pear);
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 56);
  geo.computeVertexNormals();
  torsoGeo = geo;
  return geo;
}

/** Sculpted species-specific animal head with organic cheeks, snout, and crown. */
export function getAnimalHeadGeometry(species: AnimalSpecies): THREE.BufferGeometry {
  const cached = headCache.get(species);
  if (cached) return cached;

  const geo = new THREE.SphereGeometry(0.285, 64, 48);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

    if (species === 'frog') {
      // Wide, happy tree-frog cranium with seamlessly integrated upper eye domes.
      x *= 1.24;
      y *= 0.84;
      z *= 0.98;
      const cheek = Math.exp(-Math.pow((y + 0.05) / 0.11, 2)) * THREE.MathUtils.smoothstep(z, -0.04, 0.16);
      x *= 1 + 0.12 * cheek;
      z += 0.03 * cheek;

      // Left & right integrated brow eye-mounds growing cleanly out of top crown.
      const eyeL = Math.exp(-(Math.pow((x - 0.145) / 0.095, 2) + Math.pow((z - 0.085) / 0.1, 2))) * THREE.MathUtils.smoothstep(y, 0.05, 0.2);
      const eyeR = Math.exp(-(Math.pow((x + 0.145) / 0.095, 2) + Math.pow((z - 0.085) / 0.1, 2))) * THREE.MathUtils.smoothstep(y, 0.05, 0.2);
      y += 0.095 * (eyeL + eyeR);
      z += 0.025 * (eyeL + eyeR);
    } else if (species === 'bear') {
      // Broad plush teddy head with rounded jaw cheeks and subtle integrated muzzle bump.
      x *= 1.15;
      y *= 0.95;
      z *= 0.98;
      const jawCheek = Math.exp(-Math.pow((y + 0.065) / 0.1, 2)) * THREE.MathUtils.smoothstep(z, -0.05, 0.14);
      x *= 1 + 0.14 * jawCheek;
      const snout = Math.exp(-(Math.pow(x / 0.14, 2) + Math.pow((y + 0.055) / 0.1, 2))) * THREE.MathUtils.smoothstep(z, 0.08, 0.26);
      z += 0.055 * snout;
    } else if (species === 'bunny') {
      // Gentle rounded bunny cheeks with slightly taller sweet crown.
      x *= 1.1;
      y *= 0.98;
      z *= 0.97;
      const cheek = Math.exp(-Math.pow((y + 0.055) / 0.095, 2)) * THREE.MathUtils.smoothstep(z, -0.04, 0.14);
      x *= 1 + 0.16 * cheek;
      z += 0.03 * cheek;
    } else {
      // Cute kitty head: wide chubby cheeks, gently tapered temple & soft whisker-puff snout.
      x *= 1.13;
      y *= 0.92;
      z *= 0.96;
      const cheek = Math.exp(-Math.pow((y + 0.055) / 0.095, 2)) * THREE.MathUtils.smoothstep(z, -0.04, 0.15);
      x *= 1 + 0.16 * cheek;
      z += 0.035 * cheek;
      // Soft top taper toward ears.
      const topTaper = THREE.MathUtils.smoothstep(y, 0.08, 0.26);
      x *= 1 - 0.07 * topTaper;
    }

    pos.setXYZ(i, x, y, z);
  }

  geo.computeVertexNormals();
  headCache.set(species, geo);
  return geo;
}

/** Gently curved teardrop plush arm hanging from shoulder. */
export function getArmGeometry(): THREE.BufferGeometry {
  if (armGeo) return armGeo;
  const pts: THREE.Vector2[] = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = shoulder top, 1 = rounded paw tip
    const y = -t * 0.21;
    const swell = Math.sin(t * Math.PI);
    const pawBulb = 0.72 + 0.45 * THREE.MathUtils.smoothstep(t, 0.2, 0.78);
    const r = Math.max(0.001, 0.058 * Math.pow(Math.max(swell, 0), 0.55) * pawBulb);
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 32);
  geo.computeVertexNormals();
  armGeo = geo;
  return geo;
}

/** Plump animal paw foot with flat grounded sole and subtle 3-toe front sculpt. */
export function getFootGeometry(): THREE.BufferGeometry {
  if (footGeo) return footGeo;
  const geo = new THREE.SphereGeometry(0.084, 36, 24);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * 1.04;
    let y = pos.getY(i) * 0.62;
    let z = pos.getZ(i) * 1.32;
    // Gently flatten sole at bottom.
    if (y < -0.032) y = -0.032 + (y + 0.032) * 0.15;
    // Subtle 3-toe scallop on front tip.
    if (z > 0.04) {
      const ang = Math.atan2(x, z);
      const lobe = 1 + 0.065 * Math.cos(ang * 5);
      z *= lobe;
      x *= 1 + 0.03 * Math.cos(ang * 5);
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  footGeo = geo;
  return geo;
}

/** Smooth sculpted rounded-triangle kitty ear with soft forward spoon hollow. */
export function getCatEarGeometry(): THREE.BufferGeometry {
  if (catEarGeo) return catEarGeo;
  const geo = new THREE.SphereGeometry(0.11, 36, 28);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const h = THREE.MathUtils.clamp((y + 0.11) / 0.22, 0, 1); // 0 bottom .. 1 tip
    // Taper smoothly toward a plush rounded apex.
    const taper = 1.08 - 0.72 * Math.pow(h, 1.35);
    x *= taper * 1.05;
    y = h * 0.21;
    z *= (0.48 - 0.2 * h);
    // Slight backward scoop along center front for natural ear concavity.
    const center = Math.exp(-Math.pow(x / 0.055, 2)) * THREE.MathUtils.smoothstep(h, 0.15, 0.78);
    if (z > 0) z -= 0.014 * center;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  catEarGeo = geo;
  return geo;
}

/** Smooth spoon-curved plush bunny ear with rounded petal tip. */
export function getBunnyEarGeometry(): THREE.BufferGeometry {
  if (bunnyEarGeo) return bunnyEarGeo;
  const pts: THREE.Vector2[] = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 = base, 1 = rounded tip
    const y = t * 0.36;
    const basePinch = 0.58 + 0.65 * Math.sin(Math.pow(t, 0.72) * Math.PI);
    const tipCap = THREE.MathUtils.smoothstep(1 - t, 0, 0.14);
    const r = Math.max(0.001, 0.066 * basePinch * (0.35 + 0.65 * tipCap));
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 36);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 1.05;
    const y = pos.getY(i);
    let z = pos.getZ(i) * 0.45;
    // Gentle forward curve near tip for natural rabbit poise.
    const h = y / 0.36;
    z += Math.pow(h, 2) * 0.045;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  bunnyEarGeo = geo;
  return geo;
}

/** Smooth slightly cupped round teddy bear ear. */
export function getBearEarGeometry(): THREE.BufferGeometry {
  if (bearEarGeo) return bearEarGeo;
  const geo = new THREE.SphereGeometry(0.112, 32, 24);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 1.04;
    const y = pos.getY(i) * 0.98;
    let z = pos.getZ(i) * 0.58;
    const radial = Math.hypot(x, y) / 0.112;
    if (z > 0) z -= 0.018 * Math.max(0, 1 - radial * radial);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  bearEarGeo = geo;
  return geo;
}

/** Playful S-curved kitty tail tube. */
export function getCatTailGeometry(): THREE.BufferGeometry {
  if (catTailGeo) return catTailGeo;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.02, 0.06, -0.11),
    new THREE.Vector3(0.08, 0.19, -0.17),
    new THREE.Vector3(0.04, 0.3, -0.13),
    new THREE.Vector3(-0.02, 0.34, -0.08),
  ]);
  catTailGeo = new THREE.TubeGeometry(curve, 28, 0.032, 16, false);
  return catTailGeo;
}

/** Graceful tapering arched cat whisker arc. */
export function getWhiskerGeometry(): THREE.BufferGeometry {
  if (whiskerGeo) return whiskerGeo;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.045, -0.005, 0.004),
    new THREE.Vector3(0.092, -0.02, -0.008),
  ]);
  whiskerGeo = new THREE.TubeGeometry(curve, 12, 0.0042, 8, false);
  return whiskerGeo;
}

/** Soft rounded draped scarf tail ribbon (no box corners). */
export function getScarfTieGeometry(): THREE.BufferGeometry {
  if (scarfTieGeo) return scarfTieGeo;
  const pts: THREE.Vector2[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -t * 0.16;
    const r = Math.max(0.001, (0.026 + 0.022 * t) * Math.sin(Math.pow(t, 0.45) * Math.PI * 0.94));
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.scale(1.15, 1, 0.42);
  geo.computeVertexNormals();
  scarfTieGeo = geo;
  return geo;
}

/** Plush sculpted cozy beret cap. */
export function getBeretGeometry(): THREE.BufferGeometry {
  if (beretGeo) return beretGeo;
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.11, -0.015),
    new THREE.Vector2(0.145, 0.0),
    new THREE.Vector2(0.195, 0.028),
    new THREE.Vector2(0.18, 0.062),
    new THREE.Vector2(0.105, 0.082),
    new THREE.Vector2(0.0, 0.088),
  ];
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.computeVertexNormals();
  beretGeo = geo;
  return geo;
}
