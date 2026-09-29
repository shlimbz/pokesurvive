// main.js: Phaser game bootstrap. All game code lives on window.PS (see index.html for the
// plain <script> load order - no bundler, no ES modules, fully offline).
window.PS = window.PS || {};

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scene: [
    PS.BootScene,
    PS.PreloadScene,
    PS.MenuScene,
    PS.PokemonSelectScene,
    PS.MapSelectScene,
    PS.GameScene,
    PS.LevelUpScene,
    PS.EvolutionScene,
    PS.GameOverScene
  ]
};

window.PS.game = new Phaser.Game(config);
