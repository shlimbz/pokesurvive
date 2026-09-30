// LevelUpScene: overlay launched on top of GameScene showing 3 Common..Legendary cards
// (spec sections 36-39, 64-68). Picking one calls back into GameScene to apply + resume.
window.PS = window.PS || {};

PS.LevelUpScene = class LevelUpScene extends Phaser.Scene {
  constructor() {
    super('LevelUp');
  }

  init(payload) {
    this.payload = payload;
  }

  create() {
    const { width, height } = this.cameras.main;
    const { build, audio } = this.payload;

    this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setOrigin(0).setScrollFactor(0).setDepth(0);
    this.add.text(width / 2, 60, '레벨 업!', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#ffd400', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5).setDepth(1);
    this.add.text(width / 2, 96, `Lv.${build.level}`, { fontFamily: 'Arial', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(1);

    // relic_reroll: a limited number of re-draws of the whole card row, replenished each time
    // this screen opens (not carried over between level-ups).
    this.rerollsLeft = build.modifiers.extraRerolls || 0;
    this.cardContainer = this.add.container(0, 0).setDepth(0);
    if (this.rerollsLeft > 0) {
      this.rerollText = this.add.text(width / 2, height - 34, '', {
        fontFamily: 'Arial Black', fontSize: '14px', color: '#8fd3ff'
      }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true });
      this.rerollText.on('pointerover', () => { if (this.rerollsLeft > 0) this.rerollText.setColor('#ffffff'); });
      this.rerollText.on('pointerout', () => this.rerollText.setColor('#8fd3ff'));
      this.rerollText.on('pointerdown', () => this.doReroll());
      this.input.keyboard.on('keydown-R', () => this.doReroll());
      this.updateRerollLabel();
    }

    this.renderCards(this.payload.choices);
  }

  updateRerollLabel() {
    if (!this.rerollText) return;
    this.rerollText.setText(this.rerollsLeft > 0 ? `[R] 다시 뽑기 (${this.rerollsLeft}회 남음)` : '');
  }

  doReroll() {
    if (this.rerollsLeft <= 0) return;
    this.rerollsLeft--;
    this.updateRerollLabel();
    const { build, levelSystem, audio, runTimeSec } = this.payload;
    if (audio) audio.playCardHover();
    const newChoices = levelSystem.generateChoices(build, runTimeSec || 0);
    this.payload.choices = newChoices;
    this.renderCards(newChoices);
  }

  renderCards(choices) {
    this.cardContainer.removeAll(true);
    this.input.keyboard.removeAllListeners('keydown-ONE');
    this.input.keyboard.removeAllListeners('keydown-TWO');
    this.input.keyboard.removeAllListeners('keydown-THREE');
    this.input.keyboard.removeAllListeners('keydown-FOUR');

    const { width, height } = this.cameras.main;
    const balance = PS.Game.data.balance;
    const { build, levelSystem, onChosen, audio } = this.payload;

    const cardW = 220, cardH = 300, gap = 24;
    const totalW = choices.length * cardW + (choices.length - 1) * gap;
    const startX = width / 2 - totalW / 2 + cardW / 2;

    // How flashy each grade's presentation gets - higher grades get a thicker glowing
    // border, a pulsing animation, a background tint wash, and an orbiting sparkle burst,
    // so a Legendary card is unmistakable at a glance even without reading the text.
    const FLAIR = {
      common:    { glowLayers: 0, pulse: false, particles: 0,  borderW: 3, bgTint: 0x181c22, bgAlpha: 0.96, fontScale: 1.0 },
      uncommon:  { glowLayers: 1, pulse: false, particles: 0,  borderW: 3, bgTint: 0x182420, bgAlpha: 0.96, fontScale: 1.0 },
      rare:      { glowLayers: 1, pulse: false, particles: 6,  borderW: 4, bgTint: 0x131e28, bgAlpha: 0.97, fontScale: 1.05 },
      epic:      { glowLayers: 2, pulse: true,  particles: 10, borderW: 4, bgTint: 0x1e1428, bgAlpha: 0.97, fontScale: 1.1 },
      legendary: { glowLayers: 3, pulse: true,  particles: 16, borderW: 5, bgTint: 0x2a2010, bgAlpha: 0.98, fontScale: 1.2 }
    };

    const keyNames = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    choices.forEach((choice, i) => {
      const x = startX + i * (cardW + gap);
      const y = height / 2 + 10;
      const gradeColor = balance.rarity.colors[choice.grade];
      const gradeColorHex = this.hex(gradeColor);
      const flair = FLAIR[choice.grade] || FLAIR.common;
      const desc = levelSystem.describeChoice(choice, build);

      // Outer glow: extra faint rectangles behind the card, more of them (and further out)
      // for higher grades, giving a soft halo without needing any external art.
      for (let g = flair.glowLayers; g >= 1; g--) {
        const pad = g * 7;
        this.cardContainer.add(
          this.add.rectangle(x, y, cardW + pad * 2, cardH + pad * 2, gradeColorHex, 0.10 / g).setDepth(0)
        );
      }

      const card = this.add.rectangle(x, y, cardW, cardH, flair.bgTint, flair.bgAlpha).setStrokeStyle(flair.borderW, gradeColorHex).setDepth(1);
      this.cardContainer.add(card);
      this.cardContainer.add(this.add.text(x, y - cardH / 2 + 22, this.stars(choice.grade), { fontFamily: 'Arial', fontSize: '16px', color: gradeColor }).setOrigin(0.5).setDepth(2));
      this.cardContainer.add(this.add.text(x, y - cardH / 2 + 46, PS.rarityNameKo(choice.grade), {
        fontFamily: 'Arial Black', fontSize: `${Math.round(13 * flair.fontScale)}px`, color: gradeColor,
        stroke: flair.glowLayers >= 2 ? '#000000' : undefined, strokeThickness: flair.glowLayers >= 2 ? 2 : 0
      }).setOrigin(0.5).setDepth(2));
      this.cardContainer.add(this.add.text(x, y - 30, this.kindLabel(choice.kind), { fontFamily: 'Arial', fontSize: '11px', color: '#888888' }).setOrigin(0.5).setDepth(2));
      this.cardContainer.add(this.add.text(x, y - 6, desc.title, { fontFamily: 'Arial Black', fontSize: `${Math.round(17 * flair.fontScale)}px`, color: '#ffffff', wordWrap: { width: cardW - 24 }, align: 'center' }).setOrigin(0.5).setDepth(2));
      this.cardContainer.add(this.add.text(x, y + 34, desc.subtitle, { fontFamily: 'Arial', fontSize: '13px', color: '#62ffb0' }).setOrigin(0.5).setDepth(2));
      this.cardContainer.add(this.add.text(x, y + 70, desc.body, { fontFamily: 'Arial', fontSize: '11px', color: '#cccccc', wordWrap: { width: cardW - 30 }, align: 'center' }).setOrigin(0.5).setDepth(2));

      // Pulsing border glow for Epic/Legendary: the stroke color alternates brightness via
      // a tween-driven overlay rectangle (Phaser can't tween strokeStyle directly).
      if (flair.pulse) {
        const pulseRing = this.add.rectangle(x, y, cardW, cardH).setStrokeStyle(flair.borderW + 2, 0xffffff, 0).setDepth(1);
        this.cardContainer.add(pulseRing);
        this.tweens.add({
          targets: pulseRing,
          alpha: { from: 0, to: 0.9 },
          duration: choice.grade === 'legendary' ? 420 : 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }

      // Orbiting sparkle burst around higher-grade cards, tinted to the grade color.
      if (flair.particles > 0) {
        const sparkleKey = this.textures.exists('vfx_sparkle') ? 'vfx_sparkle' : 'gem';
        const emitter = this.add.particles(x, y, sparkleKey, {
          emitZone: { type: 'edge', source: new Phaser.Geom.Rectangle(-cardW / 2, -cardH / 2, cardW, cardH), quantity: flair.particles },
          lifespan: 900,
          speed: { min: 6, max: 22 },
          scale: { start: 0.9, end: 0 },
          alpha: { start: 0.9, end: 0 },
          tint: gradeColorHex,
          blendMode: 'ADD',
          frequency: choice.grade === 'legendary' ? 90 : 160
        });
        emitter.setDepth(2);
        this.cardContainer.add(emitter);
      }

      const zone = this.add.zone(x, y, cardW, cardH).setInteractive({ useHandCursor: true }).setDepth(3);
      this.cardContainer.add(zone);
      zone.on('pointerover', () => { card.setStrokeStyle(flair.borderW + 1, 0xffffff); if (audio) audio.playCardHover(); });
      zone.on('pointerout', () => card.setStrokeStyle(flair.borderW, gradeColorHex));
      zone.on('pointerdown', () => onChosen(choice));

      this.input.keyboard.on(`keydown-${keyNames[i]}`, () => onChosen(choice));
    });
  }

  hex(v) {
    return typeof v === 'string' ? parseInt(v.replace('0x', ''), 16) : v;
  }

  stars(grade) {
    const map = { common: '★', uncommon: '★★', rare: '★★★', epic: '★★★★', legendary: '★★★★★' };
    return map[grade] || '★';
  }

  kindLabel(kind) {
    return { move: '기술', item: '아이템', ability: '특성', stat: '능력치' }[kind] || kind;
  }
};
