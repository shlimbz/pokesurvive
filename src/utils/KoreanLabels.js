// KoreanLabels: small shared display-string maps so the UI never leaks raw internal ids
// (type ids, rarity grade ids) as English label text. Pure data, no logic.
window.PS = window.PS || {};

PS.TYPE_NAME_KO = {
  normal: '노말', fire: '불꽃', water: '물', electric: '전기', grass: '풀',
  ice: '얼음', fighting: '격투', poison: '독', ground: '땅', flying: '비행',
  psychic: '에스퍼', bug: '벌레', rock: '바위', ghost: '고스트', dragon: '드래곤',
  dark: '악', steel: '강철', fairy: '페어리'
};

PS.RARITY_NAME_KO = {
  common: '일반',
  uncommon: '고급',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설'
};

PS.MOVE_PATTERN_KO = {
  projectile: '투사체', spread: '확산탄', beam: '빔', circle: '주변 범위',
  orbit: '공전체', rain: '낙하 공격', strike: '강타', chain: '연쇄 공격',
  explosion: '폭발', melee: '근접', boomerang: '부메랑', homing: '유도탄'
};

PS.STATUS_NAME_KO = {
  burn: '화상', poison: '중독', paralysis: '마비', freeze: '빙결',
  slow: '둔화', confusion: '혼란', defenseDown: '방어력 감소',
  attackDown: '공격력 감소', armorBreak: '방어구 파괴', seed: '씨뿌리기'
};

PS.typeNameKo = function typeNameKo(typeId) {
  return PS.TYPE_NAME_KO[typeId] || typeId;
};

PS.rarityNameKo = function rarityNameKo(grade) {
  return PS.RARITY_NAME_KO[grade] || grade;
};

PS.patternNameKo = function patternNameKo(pattern) {
  return PS.MOVE_PATTERN_KO[pattern] || pattern;
};

PS.statusNameKo = function statusNameKo(statusId) {
  return PS.STATUS_NAME_KO[statusId] || statusId;
};
