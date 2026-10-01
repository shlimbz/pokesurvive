// MoveManager: wraps data/moves.json.
window.PS = window.PS || {};

PS.MoveManager = class MoveManager {
  constructor(moveData) {
    this.data = moveData;

    // TWO canonical "representative" moves per type (design spec 2026-10-01: "타입별 대표 기술을
    // 1개 -> 2개로 확장" - each pair is deliberately built from two DIFFERENT combat archetypes,
    // e.g. fire's ember=원거리 projectile vs fire_blast=광역 explosion, so owning both never feels
    // like "the same attack twice"). Index [0] is the move every starter of that type begins with
    // (data/pokemon.json); index [1] is the type's second pick, reached only through a level-up
    // "learn a new move" choice (see getLearnableMovesForTypes below) - never a day-one move, so
    // the early game still reads as "one clean identity" per the original single-move redesign.
    // 'psychic' has no starter owner at all for either slot (no starter is pure-psychic with one
    // of these moves as its day-one pick) - both stay reachable purely through learning, which is
    // intentional: it keeps the type from being completely absent instead of forcing a starter
    // reshuffle. This list excludes every other orphaned/legacy move in moves.json (thunderbolt's
    // sibling 'thunder', flamethrower pre-Charizard-swap, etc.) and every '_plus' evolved variant,
    // so neither the starting roster nor off-type/second-move learning ever hands out an evolved
    // or unrelated move.
    this.representativeMoveByType = {
      electric: ['thunder_shock', 'thunderbolt'], fire: ['ember', 'fire_blast'],
      water: ['water_gun', 'aqua_jet'], grass: ['vine_whip', 'leech_seed'],
      normal: ['quick_attack', 'hyper_beam'], ghost: ['lick', 'shadow_punch'],
      fighting: ['karate_chop', 'aura_sphere'], fairy: ['moonblast', 'moonlight_orb'],
      psychic: ['psybeam', 'zen_headbutt'], dark: ['crunch', 'dark_pulse'],
      ice: ['powder_snow', 'icicle_crash'], poison: ['poison_sting', 'toxic_spikes'],
      ground: ['mud_slap', 'earthquake'], flying: ['gust', 'wing_attack'],
      bug: ['x_scissor', 'leech_life'], rock: ['rock_throw', 'rock_blast'],
      dragon: ['dragon_breath', 'dragon_rush'], steel: ['metal_claw', 'flash_cannon']
    };
  }

  getMove(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }

  /**
   * Returns every not-yet-owned move id that a "learn a new move" level-up choice may offer:
   * both OWN-type reps not yet owned (in practice just index [1] - the starter roster already
   * grants index [0] on day one, see pokemon.json) and every OTHER type's two reps, as an
   * off-type coverage option.
   *
   * Redesign history: each playable Pokemon used to have exactly ONE representative move for its
   * own type, so there was never a "new different move" to learn - `move` choices only ever
   * leveled up the move you already had. Per discussion (2026-10-01, two separate changes):
   * (1) a build stuck against a type it's weak against had zero way to compensate, since no item
   * grants type coverage either - "게임적 허용" (deliberate game-balance liberty, not meant to be
   * battle-accurate) opened up OTHER types' reps as a learnable coverage pick; (2) each type then
   * grew a genuine SECOND representative move of a deliberately different combat archetype (e.g.
   * fire's ember=원거리 vs fire_blast=광역버스트), reached the same way - through this same
   * learn-a-new-move path, never as a day-one move - so the early game still reads as one clean
   * identity and the second slot is something the player actively picks. Both mechanics share one
   * code path because they're the same thing from the build's point of view: "a rep move you
   * don't own yet, in or out of your own type(s)." This stays fully separate from the per-type
   * move-EVOLUTION system (moves.json's `evolution` field) - learning a new move never touches it.
   */
  getLearnableMovesForTypes(types, excludeIds) {
    const excluded = new Set(excludeIds || []);
    const result = [];
    for (const moveIds of Object.values(this.representativeMoveByType)) {
      for (const moveId of moveIds) {
        if (excluded.has(moveId)) continue; // already own this rep move
        const move = this.data[moveId];
        if (move) result.push(move);
      }
    }
    return result;
  }
};
