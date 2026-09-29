// PokemonSelectScene: choose one of the starter Pokemon (spec section 5).
window.PS = window.PS || {};

PS.PokemonSelectScene = class PokemonSelectScene extends Phaser.Scene {
  constructor() {
    super('PokemonSelect');
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#12181f');

    this.add.text(width / 2, 40, 'Pokémon 선택', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#ffffff'
    }).setOrigin(0.5);

    const starters = PS.Game.managers.pokemon.getStarters();
    const cols = 5;
    const cellW = Math.min(150, (width - 60) / cols);
    const cellH = 150;
    const startX = width / 2 - (cellW * cols) / 2 + cellW / 2;
    const startY = 130;

    this.detailText = this.add.text(width / 2, height - 70, '', {
      fontFamily: 'Arial', fontSize: '13px', color: '#cccccc', align: 'center'
    }).setOrigin(0.5);

    starters.forEach((species, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * cellW;
      const y = startY + row * cellH;

      const card = this.add.rectangle(x, y, cellW - 12, cellH - 12, 0x1c2530, 1).setStrokeStyle(2, 0x33424f);
      const sprite = this.add.image(x, y - 24, species.id).setScale(1.1);
      const name = this.add.text(x, y + 22, species.name, { fontFamily: 'Arial Black', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
      const types = this.add.text(x, y + 40, species.types.join(' / '), { fontFamily: 'Arial', fontSize: '10px', color: '#8fd3ff' }).setOrigin(0.5);

      const zone = this.add.zone(x, y, cellW - 12, cellH - 12).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => { card.setStrokeStyle(3, 0xffd400); this.detailText.setText(`${species.name} — ${species.description}`); });
      zone.on('pointerout', () => card.setStrokeStyle(2, 0x33424f));
      zone.on('pointerdown', () => this.selectSpecies(species.id));
    });
  }

  selectSpecies(speciesId) {
    PS.Game.selectedSpeciesId = speciesId;
    this.scene.start('MapSelect');
  }
};
