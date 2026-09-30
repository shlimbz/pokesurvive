// Player: movement is manual (arrow keys / WASD); attacking is fully automatic - every owned
// move in `build.moves` fires on its own cooldown at the nearest valid target, per spec
// section 0 ("이동하면서 Pokémon의 기술이 자동으로 발동한다").
window.PS = window.PS || {};

// Fixed on-screen size (px) for the player, independent of the source texture's native
// resolution - a real PokeAPI artwork PNG (~475x475) and a generated 64x64 placeholder both
// end up the same visible size via setDisplaySize().
PS.PLAYER_DISPLAY_SIZE = 56;

PS.Player = class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, textureKey, build) {
    super(scene, x, y, textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(10);
    this.setDisplaySize(PS.PLAYER_DISPLAY_SIZE, PS.PLAYER_DISPLAY_SIZE);

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
    this.fieldSpeedBuffMult = 1;
    this.fieldSpeedBuffTimer = 0;

    // relic_phoenix: a stronger, separate "second wind" from the item/ability survival-charge
    // system - full heal + temporary invulnerability + damage buff, own recharge timer.
    this.phoenixRechargeTimer = 0;
    this.phoenixDamageBuffMult = 1;
    this.phoenixDamageBuffTimer = 0;
    this.lastSaveType = null;

    // relic_momentum: stacking move-speed/attack-speed buff that builds per kill and decays
    // if the kill streak breaks.
    this.killMomentumStacks = 0;
    this.killMomentumTimer = 0;

    // Fairy vertical slice "Shield" mechanic (magic_shield ability, spec: Orbit+Aura+Shield+
    // Homing): periodically recharges a charge that negates the next incoming hit entirely -
    // see updateShield() below and the top of takeDamage().
    this.shieldCharges = 0;
    this.shieldRechargeTimer = 0;

    // Map hazard zones (spec: 맵별 고유 기믹) - e.g. Beach's tide pools. A debuff, so it uses
    // Math.min (take the strongest slow currently active) instead of fieldSpeedBuffMult's
    // Math.max (which is for buffs and would never let a value below 1 stick).
    this.hazardSlowMult = 1;
    this.hazardSlowTimer = 0;

    for (const moveId of build.getOwnedMoveIds()) this.moveCooldowns[moveId] = 0;

    PS.MathUtils.fitCircularBody(this, 16);
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

  /** Swaps sprite on evolution, re-applying the fixed display size for the new texture. */
  setSpeciesTexture(textureKey) {
    this.setTexture(textureKey);
    this.setDisplaySize(PS.PLAYER_DISPLAY_SIZE, PS.PLAYER_DISPLAY_SIZE);
    PS.MathUtils.fitCircularBody(this, 16);
  }

  getHpRatio() {
    return PS.MathUtils.clamp(this.hp / this.maxHp, 0, 1);
  }

  update(dtSec, input, statusFx, moveManager, onFireMove) {
    this.invulnTimer = Math.max(0, this.invulnTimer - dtSec);
    this.survivalRechargeTimer = Math.max(0, this.survivalRechargeTimer - dtSec);
    this.attackSpeedBuffTimer = Math.max(0, this.attackSpeedBuffTimer - dtSec);
    if (this.attackSpeedBuffTimer <= 0) this.attackSpeedBuffMult = 1;
    this.fieldSpeedBuffTimer = Math.max(0, this.fieldSpeedBuffTimer - dtSec);
    if (this.fieldSpeedBuffTimer <= 0) this.fieldSpeedBuffMult = 1;
    this.hazardSlowTimer = Math.max(0, this.hazardSlowTimer - dtSec);
    if (this.hazardSlowTimer <= 0) this.hazardSlowMult = 1;
    this.phoenixRechargeTimer = Math.max(0, this.phoenixRechargeTimer - dtSec);
    this.phoenixDamageBuffTimer = Math.max(0, this.phoenixDamageBuffTimer - dtSec);
    if (this.phoenixDamageBuffTimer <= 0) this.phoenixDamageBuffMult = 1;
    this.killMomentumTimer = Math.max(0, this.killMomentumTimer - dtSec);
    if (this.killMomentumTimer <= 0) this.killMomentumStacks = 0;
    this.updateShield(dtSec);

    // --- movement ---
    let vx = 0, vy = 0;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    const dir = PS.MathUtils.normalize(vx, vy);
    const speedMult = statusFx.getMoveSpeedMult(this);
    const momentumSpeedMult = 1 + this.killMomentumStacks * 0.04;
    const speed = this.build.getMoveSpeed() * speedMult * this.fieldSpeedBuffMult * this.hazardSlowMult * momentumSpeedMult;
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
      // 'counter' is reactive (triggers from GameScene.applyEnemyHitToPlayer when the player
      // is hit, not on its own timer), so it never participates in the proactive auto-fire loop.
      if (move.pattern === 'counter') continue;
      this.moveCooldowns[moveId] = (this.moveCooldowns[moveId] || 0) - dtSec * 1000;
      if (this.moveCooldowns[moveId] <= 0) {
        const fired = onFireMove(this, move);
        if (fired) {
          const momentumCooldownMult = 1 - Math.min(0.4, this.killMomentumStacks * 0.03);
          this.moveCooldowns[moveId] = (this.build.getMoveCooldownMs(move) / this.attackSpeedBuffMult) * momentumCooldownMult;
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

  /** magic_shield ability (on_equip_shield): recharges shield charges over time, capped by
   * the ability's level-scaled maxCharges. A no-op when the build has no such ability. */
  updateShield(dtSec) {
    const hooks = PS.AbilitySystem.find(this.build.modifiers, 'on_equip_shield');
    if (hooks.length === 0) return;
    const hook = hooks[0];
    const maxCharges = PS.AbilitySystem.scale(hook.effect, hook.level, 'maxCharges', 'maxChargesPerLevel');
    if (this.shieldCharges >= maxCharges) return;
    this.shieldRechargeTimer -= dtSec;
    if (this.shieldRechargeTimer <= 0) {
      this.shieldCharges++;
      const rechargeSec = Math.max(2.5, (hook.effect.rechargeSec || 9) - (hook.effect.rechargeSecReductionPerLevel || 0) * (hook.level - 1));
      this.shieldRechargeTimer = rechargeSec;
    }
  }

  /** Returns true if damage was actually applied (false if Focus-Sash-style survival absorbed a kill,
   * or a Fairy-slice Shield charge negated the hit outright). */
  takeDamage(amount) {
    if (this.invulnTimer > 0) return false;
    if (this.shieldCharges > 0) {
      this.shieldCharges--;
      this.invulnTimer = 0.3;
      this.lastSaveType = 'shield';
      return false;
    }
    this.hp -= amount;
    this.invulnTimer = 0.4;
    this.lastSaveType = null;

    if (this.hp <= 0) {
      const mods = this.build.modifiers;
      if (mods.phoenixCharges > 0 && this.phoenixRechargeTimer <= 0) {
        // relic_phoenix: strictly better save than the plain survival-charge one below, so it
        // takes priority when both are available.
        this.hp = this.maxHp;
        this.phoenixRechargeTimer = mods.phoenixRechargeSec || 90;
        this.invulnTimer = mods.phoenixInvulnSec || 3;
        this.phoenixDamageBuffMult = mods.phoenixDamageMult || 1.5;
        this.phoenixDamageBuffTimer = mods.phoenixInvulnSec || 3;
        this.lastSaveType = 'phoenix';
      } else if (this.survivalCharges > 0 && this.survivalRechargeTimer <= 0) {
        this.survivalCharges--;
        this.survivalRechargeTimer = this.build.modifiers.survivalRechargeSec || 60;
        this.hp = 1;
        this.lastSaveType = 'survival';
      }
    }
    return true;
  }

  /** relic_momentum: called by GameScene on every kill; stacks decay if the streak breaks. */
  registerKillMomentum() {
    const level = this.build.modifiers.killMomentumLevel;
    if (level <= 0) return;
    const maxStacks = 3 + level * 2;
    this.killMomentumStacks = Math.min(maxStacks, this.killMomentumStacks + 1);
    this.killMomentumTimer = 4;
  }

  isDead() {
    return this.hp <= 0;
  }

  /** Field "Speed" pickup: temporary movement speed multiplier. */
  applyFieldSpeedBuff(mult, durationSec) {
    this.fieldSpeedBuffMult = Math.max(this.fieldSpeedBuffMult, mult);
    this.fieldSpeedBuffTimer = Math.max(this.fieldSpeedBuffTimer, durationSec);
  }

  /** Map hazard "slow_zone" (spec: 맵별 고유 기믹, e.g. Beach 밀물 웅덩이). Re-called every tick
   * while the player stands inside the zone, so the slow stays active continuously and only
   * decays shortly after they actually leave it. */
  applyHazardSlow(mult, durationSec) {
    this.hazardSlowMult = Math.min(this.hazardSlowMult, mult);
    this.hazardSlowTimer = Math.max(this.hazardSlowTimer, durationSec);
  }

  /** Field "Heal" pickup. */
  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }
};
