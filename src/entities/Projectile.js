// Projectile: pooled entity for the traveling attack patterns - projectile, spread (fired as
// several straight projectiles at different angles), chain (redirects to a new target on hit
// instead of dying), homing (steers toward its target every frame) and boomerang (reverses
// once it reaches max range). Non-traveling patterns (melee/circle/strike/explosion/beam/rain)
// are resolved instantly by GameScene and never allocate a Projectile.
window.PS = window.PS || {};

PS.Projectile = class Projectile extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, textureKey) {
    super(scene, 0, 0, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(6);
    this.hitSet = new Set();
  }

  spawn(x, y, angle, config) {
    this.setPosition(x, y);
    // Bugfix: a pooled, previously-deactivated projectile's Arcade body stays frozen wherever it
    // was when deactivate() disabled it (Arcade physics stops syncing a disabled body's position
    // every frame) - setPosition() alone only moves the visual sprite, not body.x/y. Without this,
    // every projectile/spread/chain/homing/boomerang move (the large majority of moves in the
    // game) only ever hits anything on its very first, never-yet-recycled shot: every reused shot
    // after that visually travels correctly but its hitbox sits wherever the object last died,
    // tens of thousands of pixels away, so it can never overlap a real enemy again. Mirrors the
    // same body.reset() call Player.update() and Enemy's spawn already do for the identical reason.
    this.body.reset(x, y);
    this.setRotation(angle);
    this.kind = config.kind;
    this.move = config.move;
    this.moveLevel = config.moveLevel;
    this.ownerContext = config.ownerContext; // { side: 'player'|'enemy', build? , enemyStats?, enemyTypes? }
    this.speed = config.speed;
    this.pierceRemaining = config.pierce || 0;
    this.chainRemaining = config.chainCount || 0;
    this.chainRange = config.chainRange || 160;
    this.splashRadius = config.splashRadius || 0;
    this.maxRangePx = config.range || 400;
    this.traveled = 0;
    this.homing = config.kind === 'homing';
    this.boomerangReturning = false;
    // Bugfix: these two MUST NOT be named originX/originY - Phaser.GameObjects.Sprite already
    // defines originX/originY as the sprite's render/physics pivot (a 0..1 fraction of its
    // width/height, default 0.5/0.5). Overwriting them with raw world pixel coordinates (e.g.
    // 4000) corrupts displayOriginX/Y, which corrupts every getTopLeft()-based calculation -
    // including Arcade Body.reset()'s position calc - so the hitbox silently drifts tens of
    // thousands of pixels from the visible sprite. That's why ranged attacks (projectile/spread/
    // chain/homing/boomerang - most moves in the game) stopped landing any hits at all past the
    // very first shot: every later shot reused this same corrupted-origin object. Renamed to
    // castOriginX/Y (the cast point, used by boomerang's return trip and max-range check below).
    this.castOriginX = x;
    this.castOriginY = y;
    this.hitSet.clear();
    // Chain pattern VFX (VFXSystem.playChain) needs the previous link point to draw a
    // connecting line between each hop - starts at the cast point, advances on every hit.
    this.chainFromX = x;
    this.chainFromY = y;

    this.body.enable = true;
    this.setActive(true);
    this.setVisible(true);

    const vx = Math.cos(angle) * this.speed;
    const vy = Math.sin(angle) * this.speed;
    this.body.setVelocity(vx, vy);
    this.body.setCircle(8);
  }

  update(dtSec, findNearestTarget) {
    if (!this.active) return;
    this.traveled += this.speed * dtSec;

    if (this.homing || this.kind === 'chain') {
      const target = findNearestTarget(this.x, this.y, this.hitSet);
      if (target) {
        const angle = PS.MathUtils.angleBetween(this.x, this.y, target.x, target.y);
        const curAngle = Math.atan2(this.body.velocity.y, this.body.velocity.x);
        const turn = this.homing ? 0.14 : 1.0;
        const newAngle = curAngle + Phaser.Math.Angle.Wrap(angle - curAngle) * turn;
        this.setRotation(newAngle);
        this.body.setVelocity(Math.cos(newAngle) * this.speed, Math.sin(newAngle) * this.speed);
      }
    }

    if (this.kind === 'boomerang' && !this.boomerangReturning && this.traveled >= this.maxRangePx) {
      this.boomerangReturning = true;
      const angle = PS.MathUtils.angleBetween(this.x, this.y, this.castOriginX, this.castOriginY);
      this.setRotation(angle);
      this.body.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);
    }

    const distFromOrigin = PS.MathUtils.distance(this.x, this.y, this.castOriginX, this.castOriginY);
    if (this.kind !== 'boomerang' && this.traveled >= this.maxRangePx + 40) this.deactivate();
    if (this.kind === 'boomerang' && this.boomerangReturning && distFromOrigin < 20) this.deactivate();
  }

  deactivate() {
    this.setActive(false);
    this.setVisible(false);
    this.body.enable = false;
    this.body.setVelocity(0, 0);
    if (this.onDone) this.onDone(this);
  }

  /** Returns true if this projectile should keep flying after hitting `target`. */
  registerHit(target) {
    this.hitSet.add(target);
    if (this.kind === 'chain' && this.chainRemaining > 0) {
      this.chainRemaining--;
      return true;
    }
    if (this.pierceRemaining > 0) {
      this.pierceRemaining--;
      return true;
    }
    return false;
  }
};

PS.createProjectilePool = function (scene, textureKey, size = 200) {
  return new PS.ObjectPool(
    () => new PS.Projectile(scene, textureKey),
    (obj, x, y, angle, config) => obj.spawn(x, y, angle, config),
    size
  );
};
