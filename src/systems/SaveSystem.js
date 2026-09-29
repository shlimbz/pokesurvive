// SaveSystem: minimal localStorage persistence for best-run stats and debug-mode toggle.
// Purely local - no network calls, consistent with the game's fully-offline requirement.
window.PS = window.PS || {};

PS.SaveSystem = {
  KEY: 'pokesurvivors_save_v1',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : this.defaultData();
    } catch (e) {
      return this.defaultData();
    }
  },

  defaultData() {
    return { bestSurvivalSec: 0, bestLevel: 0, runsPlayed: 0, lastResult: null, debugMode: false };
  },

  save(data) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage unavailable (private mode etc) - fail silently, gameplay is unaffected.
    }
  },

  recordRunResult(result) {
    const data = this.load();
    data.runsPlayed++;
    data.bestSurvivalSec = Math.max(data.bestSurvivalSec, result.survivedSec);
    data.bestLevel = Math.max(data.bestLevel, result.level);
    data.lastResult = result;
    this.save(data);
    return data;
  }
};
