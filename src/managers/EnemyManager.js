// EnemyManager: wraps data/enemies.json and data/maps.json, and applies data/balance.json's
// per-tier stat multipliers when a spawn is requested.
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

  pickNormal(mapId) {
    const map = this.maps[mapId];
    const id = PS.RandomUtils.pick(map.enemyPool);
    return this.data[id];
  }

  pickElite(mapId) {
    const map = this.maps[mapId];
    const id = PS.RandomUtils.pick(map.elitePool);
    return this.data[id];
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
   */
  computeSpawnStats(species) {
    const tierMult = this.balance.enemyTier[species.tier] || this.balance.enemyTier.normal;
    const b = species.baseStats;
    return {
      maxHp: Math.round(b.hp * tierMult.hpMult),
      attack: b.attack * tierMult.attackMult,
      defense: b.defense * tierMult.defenseMult,
      speed: b.speed * tierMult.speedMult,
      exp: Math.round(species.expValue * tierMult.expMult)
    };
  }
};
