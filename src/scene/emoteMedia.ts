import * as THREE from 'three';
import type { RoomEmoteId } from '../engine/multiplayerProtocol';

export interface EmoteDef {
  id: RoomEmoteId;
  label: string;
  src: string;
  thumb: string;
  /** Natural full playback duration on the yard board in ms (no upper cap). */
  durationMs: number;
  /** Natural width / height aspect ratio fallback before video metadata loads. */
  aspect: number;
}

const ASSET_BASE = import.meta.env.BASE_URL;

export const EMOTES: readonly EmoteDef[] = [
  { id: 'laugh', label: 'Laugh & Point', src: `${ASSET_BASE}emotes/laugh.mp4`, thumb: `${ASSET_BASE}emotes/laugh_thumb.jpg`, durationMs: 3300, aspect: 400 / 400 },
  { id: 'loading', label: 'Loading Brain', src: `${ASSET_BASE}emotes/loading.mp4`, thumb: `${ASSET_BASE}emotes/loading_thumb.jpg`, durationMs: 3600, aspect: 200 / 188 },
  { id: 'wave', label: 'Cutie Wave', src: `${ASSET_BASE}emotes/wave.mp4`, thumb: `${ASSET_BASE}emotes/wave_thumb.jpg`, durationMs: 2900, aspect: 200 / 190 },
  { id: 'grumpy', label: 'Grumpy Side-Eye', src: `${ASSET_BASE}emotes/grumpy.mp4`, thumb: `${ASSET_BASE}emotes/grumpy_thumb.jpg`, durationMs: 3933, aspect: 200 / 266 },
  { id: 'angry', label: 'Angry Glare', src: `${ASSET_BASE}emotes/angry.mp4`, thumb: `${ASSET_BASE}emotes/angry_thumb.jpg`, durationMs: 1760, aspect: 464 / 464 },
  { id: 'chihuahuaside', label: 'Side-Eye Pup', src: `${ASSET_BASE}emotes/chihuahuaside.mp4`, thumb: `${ASSET_BASE}emotes/chihuahuaside_thumb.jpg`, durationMs: 3000, aspect: 192 / 192 },
  { id: 'minionkiss', label: 'Minion Kiss', src: `${ASSET_BASE}emotes/minionkiss.mp4`, thumb: `${ASSET_BASE}emotes/minionkiss_thumb.jpg`, durationMs: 1800, aspect: 200 / 112 },
  { id: 'dogbleh', label: 'Doggo Blehh', src: `${ASSET_BASE}emotes/dogbleh.mp4`, thumb: `${ASSET_BASE}emotes/dogbleh_thumb.jpg`, durationMs: 2000, aspect: 480 / 476 },
  { id: 'dogstare', label: 'Standing Stare', src: `${ASSET_BASE}emotes/dogstare.mp4`, thumb: `${ASSET_BASE}emotes/dogstare_thumb.jpg`, durationMs: 3400, aspect: 400 / 400 },
  { id: 'dogbeach', label: 'Beach Vibe', src: `${ASSET_BASE}emotes/dogbeach.mp4`, thumb: `${ASSET_BASE}emotes/dogbeach_thumb.jpg`, durationMs: 3933, aspect: 192 / 128 },
  { id: 'dogdance', label: 'Happy Dog Dance', src: `${ASSET_BASE}emotes/dogdance.mp4`, thumb: `${ASSET_BASE}emotes/dogdance_thumb.jpg`, durationMs: 12000, aspect: 192 / 240 },
  { id: 'dogsuspect', label: 'Side-Eye Dog', src: `${ASSET_BASE}emotes/dogsuspect.mp4`, thumb: `${ASSET_BASE}emotes/dogsuspect_thumb.jpg`, durationMs: 7400, aspect: 192 / 192 },
  { id: 'doghands', label: 'Hold Up Chill', src: `${ASSET_BASE}emotes/doghands.mp4`, thumb: `${ASSET_BASE}emotes/doghands_thumb.jpg`, durationMs: 4000, aspect: 200 / 200 },
  { id: 'dogshock', label: 'Shook Pup', src: `${ASSET_BASE}emotes/dogshock.mp4`, thumb: `${ASSET_BASE}emotes/dogshock_thumb.jpg`, durationMs: 1933, aspect: 200 / 170 },
  { id: 'sadhamster', label: 'Sad Hamster', src: `${ASSET_BASE}emotes/sadhamster.mp4`, thumb: `${ASSET_BASE}emotes/sadhamster_thumb.jpg`, durationMs: 7600, aspect: 192 / 192 },
  { id: 'huskydance', label: 'Chikiri Husky', src: `${ASSET_BASE}emotes/huskydance.mp4`, thumb: `${ASSET_BASE}emotes/huskydance_thumb.jpg`, durationMs: 8133, aspect: 498 / 332 },
];

const DEF_BY_ID = new Map<RoomEmoteId, EmoteDef>(EMOTES.map((e) => [e.id, e]));

interface EmoteVideoEntry {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
}

const cache = new Map<RoomEmoteId, EmoteVideoEntry>();

/** Lazily creates and caches one muted looping VideoTexture kept paused until an active yard emote needs it. */
export function getEmoteVideoEntry(id: RoomEmoteId): EmoteVideoEntry {
  const existing = cache.get(id);
  if (existing) return existing;

  const def = DEF_BY_ID.get(id) ?? EMOTES[0];
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.autoplay = false;
  video.playsInline = true;
  video.preload = 'metadata';
  video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.src = def.src;

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const entry: EmoteVideoEntry = { video, texture };
  cache.set(id, entry);
  return entry;
}

/** Returns the uncropped natural width/height aspect ratio for an emote video. */
export function getEmoteAspect(id: RoomEmoteId): number {
  const cached = cache.get(id);
  if (cached && cached.video.videoWidth > 0 && cached.video.videoHeight > 0) {
    return cached.video.videoWidth / cached.video.videoHeight;
  }
  return (DEF_BY_ID.get(id) ?? EMOTES[0]).aspect;
}

/** Returns the cached texture for immediate 3D yard display. */
export function getEmoteTexture(id: RoomEmoteId): THREE.Texture {
  return getEmoteVideoEntry(id).texture;
}

/** Returns the full playback duration in ms for a reaction GIF with no upper cap. */
export function getEmoteDurationMs(id: RoomEmoteId): number {
  const def = DEF_BY_ID.get(id) ?? EMOTES[0];
  const cached = cache.get(id);
  if (cached && Number.isFinite(cached.video.duration) && cached.video.duration >= 1) {
    return Math.round(cached.video.duration * 1000);
  }
  return def.durationMs;
}

/** Restarts or resumes the cached VideoTexture clip cleanly for active 3D yard playback. */
export function playEmoteMedia(id: RoomEmoteId): THREE.VideoTexture {
  const { video, texture } = getEmoteVideoEntry(id);
  try {
    if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0.2) {
      video.currentTime = 0;
    }
  } catch {
    // Ignore seek failure before metadata loads.
  }
  if (video.paused) {
    video.play().catch(() => {});
  }
  return texture;
}

/** Pauses any cached emote video decoders not currently shown on the board so idle power stays minimal. */
export function syncActiveEmoteMedia(activeIds: ReadonlySet<RoomEmoteId>, paused: boolean): void {
  for (const [id, { video }] of cache.entries()) {
    if (paused || !activeIds.has(id)) {
      if (!video.paused) video.pause();
    } else if (video.paused) {
      video.play().catch(() => {});
    }
  }
}

let preloaded = false;

/** Preloads emote thumbnails for instant reaction picker rendering without locking video decoders. */
export function preloadEmoteMedia(): void {
  if (preloaded || typeof document === 'undefined') return;
  preloaded = true;
  for (const { thumb } of EMOTES) {
    const img = new Image();
    img.src = thumb;
  }
}
