// EvolutionSystem: evaluates data/evolution.json conditions (spec section 54) against the
// current BuildSystem state and applies the swap when a condition set is satisfied.
window.PS = window.PS || {};

PS.EvolutionSystem = class EvolutionSystem {
  constructor(evolutionData) {
    this.entries = evolutionData;
  }

  getCandidates(speciesId) {
    return this.entries.filter(e => e.from === speciesId);
  }

  conditionsMet(build, conditions, runTimeSec) {
    if (conditions.requiredLevel && build.level < conditions.requiredLevel) return false;

    if (conditions.requiredMove) {
      const lvl = build.getMoveLevel(conditions.requiredMove);
      if (lvl < (conditions.requiredMoveLevel || 1)) return false;
    }

    if (conditions.requiredItem) {
      const lvl = build.getItemLevel(conditions.requiredItem);
      if (lvl < (conditions.requiredItemCount || 1)) return false;
    }

    if (conditions.requiredAbility) {
      if (build.getAbilityLevel(conditions.requiredAbility) < 1) return false;
    }

    if (conditions.requiredKills && build.kills < conditions.requiredKills) return false;

    if (conditions.requiredTime && runTimeSec < conditions.requiredTime) return false;

    if (conditions.requiredTypeDamage) {
      const dealt = build.typeDamageDealt[conditions.requiredTypeDamage.type] || 0;
      if (dealt < conditions.requiredTypeDamage.amount) return false;
    }

    return true;
  }

  /** Returns the first evolution entry whose conditions are satisfied, or null. */
  checkEvolution(build, runTimeSec) {
    const candidates = this.getCandidates(build.speciesId);
    for (const entry of candidates) {
      if (this.conditionsMet(build, entry.conditions, runTimeSec)) return entry;
    }
    return null;
  }

  apply(build, entry) {
    build.setSpecies(entry.to);
  }
};
