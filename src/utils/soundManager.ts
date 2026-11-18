/**
 * Zero-dependency Web Audio synthesizer for the game's sound effects.
 *
 * The AudioContext is created lazily on the first sound, which always follows a click or tap,
 * so browser autoplay rules are satisfied. While muted nothing is scheduled at all.
 */

type Listener = () => void;

const MASTER_VOLUME = 0.55;
const SILENCE = 0.0001;

/** C5 D5 E5 G5 A5 C6 */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
/** C major 9th: C5 E5 G5 B5 D6 */
const MAJOR_NINTH = [523.25, 659.25, 783.99, 987.77, 1174.66];

interface ToneOptions {
  type: OscillatorType;
  freq: number;
  /** Glide to this frequency over the tone's duration. */
  endFreq?: number;
  at: number;
  duration: number;
  gain: number;
  attack?: number;
}

interface NoiseOptions {
  at: number;
  duration: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  q?: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private readonly listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isMuted = (): boolean => this.muted;

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.015);
    }
    this.listeners.forEach((listener) => listener());
  }

  toggleMute = (): void => this.setMuted(!this.muted);

  /** Returns the live context and output node, or null when muted or audio is unavailable. */
  private audio(): { ctx: AudioContext; out: GainNode } | null {
    if (this.muted || typeof window === 'undefined' || !('AudioContext' in window)) return null;
    if (!this.ctx || !this.master) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return { ctx: this.ctx, out: this.master };
  }

  private tone(ctx: AudioContext, out: AudioNode, o: ToneOptions): OscillatorNode {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.at);
    if (o.endFreq) osc.frequency.exponentialRampToValueAtTime(o.endFreq, o.at + o.duration);
    env.gain.setValueAtTime(SILENCE, o.at);
    env.gain.exponentialRampToValueAtTime(o.gain, o.at + (o.attack ?? 0.004));
    env.gain.exponentialRampToValueAtTime(SILENCE, o.at + o.duration);
    osc.connect(env).connect(out);
    osc.start(o.at);
    osc.stop(o.at + o.duration + 0.03);
    return osc;
  }

  private noise(ctx: AudioContext, out: AudioNode, o: NoiseOptions): void {
    if (!this.noiseBuffer) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = o.filter;
    filter.frequency.value = o.freq;
    filter.Q.value = o.q ?? 1;
    env.gain.setValueAtTime(o.gain, o.at);
    env.gain.exponentialRampToValueAtTime(SILENCE, o.at + o.duration);
    source.connect(filter).connect(env).connect(out);
    source.start(o.at, Math.random() * 0.5, o.duration + 0.03);
  }

  /** Bell voice: fundamental, octave shimmer and a short bright strike. */
  private bell(ctx: AudioContext, out: AudioNode, freq: number, at: number, duration: number, gain: number): void {
    this.tone(ctx, out, { type: 'sine', freq, at, duration, gain });
    this.tone(ctx, out, { type: 'sine', freq: freq * 2, at, duration: duration * 0.6, gain: gain * 0.35 });
    this.tone(ctx, out, { type: 'triangle', freq: freq * 3, at, duration: 0.07, gain: gain * 0.2 });
  }

  /** Marimba/woodblock pop that climbs the pentatonic scale as a pawn hops along. */
  playHop(stepIndex: number): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const at = ctx.currentTime;
    const freq = PENTATONIC[((stepIndex % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
    this.tone(ctx, out, { type: 'sine', freq, at, duration: 0.22, gain: 0.34 });
    this.tone(ctx, out, { type: 'sine', freq: freq * 4, at, duration: 0.06, gain: 0.07 }); // marimba's 4th-harmonic ping
    this.noise(ctx, out, { at, duration: 0.02, gain: 0.07, filter: 'highpass', freq: 3200 }); // mallet tick
  }

  /** Subtle crisp tap when requesting a dice roll (gives instant tactile feedback online). */
  playDiceTap(): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const at = ctx.currentTime;
    this.tone(ctx, out, { type: 'triangle', freq: 420, endFreq: 680, at, duration: 0.055, gain: 0.16 });
    this.noise(ctx, out, { at, duration: 0.025, gain: 0.09, filter: 'bandpass', freq: 2400, q: 2.5 });
  }

  /** Rattling tumble that ends in a wooden clack `landAfter` seconds later. */
  playDiceRoll(landAfter = 0.28): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const rattles = 6;
    for (let i = 0; i < rattles; i++) {
      const at = now + (i / rattles) * landAfter * 0.9 + Math.random() * 0.02;
      this.noise(ctx, out, { at, duration: 0.03, gain: 0.16, filter: 'bandpass', freq: 1800 + Math.random() * 1600, q: 3 });
    }
    const land = now + landAfter;
    this.tone(ctx, out, { type: 'triangle', freq: 230, endFreq: 105, at: land, duration: 0.09, gain: 0.38 });
    this.noise(ctx, out, { at: land, duration: 0.04, gain: 0.28, filter: 'bandpass', freq: 950, q: 2 });
  }

  /** Sparkling major-9th arpeggio. */
  playSpawnSix(): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    MAJOR_NINTH.forEach((freq, i) => this.bell(ctx, out, freq, now + i * 0.065, 0.6, 0.16));
  }

  /** The same arpeggio run up two octaves, resolving on a held chord. */
  playVictory(): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    const run = [...MAJOR_NINTH, ...MAJOR_NINTH.slice(0, 3).map((f) => f * 2)];
    run.forEach((freq, i) => this.bell(ctx, out, freq, now + i * 0.07, 0.55, 0.14));
    const chordAt = now + run.length * 0.07 + 0.05;
    MAJOR_NINTH.forEach((freq) => this.bell(ctx, out, freq, chordAt, 1.3, 0.09));
  }

  /**
   * Snappy grab pop, rising centrifugal spin whistle, springy boing on throw, and thud on landing.
   * `grab`, `twirl` and `flight` are the lengths of those animation phases in seconds.
   */
  playCapture(twirl = 1.05, flight = 0.72, grab = 0.24): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Quick clasp/grab "yoink!" pop.
    this.tone(ctx, out, { type: 'triangle', freq: 260, endFreq: 560, at: now + 0.04, duration: 0.09, gain: 0.22 });
    this.noise(ctx, out, { at: now + grab * 0.75, duration: 0.05, gain: 0.12, filter: 'bandpass', freq: 1800, q: 2 });

    const twirlAt = now + grab;
    const whistle = this.tone(ctx, out, { type: 'sine', freq: 380, endFreq: 2100, at: twirlAt, duration: twirl, gain: 0.15, attack: 0.04 });
    const vibrato = ctx.createOscillator();
    const vibratoDepth = ctx.createGain();
    vibrato.frequency.value = 18;
    vibratoDepth.gain.value = 34;
    vibrato.connect(vibratoDepth).connect(whistle.frequency);
    vibrato.start(twirlAt);
    vibrato.stop(twirlAt + twirl + 0.05);

    const launch = twirlAt + twirl;
    const boing = this.tone(ctx, out, { type: 'sine', freq: 150, at: launch, duration: 0.65, gain: 0.32 });
    boing.frequency.exponentialRampToValueAtTime(520, launch + 0.12);
    boing.frequency.exponentialRampToValueAtTime(210, launch + 0.65);
    const spring = ctx.createOscillator();
    const springDepth = ctx.createGain();
    spring.frequency.value = 22;
    springDepth.gain.setValueAtTime(70, launch);
    springDepth.gain.exponentialRampToValueAtTime(1, launch + 0.65);
    spring.connect(springDepth).connect(boing.frequency);
    spring.start(launch);
    spring.stop(launch + 0.7);

    const land = launch + flight;
    this.tone(ctx, out, { type: 'sine', freq: 130, endFreq: 55, at: land, duration: 0.14, gain: 0.3 });
    this.noise(ctx, out, { at: land, duration: 0.12, gain: 0.12, filter: 'lowpass', freq: 700 });
  }

  /** Warm cafe-bell clink: two close strikes with an inharmonic partial for the metal ring. */
  playStarChime(): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;
    [1318.51, 1760].forEach((freq, i) => {
      const at = now + i * 0.09;
      this.tone(ctx, out, { type: 'sine', freq, at, duration: 0.95, gain: 0.16 });
      this.tone(ctx, out, { type: 'sine', freq: freq * 2.76, at, duration: 0.3, gain: 0.05 });
      this.tone(ctx, out, { type: 'triangle', freq: freq / 2, at, duration: 0.25, gain: 0.06 });
    });
  }
}

export const soundManager = new SoundManager();
