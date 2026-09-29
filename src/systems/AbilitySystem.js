// AbilitySystem: Pokemon Abilities are mostly conditional (HP-based, category-based,
// on-hit triggers), so instead of flattening them into scalars up front we collect them as
// "hooks" that CombatSystem/Player consult at the relevant moment (on damage dealt, on
// damage taken, on status applied, etc). Each hook carries its level so callers can scale
// chance/mult by (base + (level-1)*perLevel).
window.PS = window.PS || {};

PS.AbilitySystem = {
  accumulate(build, abilityManager, mods) {
    for (const abilityId of Object.keys(build.abilities)) {
      const level = build.abilities[abilityId];
      const ability = abilityManager.getAbility(abilityId);
      if (!ability) continue;
      for (const effect of ability.effects) {
        mods.abilityHooks.push({ abilityId, level, effect });
      }
    }
  },

  scale(effect, level, key, perKey) {
    const base = effect[key] || 0;
    const per = effect[perKey] || 0;
    return base + per * (level - 1);
  },

  /** Finds all ability hooks of a given effect.type. */
  find(mods, type) {
    return mods.abilityHooks.filter(h => h.effect.type === type);
  }
};
