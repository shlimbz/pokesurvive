#!/usr/bin/env node
// tools/download-pokeapi.js
//
// Development-time helper that fetches REAL Pokemon data/art from PokeAPI (https://pokeapi.co).
// This is used only while developing - the shipped game never calls PokeAPI at runtime
// (spec section 3, "완전 오프라인 구조").
//
// IMPORTANT: PokeAPI's raw schema does not match this project's hand-balanced
// data/pokemon.json / data/moves.json / data/evolution.json (those files encode game-specific
// stats, ability ids, move patterns etc - see spec section 77, "실제 데이터와 게임 데이터의
// 분리"). So this tool does NOT overwrite those files. Instead it writes:
//
//   data/raw/pokemon-raw.json    <- raw PokeAPI pokemon payloads, for reference while you
//                                    hand-author a new entry in data/pokemon.json
//   data/raw/moves-raw.json      <- raw PokeAPI move payloads
//   data/raw/evolution-raw.json  <- raw PokeAPI evolution-chain payloads
//   assets/pokemon/<id>.png      <- official artwork, saved under the SAME id you'll use in
//                                    data/pokemon.json. PreloadScene automatically uses this
//                                    file instead of the generated placeholder if it exists.
//
// Usage:
//   node tools/download-pokeapi.js --pokemon pikachu,charmander
//   node tools/download-pokeapi.js --generation 1
//   node tools/download-pokeapi.js --all
//
// Requires Node.js 18+ (uses the built-in global fetch).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const SPRITE_DIR = path.join(ROOT, 'assets', 'pokemon');
const API_BASE = 'https://pokeapi.co/api/v2';

// The 10 starters + every evolved form already defined in data/pokemon.json.
// Used by --all so a plain `node tools/download-pokeapi.js --all` matches the project scope
// instead of pulling all 1000+ PokeAPI entries.
const DEFAULT_ROSTER = [
  'pikachu', 'raichu',
  'charmander', 'charmeleon', 'charizard',
  'squirtle', 'wartortle', 'blastoise',
  'bulbasaur', 'ivysaur', 'venusaur',
  'eevee', 'flareon', 'vaporeon', 'jolteon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon',
  'gastly', 'haunter', 'gengar',
  'machop', 'machoke', 'machamp',
  'vulpix', 'ninetales',
  'piplup', 'prinplup', 'empoleon',
  'riolu', 'lucario',
  'clefairy',
  'ralts', 'kirlia', 'gardevoir',
  // Wild-encounter-only roster (data/enemies.json), not a playable starter line, but still
  // worth having reference art/stats for when hand-tuning enemies.json entries.
  'rattata', 'oddish', 'weedle', 'bellsprout', 'poliwag', 'psyduck', 'tentacool', 'staryu',
  'growlithe', 'ponyta', 'numel', 'slugma', 'beedrill', 'golduck', 'rapidash', 'scyther',
  'poliwrath', 'vileplume', 'gyarados', 'magmar', 'cleffa', 'moltres', 'articuno',
  'geodude', 'zubat', 'onix', 'sandshrew', 'cubone', 'sandslash', 'koffing'
];

function parseArgs(argv) {
  const args = { pokemon: null, generation: null, all: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pokemon') args.pokemon = argv[++i];
    else if (arg === '--generation') args.generation = parseInt(argv[++i], 10);
    else if (arg === '--all') args.all = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
PokeAPI download tool (dev-time only, never called during gameplay)

  --pokemon name1,name2   Download specific Pokemon by name
  --generation N          Download every Pokemon in generation N (via /generation/N)
  --all                   Download this project's full roster (10 starters + evolutions)

Examples:
  node tools/download-pokeapi.js --pokemon pikachu,charmander
  node tools/download-pokeapi.js --generation 1
  node tools/download-pokeapi.js --all
`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function resolveNameList(args) {
  if (args.pokemon) return args.pokemon.split(',').map(s => s.trim()).filter(Boolean);

  if (args.generation) {
    console.log(`Fetching generation ${args.generation} species list...`);
    const gen = await fetchJson(`${API_BASE}/generation/${args.generation}`);
    return gen.pokemon_species.map(s => s.name).sort();
  }

  if (args.all) return DEFAULT_ROSTER;

  return null;
}

async function downloadPokemon(name, rawPokemonStore, rawMovesStore) {
  console.log(`[pokemon] ${name} ...`);
  const pokemon = await fetchJson(`${API_BASE}/pokemon/${name}`);
  rawPokemonStore[name] = pokemon;

  // Sprite: prefer official artwork, fall back to the classic front sprite.
  const artUrl = pokemon.sprites?.other?.['official-artwork']?.front_default || pokemon.sprites?.front_default;
  if (artUrl) {
    ensureDir(SPRITE_DIR);
    const dest = path.join(SPRITE_DIR, `${name}.png`);
    try {
      await downloadFile(artUrl, dest);
      console.log(`  -> sprite saved: assets/pokemon/${name}.png`);
    } catch (e) {
      console.warn(`  !! sprite download failed for ${name}: ${e.message}`);
    }
  }

  // A handful of representative moves (first 6 level-up moves) for reference - the project's
  // real move balance still lives in data/moves.json, hand-authored.
  const levelUpMoves = pokemon.moves
    .filter(m => m.version_group_details.some(d => d.move_learn_method.name === 'level-up'))
    .slice(0, 6);

  for (const moveEntry of levelUpMoves) {
    const moveName = moveEntry.move.name;
    if (rawMovesStore[moveName]) continue;
    try {
      console.log(`  [move] ${moveName} ...`);
      rawMovesStore[moveName] = await fetchJson(moveEntry.move.url);
    } catch (e) {
      console.warn(`  !! move download failed for ${moveName}: ${e.message}`);
    }
  }

  return pokemon;
}

async function downloadEvolutionChain(pokemon, rawEvolutionStore) {
  try {
    const species = await fetchJson(pokemon.species.url);
    const chainUrl = species.evolution_chain?.url;
    if (!chainUrl) return;
    const chainId = chainUrl.split('/').filter(Boolean).pop();
    if (rawEvolutionStore[chainId]) return;
    console.log(`  [evolution-chain] #${chainId} ...`);
    rawEvolutionStore[chainId] = await fetchJson(chainUrl);
  } catch (e) {
    console.warn(`  !! evolution chain download failed for ${pokemon.name}: ${e.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return printHelp();

  const names = await resolveNameList(args);
  if (!names) {
    printHelp();
    process.exit(1);
  }

  if (typeof fetch !== 'function') {
    console.error('This tool requires Node.js 18+ (global fetch not found).');
    process.exit(1);
  }

  ensureDir(RAW_DIR);
  ensureDir(SPRITE_DIR);

  const rawPokemonPath = path.join(RAW_DIR, 'pokemon-raw.json');
  const rawMovesPath = path.join(RAW_DIR, 'moves-raw.json');
  const rawEvolutionPath = path.join(RAW_DIR, 'evolution-raw.json');

  const rawPokemonStore = loadJsonSafe(rawPokemonPath);
  const rawMovesStore = loadJsonSafe(rawMovesPath);
  const rawEvolutionStore = loadJsonSafe(rawEvolutionPath);

  let ok = 0, fail = 0;
  for (const name of names) {
    try {
      const pokemon = await downloadPokemon(name, rawPokemonStore, rawMovesStore);
      await downloadEvolutionChain(pokemon, rawEvolutionStore);
      ok++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      fail++;
    }
    // Be polite to the free public API.
    await new Promise(r => setTimeout(r, 150));
  }

  saveJson(rawPokemonPath, rawPokemonStore);
  saveJson(rawMovesPath, rawMovesStore);
  saveJson(rawEvolutionPath, rawEvolutionStore);

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
  console.log('Raw reference data written to data/raw/*.json');
  console.log('Sprites written to assets/pokemon/*.png (used automatically by PreloadScene).');
  console.log('Remember: data/pokemon.json, data/moves.json and data/evolution.json are hand-');
  console.log('balanced game files - use the raw data above as a reference when adding a new');
  console.log('entry to them by hand (see README.md "새로운 Pokémon 추가 방법").');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
