// PreloadScene: loads every JSON data file (fully offline, no PokeAPI calls at runtime),
// builds the manager singletons in PS.Game, and generates procedural placeholder textures.
// If a real sprite has been downloaded into assets/pokemon/<id>.png or assets/enemies/<id>.png
// via tools/download-pokeapi.js, it is loaded under the SAME texture key as the species id and
// used automatically instead of the generated placeholder - no other code needs to change.
window.PS = window.PS || {};
PS.Game = PS.Game || {};

PS.PreloadScene = class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    const cx = this.cameras.main.width / 2;
    const cy = this.cameras.main.height / 2;
    this.add.text(cx, cy - 40, 'Pokemon x Survivors', { fontFamily: 'Arial Black', fontSize: '20px', color: '#ffffff' }).setOrigin(0.5);
    this.add.rectangle(cx, cy, 204, 14, 0x333333).setOrigin(0.5);
    this.barFg = this.add.rectangle(cx - 100, cy, 4, 10, 0x62ffb0).setOrigin(0, 0.5);

    this.load.setPath('data/');
    this.load.json('pokemonData', 'pokemon.json');
    this.load.json('movesData', 'moves.json');
    this.load.json('evolutionData', 'evolution.json');
    this.load.json('enemiesData', 'enemies.json');
    this.load.json('mapsData', 'maps.json');
    this.load.json('vfxData', 'vfx.json');
    this.load.json('itemsData', 'items.json');
    this.load.json('abilitiesData', 'abilities.json');
    this.load.json('typeChartData', 'type-chart.json');
    this.load.json('balanceData', 'balance.json');

    // Optional real sprites (see tools/download-pokeapi.js). Missing files simply fail to
    // load and we fall back to a generated placeholder texture of the same key in create().
    this.load.setPath('assets/pokemon/');
    this.pendingPokemonIds = [];
    this.load.on('filecomplete', (key) => {});

    const barW = 200;
    this.load.on('progress', (value) => {
      if (this.barFg) this.barFg.width = 4 + (barW - 4) * value;
    });
  }

  create() {
    const data = {
      pokemon: this.cache.json.get('pokemonData'),
      moves: this.cache.json.get('movesData'),
      evolution: this.cache.json.get('evolutionData'),
      enemies: this.cache.json.get('enemiesData'),
      maps: this.cache.json.get('mapsData'),
      vfx: this.cache.json.get('vfxData'),
      items: this.cache.json.get('itemsData'),
      abilities: this.cache.json.get('abilitiesData'),
      typeChart: this.cache.json.get('typeChartData'),
      balance: this.cache.json.get('balanceData')
    };
    PS.Game.data = data;

    const managers = {
      pokemon: new PS.PokemonManager(data.pokemon, data.balance),
      move: new PS.MoveManager(data.moves),
      item: new PS.ItemManager(data.items),
      ability: new PS.AbilityManager(data.abilities),
      enemy: new PS.EnemyManager(data.enemies, data.maps, data.balance)
    };
    PS.Game.managers = managers;
    PS.Game.typeFx = new PS.TypeEffectivenessSystem(data.typeChart, data.balance);
    PS.Game.statusFx = new PS.StatusEffectSystem(data.balance);
    PS.Game.combat = new PS.CombatSystem(PS.Game.typeFx, PS.Game.statusFx, data.balance);
    PS.Game.levelSystem = new PS.LevelSystem(data.balance, managers);
    PS.Game.evolutionSystem = new PS.EvolutionSystem(data.evolution);

    // ---- Generate placeholder textures for anything without a real downloaded sprite ----
    const assets = new PS.AssetManager(this);
    PS.Game.assets = assets;

    for (const id of Object.keys(data.pokemon)) {
      if (!this.textures.exists(id)) {
        assets.generateCreatureTexture(id, data.pokemon[id].color, 28, data.pokemon[id].name[0]);
      }
    }
    for (const id of Object.keys(data.enemies)) {
      if (!this.textures.exists(id)) {
        assets.generateCreatureTexture(id, data.enemies[id].color, 22, data.enemies[id].name[0]);
      }
    }
    assets.generateCreatureTexture('enemy_generic', '0x999999', 22, '?');
    assets.generateCircleTexture('gem', 0x62ffb0, 8);
    assets.generateCircleTexture('bullet_base', 0xffffff, 8);

    this.scene.start('Menu');
  }
};
