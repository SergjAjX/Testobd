/* ============================================================
   Profiles — мульти-автомобили через localStorage
   ============================================================ */
const Profiles = {
  KEY: 'obd_profiles_v1',
  LEGACY_STATE_KEY: 'obd_maintenance_v1',
  LEGACY_MILEAGE_KEY: 'obd_mileage_v1',
  _data: null,

  _load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        this._data = JSON.parse(raw);
        if (!this._data.profiles) this._data.profiles = {};
        return this._data;
      }
    } catch {}

    this._data = { activeId: null, profiles: {} };

    // Миграция старого одиночного формата
    try {
      const oldState = localStorage.getItem(this.LEGACY_STATE_KEY);
      if (oldState) {
        const oldData = JSON.parse(oldState);
        const id = 'p_migrated_' + Date.now().toString(36);
        this._data.profiles[id] = {
          id,
          vin: null,
          plate: null,
          name: 'Профиль 1 (перенесён)',
          engine: oldData.engine || null,
          createdAt: Date.now(),
          mileage: oldData.mileage || null,
          mileageSource: oldData.mileageSource || 'manual',
          mileageUpdated: oldData.mileageUpdated || null,
          items: oldData.items || [],
          journal: oldData.journal || [],
        };
        this._data.activeId = id;
        this._save();
        localStorage.removeItem(this.LEGACY_STATE_KEY);
      }
    } catch (e) { console.warn('Миграция не удалась', e); }

    return this._data;
  },

  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._data)); }
    catch (e) { console.error('save failed', e); throw e; }
  },

  all() {
    return Object.values(this._load().profiles)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },

  active() {
    const d = this._load();
    return d.activeId ? (d.profiles[d.activeId] || null) : null;
  },

  setActive(id) {
    const d = this._load();
    if (!d.profiles[id]) return false;
    d.activeId = id;
    this._save();
    return true;
  },

  create({ vin, plate, name, engine }) {
    const d = this._load();
    const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const profile = {
      id,
      vin: vin ? vin.toUpperCase() : null,
      plate: plate ? plate.toUpperCase().trim() : null,
      name: name || (vin ? 'Logan VIN ' + vin.slice(-6) : 'Новый профиль'),
      engine: engine || null,
      createdAt: Date.now(),
      mileage: null,
      mileageSource: 'manual',
      mileageUpdated: null,
      items: [],
      journal: [],
    };
    d.profiles[id] = profile;
    if (!d.activeId) d.activeId = id;
    this._save();
    return profile;
  },

  findByVin(vin) {
    if (!vin) return null;
    const needle = vin.toUpperCase().trim();
    return Object.values(this._load().profiles)
      .find(p => p.vin && p.vin === needle) || null;
  },

  update(id, patch) {
    const d = this._load();
    if (!d.profiles[id]) return false;
    Object.assign(d.profiles[id], patch);
    this._save();
    return true;
  },

  remove(id) {
    const d = this._load();
    if (!d.profiles[id]) return false;
    delete d.profiles[id];
    if (d.activeId === id) {
      const ids = Object.keys(d.profiles);
      d.activeId = ids.length ? ids[0] : null;
    }
    this._save();
    return true;
  },

  label(profile) {
    if (!profile) return '—';
    const parts = [];
    if (profile.name) parts.push(profile.name);
    if (profile.plate) parts.push('[' + profile.plate + ']');
    return parts.length ? parts.join(' ') : 'Без имени';
  },
};