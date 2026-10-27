let ctx: AudioContext | null = null;

export function unlockAudio() {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0) {
  if (!ctx) return;
  const start = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function sfxOk(on: boolean) {
  if (!on) return;
  unlockAudio();
  tone(523, 0.09, "triangle", 0.05);
  tone(784, 0.14, "triangle", 0.045, 0.08);
}

export function sfxBad(on: boolean) {
  if (!on) return;
  unlockAudio();
  tone(180, 0.16, "sawtooth", 0.028);
}

export function sfxTick(on: boolean) {
  if (!on) return;
  tone(880, 0.045, "square", 0.018);
}

export function sfxEnd(on: boolean) {
  if (!on) return;
  unlockAudio();
  tone(392, 0.1, "triangle", 0.045);
  tone(523, 0.1, "triangle", 0.045, 0.1);
  tone(659, 0.18, "triangle", 0.04, 0.2);
}
