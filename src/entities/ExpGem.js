// ExpGem: dropped by dying enemies. Sits still until the player enters pickup radius, then
// flies toward the player and grants EXP on contact.
window.PS = window.PS || {};

PS.ExpGem = class ExpGem extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, textureKey) {
    super(scene, 0, 0, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Bugfix: every other field pickup (heal/speed/magnet, relics) sits at depth 3 - gems were
    // the one outlier at 4 (boss-telegraph layer), so gems and telegraph rings/hazard visuals
    // could stack in an inconsistent order depending on add-order.
    this.setDepth(3);
  }

  spawn(x, y, value) {
    this.setPosition(x, y);
    this.value = value;
    this.magnetized = false;
    this.body.setCircle(6);
    this.body.enable = true;
    this.setScale(PS.MathUtils.clamp(0.6 + value / 40, 0.6, 1.4));
  }

  update(dt, playerX, playerY, pickupRadius) {
    const dist = PS.MathUtils.distance(this.x, this.y, playerX, playerY);
    if (dist <= pickupRadius) this.magnetized = true;
    if (this.magnetized) {
      const dir = PS.MathUtils.normalize(playerX - this.x, playerY - this.y);
      const speed = 420;
      this.x += dir.x * speed * dt;
      this.y += dir.y * speed * dt;
    }
  }
};

PS.createExpGemPool = function (scene, textureKey, size = 150) {
  return new PS.ObjectPool(
    () => new PS.ExpGem(scene, textureKey),
    (obj, x, y, value) => obj.spawn(x, y, value),
    size
  );
};
