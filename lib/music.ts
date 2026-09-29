// Background music for the trade screen. Shares lib/sound's AudioContext.
//
// Tracks play as looping AudioBuffers rather than <audio loop>: an element
// leaves an audible gap at the seam on most browsers, and these tracks are
// composed as seamless loops. The cost is memory (~25MB decoded per track), so
// only the playing track is kept decoded.
//
// MP3 encoding adds silent padding at the start that some decoders strip and
// some don't. Every source track starts on frame 0, so any leading silence in
// the decoded buffer IS padding; the loop starts past it and runs for the
// source's exact length, landing the seam where the composer put it.
//
// All three tracks are CC0 (public domain) from OpenGameArt — no attribution
// required, commercial use fine:
//   arcade / turbo — Juhani Junkala, "5 Chiptunes (Action)", Level 1 / Level 3
//   neon           — "Synthwave House Loop" (114 bpm)

import { audioOutput } from "@/lib/sound";

export interface MusicTrack {
  id: string;
  label: string;
  src: string;
  /** Exact length of the source loop, in frames at 44.1kHz. */
  frames: number;
  /** Level trim so tracks sit at the same loudness. */
  gain: number;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { id: "arcade", label: "Arcade", src: "/audios/music/arcade.mp3", frames: 3274608, gain: 0.6 },
  { id: "turbo", label: "Turbo", src: "/audios/music/turbo.mp3", frames: 3611603, gain: 0.6 },
  // ~4dB quieter at source than the chiptunes, so trimmed less.
  { id: "neon", label: "Neon", src: "/audios/music/neon.mp3", frames: 2228211, gain: 0.95 },
];

export const DEFAULT_TRACK = MUSIC_TRACKS[0]!.id;

export function isMusicTrack(id: unknown): id is string {
  return MUSIC_TRACKS.some((t) => t.id === id);
}

// Music sits under the SFX — present, never competing with a close chime.
const MASTER_VOLUME = 0.32;
const FADE_IN_S = 1.2;
const FADE_OUT_S = 0.5;
// "Tense" mood: a low-pass that muffles the track while a trade is in the red,
// like music heard through a wall. Open = effectively no filter.
const CUTOFF_OPEN = 20000;
const CUTOFF_TENSE = 900;
const SOURCE_RATE = 44100;
const SILENCE = 1e-4;

let current: {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
} | null = null;
let filter: BiquadFilterNode | null = null;
let decoded: { id: string; buf: AudioBuffer } | null = null;
let loading: { id: string; promise: Promise<AudioBuffer | null> } | null = null;
// The track the caller wants playing, or null for silence. Loads are async, so
// every await re-checks this — a stop or switch during a fetch must win.
let wanted: string | null = null;

async function load(ctx: AudioContext, track: MusicTrack): Promise<AudioBuffer | null> {
  if (decoded?.id === track.id) return decoded.buf;
  if (loading?.id === track.id) return loading.promise;
  const promise = (async () => {
    try {
      const res = await fetch(track.src);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      // Replace, don't accumulate: one decoded track at a time.
      decoded = { id: track.id, buf };
      return buf;
    } catch {
      return null; // no music is fine; a broken trade screen is not
    } finally {
      if (loading?.id === track.id) loading = null;
    }
  })();
  loading = { id: track.id, promise };
  return promise;
}

function leadingPadding(buf: AudioBuffer): number {
  const data = buf.getChannelData(0);
  const limit = Math.min(data.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]!) > SILENCE) return i / buf.sampleRate;
  }
  return 0;
}

function fadeOutCurrent(ctx: AudioContext) {
  if (!current) return;
  const { src, gain } = current;
  current = null;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
  try {
    src.stop(now + FADE_OUT_S + 0.05);
  } catch {
    /* already stopped */
  }
  src.onended = () => {
    src.disconnect();
    gain.disconnect();
  };
}

/** Start (or switch to) a track, fading in. Safe to call repeatedly. */
export async function playMusic(trackId: string) {
  wanted = trackId;
  const io = audioOutput();
  const track = MUSIC_TRACKS.find((t) => t.id === trackId);
  if (!io || !track) return;
  const { ctx, out } = io;
  if (current?.id === trackId) return;
  if (ctx.state === "suspended") void ctx.resume();

  const buf = await load(ctx, track);
  if (!buf || wanted !== trackId || current?.id === trackId) return;

  fadeOutCurrent(ctx);

  if (!filter) {
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = CUTOFF_OPEN;
    filter.Q.value = 0.7;
    filter.connect(out);
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const start = leadingPadding(buf);
  src.loopStart = start;
  src.loopEnd = Math.min(buf.duration, start + track.frames / SOURCE_RATE);

  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(MASTER_VOLUME * track.gain, now + FADE_IN_S);
  src.connect(gain).connect(filter);
  src.start(now, start);
  current = { id: trackId, src, gain };
}

/** Fade out and stop. */
export function stopMusic() {
  wanted = null;
  const io = audioOutput();
  if (io) fadeOutCurrent(io.ctx);
}

/** Muffle the track while a trade is losing; open it back up otherwise. */
export function setMusicTense(tense: boolean) {
  const io = audioOutput();
  if (!io || !filter) return;
  const now = io.ctx.currentTime;
  filter.frequency.cancelScheduledValues(now);
  filter.frequency.setValueAtTime(filter.frequency.value, now);
  // Exponential: a filter sweep sounds even only on a log-frequency scale.
  filter.frequency.exponentialRampToValueAtTime(
    tense ? CUTOFF_TENSE : CUTOFF_OPEN,
    now + (tense ? 1.5 : 0.6)
  );
}
