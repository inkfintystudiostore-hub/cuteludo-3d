/**
 * Procedural CanvasTexture generators for the 3D board and tabletop.
 * Textures are cached once at module scope so re-renders never allocate GPU memory.
 */
import * as THREE from 'three';
import type { TeamId } from '../engine/boardMap';
import { INK } from './effects/canvasShapes';

let woodTexture: THREE.CanvasTexture | null = null;
let tableMatTexture: THREE.CanvasTexture | null = null;
const emblemTextures = new Map<TeamId, THREE.CanvasTexture>();

/** Warm birch/maple wood grain texture for the board frame and base. */
export function getWoodTexture(): THREE.CanvasTexture {
  if (woodTexture) return woodTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#f6e1ba');
  base.addColorStop(0.5, '#f1d6a7');
  base.addColorStop(1, '#f4ddb4');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Subtle horizontal wood grain streaks.
  for (let i = 0; i < 64; i++) {
    const y = (i / 64) * size;
    const wave = Math.sin(i * 0.7) * 6;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(196, 152, 92, 0.14)' : 'rgba(255, 249, 236, 0.22)';
    ctx.lineWidth = 1.5 + (i % 4) * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.33, y + wave, size * 0.66, y - wave, size, y + (i % 2 === 0 ? 2 : -2));
    ctx.stroke();
  }

  // Soft grain ring knot.
  ctx.strokeStyle = 'rgba(182, 134, 72, 0.08)';
  ctx.lineWidth = 2;
  for (let r = 12; r <= 48; r += 12) {
    ctx.beginPath();
    ctx.ellipse(size * 0.72, size * 0.28, r * 1.9, r * 0.65, 0.12, 0, Math.PI * 2);
    ctx.stroke();
  }

  woodTexture = new THREE.CanvasTexture(canvas);
  woodTexture.colorSpace = THREE.SRGBColorSpace;
  woodTexture.wrapS = THREE.RepeatWrapping;
  woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.anisotropy = 4;
  return woodTexture;
}

/** Soft pastel tabletop halo fading cleanly into the scene background. */
export function getTableMatTexture(): THREE.CanvasTexture {
  if (tableMatTexture) return tableMatTexture;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, '#fbd6e4');
  grad.addColorStop(0.55, '#fde3ed');
  grad.addColorStop(1, '#ffeef4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  tableMatTexture = new THREE.CanvasTexture(canvas);
  tableMatTexture.colorSpace = THREE.SRGBColorSpace;
  return tableMatTexture;
}

/** Subtle ink-line mascot watermark placed at the center of each team's yard. */
export function getTeamEmblemTexture(team: TeamId): THREE.CanvasTexture {
  const cached = emblemTextures.get(team);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  ctx.clearRect(0, 0, size, size);
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

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  emblemTextures.set(team, texture);
  return texture;
}
