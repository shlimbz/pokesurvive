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
    this.relics = {};

    this.statPicks = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    this.statPercent = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    // Bugfix: epic/legendary stat cards advertise an "extra" bonus (balance.json statUpgrade.*.extra,
    // surfaced to the player by LevelSystem.describeChoice) that was never actually applied -
    // counted here and turned into real modifiers in refreshModifiers() below.
    this.statExtraCounts = { minor_regen: 0, conditional_shield: 0 };

    this.typeDamageDealt = {};
    this.typeMasteryXp = {};
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

  /** Relics are picked up in the field or dropped by minibosses/bosses - see GameScene. */
  addRelic(relicId) {
    const relic = this.managers.relic.getRelic(relicId);
    const max = relic ? relic.maxLevel : 2;
    const wasAt = this.relics[relicId] || 0;
    this.relics[relicId] = Math.min(wasAt + 1, max);
    this.refreshModifiers();
    return this.relics[relicId] > wasAt; // false if already at max level (relic "wasted")
  }

  getRelicLevel(relicId) {
    return this.relics[relicId] || 0;
  }

  upgradeStat(statKey, grade) {
    const cfg = this.balance.statUpgrade[grade];
    if (this.statPicks[statKey] >= this.balance.maxLevels.stat) return;
    this.statPicks[statKey]++;
    this.statPercent[statKey] += cfg.percent;
    if (cfg.extra && this.statExtraCounts[cfg.extra] !== undefined) this.statExtraCounts[cfg.extra]++;
    this.refreshModifiers();
  }

  /** Move Evolution (spec section 33): replaces an owned move with its evolved variant,
   * keeping it at max level (evolved moves are meant to already be a payoff, not a fresh grind). */
  evolveMove(fromMoveId, toMoveId) {
    const level = this.moves[fromMoveId] || this.balance.maxLevels.move;
    delete this.moves[fromMoveId];
    this.moves[toMoveId] = level;
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
    // Evolved ability replaces the base ability but keeps its accumulated level. Every
    // existing evolution line keeps the same ability id end-to-end (e.g. Blaze all the way
    // through Charmander -> Charizard), so this rarely actually swaps anything; the Ralts line
    // is the first to change the equipped ability on evolution (Levitate -> Magic Guard on
    // Gardevoir), so the old ability id must actually be removed, not just left in place
    // alongside the new one.
    if (!this.abilities[this.species.ability]) {
      const oldAbilityIds = Object.keys(this.abilities);
      const carryLevel = oldAbilityIds.length ? this.abilities[oldAbilityIds[0]] : 1;
      for (const oldId of oldAbilityIds) delete this.abilities[oldId];
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

  /** Type Mastery XP gain (spec section 30) - automatic, not a level-up choice. See GameScene
   * for the three call sites: on-hit, on-kill, on-status-applied. Only recomputes modifiers
   * (and returns the new level, for a UI callout) when a level actually changes, so per-hit XP
   * gain doesn't force a full modifier recompute every single frame. */
  addTypeMasteryXp(typeId, amount) {
    if (!typeId) return null;
    const before = this.getTypeMasteryLevel(typeId);
    this.typeMasteryXp[typeId] = (this.typeMasteryXp[typeId] || 0) + amount;
    const after = this.getTypeMasteryLevel(typeId);
    if (after !== before) {
      this.refreshModifiers();
      return after;
    }
    return null;
  }

  getTypeMasteryLevel(typeId) {
    return this.managers.typeMastery.levelForXp(this.typeMasteryXp[typeId] || 0);
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
      abilityHooks: [],
      abilityHooksByType: {}, // populated by AbilitySystem.accumulate() below - see its comment
      // Shared "hook" collections that more than one system contributes to (items AND Type
      // Mastery can both grant bonus damage vs a status, or a per-pattern field bonus) - declared
      // once here, up front, so accumulate order below never matters and no contributor can
      // accidentally wipe another's entries by re-assigning instead of pushing/merging.
      typeChainRangeBonus: {},
      masteryTargetStatusHooks: [], // [{ moveType, status, value }]
      patternFieldBonus: {} // { "pattern:field": cumulativePercent }
    };

    PS.ItemSystem.accumulate(this, this.managers.item, mods);
    PS.AbilitySystem.accumulate(this, this.managers.ability, mods);
    PS.RelicSystem.accumulate(this, this.managers.relic, mods);
    PS.TypeMasterySystem.accumulate(this, this.managers.typeMastery, mods);

    // Epic/legendary stat-card "extra" bonuses (see statExtraCounts above). minor_regen stacks
    // with any item/relic hpRegenPercent already accumulated; conditionalShieldCharges is read
    // by Player.refreshFromBuild() the same way survivalCharges is (grant-the-difference, so
    // already-consumed charges from earlier this run aren't refunded).
    mods.hpRegenPercent += this.statExtraCounts.minor_regen * (this.balance.statExtras?.minorRegenPercentPerPick ?? 0.004);
    mods.conditionalShieldCharges = this.statExtraCounts.conditional_shield;

    this.modifiers = mods;
  }

  getStatMultiplier(statKey) {
    let mult = 1 + (this.statPercent[statKey] || 0);
    // relic_blessing bonuses are separate from the per-pick stat-upgrade percentages above,
    // folded in here so every consumer (getMaxHp, CombatSystem's player-defense calc) sees them.
    if (statKey === 'hp') mult += this.modifiers.relicHpPercent || 0;
    if (statKey === 'defense') mult += this.modifiers.relicDefensePercent || 0;
    return mult;
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
