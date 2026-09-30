// RelicSystem: turns a BuildSystem's owned relics into scalar modifiers, mirroring
// PS.ItemSystem exactly - each relic's effects are defined "per level" in data/relics.json,
// so the contribution is effect.value * level (level = number of times that relic was picked
// up, 1..maxLevel). Every effect.type here is intentionally distinct from anything
// PS.ItemSystem handles - see data/relics.json's header comment.
window.PS = window.PS || {};

PS.RelicSystem = {
  accumulate(build, relicManager, mods) {
    // Fields relics can contribute to, initialized here so consumers never need `|| default`.
    mods.pickupRadiusMult = 1;
    mods.extraLevelUpChoices = 0;
    mods.bossTierDamageMult = 1;
    mods.expGainMult = 1;
    mods.extraRerolls = 0;
    mods.relicHpPercent = 0;
    mods.relicDefensePercent = 0;
    mods.phoenixCharges = 0;
    mods.phoenixRechargeSec = 0;
    mods.phoenixInvulnSec = 0;
    mods.phoenixDamageMult = 1;
    mods.killMomentumLevel = 0;

    for (const relicId of Object.keys(build.relics || {})) {
      const level = build.relics[relicId];
      const relic = relicManager.getRelic(relicId);
      if (!relic) continue;

      for (const effect of relic.effects) {
        const v = (effect.value !== undefined ? effect.value : 0) * level;

        switch (effect.type) {
          case 'pickup_radius_mult':
            mods.pickupRadiusMult *= (1 + effect.value * level);
            break;
          case 'extra_levelup_choices':
            mods.extraLevelUpChoices += Math.round(v);
            break;
          case 'boss_tier_damage_mult':
            mods.bossTierDamageMult *= (1 + effect.value * level);
            break;
          case 'exp_gain_mult':
            mods.expGainMult *= (1 + effect.value * level);
            break;
          case 'extra_rerolls':
            mods.extraRerolls += Math.round(v);
            break;
          case 'relic_hp_percent':
            mods.relicHpPercent += v;
            break;
          case 'relic_defense_percent':
            mods.relicDefensePercent += v;
            break;
          case 'phoenix_charge':
            mods.phoenixCharges += Math.round(v);
            mods.phoenixRechargeSec = effect.rechargeSec;
            mods.phoenixInvulnSec = effect.invulnSec;
            mods.phoenixDamageMult = effect.damageMult;
            break;
          case 'kill_momentum_level':
            mods.killMomentumLevel = Math.max(mods.killMomentumLevel, level);
            break;
          default:
            break;
        }
      }
    }
  }
};
