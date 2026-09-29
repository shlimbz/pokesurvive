// WaveSystem: tracks the 15-minute time-phase progression (spec section 71) and tells
// SpawnSystem how hard to hit the player right now, plus fires one-shot miniboss/boss triggers.
window.PS = window.PS || {};

PS.WaveSystem = class WaveSystem {
  constructor(balanceData) {
    this.phases = balanceData.timePhases;
    this.matchDurationSec = balanceData.matchDurationSec;
    this.miniBossSpawned = false;
    this.bossSpawned = false;
  }

  getPhase(runTimeSec) {
    for (const phase of this.phases) {
      if (runTimeSec >= phase.startSec && runTimeSec < phase.endSec) return phase;
    }
    return this.phases[this.phases.length - 1];
  }

  isMatchOver(runTimeSec) {
    return runTimeSec >= this.matchDurationSec;
  }

  /** Returns 'miniboss' | 'boss' | null exactly once when the run time crosses that phase's trigger. */
  checkTriggers(runTimeSec) {
    for (const phase of this.phases) {
      if (phase.spawnMiniBossAt !== undefined && !this.miniBossSpawned && runTimeSec >= phase.spawnMiniBossAt) {
        this.miniBossSpawned = true;
        return 'miniboss';
      }
      if (phase.spawnBossAt !== undefined && !this.bossSpawned && runTimeSec >= phase.spawnBossAt) {
        this.bossSpawned = true;
        return 'boss';
      }
    }
    return null;
  }

  getTimeRemainingLabel(runTimeSec) {
    const remaining = Math.max(0, this.matchDurationSec - runTimeSec);
    const m = Math.floor(remaining / 60);
    const s = Math.floor(remaining % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
};
