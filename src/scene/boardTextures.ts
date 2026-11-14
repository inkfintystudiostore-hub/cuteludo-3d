/**
 * Procedural CanvasTexture generators for the 3D board and tabletop.
 * Textures are cached once at module scope so re-renders never allocate GPU memory.
 */
import * as THREE from 'three';
import type { TeamId } from '../engine/boardMap';
import { INK } from './effects/canvasShapes';

let woodTexture: THREE.CanvasTexture | null = null;
let tableMatTexture: THREE.CanvasTexture | null = null;
let picnicBlanketTexture: THREE.CanvasTexture | null = null;
const emblemTextures = new Map<TeamId, THREE.CanvasTexture>();

function createCrispBoardTexture(canvas: HTMLCanvasElement, repeat = false, anisotropy = 8): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/** 2K birch/maple wood grain texture with fine fiber detail for 4K board rendering. */
export function getWoodTexture(): THREE.CanvasTexture {
  if (woodTexture) return woodTexture;
  const size = 2048;
  const k = size / 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#f6e1ba');
  base.addColorStop(0.5, '#f1d6a7');
  base.addColorStop(1, '#f4ddb4');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Subtle horizontal wood grain streaks and fine timber fibers.
  for (let i = 0; i < 128; i++) {
    const y = (i / 128) * size;
    const wave = Math.sin(i * 0.7) * 6 * k;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(196, 152, 92, 0.14)' : 'rgba(255, 249, 236, 0.22)';
    ctx.lineWidth = (1.1 + (i % 4) * 0.55) * k;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y + wave, size * 0.66, y - wave, size, y + (i % 2 === 0 ? 2 : -2) * k);
    ctx.stroke();
  }

  // Soft grain ring knot.
  ctx.strokeStyle = 'rgba(182, 134, 72, 0.08)';
  ctx.lineWidth = 2 * k;
  for (let r = 12; r <= 48; r += 12) {
    ctx.beginPath();
    ctx.ellipse(size * 0.72, size * 0.28, r * 1.9 * k, r * 0.65 * k, 0.12, 0, Math.PI * 2);
    ctx.stroke();
  }

  woodTexture = createCrispBoardTexture(canvas, true, 8);
  return woodTexture;
}

/** Soft pastel tabletop halo fading cleanly into the scene background. */
export function getTableMatTexture(): THREE.CanvasTexture {
  if (tableMatTexture) return tableMatTexture;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, '#fbd6e4');
  grad.addColorStop(0.55, '#fde3ed');
  grad.addColorStop(1, '#ffeef4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  tableMatTexture = createCrispBoardTexture(canvas, false, 4);
  return tableMatTexture;
}

/** Crisp 1K ink-line mascot watermark placed at the center of each team's yard. */
export function getTeamEmblemTexture(team: TeamId): THREE.CanvasTexture {
  const cached = emblemTextures.get(team);
  if (cached) return cached;

  const size = 1024;
  const baseSize = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = baseSize / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / baseSize, size / baseSize);
  ctx.globalAlpha = 0.34;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (team === 'PINK') {
    // Cat silhouette: round head + pointed ears.
    ctx.beginPath();
    ctx.moveTo(c - 58, c - 14);
    ctx.lineTo(c - 64, c - 76);
    ctx.lineTo(c - 20, c - 44);
    ctx.quadraticCurveTo(c, c - 50, c + 20, c - 44);
    ctx.lineTo(c + 64, c - 76);
    ctx.lineTo(c + 58, c - 14);
    ctx.arc(c, c + 8, 60, -0.35, Math.PI + 0.35);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c - 22, c + 4, 6, 0, Math.PI * 2);
    ctx.arc(c + 22, c + 4, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (team === 'CYAN') {
    // Bunny silhouette: two tall ears + chubby cheeks.
    ctx.beginPath();
    ctx.ellipse(c - 28, c - 44, 18, 46, -0.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c + 28, c - 44, 18, 46, 0.12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c, c + 26, 56, 44, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (team === 'YELLOW') {
    // Bear silhouette: round ears + snout circle.
    ctx.beginPath();
    ctx.arc(c - 44, c - 42, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c + 44, c - 42, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c + 8, 56, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c, c + 22, 22, 16, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Mint sprout: stem + twin leaves.
    ctx.beginPath();
    ctx.moveTo(c, c + 64);
    ctx.quadraticCurveTo(c - 4, c + 6, c, c - 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c - 32, c - 26, 36, 18, -0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(c + 32, c - 22, 36, 18, 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const texture = createCrispBoardTexture(canvas, false, 8);
  emblemTextures.set(team, texture);
  return texture;
}

/** Cozy 1K pastel gingham picnic blanket texture for the central Home campfire meadow. */
export function getPicnicBlanketTexture(): THREE.CanvasTexture {
  if (picnicBlanketTexture) return picnicBlanketTexture;
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fff8ee';
  ctx.fillRect(0, 0, size, size);

  const cell = size / 8;
  ctx.fillStyle = 'rgba(255, 143, 171, 0.28)';
  for (let i = 0; i < 8; i += 2) {
    ctx.fillRect(i * cell, 0, cell, size);
    ctx.fillRect(0, i * cell, size, cell);
  }
  ctx.fillStyle = 'rgba(255, 107, 138, 0.22)';
  for (let x = 0; x < 8; x += 2) {
    for (let y = 0; y < 8; y += 2) {
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // Subtle woven linen grain lines for crisp close-up inspection.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  picnicBlanketTexture = createCrispBoardTexture(canvas, true, 8);
  return picnicBlanketTexture;
}
