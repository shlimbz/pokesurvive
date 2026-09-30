// ItemSystem: turns a BuildSystem's owned items into scalar modifiers.
// Item effect values are defined "per level" in data/items.json, so the contribution is
// effect.value * level (level = number of times that item has been picked, 1..maxLevel).
window.PS = window.PS || {};

PS.ItemSystem = {
  accumulate(build, itemManager, mods) {
    for (const itemId of Object.keys(build.items)) {
      const level = build.items[itemId];
      const item = itemManager.getItem(itemId);
      if (!item) continue;

      for (const effect of item.effects) {
        const v = (effect.value !== undefined ? effect.value : 0) * level;

        switch (effect.type) {
          case 'type_damage':
            mods.typeDamageBonus[item.moveType] = (mods.typeDamageBonus[item.moveType] || 0) + v;
            break;
          case 'status_chance':
            mods.statusChanceBonus[effect.status] = (mods.statusChanceBonus[effect.status] || 0) + v;
            break;
          case 'hp_regen_percent':
            mods.hpRegenPercent += v;
            break;
          case 'lifesteal_percent':
            mods.lifestealPercent += v;
            break;
          case 'global_damage':
            mods.globalDamageMult *= (1 + effect.value * level);
            break;
          case 'self_damage_on_attack_percent':
            mods.selfDamageOnAttackPercent += v;
            break;
          case 'survive_lethal_hit':
            mods.survivalCharges += effect.usesPerRun * level;
            mods.survivalRechargeSec = effect.rechargeSec;
            break;
          case 'move_speed_percent':
            mods.moveSpeedPercent += v;
            break;
          case 'cooldown_reduction_percent':
            mods.cooldownMult *= (1 - effect.value * level);
            break;
          case 'on_hit_stun_chance':
            mods.onHitStunChance += v;
            break;
          case 'range_percent':
            mods.rangeMult *= (1 + effect.value * level);
            break;
          case 'on_attack_cooldown_reset_chance':
            mods.onAttackCooldownResetChance += v;
            break;
          case 'crit_chance':
            mods.critChance += v;
            break;
          case 'crit_damage':
            mods.critDamage += v;
            break;
          case 'type_penetration':
            mods.typePenetration += v;
            break;
          // ---- Pattern-identity synergy items (spec: 아이템 시너지 확장) ----
          // Boosts ONE pattern's characteristic field (the same field patternGrowth already
          // scales by move level - see GameScene.getPatternScaledField) by a cumulative percent,
          // so an item can double down on a build's chosen attack pattern instead of only ever
          // offering flat type damage.
          case 'pattern_field_bonus': {
            const key = `${effect.pattern}:${effect.field}`;
            mods.patternFieldBonus[key] = (mods.patternFieldBonus[key] || 0) + v;
            break;
          }
          // Bonus damage of a given move type against a target already afflicted by a given
          // status - reuses the exact same hook shape/consumption Type Mastery's
          // target_status_damage_bonus already uses in CombatSystem, so an item can grant the
          // same kind of payoff Type Mastery does (e.g. "포이즌 팽": 중독된 적에게 독 피해 +%).
          case 'status_target_damage_bonus':
            mods.masteryTargetStatusHooks.push({ moveType: effect.moveType || item.moveType, status: effect.status, value: v });
            break;
          default:
            break;
        }
      }
    }
  }
};
