// VFXPatternMap: maps this project's move `pattern` field (data/moves.json - projectile,
// spread, homing, boomerang, melee, strike, counter, beam, chain, circle, orbit, aura,
// ground_zone, explosion, rain, dash, cone, summon - see GameScene.performPlayerAttack) onto
// the smaller set of visual "pattern groups" used by data/vfx_effects.json (Projectile, Melee,
// Beam, Chain, Explosion, GroundZone, Dash, Aura, Swarm - see PokeSurvivors_VFX_Spec.xlsx).
//
// This indirection is deliberate: gameplay patterns encode HIT-DETECTION shape (a cone is not
// the same hitbox as a circle), while VFX pattern groups encode VISUAL treatment. Several
// gameplay patterns can legitimately share one visual treatment (spread/homing/boomerang are
// all "things that fly and hit" -> Projectile visuals) without merging their damage logic.
window.PS = window.PS || {};

PS.VFXPatternMap = {
  projectile: 'Projectile',
  spread: 'Projectile',
  homing: 'Projectile',
  boomerang: 'Projectile',
  melee: 'Melee',
  strike: 'Melee',
  counter: 'Melee',
  beam: 'Beam',
  cone: 'Beam',
  chain: 'Chain',
  circle: 'Explosion',
  explosion: 'Explosion',
  rain: 'GroundZone',
  ground_zone: 'GroundZone',
  caltrop: 'GroundZone',
  dash: 'Dash',
  aura: 'Aura',
  orbit: 'Aura',
  summon: 'Swarm',

  resolve(pattern) {
    return this[pattern] || 'Projectile';
  }
};
