// MenuScene: title screen.
window.PS = window.PS || {};

PS.MenuScene = class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#101820');

    this.add.text(width / 2, height * 0.28, 'POKÉMON', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '46px', color: '#ffd400', stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5);
    this.add.text(width / 2, height * 0.28 + 50, '× SURVIVORS', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#ffffff', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5);

    const save = PS.SaveSystem.load();
    this.add.text(width / 2, height * 0.28 + 100,
      `최고 생존시간: ${Math.floor(save.bestSurvivalSec / 60)}:${(save.bestSurvivalSec % 60).toString().padStart(2, '0')}   최고 레벨: ${save.bestLevel}`,
      { fontFamily: 'Arial', fontSize: '13px', color: '#aaaaaa' }
    ).setOrigin(0.5);

    const startBtn = this.add.text(width / 2, height * 0.6, '▶  START', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '26px', color: '#62ffb0',
      backgroundColor: '#1c2a22', padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    startBtn.on('pointerover', () => startBtn.setStyle({ color: '#ffffff' }));
    startBtn.on('pointerout', () => startBtn.setStyle({ color: '#62ffb0' }));
    startBtn.on('pointerdown', () => this.scene.start('PokemonSelect'));

    this.input.keyboard.once('keydown-SPACE', () => this.scene.start('PokemonSelect'));
    this.input.keyboard.once('keydown-ENTER', () => this.scene.start('PokemonSelect'));

    this.add.text(width / 2, height - 24,
      'Arrow/WASD 이동 · 자동 공격 · 15분 생존 · Debug: G(레벨업) E(진화) B(보스) 1-3(VFX) 4(기술Max) 5(전설아이템)',
      { fontFamily: 'Arial', fontSize: '11px', color: '#666666' }
    ).setOrigin(0.5);
  }
};
