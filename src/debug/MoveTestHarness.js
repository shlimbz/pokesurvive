// MoveTestHarness: standalone debug tool, loaded ONLY by move-test.html (never by index.html /
// main.js), so it ships zero risk to the real game. It reuses the real boot pipeline
// (BootScene -> PreloadScene -> PS.Game.*) and then jumps straight into the real GameScene -
// exactly the same trick this project's own Playwright test scripts used throughout
// development - so every number and every VFX shown here is the literal production code path,
// not a reimplementation.
//
// What it does, once the real Game scene is up:
//   1. Disables the normal wave/spawn system and match-timer so the screen doesn't fill with
//      random enemies while someone is trying to read one move's effect.
//   2. Spawns one permanent "dummy" target (a plain Rattata - normal-type, no moveId of its own,
//      so it never attacks back) and keeps it topped up to full HP and glued to a controllable
//      offset from the player, so on-hit-only VFX (electric crackle, fist stamp, etc. - see
//      VFXSystem.playHit) can actually be previewed, not just cast-time effects.
//   3. Clears the player's build down to exactly one move (the one picked in the UI) at the
//      picked level, so that move's own auto-fire loop (Player.update, unmodified) is the only
//      thing firing - real cooldown, real range, real damage, real VFX override dispatch.
//   4. Exposes a tiny API (window.MoveTestHarness) that move-test.html's plain-DOM control panel
//      drives; the panel itself never touches Phaser internals directly.
window.PS = window.PS || {};

(function () {
  const state = {
    scene: null,
    dummy: null,
    dummyOffset: 160,
    currentMoveId: null,
    currentLevel: 1,
    ready: false
  };

  function waitFor(testFn, onReady, label) {
    const iv = setInterval(() => {
      try {
        if (testFn()) {
          clearInterval(iv);
          onReady();
        }
      } catch (e) {
        // Keep polling - PS.Game.* fields are assigned incrementally during PreloadScene.create().
      }
    }, 50);
  }

  function boot(onReady) {
    waitFor(
      () => window.PS && window.PS.Game && window.PS.Game.managers && window.PS.Game.managers.move && window.PS.Game.managers.enemy,
      () => {
        window.PS.game.scene.start('Game');
        waitFor(
          () => {
            const scene = window.PS.game.scene.getScene('Game');
            return scene && scene.build && scene.player && scene.spawnSystem;
          },
          () => onReady(window.PS.game.scene.getScene('Game'))
        );
      }
    );
  }

  function setupScene(scene) {
    state.scene = scene;

    // ---- 1. freeze the normal match flow ----
    scene.spawnSystem.update = function () {}; // no random waves/elites/minibosses/boss
    scene.waveSystem.isMatchOver = function () { return false; }; // never auto-ends
    if (scene.nextPickupTimerMs !== undefined) scene.nextPickupTimerMs = Infinity;
    if (scene.nextRelicPickupTimerMs !== undefined) scene.nextRelicPickupTimerMs = Infinity;

    // ---- 2. spawn a permanent dummy target (Rattata: normal-type, no moveId => never attacks) ----
    const species = scene.managers.enemy.getSpecies('rattata');
    const stats = scene.managers.enemy.computeSpawnStats(species);
    stats.maxHp = 1e9;
    stats.attack = 0;
    stats.speed = 0;
    state.dummy = scene.spawnEnemy(species, stats, scene.player.x + state.dummyOffset, scene.player.y);

    // ---- 3. start with no moves owned at all; UI picks one ----
    scene.build.moves = {};
    scene.build.refreshModifiers();
    scene.player.moveCooldowns = {};

    // ---- per-frame upkeep: dummy never dies, stays at the chosen offset, player never dies ----
    scene.events.on('update', () => {
      if (state.dummy && state.dummy.active) {
        state.dummy.hp = state.dummy.maxHp;
        state.dummy.x = scene.player.x + state.dummyOffset;
        state.dummy.y = scene.player.y;
        state.dummy.body.reset(state.dummy.x, state.dummy.y);
      }
      if (scene.player) scene.player.hp = scene.player.maxHp;
    });

    state.ready = true;
    if (state.onReadyCallback) state.onReadyCallback();
  }

  const api = {
    onReady(cb) {
      if (state.ready) { cb(); return; }
      state.onReadyCallback = cb;
      boot(setupScene);
    },

    /** Every player-side move entry, enriched with whether the player can actually learn it
     * (per MoveManager.representativeMoveByType - see this session's hydro_pump lesson: most
     * entries in moves.json are enemy-exclusive and must never be presented as player skills
     * without a clear label). */
    getAllMoves() {
      const moveData = window.PS.Game.data.moves;
      const moveManager = window.PS.Game.managers.move;
      const learnableIds = new Set();
      for (const ids of Object.values(moveManager.representativeMoveByType)) {
        for (const id of ids) learnableIds.add(id);
      }
      return Object.keys(moveData).map(id => {
        const m = moveData[id];
        return {
          id,
          name: m.name,
          type: m.type,
          pattern: m.pattern,
          baseDamage: m.baseDamage,
          cooldownMs: m.cooldownMs,
          range: m.range,
          maxLevel: m.maxLevel,
          learnable: learnableIds.has(id)
        };
      }).sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
    },

    selectMove(moveId, level) {
      const scene = state.scene;
      if (!scene) return null;
      const move = scene.managers.move.getMove(moveId);
      if (!move) return null;
      const lvl = Math.max(1, Math.min(level, move.maxLevel || 5));
      state.currentMoveId = moveId;
      state.currentLevel = lvl;
      scene.build.moves = {};
      scene.build.moves[moveId] = lvl;
      scene.build.refreshModifiers();
      scene.player.moveCooldowns[moveId] = 0; // fires immediately instead of waiting out an old cooldown
      return this.getComputedStats();
    },

    setLevel(level) {
      if (!state.currentMoveId) return null;
      return this.selectMove(state.currentMoveId, level);
    },

    setDummyDistance(px) {
      state.dummyOffset = px;
    },

    /** Forces one contact hit from the dummy, for previewing the 'counter' pattern (reactive -
     * only ever fires from GameScene.applyEnemyHitToPlayer, never from the normal auto-fire
     * loop a cast/other pattern uses). Harmless: player HP is reset to full every frame anyway. */
    triggerDummyHit() {
      const scene = state.scene;
      if (!scene || !state.dummy || !state.dummy.active) return;
      const prevAttack = state.dummy.attack;
      state.dummy.attack = 1;
      state.dummy.contactCooldown = 0;
      scene.onPlayerTouchEnemy(state.dummy);
      state.dummy.attack = prevAttack;
    },

    getComputedStats() {
      const scene = state.scene;
      if (!scene || !state.currentMoveId) return null;
      const move = scene.managers.move.getMove(state.currentMoveId);
      const level = state.currentLevel;
      const dmgTable = scene.data_.balance.moveLevelDamageMult || [1, 1, 1, 1, 1];
      const dmgMult = dmgTable[Math.max(0, Math.min(level - 1, dmgTable.length - 1))];
      return {
        range: Math.round(scene.getEffectiveRange(move, level)),
        cooldownMs: Math.round(scene.build.getMoveCooldownMs(move)),
        estimatedDamage: Math.round((move.baseDamage || 0) * dmgMult),
        rawBaseDamage: move.baseDamage,
        pattern: move.pattern,
        maxLevel: move.maxLevel
      };
    }
  };

  window.MoveTestHarness = api;
})();
