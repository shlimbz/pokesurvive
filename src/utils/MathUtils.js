// MathUtils: small math helpers shared across systems/entities.
window.PS = window.PS || {};

PS.MathUtils = {
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  distance(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  },

  distanceSq(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
  },

  angleBetween(ax, ay, bx, by) {
    return Math.atan2(by - ay, bx - ax);
  },

  angleToVector(angle) {
    return { x: Math.cos(angle), y: Math.sin(angle) };
  },

  normalize(x, y) {
    const len = Math.sqrt(x * x + y * y);
    if (len === 0) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  },

  round(value, decimals = 0) {
    const m = Math.pow(10, decimals);
    return Math.round(value * m) / m;
  },

  /**
   * Gives an Arcade Physics sprite a circular hitbox of `worldRadius` PIXELS ON SCREEN,
   * centered on the sprite, regardless of the source texture's native resolution.
   * Needed because setDisplaySize() scales a sprite to a fixed on-screen size whether its
   * texture is a tiny 64x64 placeholder or a ~475x475 downloaded PokeAPI artwork PNG -
   * body.setCircle() takes its radius/offset in the texture's own (unscaled) pixel space, so
   * a fixed number there would produce a near-invisible hitbox on a large source image.
   */
  fitCircularBody(sprite, worldRadius) {
    const scaleX = sprite.scaleX || 1;
    const frame = sprite.frame;
    const localRadius = worldRadius / scaleX;
    const offsetX = frame.width / 2 - localRadius;
    const offsetY = frame.height / 2 - localRadius;
    sprite.body.setCircle(localRadius, offsetX, offsetY);
  }
};
