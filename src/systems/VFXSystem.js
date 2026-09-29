// VFXSystem: type x level VFX (data/vfx.json) built entirely from procedural textures
// (see AssetManager). Attack patterns (systems concern) stay separate from the visuals here -
// any move, whatever its `pattern`, just calls playTypeVfx(type, level, x, y, angle).
window.PS = window.PS || {};

PS.VFXSystem = class VFXSystem {
  constructor(scene, vfxData, assetManager) {
    this.scene = scene;
    this.data = vfxData;
    this.assets = assetManager;
    this.textureCache = {};
  }

  getTexture(typeId) {
    if (!this.textureCache[typeId]) {
      const def = this.data.types[typeId] || this.data.types.normal;
      this.textureCache[typeId] = this.assets.generateVfxTexture(def.shape, def.color);
    }
    return this.textureCache[typeId];
  }

  getTierConfig(level) {
    const tierKey = String(PS.MathUtils.clamp(level, 1, 3));
    const base = this.data.tiers[tierKey];
    if (level <= 3) return { ...base, scale: base.scale, particleCount: base.particleCount };
    const extra = level - 3;
    return {
      ...base,
      scale: base.scale + this.data.growth.scaleStepPerLevelAbove3 * extra,
      particleCount: base.particleCount + this.data.growth.particleStepPerLevelAbove3 * extra
    };
  }

  playTypeVfx(typeId, level, x, y, angle = 0) {
    const def = this.data.types[typeId] || this.data.types.normal;
    const tier = this.getTierConfig(level);
    const texture = this.getTexture(typeId);

    const emitter = this.scene.add.particles(x, y, texture, {
      speed: { min: tier.speed * 0.5, max: tier.speed },
      angle: { min: Phaser.Math.RadToDeg(angle) - 25, max: Phaser.Math.RadToDeg(angle) + 25 },
      lifespan: tier.lifespanMs,
      scale: { start: tier.scale, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: this.assets.hexToInt(def.color),
      blendMode: 'ADD',
      quantity: tier.particleCount
    });
    emitter.explode(tier.particleCount);
    this.scene.time.delayedCall(tier.lifespanMs + 50, () => emitter.destroy());
  }

  playCircleVfx(typeId, level, x, y, radius) {
    const def = this.data.types[typeId] || this.data.types.normal;
    const g = this.scene.add.graphics();
    g.setPosition(x, y);
    g.lineStyle(4, this.assets.hexToInt(def.color), 0.9);
    g.strokeCircle(0, 0, radius);
    g.setDepth(5);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.15,
      duration: 320,
      onComplete: () => g.destroy()
    });
    this.playTypeVfx(typeId, level, x, y);
  }

  playDeathBurst(x, y, color) {
    const key = 'vfx_deathburst';
    if (!this.scene.textures.exists(key)) this.assets.generateCircleTexture(key, 0xffffff, 6);
    const emitter = this.scene.add.particles(x, y, key, {
      speed: { min: 60, max: 220 },
      lifespan: 380,
      scale: { start: 1, end: 0 },
      tint: color,
      quantity: 10
    });
    emitter.explode(10);
    this.scene.time.delayedCall(420, () => emitter.destroy());
  }

  playEvolutionFlash(x, y) {
    const flash = this.scene.add.circle(x, y, 10, 0xffffff, 0.9);
    flash.setDepth(20);
    this.scene.tweens.add({
      targets: flash,
      radius: 220,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onUpdate: () => flash.setRadius(flash.radius),
      onComplete: () => flash.destroy()
    });
  }

  showFeedbackText(x, y, key) {
    const cfg = this.data.hitFeedback[key];
    if (!cfg || !cfg.text) return;
    const txt = this.scene.add.text(x, y - 30, cfg.text, {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '13px',
      color: cfg.color,
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(30).setScale(cfg.scale);

    this.scene.tweens.add({
      targets: txt,
      y: y - 60,
      alpha: 0,
      duration: 650,
      onComplete: () => txt.destroy()
    });
  }
};
