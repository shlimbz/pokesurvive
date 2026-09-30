// MoveEvolutionSystem: "Move Evolution" (design spec section 33) - a move at max level, held
// alongside a specific synergy item at a required level, transforms into a stronger/different
// variant (own id in data/moves.json, can change pattern/chain/range/status - not just numbers).
// Mirrors EvolutionSystem's shape (checkEvolution/apply) but operates on individual moves
// instead of the whole species, and is driven entirely by a `move.evolution` data block so a
// move with no `evolution` field just never evolves (fully backward compatible).
window.PS = window.PS || {};

PS.MoveEvolutionSystem = class MoveEvolutionSystem {
  constructor(moveManager) {
    this.moveManager = moveManager;
  }

  /** Returns the first move eligible to evolve right now, or null. */
  checkEvolutions(build) {
    for (const moveId of build.getOwnedMoveIds()) {
      const move = this.moveManager.getMove(moveId);
      const evo = move && move.evolution;
      if (!evo) continue;
      if (build.moves[evo.evolvesTo]) continue; // already evolved
      if (build.getMoveLevel(moveId) < evo.requiresMoveLevel) continue;
      if (evo.requiresItem && build.getItemLevel(evo.requiresItem) < evo.requiresItemLevel) continue;
      return { fromMoveId: moveId, toMoveId: evo.evolvesTo, fromMove: move, toMove: this.moveManager.getMove(evo.evolvesTo) };
    }
    return null;
  }

  apply(build, entry) {
    build.evolveMove(entry.fromMoveId, entry.toMoveId);
  }
};
