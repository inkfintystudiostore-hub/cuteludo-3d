/**
 * High-resolution procedural CanvasTextures (2048px) for smooth, 4K-detailed
 * animal figurines: glossy layered eyes, plush coat markings, and subtle microfiber bump.
 * Cached once at module scope.
 */
import * as THREE from 'three';
import type { AnimalSpecies } from './characterGeometry';
import { INK } from './effects/canvasShapes';

const eyeCache = new Map<string, THREE.CanvasTexture>();
const coatCache = new Map<string, THREE.CanvasTexture>();
const outfitCache = new Map<string, THREE.CanvasTexture>();
let furBumpCache: THREE.CanvasTexture | null = null;

export type EyeMood = 'cheeky' | 'sharp' | 'sleepy' | 'sparkle' | 'frog';

/** Crisp 512px resin/anime animal eye texture with luminous iris depth & catchlights. */
export function getAnimeEyeTexture(mood: EyeMood, irisColor = '#2b213a'): THREE.CanvasTexture {
  const key = `${mood}|${irisColor}`;
  const cached = eyeCache.get(key);
  if (cached) return cached;

  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const c = s / 2;

  // Warm ceramic eye sclera base.
  ctx.fillStyle = '#fffdfb';
  ctx.fillRect(0, 0, s, s);

  // Top upper-lid ambient shadow.
  const scleraShade = ctx.createLinearGradient(0, s * 0.14, 0, s * 0.56);
  scleraShade.addColorStop(0, 'rgba(186, 174, 210, 0.52)');
  scleraShade.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = scleraShade;
  ctx.fillRect(0, 0, s, s * 0.56);

  const irisR = mood === 'sleepy' ? s * 0.24 : mood === 'frog' ? s * 0.31 : s * 0.295;
  const irisY = mood === 'sleepy' ? c + s * 0.045 : c + s * 0.01;

  // Rich multi-stop luminous iris.
  const grad = ctx.createRadialGradient(c, irisY - irisR * 0.28, irisR * 0.08, c, irisY, irisR);
  const brightIris = mood === 'frog' ? '#ffbe0b' : irisColor;
  const midIris = new THREE.Color(brightIris).lerp(new THREE.Color('#2b213a'), 0.42).getStyle();
  grad.addColorStop(0, brightIris);
  grad.addColorStop(0.55, midIris);
  grad.addColorStop(0.88, INK);
  grad.addColorStop(1, '#1a1224');

  ctx.beginPath();
  ctx.ellipse(c, irisY, irisR * 0.94, irisR * 1.04, 0, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle iris radial sheen fibers.
  ctx.save();
  ctx.translate(c, irisY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = s * 0.004;
  for (let a = 0; a < 24; a++) {
    const rad = (a / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * irisR * 0.42, Math.sin(rad) * irisR * 0.42);
    ctx.lineTo(Math.cos(rad) * irisR * 0.88, Math.sin(rad) * irisR * 0.92);
    ctx.stroke();
  }
  ctx.restore();

  // Expressive pupil: horizontal cute frog bar vs round animal pupil.
  ctx.beginPath();
  if (mood === 'frog') {
    ctx.ellipse(c, irisY, irisR * 0.56, irisR * 0.3, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(c, irisY + s * 0.01, irisR * 0.48, irisR * 0.54, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = '#140e1d';
  ctx.fill();

  // Lower luminous bounce crescent.
  ctx.beginPath();
  ctx.ellipse(c, irisY + irisR * 0.48, irisR * 0.56, irisR * 0.22, 0, 0, Math.PI);
  ctx.fillStyle = mood === 'frog' ? 'rgba(255, 248, 190, 0.42)' : 'rgba(255, 224, 244, 0.36)';
  ctx.fill();

  // Soft glossy studio catchlights.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(c - irisR * 0.32, irisY - irisR * 0.34, irisR * 0.25, irisR * 0.2, -0.35, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c + irisR * 0.32, irisY + irisR * 0.24, irisR * 0.1, 0, Math.PI * 2);
  ctx.fill();

  if (mood === 'sparkle' || mood === 'frog') {
    ctx.beginPath();
    ctx.arc(c + irisR * 0.3, irisY - irisR * 0.36, irisR * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smooth tapered upper lash line.
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.048;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'sleepy') {
    ctx.moveTo(c - irisR * 1.15, irisY - irisR * 0.18);
    ctx.quadraticCurveTo(c, irisY - irisR * 0.36, c + irisR * 1.15, irisY - irisR * 0.18);
  } else {
    ctx.arc(c, irisY, irisR * 1.03, Math.PI * 1.12, Math.PI * 1.88);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  eyeCache.set(key, texture);
  return texture;
}

/** Smooth coat texture with soft ambient fur gradients and species markings. */
export function getAnimalCoatTexture(species: AnimalSpecies, coatColor: string): THREE.CanvasTexture {
  const key = `${species}|${coatColor}`;
  const cached = coatCache.get(key);
  if (cached) return cached;

  const s = 512;
  const k = s / 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  const base = new THREE.Color(coatColor);
  const crown = `#${base.clone().lerp(new THREE.Color('#ffffff'), 0.18).getHexString()}`;
  const shadow = `#${base.clone().lerp(new THREE.Color('#2b213a'), 0.1).getHexString()}`;

  // Soft vertical studio coat gradient so top reads airy & plush, underside grounds warmly.
  const bodyGrad = ctx.createLinearGradient(0, 0, 0, s);
  bodyGrad.addColorStop(0, crown);
  bodyGrad.addColorStop(0.52, coatColor);
  bodyGrad.addColorStop(1, shadow);
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(0, 0, s, s);

  if (species === 'frog') {
    // Organic mossy mint-lime speckles across upper head/back (v top half).
    const spotColor = `#${base.clone().lerp(new THREE.Color('#1f6f54'), 0.34).getHexString()}`;
    ctx.fillStyle = spotColor;
    ctx.globalAlpha = 0.24;
    for (let i = 0; i < 42; i++) {
      const x = (((i * 397) % 1840) + 100) * k;
      const y = (((i * 251) % 860) + 120) * k;
      const r = (18 + (i % 5) * 9) * k;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.15, r * 0.85, (i % 7) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // Soft plush fur heather strokes across the surface.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 240; i++) {
      const x = ((i * 487) % 2048) * k;
      const y = ((i * 331) % 2048) * k;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ((i % 3) - 1) * 6 * k, y + 18 * k);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  coatCache.set(key, texture);
  return texture;
}

/** Shared seamless plush microfiber bump map for tactile velvety depth. */
export function getAnimalFurBumpTexture(): THREE.CanvasTexture {
  if (furBumpCache) return furBumpCache;
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, s, s);

  for (let i = 0; i < 600; i++) {
    const x = (i * 373) % s;
    const y = (i * 617) % s;
    const bright = i % 2 === 0 ? 'rgba(220,220,220,0.16)' : 'rgba(60,60,60,0.14)';
    ctx.strokeStyle = bright;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + ((i % 5) - 2), y + 3);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = 4;
  furBumpCache = texture;
  return texture;
}

/** Garment fabric texture preserved for external callers. */
export function getOutfitTexture(slot: number, baseColor: string, accentColor: string): THREE.CanvasTexture {
  const key = `${slot}|${baseColor}|${accentColor}`;
  const cached = outfitCache.get(key);
  if (cached) return cached;

  const s = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < s; i += 8) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }

  const frontX = s * 0.5;
  if (slot === 0) {
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, s * 0.78, s, s * 0.08);
    drawStar(ctx, frontX, s * 0.44, s * 0.085, s * 0.038, '#ffd166', INK, 3);
  } else if (slot === 1) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(frontX - s * 0.055, s * 0.15, s * 0.11, s * 0.65);
    ctx.fillStyle = accentColor;
    ctx.fillRect(frontX - s * 0.022, s * 0.18, s * 0.044, s * 0.42);
    for (const by of [0.58, 0.7]) {
      ctx.beginPath();
      ctx.arc(frontX, s * by, s * 0.018, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  } else if (slot === 2) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (const sy of [0.3, 0.46, 0.62]) ctx.fillRect(0, s * sy, s, s * 0.035);
    ctx.fillStyle = accentColor;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(frontX + s * 0.04, s * 0.42, s * 0.09, s * 0.1, 6);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    for (let gx = 0; gx < 12; gx++) {
      for (let gy = 2; gy < 9; gy++) {
        ctx.beginPath();
        ctx.arc(((gx + (gy % 2) * 0.5) / 12) * s, (gy / 10) * s, s * 0.016, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, s * 0.76, s, s * 0.06);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  outfitCache.set(key, texture);
  return texture;
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  fill: string,
  stroke: string,
  lineWidth: number,
) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
