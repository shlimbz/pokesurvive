// EnemyManager: wraps data/enemies.json and data/maps.json, and applies data/balance.json's
// per-tier stat multipliers when a spawn is requested.
//
// Ecosystem-based spawning (design spec section 21-24): maps.json's enemyPool/elitePool are
// WEIGHTED MIXED-TYPE lists, not single-type-locked. Each map keeps a dominant native flavor
// (higher weights) but always includes a couple of low-weight "visitor" species of other types,
// so no map is ever effectively single-type and no one Pokemon type is ever safe-mode on a
// given map (see pickFromEcosystemPool below).
//
// Note on data/enemies.json: every species' baseStats are "normal wild-encounter" scale,
// regardless of its `tier`. The tier ('normal'/'elite'/'miniboss'/'boss') just selects a
// hp/attack/defense/speed/exp multiplier from balance.json's enemyTier table at spawn time
// (computeSpawnStats below) - this is what actually makes an elite/miniboss/boss strong,
// so a species' base numbers never need to be hand-tuned per tier (no double-scaling).
window.PS = window.PS || {};

PS.EnemyManager = class EnemyManager {
  constructor(enemyData, mapData, balanceData) {
    this.data = enemyData;
    this.maps = mapData;
    this.balance = balanceData;
  }

  getMap(id) {
    return this.maps[id];
  }

  getSpecies(id) {
    return this.data[id];
  }

  // Ecosystem pools (data/maps.json) are weighted lists of { id, weight } so a map can mix in
  // low-weight "visitor" species of other types instead of being effectively single-type.
  pickFromEcosystemPool(pool) {
    if (!pool || pool.length === 0) return null;
    const weights = {};
    for (const entry of pool) weights[entry.id] = entry.weight;
    const id = PS.RandomUtils.weightedPick(weights);
    return this.data[id];
  }

  pickNormal(mapId) {
    const map = this.maps[mapId];
    return this.pickFromEcosystemPool(map.enemyPool);
  }

  pickElite(mapId) {
    const map = this.maps[mapId];
    return this.pickFromEcosystemPool(map.elitePool);
  }

  pickMiniBoss(mapId) {
    const map = this.maps[mapId];
    const id = PS.RandomUtils.pick(map.miniBossPool);
    return this.data[id];
  }

  getBoss(mapId) {
    const map = this.maps[mapId];
    return this.data[map.boss];
  }

  /**
   * Applies enemyTier multipliers from balance.json to a species' baseStats,
   * returning concrete spawn-time stats (hp, attack, defense, speed, exp).
   * Elites additionally roll ONE random elite modifier (spec section 57) on top of the flat
   * tier multipliers, so "elite" means a distinct behavioral gimmick, not just bigger numbers.
   */
  computeSpawnStats(species) {
    const tierMult = this.balance.enemyTier[species.tier] || this.balance.enemyTier.normal;
    const b = species.baseStats;
    const stats = {
      maxHp: Math.round(b.hp * tierMult.hpMult),
      attack: b.attack * tierMult.attackMult,
      defense: b.defense * tierMult.defenseMult,
      speed: b.speed * tierMult.speedMult,
      exp: Math.round(species.expValue * tierMult.expMult)
    };

    if (species.tier === 'elite' && this.balance.eliteModifiers) {
      const ids = Object.keys(this.balance.eliteModifiers).filter(k => k !== 'comment');
      const modifier = this.balance.eliteModifiers[PS.RandomUtils.pick(ids)];
      if (modifier.speedMult) stats.speed *= modifier.speedMult;
      if (modifier.defenseMult) stats.defense *= modifier.defenseMult;
      stats.eliteModifier = modifier;
    }

    return stats;
  }
};
