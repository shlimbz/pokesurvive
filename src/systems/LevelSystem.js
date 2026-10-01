// LevelSystem: EXP curve + the 3-card Common..Legendary level-up choice system
// (spec sections 36-39, 64-68). Generates data-driven choices and applies them to BuildSystem.
window.PS = window.PS || {};

PS.LevelSystem = class LevelSystem {
  constructor(balanceData, managers) {
    this.balance = balanceData;
    this.managers = managers;
  }

  expForLevel(level) {
    const c = this.balance.expCurve;
    return Math.round(c.base * Math.pow(c.growth, level - 1));
  }

  /** Returns how many level-ups just happened (mutates build.level / build.exp). */
  consumeLevelUps(build) {
    let count = 0;
    while (build.exp >= this.expForLevel(build.level)) {
      build.exp -= this.expForLevel(build.level);
      build.level++;
      count++;
    }
    return count;
  }

  computeGradeWeights(runTimeSec) {
    const r = this.balance.rarity;
    const minutes = Math.floor(runTimeSec / 60);
    const weights = {};
    for (const grade of r.order) {
      const base = r.baseWeights[grade];
      const perMin = r.timeScaling.perMinute[grade] || 0;
      const min = r.timeScaling.minWeights[grade];
      weights[grade] = Math.max(min, base + perMin * minutes);
    }
    return weights;
  }

  generateChoices(build, runTimeSec) {
    const weights = this.computeGradeWeights(runTimeSec);
    const kinds = ['move', 'item', 'ability', 'stat'];
    const choices = [];
    let attempts = 0;
    // relic_opportunity: +1 card per relic level (default is 3 cards).
    const targetCount = 3 + (build.modifiers.extraLevelUpChoices || 0);

    while (choices.length < targetCount && attempts < 60) {
      attempts++;
      const grade = PS.RandomUtils.weightedPick(weights);
      const kind = PS.RandomUtils.pick(kinds);
      const candidate = this.buildCandidate(kind, grade, build);
      if (!candidate) continue;
      const dupe = choices.some(c => c.kind === candidate.kind && c.id === candidate.id);
      if (dupe) continue;
      choices.push(candidate);
    }

    // Guaranteed fallback: stat upgrades are (almost) always available.
    while (choices.length < targetCount) {
      const statKeys = Object.keys(build.statPicks).filter(k => build.statPicks[k] < this.balance.maxLevels.stat);
      if (statKeys.length === 0) break;
      const id = PS.RandomUtils.pick(statKeys);
      const grade = PS.RandomUtils.weightedPick(weights);
      choices.push({ kind: 'stat', grade, id, isNew: false });
    }

    return choices;
  }

  buildCandidate(kind, grade, build) {
    if (kind === 'move') return this.candidateMove(grade, build);
    if (kind === 'item') return this.candidateItem(grade, build);
    if (kind === 'ability') return this.candidateAbility(grade, build);
    return this.candidateStat(grade, build);
  }

  candidateMove(grade, build) {
    const maxLv = this.balance.maxLevels.move;
    const owned = build.getOwnedMoveIds().filter(id => build.getMoveLevel(id) < maxLv);
    const learnable = this.managers.move
      .getLearnableMovesForTypes(build.species.types, build.getOwnedMoveIds())
      .map(m => m.id);

    const pool = [
      ...owned.map(id => ({ id, isNew: false })),
      ...learnable.map(id => ({ id, isNew: true }))
    ];
    if (pool.length === 0) return null;
    const pick = PS.RandomUtils.pick(pool);
    return { kind: 'move', grade, id: pick.id, isNew: pick.isNew };
  }

  candidateItem(grade, build) {
    // Bugfix (2026-10-01): a prior pass restricted this pool to never-picked items only, to stop
    // late-game cards being flooded with "level up something you already have" options. That
    // fixed the flooding but went too far the other way - items.json's effects scale by level
    // (ItemSystem: effect.value * level, up to item.maxLevel, usually 5), so an owned item was
    // actually getting PERMANENTLY stuck at its Lv1 (20%-of-max) value for the rest of the run,
    // with no way to ever re-pick it. That's the opposite of "선택이 유기적으로 작용" - a build
    // leaning into one type/pattern synergy item could never double down on it, no matter how
    // many level-ups passed. Brought back in line with how candidateMove/candidateAbility both
    // already work (new OR owned-but-not-maxed both qualify) - owned items just aren't filtered
    // out anymore - while still weighting toward NEW items 2:1 so the pool doesn't overwhelmingly
    // turn into "re-level your first few items" once a build has picked a handful.
    const maxLv = this.balance.maxLevels.item;
    const eligible = (list) => list.filter(i => build.getItemLevel(i.id) < (i.maxLevel || maxLv));
    const buildPool = (list) => {
      const pool = [];
      for (const i of eligible(list)) {
        const isNew = build.getItemLevel(i.id) === 0;
        pool.push({ item: i, isNew });
        if (isNew) pool.push({ item: i, isNew }); // 2:1 weighting toward discovery over re-leveling
      }
      return pool;
    };
    let pool = buildPool(this.managers.item.getAllByGrade(grade));
    if (pool.length === 0) {
      pool = buildPool(this.managers.item.getAllIds().map(id => this.managers.item.getItem(id)));
    }
    if (pool.length === 0) return null;
    const pick = PS.RandomUtils.pick(pool);
    return { kind: 'item', grade, id: pick.item.id, isNew: pick.isNew };
  }

  candidateAbility(grade, build) {
    const maxLv = this.balance.maxLevels.ability;
    let pool = this.managers.ability.getAllIds()
      .map(id => this.managers.ability.getAbility(id))
      .filter(a => a.grade === grade && build.getAbilityLevel(a.id) < maxLv);
    if (pool.length === 0) {
      pool = this.managers.ability.getAllIds()
        .map(id => this.managers.ability.getAbility(id))
        .filter(a => build.getAbilityLevel(a.id) < maxLv);
    }
    if (pool.length === 0) return null;
    const ability = PS.RandomUtils.pick(pool);
    return { kind: 'ability', grade, id: ability.id, isNew: build.getAbilityLevel(ability.id) === 0 };
  }

  candidateStat(grade, build) {
    const statKeys = Object.keys(build.statPicks).filter(k => build.statPicks[k] < this.balance.maxLevels.stat);
    if (statKeys.length === 0) return null;
    const id = PS.RandomUtils.pick(statKeys);
    return { kind: 'stat', grade, id, isNew: false };
  }

  applyChoice(build, choice) {
    switch (choice.kind) {
      case 'move': build.learnOrUpgradeMove(choice.id); break;
      case 'item': build.addOrUpgradeItem(choice.id); break;
      case 'ability': build.addOrUpgradeAbility(choice.id); break;
      case 'stat': build.upgradeStat(choice.id, choice.grade); break;
    }
  }

  describeChoice(choice, build) {
    const statLabels = { hp: 'HP', attack: '공격', defense: '방어', spAttack: '특수공격', spDefense: '특수방어', speed: '스피드' };
    const categoryLabels = { physical: '물리', special: '특수', status: '변화' };
    if (choice.kind === 'move') {
      const move = this.managers.move.getMove(choice.id);
      const level = build.getMoveLevel(choice.id);
      const dmgMultTable = PS.Game.combat.moveLevelDamageMult;
      const isStab = build.species.types.includes(move.type);

      // Core line: type / pattern / category / power, so the player knows AT A GLANCE what
      // this move actually does on the field - not just its flavor stats.
      const parts = [
        `${PS.typeNameKo(move.type)}${isStab ? '(STAB)' : ''}`,
        PS.patternNameKo(move.pattern),
        categoryLabels[move.category] || move.category,
        `위력 ${move.baseDamage}`
      ];
      // Reach: melee uses `range` as its hit radius, area moves use `areaRadius`, everything
      // else (projectile/spread/beam/chain/homing/boomerang) uses `range` as travel distance.
      const reach = move.pattern === 'circle' || move.pattern === 'orbit' ? move.areaRadius : move.range;
      if (reach) parts.push(`사거리 ${Math.round(reach * build.modifiers.rangeMult)}`);
      if (move.cooldownMs) parts.push(`쿨타임 ${(move.cooldownMs / 1000).toFixed(1)}초`);

      const statusDef = move.statusEffect || (move.statusOnly ? { id: move.statusOnly.status, chance: move.statusOnly.chance } : null);
      if (statusDef) parts.push(`${PS.statusNameKo(statusDef.id)} ${Math.round(statusDef.chance * 100)}%`);

      let subtitle;
      if (choice.isNew) {
        subtitle = '새로운 기술';
      } else {
        const curMult = dmgMultTable[Math.min(level, 5) - 1];
        const nextMult = dmgMultTable[Math.min(level + 1, 5) - 1];
        const pct = Math.round((nextMult / curMult - 1) * 100);
        subtitle = `Lv${level} → Lv${level + 1} (위력 +${pct}%)`;
      }

      return { title: move.name, subtitle, body: parts.join(' · ') };
    }
    if (choice.kind === 'item') {
      const item = this.managers.item.getItem(choice.id);
      const level = build.getItemLevel(choice.id);
      return {
        title: item.name,
        subtitle: choice.isNew ? '새로운 아이템' : `Lv${level} → Lv${level + 1}`,
        body: item.description || item.category
      };
    }
    if (choice.kind === 'ability') {
      const ability = this.managers.ability.getAbility(choice.id);
      const level = build.getAbilityLevel(choice.id);
      return {
        title: ability.name,
        subtitle: choice.isNew ? '새로운 특성' : `Lv${level} → Lv${level + 1}`,
        body: ability.description
      };
    }
    // stat
    const cfg = this.balance.statUpgrade[choice.grade];
    const extraLabels = {
      minor_regen: '체력 서서히 재생',
      conditional_shield: '치명적 피해를 1회 무효화'
    };
    return {
      title: `${statLabels[choice.id]} 강화`,
      subtitle: `+${Math.round(cfg.percent * 100)}%`,
      body: cfg.extra ? `추가 효과: ${extraLabels[cfg.extra] || cfg.extra}` : '능력치가 영구적으로 증가합니다.'
    };
  }
};
