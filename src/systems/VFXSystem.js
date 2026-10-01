// VFXSystem: type x pattern VFX built entirely from procedural textures/graphics (see
// AssetManager) - no external art needed, fully offline.
//
// Two layers of data drive this:
//   data/vfx.json          - per-type base color/shape/trail + level tiers (pre-existing).
//   data/vfx_effects.json  - per (type, pattern-group) Timing/Scale/Colors/Particles/Priority,
//                            generated from PokeSurvivors_VFX_Spec.xlsx. A move's gameplay
//                            `pattern` field (projectile/spread/melee/beam/...) is mapped onto
//                            a smaller set of visual pattern groups by VFXPatternMap.js.
//
// Back-compat: playTypeVfx/playCircleVfx/playDeathBurst/playEvolutionFlash/showFeedbackText
// keep their original signatures and behavior untouched - every existing GameScene call site
// keeps working with zero changes. New capability is additive: playAttack/playHit/playEvolution/
// playLevelUp/playBossSpawn, plus pattern-specific renderers (playBeam/playChain/playGroundZoneFx/
// playDashFx/playAuraFx/playSwarmFx) that GameScene now also calls at the relevant pattern sites
// so the SAME type reads differently depending on attack pattern (spec section 2).
window.PS = window.PS || {};

PS.VFXSystem = class VFXSystem {
  constructor(scene, vfxData, assetManager, effectsData) {
    this.scene = scene;
    this.data = vfxData;
    this.assets = assetManager;
    this.effects = (effectsData && effectsData.effects) || {};
    this.textureCache = {};
    this.emitterCache = {};
    this.graphicsPool = new PS.ObjectPool(
      () => this.scene.add.graphics().setVisible(false),
      (g) => { g.clear(); g.setAlpha(1); g.setScale(1); g.setPosition(0, 0); g.setVisible(true); },
      12
    );
    this.spritePool = new PS.ObjectPool(
      (() => this.scene.add.sprite(0, 0, '__DEFAULT')),
      (s, texture) => { s.setTexture(texture); s.setAlpha(1); s.setScale(1); s.setVisible(true); },
      16
    );
    // Quality scaling (spec sections 28-29): no settings UI exists yet in this project, so this
    // is left as an extensible knob (setQuality) plus automatic P2-first scale-down when a lot
    // of enemies are alive, rather than inventing a full options menu out of scope for this pass.
    this.qualityMult = 1;

    // Per-move signature-shape overrides (2026-10-01 request: "기술 이름이랑 테마에 맞게 VFX").
    // Every renderer above is generic per (type, pattern-group) - good enough for most of the
    // 36-move roster, but a handful of flagship moves get a bespoke CORE SHAPE instead (spec
    // section 14's own examples: 불대문자=큰 X/大자 모양, 백만볼트=낙뢰, 지진=원형충격파+흔들림,
    // 씨뿌리기=씨앗부착+초록이펙트, 문포스=달빛구체, 공수차기=Dash 슬래시). This table is purely
    // ADDITIVE - a move id with no entry here falls straight through to the existing generic
    // pattern-group renderer with zero behavior change, exactly as before this feature existed.
    this.moveOverrides = {
      fire_blast: (typeId, level, p) => this.playFireBlastX(typeId, level, p.x, p.y, p.radius),
      thunderbolt: (typeId, level, p) => this.playLightningStrike(typeId, level, p.x, p.y),
      earthquake: (typeId, level, p) => this.playEarthquakeShock(typeId, level, p.x, p.y, p.radius),
      leech_seed: (typeId, level, p) => this.playSeedAttach(typeId, level, p.x, p.y),
      karate_chop: (typeId, level, p) => this.playKarateChopSlash(typeId, level, p.x, p.y, p.angle),
      // 2026-10-02 batch: the remaining types that only ever got the generic pattern-group look,
      // each given one real-game-style signature move instead (user feedback: don't wait to be
      // told every single one - cover the roster the way an actual Pokemon game would).
      hydro_pump: (typeId, level, p) => this.playHydroSplash(typeId, level, p.x, p.y),
      icicle_crash: (typeId, level, p) => this.playIcicleCrash(typeId, level, p.x, p.y, p.radius),
      sludge_bomb: (typeId, level, p) => this.playSludgeSplat(typeId, level, p.x, p.y, p.radius),
      confuse_ray: (typeId, level, p) => this.playConfuseRings(typeId, level, p.x, p.y, p.radius),
      shadow_ball: (typeId, level, p) => this.playShadowBallBurst(typeId, level, p.x, p.y),
      crunch: (typeId, level, p) => this.playCrunchBite(typeId, level, p.x, p.y),
      flash_cannon: (typeId, level, p) => this.playFlashCannonBurst(typeId, level, p.x, p.y, p.radius),
      rock_throw: (typeId, level, p) => this.playRockDebris(typeId, level, p.x, p.y),
      rock_blast: (typeId, level, p) => this.playRockDebris(typeId, level, p.x, p.y),
      x_scissor: (typeId, level, p) => this.playScissorSlash(typeId, level, p.x, p.y),
      dragon_rush: (typeId, level, p) => this.playDragonRushTrail(typeId, level, p.x, p.y, p.angle),
      wing_attack: (typeId, level, p) => this.playWingSlash(typeId, level, p.x, p.y),
      hyper_beam: (typeId, level, p) => this.playHyperBeamImpact(typeId, level, p.x, p.y)
    };
  }

  // Returns true if a bespoke per-move visual was drawn for `moveId` (caller should skip its own
  // generic call in that case); returns false for every other move, so every existing call site
  // stays correct by just adding "if (!playMoveOverride(...)) { <old generic call> }" around
  // itself - or, for purely additive flourishes (e.g. karate_chop's dash slash), callers may
  // simply fire-and-forget this alongside their existing generic call without checking the
  // return value at all.
  playMoveOverride(moveId, typeId, level, params) {
    const fn = this.moveOverrides[moveId];
    if (!fn) return false;
    try {
      fn(typeId, level, params || {});
      return true;
    } catch (e) {
      return false; // never let a bespoke VFX hiccup break gameplay or break the fallback chain.
    }
  }

  setQuality(level) {
    this.qualityMult = level === 'LOW' ? 0.35 : level === 'MEDIUM' ? 0.65 : 1;
  }

  // Automatic load-based scale-down (P2 first) - spec section 28 "대규모 적 등장 시 VFX 자동 축소".
  loadPressureMult(priority) {
    const activeEnemies = (this.scene.enemyPool && this.scene.enemyPool.activeCount) || 0;
    if (priority === 'P0') return 1; // never scale down boss/evolution/critical/levelup
    if (activeEnemies > 80) return priority === 'P2' ? 0.35 : 0.6;
    if (activeEnemies > 40) return priority === 'P2' ? 0.6 : 0.85;
    return 1;
  }

  // ============================== Textures / tiers (pre-existing) ==============================
  getTexture(typeId) {
    if (!this.textureCache[typeId]) {
      const def = this.data.types[typeId] || this.data.types.normal;
      this.textureCache[typeId] = this.assets.generateVfxTexture(def.shape, def.color);
    }
    return this.textureCache[typeId];
  }

  getTierConfig(level) {
    const tierKey = String(PS.MathUtils.clamp(level, 1, 3));
    const base = this.data.tiers[tierKey];
    if (level <= 3) return { ...base, scale: base.scale, particleCount: base.particleCount };
    const extra = level - 3;
    return {
      ...base,
      scale: base.scale + this.data.growth.scaleStepPerLevelAbove3 * extra,
      particleCount: base.particleCount + this.data.growth.particleStepPerLevelAbove3 * extra
    };
  }

  // ============================== Reusable emitter (perf) ==============================
  // One cached particle emitter PER TYPE, reconfigured and exploded rather than recreated every
  // call (spec section 28: "공격마다 new Particle()을 무제한 생성하는 구조는 피하라"). Falls back
  // to the old create-then-destroy approach if this Phaser build doesn't support setConfig, so
  // this can never hard-crash on an unexpected Phaser version.
  getEmitter(typeId, config) {
    const texture = this.getTexture(typeId);
    let emitter = this.emitterCache[typeId];
    const fullConfig = { emitting: false, blendMode: 'ADD', ...config };
    if (emitter && typeof emitter.setConfig === 'function') {
      emitter.setConfig(fullConfig);
      return emitter;
    }
    if (emitter) emitter.destroy();
    emitter = this.scene.add.particles(0, 0, texture, fullConfig);
    // Bugfix: a freshly-added Phaser game object defaults to depth 0, which sat BELOW hazard
    // zones (3), boss telegraphs (4) and every enemy (5) - most hit/attack particle bursts were
    // rendering partially or fully hidden behind the very enemy they were hitting. Depth 6 keeps
    // them above enemies/enemy HP bars but below the player (10), matching spec section 30's
    // "Player > Boss > Player Attack > ... > Normal Enemy" ordering.
    emitter.setDepth(6);
    this.emitterCache[typeId] = emitter;
    return emitter;
  }

  explodeAt(typeId, x, y, config, quantity) {
    try {
      const emitter = this.getEmitter(typeId, config);
      emitter.explode(Math.max(1, Math.round(quantity)), x, y);
    } catch (e) {
      // Defensive: never let a VFX hiccup break gameplay.
    }
  }

  // ============================== Effect-def lookup (data-driven) ==============================
  getEffectDef(typeId, patternGroup) {
    const pg = (patternGroup || 'Projectile').toLowerCase();
    const t = (typeId || 'normal').toLowerCase();
    return (
      this.effects[`${t}_${pg}`] ||
      this.effects[`${t}_projectile`] ||
      this.effects[`normal_${pg}`] ||
      this.effects.normal_projectile ||
      null
    );
  }

  resolveColor(token, typeId) {
    if (token === 'TYPE_COLOR') {
      const def = this.data.types[typeId] || this.data.types.normal;
      return def.color;
    }
    return token;
  }

  resolveColors(def, typeId) {
    if (!def || !def.colors || def.colors.length === 0) {
      const base = this.data.types[typeId] || this.data.types.normal;
      return [base.color, '#ffffff'];
    }
    return def.colors.map((c) => this.resolveColor(c, typeId));
  }

  // Level-based particle-count scaling (spec section 35: level enhances the LOOK, not the
  // damage/range - damage stays governed entirely by CombatSystem/BuildSystem).
  scaleParticleCount(def, level, priority) {
    const range = (def && def.particleCount) || { min: 4, max: 8 };
    const levelT = PS.MathUtils.clamp((level - 1) / 4, 0, 1); // lv1 -> min, lv5+ -> max
    const base = range.min + (range.max - range.min) * levelT;
    const scaled = base * this.qualityMult * this.loadPressureMult(priority || (def && def.priority));
    return Math.max(2, Math.round(scaled));
  }

  // ============================== Back-compat API (unchanged behavior) ==============================
  playTypeVfx(typeId, level, x, y, angle = 0) {
    const def = this.data.types[typeId] || this.data.types.normal;
    const tier = this.getTierConfig(level);
    this.explodeAt(typeId, x, y, {
      speed: { min: tier.speed * 0.5, max: tier.speed },
      angle: { min: Phaser.Math.RadToDeg(angle) - 25, max: Phaser.Math.RadToDeg(angle) + 25 },
      lifespan: tier.lifespanMs,
      scale: { start: tier.scale, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: this.assets.hexToInt(def.color)
    }, tier.particleCount);
  }

  playCircleVfx(typeId, level, x, y, radius) {
    const def = this.data.types[typeId] || this.data.types.normal;
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.lineStyle(4, this.assets.hexToInt(def.color), 0.9);
    g.strokeCircle(0, 0, radius);
    g.setDepth(5);
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.15,
      duration: 320,
      onComplete: () => this.graphicsPool.release(g)
    });
    this.playTypeVfx(typeId, level, x, y);
  }

  playDeathBurst(x, y, color) {
    const key = 'vfx_deathburst';
    if (!this.scene.textures.exists(key)) this.assets.generateCircleTexture(key, 0xffffff, 6);
    let emitter = this.emitterCache.__deathburst;
    const cfg = { speed: { min: 60, max: 220 }, lifespan: 380, scale: { start: 1, end: 0 }, tint: color, emitting: false };
    if (emitter && typeof emitter.setConfig === 'function') {
      emitter.setConfig(cfg);
    } else {
      if (emitter) emitter.destroy();
      emitter = this.scene.add.particles(0, 0, key, cfg);
      emitter.setDepth(6);
      this.emitterCache.__deathburst = emitter;
    }
    emitter.explode(10, x, y);
  }

  // Back-compat alias - now delegates to the richer playEvolution() sequence with a neutral
  // (Normal-type) palette so any caller that only ever passed (x, y) keeps its exact old
  // "expanding white flash" look as a subset of the fuller sequence.
  playEvolutionFlash(x, y, typeId) {
    this.playEvolution({ type: typeId || 'normal', x, y });
  }

  showFeedbackText(x, y, key) {
    const cfg = this.data.hitFeedback[key];
    if (!cfg || !cfg.text) return;
    const txt = this.scene.add.text(x, y - 30, cfg.text, {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '13px',
      color: cfg.color,
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(30).setScale(cfg.scale);

    this.scene.tweens.add({
      targets: txt,
      y: y - 60,
      alpha: 0,
      duration: 650,
      onComplete: () => txt.destroy()
    });
  }

  // ============================== New: generic attack dispatch ==============================
  // playAttack({type, pattern, level, x, y, angle, x2, y2, radius, points, targetX, targetY}):
  // `pattern` is the RAW gameplay pattern (move.pattern) - this resolves it through
  // VFXPatternMap and routes to the matching renderer below. This is the section-32-recommended
  // API; GameScene's individual pattern branches call the more specific methods directly (so
  // they can pass the exact geometry each pattern already computed), but this dispatcher exists
  // for any simpler future call site (e.g. enemy attacks) that just wants "the right VFX for
  // this type+pattern" without knowing the specific method name.
  playAttack(opts) {
    const group = PS.VFXPatternMap.resolve(opts.pattern);
    switch (group) {
      case 'Beam': return this.playBeam(opts.type, opts.level, opts.x, opts.y, opts.x2 ?? opts.x, opts.y2 ?? opts.y, opts.followEntity);
      case 'Chain': return this.playChain(opts.type, opts.level, opts.points || [{ x: opts.x, y: opts.y }, { x: opts.x2, y: opts.y2 }]);
      case 'GroundZone': return this.playGroundZoneFx(opts.type, opts.level, opts.x, opts.y, opts.radius || 100, opts.durationMs || 2500);
      case 'Dash': return this.playDashFx(opts.type, opts.level, opts.x, opts.y, opts.x2 ?? opts.x, opts.y2 ?? opts.y);
      case 'Aura': return this.playAuraFx(opts.type, opts.level, opts.x, opts.y, opts.radius || 120);
      case 'Swarm': return this.playSwarmFx(opts.type, opts.level, opts.x, opts.y, opts.targetX ?? opts.x, opts.targetY ?? opts.y);
      case 'Explosion': return this.playCircleVfx(opts.type, opts.level, opts.x, opts.y, opts.radius || 100);
      case 'Melee':
      case 'Projectile':
      default:
        return this.playTypeVfx(opts.type, opts.level, opts.x, opts.y, opts.angle || 0);
    }
  }

  // ============================== Beam ==============================
  // `followEntity` (optional, e.g. the Player) fixes a visible desync reported 2026-10-01: the
  // player keeps moving every frame (continuous WASD movement) while this beam's fade plays out
  // over ~300-550ms, so a beam drawn once at the cast-moment position visibly "detaches" from the
  // caster - after ~165-300px/s of movement that's 90-165px of drift, nearly 2-3 player-widths,
  // by the time it fades. When provided, the beam's origin is re-pinned to followEntity's CURRENT
  // position every frame for its whole lifetime (same rotation/length/width, just translated), so
  // it always visibly emits from wherever the caster actually is "right now" instead of "where it
  // was when the attack fired". Purely additive - omitting followEntity keeps the old static look.
  // Builds a closed ribbon polygon running along local +X from 0..length, `waveFn(t)` (t in
  // [0,1]) perturbing the ribbon's centerline sideways - used so a beam's SHAPE, not just its
  // color, reads as a different element (2026-10-02 feedback: "빔들도 그냥 색만 다른거잖아").
  buildRibbonPoints(length, width, segments, waveFn) {
    const top = [];
    const bottom = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = length * t;
      const off = waveFn ? waveFn(t) : 0;
      top.push({ x, y: off - width / 2 });
      bottom.push({ x, y: off + width / 2 });
    }
    return top.concat(bottom.reverse());
  }

  // Per-type beam "wave shapes" (2026-10-02): electric crackles in sharp jagged zigzags, water
  // undulates like a wave/current; everything else stays a clean straight beam (still gets the
  // new 3-tone gradient below). Deterministic-ish randomness is fine here - beams are short-lived
  // and refired often, so a slightly different jagged path each cast reads as "crackling", not buggy.
  getBeamWaveFn(typeId, width) {
    if (typeId === 'electric') {
      const seed = Math.random() * 10;
      return (t) => Math.sin(t * 26 + seed) * width * 0.55 * (1 - Math.abs(t - 0.5) * 0.6);
    }
    if (typeId === 'water') {
      return (t) => Math.sin(t * Math.PI * 3.2) * width * 0.65;
    }
    return null;
  }

  playBeam(typeId, level, x1, y1, x2, y2, followEntity) {
    const def = this.getEffectDef(typeId, 'Beam');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.3;
    const segs = (def && def.timing) || [];
    const activeMs = (segs[1] && segs[1].ms) || 300;
    const fadeMs = (segs[2] && segs[2].ms) || 250;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const length = PS.MathUtils.distance(x1, y1, x2, y2) || 1;
    const width = (16 + level * 2.4) * scale;
    const waveFn = this.getBeamWaveFn(typeId, width);
    const segments = waveFn ? 14 : 1;

    const g = this.graphicsPool.obtain();
    g.setPosition(x1, y1);
    g.setRotation(angle);
    g.setDepth(6);
    // Three-tone gradient band (outer glow -> mid type color -> white-hot core) instead of a
    // flat two-color rectangle, following the beam's wave shape above.
    g.fillStyle(this.assets.hexToInt(colors[1] || colors[0]), 0.32);
    g.fillPoints(this.buildRibbonPoints(length, width, segments, waveFn), true);
    g.fillStyle(this.assets.hexToInt(colors[0]), 0.8);
    g.fillPoints(this.buildRibbonPoints(length, width * 0.55, segments, waveFn), true);
    g.fillStyle(0xffffff, 0.55);
    g.fillPoints(this.buildRibbonPoints(length, width * 0.2, segments, waveFn), true);

    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: activeMs + fadeMs,
      onUpdate: followEntity ? () => { if (followEntity.active !== false) g.setPosition(followEntity.x, followEntity.y); } : undefined,
      onComplete: () => this.graphicsPool.release(g)
    });

    // A few particle puffs riding along the beam length (def.particleCount, quality-scaled).
    // Follows the same waveFn offset as the ribbon above so puffs sit ON the jagged/wavy path
    // instead of cutting straight across it.
    const qty = this.scaleParticleCount(def, level, 'P1');
    const samples = Math.min(4, Math.max(2, Math.round(qty / 3)));
    const perpX = -Math.sin(angle), perpY = Math.cos(angle);
    for (let i = 1; i <= samples; i++) {
      const t = i / (samples + 1);
      const off = waveFn ? waveFn(t) : 0;
      const px = x1 + (x2 - x1) * t + perpX * off;
      const py = y1 + (y2 - y1) * t + perpY * off;
      this.explodeAt(typeId, px, py, {
        speed: { min: 20, max: 60 },
        lifespan: 220,
        scale: { start: 0.7 * scale, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: this.assets.hexToInt(colors[0])
      }, Math.max(1, Math.round(qty / samples)));
    }
    // Endpoint burst.
    this.explodeAt(typeId, x2, y2, {
      speed: { min: 80, max: 220 },
      lifespan: 300,
      scale: { start: scale, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);
  }

  // ============================== Chain ==============================
  playChain(typeId, level, points) {
    if (!points || points.length < 2) return;
    const def = this.getEffectDef(typeId, 'Chain');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.0;
    const perChainMs = (def && def.timing[0] && def.timing[0].ms) || 80;
    const fadeMs = (def && def.timing[1] && def.timing[1].ms) || 150;
    const jagged = typeId === 'electric';

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const g = this.graphicsPool.obtain();
      g.setDepth(7);
      g.lineStyle(3 * scale, this.assets.hexToInt(colors[0]), 0.95);
      g.beginPath();
      if (jagged) {
        const segs = 4;
        const dx = (b.x - a.x) / segs, dy = (b.y - a.y) / segs;
        const nx = -dy, ny = dx;
        const len = Math.hypot(dx, dy) || 1;
        g.moveTo(a.x, a.y);
        for (let s = 1; s < segs; s++) {
          const jitter = (Math.random() - 0.5) * 14;
          g.lineTo(a.x + dx * s + (nx / len) * jitter, a.y + dy * s + (ny / len) * jitter);
        }
        g.lineTo(b.x, b.y);
      } else {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
      g.strokePath();
      this.scene.tweens.add({
        targets: g,
        alpha: 0,
        duration: perChainMs + fadeMs,
        onComplete: () => this.graphicsPool.release(g)
      });
      this.explodeAt(typeId, b.x, b.y, {
        speed: { min: 30, max: 90 },
        lifespan: 200,
        scale: { start: 0.6 * scale, end: 0 },
        tint: this.assets.hexToInt(colors[0])
      }, 3);
    }
  }

  // ============================== GroundZone ==============================
  playGroundZoneFx(typeId, level, x, y, radius, durationMs) {
    const def = this.getEffectDef(typeId, 'GroundZone');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.3;

    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(4);
    g.fillStyle(this.assets.hexToInt(colors[0]), 0.22);
    g.fillCircle(0, 0, radius);
    g.lineStyle(3, this.assets.hexToInt(colors[1] || colors[0]), 0.6);
    g.strokeCircle(0, 0, radius);
    // A handful of static "residue" marks so the zone doesn't read as a plain flat disc.
    const markCount = Math.max(3, Math.round(5 * this.qualityMult));
    g.fillStyle(this.assets.hexToInt(colors[2] || colors[0]), 0.5);
    for (let i = 0; i < markCount; i++) {
      const a = (i / markCount) * Math.PI * 2 + Math.random() * 0.5;
      const r = radius * (0.3 + Math.random() * 0.6);
      g.fillCircle(Math.cos(a) * r, Math.sin(a) * r, 3 + Math.random() * 4 * scale);
    }

    // Pulse in, hold, pulse out over the zone's actual lifetime.
    this.scene.tweens.add({ targets: g, scaleX: 1.06, scaleY: 1.06, duration: 380, yoyo: true, repeat: Math.max(0, Math.round(durationMs / 900) - 1) });
    this.scene.tweens.add({
      targets: g,
      alpha: 0,
      delay: Math.max(0, durationMs - 300),
      duration: 300,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // ============================== Dash ==============================
  playDashFx(typeId, level, x1, y1, x2, y2) {
    const def = this.getEffectDef(typeId, 'Dash');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.2;
    const dashMs = (def && def.timing[1] && def.timing[1].ms) || 250;
    const afterimages = Math.max(3, Math.round(5 * this.qualityMult));

    for (let i = 0; i < afterimages; i++) {
      const t = i / (afterimages - 1 || 1);
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      const s = this.spritePool.obtain(this.getTexture(typeId));
      s.setPosition(px, py);
      s.setDepth(9);
      s.setScale(scale * (0.5 + 0.5 * t));
      s.setTint(this.assets.hexToInt(colors[0]));
      s.setAlpha(0.7 * t + 0.15);
      this.scene.tweens.add({
        targets: s,
        alpha: 0,
        duration: dashMs + 150,
        delay: i * 15,
        onComplete: () => this.spritePool.release(s)
      });
    }
    // End-point burst.
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x2, y2, {
      speed: { min: 90, max: 240 },
      lifespan: 320,
      scale: { start: scale, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);
  }

  // ============================== Aura / Orbit ==============================
  playAuraFx(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Aura');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.1;
    const pulseMs = (def && def.timing[0] && def.timing[0].ms) || 300;

    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(6);
    g.lineStyle(3, this.assets.hexToInt(colors[0]), 0.7);
    g.strokeCircle(0, 0, radius * 0.4);
    g.fillStyle(this.assets.hexToInt(colors[1] || colors[0]), 0.12);
    g.fillCircle(0, 0, radius);
    this.scene.tweens.add({
      targets: g,
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: 0,
      duration: pulseMs,
      onComplete: () => this.graphicsPool.release(g)
    });

    // Small particles orbiting the ring's edge (angle spread all around, per-type shape/color).
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 10, max: 30 },
      lifespan: pulseMs,
      angle: { min: 0, max: 360 },
      scale: { start: 0.5 * scale, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);
  }

  // ============================== Swarm (summon) ==============================
  playSwarmFx(typeId, level, x, y, targetX, targetY) {
    const def = this.getEffectDef(typeId, 'Swarm');
    const colors = this.resolveColors(def, typeId);
    const scale = (def && def.scale) || 1.2;
    const count = Math.min(10, this.scaleParticleCount(def, level, 'P1'));
    const travelMs = (def && def.timing[1] && def.timing[1].ms) || 500;

    for (let i = 0; i < count; i++) {
      const s = this.spritePool.obtain(this.getTexture(typeId));
      const jitterX = (Math.random() - 0.5) * 26;
      const jitterY = (Math.random() - 0.5) * 26;
      s.setPosition(x + jitterX, y + jitterY);
      s.setDepth(9);
      s.setScale(0.55 * scale);
      s.setTint(this.assets.hexToInt(colors[0]));
      this.scene.tweens.add({
        targets: s,
        x: targetX + (Math.random() - 0.5) * 14,
        y: targetY + (Math.random() - 0.5) * 14,
        duration: travelMs + Math.random() * 120,
        delay: i * 25,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          this.spritePool.release(s);
          this.explodeAt(typeId, targetX, targetY, {
            speed: { min: 30, max: 80 }, lifespan: 180, scale: { start: 0.5, end: 0 },
            tint: this.assets.hexToInt(colors[0])
          }, 2);
        }
      });
    }
  }

  // ============================== Hit / Critical (spec sections 22-23) ==============================
  playHit(opts) {
    const { type, x, y, critical } = opts;
    const def = this.getEffectDef(type, critical ? 'Critical' : 'Hit');
    const colors = this.resolveColors(def, type);
    const scale = ((def && def.scale) || (critical ? 1.3 : 0.8));
    const totalMs = ((def && def.timing[0] && def.timing[0].ms) || 40) + ((def && def.timing[1] && def.timing[1].ms) || (critical ? 250 : 150));

    const flash = this.graphicsPool.obtain();
    flash.setPosition(x, y);
    flash.setDepth(11);
    flash.fillStyle(this.assets.hexToInt(colors[1] || '#ffffff'), 0.9);
    flash.fillCircle(0, 0, (critical ? 16 : 9) * scale);
    this.scene.tweens.add({
      targets: flash, alpha: 0, scale: critical ? 1.8 : 1.3, duration: totalMs,
      onComplete: () => this.graphicsPool.release(flash)
    });

    const ring = this.graphicsPool.obtain();
    ring.setPosition(x, y);
    ring.setDepth(11);
    ring.lineStyle(critical ? 3 : 2, this.assets.hexToInt(colors[0]), 0.85);
    ring.strokeCircle(0, 0, (critical ? 10 : 6) * scale);
    this.scene.tweens.add({
      targets: ring, alpha: 0, scale: critical ? 2.6 : 1.8, duration: totalMs,
      onComplete: () => this.graphicsPool.release(ring)
    });

    const qty = this.scaleParticleCount(def, critical ? 5 : 2, 'P0');
    this.explodeAt(type, x, y, {
      speed: { min: critical ? 140 : 70, max: critical ? 320 : 170 },
      lifespan: totalMs + 40,
      angle: { min: 0, max: 360 },
      scale: { start: (critical ? 1.1 : 0.7) * scale, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);

    if (critical) {
      // A single small gold star, per spec section 23.
      const star = this.scene.add.text(x, y - 12, '★', { fontFamily: 'Arial Black', fontSize: '14px', color: '#ffd740' }).setOrigin(0.5).setDepth(12);
      this.scene.tweens.add({ targets: star, y: y - 34, alpha: 0, duration: 380, onComplete: () => star.destroy() });
    }

    // Per-type on-hit signature flourishes (2026-10-02 feedback: "전기는 파지직 거리는 이펙트,
    // 격투는 주먹 모양"). Additive on top of the generic hit flash/ring/burst above - every type
    // still gets those, these are just extra flavor for a couple of types that read especially
    // well with a signature touch. More types can be added the same way later.
    if (type === 'electric') this.playElectricCrackle(x, y, critical);
    if (type === 'fighting') this.playFistImpact(x, y, critical);
  }

  // 전기 (Electric) on-hit: a few jagged little crackle branches radiating out from the hit
  // point, like static discharge - distinct from the generic round burst every other type uses.
  playElectricCrackle(x, y, critical) {
    const branches = critical ? 6 : 4;
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(12);
    g.lineStyle(2, 0xffffff, 0.9);
    for (let i = 0; i < branches; i++) {
      const baseAngle = Math.random() * Math.PI * 2;
      const len = 10 + Math.random() * 10;
      let cx = 0, cy = 0;
      g.beginPath();
      g.moveTo(cx, cy);
      const kinks = 2;
      for (let k = 1; k <= kinks; k++) {
        const a = baseAngle + (Math.random() - 0.5) * 1.2;
        cx += Math.cos(a) * (len / kinks);
        cy += Math.sin(a) * (len / kinks);
        g.lineTo(cx, cy);
      }
      g.strokePath();
    }
    this.scene.tweens.add({
      targets: g, alpha: 0, duration: 160,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // 격투 (Fighting) on-hit: reuses the fighting-type particle texture (already a knuckle-duster
  // silhouette, see AssetManager.generateVfxTexture) at a much larger size as a single "fist mark"
  // stamp at the impact point, instead of only ever appearing tiny inside the generic particle
  // burst.
  playFistImpact(x, y, critical) {
    const sprite = this.spritePool.obtain(this.getTexture('fighting'));
    sprite.setPosition(x, y);
    sprite.setDepth(12);
    sprite.setAngle(Math.random() * 40 - 20);
    sprite.setScale(critical ? 0.4 : 0.2);
    sprite.setAlpha(0.95);
    this.scene.tweens.add({
      targets: sprite,
      scale: (critical ? 2.6 : 2.0),
      alpha: 0,
      duration: 220,
      onComplete: () => this.spritePool.release(sprite)
    });
  }

  // ============================== Skill Level Up (spec section 24, new capability) ==============================
  playLevelUp(opts) {
    const { type, x, y } = opts;
    const def = this.getEffectDef(type, 'LevelUp');
    const colors = this.resolveColors(def, type);
    const chargeMs = (def && def.timing[0] && def.timing[0].ms) || 250;
    const burstMs = (def && def.timing[1] && def.timing[1].ms) || 650;

    const charge = this.graphicsPool.obtain();
    charge.setPosition(x, y);
    charge.setDepth(12);
    charge.fillStyle(this.assets.hexToInt(colors[0]), 0.8);
    charge.fillCircle(0, 0, 4);
    this.scene.tweens.add({ targets: charge, scale: 3, alpha: 0, duration: chargeMs, onComplete: () => this.graphicsPool.release(charge) });

    this.scene.time.delayedCall(chargeMs, () => {
      const ring = this.graphicsPool.obtain();
      ring.setPosition(x, y);
      ring.setDepth(12);
      ring.lineStyle(4, this.assets.hexToInt(colors[0]), 0.9);
      ring.strokeCircle(0, 0, 14);
      this.scene.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: burstMs, onComplete: () => this.graphicsPool.release(ring) });

      const qty = this.scaleParticleCount(def, 3, 'P0');
      this.explodeAt(type, x, y, {
        speed: { min: 60, max: 200 },
        lifespan: burstMs,
        angle: { min: -140, max: -40 }, // rise upward
        scale: { start: 1, end: 0 },
        tint: this.assets.hexToInt(colors[0])
      }, qty);
    });
  }

  // ============================== Pokemon Evolution (spec section 25) ==============================
  playEvolution(opts) {
    const { type, x, y } = opts;
    const def = this.getEffectDef(type, 'Evolution');
    const colors = this.resolveColors(def, type);
    const chargeMs = (def && def.timing[0] && def.timing[0].ms) || 700;
    const revealMs = (def && def.timing[1] && def.timing[1].ms) || 400;
    const fadeMs = (def && def.timing[2] && def.timing[2].ms) || 600;

    // 1) Soft screen dim (never opaque - player must stay visible, spec section 30).
    const dim = this.scene.add.rectangle(0, 0, this.scene.cameras.main.width, this.scene.cameras.main.height, 0x000000, 0)
      .setOrigin(0).setScrollFactor(0).setDepth(19);
    this.scene.tweens.add({ targets: dim, fillAlpha: 0.28, duration: chargeMs * 0.5, yoyo: true, hold: chargeMs * 0.2, onComplete: () => dim.destroy() });

    // 2) Rising energy particles around the subject.
    this.explodeAt(type, x, y, {
      speed: { min: 30, max: 90 },
      lifespan: chargeMs,
      angle: { min: -110, max: -70 },
      scale: { start: 0.8, end: 0 },
      tint: this.assets.hexToInt(colors[1] || colors[0])
    }, this.scaleParticleCount(def, 3, 'P0'));

    // 3) White flash + expanding ring (silhouette reveal), then 4) color burst.
    this.scene.time.delayedCall(chargeMs, () => {
      const flash = this.scene.add.circle(x, y, 10, 0xffffff, 0.95).setDepth(20);
      this.scene.tweens.add({
        targets: flash, radius: 220 * ((def && def.scale) || 2), alpha: 0, duration: revealMs,
        ease: 'Cubic.easeOut', onUpdate: () => flash.setRadius(flash.radius), onComplete: () => flash.destroy()
      });

      this.scene.time.delayedCall(revealMs * 0.4, () => {
        const qty = this.scaleParticleCount(def, 5, 'P0');
        this.explodeAt(type, x, y, {
          speed: { min: 100, max: 260 },
          lifespan: fadeMs,
          angle: { min: 0, max: 360 },
          scale: { start: 1.2, end: 0 },
          tint: this.assets.hexToInt(colors[colors.length - 1] || colors[0])
        }, qty);
      });
    });
  }

  // ============================== Boss Spawn (spec section 26) ==============================
  playBossSpawn(opts) {
    const { x, y, type } = opts;
    const def = this.getEffectDef(type || 'normal', 'BossSpawn');
    const colors = this.resolveColors(def, type || 'normal');
    const telegraphMs = (def && def.timing[0] && def.timing[0].ms) || 700;
    const spawnMs = (def && def.timing[1] && def.timing[1].ms) || 400;

    // Telegraph: pulsing warning ring on the ground, low alpha so it never blocks the view.
    const warn = this.graphicsPool.obtain();
    warn.setPosition(x, y);
    warn.setDepth(4);
    warn.lineStyle(4, this.assets.hexToInt(colors[0]), 0.8);
    warn.strokeCircle(0, 0, 40);
    this.scene.tweens.add({ targets: warn, scale: 3, alpha: 0, duration: telegraphMs, onComplete: () => this.graphicsPool.release(warn) });

    this.scene.time.delayedCall(telegraphMs, () => {
      // Dark/red flash at the spawn point, capped alpha (never a full-screen cover).
      const flash = this.scene.add.circle(x, y, 30, this.assets.hexToInt(colors[0]), 0.5).setDepth(11);
      this.scene.tweens.add({ targets: flash, scale: 4, alpha: 0, duration: spawnMs, onComplete: () => flash.destroy() });

      const shock = this.graphicsPool.obtain();
      shock.setPosition(x, y);
      shock.setDepth(11);
      shock.lineStyle(5, this.assets.hexToInt(colors[1] || colors[0]), 0.9);
      shock.strokeCircle(0, 0, 20);
      this.scene.tweens.add({ targets: shock, scale: 6, alpha: 0, duration: spawnMs + 150, onComplete: () => this.graphicsPool.release(shock) });

      const qty = this.scaleParticleCount(def, 5, 'P0');
      this.explodeAt(type || 'normal', x, y, {
        speed: { min: 120, max: 300 },
        lifespan: spawnMs + 100,
        angle: { min: 0, max: 360 },
        scale: { start: 1.4, end: 0 },
        tint: this.assets.hexToInt(colors[colors.length - 1] || colors[0])
      }, qty);
    });
  }

  // ============================== Signature move overrides ==============================

  // 불대문자 (Fire Blast): the move's real-game trademark look is the Chinese character 大
  // ("big") drawn in flame - two strokes sharing one point (a horizontal bar + a crossing
  // vertical, like 一 crossed by 十) read clearly as an X/大 shape at small scale, then the
  // existing circular-explosion burst/flash plays underneath so it still reads as an explosion,
  // not just abstract lines.
  // Samples a stroke from (x1,y1) to (x2,y2) and scatters small fire-texture puffs along it with
  // a bit of perpendicular jitter, instead of one ruler-straight line - makes the stroke read as
  // "drawn in flame" rather than a solid geometric bar (2026-10-02 feedback: "진짜 불꽃으로 이루어진
  // 불대문자였으면"). A thin bright core line stays underneath so the 大/X silhouette is still
  // crisp at a glance even while the puffs flicker and fade.
  drawFlameStroke(x1, y1, x2, y2, coreColorHex, level) {
    const len = PS.MathUtils.distance(x1, y1, x2, y2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const perpX = -Math.sin(ang), perpY = Math.cos(ang);
    const steps = Math.max(5, Math.round(len / 14));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jitter = (Math.random() - 0.5) * 7;
      const px = x1 + (x2 - x1) * t + perpX * jitter;
      const py = y1 + (y2 - y1) * t + perpY * jitter;
      this.explodeAt('fire', px, py, {
        speed: { min: 10, max: 50 },
        lifespan: 260 + Math.random() * 140,
        scale: { start: 0.65 + Math.random() * 0.4 + level * 0.03, end: 0 },
        alpha: { start: 0.95, end: 0 },
        tint: coreColorHex
      }, 1);
    }
  }

  playFireBlastX(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Explosion');
    const colors = this.resolveColors(def, typeId);
    const r = Math.max(70, radius || 110);
    const fireColor = this.assets.hexToInt(colors[1] || colors[0]);
    const emberColor = this.assets.hexToInt(colors[2] || colors[1] || colors[0]);

    // Thin bright core strokes underneath the flame puffs - keeps the 大/X silhouette crisp.
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(8);
    g.lineStyle(3 + level * 0.4, 0xffd54a, 0.8);
    g.beginPath();
    g.moveTo(-r * 0.8, 0);
    g.lineTo(r * 0.8, 0);
    g.moveTo(-r * 0.7, -r * 0.7);
    g.lineTo(r * 0.7, r * 0.7);
    g.moveTo(r * 0.7, -r * 0.7);
    g.lineTo(-r * 0.7, r * 0.7);
    g.strokePath();

    this.scene.tweens.add({
      targets: g,
      scale: 1.4,
      alpha: 0,
      duration: 420,
      onComplete: () => this.graphicsPool.release(g)
    });

    // The strokes themselves, built out of scattered fire puffs rather than solid bars.
    this.drawFlameStroke(x - r * 0.8, y, x + r * 0.8, y, emberColor, level);
    this.drawFlameStroke(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7, fireColor, level);
    this.drawFlameStroke(x + r * 0.7, y - r * 0.7, x - r * 0.7, y + r * 0.7, fireColor, level);

    const flash = this.scene.add.circle(x, y, r * 0.3, this.assets.hexToInt(colors[0]), 0.35).setDepth(7);
    this.scene.tweens.add({ targets: flash, scale: 2.6, alpha: 0, duration: 380, onComplete: () => flash.destroy() });

    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 90, max: 260 },
      lifespan: 420,
      angle: { min: 0, max: 360 },
      scale: { start: 1.3, end: 0 },
      tint: this.assets.hexToInt(colors[1] || colors[0])
    }, qty + 6);
  }

  // 백만볼트 (Thunderbolt): a single jagged bolt falling from off-screen above straight down onto
  // the target - "낙뢰" (lightning strike from the sky), distinct from the chain pattern's
  // between-two-targets zigzag and from the generic projectile look every other electric hit uses.
  playLightningStrike(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Beam');
    const colors = this.resolveColors(def, typeId);
    const topY = y - 420;

    const g = this.graphicsPool.obtain();
    g.setPosition(0, 0);
    g.setDepth(10);
    g.lineStyle(4 + level, this.assets.hexToInt(colors[0]), 0.95);
    g.beginPath();
    const segs = 6;
    g.moveTo(x, topY);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const nx = x + (Math.random() - 0.5) * 50 * (1 - t * 0.6);
      const ny = topY + (y - topY) * t;
      g.lineTo(nx, ny);
    }
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokePath();

    this.scene.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => this.graphicsPool.release(g) });

    const flash = this.graphicsPool.obtain();
    flash.setPosition(x, y);
    flash.setDepth(10);
    flash.fillStyle(0xffffff, 0.85);
    flash.fillCircle(0, 0, 9 + level * 2);
    this.scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 260, onComplete: () => this.graphicsPool.release(flash) });

    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 80, max: 240 },
      lifespan: 260,
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);

    this.scene.cameras.main.flash(80, 255, 255, 220, false);
  }

  // 지진 (Earthquake): 원형충격파 + 지면흔들림 - two offset expanding shockwave rings, radiating
  // ground-crack lines, and an actual brief camera shake so it reads as the ground itself moving,
  // not just another circle burst.
  playEarthquakeShock(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Explosion');
    const colors = this.resolveColors(def, typeId);
    const r = radius || 150;

    for (let i = 0; i < 2; i++) {
      const g = this.graphicsPool.obtain();
      g.setPosition(x, y);
      g.setDepth(4);
      g.lineStyle(6 - i * 2, this.assets.hexToInt(colors[i] || colors[0]), 0.85 - i * 0.2);
      g.strokeCircle(0, 0, r * (0.3 + i * 0.1));
      this.scene.tweens.add({
        targets: g,
        scaleX: 1 + 0.9 * (i + 1),
        scaleY: 1 + 0.9 * (i + 1),
        alpha: 0,
        duration: 420 + i * 120,
        delay: i * 90,
        onComplete: () => this.graphicsPool.release(g)
      });
    }

    const lineCount = 6;
    const g2 = this.graphicsPool.obtain();
    g2.setPosition(x, y);
    g2.setDepth(4);
    g2.lineStyle(3, this.assets.hexToInt(colors[1] || colors[0]), 0.7);
    for (let i = 0; i < lineCount; i++) {
      const a = (i / lineCount) * Math.PI * 2 + Math.random() * 0.3;
      g2.beginPath();
      g2.moveTo(0, 0);
      g2.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      g2.strokePath();
    }
    this.scene.tweens.add({ targets: g2, alpha: 0, duration: 500, onComplete: () => this.graphicsPool.release(g2) });

    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 40, max: 140 },
      lifespan: 420,
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      tint: this.assets.hexToInt(colors[0])
    }, qty);

    this.scene.cameras.main.shake(260 + level * 10, 0.0045 + level * 0.0004);
  }

  // 씨뿌리기 (Leech Seed): 씨앗 부착 + 초록 지속 이펙트 - a small seed pod drops and "sticks" to
  // the target, with a lingering green ring that reads as the ongoing drain rather than a one-shot
  // hit. Called from the shared on-hit path, so it layers on top of (not instead of) the normal
  // hit feedback every move already gets.
  playSeedAttach(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'GroundZone');
    const colors = this.resolveColors(def, typeId);
    const seedColor = this.assets.hexToInt('#558b2f');

    const seed = this.graphicsPool.obtain();
    seed.setPosition(x, y - 6);
    seed.setDepth(8);
    seed.fillStyle(0x5d3a1a, 0.95);
    seed.fillEllipse(0, 0, 7, 10);
    this.scene.tweens.add({
      targets: seed,
      y: y + 4,
      duration: 260,
      ease: 'Bounce.easeOut',
      onComplete: () => this.scene.tweens.add({
        targets: seed, alpha: 0, delay: 500, duration: 300, onComplete: () => this.graphicsPool.release(seed)
      })
    });

    const ring = this.graphicsPool.obtain();
    ring.setPosition(x, y);
    ring.setDepth(7);
    ring.lineStyle(2, this.assets.hexToInt(colors[0]) || seedColor, 0.8);
    ring.strokeCircle(0, 0, 14);
    this.scene.tweens.add({
      targets: ring, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 900,
      onComplete: () => this.graphicsPool.release(ring)
    });

    const qty = Math.max(3, this.scaleParticleCount(def, level, 'P2'));
    this.explodeAt(typeId, x, y, {
      speed: { min: 10, max: 40 },
      lifespan: 600,
      angle: { min: -140, max: -40 },
      scale: { start: 0.6, end: 0 },
      tint: seedColor
    }, qty);
  }

  // 공수차기 (Karate Chop / Fighting Dash): a bright chop-arc slash at the landing point, layered
  // ON TOP OF the existing dash trail+shockwave (playDashFx) - purely additive, so every other
  // dash-pattern move (aqua_jet, dragon_rush) keeps its current look untouched.
  playKarateChopSlash(typeId, level, x, y, angle) {
    const def = this.getEffectDef(typeId, 'Dash');
    const colors = this.resolveColors(def, typeId);
    const len = 46 + level * 3;

    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setRotation(angle || 0);
    g.setDepth(9);
    g.lineStyle(5, 0xffffff, 0.95);
    g.beginPath();
    g.arc(0, 0, len * 0.5, Phaser.Math.DegToRad(-50), Phaser.Math.DegToRad(50), false);
    g.strokePath();
    g.lineStyle(3, this.assets.hexToInt(colors[0]), 0.9);
    g.beginPath();
    g.arc(0, 0, len * 0.5, Phaser.Math.DegToRad(-40), Phaser.Math.DegToRad(40), false);
    g.strokePath();

    this.scene.tweens.add({
      targets: g, alpha: 0, scaleX: 1.4, scaleY: 1.4, duration: 180,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // 하이드로펌프 (Hydro Pump): a heavy water impact - two expanding foam/wave rings plus droplets
  // flung outward, layered on top of the wavy beam corridor so the actual landing point reads as
  // a real water blast, not just a line stopping.
  playHydroSplash(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Hit');
    const colors = this.resolveColors(def, typeId);
    for (let i = 0; i < 2; i++) {
      const ring = this.graphicsPool.obtain();
      ring.setPosition(x, y);
      ring.setDepth(7);
      ring.lineStyle(3 - i, i === 0 ? 0xffffff : this.assets.hexToInt(colors[0]), 0.8 - i * 0.2);
      ring.strokeCircle(0, 0, 10 + i * 6);
      this.scene.tweens.add({
        targets: ring, scaleX: 2.4 + i * 0.6, scaleY: 2.4 + i * 0.6, alpha: 0, duration: 340 + i * 100,
        onComplete: () => this.graphicsPool.release(ring)
      });
    }
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 60, max: 200 }, lifespan: 320, angle: { min: -160, max: -20 },
      scale: { start: 0.9, end: 0 }, tint: this.assets.hexToInt(colors[0])
    }, qty);
  }

  // 아이시클크래시 (Icicle Crash): a solid icicle falls from above and shatters on impact, instead
  // of the generic round burst every other strike-pattern move uses.
  playIcicleCrash(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Explosion');
    const colors = this.resolveColors(def, typeId);
    const topY = y - 260;
    const icicle = this.graphicsPool.obtain();
    icicle.setPosition(x, topY);
    icicle.setDepth(9);
    icicle.fillStyle(this.assets.hexToInt(colors[0]), 0.9);
    icicle.fillTriangle(-7, 0, 7, 0, 0, 46);
    icicle.lineStyle(1.5, 0xffffff, 0.8);
    icicle.strokeTriangle(-7, 0, 7, 0, 0, 46);
    this.scene.tweens.add({
      targets: icicle, y, duration: 180, ease: 'Cubic.easeIn',
      onComplete: () => {
        this.graphicsPool.release(icicle);
        const qty = this.scaleParticleCount(def, level, 'P1');
        this.explodeAt(typeId, x, y, {
          speed: { min: 80, max: 220 }, lifespan: 340, angle: { min: 0, max: 360 },
          scale: { start: 0.9, end: 0 }, tint: this.assets.hexToInt(colors[0])
        }, qty + 4);
        const flash = this.scene.add.circle(x, y, (radius || 60) * 0.25, 0xffffff, 0.5).setDepth(8);
        this.scene.tweens.add({ targets: flash, scale: 2.2, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
      }
    });
  }

  // 오물폭탄 (Sludge Bomb): a purple sludge blob arcs down and splats into a dripping puddle ring.
  playSludgeSplat(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Explosion');
    const colors = this.resolveColors(def, typeId);
    const blob = this.graphicsPool.obtain();
    blob.setPosition(x, y - 70);
    blob.setDepth(9);
    blob.fillStyle(this.assets.hexToInt(colors[0]), 0.9);
    blob.fillCircle(0, 0, 9);
    this.scene.tweens.add({
      targets: blob, y, duration: 160, ease: 'Cubic.easeIn',
      onComplete: () => {
        this.graphicsPool.release(blob);
        const puddle = this.graphicsPool.obtain();
        puddle.setPosition(x, y);
        puddle.setDepth(4);
        puddle.fillStyle(this.assets.hexToInt(colors[0]), 0.5);
        puddle.fillEllipse(0, 0, (radius || 70) * 0.5, (radius || 70) * 0.22);
        this.scene.tweens.add({ targets: puddle, alpha: 0, delay: 400, duration: 350, onComplete: () => this.graphicsPool.release(puddle) });
        const qty = this.scaleParticleCount(def, level, 'P1');
        this.explodeAt(typeId, x, y, {
          speed: { min: 50, max: 160 }, lifespan: 300, angle: { min: -160, max: -20 },
          scale: { start: 0.8, end: 0 }, tint: this.assets.hexToInt(colors[0])
        }, qty);
      }
    });
  }

  // 혼란의빛 (Confuse Ray): soft pastel rings expand and rotate around the target with a couple of
  // orbiting sparkle stars - a dizzying "hypnosis" look instead of the generic circle burst.
  playConfuseRings(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Circle');
    const colors = this.resolveColors(def, typeId);
    for (let i = 0; i < 2; i++) {
      const ring = this.graphicsPool.obtain();
      ring.setPosition(x, y);
      ring.setDepth(7);
      ring.lineStyle(2, this.assets.hexToInt(colors[i] || colors[0]), 0.75);
      ring.strokeEllipse(0, 0, 18 + i * 10, 7 + i * 4);
      this.scene.tweens.add({
        targets: ring, angle: 180, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 500 + i * 120,
        onComplete: () => this.graphicsPool.release(ring)
      });
    }
    const starCount = 3;
    for (let i = 0; i < starCount; i++) {
      const a = (i / starCount) * Math.PI * 2;
      const star = this.scene.add.text(x + Math.cos(a) * 16, y - 14 + Math.sin(a) * 6, '✦', {
        fontFamily: 'Arial', fontSize: '12px', color: '#ce93d8'
      }).setOrigin(0.5).setDepth(11);
      this.scene.tweens.add({
        targets: star, y: star.y - 10, alpha: 0, duration: 420, delay: i * 60,
        onComplete: () => star.destroy()
      });
    }
  }

  // 섀도볼 (Shadow Ball): the projectile orb bursts into dark rings + dispersing wisps on impact.
  playShadowBallBurst(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Hit');
    const colors = this.resolveColors(def, typeId);
    const ring = this.graphicsPool.obtain();
    ring.setPosition(x, y);
    ring.setDepth(11);
    ring.lineStyle(2.5, this.assets.hexToInt(colors[0]), 0.85);
    ring.strokeCircle(0, 0, 8);
    this.scene.tweens.add({
      targets: ring, scaleX: 2.6, scaleY: 2.6, alpha: 0, duration: 300,
      onComplete: () => this.graphicsPool.release(ring)
    });
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 20, max: 90 }, lifespan: 420, angle: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: this.assets.hexToInt(colors[0])
    }, qty + 4);
  }

  // 크런치 (Crunch): two curved fang shapes snap shut on the target - a quick bite-mark instead of
  // the generic projectile hit flash.
  playCrunchBite(typeId, level, x, y) {
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(11);
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(-12, -10, -2, -2, -14, -1);
    g.fillTriangle(12, -10, 2, -2, 14, -1);
    g.fillTriangle(-12, 10, -2, 2, -14, 1);
    g.fillTriangle(12, 10, 2, 2, 14, 1);
    this.scene.tweens.add({
      targets: g, scaleX: 0.3, scaleY: 0.3, alpha: 0, duration: 200,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // 플래시캐논 (Flash Cannon): a blinding white-silver flash with a metallic ring shockwave.
  playFlashCannonBurst(typeId, level, x, y, radius) {
    const def = this.getEffectDef(typeId, 'Explosion');
    const colors = this.resolveColors(def, typeId);
    const flash = this.scene.add.circle(x, y, (radius || 90) * 0.3, 0xffffff, 0.85).setDepth(9);
    this.scene.tweens.add({ targets: flash, scale: 3, alpha: 0, duration: 280, onComplete: () => flash.destroy() });
    const ring = this.graphicsPool.obtain();
    ring.setPosition(x, y);
    ring.setDepth(8);
    ring.lineStyle(4, this.assets.hexToInt(colors[0]), 0.9);
    ring.strokeCircle(0, 0, (radius || 90) * 0.35);
    this.scene.tweens.add({
      targets: ring, scaleX: 2.2, scaleY: 2.2, alpha: 0, duration: 350,
      onComplete: () => this.graphicsPool.release(ring)
    });
    this.scene.cameras.main.flash(60, 255, 255, 255, false);
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 80, max: 220 }, lifespan: 300, angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 }, tint: 0xe8eaf6
    }, qty);
  }

  // 돌떨구기/바위 공격: a couple of rock chunks (reusing the rock-type particle texture, scaled
  // way up) tumble down and crash onto the target with a dust puff.
  playRockDebris(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Hit');
    const chunkCount = 2 + Math.min(2, Math.floor(level / 2));
    for (let i = 0; i < chunkCount; i++) {
      const fromX = x + (Math.random() - 0.5) * 50;
      const sprite = this.spritePool.obtain(this.getTexture('rock'));
      sprite.setPosition(fromX, y - 60 - Math.random() * 30);
      sprite.setDepth(9);
      sprite.setScale(1.4 + Math.random() * 0.6);
      sprite.setAngle(Math.random() * 360);
      this.scene.tweens.add({
        targets: sprite, x, y, angle: sprite.angle + 180, duration: 220 + i * 40, ease: 'Cubic.easeIn',
        onComplete: () => { this.spritePool.release(sprite); }
      });
    }
    this.scene.time.delayedCall(240, () => {
      const dust = this.graphicsPool.obtain();
      dust.setPosition(x, y);
      dust.setDepth(4);
      dust.fillStyle(0xbcaaa4, 0.6);
      dust.fillCircle(0, 0, 14);
      this.scene.tweens.add({
        targets: dust, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 260,
        onComplete: () => this.graphicsPool.release(dust)
      });
    });
  }

  // 엑스어썸 (X-Scissor): two crossing saber-slash arcs forming an X, like scissor blades snapping
  // shut on the target - distinct from fire_blast's straight-line 大/X (these are curved arcs).
  playScissorSlash(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Hit');
    const colors = this.resolveColors(def, typeId);
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(11);
    g.lineStyle(3, this.assets.hexToInt(colors[0]), 0.95);
    g.beginPath();
    g.arc(0, 0, 14, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(30), false);
    g.strokePath();
    g.beginPath();
    g.arc(0, 0, 14, Phaser.Math.DegToRad(150), Phaser.Math.DegToRad(240), false);
    g.strokePath();
    this.scene.tweens.add({
      targets: g, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 180,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // 드래곤러쉬 (Dragon Rush): a glowing draconic streak trails behind the dash and bursts at the
  // landing point, instead of the generic dash trail every other dash move uses alone.
  playDragonRushTrail(typeId, level, x, y, angle) {
    const def = this.getEffectDef(typeId, 'Dash');
    const colors = this.resolveColors(def, typeId);
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setRotation(angle || 0);
    g.setDepth(9);
    g.lineStyle(5, this.assets.hexToInt(colors[0]), 0.85);
    g.beginPath();
    g.moveTo(-40, 0);
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      g.lineTo(-40 + 40 * t, Math.sin(t * Math.PI * 2.4) * 6);
    }
    g.strokePath();
    this.scene.tweens.add({
      targets: g, alpha: 0, scaleX: 1.3, duration: 220,
      onComplete: () => this.graphicsPool.release(g)
    });
    const qty = this.scaleParticleCount(def, level, 'P1');
    this.explodeAt(typeId, x, y, {
      speed: { min: 60, max: 180 }, lifespan: 300, angle: { min: 0, max: 360 },
      scale: { start: 1.0, end: 0 }, tint: this.assets.hexToInt(colors[0])
    }, qty);
  }

  // 윙어택 (Wing Attack): a single crescent-moon wing-blade slash at the hit point.
  playWingSlash(typeId, level, x, y) {
    const def = this.getEffectDef(typeId, 'Hit');
    const colors = this.resolveColors(def, typeId);
    const g = this.graphicsPool.obtain();
    g.setPosition(x, y);
    g.setDepth(11);
    g.setRotation(Math.random() * Math.PI * 2);
    g.lineStyle(3.5, this.assets.hexToInt(colors[0]), 0.9);
    g.beginPath();
    g.arc(0, 0, 13, Phaser.Math.DegToRad(-70), Phaser.Math.DegToRad(70), false);
    g.strokePath();
    this.scene.tweens.add({
      targets: g, scaleX: 1.8, scaleY: 1.8, alpha: 0, duration: 200,
      onComplete: () => this.graphicsPool.release(g)
    });
  }

  // 하이퍼빔 (Hyper Beam): the roster's heaviest-hitting ultimate gets an oversized impact flash
  // at every point it connects, instead of the same small hit flash as a basic attack.
  playHyperBeamImpact(typeId, level, x, y) {
    const flash = this.scene.add.circle(x, y, 18, 0xfff176, 0.85).setDepth(11);
    this.scene.tweens.add({ targets: flash, scale: 2.6, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
    const qty = this.scaleParticleCount(this.getEffectDef(typeId, 'Hit'), level, 'P0');
    this.explodeAt(typeId, x, y, {
      speed: { min: 100, max: 260 }, lifespan: 360, angle: { min: 0, max: 360 },
      scale: { start: 1.3, end: 0 }, tint: 0xfff176
    }, qty + 6);
  }
};
