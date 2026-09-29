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
만들어줍니다. `shape`는 `generateVfxTexture`의 switch문에 있는 값(fire/water/bolt/leaf/
shard/fist/bubble/chunk/wing/swirl/sting/wisp/orb/spike/sparkle 등) 중 하나를 쓰거나,
새 도형을 그리고 싶으면 그 switch문에 case를 하나 추가하면 됩니다.

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

- 그래픽은 전부 절차적 placeholder입니다 (§4에서 실제 아트로 교체 가능).
- 오디오 에셋은 포함되어 있지 않습니다 (`AudioSystem`은 파일이 없으면 안전하게 무시).
- `orbit`/`rain` 패턴은 엔진 레벨에서 완전히 지원되지만 현재 `data/moves.json`에는
  이 패턴을 쓰는 기술이 없습니다 (새 기술 추가 시 바로 사용 가능).
