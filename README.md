# Pokémon × Survivors

Phaser 3 기반의 **Pokémon × Vampire Survivors** 스타일 15분 생존 로그라이크 프로토타입.
React/Vue/Angular 없이 순수 JavaScript(ES6+) + HTML5 + CSS3 + JSON으로만 작성되었으며,
빌드 도구(webpack/vite 등) 없이 `<script>` 태그만으로 동작합니다.

**게임 실행 중에는 어떤 외부 네트워크 호출도 하지 않습니다** (PokeAPI, 외부 이미지, 외부
API/DB 전부 없음). 모든 데이터는 `data/*.json`, 모든 이미지는 절차적으로 생성된 텍스처
(또는 개발 단계에서 미리 받아 둔 `assets/` 파일)만 사용합니다.

## 1. 프로젝트 구조

```text
/index.html
/style.css
/package.json

/src/
    main.js
    scenes/       BootScene, PreloadScene, MenuScene, PokemonSelectScene, MapSelectScene,
                  GameScene, LevelUpScene, EvolutionScene, GameOverScene
    entities/     Player, Enemy, Boss, Projectile, ExpGem, DamageNumber
    systems/      CombatSystem, TypeEffectivenessSystem, StatusEffectSystem, SpawnSystem,
                  LevelSystem, EvolutionSystem, BuildSystem, ItemSystem, AbilitySystem,
                  VFXSystem, WaveSystem, SaveSystem, AudioSystem
    managers/     AssetManager, PokemonManager, MoveManager, EnemyManager, ItemManager,
                  AbilityManager
    utils/        MathUtils, RandomUtils, ObjectPool

/data/            pokemon.json, moves.json, evolution.json, enemies.json, maps.json,
                  vfx.json, items.json, abilities.json, type-chart.json, balance.json

/assets/          pokemon/  48종 실제 Pokémon 공식 아트(PNG)가 기본 내장되어 있습니다 - 별도
                  다운로드 없이 바로 실제 스프라이트로 플레이됩니다 (§4).
                  vfx/ items/ ui/ maps/ audio/ 는 비어 있으며 절차적 생성으로 대체됩니다.
/vendor/          phaser.min.js  (Phaser 3.80.1, vendored locally - no CDN)
/tools/           download-pokeapi.js
```

## 2. 실행 방법

브라우저의 `fetch`/XHR 로컬 파일 정책 때문에 `index.html`을 `file://`로 직접 열면
`data/*.json`을 불러오지 못합니다. **반드시 로컬 정적 서버로 실행하세요.**

```bash
# 방법 A - 이 프로젝트에 내장된 무의존성 서버 (Node.js만 있으면 됨)
npm start
# http://localhost:8080 접속

# 방법 B - Python이 있다면
python3 -m http.server 8080

# 방법 C - Node http-server가 있다면
npx http-server -p 8080
```

접속 후: **메인 메뉴 → START → Pokémon 선택 → 맵 선택 → 게임 시작**.

- 이동: 방향키 또는 WASD
- 공격: 자동 (보유한 기술이 각자의 쿨다운에 따라 자동 발동)
- 목표: 15분 생존 또는 최종 보스 처치
- **ESC**: 일시정지 / 재개
- **TAB**: 현재 빌드 확인(보유 기술·특성·아이템·능력치 강화 목록) - 게임이 멈춥니다
- **M**: 효과음 음소거 토글

### 디버그 키 (스폰 배포 시 `PS.GameScene.setupDebugKeys` 호출부를 제거하면 비활성화됩니다)

| 키 | 효과 |
|---|---|
| G | 즉시 레벨업 |
| E | 즉시 진화 (조건 무시) |
| B | 즉시 보스 스폰 |
| 1 / 2 / 3 | Fire / Water / Electric VFX 미리보기 |
| 4 | 보유 기술 전부 최대 레벨로 |
| 5 | Legendary(없으면 Epic) 아이템 1개 즉시 획득 |

### 필드 픽업 (Heal / Speed / Magnet)

레벨업 카드로 얻는 영구 강화와는 별개로, 맵 위에 8~13초 간격으로 임시 픽업 오브가
플레이어 근처에 무작위로 스폰됩니다 (뱀서라이크 장르의 전형적인 요소):

| 아이콘 | 효과 |
|---|---|
| H (분홍) | 즉시 체력 회복 |
| S (하늘색) | 일정 시간 이동속도 증가 |
| M (노랑) | 일정 시간 픽업(경험치 구슬 등) 흡수 범위 대폭 증가 |

`GameScene.updatePickups`/`spawnFieldPickup`/`onPickupCollected`가 스폰·수명·획득을
관리하며, 새 픽업 타입을 추가하고 싶다면 이 세 메서드와 `Player.applyFieldSpeedBuff`/
`heal` 같은 소비 메서드에 분기를 하나 추가하면 됩니다.

### 레벨업 등급 표시 (Common/Rare 같은 영문 대신 한글, 고등급은 화려하게)

`LevelUpScene`의 등급 표시는 전부 한글(`일반/고급/희귀/영웅/전설`, `PS.rarityNameKo` -
`src/utils/KoreanLabels.js`)이며, 등급이 높을수록 카드 프레젠테이션도 눈에 띄게
화려해집니다 (`LevelUpScene`의 `FLAIR` 테이블):

- 카드 배경 색감과 테두리 두께/발광 레이어 수가 등급별로 증가
- 영웅(Epic)·전설(Legendary)은 테두리가 맥동(pulse)하는 애니메이션 추가
- 희귀 이상은 카드 테두리를 따라 도는 반짝임 파티클 추가, 전설이 가장 밀도 높음
- 제목/등급 폰트 크기도 등급에 비례해 살짝 커짐

새 등급이나 연출을 조정하려면 `LevelUpScene.js`의 `FLAIR` 객체(등급별
`glowLayers`/`pulse`/`particles`/`borderW`/`fontScale`)만 손보면 됩니다. 또한 게임 내
어디서도 타입 id(`fire`, `water` ...)나 등급 id(`common`, `legendary` ...)가 영문 그대로
노출되지 않도록 `PS.typeNameKo`/`PS.rarityNameKo`를 표시 직전에 한 번 거치는 것이
컨벤션입니다.

### 초반 공격 사거리

플레이테스트 피드백으로 초반 사거리가 짧게 느껴져 두 가지를 조정했습니다:
`BuildSystem`의 기본 `rangeMult`를 1.0 → 1.2로 올려 모든 공격 패턴에 전역 +20% 사거리를
주었고, 근접(`melee`) 패턴 기술 12종의 `range`를 데이터에서 직접 약 1.9배 늘렸습니다
(예: Quick Attack 65 → 124px). 전체 사거리 균형을 다시 조정하려면 `BuildSystem.refreshModifiers`의
`rangeMult` 기본값(1.2)이나 `data/moves.json`의 개별 `range`/`areaRadius`를 조정하세요.

## 3. 완전 오프라인 구조가 지켜지는 방식

- `data/*.json`은 모두 로컬 파일이며, `PreloadScene`이 `this.load.json`으로만 불러옵니다.
- Pokémon/적 스프라이트, 18타입×3단계 VFX, UI 등은 **전부 `Phaser.Graphics`로 런타임에
  절차적으로 생성**됩니다 (`src/managers/AssetManager.js`, `src/systems/VFXSystem.js`).
  외부 이미지 파일이 하나도 없어도 완전히 플레이 가능합니다.
- `tools/download-pokeapi.js`는 **개발 단계 전용** 스크립트로, 게임 코드 어디에서도
  import/호출되지 않습니다. PokeAPI 접근은 이 스크립트를 사람이 직접 실행할 때만 발생합니다.

## 4. 실제 Pokémon 아트

`assets/pokemon/`에 48종(스타터 + 진화체 + 주요 야생/보스 종)의 실제 공식 아트(PNG)가
**기본으로 포함**되어 있습니다. 별도 실행 없이 바로 실제 스프라이트로 플레이됩니다.
`PreloadScene.PS.SPRITE_IDS`에 나열된 id에 대해 `assets/pokemon/<id>.png`를 로드하고,
같은 id의 텍스처 키로 `Pokemon`/`Enemy` 스프라이트에 자동 적용됩니다. 표시 크기는
`setDisplaySize()`로 고정되어 있어(플레이어 56px, 적 42px×tier scale) 원본 PNG 해상도와
무관하게 항상 올바른 크기로 렌더링되며, 히트박스도 `MathUtils.fitCircularBody()`가
실제 표시 크기 기준으로 다시 계산하므로 절차적 placeholder와 실제 아트가 섞여 있어도
크기/충돌 판정이 항상 정확합니다.

에셋이 없는 id, 또는 새로 추가한 Pokémon/적은 자동으로 절차적 placeholder(색상 원 +
이니셜)로 대체되므로 코드 수정 없이 항상 안전하게 동작합니다.

새 스프라이트를 추가/교체하려면:

1. `node tools/download-pokeapi.js --all` (또는 `--pokemon pikachu,charmander` /
   `--generation 1`) 실행 → `assets/pokemon/<id>.png`에 공식 아트가 저장됩니다. (`tools/`
   스크립트는 **개발 전용**이며 게임 코드에서 호출되지 않습니다 - §3 참고.)
2. `src/scenes/PreloadScene.js`의 `PS.SPRITE_IDS` 배열에 해당 id를 추가합니다
   (이미 넣어 둔 48종 외에 추가하고 싶을 때만 필요).
3. `data/raw/*.json`은 다운로드 스크립트가 참고용으로 남기는 PokeAPI 원본 데이터이며
   게임이 직접 사용하지 않습니다. 실제 게임 밸런스는 여전히 `data/pokemon.json` /
   `data/moves.json` / `data/evolution.json`에 사람이 직접 정의합니다.

## 5. 새로운 Pokémon 추가 방법

JSON + Asset만 추가하면 되고 JavaScript 수정은 필요 없습니다.

1. `data/pokemon.json`에 새 항목 추가:
   ```json
   "squirtle_example": {
     "id": "squirtle_example", "name": "예시몬", "types": ["water"], "isStarter": true,
     "baseStats": { "hp": 45, "attack": 50, "defense": 50, "spAttack": 50, "spDefense": 50, "speed": 50 },
     "ability": "torrent", "moves": ["water_gun", "tackle"], "color": "0x4FA8FF",
     "description": "설명 텍스트"
   }
   ```
   - `types`는 `data/type-chart.json`의 18타입 중 1~2개.
   - `ability`는 `data/abilities.json`에 존재하는 id.
   - `moves`는 `data/moves.json`에 존재하는 id 배열 (첫 번째가 시작 기술).
   - `isStarter: true`면 PokemonSelectScene 선택지에 나타납니다.
2. (선택) `assets/pokemon/<id>.png`를 두면 실제 스프라이트가 사용됩니다 (§4).
3. 끝. 진화를 만들고 싶다면 §8 참고.

## 6. 새로운 기술(Move) 추가 방법

`data/moves.json`에 항목을 추가하면 됩니다. `pattern` 필드가 실제 공격 로직을 결정합니다
(`src/scenes/GameScene.js`의 `performPlayerAttack`이 12가지 패턴을 모두 지원):
`projectile, spread, beam, circle, orbit, rain, strike, chain, explosion, melee, boomerang, homing`

```json
"my_new_move": {
  "id": "my_new_move", "name": "New Move", "type": "fire", "category": "special",
  "pattern": "projectile", "baseDamage": 15, "cooldownMs": 800, "range": 350,
  "projectileSpeed": 500, "statusEffect": { "id": "burn", "chance": 0.3 }, "maxLevel": 5
}
```

이 id를 어떤 Pokémon의 `moves` 배열에 추가하거나, 같은 타입을 가진 Pokémon의 레벨업
카드로 자동 등장하게 하려면 그냥 데이터에만 넣어두면 됩니다
(`MoveManager.getLearnableMovesForTypes`가 타입이 일치하는 미보유 기술을 자동으로 찾습니다).

## 7. 새로운 Item 추가 방법

`data/items.json`에 항목을 추가합니다. `effects[].type`은 `src/systems/ItemSystem.js`가
인식하는 값 중 하나여야 합니다 (`type_damage, status_chance, hp_regen_percent,
lifesteal_percent, global_damage, self_damage_on_attack_percent, survive_lethal_hit,
move_speed_percent, cooldown_reduction_percent, on_hit_stun_chance, range_percent,
on_attack_cooldown_reset_chance, crit_chance, crit_damage, type_penetration`).

```json
"my_new_item": {
  "id": "my_new_item", "name": "New Item", "grade": "rare", "category": "offense",
  "effects": [{ "type": "crit_chance", "value": 0.05 }], "maxLevel": 5
}
```

이미 존재하는 effect type을 조합하면 코드 수정 없이 바로 레벨업 카드 풀에 등장합니다.

## 8. 새로운 Ability 추가 방법

`data/abilities.json`에 항목을 추가합니다. Ability는 조건부 효과가 많아
`src/systems/AbilitySystem.js`가 "hook" 형태로 모아두고, 실제 소비는
`CombatSystem`/`Player`/`GameScene`이 `effect.type`별로 분기해서 처리합니다.
새로운 `effect.type`을 쓰고 싶다면 해당 소비 지점에 분기를 하나 추가해야 하지만,
이미 있는 타입 중 하나를 재사용하면 데이터만 추가해도 바로 동작합니다. 기존에
지원하는 `effect.type` 목록은 `data/abilities.json`에 이미 있는 값들을 참고하세요.

## 9. 새로운 타입 VFX 추가 방법

`data/vfx.json`의 `types.<typeId>`에 `{ color, shape, trail }`을 추가하면
`src/managers/AssetManager.generateVfxTexture`가 자동으로 절차적 파티클 텍스처를
만들어줍니다. 18타입 전부가 서로 다른 `shape`(실루엣)와 `color`를 갖도록 이미 구성되어
있어(예: fire=불꽃 삼각형, water=물방울, fighting=너클, ground=지진 파편, psychic=삼중
소용돌이, ghost=유령 위습, steel=톱니바퀴 등), 같은 투사체/타격 이펙트라도 타입만 보고
바로 구분됩니다 (`GameScene`이 투사체 텍스처와 틴트를 `move.type` 기준으로 지정 - 62-70행
근처 `firePlayerProjectile`/`vfx.getTexture` 참고). 새 `shape`를 쓰려면
`generateVfxTexture`의 switch문에 case를 하나 추가하면 됩니다.

### 속성별 상태이상 기믹 (공격에 실려 있는 부가 효과)

`data/moves.json`의 각 기술에 있는 `statusEffect`(또는 상태전용 기술의 경우
`statusOnly`)가 타입별 "기믹"을 담당합니다. 대표적으로:

| 속성 | 대표 기믹 | 예시 기술 |
|---|---|---|
| 불꽃 | 화상 (지속 피해) | Ember, Flamethrower, Fire Blast |
| 물 | 슬로우 (이동속도 감소) | Bubble |
| 전기 | 마비 (공격/이동속도 감소 + 기절 확률) | Thunder Shock, Thunderbolt, Spark |
| 풀 / 독 | 중독 (스택형 지속 피해) | Vine Whip, Razor Leaf, Poison Sting |
| 얼음 | 슬로우 | Powder Snow |
| 격투 | 방어구 파괴 / 방어력 감소 | Cross Chop, Low Kick |
| 땅 / 바위 | 방어력 감소 | Mud Slap, Rock Throw |
| 벌레 | 중독 | X-Scissor |
| 비행 | 공격력 감소 (돌풍에 흐트러짐) | Gust |
| 고스트 | 혼란 | Confuse Ray |
| 에스퍼 | 혼란 | Psybeam |
| 악 | 방어력 감소 | Crunch |
| 페어리 | 공격력 감소 | Moonblast |
| 드래곤 | 마비 | Dragon Breath |
| 노말 | (고유 상태이상 없음 - 원작처럼 범용 속성) | - |

모든 상태이상 자체의 수치(지속시간/확률/효과량)는 `data/balance.json`의
`statusEffects`에서 한 곳에 모아 관리합니다. 새 기술에 기존 상태이상을 다시 걸고 싶으면
`statusEffect: { "id": "burn", "chance": 0.25 }`처럼 데이터만 추가하면 됩니다.

## 10. 새로운 진화 추가 방법

`data/evolution.json`에 항목을 추가합니다 (`from`, `to`는 `data/pokemon.json`의 id).
`conditions`에 아래 키를 자유롭게 조합할 수 있습니다 (전부 `src/systems/EvolutionSystem.js`가
평가):

```text
requiredLevel          - 최소 레벨
requiredMove + requiredMoveLevel   - 특정 기술이 특정 레벨 이상
requiredItem + requiredItemCount   - 특정 아이템을 특정 개수(레벨) 이상 보유
requiredAbility        - 특정 특성 보유
requiredKills          - 누적 처치 수
requiredTime           - 경과 시간(초)
requiredTypeDamage: { type, amount }  - 특정 타입으로 누적 피해량 (Eevee 분기 진화 등)
```

예시:
```json
{ "from": "my_new_pokemon", "to": "my_new_pokemon_evolved",
  "conditions": { "requiredLevel": 8, "requiredMove": "ember", "requiredMoveLevel": 3 } }
```

## 11. 데이터 설계 메모

- `data/type-chart.json`은 원작 상성표(`chart`)와 게임용 상성표(`gameChart`, 0배→0.25배로
  치환)를 모두 담고 있습니다. `TypeEffectivenessSystem`은 항상 `gameChart`를 사용하고,
  이중 타입은 두 배율을 곱한 뒤 `[0.25, 4.0]`으로 clamp합니다 (spec §9~§11).
- `data/enemies.json`의 모든 종족은 "일반 야생" 스케일의 `baseStats`만 가지고 있고,
  `tier`(`normal/elite/miniboss/boss`)가 `balance.json`의 `enemyTier` 배율을 선택해
  스폰 시점에 실제 스탯을 계산합니다 (이중 스케일링 방지).
- `data/balance.json` 하나만 튜닝하면 전투 밸런스, 상태이상, 등급 확률, 시간대별 난이도,
  타입 관통 등을 전부 조절할 수 있습니다.

## 12. 알려진 단순화 사항 (프로토타입 스코프)

- 그래픽은 전부 절차적 placeholder이며 48종은 실제 아트로 교체되어 있습니다 (§4).
- 배경음악은 없습니다. 효과음은 §13에서 설명하듯 오디오 파일 없이 전부 코드로
  합성됩니다.
- `orbit`/`rain` 패턴은 엔진 레벨에서 완전히 지원되지만 현재 `data/moves.json`에는
  이 패턴을 쓰는 기술이 없습니다 (새 기술 추가 시 바로 사용 가능).

## 13. 플레이 편의 기능 (플레이테스트 피드백으로 추가됨)

- **효과음 (`src/systems/AudioSystem.js`)** - 오디오 파일을 전혀 쓰지 않고 Web Audio API의
  오실레이터로 그때그때 소리를 합성합니다 (완전 오프라인 요구사항 유지). 타격/치명타/효과가
  굉장했을 때/처치/피격/기술 습득/레벨업/카드 등급별로 다른 확인음/진화/보스 등장/일시정지/
  승리·패배 각각 고유한 사운드가 있습니다. `M` 키로 음소거, `AudioSystem.tone()`/`sweep()`을
  참고해 새 효과음을 자유롭게 추가할 수 있습니다. 브라우저 자동재생 정책 때문에 첫
  클릭/키입력 전까지는 소리가 나지 않는 것이 정상입니다.
- **일시정지 (`ESC`)** - `GameScene.manualPaused` 플래그로 메인 업데이트 루프를 완전히
  멈춥니다. 레벨업/진화 연출 중에는 겹치지 않도록 별도 플래그(`isPaused`)로 분리되어
  있습니다.
- **현재 빌드 확인 (`TAB`)** - 보유한 기술(타입·STAB 여부·패턴)·특성·아이템·능력치 강화
  목록을 한 화면에서 볼 수 있습니다. 레벨업 카드를 고를 때 "내가 지금 뭘 들고 있었지"를
  기억할 필요가 없어집니다.
- **저체력 경고** - HP가 25% 이하로 떨어지면 화면 가장자리가 붉게 맥동합니다(체력이
  낮을수록 더 빠르게). `GameScene.updateLowHpVignette`에서 임계값(`0.25`)과 강도를
  조절할 수 있습니다.
- **공격 사거리 링** - 화면에 보이지 않던 투사체 사거리/근접 판정 거리를, 보유한 기술마다
  옅은 색상의 원으로 항상 표시합니다(`GameScene.updateRangeRings`). 사거리가 겹치는
  기술은 하나로 합쳐 그려 화면이 지저분해지지 않게 했습니다.
- **레벨업 카드의 기술 설명 강화** - 기존엔 "타입 · 분류 · 위력"만 보여줬지만, 이제
  패턴(투사체/근접/빔/연쇄 등 한글), 실제 사거리(px), 쿨타임(초), 상태이상과 확률, 그리고
  현재 포켓몬 타입과 일치하면 `(STAB)` 표시까지 한 줄에 보여줍니다. 업그레이드 시에는
  `CombatSystem.moveLevelDamageMult` 테이블을 그대로 읽어 실제 위력 증가율(%)을
  보여주므로 수치가 항상 실제 전투 계산과 일치합니다 (`LevelSystem.describeChoice`).
- **이중 타입 포켓몬의 "기본 공격 타입"** - 포켓몬 자체에는 "공격 타입"이 없습니다. 각
  기술(`data/moves.json`)이 자기 고유의 `type`을 갖고 있고, 포켓몬은 그 기술을 배울 뿐입니다.
  예를 들어 Venusaur(풀/독)는 `razor_leaf`(풀)와 `sludge_bomb`(독)를 둘 다 배워서
  실제로는 두 타입의 공격을 섞어서 냅니다. `TypeEffectivenessSystem.isStab`이
  "기술 타입이 포켓몬의 타입 중 하나와 일치하면 STAB(자속보정) 1.5배"를 두 타입 모두에
  대해 적용하므로, 다중 타입 포켓몬은 손해를 보지 않고 오히려 STAB 적용 기술 선택지가
  더 넓습니다. 레벨업 카드와 TAB 빌드 확인 화면 모두에 `(STAB)` 표시가 있어 지금 어떤
  기술이 보너스를 받는지 바로 확인할 수 있습니다.

## 14. 유물(Relic) 시스템

일반 레벨업 카드(기술/아이템/특성/능력치)와는 완전히 분리된, 더 희귀하고
빌드를 크게 바꾸는 영구 보너스입니다. 데이터는 `data/relics.json`, 로직은
`ItemSystem`과 완전히 같은 "effect.type → 누적 modifier" 패턴을 그대로 따르는
`src/systems/RelicSystem.js`(`RelicSystem.accumulate`)이며, `BuildSystem`이
`this.relics = { relicId: level }`로 보유 현황을 들고 `refreshModifiers()`에서
`ItemSystem`/`AbilitySystem`과 나란히 호출합니다. 아이템의 `effect.type`과는
절대 겹치지 않는 이름을 쓰므로 두 시스템은 서로 간섭하지 않습니다.

### 획득 방법 (2가지, 아이템/기술보다 훨씬 드묾)

- **미니보스/보스 처치 시 확정 드랍** - `GameScene.killEnemy`에서 `enemy.tier`가
  `miniboss`/`boss`면 `grantGuaranteedRelic`이 호출되어 무조건 유물 하나를 줍니다
  (이미 최대 레벨을 찍은 유물은 다른 유물이 하나라도 남아있는 한 후보에서 제외되어
  "드랍이 낭비되는" 상황을 최대한 피합니다 - `GameScene.pickRelicIdForDrop`).
- **맵 필드 랜덤 스폰** - 기존 회복/스피드/자석 픽업(8~13초마다)과는 별도의 훨씬 느린
  타이머(`GameScene.nextRelicPickupTimerMs`, 3~4분마다)로 맵 위 아무 곳에나
  빙글빙글 도는 보석 형태로 등장합니다(`GameScene.spawnRelicFieldPickup`).

두 경로 모두 `BuildSystem.addRelic(relicId)`를 호출하고, 화면 상단에 노란색
"유물 획득: OOO" 배너와 전용 효과음(`AudioSystem.playRelicPickup`)으로 알려줍니다.
`TAB` 빌드 확인 화면에도 "보유 유물" 섹션이 추가되어 이름/레벨/설명을 볼 수 있습니다.

### 기본 제공 유물 8종

| 이름 | 효과 | 최대 레벨 |
|---|---|---|
| 수집가의 유물 | 아이템/경험치 구슬 수집 범위 영구 증가 | 2 |
| 기회의 유물 | 레벨업 선택 카드가 1장(레벨당) 늘어남 | 2 |
| 거인 사냥꾼의 유물 | 엘리트/미니보스/보스 상대 피해량 증가 | 2 |
| 성장의 유물 | 처치 시 얻는 경험치량 증가 | 3 |
| 재구성의 유물 | 레벨업 화면에서 카드를 다시 뽑을 수 있는 횟수 추가 (`R` 키, 화면이 새로 열릴 때마다 충전) | 2 |
| 가호의 유물 | 최대 체력 + 방어력 동시 증가 | 2 |
| 불사조의 유물 | 즉사급 피해를 받으면 완전 회복 + 짧은 무적 + 일시적 공격력 증가 (재사용 대기시간 있음, 기존 "기사회생" 생존 아이템보다 우선 적용) | 2 |
| 가속의 유물 | 처치할 때마다 이동속도/공격속도가 잠깐 중첩 증가 (콤보 끊기면 초기화) | 3 |

`relic_collector`(수집 범위)와 `relic_opportunity`(카드 1장 추가)가 요청하신
예시 효과 그대로 구현되어 있습니다.

### 새로운 유물 추가 방법

`data/relics.json`에 항목을 추가합니다. `effects[].type`은
`src/systems/RelicSystem.js`가 인식하는 값 중 하나여야 하며(`pickup_radius_mult,
extra_levelup_choices, boss_tier_damage_mult, exp_gain_mult, extra_rerolls,
relic_hp_percent, relic_defense_percent, phoenix_charge, kill_momentum_level`),
아이템 시스템의 `effect.type`과 이름이 겹치지 않도록 항상 새 이름을 씁니다.

```json
"my_new_relic": {
  "id": "my_new_relic", "name": "새 유물", "description": "설명",
  "icon": "0xff00ff", "maxLevel": 2,
  "effects": [{ "type": "exp_gain_mult", "value": 0.2 }]
}
```

새로운 `effect.type`을 쓰려면 `RelicSystem.accumulate`의 switch문에 분기를
추가하고, 그 modifier를 실제로 소비하는 지점(`CombatSystem`, `Player`,
`GameScene`, `LevelSystem` 등, 기존 relic 관련 주석 `relic_xxx:`를 검색하면
전부 찾을 수 있습니다)에도 코드를 추가해야 합니다.

## 15. "포켓몬별 공격 방식 차별화" 설계 명세 - 1차 반영분

전달주신 69개 항목짜리 대규모 설계 명세(Type Mastery, Move Evolution, 신규
공격 패턴, 생태계 기반 맵 스폰, 보스 패턴, Fairy/격투/고스트 계열 수직
슬라이스 등)는 한 번에 전부 반영하기엔 너무 크고, 명세 자체도 "Pikachu
수직 슬라이스부터 완성하고 순서대로 확장하라"(60~63번 항목)고 명시하고
있습니다. 이번 1차 패스에서는 그 원칙에 따라 **기존 구조를 그대로 유지한
채** 다음 3가지를 실제로 동작하도록 구현했습니다.

### 15-1. Type Mastery (타입 숙련도) - `data/type-mastery.json`

레벨업 카드로 고르는 게 아니라 **그냥 플레이하면 자동으로 쌓이는** 시스템입니다
(명세 30번 항목). 타입별로 적중/처치/상태이상 적중 시 XP를 얻고, 5단계까지
성장하며 각 단계는 "피해 +5%" 같은 밋밋한 수치가 아니라 **그 타입 고유의
전투 문법을 강화**합니다. 예를 들어 전기 타입은:

```
Lv1 전기 피해 +5%
Lv2 마비 확률 +5%
Lv3 연쇄(Chain) 사거리 +15%
Lv4 마비된 적에게 전기 피해 +20%
Lv5 전기 피해 +15%
```

현재 로스터에 있는 전기/불꽃/물/풀/독/노말/격투/고스트/얼음 9개 타입은
전부 개별 설계되어 있고, 그 외 타입은 `default` 항목으로 자동 대체됩니다
(게임이 죽지 않고 항상 동작). `RelicSystem`/`ItemSystem`과 동일한
"`accumulate` → 공유 modifier 누적" 아키텍처를 그대로 재사용했고, 새로 추가된
`chain_range_bonus`/`target_status_damage_bonus` 두 effect만 `CombatSystem`/
`GameScene`에 소비 지점을 추가했습니다. TAB 빌드 화면에 "타입 숙련도" 섹션이
새로 생겼습니다.

### 15-2. 생태계 기반 맵 스폰 - `data/maps.json`

명세 21번 항목("Water Map ≠ Water 적만 등장")에 따라 각 맵의 `enemyPool`/
`elitePool`을 **가중치가 있는 혼합 타입 리스트**로 바꿨습니다. 예를 들어
숲(forest) 맵은 원래 살던 풀/독/벌레/노말 계열 적이 여전히 대부분이지만,
낮은 확률로 해변(psyduck, 물)이나 화산(growlithe, 불) 같은 "방문자" 종도
섞여 등장합니다. `EnemyManager.pickFromEcosystemPool`이 이 가중치를 읽어
`PS.RandomUtils.weightedPick`으로 뽑습니다. 미니보스/보스는 아직 맵별
고정(명세 11번 Phase, 추후 확장 여지)입니다.

### 15-3. Move Evolution (기술 진화) - Pikachu 수직 슬라이스 1호

명세 33번 항목의 "기술 Lv5 + 특정 아이템 = Move EX"를 처음으로 실제
구현했습니다: **Thunder Shock를 Lv5까지 올리고 Magnet(전기 데미지 아이템)을
Lv3 이상 보유하면** 자동으로 **Thunder Shock+**로 진화합니다(패턴은
그대로 Chain이지만 연쇄 대상 수 2→4, 연쇄 사거리 170→230, 마비 확률
20%→32%, 위력도 상승). 구조는 완전히 데이터 기반입니다:

```json
"thunder_shock": {
  "...": "...",
  "evolution": {
    "evolvesTo": "thunder_shock_plus",
    "requiresMoveLevel": 5,
    "requiresItem": "magnet",
    "requiresItemLevel": 3
  }
}
```

`src/systems/MoveEvolutionSystem.js`가 매 프레임(초당 3회 스로틀) 소유한
모든 기술을 검사해 조건을 만족하는 첫 기술을 찾고, `BuildSystem.evolveMove()`가
기존 기술을 새 기술 id로 교체합니다(레벨은 유지). `MoveManager.getLearnableMovesForTypes`는
`evolvedFrom` 필드가 있는 기술(=진화로만 얻는 기술)을 일반 "새 기술 배우기"
후보에서 자동으로 제외하므로, Thunder Shock+를 진화 조건 없이 미리 뽑는
일은 없습니다. 다른 스타터의 진화 기술을 추가하려면 같은 패턴으로
`moves.json`에 `evolution` 블록 + 진화 후 기술 엔트리만 추가하면 됩니다.

## 16. "포켓몬별 공격 방식 차별화" 설계 명세 - 2차 반영분

1차 반영(Pikachu 수직 슬라이스) 이후 "나머지 부분 다 진행해줘" 요청에 따라
명세가 지정한 순서(Charmander → Squirtle → Bulbasaur)대로 나머지 스타터
수직 슬라이스와, 그 구현에 필요했던 신규 공격 패턴/Elite 변형/HUD를 추가로
반영했습니다.

### 16-1. Charmander 수직 슬라이스 - 화상(Burn) DoT + 처치 시 폭발

`ember`를 Lv5까지 올리고 `charcoal`(불 데미지 아이템)을 Lv3 이상 보유하면
**Ember+**로 진화합니다(스플래시 반경 추가, 화상 확률 상승, 위력 상승).
추가로 신규 공유 어빌리티 `burn_explosion`(화상 상태인 적 처치 시 주변에
적 최대 체력 비례 스플래시 데미지, 연쇄 처치 가능)을 `data/abilities.json`에
추가했습니다. 기존 `blaze`/`torrent`/`overgrow`와 동일하게 **특정 포켓몬
전용이 아닌 공용 어빌리티 풀**에 넣었습니다(명세의 "포켓몬 하드코딩 금지"
원칙 유지).

### 16-2. Squirtle 수직 슬라이스 - Water Gun → Beam 패턴 전환

명세 33번 항목이 예시로 든 "Water Gun(투사체) → Water Gun+(빔)"을 그대로
구현했습니다. `water_gun`을 Lv5 + `mystic_water` Lv3 조건으로 진화하면
패턴 자체가 `projectile`에서 `beam`으로 바뀌어(사거리 유지, 넉백 추가,
스플래시 반경 추가) 완전히 다른 전투 감각이 됩니다. 진화가 스탯 증가에
그치지 않고 **패턴 자체를 바꾸는** 첫 사례입니다.

### 16-3. Bulbasaur 수직 슬라이스 - Leech Seed 지속 회복 + Vine Whip+

Bulbasaur의 기본 기술을 `growl`에서 신규 기술 `leech_seed`(호밍, 상태이상
"seed" 부여)로 교체했습니다. `seed` 상태(`data/balance.json.statusEffects.seed`)가
걸린 적의 DoT 틱 데미지 중 60%가 플레이어를 회복시켜, 명세가 강조한
"Bulbasaur = 지속/회복형 빌드" 방향을 실제 체력 회복 루프로 구현했습니다.
`vine_whip`도 Lv5 + `miracle_seed` Lv3 조건으로 **Vine Whip+**(5방향 스프레드,
사거리 확대, 독 확률)로 진화합니다.

### 16-4. 신규 공격 패턴 - Cone / Dash

기존 9종(Projectile/Melee/Beam/Chain/Spread/Circle/Homing/DoT/Heal 등)에
이어 신규 패턴 2종을 `GameScene.performPlayerAttack`에 추가했습니다.
- **Cone**: 조준 방향 기준 부채꼴(`move.coneAngle`, 기본 70°) 범위 즉발
  AoE. Charmander 신규 기술 `flame_burst`가 사용.
- **Dash**: 플레이어가 조준 방향으로 직접 돌진하며 경로상의 모든 적에게
  피해(`move.beamWidth`를 돌진 폭으로 재사용). 격투 계열 신규 기술
  `mach_punch`가 사용.

### 16-5. Elite 변형 - Swift / Armored / Regenerator / Toxic / Vampiric

명세 57번 항목("Elite는 스탯만 큰 게 아니라 행동이 달라야 한다")에 따라
`data/balance.json.eliteModifiers`에 5종의 이름 있는 변형을 추가했습니다.
Elite 등급 적이 스폰될 때마다 그중 하나를 무작위로 굴려 적용합니다:

| 변형 | 효과 |
|---|---|
| Swift | 이동속도 대폭 증가 |
| Armored | 방어력 대폭 증가 |
| Regenerator | 초당 최대체력 비례 자연 회복 |
| Toxic | 플레이어를 맞출 때 중독 부여 |
| Vampiric | 플레이어에게 입힌 피해의 일부만큼 자신을 회복 |

시각적으로도 타일(색조) + 이름표(머리 위 텍스트)로 구분되어, "큰 체력바"가
아니라 눈에 보이는 다른 적으로 인지되도록 했습니다.

### 16-6. Build Summary HUD

명세 54번 항목에 따라 화면 우측 상단(종족명 아래)에 현재 가장 숙련도가
높은 타입 1~2개를 아이콘+레벨로 표시하는 `getBuildSummaryLabel()`을
추가했습니다(예: "⚡전기 Lv.3 · ⚪노말 Lv.1"). 플레이 중 자신의 빌드
정체성을 카드 화면을 열지 않고도 한눈에 확인할 수 있습니다.

## 17. "포켓몬별 공격 방식 차별화" 설계 명세 - 3차 반영분

2차 반영 이후 "계속 이어서 해줘" 요청에 따라, 로드맵에 남아있던 5개
항목(Fairy 슬라이스, 신규 패턴 3종, 보스별 고유 패턴, 종 진화 시 패턴
변경, 패턴별 성장 차별화)을 전부 마무리했습니다.

### 17-1. Fairy 계열 수직 슬라이스 - Clefairy (신규 종족 추가)

명세가 요구한 "Orbit+Aura+Shield+Homing" 조합을 위해 로스터에 없던 Fairy
타입을 신규 스타터 **Clefairy**로 추가했습니다(`data/pokemon.json`).
전용 스프라이트 PNG는 만들지 않았고, 기존 아키텍처의 안전장치(§4)에 따라
자동으로 절차적 placeholder(색상 원)로 렌더링됩니다 - 코드 수정 없이
안전하게 동작합니다.

- **Orbit**: 기본기 `moonlight_orb` - 플레이어를 도는 위성 투사체가 겹치는
  적에게 지속 피해(아래 17-2 참고)
- **Homing**: 기본기 `disarming_voice` - 자동 추적 투사체, 공격력 저하 부여
- **Aura**: 레벨업으로 배울 수 있는 `fairy_aura` - 플레이어 중심 지속 범위
  피해(17-2)
- **Shield**: 시작 어빌리티 `magic_shield`(신규, 공용 풀) - 일정 주기로
  보호막 충전, 다음 피격 1회를 완전 무효화(`Player.updateShield`/
  `takeDamage`에서 처리, 다른 시작 어빌리티들과 동일하게 공유 풀에 있어
  다른 포켓몬도 아이템/레벨업으로 획득 가능)

### 17-2. 신규 공격 패턴 - Orbit(진짜 위성) / Aura / Ground Zone / Summon / Counter

기존 로드맵에 남아있던 5개 패턴을 모두 구현했습니다 (`GameScene.
performPlayerAttack`):

- **Orbit** (재구현): 기존 "orbit"은 사실상 원형 즉발 AoE였는데, 이번에
 매 프레임 플레이어 주위를 실제로 회전하는 위성 스프라이트로 교체했습니다
 (`updateOrbitVisuals`가 시각적 위치를, 기술 쿨다운이 데미지 틱을 담당).
- **Aura**: 플레이어 중심 지속 펄스 피해 (`fairy_aura`).
- **Ground Zone**: 목표 지점에 예고(telegraph) 후 지연 발동, 이후 몇 초간
  틱 데미지가 이어지는 장판(`toxic_spikes`, Poison). 기존 "rain"(단발
  지연 폭발)과 달리 **지속되는 장판**이라는 점이 다릅니다.
- **Summon**: 캐스팅 지점에 임시 "터렛"을 소환해 지속시간 동안 주기적으로
  가장 가까운 적을 공격(`shadow_clone`, Ghost). 완전한 소환수 AI 대신
  프로토타입 스코프에 맞춘 단순화 버전입니다(§12 참고).
- **Counter**: 피격 시 반격하는 **완전히 반응형** 패턴(`counter`, Fighting).
  `Player.js`의 자동 발동 루프에서 제외되고, 대신 `GameScene.
  applyEnemyHitToPlayer`가 플레이어가 실제로 맞을 때마다 자신만의 쿨다운을
  체크해 반격을 트리거합니다.

### 17-3. 보스별 고유 타입 패턴 (명세 58번)

`Enemy.js`에 `movePool`(여러 기술을 각자 독립된 쿨다운으로 순환) 지원을
추가했습니다. 기존 `moveId` 단일 기술 방식은 일반/엘리트/미니보스에 그대로
유지되고(하위 호환), **보스만** `movePool`로 3개의 서로 다른 패턴을 한 번에
운용합니다:

| 보스 | 패턴 구성 |
|---|---|
| Vileplume (풀/독) | Petal Dance(Circle) · Razor Leaf(Spread) · Toxic Spikes(Ground Zone) |
| Gyarados (물/비행) | Hydro Pump(Beam) · Bubble(Spread) · Aqua Jet(Dash, 신규) |
| Magmar (불) | Eruption(Explosion) · Flamethrower(Beam) · Flame Burst(Cone) |

"보스 = 스탯만 큰 일반 몹"이 아니라 매 순간 다른 패턴으로 위협하는 존재가
되도록 했습니다.

### 17-4. 종 진화(species evolution) 시 공격 패턴 자체 변경

`data/evolution.json`에 `movePatternSwap` 필드를 추가하고
`EvolutionSystem.apply()`가 진화 직후 `build.evolveMove()`(기존 Move
Evolution과 동일한 함수)를 호출해 시그니처 기술의 **패턴 자체를 교체**하도록
했습니다. 이미 있던 진화 후 획득 기술을 그대로 활용해 신규 기술 정의 없이
구현했습니다:

- Charmeleon→Charizard: `ember`(투사체) → `flamethrower`(빔)
- Wartortle→Blastoise: `water_gun`(투사체) → `hydro_pump`(빔)
- Ivysaur→Venusaur: `vine_whip`(스프레드) → `solar_beam`(강타)
- Pikachu→Raichu: `thunder_shock`(연쇄) → `thunderbolt`(강타)

아이템 게이트형 Move Evolution(진화 기술 Lv5+아이템)과 별개의 경로이며,
플레이어가 이미 Move Evolution으로 해당 기술을 진화시킨 상태여도
`evolveMove`가 안전하게 동작합니다(이미 없는 `from` 기술은 그냥 무시).

### 17-5. 패턴별 성장 스탯 차별화

`data/balance.json`에 `patternGrowth` 테이블을 추가해, 패턴마다 레벨업 시
성장하는 **개성 있는 비-데미지 필드**를 하나씩 지정했습니다(데미지 자체는
기존처럼 모든 패턴이 공유하는 `moveLevelDamageMult` 곡선을 그대로 따릅니다):

| 패턴 | 레벨업으로 성장하는 필드 |
|---|---|
| Spread | 투사체 개수 |
| Chain | 연쇄 대상 수 |
| Beam / Dash | 폭(사거리 코리더) |
| Cone | 부채꼴 각도 |
| Orbit | 위성 개수 |
| Circle / Explosion / Rain / Ground Zone / Aura | 범위 반경 |
| Summon | 터렛 감지 반경 |

`GameScene.getPatternScaledField()` 하나로 모든 패턴이 공통 처리되며,
이 테이블에 없는 패턴/구버전 데이터는 그냥 기존 고정값을 유지하므로
완전히 하위 호환됩니다.

## 18. "포켓몬별 공격 방식 차별화" 설계 명세 - 4차 반영분

3차 반영 이후 "이어서 진행해줘" 요청에 따라, 남아있던 로드맵 5개 항목을
전부 마무리했습니다.

### 18-1. 야생 Fairy 타입 적 - Cleffa

`data/enemies.json`에 Fairy 타입 야생 적 **Cleffa**를 추가하고 forest 맵의
ecosystem pool에 낮은 가중치(5)의 "방문자"로 편입했습니다(`data/maps.json`).
이제 Fairy 타입도 다른 타입들처럼 실제 필드에서 마주칠 수 있는 생태계의
일원입니다.

### 18-2. Machop/Riolu(격투) 계열 - Counter 정체성

이번 라운드에 만든 Counter 패턴을 격투 계열의 정체성으로 자리잡게 했습니다:
- **Machop**은 시작부터 `counter`를 보유(원작에서도 Machop 계열의 상징적
  기술)
- **Machoke → Machamp** 진화 시 `karate_chop`(멜리) → `force_palm`(강타)로
  패턴 전환
- **Riolu → Lucario** 진화 시 `force_palm`(강타) → `aura_sphere`(호밍)로
  패턴 전환 - 원작 루카리오의 상징인 "파동탄"을 자연스럽게 재현

### 18-3. Gastly(고스트) 계열 - Summon 정체성

**Haunter → Gengar** 진화 시 `lick`(멜리) → `shadow_clone`(소환)으로
패턴이 전환되도록 했고, Gengar의 기본 무브풀에도 `shadow_clone`을
추가했습니다. 고스트 계열이 "분신을 소환해 지속적으로 괴롭히는" 정체성을
갖게 되었습니다.

### 18-4. 보스 페이즈 전환

보스(`tier === 'boss'`)의 체력이 처음 50% 이하로 내려가는 순간 1회
발동합니다(`Enemy.triggerPhase2()`, `GameScene.updateBossHpBars`에서 체크):
이동속도 +30%, 공격 쿨다운 -35%(더 자주 공격), 공격력 +30%, 화면 흔들림 +
빨간 섬광 + "OOO - 2페이즈 돌입!" 배너. movePool 기반 다중 패턴(§17-3)과
결합해 보스전이 시간이 지날수록 실제로 더 위협적으로 느껴지도록 했습니다.

### 18-5. 아이템 시너지 확장

기존 아이템들은 대부분 "타입 피해 +%" 단일 효과였는데, **패턴/상태이상과
직접 시너지를 내는** 신규 아이템 2종을 추가했습니다:
- **Orb Lens**: Orbit 패턴 기술의 위성 개수(+12%/레벨)와 회전 반경
  (+10%/레벨)을 함께 증가 - `data/balance.json`의 `patternGrowth`
  테이블이 이미 계산하던 필드를 아이템으로도 강화할 수 있도록
  `GameScene.getPatternScaledField()`에 `mods.patternFieldBonus`
  소비 로직을 추가했습니다.
- **Poison Fang**: 이미 중독 상태인 적에게 주는 독 타입 피해 증가 - Type
  Mastery의 "상태이상 대상 보너스 피해" 훅(`masteryTargetStatusHooks`)을
  아이템도 동일하게 채워 넣을 수 있도록 재사용했습니다.

이 작업 중 `TypeMasterySystem.accumulate()`가 `mods.masteryTargetStatusHooks`/
`typeChainRangeBonus`를 매번 **재할당(`= []`)**하고 있어서, 만약 아이템이
먼저 같은 배열에 기여해도 나중에 실행되는 Type Mastery가 그 기여를
지워버리는 잠재적 버그를 발견해 함께 고쳤습니다 - 이제 두 필드 모두
`BuildSystem.refreshModifiers()`가 최초 1회만 선언하고, 각 시스템은
재할당 없이 추가만 하도록 정리했습니다(실행 순서에 안전).

## 19. "포켓몬별 공격 방식 차별화" 설계 명세 - 5차 반영분

4차 반영 이후 "나머지도 진행해줘" 요청에 따라, 남아있던 마지막 로드맵
3개 항목(나머지 종족 슬라이스, 보스 3페이즈 이상, 맵별 고유 기믹)을
마무리했습니다.

### 19-1. 나머지 종족 수직 슬라이스 - Vulpix/Piplup/Eevee 브랜치

이미 있던 진화-시-패턴-교체 메커니즘(§17-4)을 그대로 재사용해, 신규 기술
정의 없이 5개 종족 라인에 고유 정체성을 부여했습니다:

| 진화 | 패턴 전환 |
|---|---|
| Vulpix → Ninetales | `ember`(투사체) → `flame_burst`(부채꼴 Cone) |
| Prinplup → Empoleon | `bubble`(스프레드) → `aqua_jet`(대시) |
| Eevee → Flareon | `ember`(투사체) → `fire_blast`(폭발) |
| Eevee → Vaporeon | `water_gun`(투사체) → `aqua_jet`(대시) |
| Eevee → Jolteon | `quick_attack`(멜리) → `thunder`(연쇄) |

이로써 로스터의 모든 진화 라인이 "그냥 스탯만 오르는 진화"가 아니라
저마다 다른 공격 패턴으로 도착하게 되었습니다.

### 19-2. 보스 다단계 페이즈 시스템

기존 1개뿐이던 페이즈 전환(§18-4)을 `data/balance.json`의 `bossPhases`
배열 기반 **다단계 시스템**으로 일반화했습니다. 몇 단계든 데이터로 추가할
수 있으며, 현재는 2단계(체력 50%/20%)가 기본 설정되어 있습니다:

| 임계값 | 이동속도 | 공격 쿨다운 | 공격력 |
|---|---|---|---|
| 50% | ×1.3 | ×0.8 (더 자주 공격) | ×1.15 |
| 20% (최종 페이즈) | ×1.6 | ×0.6 | ×1.35 |

각 단계는 이전 단계에 누적 곱해지는 게 아니라 기준 스탯에서 절대값으로
계산되어(`Enemy.baseSpeed` 기준) 밸런스 예측이 쉽습니다. 이 작업 중
`Enemy.js`의 단일 `phase2Active`/`triggerPhase2()` 구조를 `phaseIndex`/
`applyBossPhase()`로 리팩터링했습니다.

### 19-3. 맵별 고유 기믹 (환경 위험 요소)

`data/maps.json`에 맵마다 `hazard` 설정을 추가하고, `GameScene.
updateMapHazard`/`spawnMapHazardZone`이라는 **범용** 시스템 하나로 세
가지 효과 타입을 전부 처리합니다(맵마다 코드를 따로 만들지 않음):

- **Forest - 포자 구름 (heal_zone)**: 안에 있는 적을 지속 회복시켜, 적을
  방치하면 안 된다는 압박을 줍니다.
- **Beach - 밀물 웅덩이 (slow_zone)**: 안에 있으면 플레이어 이동속도가
  크게 감소해 재배치를 강요합니다(`Player.applyHazardSlow` - 기존
  `applyFieldSpeedBuff`가 버프 전용 `Math.max` 방식이라 디버프에는 쓸 수
  없어서 `Math.min` 기반의 별도 경로로 추가).
- **Volcano - 용암 비말 (damage_zone)**: 안에 있으면 최대체력 비례 피해를
  지속적으로 입습니다.

플레이어 주변 무작위 위치에 주기적으로 생성되며, 시각적으로 반투명 원 +
페이드 애니메이션으로 표시됩니다. `hazard` 필드가 없는 맵/구버전 데이터는
아무 일도 일어나지 않으므로 완전히 하위 호환입니다.

### 다음 단계

69개 항목 명세 중 남아있는 것은 이제 정말 지엽적인 다듬기 수준입니다
(예: 보스별로 서로 다른 `bossPhases` 커스터마이징, 맵 기믹 시각 이펙트
고도화, 아이템 시너지 추가 조합 등). 명세가 명시적으로 우선순위를 준
"포켓몬별 공격 방식 차별화"의 핵심 뼈대 - Type Mastery, Move Evolution,
생태계 스폰(야생 Fairy 포함), 7개 타입 계열의 완결된 수직 슬라이스(전기·
불꽃·물·풀·페어리·격투·고스트, 각각 진화 시 패턴 전환까지 포함), 13종
공격 패턴, Elite 변형, 보스 다중 패턴 + 다단계 페이즈 전환, 패턴별 성장
차별화, 패턴/상태이상 시너지 아이템, 맵별 고유 기믹, Build Summary HUD -
는 1~5차 반영을 통해 모두 실제로 동작하는 상태입니다.
