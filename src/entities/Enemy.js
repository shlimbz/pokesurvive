// Enemy: one pooled class for every tier (normal/elite/miniboss/boss) - the tier only changes
// stats (via EnemyManager.computeSpawnStats), visual scale, and whether it has a special
// `moveId` attack. See entities/Boss.js for the extra presentation (intro banner, telegraph)
// layered on top of a tier === 'boss' Enemy instance.
window.PS = window.PS || {};

// Fixed base on-screen diameter (px) for a normal-tier enemy at species.scale === 1,
// independent of the source texture's native resolution (see PS.PLAYER_DISPLAY_SIZE).
PS.ENEMY_BASE_DISPLAY_SIZE = 42;

PS.Enemy = class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, textureKey) {
    super(scene, 0, 0, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(5);
    this.statusEffects = {};

    this.hpBarBg = scene.add.rectangle(0, 0, 30, 5, 0x000000, 0.6).setDepth(6);
    this.hpBarFg = scene.add.rectangle(0, 0, 30, 5, 0xff5555, 1).setDepth(7);
  }

  spawn(species, stats, x, y, moveManager) {
    this.species = species;
    this.tier = species.tier;
    this.types = species.types;
    this.maxHp = stats.maxHp;
    this.hp = stats.maxHp;
    this.attack = stats.attack;
    this.defense = stats.defense;
    this.physicalReduction = stats.defense;
    this.specialReduction = stats.defense;
    this.speed = stats.speed;
    this.expValue = stats.exp;
    this.statusEffects = {};
    this.contactCooldown = 0;
    this.stunTimer = 0;

    this.move = species.moveId ? moveManager.getMove(species.moveId) : null;
    this.moveTimer = species.moveCooldownMs ? species.moveCooldownMs * 0.5 : 0;

    const scale = species.scale || 1;
    if (this.texture.key !== species.id) this.setTexture(species.id);
    const displaySize = PS.ENEMY_BASE_DISPLAY_SIZE * scale;
    this.setDisplaySize(displaySize, displaySize);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.body.enable = true;
    PS.MathUtils.fitCircularBody(this, 14 * scale);

    this.hpBarBg.setVisible(true);
    this.hpBarFg.setVisible(true);
    this.updateHpBar();
  }

  updateHpBar() {
    const w = 34 * (this.species.scale || 1);
    this.hpBarBg.setPosition(this.x, this.y - 22 * (this.species.scale || 1));
    this.hpBarFg.setPosition(this.x, this.y - 22 * (this.species.scale || 1));
    this.hpBarBg.width = w;
    this.hpBarFg.width = Math.max(0, w * (this.hp / this.maxHp));
  }

  update(dtSec, playerX, playerY, statusFx, dotDamageCallback, onWantsToAttack) {
    if (!this.active) return;

    statusFx.update(this, dtSec, dotDamageCallback);
    this.contactCooldown = Math.max(0, this.contactCooldown - dtSec);
    this.stunTimer = Math.max(0, this.stunTimer - dtSec);
    if (this.moveTimer > 0) this.moveTimer -= dtSec * 1000;

    const dist = PS.MathUtils.distance(this.x, this.y, playerX, playerY);
    const frozenOrStunned = statusFx.isFrozen(this) || this.stunTimer > 0;

    if (this.move && this.moveTimer <= 0 && dist <= this.move.range * 1.2 && !frozenOrStunned) {
      this.moveTimer = this.species.moveCooldownMs;
      onWantsToAttack(this, this.move);
    }

    if (!frozenOrStunned) {
      const speedMult = statusFx.getMoveSpeedMult(this);
      const dir = PS.MathUtils.normalize(playerX - this.x, playerY - this.y);
      const spd = this.speed * speedMult;
      this.x += dir.x * spd * dtSec;
      this.y += dir.y * spd * dtSec;
      this.body.reset(this.x, this.y);
    }

    this.updateHpBar();
  }

  takeDamage(amount) {
    this.hp -= amount;
    return this.hp <= 0;
  }

  despawn() {
    this.setActive(false);
    this.setVisible(false);
    this.body.enable = false;
    this.hpBarBg.setVisible(false);
    this.hpBarFg.setVisible(false);
    this.statusEffects = {};
  }
};

PS.createEnemyPool = function (scene, textureKeyFn, size = 220) {
  return new PS.ObjectPool(
    () => new PS.Enemy(scene, 'enemy_generic'),
    (obj, species, stats, x, y, moveManager, textureKey) => {
      if (textureKey && obj.texture.key !== textureKey) obj.setTexture(textureKey);
      obj.spawn(species, stats, x, y, moveManager);
    },
    size
  );
};
