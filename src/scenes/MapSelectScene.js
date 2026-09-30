// MapSelectScene: choose Forest / Beach / Volcano (spec section 59).
window.PS = window.PS || {};

PS.MapSelectScene = class MapSelectScene extends Phaser.Scene {
  constructor() {
    super('MapSelect');
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#12181f');

    this.add.text(width / 2, 50, '맵 선택', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#ffffff'
    }).setOrigin(0.5);

    // Spec section 27 (맵 시스템 확장): this screen used to assume every map fit in one row -
    // fine for 3 maps, but wraps into a second row once the roster grows past what the screen
    // width can fit, so adding more maps to data/maps.json never silently pushes cards off-screen.
    const maps = Object.values(PS.Game.data.maps);
    const cardW = 190, cardH = 220;
    const gap = 24;
    const maxPerRow = Math.max(1, Math.floor((width - 40 + gap) / (cardW + gap)));
    const rows = Math.ceil(maps.length / maxPerRow);
    const rowHeight = cardH + 30;
    const gridStartY = height / 2 - ((rows - 1) * rowHeight) / 2;

    maps.forEach((map, i) => {
      const row = Math.floor(i / maxPerRow);
      const colCount = Math.min(maxPerRow, maps.length - row * maxPerRow);
      const totalW = colCount * cardW + (colCount - 1) * gap;
      const startX = width / 2 - totalW / 2 + cardW / 2;
      const col = i % maxPerRow;
      const x = startX + col * (cardW + gap);
      const y = gridStartY + row * rowHeight;
      const bg = this.add.rectangle(x, y, cardW, cardH, this.hex(map.background.color), 1).setStrokeStyle(2, 0x33424f);
      this.add.text(x, y - cardH / 2 + 26, map.name, { fontFamily: 'Arial Black', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5);
      this.add.text(x, y, `난이도 ${map.difficulty.toFixed(2)}`, { fontFamily: 'Arial', fontSize: '12px', color: '#cccccc' }).setOrigin(0.5);
      this.add.text(x, y + 24, `Boss: ${PS.Game.data.enemies[map.boss].name}`, { fontFamily: 'Arial', fontSize: '11px', color: '#ff8888' }).setOrigin(0.5);

      const zone = this.add.zone(x, y, cardW, cardH).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => bg.setStrokeStyle(3, 0xffd400));
      zone.on('pointerout', () => bg.setStrokeStyle(2, 0x33424f));
      zone.on('pointerdown', () => this.selectMap(map.id));
    });

    const backBtn = this.add.text(30, height - 30, '< 뒤로', { fontFamily: 'Arial', fontSize: '13px', color: '#aaaaaa' })
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.scene.start('PokemonSelect'));
  }

  hex(v) {
    return typeof v === 'string' ? parseInt(v.replace('0x', '').replace('#', ''), 16) : v;
  }

  selectMap(mapId) {
    PS.Game.selectedMapId = mapId;
    this.scene.start('Game');
  }
};
