// BootScene: earliest possible scene. Sets up global config, then hands off to PreloadScene.
window.PS = window.PS || {};

PS.BootScene = class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.scale.on('resize', this.handleResize, this);
    this.scene.start('Preload');
  }

  handleResize(gameSize) {
    // Cameras auto-resize via Phaser.Scale.RESIZE mode; nothing extra needed here.
  }
};
