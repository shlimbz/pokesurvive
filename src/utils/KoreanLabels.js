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

PS.typeNameKo = function typeNameKo(typeId) {
  return PS.TYPE_NAME_KO[typeId] || typeId;
};

PS.rarityNameKo = function rarityNameKo(grade) {
  return PS.RARITY_NAME_KO[grade] || grade;
};
