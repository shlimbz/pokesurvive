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
    this.baseSpeed = stats.speed; // pre-phase-multiplier baseline, see applyBossPhase()
    this.expValue = stats.exp;
    this.statusEffects = {};
    this.contactCooldown = 0;
    this.stunTimer = 0;

    // Elite modifier (spec section 57) - see EnemyManager.computeSpawnStats. Tinted so it reads
    // as a visibly different enemy, not just a bigger health bar. Set BEFORE this.move below
    // since the 'sniper' (투사체형) modifier can grant a ranged attack to a species that would
    // otherwise have none at all (no moveId of its own).
    this.eliteModifier = stats.eliteModifier || null;

    const sniperMoveId = this.eliteModifier && this.eliteModifier.sniperMoveId;
    this.move = species.moveId
      ? moveManager.getMove(species.moveId)
      : (sniperMoveId ? moveManager.getMove(sniperMoveId) : null);
    this.moveCooldownMs = species.moveCooldownMs || (sniperMoveId && this.eliteModifier.sniperCooldownMs) || 0;
    this.moveTimer = this.moveCooldownMs ? this.moveCooldownMs * 0.5 : 0;

    // Boss-specific multi-pattern behavior (spec section 58): a boss with a `movePool` rotates
    // between several differently-patterned moves, each on its OWN cooldown (from the move's
    // own cooldownMs), instead of the flat "one move forever" every other tier uses via
    // `moveId`/`moveCooldownMs` above. Staggered start timers so the moves don't all sync up.
    this.movePool = (species.movePool && species.movePool.length > 0)
      ? species.movePool.map((entry, i) => ({
          move: moveManager.getMove(entry.id),
          timer: 250 + i * 350
        })).filter(e => e.move)
      : null;

    // Boss multi-phase transitions (spec: 3페이즈 이상) - data-driven via balance.json's
    // bossPhases array (each entry: {threshold, speedMult, cooldownMult, damageMult, label}),
    // applied in ascending-danger order as HP crosses each threshold. See
    // GameScene.updateBossHpBars (the trigger check) and applyBossPhase() below (the effect).
    this.phaseIndex = 0;
    this.phaseCooldownMult = 1;
    this.phaseDamageMult = 1;

    const scale = species.scale || 1;
    if (this.texture.key !== species.id) this.setTexture(species.id);
    const displaySize = PS.ENEMY_BASE_DISPLAY_SIZE * scale;
    this.setDisplaySize(displaySize, displaySize);
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.body.enable = true;
    PS.MathUtils.fitCircularBody(this, 14 * scale);
    this.setTint(this.eliteModifier ? parseInt(this.eliteModifier.tint.replace('0x', ''), 16) : 0xffffff);

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
    if (this.eliteModifier && this.eliteModifier.regenPercent) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * this.eliteModifier.regenPercent * dtSec);
    }
    this.contactCooldown = Math.max(0, this.contactCooldown - dtSec);
    this.stunTimer = Math.max(0, this.stunTimer - dtSec);
    if (this.moveTimer > 0) this.moveTimer -= dtSec * 1000;

    const dist = PS.MathUtils.distance(this.x, this.y, playerX, playerY);
    const frozenOrStunned = statusFx.isFrozen(this) || this.stunTimer > 0;

    // Bugfix: paralysis's attackSpeedMult and stunChance, and confusion's accuracy penalty, were
    // defined in balance.json and read by StatusEffectSystem but never actually consulted here -
    // a paralyzed/confused enemy attacked at completely normal speed and accuracy. Rolled once
    // per attack ATTEMPT (not per frame) so a low stunChance doesn't become near-certain over
    // many frames of a paralysis duration.
    const attackSpeedMult = statusFx.getAttackSpeedMult(this) || 1;
    if (this.movePool) {
      for (const entry of this.movePool) {
        entry.timer -= dtSec * 1000;
        if (entry.timer <= 0 && dist <= (entry.move.range || 300) * 1.2 && !frozenOrStunned) {
          entry.timer = (entry.move.cooldownMs || 2000) * this.phaseCooldownMult / attackSpeedMult;
          if (!statusFx.rollStunned(this) && !statusFx.isConfusedFumble(this)) onWantsToAttack(this, entry.move);
        }
      }
    } else if (this.move && this.moveTimer <= 0 && dist <= this.move.range * 1.2 && !frozenOrStunned) {
      this.moveTimer = this.moveCooldownMs * this.phaseCooldownMult / attackSpeedMult;
      if (!statusFx.rollStunned(this) && !statusFx.isConfusedFumble(this)) onWantsToAttack(this, this.move);
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

  /** Used by the 'vampiric' elite modifier to heal off damage it deals to the player. */
  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  /** Boss multi-phase transition (spec: 3페이즈 이상), triggered from GameScene as HP crosses
   * each descending threshold in balance.json's bossPhases. Each phase's multipliers are
   * absolute (computed from baseSpeed), not stacked on top of the previous phase's, so tuning
   * stays predictable regardless of how many phases a boss has. */
  applyBossPhase(phaseDef, phaseIndex) {
    this.phaseIndex = phaseIndex;
    this.speed = this.baseSpeed * (phaseDef.speedMult || 1);
    this.phaseCooldownMult = phaseDef.cooldownMult || 1;
    this.phaseDamageMult = phaseDef.damageMult || 1;
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
