// BuildSystem: the single source of truth for "this run's build" - the current species,
// level/exp, owned moves/items/abilities and their levels, stat upgrades, and derived combat
// modifiers. Everything else (CombatSystem, LevelSystem, EvolutionSystem, Player) reads from
// here so a run's power comes entirely from data + choices, never hardcoded per-Pokemon code.
window.PS = window.PS || {};

PS.BuildSystem = class BuildSystem {
  constructor(speciesId, managers, balanceData) {
    this.managers = managers; // { pokemon, move, item, ability }
    this.balance = balanceData;

    this.speciesId = speciesId;
    this.species = managers.pokemon.getSpecies(speciesId);
    this.evolutionStage = 0;

    this.level = 1;
    this.exp = 0;

    this.moves = {};
    for (const moveId of this.species.moves) this.moves[moveId] = 1;

    this.items = {};
    this.abilities = {};
    this.abilities[this.species.ability] = 1;

    this.statPicks = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    this.statPercent = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };

    this.typeDamageDealt = {};
    this.kills = 0;
    this.runTimeSec = 0;

    this.gameStats = managers.pokemon.computeGameStats(this.species);
    this.refreshModifiers();
  }

  // ---- mutation API, used by LevelSystem's chosen card & EvolutionSystem ----

  learnOrUpgradeMove(moveId) {
    const max = this.balance.maxLevels.move;
    this.moves[moveId] = Math.min((this.moves[moveId] || 0) + 1, max);
    this.refreshModifiers();
  }

  addOrUpgradeItem(itemId) {
    const item = this.managers.item.getItem(itemId);
    const max = item ? item.maxLevel : this.balance.maxLevels.item;
    this.items[itemId] = Math.min((this.items[itemId] || 0) + 1, max);
    this.refreshModifiers();
  }

  addOrUpgradeAbility(abilityId) {
    this.abilities[abilityId] = Math.min((this.abilities[abilityId] || 0) + 1, this.balance.maxLevels.ability);
    this.refreshModifiers();
  }

  upgradeStat(statKey, grade) {
    const cfg = this.balance.statUpgrade[grade];
    if (this.statPicks[statKey] >= this.balance.maxLevels.stat) return;
    this.statPicks[statKey]++;
    this.statPercent[statKey] += cfg.percent;
    this.refreshModifiers();
  }

  setSpecies(speciesId) {
    this.speciesId = speciesId;
    this.species = this.managers.pokemon.getSpecies(speciesId);
    this.evolutionStage++;
    this.gameStats = this.managers.pokemon.computeGameStats(this.species);
    // Evolution grants any brand-new moves the evolved form knows.
    for (const moveId of this.species.moves) {
      if (!this.moves[moveId]) this.moves[moveId] = 1;
    }
    // Evolved ability replaces the base ability but keeps its accumulated level.
    const oldAbilityIds = Object.keys(this.abilities);
    if (!this.abilities[this.species.ability]) {
      const carryLevel = oldAbilityIds.length ? this.abilities[oldAbilityIds[0]] : 1;
      this.abilities[this.species.ability] = carryLevel;
    }
    this.refreshModifiers();
  }

  addExp(amount) {
    this.exp += amount;
  }

  recordDamageDealt(typeId, amount) {
    this.typeDamageDealt[typeId] = (this.typeDamageDealt[typeId] || 0) + amount;
  }

  recordKill() {
    this.kills++;
  }

  getDominantType() {
    let best = null;
    let bestAmount = -1;
    for (const t of Object.keys(this.typeDamageDealt)) {
      if (this.typeDamageDealt[t] > bestAmount) {
        bestAmount = this.typeDamageDealt[t];
        best = t;
      }
    }
    return best;
  }

  getOwnedMoveIds() {
    return Object.keys(this.moves);
  }

  // ---- derived modifiers, recomputed whenever the build changes ----

  refreshModifiers() {
    const mods = {
      typeDamageBonus: {},
      globalDamageMult: 1,
      critChance: 0,
      critDamage: 0,
      cooldownMult: 1,
      moveSpeedPercent: 0,
      // 1.2 baseline (not 1.0): playtesting showed early attack range felt too short even
      // before any range-boosting item is picked up, so every move gets a flat +20% reach.
      rangeMult: 1.2,
      lifestealPercent: 0,
      typePenetration: 0,
      hpRegenPercent: 0,
      statusChanceBonus: {},
      onHitStunChance: 0,
      onAttackCooldownResetChance: 0,
      selfDamageOnAttackPercent: 0,
      survivalCharges: 0,
      survivalRechargeSec: 0,
      abilityHooks: []
    };

    PS.ItemSystem.accumulate(this, this.managers.item, mods);
    PS.AbilitySystem.accumulate(this, this.managers.ability, mods);

    this.modifiers = mods;
  }

  getStatMultiplier(statKey) {
    return 1 + (this.statPercent[statKey] || 0);
  }

  getMoveLevel(moveId) {
    return this.moves[moveId] || 0;
  }

  /** Effective cooldown for a move, folding in item cooldownMult + ability hooks + Speed stat. */
  getMoveCooldownMs(move) {
    let mult = this.modifiers.cooldownMult;
    for (const hook of PS.AbilitySystem.find(this.modifiers, 'type_build_attack_speed')) {
      const count = this.getOwnedMoveIds().filter(id => {
        const m = this.managers.move.getMove(id);
        return m && m.type === hook.effect.moveType;
      }).length;
      if (count >= hook.effect.threshold) {
        mult *= PS.AbilitySystem.scale(hook.effect, hook.level, 'cooldownMult', 'cooldownMultPerLevel');
      }
    }
    let cooldown = move.cooldownMs * mult * (1 - this.gameStats.attackSpeedBonus);
    return Math.max(60, cooldown);
  }

  /** Effective move speed (px/s) folding in Speed stat, items and ability hooks. */
  getMoveSpeed() {
    let speed = this.gameStats.moveSpeed * this.getStatMultiplier('speed');
    speed *= (1 + this.modifiers.moveSpeedPercent);
    for (const hook of PS.AbilitySystem.find(this.modifiers, 'type_build_move_speed')) {
      const count = this.getOwnedMoveIds().filter(id => {
        const m = this.managers.move.getMove(id);
        return m && m.type === hook.effect.moveType;
      }).length;
      if (count >= hook.effect.threshold) {
        speed *= PS.AbilitySystem.scale(hook.effect, hook.level, 'speedMult', 'speedMultPerLevel');
      }
    }
    for (const hook of PS.AbilitySystem.find(this.modifiers, 'flat_move_speed')) {
      speed += PS.AbilitySystem.scale(hook.effect, hook.level, 'speedBonus', 'speedBonusPerLevel');
    }
    return speed;
  }

  getMaxHp() {
    return Math.round(this.gameStats.maxHp * this.getStatMultiplier('hp'));
  }

  getItemLevel(itemId) {
    return this.items[itemId] || 0;
  }

  getAbilityLevel(abilityId) {
    return this.abilities[abilityId] || 0;
  }
};
