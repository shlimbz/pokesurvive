// AudioSystem: fully procedural sound effects via the raw Web Audio API (oscillators + gain
// envelopes), NOT Phaser's sound manager and NOT any audio file. This keeps the game 100%
// offline with zero binary audio assets to ship or fetch - every "sound" here is synthesized
// on the fly from a handful of sine/square/triangle/sawtooth tones. Playtesting feedback was
// "the game feels completely silent" - this gives hit/crit/kill/level-up/pickup/boss/pause/
// game-over feedback without breaking the zero-network-calls requirement anywhere in the repo.
window.PS = window.PS || {};

PS.AudioSystem = class AudioSystem {
  constructor(scene) {
    this.scene = scene;
    this.muted = false;
    this.ctx = null;
    this.master = null;
    // AudioContext can only start after a user gesture (browser autoplay policy) - resume it
    // on the first pointerdown/keydown the scene sees, whichever comes first.
    const unlock = () => this.ensureContext();
    scene.input.once('pointerdown', unlock);
    scene.input.keyboard && scene.input.keyboard.once('keydown', unlock);
  }

  ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null; // no Web Audio support - every play() call below no-ops safely
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.35;
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // Registered for API compatibility with any legacy `audio.play(key)` call sites; real file
  // playback is intentionally not supported (see file header).
  registerKey() {}

  // ---- low-level tone builder ----
  // freq: Hz (or array of Hz played in sequence). duration: seconds per note.
  // type: oscillator waveform. vol: 0-1. delay: seconds before this note starts.
  tone(freq, duration, type = 'sine', vol = 0.25, delay = 0) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  sweep(freqFrom, freqTo, duration, type = 'sine', vol = 0.25, delay = 0) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  // ---- gameplay event sounds ----
  playHit(isCrit) {
    if (isCrit) {
      this.tone(880, 0.09, 'square', 0.22);
      this.tone(1320, 0.12, 'square', 0.18, 0.03);
    } else {
      this.tone(320, 0.06, 'square', 0.14);
    }
  }

  playSuperEffective() {
    this.tone(660, 0.08, 'triangle', 0.2);
    this.tone(990, 0.1, 'triangle', 0.18, 0.06);
  }

  playResisted() {
    this.tone(220, 0.1, 'sine', 0.12);
  }

  playEnemyDeath() {
    this.sweep(500, 120, 0.15, 'sawtooth', 0.14);
  }

  playPlayerHurt() {
    this.tone(140, 0.16, 'sawtooth', 0.2);
  }

  playPickupGem() {
    this.tone(1400, 0.04, 'sine', 0.08);
  }

  playFieldPickup(kind) {
    const freqs = { heal: [660, 880], speed: [880, 1320], magnet: [520, 780] };
    const [a, b] = freqs[kind] || [700, 900];
    this.tone(a, 0.08, 'sine', 0.2);
    this.tone(b, 0.12, 'sine', 0.18, 0.07);
  }

  playLevelUp() {
    this.tone(523, 0.1, 'triangle', 0.22);
    this.tone(659, 0.1, 'triangle', 0.22, 0.09);
    this.tone(784, 0.18, 'triangle', 0.24, 0.18);
  }

  playCardHover() {
    this.tone(440, 0.03, 'sine', 0.06);
  }

  playCardSelect(grade) {
    // Higher grades get a brighter, richer confirmation chime.
    const table = {
      common: [392], uncommon: [392, 523], rare: [392, 523, 659],
      epic: [392, 523, 659, 784], legendary: [392, 523, 659, 784, 988]
    };
    const notes = table[grade] || table.common;
    notes.forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.22, i * 0.05));
  }

  playEvolution() {
    this.sweep(220, 1100, 0.9, 'sawtooth', 0.2);
    this.tone(1100, 0.3, 'triangle', 0.2, 0.85);
  }

  playBossAppear() {
    this.tone(80, 0.6, 'sawtooth', 0.28);
    this.tone(78, 0.6, 'sawtooth', 0.2, 0.08); // slight detune for an ominous beat
  }

  playPause() {
    this.tone(500, 0.05, 'sine', 0.15);
    this.tone(350, 0.08, 'sine', 0.15, 0.05);
  }

  playUnpause() {
    this.tone(350, 0.05, 'sine', 0.15);
    this.tone(500, 0.08, 'sine', 0.15, 0.05);
  }

  // ---- relic events ----
  playRelicPickup() {
    // Distinct from playCardSelect: a richer 5-note ascending arpeggio so a relic
    // (guaranteed miniboss/boss drop or rare field pickup) always feels like a bigger
    // moment than an ordinary level-up card pick.
    [440, 554, 659, 880, 1108].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.2, i * 0.07));
  }

  playPhoenixRevive() {
    this.sweep(120, 900, 0.5, 'sawtooth', 0.26);
    this.tone(900, 0.35, 'triangle', 0.22, 0.45);
  }

  playGameOver(victory) {
    if (victory) {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.22, i * 0.12));
    } else {
      [392, 349, 311, 261].forEach((f, i) => this.tone(f, 0.28, 'sawtooth', 0.18, i * 0.14));
    }
  }
};
