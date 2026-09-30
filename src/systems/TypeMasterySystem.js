// TypeMasterySystem: turns a BuildSystem's accumulated per-type XP (build.typeMasteryXp) into
// modifiers, mirroring ItemSystem/RelicSystem's "accumulate into shared mods" pattern. Unlike
// those, mastery isn't chosen from a card - it's fully automatic and cumulative (every level
// reached keeps all lower levels' effects active), see data/type-mastery.json for the design
// rationale and effect list.
window.PS = window.PS || {};

PS.TypeMasterySystem = {
  accumulate(build, masteryManager, mods) {
    // typeChainRangeBonus/masteryTargetStatusHooks are declared up front in BuildSystem's shared
    // mods object (items can contribute to masteryTargetStatusHooks too) - this only adds to
    // them, it must never reassign, or it would wipe any other system's earlier contribution.
    for (const typeId of Object.keys(build.typeMasteryXp || {})) {
      const xp = build.typeMasteryXp[typeId];
      const level = masteryManager.levelForXp(xp);
      if (level <= 0) continue;
      const cfg = masteryManager.getTypeConfig(typeId);

      for (let lvl = 1; lvl <= level; lvl++) {
        const levelDef = cfg.levels[lvl];
        if (!levelDef) continue;
        for (const effect of levelDef.effects) {
          switch (effect.type) {
            case 'type_damage':
              mods.typeDamageBonus[typeId] = (mods.typeDamageBonus[typeId] || 0) + effect.value;
              break;
            case 'status_chance':
              mods.statusChanceBonus[effect.status] = (mods.statusChanceBonus[effect.status] || 0) + effect.value;
              break;
            case 'chain_range_bonus':
              mods.typeChainRangeBonus[typeId] = (mods.typeChainRangeBonus[typeId] || 0) + effect.value;
              break;
            case 'target_status_damage_bonus':
              mods.masteryTargetStatusHooks.push({ moveType: typeId, status: effect.status, value: effect.value });
              break;
            default:
              break;
          }
        }
      }
    }
  }
};
