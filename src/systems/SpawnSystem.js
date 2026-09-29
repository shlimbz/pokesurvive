// SpawnSystem: decides WHEN and WHERE to spawn enemies, using WaveSystem's current time-phase
// multipliers and data/balance.json's spawnSystem tuning. Actual Enemy creation is delegated
// back to the scene via `spawnCallback` so this file stays scene-agnostic.
window.PS = window.PS || {};

PS.SpawnSystem = class SpawnSystem {
  constructor(enemyManager, waveSystem, balanceData, mapId, spawnCallback) {
    this.enemyManager = enemyManager;
    this.waveSystem = waveSystem;
    this.cfg = balanceData.spawnSystem;
    this.mapId = mapId;
    this.spawnCallback = spawnCallback;
    this.spawnTimerMs = 0;
  }

  update(dtMs, runTimeSec, playerX, playerY, aliveCount) {
    const phase = this.waveSystem.getPhase(runTimeSec);

    const trigger = this.waveSystem.checkTriggers(runTimeSec);
    if (trigger === 'miniboss') this.spawnMiniBoss(playerX, playerY);
    if (trigger === 'boss') this.spawnBoss(playerX, playerY);

    if (aliveCount >= this.cfg.maxAliveEnemies) return;

    this.spawnTimerMs -= dtMs;
    if (this.spawnTimerMs <= 0) {
      const interval = Math.max(this.cfg.minSpawnIntervalMs, this.cfg.baseSpawnIntervalMs / phase.spawnRateMult);
      this.spawnTimerMs = interval;
      this.spawnOne(phase, playerX, playerY);
    }
  }

  randomPosAround(playerX, playerY) {
    const angle = Math.random() * Math.PI * 2;
    const r = this.cfg.spawnRadius + Math.random() * 120;
    return { x: playerX + Math.cos(angle) * r, y: playerY + Math.sin(angle) * r };
  }

  spawnOne(phase, playerX, playerY) {
    const pos = this.randomPosAround(playerX, playerY);
    const eliteChance = this.cfg.eliteBaseChance * phase.eliteChanceMult;
    const isElite = PS.RandomUtils.chance(eliteChance);
    const species = isElite ? this.enemyManager.pickElite(this.mapId) : this.enemyManager.pickNormal(this.mapId);
    if (!species) return;
    const stats = this.enemyManager.computeSpawnStats(species);
    stats.maxHp = Math.round(stats.maxHp * phase.enemyHpMult);
    stats.attack = stats.attack * phase.enemyDmgMult;
    this.spawnCallback(species, stats, pos.x, pos.y);
  }

  spawnMiniBoss(playerX, playerY) {
    const species = this.enemyManager.pickMiniBoss(this.mapId);
    if (!species) return;
    const stats = this.enemyManager.computeSpawnStats(species);
    const pos = this.randomPosAround(playerX, playerY);
    this.spawnCallback(species, stats, pos.x, pos.y, true);
  }

  spawnBoss(playerX, playerY) {
    const species = this.enemyManager.getBoss(this.mapId);
    if (!species) return;
    const stats = this.enemyManager.computeSpawnStats(species);
    const pos = this.randomPosAround(playerX, playerY);
    this.spawnCallback(species, stats, pos.x, pos.y, true);
  }
};
