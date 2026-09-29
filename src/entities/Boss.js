// Boss: presentation helpers layered on top of a tier === 'boss' (or 'miniboss') Enemy
// instance - the name banner on spawn and an attack telegraph ring shown just before it fires
// its special move, so the player gets a fair warning against big hits.
window.PS = window.PS || {};

PS.Boss = {
  announce(scene, enemy) {
    const label = enemy.tier === 'boss' ? 'BOSS APPEARED' : 'MINI BOSS APPEARED';
    const banner = scene.add.text(scene.cameras.main.width / 2, 90, `${label}\n${enemy.species.name}`, {
      fontFamily: 'Arial Black, sans-serif',
      fontSize: '22px',
      color: '#ff4d4d',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setAlpha(0);

    scene.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 300,
      yoyo: true,
      hold: 1400,
      onComplete: () => banner.destroy()
    });
  },

  telegraph(scene, enemy, radius) {
    const ring = scene.add.circle(enemy.x, enemy.y, radius, 0xff0000, 0);
    ring.setStrokeStyle(3, 0xff2222, 0.85);
    ring.setDepth(4);
    scene.tweens.add({
      targets: ring,
      alpha: { from: 0.9, to: 0 },
      duration: 380,
      onComplete: () => ring.destroy()
    });
  }
};
