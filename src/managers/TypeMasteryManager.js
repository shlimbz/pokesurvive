// TypeMasteryManager: wraps data/type-mastery.json (xp thresholds + per-type level effects).
window.PS = window.PS || {};

PS.TypeMasteryManager = class TypeMasteryManager {
  constructor(data) {
    this.xpPerLevel = data.xpPerLevel; // index 0..5, cumulative xp required to BE at that level
    this.xpGain = data.xpGain;
    this.types = data.types;
    this.default = data.default;
  }

  getTypeConfig(typeId) {
    return this.types[typeId] || this.default;
  }

  /** Level is 0..5 (0 = no XP yet). */
  levelForXp(xp) {
    let level = 0;
    for (let i = 1; i < this.xpPerLevel.length; i++) {
      if (xp >= this.xpPerLevel[i]) level = i; else break;
    }
    return level;
  }

  xpForNextLevel(level) {
    return level >= this.xpPerLevel.length - 1 ? null : this.xpPerLevel[level + 1];
  }

  maxLevel() {
    return this.xpPerLevel.length - 1;
  }
};
