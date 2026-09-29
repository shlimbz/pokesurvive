// ItemManager: wraps data/items.json.
window.PS = window.PS || {};

PS.ItemManager = class ItemManager {
  constructor(itemData) {
    this.data = itemData;
  }

  getItem(id) {
    return this.data[id];
  }

  getAllIds() {
    return Object.keys(this.data);
  }

  getAllByGrade(grade) {
    return Object.values(this.data).filter(i => i.grade === grade);
  }
};
