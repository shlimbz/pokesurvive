// Player: movement is manual (arrow keys / WASD); attacking is fully automatic - every owned
// move in `build.moves` fires on its own cooldown at the nearest valid target, per spec
// section 0 ("이동하면서 Pokémon의 기술이 자동으로 발동한다").
window.PS = window.PS || {};

PS.Player = class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, textureKey, build) {
    super(scene, x, y, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(10);

    this.build = build;
    this.statusEffects = {};
    this.tier = 'normal';
    this.maxHp = build.getMaxHp();
    this.hp = this.maxHp;
    this.invulnTimer = 0;
    this.moveCooldowns = {};
    this.survivalCharges = 0;
    this.survivalRechargeTimer = 0;
    this.flashFireStacks = 0;
    this.attackSpeedBuffMult = 1;
    this.attackSpeedBuffTimer = 0;

    for (const moveId of build.getOwnedMoveIds()) this.moveCooldowns[moveId] = 0;

    this.body.setCircle(16);
  }

  /** Called by StatusEffectSystem.apply() whenever a status lands on the player (Steadfast). */
  onStatusApplied(statusId) {
    for (const hook of PS.AbilitySystem.find(this.build.modifiers, 'on_status_applied_self_buff')) {
      if (hook.effect.buff !== 'attackSpeed') continue;
      const mult = hook.effect.mult + (hook.effect.multPerLevel || 0) * (hook.level - 1);
      this.attackSpeedBuffMult = Math.max(this.attackSpeedBuffMult, mult);
      this.attackSpeedBuffTimer = Math.max(this.attackSpeedBuffTimer, hook.effect.durationSec);
    }
  }

  refreshFromBuild() {
    const ratio = this.hp / this.maxHp;
    this.maxHp = this.build.getMaxHp();
    this.hp = Math.min(this.maxHp, Math.round(this.maxHp * ratio) + Math.round(this.maxHp * 0.15));
    for (const moveId of this.build.getOwnedMoveIds()) {
      if (this.moveCooldowns[moveId] === undefined) this.moveCooldowns[moveId] = 0;
    }
  }

  setTexture2(textureKey) {
    this.setTexture(textureKey);
  }

  getHpRatio() {
    return PS.MathUtils.clamp(this.hp / this.maxHp, 0, 1);
  }

  update(dtSec, input, statusFx, moveManager, onFireMove) {
    this.invulnTimer = Math.max(0, this.invulnTimer - dtSec);
    this.survivalRechargeTimer = Math.max(0, this.survivalRechargeTimer - dtSec);
    this.attackSpeedBuffTimer = Math.max(0, this.attackSpeedBuffTimer - dtSec);
    if (this.attackSpeedBuffTimer <= 0) this.attackSpeedBuffMult = 1;

    // --- movement ---
    let vx = 0, vy = 0;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    const dir = PS.MathUtils.normalize(vx, vy);
    const speedMult = statusFx.getMoveSpeedMult(this);
    const speed = this.build.getMoveSpeed() * speedMult;
    this.x += dir.x * speed * dtSec;
    this.y += dir.y * speed * dtSec;
    this.body.reset(this.x, this.y);

    if (dir.x !== 0 || dir.y !== 0) {
      this.lastFacingAngle = Math.atan2(dir.y, dir.x);
    }

    // --- status ticks (burn/poison) ---
    statusFx.update(this, dtSec, (entity, amount) => this.applyDotDamage(amount));

    // --- hp regen (Leftovers etc) ---
    const regen = this.build.modifiers.hpRegenPercent;
    if (regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * regen * dtSec);

    // --- auto attack: every owned move ticks its own cooldown ---
    for (const moveId of this.build.getOwnedMoveIds()) {
      const move = moveManager.getMove(moveId);
      if (!move) continue;
      this.moveCooldowns[moveId] = (this.moveCooldowns[moveId] || 0) - dtSec * 1000;
      if (this.moveCooldowns[moveId] <= 0) {
        const fired = onFireMove(this, move);
        if (fired) {
          this.moveCooldowns[moveId] = this.build.getMoveCooldownMs(move) / this.attackSpeedBuffMult;
          if (PS.RandomUtils.chance(this.build.modifiers.onAttackCooldownResetChance)) {
            this.moveCooldowns[moveId] = 0;
          }
        } else {
          this.moveCooldowns[moveId] = 120; // no target in range yet, retry soon
        }
      }
    }
  }

  applyDotDamage(amount) {
    this.hp -= amount;
  }

  /** Returns true if damage was actually applied (false if Focus-Sash-style survival absorbed a kill). */
  takeDamage(amount) {
    if (this.invulnTimer > 0) return false;
    this.hp -= amount;
    this.invulnTimer = 0.4;

    if (this.hp <= 0) {
      if (this.survivalCharges > 0 && this.survivalRechargeTimer <= 0) {
        this.survivalCharges--;
        this.survivalRechargeTimer = this.build.modifiers.survivalRechargeSec || 60;
        this.hp = 1;
      }
    }
    return true;
  }

  isDead() {
    return this.hp <= 0;
  }
};
