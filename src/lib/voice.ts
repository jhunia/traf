export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  u.rate = 1.05;
  window.speechSynthesis.speak(u);
}

let ctx: AudioContext | null = null;

/** Two short beeps for a speeding warning. */
export function beep() {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (const start of [0, 0.22]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.3, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.18);
    }
  } catch {
    /* audio not allowed yet (needs a user gesture) */
  }
}
