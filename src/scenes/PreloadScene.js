// PreloadScene: loads every JSON data file (fully offline, no PokeAPI calls at runtime),
// builds the manager singletons in PS.Game, and generates procedural placeholder textures.
// Real sprites in assets/pokemon/<id>.png are loaded under the SAME texture key as the
// species id and used automatically instead of the generated placeholder - if a new id is
// added to data/pokemon.json or data/enemies.json without a matching PNG, it just falls back
// to the placeholder (see create() below), no crash, no other code needs to change.
window.PS = window.PS || {};
PS.Game = PS.Game || {};

// Keep this in sync with the ids in data/pokemon.json + data/enemies.json. It only controls
// which real artwork files we ATTEMPT to load - an id with no PNG here simply falls back to
// the procedural placeholder texture in create().
PS.SPRITE_IDS = [
  'bulbasaur', 'ivysaur', 'venusaur', 'charmander', 'charmeleon', 'charizard',
  'squirtle', 'wartortle', 'blastoise', 'pikachu', 'raichu',
  'eevee', 'flareon', 'vaporeon', 'jolteon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon',
  'gastly', 'haunter', 'gengar', 'machop', 'machoke', 'machamp',
  'vulpix', 'ninetales', 'piplup', 'prinplup', 'empoleon', 'riolu', 'lucario',
  'clefairy', 'ralts', 'kirlia', 'gardevoir',
  'rattata', 'oddish', 'weedle', 'bellsprout',
  'poliwag', 'psyduck', 'tentacool', 'staryu',
  'growlithe', 'ponyta', 'numel', 'slugma',
  'beedrill', 'golduck', 'rapidash',
  'scyther', 'poliwrath',
  'vileplume', 'gyarados', 'magmar',
  // Added for full 18-type starter roster coverage (see data/pokemon.json comment).
  'koffing', 'sandshrew', 'pidgey', 'geodude', 'dratini', 'beldum'
];

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
    this.load.json('vfxEffectsData', 'vfx_effects.json');
    this.load.json('itemsData', 'items.json');
    this.load.json('relicsData', 'relics.json');
    this.load.json('typeMasteryData', 'type-mastery.json');
    this.load.json('abilitiesData', 'abilities.json');
    this.load.json('typeChartData', 'type-chart.json');
    this.load.json('balanceData', 'balance.json');

    // Real sprites (downloaded via tools/download-pokeapi.js and committed to the repo).
    // A missing file just fails to load - create() falls back to a generated placeholder
    // texture under the same key, so nothing ever breaks if art is added/removed later.
    this.load.setPath('assets/pokemon/');
    for (const id of PS.SPRITE_IDS) this.load.image(id, `${id}.png`);
    this.load.on('loaderror', () => {}); // expected for any id without art - handled in create()

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
      vfxEffects: this.cache.json.get('vfxEffectsData'),
      items: this.cache.json.get('itemsData'),
      relics: this.cache.json.get('relicsData'),
      typeMastery: this.cache.json.get('typeMasteryData'),
      abilities: this.cache.json.get('abilitiesData'),
      typeChart: this.cache.json.get('typeChartData'),
      balance: this.cache.json.get('balanceData')
    };
    PS.Game.data = data;

    const managers = {
      pokemon: new PS.PokemonManager(data.pokemon, data.balance),
      move: new PS.MoveManager(data.moves),
      item: new PS.ItemManager(data.items),
      relic: new PS.RelicManager(data.relics),
      typeMastery: new PS.TypeMasteryManager(data.typeMastery),
      ability: new PS.AbilityManager(data.abilities),
      enemy: new PS.EnemyManager(data.enemies, data.maps, data.balance)
    };
    PS.Game.managers = managers;
    PS.Game.typeFx = new PS.TypeEffectivenessSystem(data.typeChart, data.balance);
    PS.Game.statusFx = new PS.StatusEffectSystem(data.balance);
    PS.Game.combat = new PS.CombatSystem(PS.Game.typeFx, PS.Game.statusFx, data.balance);
    PS.Game.levelSystem = new PS.LevelSystem(data.balance, managers);
    PS.Game.evolutionSystem = new PS.EvolutionSystem(data.evolution);
    PS.Game.moveEvolutionSystem = new PS.MoveEvolutionSystem(managers.move);

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

    // Field pickups (spec-inspired Vampire Survivors staples: heal / speed / magnet orbs
    // that spawn on the map periodically, separate from the level-up item system).
    assets.generateCreatureTexture('pickup_heal', '0xff4d6d', 18, 'H');
    assets.generateCreatureTexture('pickup_speed', '0x4dd2ff', 18, 'S');
    assets.generateCreatureTexture('pickup_magnet', '0xffd400', 18, 'M');

    // Relics (rarer, build-defining pickups - see data/relics.json). One glowing gem texture
    // per relic id, colored per its own `icon` field.
    for (const [id, relic] of Object.entries(data.relics.relics)) {
      assets.generateRelicTexture(`relic_${id}`, relic.icon, 17);
    }

    this.scene.start('Menu');
  }
};
