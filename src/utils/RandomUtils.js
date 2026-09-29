// RandomUtils: seed-free random helpers used for spawns, drops and level-up choices.
window.PS = window.PS || {};

PS.RandomUtils = {
  range(min, max) {
    return min + Math.random() * (max - min);
  },

  intRange(min, max) {
    return Math.floor(this.range(min, max + 1));
  },

  chance(probability) {
    return Math.random() < probability;
  },

  pick(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
  },

  /**
   * weights: { key: number, ... } -> returns a key chosen proportionally to its weight.
   */
  weightedPick(weights) {
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k]);
    if (total <= 0) return this.pick(keys);
    let roll = Math.random() * total;
    for (const k of keys) {
      roll -= Math.max(0, weights[k]);
      if (roll <= 0) return k;
    }
    return keys[keys.length - 1];
  },

  /**
   * Pick `count` distinct items from array without replacement.
   */
  pickMultiple(array, count) {
    const pool = array.slice();
    const result = [];
    while (pool.length > 0 && result.length < count) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  }
};
