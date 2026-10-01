// MoveManager: wraps data/moves.json.
window.PS = window.PS || {};

PS.MoveManager = class MoveManager {
  constructor(moveData) {
    this.data = moveData;

    // One canonical "representative" move per type (spec discussion: 불리한 상성 대응을 위한
    // 타입 외 기술 학습 - 게임적 허용). Each of the 18 types maps to exactly the one base move
    // a starter actually owns for that type (plus 'psychic' -> psybeam, the one type with no
    // starter natively carrying it, kept here so every type still has a learnable coverage pick).
    // This list intentionally excludes the ~41 other orphaned/legacy moves still sitting in
    // moves.json (flamethrower, thunderbolt, etc. - used only by species-evolution movePatternSwap)
    // and every '_plus' evolved variant, so off-type learning never hands out an evolved move.
    this.representativeMoveByType = {
      electric: 'thunder_shock', fire: 'ember', water: 'water_gun', grass: 'vine_whip',
      normal: 'quick_attack', ghost: 'lick', fighting: 'karate_chop', fairy: 'moonblast',
      psychic: 'psybeam', dark: 'crunch', ice: 'powder_snow', poison: 'poison_sting',
      ground: 'mud_slap', flying: 'gust', bug: 'x_scissor', rock: 'rock_throw',
      dragon: 'dragon_breath', steel: 'metal_claw'
    };
  }

  getMove(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }

  /**
   * Returns move ids NOT of the given (own) types that the given owned-move-id-list does not
   * contain yet. Used to offer "learn a new move" level-up choices.
   *
   * Redesign history: each playable Pokemon has exactly ONE representative move for its own
   * type (data/pokemon.json's `moves` list, Eevee excepted). That used to mean there was never
   * a "new different move" to learn - level-up `move` choices only ever leveled up the move you
   * already had. Per discussion (2026-10-01): a Pokemon stuck against a type it's weak against
   * had zero way to compensate, since no item grants type coverage either. "게임적 허용" (deliberate
   * game-balance liberty, not meant to be battle-accurate) - a build may now also pick up ONE
   * representative move from a type outside its own as a coverage option. This stays separate
   * from the per-type move-evolution system (moves.json's `evolution` field) - learning an
   * off-type move doesn't touch or gate that at all.
   */
  getLearnableMovesForTypes(types, excludeIds) {
    const excluded = new Set(excludeIds || []);
    const ownTypes = new Set(types || []);
    const result = [];
    for (const [typeId, moveId] of Object.entries(this.representativeMoveByType)) {
      if (ownTypes.has(typeId)) continue; // own-type move is reached via the starter roster, not here
      if (excluded.has(moveId)) continue; // already learned this coverage move
      const move = this.data[moveId];
      if (move) result.push(move);
    }
    return result;
  }
};
