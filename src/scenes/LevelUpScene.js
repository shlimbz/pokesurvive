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
    const balance = PS.Game.data.balance;
    const { choices, build, levelSystem, onChosen } = this.payload;

    this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setOrigin(0).setScrollFactor(0).setDepth(0);
    this.add.text(width / 2, 60, 'LEVEL UP!', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#ffd400', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5).setDepth(1);
    this.add.text(width / 2, 96, `Lv.${build.level}`, { fontFamily: 'Arial', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5).setDepth(1);

    const cardW = 220, cardH = 300, gap = 24;
    const totalW = choices.length * cardW + (choices.length - 1) * gap;
    const startX = width / 2 - totalW / 2 + cardW / 2;

    choices.forEach((choice, i) => {
      const x = startX + i * (cardW + gap);
      const y = height / 2 + 10;
      const gradeColor = balance.rarity.colors[choice.grade];
      const desc = levelSystem.describeChoice(choice, build);

      const card = this.add.rectangle(x, y, cardW, cardH, 0x181c22, 0.96).setStrokeStyle(3, this.hex(gradeColor)).setDepth(1);
      this.add.text(x, y - cardH / 2 + 22, this.stars(choice.grade), { fontFamily: 'Arial', fontSize: '16px', color: gradeColor }).setOrigin(0.5).setDepth(2);
      this.add.text(x, y - cardH / 2 + 46, choice.grade.toUpperCase(), { fontFamily: 'Arial Black', fontSize: '13px', color: gradeColor }).setOrigin(0.5).setDepth(2);
      this.add.text(x, y - 30, this.kindLabel(choice.kind), { fontFamily: 'Arial', fontSize: '11px', color: '#888888' }).setOrigin(0.5).setDepth(2);
      this.add.text(x, y - 6, desc.title, { fontFamily: 'Arial Black', fontSize: '17px', color: '#ffffff', wordWrap: { width: cardW - 24 }, align: 'center' }).setOrigin(0.5).setDepth(2);
      this.add.text(x, y + 34, desc.subtitle, { fontFamily: 'Arial', fontSize: '13px', color: '#62ffb0' }).setOrigin(0.5).setDepth(2);
      this.add.text(x, y + 70, desc.body, { fontFamily: 'Arial', fontSize: '11px', color: '#cccccc', wordWrap: { width: cardW - 30 }, align: 'center' }).setOrigin(0.5).setDepth(2);

      const zone = this.add.zone(x, y, cardW, cardH).setInteractive({ useHandCursor: true }).setDepth(3);
      zone.on('pointerover', () => card.setStrokeStyle(4, 0xffffff));
      zone.on('pointerout', () => card.setStrokeStyle(3, this.hex(gradeColor)));
      zone.on('pointerdown', () => onChosen(choice));

      this.input.keyboard.once(`keydown-${['ONE', 'TWO', 'THREE'][i]}`, () => onChosen(choice));
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
