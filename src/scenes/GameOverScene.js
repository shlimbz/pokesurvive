// GameOverScene: result summary (survived / died) + restart.
window.PS = window.PS || {};

PS.GameOverScene = class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  init(result) {
    this.result = result || {};
  }

  create() {
    const { width, height } = this.cameras.main;
    this.cameras.main.setBackgroundColor('#0c1015');
    const r = this.result;

    const headline = r.bossDefeated ? '승리! 최종 보스 처치!' : (r.survived ? '15분 생존 성공!' : '게임 오버');
    const color = r.survived || r.bossDefeated ? '#62ffb0' : '#ff5555';

    this.add.text(width / 2, height * 0.22, headline, {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color, stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5);

    const mm = Math.floor((r.survivedSec || 0) / 60);
    const ss = (r.survivedSec || 0) % 60;
    const lines = [
      `포켓몬: ${r.speciesName || '-'}`,
      `생존 시간: ${mm}:${ss.toString().padStart(2, '0')}`,
      `도달 레벨: ${r.level || 1}`,
      `처치 수: ${r.kills || 0}`,
      `주력 타입: ${r.dominantType ? PS.typeNameKo(r.dominantType) : '-'}`
    ];
    this.add.text(width / 2, height * 0.42, lines.join('\n'), {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffffff', align: 'center', lineSpacing: 10
    }).setOrigin(0.5);

    const retryBtn = this.add.text(width / 2, height * 0.72, '▶ 다시 하기', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '20px', color: '#62ffb0',
      backgroundColor: '#1c2a22', padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    retryBtn.on('pointerdown', () => this.scene.start('PokemonSelect'));

    const menuBtn = this.add.text(width / 2, height * 0.72 + 56, '메인 메뉴', {
      fontFamily: 'Arial', fontSize: '14px', color: '#aaaaaa'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    menuBtn.on('pointerdown', () => this.scene.start('Menu'));
  }
};
