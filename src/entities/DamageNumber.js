// DamageNumber: pooled floating combat text (damage dealt/taken, "MISS", heal amounts).
window.PS = window.PS || {};

PS.DamageNumber = class DamageNumber extends Phaser.GameObjects.Text {
  constructor(scene) {
    super(scene, 0, 0, '', {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '15px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    });
    this.setOrigin(0.5);
    this.setDepth(25);
    scene.add.existing(this);
    this.setActive(false);
    this.setVisible(false);
  }

  fire(x, y, value, options = {}) {
    this.setText(String(value));
    this.setColor(options.color || '#ffffff');
    this.setScale(options.scale || 1);
    this.setPosition(x, y);
    this.setAlpha(1);
    this.setActive(true);
    this.setVisible(true);

    if (this._tween) this._tween.stop();
    this._tween = this.scene.tweens.add({
      targets: this,
      y: y - 46,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.setActive(false);
        this.setVisible(false);
        if (this.onDone) this.onDone(this);
      }
    });
  }
};

PS.createDamageNumberPool = function (scene, size = 60) {
  return new PS.ObjectPool(
    () => new PS.DamageNumber(scene),
    (obj, x, y, value, options) => {
      obj.onDone = (o) => scene.damageNumberPool.release(o);
      obj.fire(x, y, value, options);
    },
    size
  );
};
