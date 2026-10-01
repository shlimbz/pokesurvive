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
    // A crisp white outline on EVERY shape (not just poison/dragon, as before) - 2026-10-01
    // feedback ("각 속성을 확실히 알아볼 수 있게"): these already-distinct per-type silhouettes
    // (triangle/droplet/bolt/leaf/etc, one per type) were losing their edges against busy
    // backgrounds and overlapping particle bursts once scaled up, especially now that every
    // sprite using this texture got noticeably bigger. A consistent stroke keeps the silhouette
    // readable at a glance regardless of what's behind it, on top of the existing per-type shape.
    const outline = () => g.lineStyle(1.6, 0xffffff, 0.75);

    switch (typeId) {
      case 'fire':
      case 'flame':
        outline();
        g.fillTriangle(cx, 2, cx - 8, size - 2, cx + 8, size - 2);
        g.strokeTriangle(cx, 2, cx - 8, size - 2, cx + 8, size - 2);
        break;
      case 'water':
      case 'drop':
        outline();
        g.fillCircle(cx, cy + 3, 8);
        g.strokeCircle(cx, cy + 3, 8);
        g.fillTriangle(cx, 1, cx - 6, cy, cx + 6, cy);
        g.strokeTriangle(cx, 1, cx - 6, cy, cx + 6, cy);
        break;
      case 'electric':
      case 'bolt': {
        outline();
        const pts = [
          { x: cx - 2, y: 2 }, { x: cx + 6, y: cy - 2 }, { x: cx, y: cy },
          { x: cx + 2, y: size - 2 }, { x: cx - 6, y: cy + 2 }, { x: cx, y: cy }
        ];
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 'grass':
      case 'leaf':
        outline();
        g.fillEllipse(cx, cy, 8, 14);
        g.strokeEllipse(cx, cy, 8, 14);
        break;
      case 'ice':
      case 'shard':
        outline();
        g.fillTriangle(cx, 2, cx - 7, size - 2, cx + 7, size - 2);
        g.strokeTriangle(cx, 2, cx - 7, size - 2, cx + 7, size - 2);
        g.fillTriangle(cx, size - 2, cx - 7, 2, cx + 7, 2);
        g.strokeTriangle(cx, size - 2, cx - 7, 2, cx + 7, 2);
        break;
      case 'poison':
      case 'bubble':
        g.fillCircle(cx, cy, 9);
        g.lineStyle(1.6, 0xffffff, 0.75);
        g.strokeCircle(cx, cy, 9);
        break;
      case 'fairy':
      case 'sparkle': {
        outline();
        const pts = [
          { x: cx, y: 1 }, { x: cx + 3, y: cy - 3 }, { x: size - 1, y: cy },
          { x: cx + 3, y: cy + 3 }, { x: cx, y: size - 1 }, { x: cx - 3, y: cy + 3 },
          { x: 1, y: cy }, { x: cx - 3, y: cy - 3 }
        ];
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 'fighting':
      case 'fist':
        // Knuckle-duster silhouette: a chunky rounded block with three knuckle bumps.
        outline();
        g.fillRoundedRect(cx - 8, cy - 4, 16, 11, 3);
        g.strokeRoundedRect(cx - 8, cy - 4, 16, 11, 3);
        g.fillCircle(cx - 4, cy - 5, 3);
        g.fillCircle(cx, cy - 6, 3.5);
        g.fillCircle(cx + 4, cy - 5, 3);
        break;
      case 'ground':
      case 'quake':
        // Jagged shards erupting from cracked ground.
        outline();
        g.fillTriangle(cx - 8, size - 2, cx - 4, 3, cx - 1, size - 2);
        g.strokeTriangle(cx - 8, size - 2, cx - 4, 3, cx - 1, size - 2);
        g.fillTriangle(cx - 1, size - 2, cx + 3, 1, cx + 7, size - 2);
        g.strokeTriangle(cx - 1, size - 2, cx + 3, 1, cx + 7, size - 2);
        g.fillRect(2, size - 4, size - 4, 3);
        break;
      case 'flying':
      case 'wing':
        // Two swept-back wing blades forming a chevron.
        outline();
        g.fillTriangle(cx, cy, 1, 3, 7, cy + 4);
        g.strokeTriangle(cx, cy, 1, 3, 7, cy + 4);
        g.fillTriangle(cx, cy, size - 1, 3, size - 7, cy + 4);
        g.strokeTriangle(cx, cy, size - 1, 3, size - 7, cy + 4);
        break;
      case 'psychic':
      case 'swirl':
        // Triskelion (three curved blades) suggesting a psychic vortex.
        outline();
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const bx = cx + Math.cos(a) * 7;
          const by = cy + Math.sin(a) * 7;
          const tx = cx + Math.cos(a + 1.3) * 3;
          const ty = cy + Math.sin(a + 1.3) * 3;
          g.fillTriangle(cx, cy, bx, by, tx, ty);
          g.strokeTriangle(cx, cy, bx, by, tx, ty);
        }
        break;
      case 'bug':
      case 'sting':
        // Thin elongated stinger needle.
        outline();
        g.fillTriangle(cx, 1, cx - 3, cy + 4, cx + 3, cy + 4);
        g.strokeTriangle(cx, 1, cx - 3, cy + 4, cx + 3, cy + 4);
        g.fillRect(cx - 2, cy + 3, 4, size - cy - 5);
        break;
      case 'rock':
      case 'chunk': {
        // Irregular jagged boulder outline.
        outline();
        const pts = [
          { x: cx - 9, y: cy + 2 }, { x: cx - 5, y: cy - 8 }, { x: cx + 2, y: cy - 9 },
          { x: cx + 9, y: cy - 2 }, { x: cx + 6, y: cy + 8 }, { x: cx - 4, y: cy + 9 }
        ];
        g.fillPoints(pts, true);
        g.strokePoints(pts, true);
        break;
      }
      case 'ghost':
      case 'wisp':
        // Two offset wavy teardrops giving a floating-wisp silhouette.
        outline();
        g.fillCircle(cx - 2, cy + 4, 6);
        g.strokeCircle(cx - 2, cy + 4, 6);
        g.fillTriangle(cx - 2, 1, cx - 7, cy + 2, cx + 3, cy + 2);
        g.strokeTriangle(cx - 2, 1, cx - 7, cy + 2, cx + 3, cy + 2);
        break;
      case 'dragon':
      case 'orb':
        // Glowing core with a faint outer ring (draconic energy sphere).
        g.lineStyle(2, 0xffffff, 0.35);
        g.strokeCircle(cx, cy, 11);
        g.fillStyle(c, 1);
        g.fillCircle(cx, cy, 7);
        g.lineStyle(1.6, 0xffffff, 0.75);
        g.strokeCircle(cx, cy, 7);
        break;
      case 'dark':
      case 'spike':
        // Fanned claw-slash spikes.
        outline();
        g.fillTriangle(cx - 8, size - 2, cx - 5, 2, cx - 2, size - 2);
        g.strokeTriangle(cx - 8, size - 2, cx - 5, 2, cx - 2, size - 2);
        g.fillTriangle(cx - 2, size - 2, cx + 1, 1, cx + 4, size - 2);
        g.strokeTriangle(cx - 2, size - 2, cx + 1, 1, cx + 4, size - 2);
        g.fillTriangle(cx + 4, size - 2, cx + 7, 3, cx + 10, size - 2);
        g.strokeTriangle(cx + 4, size - 2, cx + 7, 3, cx + 10, size - 2);
        break;
      case 'steel':
      case 'gear':
        // Simplified cog: circle with teeth around the rim.
        outline();
        g.fillCircle(cx, cy, 6);
        g.strokeCircle(cx, cy, 6);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.fillRect(cx + Math.cos(a) * 7 - 1.5, cy + Math.sin(a) * 7 - 1.5, 3, 3);
        }
        break;
      default:
        outline();
        g.fillCircle(cx, cy, 8);
        g.strokeCircle(cx, cy, 8);
        break;
    }
    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }

  generateBarTexture(key, color, w = 100, h = 10) {
    this.generateSolidTexture(key, color, w, h);
  }

  // ---- Relic pickup icon: a glowing diamond/gem, visually distinct from the round field
  // pickups (heal/speed/magnet) so a relic reads as rarer/more important on sight. ----
  generateRelicTexture(key, color, radius = 16) {
    if (this.scene.textures.exists(key)) return key;
    const g = this.scene.add.graphics();
    const c = this.hexToInt(color);
    const size = radius * 2 + 10;
    const cx = size / 2, cy = size / 2;

    // Soft outer glow ring.
    g.lineStyle(3, c, 0.35);
    g.strokeCircle(cx, cy, radius + 3);

    // Faceted diamond body.
    g.fillStyle(c, 1);
    g.fillPoints([
      { x: cx, y: cy - radius }, { x: cx + radius * 0.72, y: cy },
      { x: cx, y: cy + radius }, { x: cx - radius * 0.72, y: cy }
    ], true);
    g.lineStyle(2, 0xffffff, 0.85);
    g.strokePoints([
      { x: cx, y: cy - radius }, { x: cx + radius * 0.72, y: cy },
      { x: cx, y: cy + radius }, { x: cx - radius * 0.72, y: cy }
    ], true);
    // Inner facet lines for a "cut gem" look.
    g.lineStyle(1, 0xffffff, 0.6);
    g.lineBetween(cx, cy - radius, cx, cy + radius);
    g.lineBetween(cx - radius * 0.72, cy, cx + radius * 0.72, cy);

    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }
};
