// TypeEffectivenessSystem: implements data/type-chart.json's game-adjusted chart
// (0x replaced by 0.25x, dual-type multiplies and clamps to [0.25, 4.0]).
window.PS = window.PS || {};

PS.TypeEffectivenessSystem = class TypeEffectivenessSystem {
  constructor(typeChartData, balanceData) {
    this.chart = typeChartData;
    this.min = typeChartData.minMultiplier;
    this.max = typeChartData.maxMultiplier;
    this.balance = balanceData;
  }

  /**
   * @param {string} attackType
   * @param {string[]} defenderTypes - 1 or 2 types
   * @param {number} penetration - 0..1, how much of an unfavorable (<1) multiplier's
   *        resistance is "undone" toward 1.0 (Type Penetration items/abilities).
   */
  getMultiplier(attackType, defenderTypes, penetration = 0) {
    let mult = 1;
    for (const defType of defenderTypes) {
      const row = this.chart.gameChart[attackType];
      const m = row && row[defType] !== undefined ? row[defType] : 1;
      mult *= m;
    }
    mult = PS.MathUtils.clamp(mult, this.min, this.max);

    if (penetration > 0 && mult < 1) {
      mult = mult + (1 - mult) * penetration;
    }
    return mult;
  }

  getLabel(multiplier) {
    if (multiplier >= 2.0) return 'superEffective';
    if (multiplier > 1.0) return 'effective';
    if (multiplier === 1.0) return 'neutral';
    if (multiplier >= 0.5) return 'notVeryEffective';
    return 'resisted';
  }

  isStab(userTypes, moveType) {
    return userTypes.includes(moveType);
  }
};
