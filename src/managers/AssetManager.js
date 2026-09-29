// AssetManager: generates every texture the game needs procedurally with Phaser.Graphics,
// so the game runs fully offline with zero external image downloads. If a real sprite file
// has been placed under assets/pokemon/<id>.png (e.g. via tools/download-pokeapi.js), that
// file is used instead automatically - see PreloadScene for the fallback logic.
window.PS = window.PS || {};

PS.AssetManager = class AssetManager {
  constructor(scene) {
    this.scene = scene;
  }

  hexToInt(hex) {
    if (typeof hex === 'number') return hex;
    return parseInt(hex.replace('0x', '').replace('#', ''), 16);
  }

  // ---- Pokemon / enemy placeholder sprite: colored circle + initial letter ----
  generateCreatureTexture(key, color, radius = 28, letter = '') {
    if (this.scene.textures.exists(key)) return;
    const g = this.scene.add.graphics();
    const size = radius * 2 + 8;
    const cx = size / 2;
    const cy = size / 2;
    const c = this.hexToInt(color);

    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(cx, cy + radius * 0.75, radius * 1.4, radius * 0.5);

    g.fillStyle(c, 1);
    g.fillCircle(cx, cy, radius);
    g.lineStyle(3, 0xffffff, 0.9);
    g.strokeCircle(cx, cy, radius);

    if (letter) {
      const txt = this.scene.add.text(0, 0, letter, {
        fontFamily: 'Arial Black, sans-serif',
        fontSize: `${Math.round(radius * 1.1)}px`,
        color: '#1a1a1a'
      });
      txt.setOrigin(0.5);
      txt.setPosition(cx, cy);
      const rt = this.scene.add.renderTexture(0, 0, size, size);
      rt.draw(g, 0, 0);
      rt.draw(txt, cx, cy);
      rt.saveTexture(key);
      rt.destroy();
      txt.destroy();
      g.destroy();
      return;
    }

    g.generateTexture(key, size, size);
    g.destroy();
  }

  // ---- Simple square/UI textures ----
  generateSolidTexture(key, color, w, h, alpha = 1) {
    if (this.scene.textures.exists(key)) return;
    const g = this.scene.add.graphics();
    g.fillStyle(this.hexToInt(color), alpha);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  generateCircleTexture(key, color, radius, alpha = 1) {
    if (this.scene.textures.exists(key)) return;
    const g = this.scene.add.graphics();
    g.fillStyle(this.hexToInt(color), alpha);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
  }

  // ---- VFX particle shapes: one small texture per type, reused at different scales ----
  generateVfxTexture(typeId, color) {
    const key = `vfx_${typeId}`;
    if (this.scene.textures.exists(key)) return key;
    const g = this.scene.add.graphics();
    const c = this.hexToInt(color);
    const size = 24;
    const cx = size / 2;
    const cy = size / 2;
    g.fillStyle(c, 1);
    g.lineStyle(2, 0xffffff, 0.6);

    switch (typeId) {
      case 'fire':
      case 'flame':
        g.fillTriangle(cx, 2, cx - 8, size - 2, cx + 8, size - 2);
        break;
      case 'water':
      case 'drop':
        g.fillCircle(cx, cy + 3, 8);
        g.fillTriangle(cx, 1, cx - 6, cy, cx + 6, cy);
        break;
      case 'electric':
      case 'bolt':
        g.fillPoints([
          { x: cx - 2, y: 2 }, { x: cx + 6, y: cy - 2 }, { x: cx, y: cy },
          { x: cx + 2, y: size - 2 }, { x: cx - 6, y: cy + 2 }, { x: cx, y: cy }
        ], true);
        break;
      case 'grass':
      case 'leaf':
        g.fillEllipse(cx, cy, 8, 14);
        break;
      case 'ice':
      case 'shard':
        g.fillTriangle(cx, 2, cx - 7, size - 2, cx + 7, size - 2);
        g.fillTriangle(cx, size - 2, cx - 7, 2, cx + 7, 2);
        break;
      case 'poison':
      case 'bubble':
        g.fillCircle(cx, cy, 9);
        g.lineStyle(1, 0xffffff, 0.5);
        g.strokeCircle(cx, cy, 9);
        break;
      case 'fairy':
      case 'sparkle':
        g.fillPoints([
          { x: cx, y: 1 }, { x: cx + 3, y: cy - 3 }, { x: size - 1, y: cy },
          { x: cx + 3, y: cy + 3 }, { x: cx, y: size - 1 }, { x: cx - 3, y: cy + 3 },
          { x: 1, y: cy }, { x: cx - 3, y: cy - 3 }
        ], true);
        break;
      default:
        g.fillCircle(cx, cy, 8);
        break;
    }
    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }

  generateBarTexture(key, color, w = 100, h = 10) {
    this.generateSolidTexture(key, color, w, h);
  }
};
