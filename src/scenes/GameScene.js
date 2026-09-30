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
    this.assets = PS.Game.assets;
    this.vfx = new PS.VFXSystem(this, data.vfx, this.assets);
    this.audio = new PS.AudioSystem(this);
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
      (obj, x, y, value, options) => obj.fire(x, y, value, options),
      0
    );

    // ---- Field pickups (heal / speed / magnet) ----
    this.pickupGroup = this.physics.add.group();
    this.nextPickupTimerMs = PS.RandomUtils.range(8000, 13000);

    // ---- Spawn system ----
    this.spawnSystem = new PS.SpawnSystem(managers.enemy, this.waveSystem, data.balance, this.mapId,
      (species, stats, x, y, isBig) => this.spawnEnemy(species, stats, x, y, isBig));

    // ---- Collisions ----
    this.physics.add.overlap(this.playerProjectileGroup, this.enemyGroup, (proj, enemy) => this.onPlayerProjectileHit(proj, enemy));
    this.physics.add.overlap(this.enemyProjectileGroup, this.player, (proj, player) => this.onEnemyProjectileHit(proj));
    this.physics.add.overlap(this.player, this.enemyGroup, (player, enemy) => this.onPlayerTouchEnemy(enemy));
    this.physics.add.overlap(this.player, this.expGemGroup, (player, gem) => this.onPlayerTouchGem(gem));
    this.physics.add.overlap(this.player, this.pickupGroup, (player, pickup) => this.onPickupCollected(pickup));

    // ---- Input ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.setupDebugKeys();
    this.setupPauseAndBuildOverview();

    this.buildHud();
    this.buildLowHpVignette();
    this.rangeRingGfx = this.add.graphics().setDepth(2);

    this.events.on('resume', () => { this.isPaused = false; });
  }

  hex(v) {
    return typeof v === 'string' ? parseInt(v.replace('0x', ''), 16) : v;
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
  buildHud() {
    const w = this.cameras.main.width;
    this.hpBarBg = this.add.rectangle(20, 20, 220, 16, 0x220000, 0.8).setOrigin(0, 0).setScrollFactor(0).setDepth(50);
    this.hpBarFg = this.add.rectangle(22, 22, 216, 12, 0xff4444, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(51);
    this.expBarBg = this.add.rectangle(20, 40, 220, 8, 0x002222, 0.8).setOrigin(0, 0).setScrollFactor(0).setDepth(50);
    this.expBarFg = this.add.rectangle(22, 42, 216, 4, 0x62ffb0, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(51);

    this.levelText = this.add.text(20, 52, 'Lv.1', { fontFamily: 'Arial Black', fontSize: '13px', color: '#ffffff' }).setScrollFactor(0).setDepth(51);
    this.timerText = this.add.text(w / 2, 20, '15:00', { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(51);
    this.killText = this.add.text(w - 20, 20, '처치: 0', { fontFamily: 'Arial', fontSize: '13px', color: '#cccccc' }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    this.speciesText = this.add.text(w - 20, 40, this.build.species.name, { fontFamily: 'Arial Black', fontSize: '13px', color: '#ffd400' }).setOrigin(1, 0).setScrollFactor(0).setDepth(51);
    this.muteText = this.add.text(20, this.cameras.main.height - 20, '🔊 M: 음소거', { fontFamily: 'Arial', fontSize: '11px', color: '#666666' }).setOrigin(0, 1).setScrollFactor(0).setDepth(51);

    // Prominent top-of-screen HP bar(s) for miniboss/boss fights (separate from the small
    // floating bar every enemy already has, which is easy to lose track of against a boss's
    // huge HP pool or when it scrolls off-camera). Keyed by enemy instance; supports the rare
    // case of a miniboss still alive when the final boss spawns (both bars stack).
    this.bossBars = new Map();
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
    this.hpBarFg.width = 216 * this.player.getHpRatio();
    const expNeeded = this.levelSystem.expForLevel(this.build.level);
    this.expBarFg.width = 216 * PS.MathUtils.clamp(this.build.exp / expNeeded, 0, 1);
    this.levelText.setText(`Lv.${this.build.level}`);
    this.timerText.setText(this.waveSystem.getTimeRemainingLabel(this.runTimeSec));
    this.killText.setText(`처치: ${this.build.kills}`);
    this.speciesText.setText(this.build.species.name);
  }

  // ================= Pause + build overview (ESC / TAB) =================
  setupPauseAndBuildOverview() {
    this.manualPaused = false;
    this.buildOverviewOpen = false;

    const kb = this.input.keyboard;
    kb.on('keydown-ESC', () => {
      if (this.buildOverviewOpen) { this.hideBuildOverview(); return; }
      if (this.isPaused || this.matchEnded) return; // a LevelUp/Evolution overlay owns the pause
      this.manualPaused = !this.manualPaused;
      this.pauseOverlay.setVisible(this.manualPaused);
      if (this.manualPaused) this.audio.playPause(); else this.audio.playUnpause();
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

    const w = this.cameras.main.width, h = this.cameras.main.height;
    this.pauseOverlay = this.add.container(0, 0).setScrollFactor(0).setDepth(200).setVisible(false);
    this.pauseOverlay.add(this.add.rectangle(0, 0, w, h, 0x000000, 0.7).setOrigin(0));
    this.pauseOverlay.add(this.add.text(w / 2, h / 2 - 20, '일시정지', {
      fontFamily: 'Arial Black', fontSize: '32px', color: '#ffffff'
    }).setOrigin(0.5));
    this.pauseOverlay.add(this.add.text(w / 2, h / 2 + 24, 'ESC 키를 눌러 계속하기', {
      fontFamily: 'Arial', fontSize: '14px', color: '#aaaaaa'
    }).setOrigin(0.5));

    this.buildOverviewContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(200).setVisible(false);
  }

  showBuildOverview() {
    this.buildOverviewOpen = true;
    const c = this.buildOverviewContainer;
    c.removeAll(true);
    const w = this.cameras.main.width, h = this.cameras.main.height;
    c.add(this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0));
    c.add(this.add.text(w / 2, 30, `현재 빌드 - ${this.build.species.name} Lv.${this.build.level}`, {
      fontFamily: 'Arial Black', fontSize: '18px', color: '#ffd400'
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
      c.add(this.add.text(col1X, y1, `${ability.name} Lv${this.build.getAbilityLevel(id)} - ${ability.description}`, {
        fontFamily: 'Arial', fontSize: '12px', color: '#ffffff', wordWrap: { width: w / 2 - 60 }
      }));
      y1 += 20 * Math.ceil((ability.name.length + ability.description.length) / 45 || 1);
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

    c.add(this.add.text(w / 2, h - 30, 'TAB 키를 눌러 닫기', {
      fontFamily: 'Arial', fontSize: '13px', color: '#aaaaaa'
    }).setOrigin(0.5));

    c.setVisible(true);
    this.isPaused = true; // reuse the existing pause gate so combat truly freezes while reading
  }

  hideBuildOverview() {
    this.buildOverviewOpen = false;
    this.buildOverviewContainer.setVisible(false);
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
      const isAreaPattern = move.pattern === 'circle' || move.pattern === 'orbit';
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
    if (this.isPaused || this.manualPaused || this.matchEnded) return;
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

    this.gemPool.forEachActive(g => g.update(dt, this.player.x, this.player.y, this.data_.balance.player.pickupRadius));

    this.spawnSystem.update(deltaMs, this.runTimeSec, this.player.x, this.player.y, this.enemyPool.activeCount);
    this.updatePickups(deltaMs);

    this.checkLevelUps();
    this.checkEvolution();
    this.updateAuraAbilities(dt);
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
    if (enemy.takeDamage(amount)) this.killEnemy(enemy);
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

  getEffectiveAreaRadius(move, fallback) {
    return (move.areaRadius || fallback) * this.build.modifiers.rangeMult;
  }

  performPlayerAttack(player, move) {
    const nearest = this.findNearestEnemy(player.x, player.y, null);
    const aimAngle = nearest ? PS.MathUtils.angleBetween(player.x, player.y, nearest.x, nearest.y) : (player.lastFacingAngle || -Math.PI / 2);
    const hpRatio = player.getHpRatio();
    const range = this.getEffectiveRange(move);

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
        const count = move.count || 3;
        const spread = Phaser.Math.DegToRad(move.spreadAngle || 45);
        for (let i = 0; i < count; i++) {
          const t = count === 1 ? 0 : (i / (count - 1)) - 0.5;
          this.firePlayerProjectile(move, player.x, player.y, aimAngle + t * spread, 'straight', range);
        }
        return true;
      }
      case 'chain':
        this.firePlayerProjectile(move, player.x, player.y, aimAngle, 'chain', range);
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
        this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), player.x, player.y, radius);
        return true;
      }
      case 'orbit': {
        const radius = this.getEffectiveAreaRadius(move, 140);
        const targets = this.findEnemiesInRadius(player.x, player.y, radius, radius * 0.6);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), player.x, player.y, radius);
        return true;
      }
      case 'strike': {
        const radius = this.getEffectiveAreaRadius(move, 80);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const targets = this.findEnemiesInRadius(point.x, point.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), point.x, point.y, radius);
        return true;
      }
      case 'explosion': {
        const radius = this.getEffectiveAreaRadius(move, 100);
        const point = nearest ? { x: nearest.x, y: nearest.y } : { x: player.x + Math.cos(aimAngle) * range, y: player.y + Math.sin(aimAngle) * range };
        const targets = this.findEnemiesInRadius(point.x, point.y, radius);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playCircleVfx(move.type, this.build.getMoveLevel(move.id), point.x, point.y, radius);
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
        const width = move.beamWidth || 40;
        const ex = player.x + Math.cos(aimAngle) * range;
        const ey = player.y + Math.sin(aimAngle) * range;
        const targets = this.findEnemiesNearSegment(player.x, player.y, ex, ey, width / 2);
        this.resolveAoe(move, targets, hpRatio, player);
        this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(move.id), player.x + Math.cos(aimAngle) * (range * 0.5), player.y + Math.sin(aimAngle) * (range * 0.5), aimAngle);
        return true;
      }
      default:
        return true;
    }
  }

  findEnemiesNearSegment(x1, y1, x2, y2, halfWidth) {
    const result = [];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    this.enemyPool.forEachActive(e => {
      let t = ((e.x - x1) * dx + (e.y - y1) * dy) / lenSq;
      t = PS.MathUtils.clamp(t, 0, 1);
      const px = x1 + t * dx, py = y1 + t * dy;
      if (PS.MathUtils.distance(e.x, e.y, px, py) <= halfWidth) result.push(e);
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
      chainRange: move.chainRange || 160,
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

    this.damageNumberPool.obtain(enemy.x, enemy.y - 20, result.damage, {
      color: result.isCrit ? '#fff176' : '#ffffff',
      scale: result.isCrit ? 1.3 : 1
    });
    this.vfx.showFeedbackText(enemy.x, enemy.y, result.label);
    this.vfx.playTypeVfx(move.type, this.build.getMoveLevel(move.id), enemy.x, enemy.y);
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

    if (died) this.killEnemy(enemy);
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

  applyEnemyHitToPlayer(enemySource, move) {
    const enemyStats = { attack: enemySource.attack };
    const enemyTypes = enemySource.types;
    const result = this.combat.resolveEnemyHitOnPlayer(enemyStats, enemyTypes, move, this.build, this.player);

    if (!result.absorbed) {
      const applied = this.player.takeDamage(result.damage);
      if (applied) {
        this.damageNumberPool.obtain(this.player.x, this.player.y - 24, result.damage, { color: '#ff6666' });
        this.audio.playPlayerHurt();
        this.triggerStaticHook();
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
    this.time.delayedCall(20000, () => { if (pickup.active) pickup.destroy(); });
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
    pickup.destroy();
  }

  // ================= Enemy lifecycle =================
  spawnEnemy(species, stats, x, y, isBig) {
    const enemy = this.enemyPool.obtain(species, stats, x, y);
    if (isBig) {
      PS.Boss.announce(this, enemy);
      this.addBossHpBar(enemy);
      this.audio.playBossAppear();
    }
    return enemy;
  }

  killEnemy(enemy) {
    this.build.recordKill();
    this.vfx.playDeathBurst(enemy.x, enemy.y, this.assets.hexToInt(enemy.species.color));
    this.gemPool.obtain(enemy.x, enemy.y, Math.max(1, Math.round(enemy.expValue)));
    this.audio.playEnemyDeath();
    if (enemy.tier === 'boss') {
      this.bossKilled = true;
    }
    enemy.despawn();
    this.enemyPool.release(enemy);
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
      onChosen: (choice) => {
        this.audio.playCardSelect(choice.grade);
        this.levelSystem.applyChoice(this.build, choice);
        this.player.refreshFromBuild();
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
    this.vfx.playEvolutionFlash(this.player.x, this.player.y);
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
