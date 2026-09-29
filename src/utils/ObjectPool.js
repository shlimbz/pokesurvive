// ObjectPool: generic reusable-object pool to avoid GC churn with large numbers of
// enemies / projectiles / particles / damage numbers on screen at once.
window.PS = window.PS || {};

PS.ObjectPool = class ObjectPool {
  /**
   * @param {Function} factory - () => object, creates a brand new instance.
   * @param {Function} reset - (object, ...args) => void, re-initializes a reused instance.
   * @param {number} initialSize
   */
  constructor(factory, reset, initialSize = 0) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    this.active = new Set();

    for (let i = 0; i < initialSize; i++) {
      const obj = this.factory();
      if (obj.setActive) obj.setActive(false);
      if (obj.setVisible) obj.setVisible(false);
      this.free.push(obj);
    }
  }

  obtain(...args) {
    let obj = this.free.pop();
    if (!obj) obj = this.factory();
    this.reset(obj, ...args);
    this.active.add(obj);
    if (obj.setActive) obj.setActive(true);
    if (obj.setVisible) obj.setVisible(true);
    return obj;
  }

  release(obj) {
    if (!this.active.has(obj)) return;
    this.active.delete(obj);
    if (obj.setActive) obj.setActive(false);
    if (obj.setVisible) obj.setVisible(false);
    if (obj.body) obj.body.stop && obj.body.stop();
    this.free.push(obj);
  }

  releaseAll() {
    for (const obj of Array.from(this.active)) this.release(obj);
  }

  forEachActive(fn) {
    for (const obj of this.active) fn(obj);
  }

  get activeCount() {
    return this.active.size;
  }
};
