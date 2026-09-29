// AudioSystem: thin wrapper around Phaser's sound manager. No audio files ship with this
// prototype (keeps the project 100% offline with zero binary assets to fetch), so every call
// is a safe no-op unless a matching key was actually loaded into assets/audio and registered
// here - drop in real files and list them in `keys` to enable sound with no other code changes.
window.PS = window.PS || {};

PS.AudioSystem = class AudioSystem {
  constructor(scene) {
    this.scene = scene;
    this.keys = new Set(); // populated by PreloadScene if/when assets/audio/*.mp3 exist
    this.muted = false;
  }

  registerKey(key) {
    this.keys.add(key);
  }

  play(key, config) {
    if (this.muted || !this.keys.has(key)) return;
    try {
      this.scene.sound.play(key, config);
    } catch (e) {
      // Missing/broken audio should never crash gameplay.
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.scene.sound) this.scene.sound.mute = muted;
  }
};
