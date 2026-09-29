// StatusEffectSystem: applies & ticks status effects (Burn, Poison, Paralysis, Freeze, Slow,
// Confusion, Defense Down, Attack Down, Armor Break) on any entity that has an
// `entity.statusEffects = {}` map. Bosses/elites resist via balance.bossStatusResistance.
window.PS = window.PS || {};

PS.StatusEffectSystem = class StatusEffectSystem {
  constructor(balanceData) {
    this.defs = balanceData.statusEffects;
    this.tierResist = balanceData.bossStatusResistance;
  }

  ensure(entity) {
    if (!entity.statusEffects) entity.statusEffects = {};
    return entity.statusEffects;
  }

  getTierResist(tier) {
    return this.tierResist[tier] || this.tierResist.normal;
  }

  /**
   * Rolls the status's chance (modified by the target's tier resistance) and applies it on success.
   * @param {object} entity - must expose entity.statusEffects map and entity.tier ('normal' default).
   * @param {string} statusId
   * @param {number} chanceOverride - the chance rolled by the move/ability (0..1).
   */
  tryApply(entity, statusId, chanceOverride) {
    const def = this.defs[statusId];
    if (!def) return false;
    const resist = this.getTierResist(entity.tier || 'normal');
    const chance = (chanceOverride !== undefined ? chanceOverride : def.chance) * resist.chanceMult;
    if (!PS.RandomUtils.chance(chance)) return false;
    this.apply(entity, statusId);
    return true;
  }

  apply(entity, statusId) {
    const def = this.defs[statusId];
    if (!def) return;
    const resist = this.getTierResist(entity.tier || 'normal');
    const map = this.ensure(entity);
    const duration = def.duration !== undefined ? def.duration * resist.durationMult : 0;

    if (!map[statusId]) {
      map[statusId] = { stacks: 1, remaining: duration, tickTimer: 0 };
    } else {
      map[statusId].remaining = Math.max(map[statusId].remaining, duration);
      if (map[statusId].stacks < (def.stackLimit || 1)) map[statusId].stacks++;
    }

    if (entity.onStatusApplied) entity.onStatusApplied(statusId);
  }

  has(entity, statusId) {
    return !!(entity.statusEffects && entity.statusEffects[statusId]);
  }

  /**
   * Advances all active statuses by dtSec. Calls damageCallback(entity, amount, statusId) for
   * damage-over-time ticks (burn/poison), using maxHp-relative percent damage from balance.json.
   */
  update(entity, dtSec, damageCallback) {
    const map = entity.statusEffects;
    if (!map) return;
    const resist = this.getTierResist(entity.tier || 'normal');

    for (const statusId of Object.keys(map)) {
      const state = map[statusId];
      const def = this.defs[statusId];
      state.remaining -= dtSec;

      if (def.damagePercentPerSec) {
        state.tickTimer += dtSec;
        const cooldown = def.cooldown || 1.0;
        if (state.tickTimer >= cooldown) {
          state.tickTimer -= cooldown;
          const amount = entity.maxHp * def.damagePercentPerSec * state.stacks * resist.damageMult;
          if (damageCallback) damageCallback(entity, amount, statusId);
        }
      }

      if (state.remaining <= 0) delete map[statusId];
    }
  }

  // ---- Aggregate modifiers read by Player/Enemy movement & combat code ----
  getMoveSpeedMult(entity) {
    let mult = 1;
    const map = entity.statusEffects;
    if (!map) return mult;
    if (map.freeze) mult *= (1 - (this.defs.freeze.moveSpeedMult === 0 ? 1 : 0));
    if (map.paralysis) mult *= this.defs.paralysis.moveSpeedMult;
    if (map.slow) mult *= Math.pow(this.defs.slow.moveSpeedMult, map.slow.stacks);
    return mult;
  }

  getAttackSpeedMult(entity) {
    let mult = 1;
    const map = entity.statusEffects;
    if (!map) return mult;
    if (map.paralysis) mult *= this.defs.paralysis.attackSpeedMult;
    return mult;
  }

  isFrozen(entity) {
    return this.has(entity, 'freeze');
  }

  rollStunned(entity) {
    if (this.has(entity, 'paralysis') && PS.RandomUtils.chance(this.defs.paralysis.stunChance)) return true;
    return false;
  }

  isConfusedFumble(entity) {
    if (!this.has(entity, 'confusion')) return false;
    return PS.RandomUtils.chance(1 - this.defs.confusion.accuracyMult);
  }

  getDefenseMult(entity) {
    let mult = 1;
    const map = entity.statusEffects;
    if (!map) return mult;
    if (map.defenseDown) mult *= Math.pow(this.defs.defenseDown.defenseMultPerStack, map.defenseDown.stacks);
    if (map.armorBreak) mult *= this.defs.armorBreak.defenseMult;
    return mult;
  }

  getAttackMult(entity) {
    let mult = 1;
    const map = entity.statusEffects;
    if (!map) return mult;
    if (map.attackDown) mult *= Math.pow(this.defs.attackDown.attackMultPerStack, map.attackDown.stacks);
    return mult;
  }
};
