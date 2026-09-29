// CombatSystem: the damage formula from spec section 81 -
//   Base Damage x Move Level Modifier x Attack/SpAttack Modifier x STAB x Type Effectiveness
//   x Critical x Item Bonus x Ability Bonus x Enemy Defense Modifier
// plus status-effect application, lifesteal, ability on-hit/on-damage-taken hooks.
window.PS = window.PS || {};

PS.CombatSystem = class CombatSystem {
  constructor(typeEffectivenessSystem, statusEffectSystem, balanceData) {
    this.typeFx = typeEffectivenessSystem;
    this.statusFx = statusEffectSystem;
    this.balance = balanceData;
    this.moveLevelDamageMult = [1.0, 1.10, 1.25, 1.45, 1.70];
  }

  // ---- Player (build-driven) attacking an enemy ----
  resolvePlayerHit(build, move, defender, currentHpRatio, attackerEntity) {
    const mods = build.modifiers;
    const moveLevel = build.getMoveLevel(move.id) || 1;
    const category = move.category === 'physical' ? 'physical' : 'special';
    const attackPower = category === 'physical'
      ? build.gameStats.physicalPower * build.getStatMultiplier('attack')
      : build.gameStats.specialPower * build.getStatMultiplier('spAttack');

    let stab = this.typeFx.isStab(build.species.types, move.type) ? this.balance.stab : 1;
    for (const hook of PS.AbilitySystem.find(mods, 'stab_boost')) {
      if (stab > 1) stab = PS.AbilitySystem.scale(hook.effect, hook.level, 'stabMult', 'stabMultPerLevel');
    }

    const penetration = PS.MathUtils.clamp(mods.typePenetration, 0, 0.6);
    const typeMult = this.typeFx.getMultiplier(move.type, defender.types, penetration);

    let critChance = this.balance.critical.baseChance + mods.critChance;
    let critDamageMult = this.balance.critical.baseDamageMult + mods.critDamage;
    const isCrit = PS.RandomUtils.chance(critChance);

    const itemDamageBonus = 1 + (mods.typeDamageBonus[move.type] || 0);
    const globalMult = mods.globalDamageMult;

    // Ability hooks that affect outgoing damage.
    let abilityMult = 1;
    for (const hook of PS.AbilitySystem.find(mods, 'low_hp_type_damage')) {
      if (hook.effect.moveType === move.type && currentHpRatio <= hook.effect.threshold) {
        abilityMult *= PS.AbilitySystem.scale(hook.effect, hook.level, 'damageMult', 'damageMultPerLevel');
      }
    }
    for (const hook of PS.AbilitySystem.find(mods, 'category_damage_boost')) {
      if (hook.effect.category === category) {
        abilityMult *= PS.AbilitySystem.scale(hook.effect, hook.level, 'damageMult', 'damageMultPerLevel');
      }
    }
    for (const hook of PS.AbilitySystem.find(mods, 'low_base_power_damage_boost')) {
      if (move.baseDamage <= hook.effect.threshold) {
        abilityMult *= PS.AbilitySystem.scale(hook.effect, hook.level, 'damageMult', 'damageMultPerLevel');
      }
    }
    for (const hook of PS.AbilitySystem.find(mods, 'status_active_damage_boost')) {
      if (attackerEntity && attackerEntity.statusEffects && Object.keys(attackerEntity.statusEffects).length > 0) {
        abilityMult *= PS.AbilitySystem.scale(hook.effect, hook.level, 'damageMult', 'damageMultPerLevel');
      }
    }
    for (const hook of PS.AbilitySystem.find(mods, 'absorb_type_stack_damage')) {
      if (hook.effect.buffType === move.type && attackerEntity && attackerEntity.flashFireStacks > 0) {
        abilityMult *= (1 + hook.effect.stackMult * attackerEntity.flashFireStacks);
      }
    }

    const defenderReduction = category === 'physical' ? defender.physicalReduction : defender.specialReduction;
    const defenderDefenseStatusMult = this.statusFx.getDefenseMult(defender);
    const defenseModifier = 1 / (1 + defenderReduction * defenderDefenseStatusMult * 0.01);

    let damage = move.baseDamage
      * this.moveLevelDamageMult[Math.min(moveLevel, 5) - 1]
      * (attackPower / 50)
      * stab
      * typeMult
      * (isCrit ? critDamageMult : 1)
      * itemDamageBonus
      * abilityMult
      * globalMult
      * defenseModifier;

    damage = Math.max(1, Math.round(damage));

    build.recordDamageDealt(move.type, damage);

    let statusApplied = null;
    if (move.statusEffect) {
      let chance = move.statusEffect.chance + (mods.statusChanceBonus[move.statusEffect.id] || 0);
      if (moveLevel >= 4 && move.statusEffect) chance += 0.10;
      if (this.statusFx.tryApply(defender, move.statusEffect.id, chance)) statusApplied = move.statusEffect.id;
    }

    if (mods.onHitStunChance > 0 && PS.RandomUtils.chance(mods.onHitStunChance)) {
      defender.stunTimer = Math.max(defender.stunTimer || 0, 0.3);
    }

    return {
      damage,
      isCrit,
      typeMult,
      label: isCrit ? 'critical' : this.typeFx.getLabel(typeMult),
      statusApplied,
      lifestealPercent: mods.lifestealPercent + (move.lifestealPercent || 0)
    };
  }

  // ---- Enemy (raw stats) attacking the player build ----
  resolveEnemyHitOnPlayer(enemyStats, enemyTypes, move, build, playerEntity) {
    const mods = build.modifiers;
    const attackPower = enemyStats.attack;
    const moveType = (move && move.type) || enemyTypes[0];
    const stab = enemyTypes.includes(moveType) ? this.balance.stab : 1;
    const typeMult = this.typeFx.getMultiplier(moveType, build.species.types, 0);

    const defenderReduction = build.gameStats.physicalReduction * build.getStatMultiplier('defense');
    const defenderDefenseStatusMult = this.statusFx.getDefenseMult(playerEntity);
    const defenseModifier = 1 / (1 + defenderReduction * defenderDefenseStatusMult * 0.01);

    let damage = (move ? move.baseDamage : attackPower)
      * (attackPower / 50)
      * stab
      * typeMult
      * defenseModifier;

    // Ability hooks that reduce/convert incoming damage of a specific type.
    let absorbed = false;
    for (const hook of PS.AbilitySystem.find(mods, 'type_resist')) {
      if (hook.effect.resistType === moveType) {
        const mult = hook.effect.damageMult + (hook.effect.damageMultPerLevel || 0) * (hook.level - 1);
        damage *= Math.max(0.1, mult);
      }
    }
    let healFromAbsorb = 0;
    for (const hook of PS.AbilitySystem.find(mods, 'absorb_type_heal')) {
      if (hook.effect.absorbType === moveType) {
        healFromAbsorb += damage * hook.effect.healPercentOfDamage;
        absorbed = true;
      }
    }
    const flashFireStacks = [];
    for (const hook of PS.AbilitySystem.find(mods, 'absorb_type_stack_damage')) {
      if (hook.effect.absorbType === moveType) {
        absorbed = true;
        flashFireStacks.push(hook);
      }
    }

    damage = Math.max(absorbed ? 0 : 1, Math.round(damage));

    return {
      damage,
      absorbed,
      healFromAbsorb: Math.round(healFromAbsorb),
      flashFireStacks,
      label: this.typeFx.getLabel(typeMult),
      statusId: move && move.statusEffect ? move.statusEffect.id : null,
      statusChance: move && move.statusEffect ? move.statusEffect.chance : 0
    };
  }
};
