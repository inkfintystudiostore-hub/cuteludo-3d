import * as THREE from 'three';
import type { RoomEmoteId } from '../engine/multiplayerProtocol';

export const EMOTES: readonly { id: RoomEmoteId; label: string; src: string }[] = [
  { id: 'laugh', label: 'Laugh & Point', src: '/emotes/laugh.mp4' },
  { id: 'loading', label: 'Loading Brain', src: '/emotes/loading.mp4' },
  { id: 'wave', label: 'Cutie Wave', src: '/emotes/wave.mp4' },
  { id: 'grumpy', label: 'Grumpy Side-Eye', src: '/emotes/grumpy.mp4' },
  { id: 'angry', label: 'Angry Glare', src: '/emotes/angry.mp4' },
];

const SRC_BY_ID = new Map<RoomEmoteId, string>(EMOTES.map((e) => [e.id, e.src]));

interface EmoteVideoEntry {
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
}

const cache = new Map<RoomEmoteId, EmoteVideoEntry>();

function applySquareCoverCrop(video: HTMLVideoElement, texture: THREE.VideoTexture) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const aspect = vw / vh;
  if (aspect > 1) {
    texture.repeat.set(1 / aspect, 1);
    texture.offset.set((1 - 1 / aspect) / 2, 0);
  } else if (aspect < 1) {
    texture.repeat.set(1, aspect);
    texture.offset.set(0, (1 - aspect) / 2);
  } else {
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
  }
}

/** Lazily creates and caches one muted looping VideoTexture per emote GIF clip. */
export function getEmoteVideoEntry(id: RoomEmoteId): EmoteVideoEntry {
  const existing = cache.get(id);
  if (existing) return existing;

  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.src = SRC_BY_ID.get(id) ?? '/emotes/laugh.mp4';

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  video.addEventListener('loadedmetadata', () => applySquareCoverCrop(video, texture));
  if (video.readyState >= 1) applySquareCoverCrop(video, texture);

  video.play().catch(() => {});

  const entry: EmoteVideoEntry = { video, texture };
  cache.set(id, entry);
  return entry;
}

/** Restarts or resumes the cached VideoTexture clip cleanly for immediate playback. */
export function playEmoteVideo(id: RoomEmoteId): THREE.VideoTexture {
  const { video, texture } = getEmoteVideoEntry(id);
  try {
    if (video.readyState >= 1) video.currentTime = 0;
  } catch {
    // Ignore seek failure before metadata loads.
  }
  if (video.paused) {
    video.play().catch(() => {});
  }
  return texture;
}

let preloaded = false;

/** Preloads and warms all 5 emote videos once so live & remote triggers render frame-0 immediately. */
export function preloadEmoteVideos(): void {
  if (preloaded || typeof document === 'undefined') return;
  preloaded = true;
  for (const { id } of EMOTES) {
    getEmoteVideoEntry(id);
  }
}
