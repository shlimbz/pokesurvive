// MoveManager: wraps data/moves.json.
window.PS = window.PS || {};

PS.MoveManager = class MoveManager {
  constructor(moveData) {
    this.data = moveData;
  }

  getMove(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }

  /**
   * Returns move ids of the given type that the given owned-move-id-list does not contain yet.
   * Used to offer "learn a new move" level-up choices. Moves with an `evolvedFrom` field are
   * Move Evolution results (spec section 33) - they're never offered as a normal "learn new
   * move" pick, only reached by MoveEvolutionSystem transforming an already-owned move.
   */
  getLearnableMovesForTypes(types, excludeIds) {
    return Object.values(this.data).filter(m => types.includes(m.type) && !excludeIds.includes(m.id) && !m.evolvedFrom);
  }
};
