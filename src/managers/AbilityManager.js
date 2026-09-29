// AbilityManager: wraps data/abilities.json.
window.PS = window.PS || {};

PS.AbilityManager = class AbilityManager {
  constructor(abilityData) {
    this.data = abilityData;
  }

  getAbility(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }
};
