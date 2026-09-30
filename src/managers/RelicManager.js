// RelicManager: wraps data/relics.json (see that file's header for what relics are and how
// they differ from ordinary level-up items).
window.PS = window.PS || {};

PS.RelicManager = class RelicManager {
  constructor(relicData) {
    this.data = relicData.relics;
  }

  getRelic(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }
};
