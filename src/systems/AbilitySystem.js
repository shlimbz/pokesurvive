// AbilitySystem: Pokemon Abilities are mostly conditional (HP-based, category-based,
// on-hit triggers), so instead of flattening them into scalars up front we collect them as
// "hooks" that CombatSystem/Player consult at the relevant moment (on damage dealt, on
// damage taken, on status applied, etc). Each hook carries its level so callers can scale
// chance/mult by (base + (level-1)*perLevel).
window.PS = window.PS || {};

// Perf note: find() used to be `mods.abilityHooks.filter(...)`, allocating a new array on every
// call. It's called from Player.updateShield() every single frame plus multiple times per hit in
// CombatSystem (scales with AoE/beam/orbit target count), so a tiny per-build array of 1-5 hooks
// was still being re-filtered tens of thousands of times per match. accumulate() now also builds
// a type -> hooks[] index once per modifier refresh (level-up/evolution/item pickup - not
// per-frame), so find() becomes a plain map lookup with zero allocation on the hot path.
const EMPTY_HOOKS = [];

PS.AbilitySystem = {
  accumulate(build, abilityManager, mods) {
    if (!mods.abilityHooksByType) mods.abilityHooksByType = {};
    for (const abilityId of Object.keys(build.abilities)) {
      const level = build.abilities[abilityId];
      const ability = abilityManager.getAbility(abilityId);
      if (!ability) continue;
      for (const effect of ability.effects) {
        const hook = { abilityId, level, effect };
        mods.abilityHooks.push(hook);
        (mods.abilityHooksByType[effect.type] || (mods.abilityHooksByType[effect.type] = [])).push(hook);
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
    return (mods.abilityHooksByType && mods.abilityHooksByType[type]) || EMPTY_HOOKS;
  }
};
