// EvolutionScene: brief overlay celebrating an evolution (spec section 55).
window.PS = window.PS || {};

PS.EvolutionScene = class EvolutionScene extends Phaser.Scene {
  constructor() {
    super('Evolution');
  }

  init(payload) {
    this.payload = payload;
  }

  create() {
    const { width, height } = this.cameras.main;
    const { fromName, toName, speciesId, onDone } = this.payload;

    this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0);
    this.add.text(width / 2, height / 2 - 90, `${fromName}(이)가 진화 중...`, {
      fontFamily: 'Arial', fontSize: '18px', color: '#cccccc'
    }).setOrigin(0.5);

    const sprite = this.add.image(width / 2, height / 2 - 10, speciesId).setScale(0.5);
    this.tweens.add({
      targets: sprite,
      scale: 2.2,
      duration: 900,
      ease: 'Back.easeOut'
    });

    const title = this.add.text(width / 2, height / 2 + 90, '', {
      fontFamily: 'Arial Black, sans-serif', fontSize: '30px', color: '#ffd400', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5);

    this.time.delayedCall(950, () => {
      title.setText(`${toName}(으)로 진화했다!`);
      const cont = this.add.text(width / 2, height / 2 + 150, '(클릭 또는 아무 키나 눌러 계속)', {
        fontFamily: 'Arial', fontSize: '13px', color: '#888888'
      }).setOrigin(0.5);

      let done = false;
      const proceed = () => { if (done) return; done = true; onDone(); };
      this.input.once('pointerdown', proceed);
      this.input.keyboard.once('keydown', proceed);
      this.time.delayedCall(2200, proceed);
    });
  }
};
