'use strict';

class TabAliasMap {
  constructor() {
    this.nextId = 1;
    this.aliasToKey = new Map();
    this.keyToAlias = new Map();
  }

  allocate(key) {
    const existing = this.keyToAlias.get(key);
    if (existing != null) return existing;
    const alias = this.nextId++;
    this.aliasToKey.set(alias, key);
    this.keyToAlias.set(key, alias);
    return alias;
  }

  resolve(tabId) {
    return this.aliasToKey.get(Number(tabId));
  }

  release(key) {
    const alias = this.keyToAlias.get(key);
    if (alias == null) return;
    this.keyToAlias.delete(key);
    this.aliasToKey.delete(alias);
  }

  clear() {
    this.aliasToKey.clear();
    this.keyToAlias.clear();
  }
}

module.exports = { TabAliasMap };
