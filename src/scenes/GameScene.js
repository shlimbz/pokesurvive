// GameScene: the core 15-minute survival loop - movement, auto-attack, type effectiveness,
// status effects, EXP, level-up choices, evolution, elites/miniboss/boss, and the HUD.
window.PS = window.PS || {};

PS.GameScene = class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    const data = PS.Game.data;
    const managers = PS.Game.managers;
    this.data_ = data;
    this.managers = managers;
    this.typeFx = PS.Game.typeFx;
    this.statusFx = PS.Game.statusFx;
    this.combat = PS.Game.combat;
    this.levelSystem = PS.Game.levelSystem;
    this.evolutionSystem = PS.Game.evolutionSystem;
    this.moveEvolutionSystem = PS.Game.moveEvolutionSystem;
    this.assets = PS.Game.assets;
    this.vfx = new PS.VFXSystem(this, data.vfx, this.assets, data.vfxEffects);
    // Bugfix: GameScene.create() re-runs on every "다시 하기" (same Scene instance, Phaser never
    // recreates it), so `new PS.AudioSystem(this)` here used to spin up a brand-new AudioContext
    // per run with the old one never closed - most browsers cap concurrent live AudioContexts,
    // so after enough replays in one tab, all sound effects would silently stop working. One
    // AudioSystem (and its one AudioContext) now lives for the life of the page.
    this.audio = PS.Game.audio || (PS.Game.audio = new PS.AudioSystem(this));
    this.waveSystem = new PS.WaveSystem(data.balance);

    this.mapId = PS.Game.selectedMapId || 'forest';
    this.map = managers.enemy.getMap(this.mapId);

    this.worldSize = 8000;
    this.physics.world.setBounds(0, 0, this.worldSize, this.worldSize);
    this.cameras.main.setBounds(0, 0, this.worldSize, this.worldSize);
    this.cameras.main.setBackgroundColor(this.hex(this.map.background.color));
    this.drawBackgroundGrid();

    this.runTimeSec = 0;
    this.isPaused = false;
    this.matchEnded = false;
    this.bossKilled = false;

    // ---- Build + Player ----
    const speciesId = PS.Game.selectedSpeciesId || managers.pokemon.getStarters()[0].id;
    this.build = new PS.BuildSystem(speciesId, managers, data.balance);
    const startX = this.worldSize / 2;
    const startY = this.worldSize / 2;
    this.player = new PS.Player(this, startX, startY, speciesId, this.build);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // ---- Groups & pools ----
    this.enemyGroup = this.physics.add.group();
    this.playerProjectileGroup = this.physics.add.group();
    this.enemyProjectileGroup = this.physics.add.group();
    this.expGemGroup = this.physics.add.group();

    this.enemyPool = new PS.ObjectPool(
      () => { const e = new PS.Enemy(this, 'enemy_generic'); this.enemyGroup.add(e); return e; },
      (obj, species, stats, x, y) => obj.spawn(species, stats, x, y, managers.move),
      0
    );
    this.playerProjectilePool = new PS.ObjectPool(
      () => { const p = new PS.Projectile(this, 'bullet_base'); this.playerProjectileGroup.add(p); return p; },
      (obj, x, y, angle, cfg) => obj.spawn(x, y, angle, cfg),
      0
    );
    this.enemyProjectilePool = new PS.ObjectPool(
      () => { const p = new PS.Projectile(this, 'bullet_base'); this.enemyProjectileGroup.add(p); return p; },
      (obj, x, y, angle, cfg) => obj.spawn(x, y, angle, cfg),
      0
    );
    this.gemPool = new PS.ObjectPool(
      () => { const g = new PS.ExpGem(this, 'gem'); this.expGemGroup.add(g); return g; },
      (obj, x, y, value) => obj.spawn(x, y, value),
      0
    );
    this.damageNumberPool = new PS.ObjectPool(
      () => new PS.DamageNumber(this),
      // Bugfix: obj.onDone must be (re)bound on every obtain(), not just at construction -
      // DamageNumber.fire()'s tween onComplete only calls onDone if it's set, so without this
      // the pool's free list never refills and every damage number permanently leaks a Text
      // object (obtain() always falls through to factory()).
      (obj, x, y, value, options) => {
        obj.onDone = (o) => this.damageNumberPool.release(o);
        obj.fire(x, y, value, options);
      },
      0
    );

    // ---- Field pickups (heal / speed / magnet) ----
    this.pickupGroup = this.physics.add.group();
    this.nextPickupTimerMs = PS.RandomUtils.range(8000, 13000);

    // ---- Relic field pickups (far rarer - see data/relics.json) ----
    this.relicPickupGroup = this.physics.add.group();
    this.nextRelicPickupTimerMs = PS.RandomUtils.range(180000, 240000); // ~3-4 min

    // ---- Spawn system ----
    this.spawnSystem = new PS.SpawnSystem(managers.enemy, this.waveSystem, data.balance, this.mapId,
      (species, stats, x, y, isBig) => this.spawnEnemy(species, stats, x, y, isBig));

    // ---- Collisions ----
    this.physics.add.overlap(this.playerProjectileGroup, this.enemyGroup, (proj, enemy) => this.onPlayerProjectileHit(proj, enemy));
    this.physics.add.overlap(this.enemyProjectileGroup, this.player, (proj, player) => this.onEnemyProjectileHit(proj));
    this.physics.add.overlap(this.player, this.enemyGroup, (player, enemy) => this.onPlayerTouchEnemy(enemy));
    this.physics.add.overlap(this.player, this.expGemGroup, (player, gem) => this.onPlayerTouchGem(gem));
    this.physics.add.overlap(this.player, this.pickupGroup, (player, pickup) => this.onPickupCollected(pickup));
    this.physics.add.overlap(this.player, this.relicPickupGroup, (player, pickup) => this.onRelicPickupCollected(pickup));

    // ---- Input ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.setupDebugKeys();
    this.setupPauseAndBuildOverview();

    this.buildHud();
    this.buildLowHpVignette();
    this.rangeRingGfx = this.add.graphics().setDepth(2);

    // New attack-pattern state (Orbit satellites, Counter's own reactive cooldown, active
    // Summon turrets) - see performPlayerAttack's 'orbit'/'counter'/'summon' cases below.
    this.orbitVisuals = {};
    this.counterCooldowns = {};
    this.activeSummons = [];

    // Map-specific environmental hazard (spec: 맵별 고유 기믹) - see updateMapHazard/
    // spawnMapHazardZone below. Starts a little delayed so the very first seconds of a run
    // aren't immediately eaten by it.
    this.mapHazardTimer = 3000;

    // Bugfix: scene.start('Game') re-runs create() on the SAME Scene instance (Phaser doesn't
    // recreate it), and Scene shutdown only auto-clears input/tween listeners, not the scene's
    // own `events` emitter - without this .off() first, every replay stacked one more 'resume'
    // handler on top of the last (harmless individually since each just re-sets the same flag,
    // but an unbounded per-run listener leak for the life of the page).
    this.events.off('resume').on('resume', () => { this.isPaused = false; });
  }

  hex(v) {
    return typeof v === 'string' ? parseInt(v.replace('0x', '').replace('#', ''), 16) : v;
  }

  drawBackgroundGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, 0xffffff, 0.05);
    const step = 128;
    for (let x = 0; x <= this.worldSize; x += step) g.lineBetween(x, 0, x, this.worldSize);
    for (let y = 0; y <= this.worldSize; y += step) g.lineBetween(0, y, this.worldSize, y);
    g.setDepth(0);
  }

  // ================= HUD =================
  // UI pass: every persistent HUD piece now sits inside one of a small number of rounded
  // UITheme.panel() cards with consistent padding, instead of loose same-depth rectangles/text
  // that used to overlap (the kill-count/species text and the mobile pause button used to sit
  // almost exactly on top of each other in the top-right corner - see UITheme.js).
  buildHud() {
    const w = this.cameras.main.width;
    const T = PS.UITheme;

    // ---- Top-left: HP + EXP + Level card ----
    const tlW = 240, tlH = 64;
    this.hudTopLeftPanel = T.panel(this, 16, 16, tlW, tlH, 0, 0, { scrollFactor: 0, depth: 49 });
    this.hpMeter = T.meter(this, 16 + 14, 16 + 14, tlW - 28, 14, T.colors.accentHp, { scrollFactor: 0, depth: 50 });
    this.expMeter = T.meter(this, 16 + 14, 16 + 36, tlW - 28, 8, T.colors.accentGood, { scrollFactor: 0, depth: 50 });
    this.levelText = this.add.text(16 + 14, 16 + 48, 'Lv.1', {
      fontFamily: 'Arial Black', fontSize: '12px', color: T.text.secondary
    }).setScrollFactor(0).setDepth(51);

    // ---- Top-center: run timer, as a small pill instead of bare text floating on the world ----
    const timerPanel = T.panel(this, w / 2, 16, 100, 34, 0.5, 0, { scrollFactor: 0, depth: 49, radius: 17 });
    this.timerText = this.add.text(w / 2, 16 + 17, '15:00', {
      fontFamily: 'Arial Black', fontSize: '18px', color: T.text.primary
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);

    // ---- Top-right: pause button gets its own clear spot, info card sits below it (was
    // overlapping before - both anchored to nearly the same y). ----
    this.mobilePauseBtn = this.add.text(w - 16, 16, '⏸', {
      fontFamily: 'Arial', fontSize: '18px', color: T.text.primary,
      backgroundColor: '#11161dcc', padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(151).setInteractive({ useHandCursor: true });
    this.mobilePauseBtn.on('pointerover', () => this.mobilePauseBtn.setBackgroundColor('#1c2530ee'));
    this.mobilePauseBtn.on('pointerout', () => this.mobilePauseBtn.setBackgroundColor('#11161dcc'));
    this.mobilePauseBtn.on('pointerdown', () => {
      if (this.buildOverviewOpen) { this.hideBuildOverview(); return; }
      if (this.isPaused || this.matchEnded) return;
      this.togglePause();
    });

    const trW = 220, trH = 62, trY = 56;
    T.panel(this, w - 16, trY, trW, trH, 1, 0, { scrollFactor: 0, depth: 49 });
    this.killText = this.add.text(w - 16 - 14, trY + 10, '처치 0', {
      fontFamily: 'Arial', fontSize: '12px', color: T.text.secondary
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    this.speciesText = this.add.text(w - 16 - 14, trY + 28, this.build.species.name, {
      fontFamily: 'Arial Black', fontSize: '13px', color: T.text.gold
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    // Build Summary (spec section 54): a compact, always-visible readout of the build's current
    // "identity" (top mastered type(s) + level) - not the whole TAB overview, just the headline.
    this.buildSummaryText = this.add.text(w - 16 - 14, trY + 46, '', {
      fontFamily: 'Arial', fontSize: '11px', color: T.text.blue
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);

    this.muteText = this.add.text(20, this.cameras.main.height - 20, '🔊 M: 음소거', {
      fontFamily: 'Arial', fontSize: '11px', color: T.text.muted
    }).setOrigin(0, 1).setScrollFactor(0).setDepth(51);

    // Prominent top-of-screen HP bar(s) for miniboss/boss fights (separate from the small
    // floating bar every enemy already has, which is easy to lose track of against a boss's
    // huge HP pool or when it scrolls off-camera). Keyed by enemy instance; supports the rare
    // case of a miniboss still alive when the final boss spawns (both bars stack).
    this.bossBars = new Map();

    this.buildStatPanel();
  }

  // Spec section 7/30 (우측 상단 플레이어 스탯 표시): a compact, always-visible panel with the
  // full stat readout (HP/공격/방어/특공/특방/스피드), current ability, current type(s) and the
  // owned move list with level/damage/cooldown - not just the TAB build overview, which requires
  // an extra keypress to see. Collapsible via a toggle button so it stays out of the way on a
  // small (mobile) screen; expanded by default on a normal desktop view.
  buildStatPanel() {
    const w = this.cameras.main.width;
    const T = PS.UITheme;
    const rightX = w - 16 - 14; // inner-right text edge, matching the top-right card's padding
    const panelRight = w - 16;
    const panelW = 240;
    const topY = 128; // clear of the top-right info card (ends at y=118)

    this.statPanelExpanded = true;
    this.statPanelLines = [];

    this.statPanelToggle = this.add.text(panelRight, topY, '▼ 상세정보 접기', {
      fontFamily: 'Arial Black', fontSize: '11px', color: T.text.blue,
      backgroundColor: '#11161dcc', padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(51).setInteractive({ useHandCursor: true });
    this.statPanelToggle.on('pointerover', () => this.statPanelToggle.setColor('#ffffff'));
    this.statPanelToggle.on('pointerout', () => this.statPanelToggle.setColor(T.text.blue));
    this.statPanelToggle.on('pointerdown', () => {
      this.statPanelExpanded = !this.statPanelExpanded;
      this.statPanelToggle.setText(this.statPanelExpanded ? '▼ 상세정보 접기' : '▲ 상세정보 보기');
      // updateStatPanel() (not a blanket setVisible here) so an empty move slot stays hidden
      // even while expanded, instead of popping back in as an empty background box.
      this.updateStatPanel();
    });

    // ONE shared card behind every line below, instead of each line carrying its own
    // backgroundColor - that used to stack a ragged column of differently-sized bars (each
    // auto-sized to its own text) rather than reading as a single panel.
    const panelY = topY + 32;
    const panelH = 220;
    this.statPanelBg = T.panel(this, panelRight, panelY, panelW, panelH, 1, 0, { scrollFactor: 0, depth: 49 });

    const innerTop = panelY + 12;
    const mkLine = (y, size, color) => {
      const t = this.add.text(rightX, y, '', {
        fontFamily: 'Arial', fontSize: size || '11px', color: color || T.text.primary, align: 'right'
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
      this.statPanelLines.push(t);
      return t;
    };

    this.statTypeLine = mkLine(innerTop, '11px', T.text.blue);
    this.statAbilityLine = mkLine(innerTop + 18, '11px', '#ffd98a');
    this.statLine1 = mkLine(innerTop + 40, '11px', T.text.primary);
    this.statLine2 = mkLine(innerTop + 58, '11px', T.text.primary);
    this.statMovesHeaderLine = mkLine(innerTop + 80, '11px', T.text.good);
    // Fixed pool of move-row slots (updated in place, not recreated every frame - a build rarely
    // has more than a handful of moves at once, so 6 comfortably covers it).
    this.statMoveLines = [];
    for (let i = 0; i < 6; i++) {
      this.statMoveLines.push(mkLine(innerTop + 98 + i * 16, '10px', '#cfeeff'));
    }
  }

  updateStatPanel() {
    for (const line of this.statPanelLines) line.setVisible(this.statPanelExpanded);
    this.statPanelBg.setVisible(this.statPanelExpanded);
    if (!this.statPanelExpanded) return;
    const build = this.build;
    const species = build.species;
    const gs = build.gameStats;
    const modMult = (statKey) => build.getStatMultiplier ? build.getStatMultiplier(statKey) : 1;

    this.statTypeLine.setText(`타입: ${species.types.map(PS.typeNameKo).join(' / ')}`);

    const abilityIds = Object.keys(build.abilities || {});
    const abilityLabel = abilityIds.length
      ? abilityIds.map(id => `${this.managers.ability.getAbility(id).name} Lv${build.getAbilityLevel(id)}`).join(', ')
      : '(없음)';
    this.statAbilityLine.setText(`특성: ${abilityLabel}`);

    const hp = build.getMaxHp ? build.getMaxHp() : Math.round(gs.maxHp);
    const atk = Math.round(gs.physicalPower * modMult('attack'));
    const def = Math.round(gs.physicalReduction * modMult('defense'));
    const spa = Math.round(gs.specialPower * modMult('spAttack'));
    const spd = Math.round(gs.specialReduction * modMult('spDefense'));
    const spe = Math.round(build.getMoveSpeed ? build.getMoveSpeed() : gs.moveSpeed);
    this.statLine1.setText(`HP ${hp} · 공격 ${atk} · 방어 ${def}`);
    this.statLine2.setText(`특공 ${spa} · 특방 ${spd} · 스피드 ${spe}`);

    this.statMovesHeaderLine.setText('보유 기술 (레벨/피해/쿨다운)');
    const ownedMoveIds = build.getOwnedMoveIds ? build.getOwnedMoveIds() : Object.keys(build.moves || {});
    for (let i = 0; i < this.statMoveLines.length; i++) {
      const line = this.statMoveLines[i];
      const moveId = ownedMoveIds[i];
      if (!moveId) { line.setText(''); line.setVisible(false); continue; }
      const move = this.managers.move.getMove(moveId);
      const level = build.getMoveLevel(moveId);
      const dmg = Math.round((move.baseDamage || 0) * (1 + (level - 1) * 0.25));
      line.setText(`${move.name} Lv${level} · 피해${dmg} · ${move.cooldownMs}ms`);
      line.setVisible(true);
    }
  }

  // ================= Boss/miniboss top-screen HP bar =================
  addBossHpBar(enemy) {
    const w = this.cameras.main.width;
    const barW = 360;
    const slot = this.bossBars.size;
    const y = 116 + slot * 34;
    const nameText = this.add.text(w / 2, y - 13, enemy.species.name, {
      fontFamily: 'Arial Black', fontSize: '12px', color: '#ffffff', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    const bg = this.add.rectangle(w / 2, y, barW, 14, 0x220000, 0.85).setScrollFactor(0).setDepth(50);
    const fg = this.add.rectangle(w / 2 - barW / 2, y, barW, 10, enemy.tier === 'boss' ? 0xff3b3b : 0xff9d3b, 1)
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(51);
    this.bossBars.set(enemy, { bg, fg, nameText, barW });
  }

  updateBossHpBars() {
    for (const [enemy, bar] of this.bossBars) {
      if (!enemy.active || enemy.hp <= 0) {
        bar.bg.destroy(); bar.fg.destroy(); bar.nameText.destroy();
        this.bossBars.delete(enemy);
        continue;
      }
      // Boss multi-phase transitions (spec: 3페이즈 이상) - data-driven via balance.json's
      // bossPhases array, applied in order as HP crosses each descending threshold. A boss can
      // have as many phases as the data defines; nothing here is hardcoded to exactly one.
      if (enemy.tier === 'boss') {
        const phases = this.data_.balance.bossPhases || [];
        const hpRatio = enemy.hp / enemy.maxHp;
        for (let i = 0; i < phases.length; i++) {
          if (enemy.phaseIndex <= i && hpRatio <= phases[i].threshold) {
            enemy.applyBossPhase(phases[i], i + 1);
            this.triggerBossPhaseFeedback(enemy, phases[i].label || `${i + 2}페이즈`);
          }
        }
      }
      bar.fg.width = Math.max(0, bar.barW * (enemy.hp / enemy.maxHp));
    }
    // re-stack remaining bars so there's never a gap if one was removed
    let i = 0;
    for (const [, bar] of this.bossBars) {
      const y = 116 + i * 34;
      bar.nameText.setY(y - 13);
      bar.bg.setY(y);
      bar.fg.setY(y);
      i++;
    }
  }

  updateHud() {
    PS.UITheme.setMeterFill(this.hpMeter, this.player.getHpRatio());
    const expNeeded = this.levelSystem.expForLevel(this.build.level);
    PS.UITheme.setMeterFill(this.expMeter, PS.MathUtils.clamp(this.build.exp / expNeeded, 0, 1));
    this.levelText.setText(`Lv.${this.build.level}`);
    this.timerText.setText(this.waveSystem.getTimeRemainingLabel(this.runTimeSec));
    this.killText.setText(`처치 ${this.build.kills}`);
    this.speciesText.setText(`${this.build.species.name} Lv.${this.build.level}`);
    this.buildSummaryText.setText(this.getBuildSummaryLabel());
    this.updateStatPanel();
  }

  /** Top 1-2 mastered types + their levels, e.g. "⚡전기 Lv.3 · 🔥불꽃 Lv.1" - see buildHud(). */
  getBuildSummaryLabel() {
    const typeIcons = { electric: '⚡', fire: '🔥', water: '💧', grass: '🌿', poison: '☠️', normal: '⚪', fighting: '🥊', ghost: '👻', ice: '❄️' };
    const entries = Object.keys(this.build.typeMasteryXp || {})
      .map(t => ({ type: t, level: this.build.getTypeMasteryLevel(t) }))
      .filter(e => e.level > 0)
      .sort((a, b) => b.level - a.level)
      .slice(0, 2);
    if (entries.length === 0) return '';
    return entries.map(e => `${typeIcons[e.type] || ''}${PS.typeNameKo(e.type)} Lv.${e.level}`).join(' · ');
  }

  // ================= Pause + build overview (ESC / TAB) =================
  setupPauseAndBuildOverview() {
    this.manualPaused = false;
    this.buildOverviewOpen = false;

    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => {
      if (this.buildOverviewOpen) { this.hideBuildOverview(); return; }
      if (this.isPaused || this.matchEnded) return; // a LevelUp/Evolution overlay owns the pause
      this.togglePause();
    });
    kb.on('keydown-TAB', (e) => {
      e.preventDefault?.();
      // Check "already open" first: showBuildOverview() sets isPaused=true as its pause
      // mechanism, so a naive guard on isPaused would also block the close on the 2nd press.
      if (this.buildOverviewOpen) { this.hideBuildOverview(); return; }
      if (this.manualPaused || this.isPaused || this.matchEnded) return;
      this.showBuildOverview();
    });
    kb.on('keydown-M', () => {
      const muted = this.audio.toggleMuted();
      this.muteText.setText(muted ? '🔇 M: 음소거 해제' : '🔊 M: 음소거');
    });

    // NOTE: these HUD overlays are deliberately built as plain scene objects (each with its own
    // setScrollFactor(0)), not Phaser Containers - Container children combined with
    // scrollFactor(0) hit-test incorrectly once the camera has scrolled away from (0,0) (which
    // it always has here, since the camera follows the player through a large world), so a
    // Container-nested interactive button never receives real pointer clicks even though it
    // renders in the right screen position. Grouping is done with plain arrays instead.
    const w = this.cameras.main.width, h = this.cameras.main.height;
    const T = PS.UITheme;
    this.pauseOverlayObjects = [];
    const addToPause = (obj) => { obj.setScrollFactor(0).setDepth(200); this.pauseOverlayObjects.push(obj); return obj; };
    addToPause(this.add.rectangle(0, 0, w, h, 0x000000, 0.7).setOrigin(0));

    // One card behind the title + buttons instead of the title floating loose on the dim
    // background - matches the panel/border look the HUD now uses everywhere else.
    const cardW = 280, cardH = 210, cardY = h / 2 - 20;
    addToPause(T.panel(this, w / 2, cardY, cardW, cardH, 0.5, 0.5, { radius: 14 }));
    addToPause(this.add.text(w / 2, cardY - cardH / 2 + 36, '일시정지', {
      fontFamily: 'Arial Black', fontSize: '26px', color: T.text.primary
    }).setOrigin(0.5));

    const mkBtn = (y, label, onClick, color) => {
      const btn = this.add.text(w / 2, y, label, {
        fontFamily: 'Arial Black', fontSize: '15px', color: color || T.text.blue,
        backgroundColor: '#1c2530ee', padding: { left: 20, right: 20, top: 9, bottom: 9 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffffff'));
      btn.on('pointerout', () => btn.setColor(color || T.text.blue));
      btn.on('pointerdown', onClick);
      addToPause(btn);
      return btn;
    };

    // Spec section 1: 계속하기/현재 빌드/메인으로, all reachable by touch (no keyboard needed) so
    // mobile players without ESC/TAB keys can still resume, check their build, or quit to menu.
    mkBtn(cardY - 6, '계속하기', () => this.togglePause(), T.text.good);
    mkBtn(cardY + 42, '현재 빌드', () => { this.togglePause(); this.showBuildOverview(); });
    mkBtn(cardY + 88, '메인으로', () => {
      this.audio.playUnpause();
      this.scene.stop('LevelUp');
      this.scene.start('Menu');
    }, '#ff8888');

    this.setPauseOverlayVisible(false);
    this.buildOverviewObjects = [];
    // Spec section 1 (모바일 pause 버튼): the always-visible on-screen pause icon itself is built
    // in buildHud() now (it lives in the same top-right HUD cluster it needs to not overlap).
  }

  setPauseOverlayVisible(visible) {
    for (const obj of this.pauseOverlayObjects) obj.setVisible(visible);
  }

  togglePause() {
    this.manualPaused = !this.manualPaused;
    this.setPauseOverlayVisible(this.manualPaused);
    if (this.manualPaused) this.audio.playPause(); else this.audio.playUnpause();
  }

  showBuildOverview() {
    this.buildOverviewOpen = true;
    // Same Container-vs-scrollFactor(0)-vs-scrolled-camera input issue as the pause overlay
    // (see setupPauseAndBuildOverview's comment) - this tiny shim keeps the c.add(...)/
    // c.setVisible(...) call shape below unchanged while actually tracking plain scene objects
    // instead of Container children, so the "✕ 닫기" button's real pointer clicks land on it.
    for (const obj of this.buildOverviewObjects) obj.destroy();
    this.buildOverviewObjects = [];
    const c = {
      add: (obj) => { obj.setScrollFactor(0).setDepth(200); this.buildOverviewObjects.push(obj); return obj; },
      setVisible: (v) => { for (const obj of this.buildOverviewObjects) obj.setVisible(v); }
    };
    const w = this.cameras.main.width, h = this.cameras.main.height;
    const T = PS.UITheme;
    c.add(this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0));
    c.add(T.panel(this, w / 2, 12, w - 24, 40, 0.5, 0, { radius: 10 }));
    c.add(this.add.text(w / 2, 32, `현재 빌드 - ${this.build.species.name} Lv.${this.build.level}`, {
      fontFamily: 'Arial Black', fontSize: '18px', color: T.text.gold
    }).setOrigin(0.5));

    const col1X = 40, col2X = w / 2 + 20;
    let y1 = 70, y2 = 70;

    c.add(this.add.text(col1X, y1, '보유 기술', { fontFamily: 'Arial Black', fontSize: '14px', color: '#62ffb0' }));
    y1 += 22;
    for (const moveId of this.build.getOwnedMoveIds()) {
      const move = this.managers.move.getMove(moveId);
      const level = this.build.getMoveLevel(moveId);
      const stab = this.build.species.types.includes(move.type) ? ' (STAB)' : '';
      c.add(this.add.text(col1X, y1, `${move.name} Lv${level} - ${PS.typeNameKo(move.type)}${stab} · ${PS.patternNameKo(move.pattern)}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
      }));
      y1 += 20;
    }

    y1 += 14;
    c.add(this.add.text(col1X, y1, '보유 특성', { fontFamily: 'Arial Black', fontSize: '14px', color: '#62ffb0' }));
    y1 += 22;
    const abilityIds = Object.keys(this.build.abilities);
    if (abilityIds.length === 0) c.add(this.add.text(col1X, y1, '(없음)', { fontFamily: 'Arial', fontSize: '12px', color: '#888888' }));
    for (const id of abilityIds) {
      const ability = this.managers.ability.getAbility(id);
      const abilityText = this.add.text(col1X, y1, `${ability.name} Lv${this.build.getAbilityLevel(id)} - ${ability.description}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffffff', wordWrap: { width: w / 2 - 60 }
      });
      c.add(abilityText);
      y1 += abilityText.height + 6; // measured height, not an estimate - avoids overlap on wrapped lines
    }

    c.add(this.add.text(col2X, y2, '보유 아이템', { fontFamily: 'Arial Black', fontSize: '14px', color: '#62ffb0' }));
    y2 += 22;
    const itemIds = Object.keys(this.build.items);
    if (itemIds.length === 0) c.add(this.add.text(col2X, y2, '(없음)', { fontFamily: 'Arial', fontSize: '12px', color: '#888888' }));
    for (const id of itemIds) {
      const item = this.managers.item.getItem(id);
      c.add(this.add.text(col2X, y2, `${item.name} Lv${this.build.getItemLevel(id)}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
      }));
      y2 += 20;
    }

    y2 += 14;
    c.add(this.add.text(col2X, y2, '능력치 강화', { fontFamily: 'Arial Black', fontSize: '14px', color: '#62ffb0' }));
    y2 += 22;
    const statLabels = { hp: 'HP', attack: '공격', defense: '방어', spAttack: '특수공격', spDefense: '특수방어', speed: '스피드' };
    for (const [statId, picks] of Object.entries(this.build.statPicks || {})) {
      if (picks > 0) {
        c.add(this.add.text(col2X, y2, `${statLabels[statId] || statId} ${picks}회 강화`, {
          fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
        }));
        y2 += 20;
      }
    }

    y2 += 14;
    c.add(this.add.text(col2X, y2, '타입 숙련도', { fontFamily: 'Arial Black', fontSize: '14px', color: '#8fd3ff' }));
    y2 += 22;
    const masteredTypes = Object.keys(this.build.typeMasteryXp || {})
      .filter(t => (this.build.typeMasteryXp[t] || 0) > 0)
      .sort((a, b) => this.build.getTypeMasteryLevel(b) - this.build.getTypeMasteryLevel(a));
    if (masteredTypes.length === 0) c.add(this.add.text(col2X, y2, '(아직 없음 - 기술로 적을 맞히면 자동으로 쌓입니다)', { fontFamily: 'Arial', fontSize: '11px', color: '#888888', wordWrap: { width: w / 2 - 60 } }));
    for (const typeId of masteredTypes) {
      const level = this.build.getTypeMasteryLevel(typeId);
      const xp = this.build.typeMasteryXp[typeId];
      const next = this.managers.typeMastery.xpForNextLevel(level);
      const progress = next ? ` (${xp}/${next})` : ' (MAX)';
      const cfg = this.managers.typeMastery.getTypeConfig(typeId);
      const unlocked = [];
      for (let l = 1; l <= level; l++) if (cfg.levels[l]) unlocked.push(cfg.levels[l].label);
      const masteryText = this.add.text(col2X, y2, `${PS.typeNameKo(typeId)} Lv${level}${progress}\n${unlocked.join(' · ')}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#c8e8ff', wordWrap: { width: w / 2 - 60 }
      });
      c.add(masteryText);
      y2 += masteryText.height + 6;
    }

    y1 += 14;
    c.add(this.add.text(col1X, y1, '보유 유물', { fontFamily: 'Arial Black', fontSize: '14px', color: '#ffb300' }));
    y1 += 22;
    const relicIds = Object.keys(this.build.relics || {});
    if (relicIds.length === 0) c.add(this.add.text(col1X, y1, '(없음)', { fontFamily: 'Arial', fontSize: '12px', color: '#888888' }));
    for (const id of relicIds) {
      const relic = this.managers.relic.getRelic(id);
      const relicText = this.add.text(col1X, y1, `${relic.name} Lv${this.build.getRelicLevel(id)} - ${relic.description}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffd98a', wordWrap: { width: w / 2 - 60 }
      });
      c.add(relicText);
      y1 += relicText.height + 6; // measured height, not an estimate - avoids overlap on wrapped lines
    }

    c.add(this.add.text(w / 2, h - 30, 'TAB 키를 눌러 닫기', {
      fontFamily: 'Arial', fontSize: '13px', color: '#aaaaaa'
    }).setOrigin(0.5));

    // Touch-friendly close button (TAB has no equivalent on a phone).
    const closeBtn = this.add.text(w - 20, 20, '✕ 닫기', {
      fontFamily: 'Arial Black', fontSize: '14px', color: '#ffffff',
      backgroundColor: '#3a2020', padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => this.hideBuildOverview());
    c.add(closeBtn);

    c.setVisible(true);
    this.isPaused = true; // reuse the existing pause gate so combat truly freezes while reading
  }

  hideBuildOverview() {
    this.buildOverviewOpen = false;
    for (const obj of this.buildOverviewObjects) obj.setVisible(false);
    this.isPaused = false;
  }

  // ================= Low HP warning vignette =================
  buildLowHpVignette() {
    const w = this.cameras.main.width, h = this.cameras.main.height;
    this.lowHpVignette = this.add.rectangle(0, 0, w, h, 0xff0000, 0).setOrigin(0).setScrollFactor(0).setDepth(90);
  }

  updateLowHpVignette(time) {
    const ratio = this.player.getHpRatio();
    if (ratio <= 0.25) {
      // Heartbeat-style pulse that quickens as HP gets lower, so it reads as urgency,
      // not just a static red screen edge.
      const speed = 4 + (0.25 - ratio) * 40;
      const pulse = (Math.sin(time * 0.008 * speed) + 1) / 2;
      this.lowHpVignette.setAlpha(0.12 + pulse * 0.18);
    } else {
      this.lowHpVignette.setAlpha(0);
    }
  }

  // ================= Attack range indicators =================
  // Faint, always-on rings around the player showing each owned move's actual reach, so
  // "how far does this projectile/melee move actually go" is answered visually instead of
  // by trial and error (playtesting feedback: range was hard to judge from projectiles alone).
  updateRangeRings() {
    const g = this.rangeRingGfx;
    g.clear();
    const seen = new Set();
    for (const moveId of this.build.getOwnedMoveIds()) {
      const move = this.managers.move.getMove(moveId);
      if (!move) continue;
      const isAreaPattern = move.pattern === 'circle' || move.pattern === 'orbit' || move.pattern === 'aura';
      const radius = isAreaPattern ? this.getEffectiveAreaRadius(move, 150) : this.getEffectiveRange(move);
      const key = Math.round(radius / 4); // dedupe near-identical radii so rings don't overdraw
      if (!radius || seen.has(key)) continue;
      seen.add(key);
      const def = this.data_.vfx.types[move.type] || this.data_.vfx.types.normal;
      g.lineStyle(1.5, this.assets.hexToInt(def.color), 0.16);
      g.strokeCircle(this.player.x, this.player.y, radius);
    }
  }

  // ================= Update loop =================
  update(time, deltaMs) {
    // Spec section 1 (일시정지 기능): the early-return below already freezes everything inside
    // this function (player/enemy movement, spawning, the game timer, move cooldowns via
    // Player/Move update, map hazards, exp/levelup checks...). But several effects are driven
    // by Phaser's own Clock (this.time.delayedCall) - status-effect DOT ticks scheduled from
    // CombatSystem, boss attack telegraphs, map hazard tick callbacks, pickup expiry timers -
    // and Phaser's Clock keeps advancing those on its own regardless of this function's early
    // return. Syncing this.time.paused (and pausing tweens) to the same pause flags here, every
    // frame, is what actually stops those too instead of leaving them ticking in real time while
    // the screen is frozen.
    const shouldPauseTime = this.isPaused || this.manualPaused || this.matchEnded;
    if (this.time.paused !== shouldPauseTime) {
      this.time.paused = shouldPauseTime;
      if (shouldPauseTime) this.tweens.pauseAll(); else this.tweens.resumeAll();
    }
    if (shouldPauseTime) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    this.runTimeSec += dt;

    const input = {
      left: this.cursors.left.isDown || this.wasd.A.isDown,
      right: this.cursors.right.isDown || this.wasd.D.isDown,
      up: this.cursors.up.isDown || this.wasd.W.isDown,
      down: this.cursors.down.isDown || this.wasd.S.isDown
    };

    this.player.update(dt, input, this.statusFx, this.managers.move, (player, move) => this.performPlayerAttack(player, move));

    this.enemyPool.forEachActive(enemy => {
      enemy.update(dt, this.player.x, this.player.y, this.statusFx,
        (ent, amount) => this.applyEnemyDot(ent, amount),
        (ent, move) => this.performEnemyAttack(ent, move));
    });

    this.playerProjectilePool.forEachActive(p => p.update(dt, (x, y, excludeSet) => this.findNearestEnemy(x, y, excludeSet)));
    this.enemyProjectilePool.forEachActive(p => p.update(dt, () => null));

    const pickupRadius = this.data_.balance.player.pickupRadius * this.build.modifiers.pickupRadiusMult;
    this.gemPool.forEachActive(g => g.update(dt, this.player.x, this.player.y, pickupRadius));

    this.spawnSystem.update(deltaMs, this.runTimeSec, this.player.x, this.player.y, this.enemyPool.activeCount);
    this.updatePickups(deltaMs);
    this.updateRelicPickups(deltaMs);

    this.checkLevelUps();
    this.checkEvolution();
    this.checkMoveEvolutions();
    this.updateAuraAbilities(dt);
    this.updateOrbitVisuals(dt);
    this.updateSummons(dt);
    this.updateMapHazard(dt);
    this.updateHud();
    this.updateBossHpBars();
    this.updateLowHpVignette(time);
    this.updateRangeRings();

    if (this.player.isDead()) this.endMatch(false);
    if (this.waveSystem.isMatchOver(this.runTimeSec)) this.endMatch(true);
  }

  // Intimidate-style continuous auras: periodically refresh a debuff status on nearby enemies.
  updateAuraAbilities(dt) {
    this._auraTimer = (this._auraTimer || 0) + dt;
    const hooks = PS.AbilitySystem.find(this.build.modifiers, 'aura_debuff');
    if (hooks.length === 0) return;
    for (const hook of hooks) {
      const tick = hook.effect.tickSec || 1.0;
      hook._timer = (hook._timer || 0) + dt;
      if (hook._timer < tick) continue;
      hook._timer = 0;
      const radius = hook.effect.radius + (hook.effect.radiusPerLevel || 0) * (hook.level - 1);
      const targets = this.findEnemiesInRadius(this.player.x, this.player.y, radius);
      for (const t of targets) this.statusFx.tryApply(t, 'attackDown', 1.0);
    }
  }

  applyEnemyDot(enemy, amount) {
    // Leech Seed (Bulbasaur vertical slice, spec section 7 "Sustain"): while an enemy is
    // seeded, its DOT tick also heals the player - "지속 피해 → HP 회복" in one line.
    if (this.statusFx.has(enemy, 'seed')) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount * 0.6);
    }
    if (enemy.takeDamage(amount)) this.killEnemy(enemy, 'grass');
  }

  // ================= Targeting =================
  findNearestEnemy(x, y, excludeSet) {
    let best = null;
    let bestDist = Infinity;
    this.enemyPool.forEachActive(e => {
      if (excludeSet && excludeSet.has(e)) return;
      const d = PS.MathUtils.distanceSq(x, y, e.x, e.y);
      if (d < bestDist) { bestDist = d; best = e; }
    });
    return best;
  }

  findEnemiesInRadius(x, y, radius, innerRadius = 0) {
    const result = [];
    const rSq = radius * radius;
    const innerSq = innerRadius * innerRadius;
    this.enemyPool.forEachActive(e => {
      const d = PS.MathUtils.distanceSq(x, y, e.x, e.y);
      if (d <= rSq && d >= innerSq) result.push(e);
    });
    return result;
  }

  // ================= Player attack pattern resolution =================
  getEffectiveRange(move) {
    return (move.range || 300) * this.build.modifiers.rangeMult;
  }

  // Pattern-specific growth (spec: 패턴마다 다른 핵심 스탯이 성장) - data/balance.json's
  // patternGrowth table adds a small per-move-level bonus to ONE characteristic field per
  // pattern (chain gets more hops, beam gets wider, orbit gets more satellites, etc), on top
  // of CombatSystem's shared moveLevelDamageMult curve. A move/pattern with no matching entry
  // (or an old save/mod without this data) just keeps its flat base value - fully backward
  // compatible.
  getPatternScaledField(move, moveLevel, fieldKey, baseValue) {
    const growth = this.data_.balance.patternGrowth && this.data_.balance.patternGrowth[move.pattern];
    let value = baseValue;
    if (growth && growth.field === fieldKey) value += growth.perLevel * (moveLevel - 1);
    // Pattern-identity synergy items (data/items.json's pattern_field_bonus effect).
    const bonusKey = `${move.pattern}:${fieldKey}`;
    const bonus = this.build.modifiers.patternFieldBonus && this.build.modifiers.patternFieldBonus[bonusKey];
    if (bonus) value *= (1 + bonus);
    return value;
  }

  getEffectiveAreaRadius(move, fallback) {
    const moveLevel = this.build.getMoveLevel(move.id) || 1;
    const base = this.getPatternScaledField(move, moveLevel, 'areaRadius', move.areaRadius || fallback);
    return base * this.build.modifiers.rangeMult;
  }

  performPlayerAttack(player, move) {
    const nearest = this.findNearestEnemy(player.x, player.y, null);
    const aimAngle = nearest ? PS.MathUtils.angleBetween(player.x, player.y, nearest.x, nearest.y) : (player.lastFacingAngle || -Math.PI / 2);
    const hpRatio = player.getHpRatio();
    const range = this.getEffectiveRange(move);
    const moveLevel = this.build.getMoveLevel(move.id) || 1;

    switch (move.pattern) {
      case 'melee': {
        const meleeRange = (move.range || 70) * this.build.modifiers.rangeMult;
        const target = nearest && PS.MathUtils.distance(player.x, player.y, nearest.x, nearest.y) <= meleeRange ? nearest : null;
        if (target) this.applyPlayerHitToEnemy(move, target, hpRatio, player);
        this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(move.id), player.x + Math.cos(aimAngle) * 30, player.y + Math.sin(aimAngle) * 30, aimAngle);
        return true;
      }
      case 'projectile':
        this.firePlayerProjectile(move, player.x, player.y, aimAngle, 'straight', range);
        return true;
      case 'spread': {
        const count = Math.round(this.getPatternScaledField(move, moveLevel, 'count', move.count || 3));
        const spread = Phaser.Math.DegToRad(move.spreadAngle || 45);
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0 : (i / (count - 1)) - 0.5;
          this.firePlayerProjectile(move, player.x, player.y, aimAngle + t * spread, 'straight', range);
        }
        return true;
      }
      case 'chain':
        this.firePlayerProjectile(move, player.x, player.y, aimAngle, 'chain', range);
        this.vfx.playTypeVfx(move.type, moveLevel, player.x + Math.cos(aimAngle) * 30, player.y + Math.sin(aimAngle) * 30, aimAngle);
        return true;
      case 'homing':
        this.firePlayerProjectile(move, player.x, player.y, aimAngle, 'homing', range);
        return true;
      case 'boomerang':
        this.firePlayerProjectile(move, player.x, player.y, aimAngle, 'boomerang', range);
        return true;
      case 'circle': {
        const radius = this.getEffectiveAreaRadius(move, 150);
        const targets = this.findEnemiesInRadius(player.x, player.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        // 지진 (earthquake) gets a bespoke shockwave+ground-crack+camera-shake treatment (spec
        // section 14: "원형충격파+지면흔들림"); every other circle-pattern move is unaffected.
        if (!this.vfx.playMoveOverride(move.id, move.type, moveLevel, { x: player.x, y: player.y, radius })) {
          this.vfx.playCircleVfx(move.type, moveLevel, player.x, player.y, radius);
        }
        return true;
      }
      case 'orbit': {
        // Persistent rotating satellites (Fairy vertical slice, spec: Orbit+Aura+Shield+Homing).
        // Visual position/rotation is refreshed every frame by updateOrbitVisuals() below; this
        // cooldown-driven call is the DAMAGE TICK - it recomputes the same satellite positions
        // and hits anything currently overlapping one, so cooldownMs effectively sets the
        // pattern's hit-tick rate rather than a one-shot cast.
        const count = Math.max(1, Math.round(this.getPatternScaledField(move, moveLevel, 'count', move.count || 2)));
        const positions = this.computeOrbitPositions(move, player, count);
        const hitRadius = move.hitRadius || 30;
        const hitSet = new Set();
        for (const pos of positions) {
          for (const e of this.findEnemiesInRadius(pos.x, pos.y, hitRadius)) hitSet.add(e);
        }
        this.resolveAoe(move, Array.from(hitSet), hpRatio, player);
        this.ensureOrbitVisual(move, player, count);
        return true;
      }
      case 'strike': {
        const radius = this.getEffectiveAreaRadius(move, 80);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const targets = this.findEnemiesInRadius(point.x, point.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        // 백만볼트 (thunderbolt) gets a bespoke "lightning falling from above" look (spec section
        // 14); every other strike-pattern move keeps the existing generic circle burst untouched.
        if (!this.vfx.playMoveOverride(move.id, move.type, moveLevel, { x: point.x, y: point.y, radius })) {
          this.vfx.playCircleVfx(move.type, moveLevel, point.x, point.y, radius);
        }
        return true;
      }
      case 'explosion': {
        const radius = this.getEffectiveAreaRadius(move, 100);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const targets = this.findEnemiesInRadius(point.x, point.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        // 불대문자 (fire_blast) gets its signature 大/X-shaped burst (spec section 14); every
        // other explosion-pattern move (e.g. flash_cannon) keeps the existing generic circle burst.
        if (!this.vfx.playMoveOverride(move.id, move.type, moveLevel, { x: point.x, y: point.y, radius })) {
          this.vfx.playCircleVfx(move.type, moveLevel, point.x, point.y, radius);
        }
        return true;
      }
      case 'rain': {
        const radius = this.getEffectiveAreaRadius(move, 90);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), point.x, point.y, radius * 0.4);
        this.time.delayedCall(280, () => {
          const targets = this.findEnemiesInRadius(point.x, point.y, radius);
          this.resolveAoe(move, targets, hpRatio, player);
          this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), point.x, point.y, radius);
        });
        return true;
      }
      case 'beam': {
        const width = this.getPatternScaledField(move, moveLevel, 'beamWidth', move.beamWidth || 40);
        const ex = player.x + Math.cos(aimAngle) * range;
        const ey = player.y + Math.sin(aimAngle) * range;
        const targets = this.findEnemiesNearSegment(player.x, player.y, ex, ey, width / 2);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playBeam(move.type, moveLevel, player.x, player.y, ex, ey);
        return true;
      }
      case 'cone': {
        // Instant wide-arc hit in front of the player (design spec section 4: Flamethrower/
        // Water Pulse-style attacks). Unlike 'spread' (discrete projectiles), this resolves in
        // one frame against everything within range AND inside the facing angle.
        const coneRadius = range;
        const coneAngleDeg = this.getPatternScaledField(move, moveLevel, 'coneAngle', move.coneAngle || 70);
        const halfAngle = Phaser.Math.DegToRad(coneAngleDeg / 2);
        const targets = this.findEnemiesInRadius(player.x, player.y, coneRadius).filter(e => {
          const angToTarget = PS.MathUtils.angleBetween(player.x, player.y, e.x, e.y);
          let diff = angToTarget - aimAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // wrap to [-PI, PI]
          return Math.abs(diff) <= halfAngle;
        });
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(move.id), player.x + Math.cos(aimAngle) * (coneRadius * 0.5), player.y + Math.sin(aimAngle) * (coneRadius * 0.5), aimAngle);
        return true;
      }
      case 'dash': {
        // Player physically dashes toward the aim direction - 접근 -> 공격 -> 공간 확보 -> 탈출,
        // one full combat beat (design spec 2026-10-01 section 7), not just a movement tool:
        //
        // 1) Variable distance: a close target is approached, not blown past - the whole point of
        //    "dash INTO melee range" breaks if you overshoot a target standing right next to you.
        //    A target beyond `range` just gets the usual max-distance dash.
        // 2) Full-corridor damage along the path (already existed, kept as-is).
        // 3) A small shockwave at the landing point, on top of corridor hits (distinct targets
        //    only - no double-dipping the same enemy from both the corridor and the landing pulse).
        // 4) A short post-dash invulnerability window that SCALES with how many enemies were just
        //    hit, capped low - a melee build diving into a pack and immediately getting hit from
        //    five sides as it "lands" is the single biggest reason melee archetypes feel unplayable
        //    in a bullet-heaven; this buys just enough of a window to reposition, not a free pass.
        const nearestDist = nearest ? PS.MathUtils.distance(player.x, player.y, nearest.x, nearest.y) : Infinity;
        // Stop a hair short of the target's own position so the player doesn't dash fully on top
        // of (and visually overlap) the thing it just closed on.
        const dashDistance = Math.min(range, nearestDist > 0 ? Math.max(0, nearestDist - 12) : range);
        const targetX = player.x + Math.cos(aimAngle) * dashDistance;
        const targetY = player.y + Math.sin(aimAngle) * dashDistance;
        const corridorWidth = this.getPatternScaledField(move, moveLevel, 'beamWidth', move.beamWidth || 60);
        const corridorTargets = this.findEnemiesNearSegment(player.x, player.y, targetX, targetY, corridorWidth / 2);
        this.resolveAoe(move, corridorTargets, hpRatio, player);

        const hitSet = new Set(corridorTargets);
        const shockwaveRadius = this.getPatternScaledField(move, moveLevel, 'landingRadius', move.landingRadius || 80);
        const shockwaveTargets = this.findEnemiesInRadius(targetX, targetY, shockwaveRadius).filter(e => !hitSet.has(e));
        this.resolveAoe(move, shockwaveTargets, hpRatio, player);
        if (shockwaveTargets.length) this.vfx.playCircleVfx(move.type, moveLevel, targetX, targetY, shockwaveRadius);
        for (const t of shockwaveTargets) hitSet.add(t);

        // Knockback on every dash-hit enemy (spec recommendation #2/#3: separate the player from
        // the crowd it just dove into, not just damage it) - independent of whichever knockback
        // the move's own data.knockback field already grants on-hit via applyPlayerHitToEnemy.
        for (const t of hitSet) {
          const dir = PS.MathUtils.normalize(t.x - targetX, t.y - targetY);
          t.x += dir.x * 18;
          t.y += dir.y * 18;
        }

        const hitCount = hitSet.size;
        const invulnSec = hitCount >= 5 ? 0.45 : hitCount >= 3 ? 0.3 : hitCount >= 1 ? 0.15 : 0;
        if (invulnSec > 0) player.invulnTimer = Math.max(player.invulnTimer, invulnSec);

        this.vfx.playDashFx(move.type, moveLevel, player.x, player.y, targetX, targetY);
        // Purely additive per-move flourish on top of the dash trail+shockwave above (e.g.
        // karate_chop's signature chop-arc slash, spec section 14) - a no-op for any dash move
        // without a registered override (aqua_jet, dragon_rush keep their current look exactly).
        this.vfx.playMoveOverride(move.id, move.type, moveLevel, { x: targetX, y: targetY, angle: aimAngle });
        this.tweens.add({ targets: player, x: targetX, y: targetY, duration: 160, ease: 'Cubic.easeOut' });
        return true;
      }
      case 'aura': {
        // Continuous damage pulse centered on the player (Fairy vertical slice). Like 'circle'
        // but meant to be owned alongside Orbit/Homing as a short-cooldown "always ticking"
        // layer rather than a single burst - cooldownMs is deliberately short in moves.json.
        const radius = this.getEffectiveAreaRadius(move, 130);
        const targets = this.findEnemiesInRadius(player.x, player.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playAuraFx(move.type, moveLevel, player.x, player.y, radius);
        return true;
      }
      case 'ground_zone': {
        // Telegraphed AoE that lands after a short delay and then lingers, ticking damage for
        // a few seconds (spec: Ground/Poison "장판" pattern) - distinct from 'rain' (single
        // delayed burst, no lingering zone).
        const radius = this.getEffectiveAreaRadius(move, 95);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const telegraphMs = move.telegraphMs || 550;
        const tickMs = move.tickMs || 600;
        const durationSec = move.durationSec || 3;
        this.vfx.playCircleVfx(move.type, 1, point.x, point.y, radius * 0.5);
        this.time.delayedCall(telegraphMs, () => {
          if (this.matchEnded) return;
          this.vfx.playGroundZoneFx(move.type, moveLevel, point.x, point.y, radius, durationSec * 1000);
          const ticks = Math.max(1, Math.round((durationSec * 1000) / tickMs));
          for (let i = 0; i < ticks; i++) {
            this.time.delayedCall(i * tickMs, () => {
              if (this.matchEnded) return;
              const targets = this.findEnemiesInRadius(point.x, point.y, radius);
              this.resolveAoe(move, targets, hpRatio, player);
            });
          }
        });
        return true;
      }
      case 'caltrop': {
        // 압정/장애물 (design spec section 6): unlike 'ground_zone' (telegraphed, anchored on the
        // nearest enemy, one zone at a time), a caltrop drops INSTANTLY at the player's CURRENT
        // position with no telegraph, and nothing stops several from coexisting - every cast just
        // starts its own independent tick loop, so on a short-ish cooldown the player leaves a
        // trail of lingering hazard zones behind them (Poison's 맹독압정). Reuses the exact same
        // lingering-AoE-tick machinery as 'ground_zone' below, just anchored differently.
        const point = { x: player.x, y: player.y };
        const radius = this.getEffectiveAreaRadius(move, 90);
        const tickMs = move.tickMs || 700;
        const durationSec = move.durationSec || 5;
        this.vfx.playGroundZoneFx(move.type, moveLevel, point.x, point.y, radius, durationSec * 1000);
        const ticks = Math.max(1, Math.round((durationSec * 1000) / tickMs));
        for (let i = 0; i < ticks; i++) {
          this.time.delayedCall(i * tickMs, () => {
            if (this.matchEnded) return;
            const targets = this.findEnemiesInRadius(point.x, point.y, radius);
            this.resolveAoe(move, targets, hpRatio, player);
          });
        }
        return true;
      }
      case 'summon': {
        // Temporary ally "turret" (spec: Summon pattern) - stays at the cast point and
        // periodically damages the nearest enemy within its own radius, then despawns. A
        // lightweight simplification of a full summoned-minion AI, consistent with this
        // prototype's other simplifications (see README section 12).
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const radius = this.getPatternScaledField(move, moveLevel, 'summonRadius', move.summonRadius || 170);
        const sprite = this.add.sprite(point.x, point.y, this.vfx.getTexture(move.type)).setDisplaySize(26, 26).setDepth(8);
        const vfxDef = this.data_.vfx.types[move.type] || this.data_.vfx.types.normal;
        sprite.setTint(this.assets.hexToInt(vfxDef.color));
        this.activeSummons.push({
          sprite, move, radius, hpRatio, attackerEntity: player,
          tickMs: move.tickMs || 700, timer: 0,
          remainingMs: (move.durationSec || 6) * 1000
        });
        this.vfx.playCircleVfx(move.type, moveLevel, point.x, point.y, radius * 0.3);
        return true;
      }
      case 'counter':
        // Purely reactive - see Player.js (excluded from the proactive auto-fire loop) and
        // applyEnemyHitToPlayer (actually triggers the counter-hit). Nothing to do on its own
        // "cooldown" tick.
        return true;
      default:
        return true;
    }
  }

  // ================= Orbit pattern (persistent rotating satellites) =================
  computeOrbitPositions(move, player, count) {
    const radius = this.getEffectiveAreaRadius(move, 140);
    const speed = move.orbitSpeed || 2.2;
    const baseAngle = (this.time.now / 1000) * speed;
    const positions = [];
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (i / count) * Math.PI * 2;
      positions.push({ x: player.x + Math.cos(angle) * radius, y: player.y + Math.sin(angle) * radius });
    }
    return positions;
  }

  ensureOrbitVisual(move, player, count) {
    let state = this.orbitVisuals[move.id];
    if (state && state.sprites.length === count) return;
    if (state) {
      for (const s of state.sprites) s.destroy();
      if (state.tween) state.tween.stop();
    }
    const vfxDef = this.data_.vfx.types[move.type] || this.data_.vfx.types.normal;
    // 문포스/달빛의구슬 (moonlight_orb) gets a signature pale glowing-moon satellite look (spec
    // section 14: "문포스=달빛구체+폭발") instead of the plain type-tinted dot every other orbit
    // move (fairy's base orbit mechanic) uses - additive-only, keyed off this one move id.
    const isMoonOrb = move.id === 'moonlight_orb';
    const sprites = [];
    for (let i = 0; i < count; i++) {
      const size = isMoonOrb ? 24 : 16;
      const s = this.add.sprite(player.x, player.y, this.vfx.getTexture(move.type)).setDisplaySize(size, size).setDepth(9);
      if (isMoonOrb) {
        s.setTint(0xf5f3ff);
        s.setBlendMode(Phaser.BlendModes.ADD);
      } else {
        s.setTint(this.assets.hexToInt(vfxDef.color));
      }
      sprites.push(s);
    }
    let tween = null;
    if (isMoonOrb) {
      tween = this.tweens.add({ targets: sprites, scale: 1.25, alpha: 0.75, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.orbitVisuals[move.id] = { sprites, tween };
  }

  updateOrbitVisuals() {
    for (const moveId of Object.keys(this.orbitVisuals)) {
      const state = this.orbitVisuals[moveId];
      const stillOwned = this.build.getOwnedMoveIds().includes(moveId);
      if (!stillOwned) {
        for (const s of state.sprites) s.destroy();
        if (state.tween) state.tween.stop();
        delete this.orbitVisuals[moveId];
        continue;
      }
      const move = this.managers.move.getMove(moveId);
      if (!move) continue;
      const positions = this.computeOrbitPositions(move, this.player, state.sprites.length);
      state.sprites.forEach((sprite, i) => {
        if (positions[i]) sprite.setPosition(positions[i].x, positions[i].y);
      });
    }
  }

  // ================= Summon pattern (temporary turret) =================
  updateSummons(dt) {
    for (let i = this.activeSummons.length - 1; i >= 0; i--) {
      const s = this.activeSummons[i];
      s.remainingMs -= dt * 1000;
      s.timer -= dt * 1000;
      if (s.remainingMs <= 0) {
        s.sprite.destroy();
        this.activeSummons.splice(i, 1);
        continue;
      }
      if (s.timer <= 0) {
        s.timer = s.tickMs;
        const targets = this.findEnemiesInRadius(s.sprite.x, s.sprite.y, s.radius);
        if (targets.length > 0) {
          this.resolveAoe(s.move, [targets[0]], s.hpRatio, s.attackerEntity);
          this.vfx.playSwarmFx(s.move.type, 1, s.sprite.x, s.sprite.y, targets[0].x, targets[0].y);
        }
      }
    }
  }

  // ================= Map-specific environmental hazard (spec: 맵별 고유 기믹) =================
  // Generic, data-driven via data/maps.json's `hazard` field - the SAME code handles every map,
  // only the type/numbers differ. Currently 3 generic effect types: heal_zone (heals enemies
  // standing in it - punishes camping), slow_zone (slows the player - forces repositioning),
  // damage_zone (damages the player - a classic environmental hazard). A map with no `hazard`
  // field (or an old save/mod) simply never spawns one - fully backward compatible.
  updateMapHazard(dt) {
    const hazard = this.map.hazard;
    if (!hazard) return;
    this.mapHazardTimer -= dt * 1000;
    if (this.mapHazardTimer <= 0) {
      this.mapHazardTimer = hazard.intervalMs || 8000;
      this.spawnMapHazardZone(hazard);
    }
  }

  // Spec section 2 (파란 원형 오브젝트 확인/개선): a hazard zone must be immediately identifiable
  // as more than "a plain colored circle" - it gets a Korean name label on spawn, a distinct
  // double-ring + inner pattern per hazard type (not just one flat color), and a one-time
  // on-enter feedback text (이동속도 감소!/피해!/etc.) the moment the player steps into it,
  // rather than only a passive tint.
  spawnMapHazardZone(hazard) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 160 + Math.random() * 220;
    const x = this.player.x + Math.cos(angle) * dist;
    const y = this.player.y + Math.sin(angle) * dist;
    const radius = hazard.radius || 100;
    const tickMs = hazard.tickMs || 700;
    const durationSec = hazard.durationSec || 5;
    const colorByType = { heal_zone: 0x55ff88, slow_zone: 0x55aaff, damage_zone: 0xff5533 };
    const feedbackKeyByType = { heal_zone: 'hazardHeal', slow_zone: 'hazardSlow', damage_zone: 'hazardDamage' };
    const color = colorByType[hazard.type] || 0xaaaaaa;

    const zone = this.add.circle(x, y, radius, color, 0.16).setDepth(3);
    zone.setStrokeStyle(3, color, 0.65);
    // Inner ring makes the zone read as a distinct "pool/field" shape rather than a flat disc,
    // and differs visually by hazard type: a tight glowing core for damage, a rippling inner
    // ring for slow (water-pool feel), a soft halo for heal.
    const innerRadius = hazard.type === 'damage_zone' ? radius * 0.35 : radius * 0.62;
    const innerZone = this.add.circle(x, y, innerRadius, color, 0.22).setDepth(3);
    innerZone.setStrokeStyle(2, 0xffffff, 0.35);
    this.tweens.add({ targets: zone, alpha: { from: 0.5, to: 0.16 }, duration: 400, yoyo: true, repeat: -1 });
    this.tweens.add({
      targets: innerZone,
      radius: hazard.type === 'slow_zone' ? { from: innerRadius, to: innerRadius * 1.25 } : innerRadius,
      alpha: { from: 0.35, to: 0.12 },
      duration: 650,
      yoyo: true,
      repeat: -1
    });

    // Name label so the hazard is never just an unlabeled colored shape.
    const label = this.add.text(x, y - radius - 14, hazard.name || '', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '12px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(31).setAlpha(0);
    this.tweens.add({ targets: label, alpha: 1, duration: 300 });
    this.tweens.add({ targets: label, alpha: 0, duration: 300, delay: Math.max(0, durationSec * 1000 - 300) });

    let playerWasInside = false;

    const ticks = Math.max(1, Math.round((durationSec * 1000) / tickMs));
    for (let i = 0; i < ticks; i++) {
      this.time.delayedCall(300 + i * tickMs, () => {
        if (this.matchEnded) return;
        const playerInside = PS.MathUtils.distance(this.player.x, this.player.y, x, y) <= radius;
        if (playerInside && !playerWasInside) {
          this.vfx.showFeedbackText(this.player.x, this.player.y - 40, feedbackKeyByType[hazard.type]);
        }
        playerWasInside = playerInside;

        if (hazard.type === 'heal_zone') {
          for (const e of this.findEnemiesInRadius(x, y, radius)) e.heal(e.maxHp * (hazard.value || 0.03));
        } else if (hazard.type === 'slow_zone') {
          if (playerInside) {
            this.player.applyHazardSlow(1 - (hazard.value || 0.4), (tickMs / 1000) + 0.15);
          }
        } else if (hazard.type === 'damage_zone') {
          if (playerInside) {
            const dmg = Math.round(this.player.maxHp * (hazard.value || 0.035));
            const applied = this.player.takeDamage(dmg);
            if (applied) {
              this.damageNumberPool.obtain(this.player.x, this.player.y - 24, dmg, { color: '#ff8844' });
              this.audio.playPlayerHurt();
            }
          }
        }
      });
    }
    this.time.delayedCall(durationSec * 1000 + 50, () => {
      // Bugfix (game-freezing crash): zone/innerZone/label each have infinitely-repeating
      // (repeat:-1) tweens that never stop themselves. Destroying the target without killing
      // its tween first left the tween running against a dead object - harmless for a plain
      // Sprite's x/y/alpha, but innerZone's radius tween writes into a Phaser Arc's internal
      // geometry object, which destroy() nulls out, so the next tween tick threw
      // "Cannot set properties of null (setting 'radius')" and crashed Phaser's whole render
      // loop (the game appeared to just freeze a few seconds after any hazard field expired).
      this.tweens.killTweensOf([zone, innerZone, label]);
      zone.destroy(); innerZone.destroy(); label.destroy();
    });
  }

  findEnemiesNearSegment(x1, y1, x2, y2, halfWidth) {
    // Perf: beam/dash patterns call this once per attack, and it used to take a sqrt
    // (MathUtils.distance) per active enemy - squared-distance comparison against halfWidth^2
    // gives the identical result without the sqrt, same trick already used by
    // findEnemiesInRadius above.
    const result = [];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    const halfWidthSq = halfWidth * halfWidth;
    this.enemyPool.forEachActive(e => {
      let t = ((e.x - x1) * dx + (e.y - y1) * dy) / lenSq;
      t = PS.MathUtils.clamp(t, 0, 1);
      const px = x1 + t * dx, py = y1 + t * dy;
      if (PS.MathUtils.distanceSq(e.x, e.y, px, py) <= halfWidthSq) result.push(e);
    });
    return result;
  }

  firePlayerProjectile(move, x, y, angle, kind, range) {
    const proj = this.playerProjectilePool.obtain(x, y, angle, {
      kind,
      move,
      moveLevel: this.build.getMoveLevel(move.id),
      ownerContext: { side: 'player' },
      speed: move.projectileSpeed || 420,
      pierce: move.pierce || 0,
      chainCount: move.chainCount || 0,
      // Type Mastery (Electric Lv3 in the base data): widens a chain move's hop range.
      chainRange: (move.chainRange || 160) * (1 + (this.build.modifiers.typeChainRangeBonus[move.type] || 0)),
      splashRadius: move.splashRadius || 0,
      range: range || move.range || 350
    });
    const vfxDef = this.data_.vfx.types[move.type] || this.data_.vfx.types.normal;
    proj.setTexture(this.vfx.getTexture(move.type));
    proj.setDisplaySize(20, 20);
    proj.setTint(this.assets.hexToInt(vfxDef.color));
    proj.onDone = (p) => this.playerProjectilePool.release(p);
  }

  resolveAoe(move, targets, hpRatio, attackerEntity) {
    if (move.category === 'status' && move.statusOnly) {
      for (const target of targets) this.statusFx.tryApply(target, move.statusOnly.status, move.statusOnly.chance);
      return;
    }
    for (const target of targets) this.applyPlayerHitToEnemy(move, target, hpRatio, attackerEntity);
  }

  applyPlayerHitToEnemy(move, enemy, hpRatio, attackerEntity) {
    const result = this.combat.resolvePlayerHit(this.build, move, enemy, hpRatio, attackerEntity);
    const died = enemy.takeDamage(result.damage);

    // Type Mastery XP: automatic, earned just by playing (spec section 30) - no card needed.
    const gain = this.managers.typeMastery.xpGain;
    const newLevel = this.build.addTypeMasteryXp(move.type, gain.hitOfType);
    if (newLevel) this.announceTypeMasteryLevelUp(move.type, newLevel);
    if (result.statusApplied) this.build.addTypeMasteryXp(move.type, gain.statusAppliedOfType);

    this.damageNumberPool.obtain(enemy.x, enemy.y - 20, result.damage, {
      color: result.isCrit ? '#fff176' : '#ffffff',
      scale: result.isCrit ? 1.3 : 1
    });
    this.vfx.showFeedbackText(enemy.x, enemy.y, result.label);
    this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(move.id), enemy.x, enemy.y);
    // Purely additive per-move flourish layered on the shared hit pipeline every move already
    // uses (e.g. leech_seed's seed-attach, spec section 14) - a no-op for every move without a
    // registered override, so this never changes the look of the other ~30 moves.
    this.vfx.playMoveOverride(move.id, move.type, this.build.getMoveLevel(move.id), { x: enemy.x, y: enemy.y });
    this.vfx.playHit({ type: move.type, x: enemy.x, y: enemy.y, critical: result.isCrit });
    this.audio.playHit(result.isCrit);
    if (result.label === 'superEffective') this.audio.playSuperEffective();

    if (result.lifestealPercent > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + result.damage * result.lifestealPercent);
    }
    if (move.knockback) {
      const dir = PS.MathUtils.normalize(enemy.x - this.player.x, enemy.y - this.player.y);
      enemy.x += dir.x * (move.knockback / 10);
      enemy.y += dir.y * (move.knockback / 10);
    }

    if (died) this.killEnemy(enemy, move.type);
  }

  // ================= Enemy attack resolution =================
  performEnemyAttack(enemy, move) {
    if (enemy.tier === 'boss' || enemy.tier === 'miniboss') PS.Boss.telegraph(this, enemy, move.areaRadius || 60);

    switch (move.pattern) {
      case 'projectile': {
        const angle = PS.MathUtils.angleBetween(enemy.x, enemy.y, this.player.x, this.player.y);
        const proj = this.enemyProjectilePool.obtain(enemy.x, enemy.y, angle, {
          kind: 'straight',
          move,
          moveLevel: 1,
          ownerContext: { side: 'enemy', enemyStats: { attack: enemy.attack }, enemyTypes: enemy.types },
          speed: move.projectileSpeed || 380,
          pierce: 0,
          range: move.range || 320
        });
        const vfxDef = this.data_.vfx.types[move.type] || this.data_.vfx.types.normal;
        proj.setTexture(this.vfx.getTexture(move.type));
        proj.setDisplaySize(18, 18);
        proj.setTint(this.assets.hexToInt(vfxDef.color));
        proj.onDone = (p) => this.enemyProjectilePool.release(p);
        break;
      }
      case 'circle':
      case 'explosion': {
        const radius = move.areaRadius || 120;
        if (PS.MathUtils.distance(enemy.x, enemy.y, this.player.x, this.player.y) <= radius) {
          this.applyEnemyHitToPlayer(enemy, move);
        }
        this.vfx.playCircleVfx(move.type, 2, enemy.x, enemy.y, radius);
        break;
      }
      case 'beam': {
        const angle = PS.MathUtils.angleBetween(enemy.x, enemy.y, this.player.x, this.player.y);
        const ex = enemy.x + Math.cos(angle) * (move.range || 300);
        const ey = enemy.y + Math.sin(angle) * (move.range || 300);
        const dist = this.pointSegmentDistance(this.player.x, this.player.y, enemy.x, enemy.y, ex, ey);
        if (dist <= (move.beamWidth || 40) / 2) this.applyEnemyHitToPlayer(enemy, move);
        break;
      }
      default: {
        if (PS.MathUtils.distance(enemy.x, enemy.y, this.player.x, this.player.y) <= (move.range || 100)) {
          this.applyEnemyHitToPlayer(enemy, move);
        }
      }
    }
  }

  pointSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = PS.MathUtils.clamp(t, 0, 1);
    return PS.MathUtils.distance(px, py, x1 + t * dx, y1 + t * dy);
  }

  onEnemyProjectileHit(proj) {
    if (!proj.active) return;
    const move = proj.move;
    const stats = proj.ownerContext.enemyStats;
    const types = proj.ownerContext.enemyTypes;
    this.applyEnemyHitToPlayer({ attack: stats.attack, types }, move);
    proj.deactivate();
  }

  triggerBossPhaseFeedback(enemy, label) {
    this.cameras.main.shake(220, 0.006);
    enemy.setTint(0xff5555);
    this.time.delayedCall(260, () => {
      if (enemy.active) enemy.setTint(enemy.eliteModifier ? this.assets.hexToInt(enemy.eliteModifier.tint.replace('0x', '')) : 0xffffff);
    });
    const banner = this.add.text(this.cameras.main.width / 2, 150, `${enemy.species.name} - ${label} 돌입!`, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#ff5555',
      align: 'center', stroke: '#000000', strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 250, yoyo: true, hold: 1200, onComplete: () => banner.destroy() });
  }

  applyEnemyHitToPlayer(enemySource, move) {
    // Bugfix: the aura_debuff ability applies 'attackDown' to enemies (see updateAuraAbilities
    // below) but StatusEffectSystem.getAttackMult() was never consulted here, so the debuff was
    // purely cosmetic. Safe to call unconditionally - it reads entity.statusEffects and no-ops
    // (returns 1) for a reconstructed projectile-hit source that has none.
    const attackStatusMult = this.statusFx.getAttackMult(enemySource);
    const enemyStats = { attack: enemySource.attack * (enemySource.phaseDamageMult || 1) * attackStatusMult };
    const enemyTypes = enemySource.types;
    const result = this.combat.resolveEnemyHitOnPlayer(enemyStats, enemyTypes, move, this.build, this.player);

    if (!result.absorbed) {
      const applied = this.player.takeDamage(result.damage);
      if (!applied && this.player.lastSaveType === 'shield') this.triggerShieldBlockFeedback();
      if (applied) {
        this.damageNumberPool.obtain(this.player.x, this.player.y - 24, result.damage, { color: '#ff6666' });
        this.audio.playPlayerHurt();
        this.triggerStaticHook();
        this.triggerCounterAttack(enemySource);
        if (this.player.lastSaveType === 'phoenix') this.triggerPhoenixSaveFeedback();
        else if (this.player.lastSaveType === 'survival') this.triggerSurvivalSaveFeedback();

        // Elite modifiers (spec section 57). Only meaningful when enemySource is the real,
        // still-alive Enemy instance (contact hits, and the direct circle/beam/default branches
        // of performEnemyAttack) - never a reconstructed { attack, types } object from a
        // projectile hit, since that source may have already despawned/been pooled elsewhere.
        if (enemySource.eliteModifier) {
          if (enemySource.eliteModifier.toxicOnHit) this.statusFx.tryApply(this.player, 'poison', 0.5);
          if (enemySource.eliteModifier.vampiricPercent && enemySource.heal) {
            enemySource.heal(result.damage * enemySource.eliteModifier.vampiricPercent);
          }
        }
      }
      if (result.statusId && PS.RandomUtils.chance(result.statusChance)) this.statusFx.tryApply(this.player, result.statusId, result.statusChance);
    } else {
      if (result.healFromAbsorb > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + result.healFromAbsorb);
        this.damageNumberPool.obtain(this.player.x, this.player.y - 24, `+${result.healFromAbsorb}`, { color: '#62ffb0' });
      }
      if (result.flashFireStacks.length > 0) {
        const maxStacks = result.flashFireStacks[0].effect.maxStacks;
        this.player.flashFireStacks = Math.min(maxStacks, (this.player.flashFireStacks || 0) + 1);
      }
    }
  }

  // relic_phoenix: full heal + temp invuln + damage buff, so it needs a much bigger, distinct
  // callout than the plain 1-HP survival-charge save below.
  triggerPhoenixSaveFeedback() {
    this.vfx.playEvolutionFlash(this.player.x, this.player.y, 'fire');
    this.audio.playPhoenixRevive();
    const banner = this.add.text(this.cameras.main.width / 2, 150, '불사조의 힘으로 부활!', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '22px', color: '#ff8a3d',
      align: 'center', stroke: '#000000', strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
    this.tweens.add({
      targets: banner, alpha: 1, duration: 300, yoyo: true, hold: 1400,
      onComplete: () => banner.destroy()
    });
  }

  triggerSurvivalSaveFeedback() {
    this.damageNumberPool.obtain(this.player.x, this.player.y - 44, '기사회생!', { color: '#62ffb0', scale: 1.2 });
  }

  triggerShieldBlockFeedback() {
    this.damageNumberPool.obtain(this.player.x, this.player.y - 44, '보호막!', { color: '#e2b6ff', scale: 1.15 });
  }

  // 'counter' pattern (spec: Counter): reactive rather than cooldown-driven from Player.js's
  // normal auto-fire loop - see performPlayerAttack's 'counter' case, which is intentionally a
  // no-op. Instead, every time the player actually takes damage, any owned counter move that
  // is off its OWN cooldown fires back at the real attacking Enemy instance, if it's still in
  // range. Deliberately scoped to only enemySource objects that are a real, still-alive Enemy
  // (duck-typed via `takeDamage`), same caution as the elite-modifier vampiric/toxic hooks -
  // a projectile-hit's reconstructed { attack, types } object never reaches this.
  triggerCounterAttack(enemySource) {
    if (!enemySource || typeof enemySource.takeDamage !== 'function' || !enemySource.active) return;
    for (const moveId of this.build.getOwnedMoveIds()) {
      const move = this.managers.move.getMove(moveId);
      if (!move || move.pattern !== 'counter') continue;
      const readyAt = this.counterCooldowns[moveId] || 0;
      if (this.time.now < readyAt) continue;
      const dist = PS.MathUtils.distance(this.player.x, this.player.y, enemySource.x, enemySource.y);
      if (dist > (move.range || 130)) continue;
      this.counterCooldowns[moveId] = this.time.now + (move.cooldownMs || 900);
      this.applyPlayerHitToEnemy(move, enemySource, this.player.getHpRatio(), this.player);
      this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(moveId), enemySource.x, enemySource.y);
    }
  }

  triggerStaticHook() {
    const mods = this.build.modifiers;
    for (const hook of PS.AbilitySystem.find(mods, 'on_hit_taken_aoe_status')) {
      const chance = PS.AbilitySystem.scale(hook.effect, hook.level, 'chance', 'chancePerLevel');
      if (PS.RandomUtils.chance(chance)) {
        const targets = this.findEnemiesInRadius(this.player.x, this.player.y, hook.effect.radius);
        for (const t of targets) this.statusFx.tryApply(t, hook.effect.status, 1.0);
        this.vfx.playCircleVfx('electric', 2, this.player.x, this.player.y, hook.effect.radius);
      }
    }
  }

  onPlayerProjectileHit(proj, enemyObj) {
    if (!proj.active || !enemyObj.active) return;
    if (proj.hitSet.has(enemyObj)) return;
    this.applyPlayerHitToEnemy(proj.move, enemyObj, this.player.getHpRatio(), this.player);

    if (proj.kind === 'chain') {
      // A real connecting link from the previous hop (or the cast point) to this one, instead
      // of the generic type burst used for other projectile kinds (spec: Electric+Chain).
      this.vfx.playChain(proj.move.type, proj.moveLevel, [
        { x: proj.chainFromX, y: proj.chainFromY }, { x: enemyObj.x, y: enemyObj.y }
      ]);
      proj.chainFromX = enemyObj.x;
      proj.chainFromY = enemyObj.y;
    }

    if (proj.splashRadius > 0) {
      const splashTargets = this.findEnemiesInRadius(enemyObj.x, enemyObj.y, proj.splashRadius).filter(e => e !== enemyObj);
      for (const t of splashTargets) this.applyPlayerHitToEnemy(proj.move, t, this.player.getHpRatio(), this.player);
    }

    const keepFlying = proj.registerHit(enemyObj);
    if (!keepFlying) proj.deactivate();
  }

  onPlayerTouchEnemy(enemy) {
    if (!enemy.active) return;
    if (enemy.contactCooldown > 0) return;
    enemy.contactCooldown = 0.6;
    this.applyEnemyHitToPlayer(enemy, null);
  }

  onPlayerTouchGem(gem) {
    if (!gem.active) return;
    this.build.addExp(gem.value);
    this.audio.playPickupGem();
    this.gemPool.release(gem);
  }

  // ================= Field pickups (heal / speed / magnet) =================
  updatePickups(dtMs) {
    this.nextPickupTimerMs -= dtMs;
    if (this.nextPickupTimerMs <= 0) {
      this.nextPickupTimerMs = PS.RandomUtils.range(10000, 16000);
      this.spawnFieldPickup();
    }
  }

  spawnFieldPickup() {
    const kind = PS.RandomUtils.pick(['heal', 'speed', 'magnet']);
    const angle = Math.random() * Math.PI * 2;
    const dist = PS.RandomUtils.range(250, 550);
    const x = this.player.x + Math.cos(angle) * dist;
    const y = this.player.y + Math.sin(angle) * dist;

    const pickup = this.physics.add.sprite(x, y, `pickup_${kind}`);
    pickup.pickupType = kind;
    pickup.setDepth(3);
    this.pickupGroup.add(pickup);
    this.tweens.add({ targets: pickup, y: y - 10, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.time.delayedCall(20000, () => { if (pickup.active) { this.tweens.killTweensOf(pickup); pickup.destroy(); } });
  }

  onPickupCollected(pickup) {
    if (!pickup.active) return;
    const kind = pickup.pickupType;
    if (kind === 'heal') {
      this.player.heal(Math.round(this.player.maxHp * 0.3));
      this.damageNumberPool.obtain(this.player.x, this.player.y - 30, '+HP', { color: '#ff6b8a', scale: 1.2 });
    } else if (kind === 'speed') {
      this.player.applyFieldSpeedBuff(1.6, 8);
      this.damageNumberPool.obtain(this.player.x, this.player.y - 30, '스피드 업!', { color: '#4dd2ff', scale: 1.1 });
    } else if (kind === 'magnet') {
      this.gemPool.forEachActive(g => { g.magnetized = true; });
      this.damageNumberPool.obtain(this.player.x, this.player.y - 30, '자석 효과!', { color: '#ffd400', scale: 1.2 });
    }
    this.audio.playFieldPickup(kind);
    this.tweens.killTweensOf(pickup);
    pickup.destroy();
  }

  // ================= Relic field pickups (rare, separate from heal/speed/magnet) =================
  updateRelicPickups(dtMs) {
    this.nextRelicPickupTimerMs -= dtMs;
    if (this.nextRelicPickupTimerMs <= 0) {
      this.nextRelicPickupTimerMs = PS.RandomUtils.range(180000, 240000);
      this.spawnRelicFieldPickup();
    }
  }

  spawnRelicFieldPickup() {
    const relicId = this.pickRelicIdForDrop();
    const angle = Math.random() * Math.PI * 2;
    const dist = PS.RandomUtils.range(300, 650);
    const x = this.player.x + Math.cos(angle) * dist;
    const y = this.player.y + Math.sin(angle) * dist;

    const pickup = this.physics.add.sprite(x, y, `relic_${relicId}`);
    pickup.relicId = relicId;
    pickup.setDepth(3);
    this.relicPickupGroup.add(pickup);
    // More eye-catching than the common pickups (slow spin + bigger bob) since it's rare.
    this.tweens.add({ targets: pickup, y: y - 14, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: pickup, angle: 360, duration: 3000, repeat: -1, ease: 'Linear' });
    this.time.delayedCall(30000, () => { if (pickup.active) { this.tweens.killTweensOf(pickup); pickup.destroy(); } });
  }

  onRelicPickupCollected(pickup) {
    if (!pickup.active) return;
    const relic = this.managers.relic.getRelic(pickup.relicId);
    const gained = this.build.addRelic(pickup.relicId);
    this.player.refreshFromBuild();
    this.announceRelic(relic, gained);
    this.audio.playRelicPickup();
    this.tweens.killTweensOf(pickup);
    pickup.destroy();
  }

  // ================= Enemy lifecycle =================
  spawnEnemy(species, stats, x, y, isBig) {
    const enemy = this.enemyPool.obtain(species, stats, x, y);
    if (isBig) {
      this.vfx.playBossSpawn({ x, y, type: species.types[0] });
      PS.Boss.announce(this, enemy);
      this.addBossHpBar(enemy);
      this.audio.playBossAppear();
    } else if (stats.eliteModifier) {
      this.showEliteTag(enemy, stats.eliteModifier);
    }
    // Spec section 28-③ (희귀 포켓몬 등장 연출): a legendary/sub-legendary spawn is rare enough
    // (spawnProfile + tiny pool weight, see maps.json/enemies.json) that it deserves its own
    // callout distinct from the ordinary elite tag - a screen banner + name highlight + a
    // distinct sound, reusing Boss.announce's exact banner pattern rather than inventing a new one.
    if (species.rarity === 'legendary' || species.rarity === 'subLegendary') {
      this.announceRareSpawn(species);
    }
    return enemy;
  }

  announceRareSpawn(species) {
    const label = species.rarity === 'legendary' ? '전설의 포켓몬 출현!' : '준전설 포켓몬 출현!';
    const color = species.rarity === 'legendary' ? '#ffd400' : '#8fe3ff';
    const banner = this.add.text(this.cameras.main.width / 2, 90, `${label}\n${species.name}`, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '22px', color, align: 'center',
      stroke: '#000000', strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, duration: 300, yoyo: true, hold: 1400, onComplete: () => banner.destroy() });
    this.audio.playRelicPickup();
  }

  // Small floating name tag over a freshly-spawned elite so its modifier (spec section 57) is
  // legible at a glance, not just a color tint.
  showEliteTag(enemy, modifier) {
    const cssColor = '#' + modifier.tint.replace('0x', '').padStart(6, '0');
    const tag = this.add.text(enemy.x, enemy.y - 34, `★ ${modifier.nameKo}`, {
      fontFamily: 'Arial Black', fontSize: '11px', color: cssColor,
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(8);
    this.tweens.add({
      targets: tag, y: tag.y - 20, alpha: 0, duration: 1400, ease: 'Cubic.easeOut',
      onComplete: () => tag.destroy()
    });
  }

  killEnemy(enemy, killTypeId) {
    this.build.recordKill();
    this.player.registerKillMomentum();
    if (killTypeId) {
      const newLevel = this.build.addTypeMasteryXp(killTypeId, this.managers.typeMastery.xpGain.killWithType);
      if (newLevel) this.announceTypeMasteryLevelUp(killTypeId, newLevel);
    }
    // burn_explosion ability (Charmander vertical slice, spec section 31): killing a burning
    // enemy sets off a small explosion on nearby enemies too.
    if (this.statusFx.has(enemy, 'burn')) {
      for (const hook of PS.AbilitySystem.find(this.build.modifiers, 'on_status_kill_explosion')) {
        if (hook.effect.status !== 'burn') continue;
        const radius = PS.AbilitySystem.scale(hook.effect, hook.level, 'radius', 'radiusPerLevel');
        const percent = PS.AbilitySystem.scale(hook.effect, hook.level, 'damagePercentOfMaxHp', 'damagePercentPerLevel');
        const explosionDamage = Math.max(1, Math.round(enemy.maxHp * percent));
        const nearby = this.findEnemiesInRadius(enemy.x, enemy.y, radius).filter(e => e !== enemy);
        this.vfx.playCircleVfx('fire', 3, enemy.x, enemy.y, radius);
        this.audio.playSuperEffective();
        for (const target of nearby) {
          const targetDied = target.takeDamage(explosionDamage);
          this.damageNumberPool.obtain(target.x, target.y - 20, explosionDamage, { color: '#ff8a3d' });
          if (targetDied) this.killEnemy(target, 'fire');
        }
      }
    }

    // Elite modifiers 폭발형/분열형 (spec section 28-⑤): resolved here, once, right before the
    // enemy is actually released back to the pool - after this point `enemy` fields (x/y/
    // species/maxHp) are about to be reused by the pool, so both hooks read what they need first.
    if (enemy.eliteModifier && enemy.eliteModifier.explodeOnDeath) {
      const cfg = enemy.eliteModifier.explodeOnDeath;
      this.vfx.playCircleVfx(enemy.types[0], 3, enemy.x, enemy.y, cfg.radius);
      if (PS.MathUtils.distance(enemy.x, enemy.y, this.player.x, this.player.y) <= cfg.radius) {
        const dmg = Math.round(this.player.maxHp * cfg.damagePercentOfPlayerMaxHp);
        const applied = this.player.takeDamage(dmg);
        if (applied) {
          this.damageNumberPool.obtain(this.player.x, this.player.y - 24, dmg, { color: '#ff5533' });
          this.audio.playPlayerHurt();
        }
      }
    }
    if (enemy.eliteModifier && enemy.eliteModifier.splitOnDeath) {
      const cfg = enemy.eliteModifier.splitOnDeath;
      for (let i = 0; i < cfg.count; i++) {
        const angle = (Math.PI * 2 * i) / cfg.count + Math.random() * 0.5;
        const dist = 30 + Math.random() * 20;
        const cloneStats = {
          maxHp: Math.max(1, Math.round(enemy.maxHp * cfg.hpPercent)),
          attack: enemy.attack * cfg.statPercent,
          defense: enemy.defense * cfg.statPercent,
          speed: enemy.speed,
          exp: Math.max(1, Math.round(enemy.expValue * 0.3))
          // deliberately no eliteModifier on the clones - prevents an infinite split chain.
        };
        this.spawnEnemy(enemy.species, cloneStats, enemy.x + Math.cos(angle) * dist, enemy.y + Math.sin(angle) * dist, false);
      }
    }

    this.vfx.playDeathBurst(enemy.x, enemy.y, this.assets.hexToInt(enemy.species.color));
    const expValue = Math.max(1, Math.round(enemy.expValue * (this.build.modifiers.expGainMult || 1)));
    this.gemPool.obtain(enemy.x, enemy.y, expValue);
    this.audio.playEnemyDeath();
    if (enemy.tier === 'boss') {
      this.bossKilled = true;
    }
    if (enemy.tier === 'boss' || enemy.tier === 'miniboss') {
      this.grantGuaranteedRelic(enemy);
    }
    enemy.despawn();
    this.enemyPool.release(enemy);
  }

  // ================= Relics =================
  // Picks a relic id for a guaranteed drop, weighted away from ones the player already has
  // maxed (so a miniboss/boss kill late-game doesn't "waste" a drop on a relic that can't
  // improve further, unless every relic is already maxed).
  pickRelicIdForDrop() {
    const allIds = this.managers.relic.getAllIds();
    const notMaxed = allIds.filter(id => {
      const relic = this.managers.relic.getRelic(id);
      return this.build.getRelicLevel(id) < relic.maxLevel;
    });
    const pool = notMaxed.length > 0 ? notMaxed : allIds;
    return PS.RandomUtils.pick(pool);
  }

  grantGuaranteedRelic(enemy) {
    const relicId = this.pickRelicIdForDrop();
    const relic = this.managers.relic.getRelic(relicId);
    const gained = this.build.addRelic(relicId);
    this.player.refreshFromBuild();
    this.announceRelic(relic, gained);
    this.audio.playRelicPickup();
  }

  announceRelic(relic, isNew) {
    const label = isNew ? `유물 획득: ${relic.name}` : `유물 강화: ${relic.name} Lv${this.build.getRelicLevel(relic.id)}`;
    const banner = this.add.text(this.cameras.main.width / 2, 150, label, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '18px', color: '#ffd400',
      align: 'center', stroke: '#000000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    this.tweens.add({
      targets: banner, alpha: 1, duration: 300, yoyo: true, hold: 1600,
      onComplete: () => banner.destroy()
    });
  }

  // ================= Type Mastery =================
  announceTypeMasteryLevelUp(typeId, level) {
    const label = `${PS.typeNameKo(typeId)} 숙련도 Lv.${level}!`;
    const cfg = this.managers.typeMastery.getTypeConfig(typeId);
    const detail = cfg.levels[level] ? cfg.levels[level].label : '';
    const banner = this.add.text(this.cameras.main.width / 2, 116, `${label}\n${detail}`, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '15px', color: '#8fd3ff',
      align: 'center', stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
    this.tweens.add({
      targets: banner, alpha: 1, duration: 250, yoyo: true, hold: 1300,
      onComplete: () => banner.destroy()
    });
    this.audio.playCardHover();
  }

  // ================= Move Evolution (spec section 33) =================
  checkMoveEvolutions() {
    this._moveEvoTimer = (this._moveEvoTimer || 0) + 1;
    if (this._moveEvoTimer % 20 !== 0) return; // throttle: check ~3x/sec, same cadence as species evolution
    const entry = this.moveEvolutionSystem.checkEvolutions(this.build);
    if (entry) this.triggerMoveEvolution(entry);
  }

  triggerMoveEvolution(entry) {
    this.moveEvolutionSystem.apply(this.build, entry);
    this.player.refreshFromBuild();
    this.vfx.playEvolutionFlash(this.player.x, this.player.y, entry.toMove.type);
    this.audio.playEvolution();
    const banner = this.add.text(this.cameras.main.width / 2, 150,
      `기술 진화!\n${entry.fromMove.name} → ${entry.toMove.name}`, {
        fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#ffd400',
        align: 'center', stroke: '#000000', strokeThickness: 5
      }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);
    this.tweens.add({
      targets: banner, alpha: 1, duration: 300, yoyo: true, hold: 1800,
      onComplete: () => banner.destroy()
    });
  }

  // ================= Level up / evolution =================
  checkLevelUps() {
    const count = this.levelSystem.consumeLevelUps(this.build);
    if (count > 0) {
      this.player.refreshFromBuild();
      this.queueLevelUps(count);
    }
  }

  queueLevelUps(count) {
    this.pendingLevelUps = (this.pendingLevelUps || 0) + count;
    if (!this.isPaused) this.openNextLevelUp();
  }

  openNextLevelUp() {
    if (!this.pendingLevelUps || this.pendingLevelUps <= 0) return;
    this.pendingLevelUps--;
    this.isPaused = true;
    this.audio.playLevelUp();
    const choices = this.levelSystem.generateChoices(this.build, this.runTimeSec);
    this.scene.launch('LevelUp', {
      choices,
      build: this.build,
      levelSystem: this.levelSystem,
      audio: this.audio,
      runTimeSec: this.runTimeSec,
      onChosen: (choice) => {
        this.audio.playCardSelect(choice.grade);
        this.levelSystem.applyChoice(this.build, choice);
        this.player.refreshFromBuild();
        // Skill Level Up VFX (spec section 24) - only meaningful for an actual move pick; a new
        // item/ability/stat upgrade already gets its own card-selection feedback in LevelUpScene.
        if (choice.kind === 'move') {
          const move = this.managers.move.getMove(choice.id);
          if (move) this.vfx.playLevelUp({ type: move.type, x: this.player.x, y: this.player.y });
        }
        this.scene.stop('LevelUp');
        if (this.pendingLevelUps > 0) this.openNextLevelUp();
        else this.isPaused = false;
      }
    });
  }

  checkEvolution() {
    this._evoTimer = (this._evoTimer || 0) + 1;
    if (this._evoTimer % 20 !== 0) return; // throttle: check ~3x/sec
    const entry = this.evolutionSystem.checkEvolution(this.build, this.runTimeSec);
    if (entry) this.triggerEvolution(entry);
  }

  triggerEvolution(entry) {
    this.isPaused = true;
    const fromSpecies = this.build.species;
    this.evolutionSystem.apply(this.build, entry);
    this.player.setSpeciesTexture(this.build.speciesId);
    this.player.refreshFromBuild();
    this.vfx.playEvolutionFlash(this.player.x, this.player.y, this.build.species.types[0]);
    this.audio.playEvolution();

    this.scene.launch('Evolution', {
      fromName: fromSpecies.name,
      toName: this.build.species.name,
      speciesId: this.build.speciesId,
      onDone: () => {
        this.scene.stop('Evolution');
        this.isPaused = false;
      }
    });
  }

  // ================= Match end =================
  endMatch(survived) {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.audio.playGameOver(survived || this.bossKilled);
    const result = {
      survived,
      bossDefeated: this.bossKilled,
      survivedSec: Math.floor(this.runTimeSec),
      level: this.build.level,
      kills: this.build.kills,
      speciesName: this.build.species.name,
      speciesId: this.build.speciesId,
      dominantType: this.build.getDominantType()
    };
    PS.SaveSystem.recordRunResult(result);
    this.scene.start('GameOver', result);
  }

  // ================= Debug =================
  setupDebugKeys() {
    const kb = this.input.keyboard;
    kb.on('keydown-G', () => { this.build.addExp(this.levelSystem.expForLevel(this.build.level)); });
    kb.on('keydown-E', () => {
      const candidates = this.evolutionSystem.getCandidates(this.build.speciesId);
      if (candidates.length > 0) this.triggerEvolution(candidates[0]);
    });
    kb.on('keydown-B', () => this.spawnSystem.spawnBoss(this.player.x, this.player.y));
    kb.on('keydown-ONE', () => this.vfx.playTypeVfx('fire', 3, this.player.x, this.player.y - 60));
    kb.on('keydown-TWO', () => this.vfx.playTypeVfx('water', 3, this.player.x, this.player.y - 60));
    kb.on('keydown-THREE', () => this.vfx.playTypeVfx('electric', 3, this.player.x, this.player.y - 60));
    kb.on('keydown-FOUR', () => {
      for (const id of this.build.getOwnedMoveIds()) this.build.moves[id] = this.data_.balance.maxLevels.move;
      this.build.refreshModifiers();
    });
    kb.on('keydown-FIVE', () => {
      const legendary = this.managers.item.getAllByGrade('legendary');
      const pool = legendary.length ? legendary : this.managers.item.getAllByGrade('epic');
      if (pool.length) this.build.addOrUpgradeItem(PS.RandomUtils.pick(pool).id);
    });
  }
};
