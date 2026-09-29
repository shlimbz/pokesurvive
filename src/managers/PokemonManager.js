// PokemonManager: wraps data/pokemon.json and converts Pokemon base stats into
// in-game stats using data/balance.json's statConversion table.
window.PS = window.PS || {};

PS.PokemonManager = class PokemonManager {
  constructor(pokemonData, balanceData) {
    this.data = pokemonData;
    this.balance = balanceData;
  }

  getSpecies(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }

  getStarters() {
    return Object.values(this.data).filter(p => p.isStarter);
  }

  /**
   * Converts base stats (Pokemon-scale numbers) into concrete game values:
   * maxHp, physicalPower, magicalPower, physicalReduction, magicalReduction, moveSpeed, cooldownReduction.
   */
  computeGameStats(species) {
    const conv = this.balance.statConversion;
    const b = species.baseStats;
    const maxHp = Math.round(conv.hp.base + b.hp * conv.hp.perPoint);
    const physicalPower = conv.attack.base + b.attack * conv.attack.perPoint;
    const specialPower = conv.spAttack.base + b.spAttack * conv.spAttack.perPoint;
    const physicalReduction = b.defense * conv.defense.perPoint;
    const specialReduction = b.spDefense * conv.spDefense.perPoint;
    const moveSpeed = conv.speed.base + b.speed * conv.speed.perPoint;
    const attackSpeedBonus = ((b.speed - 50) * conv.speed.perPoint * conv.speed.attackSpeedShare) / 100;

    return {
      maxHp,
      physicalPower,
      specialPower,
      physicalReduction,
      specialReduction,
      moveSpeed,
      attackSpeedBonus: PS.MathUtils.clamp(attackSpeedBonus, -0.5, 0.6)
    };
  }
};
