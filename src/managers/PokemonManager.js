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
    // Speed is now proportional to base movement speed, so slow/fast Pokemon feel
    // dramatically different (a ~3.7x spread across the roster) instead of the old
    // flat-additive formula's ~1.25x spread. speedMult=1 at referenceSpeed.
    const speedMult = b.speed / conv.speed.referenceSpeed;
    const rawMoveSpeed = conv.speed.baseMoveSpeed * speedMult;
    const moveSpeed = PS.MathUtils.clamp(rawMoveSpeed, conv.speed.minMoveSpeed, conv.speed.maxMoveSpeed);
    // Attack-speed bonus stays a smaller, separate contribution (per design: Speed should not
    // become a "do everything" stat) — it scales off how far the speed multiplier deviates from 1.
    const attackSpeedBonus = (speedMult - 1) * conv.speed.attackSpeedShare;

    return {
      maxHp,
      physicalPower,
      specialPower,
      physicalReduction,
      specialReduction,
      moveSpeed,
      attackSpeedBonus: PS.MathUtils.clamp(attackSpeedBonus, -0.35, 0.45)
    };
  }
};
