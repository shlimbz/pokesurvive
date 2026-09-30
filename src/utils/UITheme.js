// UITheme: shared color palette + small drawing helpers so every scene's UI (HUD, menus,
// level-up cards, pause overlay) reads as ONE consistent design instead of each screen picking
// its own ad hoc rectangle colors/paddings. Purely additive - existing scenes keep working even
// if they never touch this file; it's opt-in decoration, not a new layout engine.
window.PS = window.PS || {};

PS.UITheme = {
  colors: {
    panelBg: 0x11161d,
    panelBorder: 0x2c3947,
    panelBgAlpha: 0.88,
    accentGood: 0x62ffb0,   // exp bar, confirm buttons, positive feedback
    accentHp: 0xff4d4d,     // hp bar
    accentGold: 0xffd400,   // species name / important highlight
    accentBlue: 0x8fd3ff,   // secondary info (mastery, toggle links)
    danger: 0xff5c5c        // quit / destructive actions
  },
  text: {
    primary: '#f2f5f8',
    secondary: '#9fb0c0',
    muted: '#6c7a89',
    good: '#62ffb0',
    hp: '#ff6b6b',
    gold: '#ffd400',
    blue: '#8fd3ff'
  },

  /** Rounded-rect panel background, drawn once and returned so text can be layered on top of it
   * without every individual line needing its own backgroundColor (the old HUD's stat panel did
   * this per-line, which produced a ragged stack of differently-sized bars instead of one card). */
  panel(scene, x, y, w, h, originX = 0, originY = 0, opts = {}) {
    const c = PS.UITheme.colors;
    const g = scene.add.graphics();
    const ox = -w * originX, oy = -h * originY;
    g.fillStyle(opts.bg ?? c.panelBg, opts.bgAlpha ?? c.panelBgAlpha);
    g.fillRoundedRect(ox, oy, w, h, opts.radius ?? 8);
    if (opts.border !== false) {
      g.lineStyle(1, opts.borderColor ?? c.panelBorder, 1);
      g.strokeRoundedRect(ox, oy, w, h, opts.radius ?? 8);
    }
    g.setPosition(x, y);
    if (opts.scrollFactor === 0) g.setScrollFactor(0);
    if (opts.depth !== undefined) g.setDepth(opts.depth);
    return g;
  },

  /** A slim rounded meter (HP/EXP-style bar) - background track + fill, fill width set later via
   * setMeterFill(). Returns { bg, fill, width, height } so callers keep their own references. */
  meter(scene, x, y, w, h, fillColor, opts = {}) {
    const c = PS.UITheme.colors;
    const radius = h / 2;
    const bg = scene.add.graphics();
    bg.fillStyle(opts.trackColor ?? 0x000000, opts.trackAlpha ?? 0.35);
    bg.fillRoundedRect(0, 0, w, h, radius);
    bg.setPosition(x, y);
    if (opts.scrollFactor === 0) bg.setScrollFactor(0);
    if (opts.depth !== undefined) bg.setDepth(opts.depth);

    const fill = scene.add.graphics();
    fill.setPosition(x, y);
    if (opts.scrollFactor === 0) fill.setScrollFactor(0);
    if (opts.depth !== undefined) fill.setDepth(opts.depth + 1);

    const state = { bg, fill, w, h, radius, color: fillColor };
    PS.UITheme.setMeterFill(state, 1);
    return state;
  },

  setMeterFill(meter, ratio) {
    ratio = Phaser.Math.Clamp(ratio, 0, 1);
    meter.fill.clear();
    if (ratio <= 0) return;
    meter.fill.fillStyle(meter.color, 1);
    const w = Math.max(meter.h, meter.w * ratio); // never shrink thinner than it is tall (keeps rounded caps sane)
    meter.fill.fillRoundedRect(0, 0, w, meter.h, meter.radius);
  }
};
