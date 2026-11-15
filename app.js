/* ============================================================
   Renault Logan OBD - app.js v1.4
   Changes v1.4:
     - Проверен синтаксис (node --check), файл цельный
     - Пробег из OBD не записывается автоматически (MILEAGE_OBD_TRUSTED)
     - Эксклюзивный режим: опрос датчиков не мешает ATSH / DTC / пробегу
     - Исправлен разбор DTC (заголовок K-Line)
     - Убраны недопустимые заголовки, восстановление заголовка по профилю
     - Отмена выбора профиля прерывает инициализацию
     - Проверка данных при импорте
   ============================================================ */

const APP_VERSION = '1.4';
const MILEAGE_OBD_TRUSTED = false; // true только после проверки пробега на реальной машине

const STORAGE = {
  PROFILES: 'obd_profiles_v2',
  SETTINGS: 'obd_settings_v2',
  LOG: 'obd_log_unsaved_v2',
  LAST_EXPORT: 'obd_last_export_v2',
};

const BLE_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
];

const REQUIRED_IDS = [
  'loader', 'gauges', 'chart1', 'chart2', 'connStatus', 'connDevice', 'connProtocol',
  'vinValue', 'pidCount', 'mileageValue', 'btnConnect', 'btnDemo', 'btnReadDtc',
  'btnClearDtc', 'btnReadMileage', 'dtcList', 'btnStartLog', 'btnStopLog',
  'btnDownloadLog', 'logStatus', 'profileBadge', 'profileName', 'profileBar',
  'noProfile', 'profileContent', 'btnCreateProfile', 'newProfileName', 'newProfileVin',
  'newProfilePlate', 'profilesList', 'btnNewProfile', 'toMileage', 'toMileageSource',
  'toMileageUpdated', 'btnEditMileage', 'btnSyncMileage', 'engineSelect', 'engineMeta',
  'btnResetIntervals', 'toAlerts', 'itemsList', 'btnAddItem', 'recDate', 'recKm',
  'recItem', 'recCost', 'recNote', 'btnAddRecord', 'journalBody', 'journalSummary',
  'btnExport', 'btnImport', 'fileInput', 'btnPrint', 'btnBackupAll', 'btnClearAll',
  'cfgSound', 'cfgAutosave', 'cfgInterval', 'cfgIntervalVal', 'cfgRenaultProfile',
  'appVersion',
];

const RENAULT_PROFILES = {
  auto: {
    name: 'Авто (ATSP0)',
    init: ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP0'],
    resetHdr: '7DF',
    mileage: [
      { hdr: '7E0', cmd: '22F187' },
      { hdr: '720', cmd: '22F187' },
      { hdr: '743', cmd: '22F187' },
    ],
  },
  logan1: {
    name: 'Logan 1 · K-Line · EMS3132',
    init: ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP5', 'ATIB 10', 'ATIIA 13', 'ATWM 82 13 F1'],
    resetHdr: 'C133F1',
    mileage: [
      { hdr: '8110F1', cmd: '2101' },
    ],
  },
  logan2: {
    name: 'Logan 2/3 · CAN · EMS3120/3125',
    init: ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH1', 'ATSP6'],
    resetHdr: '7DF',
    mileage: [
      { hdr: '7E0', cmd: '22F187' },
      { hdr: '720', cmd: '22F187' },
      { hdr: '743', cmd: '22F187' },
      { hdr: '7C6', cmd: '22F187' },
    ],
  },
};

const PID_DEFS = {
  rpm:      { pid: '010C', name: 'Обороты', unit: 'об/мин', max: 7000,
              dec: h => (parseInt(h.substr(0, 2), 16) * 256 + parseInt(h.substr(2, 2), 16)) / 4 },
  speed:    { pid: '010D', name: 'Скорость', unit: 'км/ч', max: 200,
              dec: h => parseInt(h.substr(0, 2), 16) },
  coolant:  { pid: '0105', name: 'Темп. ОЖ', unit: '°C', max: 130,
              dec: h => parseInt(h.substr(0, 2), 16) - 40 },
  intake:   { pid: '010F', name: 'Темп. воздуха', unit: '°C', max: 80,
              dec: h => parseInt(h.substr(0, 2), 16) - 40 },
  load:     { pid: '0104', name: 'Нагрузка', unit: '%', max: 100,
              dec: h => parseInt(h.substr(0, 2), 16) * 100 / 255 },
  tps:      { pid: '0111', name: 'Дроссель', unit: '%', max: 100,
              dec: h => parseInt(h.substr(0, 2), 16) * 100 / 255 },
  map:      { pid: '010B', name: 'MAP', unit: 'кПа', max: 255,
              dec: h => parseInt(h.substr(0, 2), 16) },
  stft:     { pid: '0106', name: 'STFT', unit: '%', max: 50,
              dec: h => (parseInt(h.substr(0, 2), 16) - 128) * 100 / 128 },
  ltft:     { pid: '0107', name: 'LTFT', unit: '%', max: 50,
              dec: h => (parseInt(h.substr(0, 2), 16) - 128) * 100 / 128 },
  timing:   { pid: '010E', name: 'УОЗ', unit: '°', max: 60,
              dec: h => parseInt(h.substr(0, 2), 16) / 2 - 64 },
  fuel:     { pid: '012F', name: 'Топливо', unit: '%', max: 100,
              dec: h => parseInt(h.substr(0, 2), 16) * 100 / 255 },
  batt:     { pid: 'ATRV', name: 'Напряжение', unit: 'В', max: 16,
              at: true, dec: t => parseFloat(t) },
};

const GAUGE_GROUPS = {
  main:   ['rpm', 'speed', 'coolant', 'batt'],
  engine: ['load', 'tps', 'map', 'intake'],
  fuel:   ['stft', 'ltft', 'timing', 'fuel'],
};
const ALL_KEYS = [...GAUGE_GROUPS.main, ...GAUGE_GROUPS.engine, ...GAUGE_GROUPS.fuel];

const ALERTS = {
  coolant: v => v < 60 ? 'cold' : v <= 95 ? 'normal' : v <= 105 ? 'warn' : 'danger',
  batt: v => v < 11.8 ? 'danger' : v < 12.3 ? 'warn' : v <= 14.5 ? 'normal' : v <= 14.8 ? 'warn' : 'danger',
};

const DEFAULT_ITEMS = [
  { id: 'oil', category: 'Двигатель', name: 'Моторное масло', intervalKm: 15000, intervalMonths: 12 },
  { id: 'oilFilter', category: 'Двигатель', name: 'Масляный фильтр', intervalKm: 15000, intervalMonths: 12 },
  { id: 'airFilter', category: 'Двигатель', name: 'Воздушный фильтр', intervalKm: 30000, intervalMonths: 24 },
  { id: 'cabinFilter', category: 'Двигатель', name: 'Салонный фильтр', intervalKm: 15000, intervalMonths: 12 },
  { id: 'fuelFilter', category: 'Двигатель', name: 'Топливный фильтр', intervalKm: 120000, intervalMonths: null },
  { id: 'spark', category: 'Двигатель', name: 'Свечи зажигания', intervalKm: 30000, intervalMonths: 36 },
  { id: 'timingBelt', category: 'Двигатель', name: 'Ремень ГРМ + ролики', intervalKm: 60000, intervalMonths: 60 },
  { id: 'serpBelt', category: 'Двигатель', name: 'Ремень навесного', intervalKm: 60000, intervalMonths: 60 },
  { id: 'coolant', category: 'Охлаждение', name: 'Антифриз', intervalKm: 90000, intervalMonths: 60 },
  { id: 'waterPump', category: 'Охлаждение', name: 'Помпа', intervalKm: 90000, intervalMonths: 60 },
  { id: 'thermostat', category: 'Охлаждение', name: 'Термостат', intervalKm: 120000, intervalMonths: null },
  { id: 'brakeFluid', category: 'Тормоза', name: 'Тормозная жидкость', intervalKm: 60000, intervalMonths: 24 },
  { id: 'padsFront', category: 'Тормоза', name: 'Колодки передние', intervalKm: 35000, intervalMonths: null },
  { id: 'padsRear', category: 'Тормоза', name: 'Колодки задние', intervalKm: 80000, intervalMonths: null },
  { id: 'discsFront', category: 'Тормоза', name: 'Диски тормозные передние', intervalKm: 70000, intervalMonths: null },
  { id: 'shockFront', category: 'Подвеска', name: 'Амортизаторы передние', intervalKm: 70000, intervalMonths: null },
  { id: 'shockRear', category: 'Подвеска', name: 'Амортизаторы задние', intervalKm: 55000, intervalMonths: null },
  { id: 'ballJoint', category: 'Подвеска', name: 'Шаровые опоры', intervalKm: 70000, intervalMonths: null },
  { id: 'stabLink', category: 'Подвеска', name: 'Стойки стабилизатора', intervalKm: 40000, intervalMonths: null },
  { id: 'armBush', category: 'Подвеска', name: 'Сайлентблоки рычагов', intervalKm: 80000, intervalMonths: null },
  { id: 'wheelBearF', category: 'Подвеска', name: 'Ступичные подшипники перед', intervalKm: 100000, intervalMonths: null },
  { id: 'cvBoot', category: 'Подвеска', name: 'Пыльники ШРУСов', intervalKm: 60000, intervalMonths: null },
  { id: 'tieRodEnd', category: 'Рулевое', name: 'Наконечники рулевых тяг', intervalKm: 60000, intervalMonths: null },
  { id: 'tieRodBoot', category: 'Рулевое', name: 'Пыльники рулевых тяг', intervalKm: 80000, intervalMonths: null },
  { id: 'gearbox', category: 'Трансмиссия', name: 'Масло МКПП', intervalKm: 90000, intervalMonths: 60 },
  { id: 'clutch', category: 'Трансмиссия', name: 'Сцепление', intervalKm: 120000, intervalMonths: null },
  { id: 'battery', category: 'Электрика', name: 'Аккумулятор', intervalKm: null, intervalMonths: 48 },
  { id: 'wipers', category: 'Электрика', name: 'Щётки дворников', intervalKm: null, intervalMonths: 12 },
];

const ENGINE_OVERRIDES = {
  K7J: { oil: { km: 15000, m: 12 }, spark: { km: 30000, m: 36 }, timingBelt: { km: 60000, m: 60 }, waterPump: { km: 60000, m: 60 } },
  K7M: { oil: { km: 15000, m: 12 }, spark: { km: 30000, m: 36 }, timingBelt: { km: 60000, m: 60 }, waterPump: { km: 90000, m: 60 } },
  K4M: { oil: { km: 15000, m: 12 }, spark: { km: 60000, m: 60 }, timingBelt: { km: 90000, m: 60 }, waterPump: { km: 120000, m: null } },
  D4F: { oil: { km: 15000, m: 12 }, spark: { km: 60000, m: 60 }, timingBelt: { km: null, m: null } },
  K9K: { oil: { km: 10000, m: 12 }, fuelFilter: { km: 30000, m: 24 }, timingBelt: { km: 60000, m: 60 } },
};

const ENGINE_NAMES = {
  K7J: '1.4 8V (K7J) · 75 л.с.',
  K7M: '1.6 8V (K7M) · 87 л.с.',
  K4M: '1.6 16V (K4M) · 105 л.с.',
  D4F: '1.2 16V (D4F) · 75 л.с.',
  K9K: '1.5 dCi (K9K) · 84-90 л.с.',
};

/* ============ Утилиты ============ */
const $ = id => document.getElementById(id);
const byte = (h, i) => parseInt(h.substr(i * 2, 2), 16);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => Number(n).toLocaleString('ru-RU');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(STORAGE.SETTINGS) || '{}') || {}; }
  catch (e) { return {}; }
}
const settings = Object.assign(
  { sound: true, autosave: true, interval: 150, renaultProfile: 'auto' },
  loadSettings()
);
function saveSettings() {
  try { localStorage.setItem(STORAGE.SETTINGS, JSON.stringify(settings)); } catch (e) {}
}

/* ============ Storage ============ */
class Storage {
  static loadProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE.PROFILES);
      const d = raw ? JSON.parse(raw) : null;
      return d && d.profiles && typeof d.profiles === 'object' ? d : { activeId: null, profiles: {} };
    } catch (e) { return { activeId: null, profiles: {} }; }
  }
  static saveProfiles(data) {
    localStorage.setItem(STORAGE.PROFILES, JSON.stringify(data));
  }
  static active() {
    const d = this.loadProfiles();
    return d.activeId ? d.profiles[d.activeId] || null : null;
  }
  static all() {
    const d = this.loadProfiles();
    return Object.values(d.profiles).filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  static setActive(id) {
    const d = this.loadProfiles();
    if (!d.profiles[id]) return false;
    d.activeId = id;
    this.saveProfiles(d);
    return true;
  }
  static create({ name, vin, plate }) {
    const d = this.loadProfiles();
    const id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    d.profiles[id] = {
      id, name: name || 'Новый профиль',
      vin: vin ? vin.toUpperCase() : null,
      plate: plate ? plate.toUpperCase() : null,
      engine: null, createdAt: Date.now(),
      mileage: null, mileageSource: 'manual', mileageUpdated: null,
      items: JSON.parse(JSON.stringify(DEFAULT_ITEMS)),
      journal: [],
    };
    if (!d.activeId) d.activeId = id;
    this.saveProfiles(d);
    return d.profiles[id];
  }
  static update(id, patch) {
    const d = this.loadProfiles();
    if (!d.profiles[id]) return false;
    Object.assign(d.profiles[id], patch);
    this.saveProfiles(d);
    return true;
  }
  static remove(id) {
    const d = this.loadProfiles();
    delete d.profiles[id];
    if (d.activeId === id) d.activeId = Object.keys(d.profiles)[0] || null;
    this.saveProfiles(d);
  }
  static findByVin(vin) {
    if (!vin) return null;
    const n = vin.toUpperCase().trim();
    return Object.values(this.loadProfiles().profiles).find(p => p && p.vin === n) || null;
  }
  static label(p) {
    if (!p) return '-';
    return [p.name, p.plate ? '[' + p.plate + ']' : ''].filter(Boolean).join(' ');
  }
}

/* ============ Разбор ответов ELM327 ============ */

/* Ответ адаптера -> массив байтов (hex-строки).
   CAN (ATH1): "7E8 03 41 0C 1A" -> заголовок и PCI-байт отбрасываются.
   K-Line (ATH1): "48 6B 10 41 0C 1A F8 CS" -> оставляем как есть,
   поиск по ответу выполняется через indexOf. */
function frameBytes(resp) {
  const out = [];
  const lines = String(resp).split(/[\r\n]+/);
  for (let li = 0; li < lines.length; li++) {
    const t = lines[li].trim().split(/\s+/).filter(Boolean);
    if (!t.length) continue;
    let canFrame = false;
    if (t.length > 1 && /^[0-9A-F]{3}$/i.test(t[0])) { t.shift(); canFrame = true; }
    if (!t.every(x => /^[0-9A-F]{2}$/i.test(x))) continue;
    if (!canFrame) { out.push.apply(out, t); continue; }
    const pci = parseInt(t[0], 16);
    const kind = pci & 0xF0;
    if (kind === 0x00) out.push.apply(out, t.slice(1, 1 + (pci & 0x0F)));
    else if (kind === 0x10) out.push.apply(out, t.slice(2));
    else if (kind === 0x20) out.push.apply(out, t.slice(1));
  }
  return out;
}

const bytesHex = resp => frameBytes(resp).join('').toUpperCase();

/* Ищет ответ на запрос режима mode и PID: ответ начинается с (mode + 0x40) */
function parseResponse(resp, mode, pid) {
  const want = ((parseInt(mode, 16) + 0x40).toString(16) + pid).toUpperCase();
  const hex = bytesHex(resp);
  const i = hex.indexOf(want);
  if (i === -1 || i % 2 !== 0) return null;
  return hex.slice(i + want.length);
}

/* ============ Demo ELM ============ */
class DemoElm {
  constructor() {
    this.connected = false;
    this._startTime = Date.now();
    this.device = { name: 'DEMO ELM327', gatt: { connected: true } };
  }
  async requestDevice() { return this.device; }
  async connectTo() {
    await sleep(300);
    this.connected = true;
    this._startTime = Date.now();
  }
  async disconnect() { this.connected = false; }
  async send(cmd) {
    await sleep(30 + Math.random() * 40);
    const t = (Date.now() - this._startTime) / 1000;
    const warm = Math.min(1, t / 60);
    const rpm = 800 + Math.sin(t / 3) * 300 + (Math.random() * 100) * (t > 30 ? 1 : 0);
    const speed = Math.max(0, Math.min(120, Math.sin(t / 10) * 60 + 40));

    const c = cmd.toUpperCase().trim();
    if (c === 'ATZ') return 'ELM327 v1.5';
    if (c === 'ATRV') return (12.4 + warm * 1.8 + Math.random() * 0.1).toFixed(1) + 'V';
    if (c === 'ATDPN') return 'A6';
    if (c.indexOf('AT') === 0) return 'OK';

    const r = v => v.toString(16).toUpperCase().padStart(2, '0');
    if (c === '0100') return '41 00 BE 3E B8 13';
    if (c === '0120') return '41 20 80 02 00 01';
    if (c === '0140') return '41 40 40 00 00 00';
    if (c === '010C') return '41 0C ' + r(Math.floor(rpm * 4 / 256)) + ' ' + r(Math.floor(rpm * 4) % 256);
    if (c === '010D') return '41 0D ' + r(Math.floor(speed));
    if (c === '0105') return '41 05 ' + r(40 + Math.floor(20 + warm * 70));
    if (c === '010F') return '41 0F ' + r(40 + Math.floor(25 + warm * 15));
    if (c === '0104') return '41 04 ' + r(30 + Math.floor(Math.random() * 30));
    if (c === '0111') return '41 11 ' + r(15 + Math.floor(Math.random() * 10));
    if (c === '010B') return '41 0B ' + r(40 + Math.floor(Math.random() * 20));
    if (c === '0106') return '41 06 80';
    if (c === '0107') return '41 07 82';
    if (c === '010E') return '41 0E ' + r(128 + Math.floor(Math.random() * 10));
    if (c === '012F') return '41 2F ' + r(150 + Math.floor(Math.random() * 50));
    if (c === '0902') return '49 02 01 56 46 31 4C 53 52 41 42 43 44 45 46 30 30 30 30 30 30';
    if (c === '03') return '43 01 33 00 00 00';
    if (c === '07') return '47 00';
    if (c === '04') return '44';
    if (c === '22F187') return '62 F1 87 00 09 27 C0';
    return 'NO DATA';
  }
}

/* ============ ELM327 по BLE ============
   Одна команда за раз. При таймауте отправляется пробел (ELM прерывает
   операцию), затем ожидается приглашение '>' и только потом идёт следующая. */
class Elm {
  constructor() {
    this.device = null;
    this.tx = null;
    this.rx = null;
    this.buffer = '';
    this.queue = [];
    this.pumping = false;
    this.cur = null;
    this.drainResolve = null;
    this.connected = false;
    this._onNotify = this._onNotify.bind(this);
  }

  _onNotify(e) {
    this.buffer += new TextDecoder().decode(e.target.value);
    let idx;
    while ((idx = this.buffer.indexOf('>')) !== -1) {
      const resp = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (this.cur) {
        const req = this.cur;
        this.cur = null;
        req.resolve(resp);
      } else if (this.drainResolve) {
        const done = this.drainResolve;
        this.drainResolve = null;
        done();
      } else {
        console.warn('Лишний ответ адаптера проигнорирован:', resp);
      }
    }
  }

  async connectTo(device) {
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.connected = false;
      this.tx = null;
      this.rx = null;
    });
    const server = await device.gatt.connect();
    let found = false;
    for (const uuid of BLE_SERVICES) {
      try {
        const svc = await server.getPrimaryService(uuid);
        const chars = await svc.getCharacteristics();
        let tx = null, rx = null;
        for (const c of chars) {
          const p = c.properties;
          if (!tx && (p.write || p.writeWithoutResponse)) tx = c;
          if (!rx && (p.notify || p.indicate)) rx = c;
        }
        if (tx && rx) { this.tx = tx; this.rx = rx; found = true; break; }
      } catch (e) {}
    }
    if (!found) throw new Error('BLE-сервис ELM327 не найден. Адаптер не BLE?');
    await this.rx.startNotifications();
    this.rx.addEventListener('characteristicvaluechanged', this._onNotify);
    this.connected = true;
  }

  async requestDevice() {
    return navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES,
    });
  }

  async disconnect() {
    this.connected = false;
    const q = this.queue.splice(0);
    q.forEach(j => j.reject(new Error('Отключено')));
    try { if (this.rx) await this.rx.stopNotifications(); } catch (e) {}
    try { if (this.device && this.device.gatt && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) {}
    this.tx = null;
    this.rx = null;
  }

  send(cmd, timeout) {
    const to = timeout || 3000;
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, timeout: to, resolve, reject });
      this._pump();
    });
  }

  async _pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        try { job.resolve(await this._exec(job.cmd, job.timeout)); }
        catch (e) { job.reject(e); }
      }
    } finally {
      this.pumping = false;
    }
  }

  async _exec(cmd, timeout) {
    if (!this.tx) throw new Error('Нет соединения');
    this.buffer = '';
    let req = null;
    const reply = new Promise((resolve, reject) => { req = { cmd, resolve, reject }; });
    reply.catch(() => {});
    this.cur = req;

    const timer = setTimeout(async () => {
      if (this.cur !== req) return;
      this.cur = null;
      await this._abort();
      req.reject(new Error('Таймаут: ' + cmd));
    }, timeout);

    try {
      await this._write(cmd + '\r');
      return await reply;
    } finally {
      clearTimeout(timer);
      if (this.cur === req) this.cur = null;
    }
  }

  async _abort() {
    try { await this._write(' '); } catch (e) {}
    await new Promise(resolve => {
      this.drainResolve = resolve;
      setTimeout(resolve, 1200);
    });
    this.drainResolve = null;
    this.buffer = '';
  }

  async _write(text) {
    const tx = this.tx;
    if (!tx) throw new Error('Нет соединения');
    const bytes = new TextEncoder().encode(text);
    const noResp = !tx.properties.write && tx.properties.writeWithoutResponse;
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (noResp) await tx.writeValueWithoutResponse(chunk);
      else await tx.writeValue(chunk);
    }
  }
}

/* ============ Звук ============ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur, vol) {
  if (!settings.sound) return;
  ensureAudio();
  if (!audioCtx) return;
  const f = freq || 880, d = dur || 250, v = vol || 0.15;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = f;
  g.gain.setValueAtTime(v, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + d / 1000);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + d / 1000);
}
function alertBeep(type) {
  if (type === 'danger') {
    beep(880, 150);
    setTimeout(() => beep(660, 150), 180);
    setTimeout(() => beep(880, 150), 360);
  } else {
    beep(660, 200);
  }
}

/* ============ Состояние сессии ============ */
let elm = new Elm();
let isDemo = false;
let connecting = false;
let currentProfile = null;
let supportedPids = new Set();
const current = {};
const lastLevel = {};
let polling = false;
let sessionId = 0;
let state = null;
let exclusiveCount = 0;
let logRows = [], logStart = 0, sampleCount = 0;
let logActive = false;
const LOG_MAX_ROWS = 5000;

/* Эксклюзивный режим: пока он включён, опрос датчиков ждёт */
async function exclusiveRun(fn) {
  exclusiveCount++;
  try { return await fn(); }
  finally { exclusiveCount--; }
}

/* Chart.js: динамический импорт с запасным вариантом */
let Chart;
async function loadChartJs() {
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/auto/+esm');
    Chart = mod.default;
  } catch (e) {
    console.warn('Chart.js не загрузился, графики отключены', e);
    Chart = class {
      constructor(el, cfg) {
        this.el = el;
        this.data = (cfg && cfg.data) || { labels: [], datasets: [] };
      }
      update() {}
    };
  }
}

/* ============ Вкладки ============ */
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  function show(name) {
    tabs.forEach(t => t.classList.toggle('tab-active', t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  }
  function router() {
    const h = (location.hash || '#diag').slice(1);
    show(h === 'to' || h === 'settings' ? h : 'diag');
  }
  window.addEventListener('hashchange', router);
  router();
}

/* ============ Датчики ============ */
function renderGauges() {
  $('gauges').innerHTML = ALL_KEYS.map(key => {
    const d = PID_DEFS[key];
    return '<div class="card bg-slate-800 rounded-xl p-3 border-2 border-slate-700" data-key="' + key + '">' +
      '<div class="text-xs text-slate-500 uppercase truncate">' + d.name + '</div>' +
      '<div class="value text-3xl font-bold text-slate-100 mt-1 font-mono">' +
      '<span id="val-' + key + '">-</span>' +
      '<span class="text-xs text-slate-500 font-normal ml-1">' + d.unit + '</span>' +
      '</div></div>';
  }).join('');
}

function updateGauge(key, value) {
  const el = $('val-' + key);
  if (el) el.textContent = value == null ? '-' : value;
  const card = document.querySelector('.card[data-key="' + key + '"]');
  if (!card || !ALERTS[key] || value == null) return;
  const lvl = ALERTS[key](value);
  card.classList.remove('alert-cold', 'alert-normal', 'alert-warn', 'alert-danger');
  card.classList.add('alert-' + lvl);
  if (lvl === 'danger' && lastLevel[key] !== 'danger') alertBeep('danger');
  lastLevel[key] = lvl;
}

/* ============ Графики ============ */
const MAX_POINTS = 60;
const chartOpts = {
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { intersect: false, mode: 'index' },
  elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.25 } },
  plugins: { legend: { labels: { color: '#94a3b8', boxWidth: 10, font: { size: 10 } } } },
  scales: {
    x: { display: false },
    y: { position: 'left', ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#1e293b' } },
    y1: { position: 'right', ticks: { color: '#64748b', font: { size: 9 } }, grid: { drawOnChartArea: false } },
  },
};

let chart1, chart2;
function initCharts() {
  chart1 = new Chart($('chart1'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'RPM', data: [], borderColor: '#10b981', yAxisID: 'y' },
      { label: 'км/ч', data: [], borderColor: '#3b82f6', yAxisID: 'y1' },
    ] },
    options: chartOpts,
  });
  chart2 = new Chart($('chart2'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'ОЖ', data: [], borderColor: '#f59e0b', yAxisID: 'y' },
      { label: 'Впуск', data: [], borderColor: '#a78bfa', yAxisID: 'y' },
      { label: 'В', data: [], borderColor: '#10b981', yAxisID: 'y1' },
      { label: 'LTFT', data: [], borderColor: '#f43f5e', yAxisID: 'y1' },
    ] },
    options: chartOpts,
  });
}

function pushSample() {
  const label = new Date().toLocaleTimeString();
  const push = (chart, values) => {
    chart.data.labels.push(label);
    chart.data.datasets.forEach((ds, i) => ds.data.push(values[i] == null ? null : values[i]));
    if (chart.data.labels.length > MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none');
  };
  push(chart1, [current.rpm, current.speed]);
  push(chart2, [current.coolant, current.intake, current.batt, current.ltft]);
}

const PRESETS = {
  all:     { c1: [true, true], c2: [true, true, true, true] },
  warmup:  { c1: [false, false], c2: [true, true, false, false] },
  battery: { c1: [false, false], c2: [false, false, true, false] },
  accel:   { c1: [true, true], c2: [false, false, false, false] },
};
function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  chart1.data.datasets.forEach((d, i) => { d.hidden = !p.c1[i]; });
  chart2.data.datasets.forEach((d, i) => { d.hidden = !p.c2[i]; });
  chart1.update();
  chart2.update();
}

/* ============ Опрос ============ */
async function queryPid(key) {
  const d = PID_DEFS[key];
  try {
    const resp = await elm.send(d.pid, 3000);
    if (!resp || /NO ?DATA|STOPPED|ERROR|UNABLE/i.test(resp)) return null;
    if (d.at) {
      const v = d.dec(resp.replace(/[^0-9.]/g, ''));
      return Number.isFinite(v) ? v : null;
    }
    const data = parseResponse(resp, '01', d.pid.slice(2));
    if (!data || data.length < 2) return null;
    return Math.round(d.dec(data) * 10) / 10;
  } catch (e) {
    return null;
  }
}

async function pollLoop(id) {
  const alive = () => polling && id === sessionId;
  while (alive()) {
    const useAll = supportedPids.size === 0;
    for (const key of ALL_KEYS) {
      while (exclusiveCount > 0 && alive()) await sleep(50);
      if (!alive()) return;
      const d = PID_DEFS[key];
      if (!d.at && !useAll && !supportedPids.has(parseInt(d.pid.slice(2), 16))) continue;
      const v = await queryPid(key);
      if (v != null) {
        current[key] = v;
        updateGauge(key, v);
      }
    }
    if (!alive()) return;
    pushSample();
    if (logActive) logSample();
    await sleep(settings.interval);
  }
}

async function detectPids() {
  const supported = new Set();
  for (const base of [0x00, 0x20, 0x40]) {
    const pid = base.toString(16).toUpperCase().padStart(2, '0');
    let data = null;
    try {
      data = parseResponse(await elm.send('01' + pid, 3000), '01', pid);
    } catch (e) { break; }
    if (!data || data.length < 8) break;
    for (let k = 0; k < 32; k++) {
      if (byte(data, Math.floor(k / 8)) & (1 << (7 - (k % 8)))) supported.add(base + 1 + k);
    }
    if (!supported.has(base + 0x20)) break;
  }
  return supported;
}

/* ============ VIN, пробег, DTC ============ */
async function readVIN() {
  try {
    const hex = bytesHex(await elm.send('0902', 6000));
    const i = hex.indexOf('490201');
    if (i === -1 || i % 2 !== 0) return null;
    const body = hex.slice(i + 6);
    let vin = '';
    for (let k = 0; k < 17 && k * 2 + 2 <= body.length; k++) {
      const c = parseInt(body.substr(k * 2, 2), 16);
      if (c >= 0x21 && c < 0x7F) vin += String.fromCharCode(c);
    }
    return vin.length === 17 ? vin : null;
  } catch (e) {
    return null;
  }
}

/* Пробег: эвристика, DID F187 по стандарту не является одометром.
   Результат только показывается, пока MILEAGE_OBD_TRUSTED = false. */
function parseMileage(resp) {
  const hex = bytesHex(resp);
  const patterns = [/62F187([0-9A-F]{4,8})/, /6101([0-9A-F]{6,8})/, /6102([0-9A-F]{6,8})/];
  for (const p of patterns) {
    const m = hex.match(p);
    if (m) {
      const v = parseInt(m[1].slice(0, 8), 16);
      if (v > 500 && v < 2000000) return v;
    }
  }
  return null;
}

async function readMileage() {
  if (!currentProfile) return null;
  const reset = currentProfile.resetHdr || '7DF';
  for (const a of currentProfile.mileage) {
    try {
      await elm.send('ATSH ' + a.hdr, 1500);
      const resp = await elm.send(a.cmd, 2500);
      console.log('Пробег: ответ', a.hdr, a.cmd, JSON.stringify(resp));
      const km = parseMileage(resp);
      if (km) return km;
    } catch (e) {
      console.warn('Пробег: попытка не удалась, заголовок', a.hdr, e && e.message);
    } finally {
      await elm.send('ATSH ' + reset, 800).catch(() => {});
    }
  }
  return null;
}

function decodeDTC(hi, lo) {
  const n = parseInt(hi + lo, 16);
  if (!n) return null;
  return 'PCBU'[(n >> 14) & 3] + (n & 0x3FFF).toString(16).toUpperCase().padStart(4, '0');
}

async function readDTCs() {
  const codes = [];
  const modes = [['03', ''], ['07', ' (ожидающие)']];
  for (const pair of modes) {
    const mode = pair[0], tag = pair[1];
    try {
      const hex = bytesHex(await elm.send(mode, 5000));
      const head = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();
      const idx = hex.indexOf(head);
      if (idx === -1 || idx % 2 !== 0) continue;
      const data = hex.slice(idx + head.length);
      for (let k = 0; k + 4 <= data.length; k += 4) {
        const dtc = decodeDTC(data.substr(k, 2), data.substr(k + 2, 2));
        if (dtc) codes.push(dtc + tag);
      }
    } catch (e) {
      console.warn('DTC: ошибка режима', mode, e && e.message);
    }
  }
  return codes;
}

/* ============ Лог ============ */
function startLog() {
  logActive = true;
  logStart = Date.now();
  sampleCount = 0;
  logRows = [['time_ms', 'iso'].concat(ALL_KEYS)];
  $('btnStartLog').disabled = true;
  $('btnStopLog').disabled = false;
  $('btnDownloadLog').disabled = true;
  $('logStatus').textContent = '● пишем…';
  $('logStatus').className = 'text-xs text-red-400';
}

function stopLog() {
  logActive = false;
  $('btnStartLog').disabled = false;
  $('btnStopLog').disabled = true;
  $('btnDownloadLog').disabled = logRows.length < 2;
  $('logStatus').textContent = '■ ' + (logRows.length - 1) + ' строк';
  $('logStatus').className = 'text-xs text-emerald-400';
}

function logSample() {
  const row = [Date.now() - logStart, new Date().toISOString()];
  ALL_KEYS.forEach(k => row.push(current[k] == null ? '' : current[k]));
  logRows.push(row);
  sampleCount++;
  if (logRows.length > LOG_MAX_ROWS) logRows.splice(1, Math.floor(LOG_MAX_ROWS / 10));
  if (settings.autosave && sampleCount % 10 === 0) {
    try {
      localStorage.setItem(STORAGE.LOG, JSON.stringify({ rows: logRows, savedAt: Date.now() }));
    } catch (e) {
      console.warn('Не удалось сохранить лог:', e && e.message);
      settings.autosave = false;
      saveSettings();
    }
  }
}

function downloadCsv(rows, name) {
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

function downloadLog() {
  downloadCsv(logRows, 'obd-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv');
  try { localStorage.removeItem(STORAGE.LOG); } catch (e) {}
}

function recoverLog() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE.LOG) || 'null'); } catch (e) {}
  if (!saved || !saved.rows || saved.rows.length <= 2) {
    try { localStorage.removeItem(STORAGE.LOG); } catch (e) {}
    return;
  }
  const msg = 'Найден несохранённый лог от ' + new Date(saved.savedAt).toLocaleString() +
    '\n(' + (saved.rows.length - 1) + ' строк).\n\nСкачать CSV?';
  if (confirm(msg)) downloadCsv(saved.rows, 'obd-log-recovered-' + Date.now() + '.csv');
  try { localStorage.removeItem(STORAGE.LOG); } catch (e) {}
}

/* ============ Статус и сессии ============ */
function setStatus(text, cls) {
  const el = $('connStatus');
  el.textContent = text;
  el.className = 'text-sm ' + (cls === 'ok' ? 'text-emerald-400' : cls === 'err' ? 'text-red-400' : 'text-slate-400');
}

function cleanupOldSession() {
  polling = false;
  sessionId++;
  if (logActive) stopLog();
  try { elm.disconnect(); } catch (e) {}
  Object.keys(current).forEach(k => { delete current[k]; });
  Object.keys(lastLevel).forEach(k => { delete lastLevel[k]; });
}

function onDeviceDisconnected(owner) {
  if (owner !== elm) return;
  polling = false;
  sessionId++;
  if (logActive) stopLog();
  setStatus('Соединение потеряно', 'err');
  $('btnConnect').disabled = false;
  $('btnDemo').disabled = false;
}

async function connect() {
  if (connecting) return;
  connecting = true;
  $('btnConnect').disabled = true;
  try {
    cleanupOldSession();
    isDemo = false;
    const session = new Elm();
    elm = session;
    setStatus('Запрос устройства…');
    const device = await session.requestDevice();
    $('connDevice').textContent = device.name || '';
    device.addEventListener('gattserverdisconnected', () => onDeviceDisconnected(session));
    setStatus('Подключение…');
    await session.connectTo(device);
    await initSession();
  } catch (e) {
    console.error(e);
    setStatus('Ошибка: ' + e.message, 'err');
    $('btnConnect').disabled = false;
  } finally {
    connecting = false;
  }
}

async function connectDemo() {
  if (connecting) return;
  connecting = true;
  $('btnConnect').disabled = true;
  try {
    cleanupOldSession();
    isDemo = true;
    const session = new DemoElm();
    elm = session;
    await session.connectTo();
    $('connDevice').textContent = '(демо)';
    await initSession();
  } catch (e) {
    console.error(e);
    setStatus('Ошибка демо: ' + e.message, 'err');
    $('btnConnect').disabled = false;
  } finally {
    connecting = false;
  }
}

function saveObdMileage(km) {
  $('mileageValue').textContent = fmt(km) + (MILEAGE_OBD_TRUSTED ? '' : ' (не проверен)');
  if (!MILEAGE_OBD_TRUSTED) return;
  const p = Storage.active();
  if (p) Storage.update(p.id, { mileage: km, mileageSource: 'obd', mileageUpdated: Date.now() });
  loadActiveToState();
}

async function initSession() {
  currentProfile = RENAULT_PROFILES[settings.renaultProfile] || RENAULT_PROFILES.auto;

  setStatus('Инициализация ELM327…');
  for (const cmd of currentProfile.init) {
    try { await elm.send(cmd, 3500); }
    catch (e) { console.warn('Init:', cmd, e.message); }
  }

  try {
    const proto = await elm.send('ATDPN', 2000);
    $('connProtocol').textContent = proto.replace(/[^0-9A-Z]/g, '').slice(0, 6) || 'auto';
  } catch (e) {}

  const vin = await readVIN();
  $('vinValue').textContent = vin || '-';

  const profile = await ensureProfile(vin);
  if (!profile) {
    setStatus('Профиль не выбран', 'err');
    $('btnConnect').disabled = false;
    try { await elm.disconnect(); } catch (e) {}
    return;
  }
  loadActiveToState();

  supportedPids = await detectPids();
  $('pidCount').textContent = supportedPids.size + ' шт.';

  const km = await readMileage();
  if (km) saveObdMileage(km);
  else $('mileageValue').textContent = '-';

  ['btnReadDtc', 'btnClearDtc', 'btnStartLog', 'btnReadMileage'].forEach(id => { $(id).disabled = false; });
  setStatus('Готово · ' + (isDemo ? 'демо' : 'подключено'), 'ok');
  $('btnConnect').disabled = false;

  polling = true;
  sessionId++;
  pollLoop(sessionId);
  renderAll();
}

/* ============ Профили ============ */
async function ensureProfile(vin) {
  if (vin) {
    const ex = Storage.findByVin(vin);
    if (ex) { Storage.setActive(ex.id); renderProfile(); return ex; }
    const name = prompt('Обнаружен новый VIN: ' + vin + '\n\nНазвание профиля:', 'Logan ' + vin.slice(-4));
    if (!name) return null;
    const plate = prompt('Госномер (опционально):', '') || null;
    const p = Storage.create({ name: name.trim(), vin: vin, plate: plate ? plate.trim() : null });
    Storage.setActive(p.id);
    renderProfile();
    return p;
  }
  const active = Storage.active();
  if (active) return active;
  const name = prompt('VIN не определился.\n\nСоздайте профиль вручную:', 'Мой Logan');
  if (!name) return null;
  const p = Storage.create({ name: name.trim() });
  Storage.setActive(p.id);
  renderProfile();
  return p;
}

function renderProfile() {
  const active = Storage.active();
  $('profileBadge').classList.toggle('hidden', !active);
  if (active) $('profileName').textContent = Storage.label(active);
  renderProfileBar();
}

function on(id, event, fn) {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
}

function renderProfileBar() {
  const active = Storage.active();
  const all = Storage.all();
  if (!active) {
    $('profileBar').innerHTML = '';
    $('noProfile').classList.remove('hidden');
    $('profileContent').classList.add('hidden');
    return;
  }
  $('noProfile').classList.add('hidden');
  $('profileContent').classList.remove('hidden');

  $('profileBar').innerHTML =
    '<div class="flex items-center gap-3 flex-wrap">' +
    '<span class="text-2xl">🚗</span>' +
    '<div class="flex-1 min-w-[200px]">' +
    '<div class="font-bold">' + esc(active.name) + '</div>' +
    (active.vin ? '<div class="text-xs text-slate-500 font-mono">VIN ' + esc(active.vin) + '</div>' : '') +
    (active.plate ? '<div class="text-xs text-slate-400">' + esc(active.plate) + '</div>' : '') +
    '</div>' +
    '<select id="profileSwitcher" class="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm">' +
    all.map(p => '<option value="' + esc(p.id) + '"' + (p.id === active.id ? ' selected' : '') + '>' + esc(Storage.label(p)) + '</option>').join('') +
    '</select>' +
    '<button id="btnEditProfile" class="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">✎</button>' +
    '<button id="btnDelProfile" class="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 border border-red-500/40">✕</button>' +
    '</div>';

  on('profileSwitcher', 'change', e => {
    Storage.setActive(e.target.value);
    loadActiveToState();
    renderAll();
  });
  on('btnEditProfile', 'click', editActiveProfile);
  on('btnDelProfile', 'click', deleteActiveProfile);
}

function editActiveProfile() {
  const p = Storage.active();
  if (!p) return;
  const name = prompt('Название:', p.name); if (name === null) return;
  const vin = prompt('VIN:', p.vin || ''); if (vin === null) return;
  const plate = prompt('Госномер:', p.plate || ''); if (plate === null) return;
  Storage.update(p.id, {
    name: name.trim() || p.name,
    vin: vin.trim().toUpperCase() || null,
    plate: plate.trim().toUpperCase() || null,
  });
  loadActiveToState();
  renderAll();
}

function deleteActiveProfile() {
  const p = Storage.active();
  if (!p) return;
  if (!confirm('Удалить профиль «' + Storage.label(p) + '» со всеми данными?')) return;
  if (!confirm('Точно? Сначала сделайте экспорт.')) return;
  Storage.remove(p.id);
  loadActiveToState();
  renderAll();
}

function renderProfilesList() {
  const all = Storage.all();
  const active = Storage.active();
  $('profilesList').innerHTML = all.map(p =>
    '<div class="flex items-center gap-2 bg-slate-900 rounded p-2 text-sm' +
    (active && p.id === active.id ? ' border border-emerald-500/40' : '') + '">' +
    '<span class="flex-1">' + esc(Storage.label(p)) +
    (p.vin ? '<div class="text-xs text-slate-500 font-mono">' + esc(p.vin) + '</div>' : '') + '</span>' +
    (active && p.id === active.id
      ? '<span class="text-xs text-emerald-400">✓ активен</span>'
      : '<button data-action="setActiveProfile" data-id="' + esc(p.id) + '" class="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">Активировать</button>') +
    '</div>'
  ).join('') || '<div class="text-slate-600 text-sm">Нет профилей</div>';
}

/* ============ Состояние ТО ============ */
function loadActiveToState() {
  const p = Storage.active();
  if (!p) { state = null; return; }
  p.items = p.items || [];
  const existing = new Set(p.items.map(i => i.id));
  DEFAULT_ITEMS.forEach(def => {
    if (!existing.has(def.id)) p.items.push(JSON.parse(JSON.stringify(def)));
  });
  p.journal = p.journal || [];
  state = p;
  Storage.update(p.id, { items: p.items, journal: p.journal });
}

function saveState() {
  if (!state) return;
  Storage.update(state.id, {
    mileage: state.mileage, mileageSource: state.mileageSource,
    mileageUpdated: state.mileageUpdated, engine: state.engine,
    items: state.items, journal: state.journal,
  });
}

function needState() {
  if (state) return true;
  alert('Сначала выберите или создайте профиль');
  return false;
}

function itemStatus(item) {
  if (!state) return { state: 'unknown', percent: 0 };
  if (item.lastKm == null && !item.lastDate) return { state: 'unknown', percent: 0 };

  let remKm = null, remDays = null;
  if (item.intervalKm && item.lastKm != null && state.mileage != null) {
    remKm = item.lastKm + item.intervalKm - state.mileage;
  }
  if (item.intervalMonths && item.lastDate) {
    const due = new Date(item.lastDate);
    due.setMonth(due.getMonth() + item.intervalMonths);
    remDays = Math.round((due - Date.now()) / 86400000);
  }

  let lvl = 'ok';
  if ((remKm != null && remKm < 0) || (remDays != null && remDays < 0)) lvl = 'danger';
  else if ((remKm != null && remKm < 1000) || (remDays != null && remDays < 30)) lvl = 'warn';

  let pct = 0;
  if (item.intervalKm && item.lastKm != null && state.mileage > item.lastKm) {
    pct = Math.max(pct, Math.min(100, ((state.mileage - item.lastKm) / item.intervalKm) * 100));
  }
  if (item.intervalMonths && item.lastDate) {
    const monthsPassed = (Date.now() - new Date(item.lastDate).getTime()) / (30 * 86400000);
    pct = Math.max(pct, Math.min(100, (monthsPassed / item.intervalMonths) * 100));
  }
  return { state: lvl, remKm: remKm, remDays: remDays, percent: pct };
}

function renderTO() {
  if (!state) { renderProfileBar(); return; }
  $('toMileage').textContent = state.mileage ? fmt(state.mileage) : '-';
  $('toMileageSource').textContent = state.mileageSource === 'obd' ? 'Источник: OBD-II' : 'Источник: ручной ввод';
  $('toMileageUpdated').textContent = state.mileageUpdated
    ? 'Обновлён: ' + new Date(state.mileageUpdated).toLocaleString('ru-RU') : '';
  $('engineSelect').value = state.engine || '';
  renderEngineMeta();
  renderAlerts();
  renderItems();
  renderItemSelect();
  renderJournal();
}

function renderEngineMeta() {
  const meta = $('engineMeta');
  if (state.engine) {
    meta.textContent = ENGINE_NAMES[state.engine] || state.engine;
    meta.className = 'flex-1 min-w-[180px] text-sm text-emerald-400 font-semibold';
  } else {
    meta.textContent = 'Двигатель не выбран';
    meta.className = 'flex-1 min-w-[180px] text-sm text-slate-400';
  }
  $('btnResetIntervals').disabled = !state.engine;
}

function renderAlerts() {
  const warn = [], danger = [];
  state.items.forEach(it => {
    const s = itemStatus(it);
    if (s.state === 'danger') danger.push(it.name);
    else if (s.state === 'warn') warn.push(it.name);
  });
  let html = '';
  if (danger.length) {
    html += '<div class="bg-red-500/15 border border-red-500/40 text-red-200 rounded-lg p-3 mb-2 text-sm">' +
      '<strong>🔴 Просрочено (' + danger.length + '):</strong> ' + danger.map(esc).join(', ') + '</div>';
  }
  if (warn.length) {
    html += '<div class="bg-amber-500/15 border border-amber-500/40 text-amber-200 rounded-lg p-3 mb-2 text-sm">' +
      '<strong>🟡 Скоро ТО (' + warn.length + '):</strong> ' + warn.map(esc).join(', ') + '</div>';
  }
  $('toAlerts').innerHTML = html;
}

const CATEGORY_ORDER = ['Двигатель', 'Охлаждение', 'Тормоза', 'Подвеска', 'Рулевое', 'Трансмиссия', 'Электрика', 'Прочее'];

function renderItems() {
  const groups = {};
  state.items.forEach(it => {
    const c = it.category || 'Прочее';
    (groups[c] = groups[c] || []).push(it);
  });
  const cats = Object.keys(groups).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  $('itemsList').innerHTML = cats.map(cat => {
    const items = groups[cat];
    let w = 0, d = 0;
    items.forEach(it => {
      const s = itemStatus(it);
      if (s.state === 'warn') w++;
      if (s.state === 'danger') d++;
    });
    const badges = (d ? '<span class="text-red-400">🔴 ' + d + '</span> ' : '') +
                   (w ? '<span class="text-amber-400">🟡 ' + w + '</span>' : '');
    return '<div class="flex items-center gap-2 mt-4 mb-2 px-1 border-b border-slate-800 pb-1">' +
      '<span class="text-xs font-bold text-slate-400 uppercase">' + esc(cat) + '</span>' +
      badges +
      '<span class="ml-auto text-xs text-slate-600">' + items.length + '</span></div>' +
      items.map(renderItemRow).join('');
  }).join('');
}

function renderItemRow(item) {
  const s = itemStatus(item);
  const lvlCls = s.state === 'danger' ? 'border-red-500/60 bg-red-500/5'
               : s.state === 'warn' ? 'border-amber-500/60 bg-amber-500/5'
               : 'border-slate-700';
  const txtCls = s.state === 'danger' ? 'text-red-400' : s.state === 'warn' ? 'text-amber-400' : 'text-emerald-400';
  const barCls = s.state === 'danger' ? 'bg-red-500' : s.state === 'warn' ? 'bg-amber-500' : 'bg-emerald-500';

  const rem = [];
  if (s.remKm != null) rem.push(s.remKm < 0 ? 'просрочено ' + fmt(Math.abs(s.remKm)) + ' км' : fmt(s.remKm) + ' км');
  if (s.remDays != null) rem.push(s.remDays < 0 ? 'просрочено ' + Math.abs(s.remDays) + ' дн.' : s.remDays + ' дн.');
  const remTxt = rem.length ? rem.join(' · ') : 'нажмите ✓ чтобы начать';

  const info = [];
  if (item.intervalKm) info.push(fmt(item.intervalKm) + ' км');
  if (item.intervalMonths) info.push(item.intervalMonths + ' мес');
  if (item.lastKm != null) info.push('послед. ' + fmt(item.lastKm) + ' км');

  return '<div class="bg-slate-800 rounded-lg p-3 mb-1 border ' + lvlCls + ' flex flex-wrap items-center gap-2">' +
    '<div class="flex-1 min-w-[180px]">' +
    '<div class="font-semibold text-sm">' + esc(item.name) + '</div>' +
    '<div class="text-xs text-slate-500">' + info.join(' · ') + '</div>' +
    '<div class="text-xs ' + txtCls + ' font-semibold mt-0.5">' + remTxt + '</div>' +
    '<div class="h-1 bg-slate-700 rounded mt-1.5 overflow-hidden">' +
    '<div class="h-full ' + barCls + '" style="width:' + s.percent + '%"></div></div></div>' +
    '<div class="flex flex-col gap-1">' +
    '<button data-action="markDone" data-id="' + esc(item.id) + '" class="text-xs px-2 py-1 rounded bg-emerald-500 text-slate-900 font-semibold">✓</button>' +
    '<button data-action="editItem" data-id="' + esc(item.id) + '" class="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300">✎</button>' +
    '</div></div>';
}

function renderItemSelect() {
  const groups = {};
  state.items.forEach(i => {
    const c = i.category || 'Прочее';
    (groups[c] = groups[c] || []).push(i);
  });
  $('recItem').innerHTML = Object.keys(groups).sort().map(cat =>
    '<optgroup label="' + esc(cat) + '">' + groups[cat].map(i =>
      '<option value="' + esc(i.id) + '">' + esc(i.name) + '</option>').join('') + '</optgroup>'
  ).join('');
}

function renderJournal() {
  const sorted = state.journal.slice().sort((a, b) => (b.km || 0) - (a.km || 0));
  $('journalBody').innerHTML = sorted.length ? sorted.map(r =>
    '<tr class="border-t border-slate-800">' +
    '<td class="px-3 py-2 text-slate-300">' + esc(r.date || '') + '</td>' +
    '<td class="px-3 py-2 font-mono text-slate-300">' + (r.km ? fmt(r.km) : '-') + '</td>' +
    '<td class="px-3 py-2 text-slate-200">' + esc(r.itemName) + '</td>' +
    '<td class="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">' + esc(r.note || '') + '</td>' +
    '<td class="px-3 py-2 text-right text-slate-300">' + (r.cost ? fmt(r.cost) : '') + '</td>' +
    '<td class="px-3 py-2"><button data-action="delRecord" data-id="' + esc(r.id) + '" class="text-slate-500 hover:text-red-400">✕</button></td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="6" class="text-center text-slate-600 py-4 text-sm">Журнал пуст</td></tr>';
  const total = state.journal.reduce((s, r) => s + (r.cost || 0), 0);
  $('journalSummary').textContent = state.journal.length + ' записей · ' + fmt(total) + ' ₽';
}

function renderAll() {
  renderProfile();
  renderProfilesList();
  renderTO();
}

/* ============ Действия (делегирование кликов) ============ */
const actions = {
  markDone(id) {
    if (!needState()) return;
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    $('recItem').value = id;
    $('recDate').value = new Date().toISOString().slice(0, 10);
    $('recKm').value = state.mileage || '';
    $('recDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('recDate').focus();
  },
  editItem(id) {
    if (!needState()) return;
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    const km = prompt('Интервал по км (0 = не учитывать):', item.intervalKm || 0);
    if (km === null) return;
    const m = prompt('Интервал по мес (0 = не учитывать):', item.intervalMonths || 0);
    if (m === null) return;
    item.intervalKm = parseFloat(km) || null;
    item.intervalMonths = parseFloat(m) || null;
    saveState();
    renderTO();
  },
  delRecord(id) {
    if (!needState()) return;
    if (!confirm('Удалить запись?')) return;
    state.journal = state.journal.filter(r => r.id !== id);
    state.items.forEach(item => {
      const last = state.journal
        .filter(r => r.itemId === item.id)
        .sort((a, b) => (b.km || 0) - (a.km || 0))[0];
      item.lastKm = last ? last.km : null;
      item.lastDate = last ? last.date : null;
    });
    saveState();
    renderTO();
  },
  setActiveProfile(id) {
    Storage.setActive(id);
    loadActiveToState();
    renderAll();
  },
};

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !actions[btn.dataset.action]) return;
  actions[btn.dataset.action](btn.dataset.id);
});

window.App = actions;

/* ============ Экспорт и импорт ============ */
function exportAll() {
  const data = {
    _meta: { exportedAt: new Date().toISOString(), version: APP_VERSION },
    data: Storage.loadProfiles(),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'logan-profiles-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  try { localStorage.setItem(STORAGE.LAST_EXPORT, Date.now().toString()); } catch (e) {}
}

function importFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const payload = data && data.data ? data.data : data;
      if (!payload || !payload.profiles || typeof payload.profiles !== 'object') {
        throw new Error('Неверный формат файла');
      }
      const clean = {};
      Object.keys(payload.profiles).forEach(id => {
        const p = payload.profiles[id];
        if (p && typeof p === 'object') {
          clean[id] = Object.assign({}, p, {
            id: id,
            items: Array.isArray(p.items) ? p.items : [],
            journal: Array.isArray(p.journal) ? p.journal : [],
          });
        }
      });
      const count = Object.keys(clean).length;
      if (!count) throw new Error('В файле нет профилей');
      if (!confirm('Импортировать ' + count + ' профилей? Текущие будут заменены.')) return;
      const activeId = clean[payload.activeId] ? payload.activeId : Object.keys(clean)[0];
      Storage.saveProfiles({ activeId: activeId, profiles: clean });
      loadActiveToState();
      renderAll();
      alert('Импорт успешен');
    } catch (err) {
      alert('Ошибка импорта: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ============ Обработчики интерфейса ============ */
function initUI() {
  initTabs();

  on('btnConnect', 'click', connect);
  on('btnDemo', 'click', connectDemo);

  document.querySelectorAll('.preset').forEach(b => {
    b.addEventListener('click', () => applyPreset(b.dataset.preset));
  });

  on('btnStartLog', 'click', startLog);
  on('btnStopLog', 'click', stopLog);
  on('btnDownloadLog', 'click', downloadLog);

  on('btnReadDtc', 'click', async () => {
    $('btnReadDtc').disabled = true;
    $('dtcList').innerHTML = '<span class="text-slate-500">Чтение…</span>';
    try {
      const codes = await exclusiveRun(readDTCs);
      $('dtcList').innerHTML = codes.length
        ? codes.map(c => '<div class="text-red-400">' + esc(c) + '</div>').join('')
        : '<span class="text-emerald-400">Ошибок нет</span>';
    } catch (e) {
      $('dtcList').innerHTML = '<span class="text-red-400">Ошибка: ' + esc(e.message) + '</span>';
    }
    $('btnReadDtc').disabled = false;
  });

  on('btnClearDtc', 'click', async () => {
    if (!confirm('Стереть коды ошибок?')) return;
    try {
      await exclusiveRun(() => elm.send('04', 4000));
      $('dtcList').innerHTML = '<span class="text-emerald-400">Стёрто</span>';
    } catch (e) {
      $('dtcList').innerHTML = '<span class="text-red-400">Ошибка: ' + esc(e.message) + '</span>';
    }
  });

  on('btnReadMileage', 'click', async () => {
    $('btnReadMileage').disabled = true;
    const km = await exclusiveRun(readMileage);
    $('btnReadMileage').disabled = false;
    if (km) {
      saveObdMileage(km);
      renderAll();
      if (!MILEAGE_OBD_TRUSTED) alert('Из ЭБУ получено ' + fmt(km) + ' км. Значение не проверено, в профиль не записано. Сверьте со спидометром.');
    } else {
      alert('Пробег недоступен для этого ЭБУ');
    }
  });

  on('btnCreateProfile', 'click', () => {
    const name = $('newProfileName').value.trim();
    if (!name) { alert('Введите название'); return; }
    const p = Storage.create({
      name: name,
      vin: $('newProfileVin').value.trim() || null,
      plate: $('newProfilePlate').value.trim() || null,
    });
    Storage.setActive(p.id);
    $('newProfileName').value = '';
    $('newProfileVin').value = '';
    $('newProfilePlate').value = '';
    loadActiveToState();
    renderAll();
  });

  on('btnNewProfile', 'click', () => {
    const name = prompt('Название профиля:');
    if (!name) return;
    const p = Storage.create({ name: name.trim() });
    Storage.setActive(p.id);
    loadActiveToState();
    renderAll();
  });

  on('btnEditMileage', 'click', () => {
    if (!needState()) return;
    const v = prompt('Текущий пробег (км):', state.mileage || '');
    if (v === null) return;
    const n = parseFloat(v);
    if (isNaN(n) || n < 0) { alert('Неверное значение'); return; }
    state.mileage = n;
    state.mileageSource = 'manual';
    state.mileageUpdated = Date.now();
    saveState();
    renderTO();
  });

  on('btnSyncMileage', 'click', () => {
    const p = Storage.active();
    if (p && p.mileageSource === 'obd' && p.mileage) {
      loadActiveToState();
      renderTO();
      alert('Пробег обновлён из OBD: ' + fmt(p.mileage) + ' км');
    } else {
      alert('Нет проверенных данных OBD. Введите пробег вручную.');
    }
  });

  on('engineSelect', 'change', e => {
    if (!needState()) return;
    const code = e.target.value;
    state.engine = code || null;
    const ov = code ? ENGINE_OVERRIDES[code] : null;
    if (ov) {
      state.items.forEach(it => {
        if (ov[it.id]) {
          it.intervalKm = ov[it.id].km;
          it.intervalMonths = ov[it.id].m;
        }
      });
    }
    saveState();
    renderTO();
  });

  on('btnResetIntervals', 'click', () => {
    if (!needState() || !state.engine) return;
    const ov = ENGINE_OVERRIDES[state.engine];
    if (!ov) return;
    state.items.forEach(it => {
      if (ov[it.id]) { it.intervalKm = ov[it.id].km; it.intervalMonths = ov[it.id].m; }
    });
    saveState();
    renderTO();
  });

  on('btnAddItem', 'click', () => {
    if (!needState()) return;
    const name = prompt('Название позиции:');
    if (!name) return;
    const km = prompt('Интервал по км (0 = не учитывать):', '10000');
    const m = prompt('Интервал по мес (0 = не учитывать):', '12');
    state.items.push({
      id: 'custom_' + Date.now(),
      name: name.trim(), category: 'Прочее',
      intervalKm: parseFloat(km) || null,
      intervalMonths: parseFloat(m) || null,
      lastKm: null, lastDate: null,
    });
    saveState();
    renderTO();
  });

  on('btnAddRecord', 'click', () => {
    if (!needState()) return;
    const date = $('recDate').value;
    const km = parseFloat($('recKm').value);
    const itemId = $('recItem').value;
    const cost = parseFloat($('recCost').value) || 0;
    const note = $('recNote').value.trim();
    if (!date || !itemId || isNaN(km)) { alert('Заполните дату, пробег, позицию'); return; }
    const item = state.items.find(i => i.id === itemId);
    if (!item) return;
    state.journal.push({
      id: 'r_' + Date.now(),
      date: date, km: km, itemId: itemId, itemName: item.name, cost: cost, note: note,
    });
    if (item.lastKm == null || km >= item.lastKm) {
      item.lastKm = km;
      item.lastDate = date;
    }
    if (!state.mileage || km > state.mileage) {
      state.mileage = km;
      state.mileageSource = 'manual';
      state.mileageUpdated = Date.now();
    }
    saveState();
    $('recCost').value = '';
    $('recNote').value = '';
    renderTO();
  });

  on('btnExport', 'click', exportAll);
  on('btnBackupAll', 'click', exportAll);
  on('btnImport', 'click', () => $('fileInput').click());
  on('fileInput', 'change', importFile);
  on('btnPrint', 'click', () => window.print());

  $('cfgSound').checked = settings.sound;
  $('cfgAutosave').checked = settings.autosave;
  $('cfgInterval').value = settings.interval;
  $('cfgIntervalVal').textContent = settings.interval;
  $('cfgRenaultProfile').value = settings.renaultProfile;

  on('cfgSound', 'change', e => { settings.sound = e.target.checked; saveSettings(); });
  on('cfgAutosave', 'change', e => { settings.autosave = e.target.checked; saveSettings(); });
  on('cfgInterval', 'input', e => {
    settings.interval = Math.max(50, +e.target.value || 150);
    $('cfgIntervalVal').textContent = settings.interval;
    saveSettings();
  });
  on('cfgRenaultProfile', 'change', e => {
    settings.renaultProfile = e.target.value;
    saveSettings();
  });

  on('btnClearAll', 'click', () => {
    if (!confirm('Удалить ВСЕ данные (все профили, настройки, логи)?')) return;
    if (!confirm('Точно? Сначала сделайте экспорт.')) return;
    localStorage.clear();
    location.reload();
  });

  $('appVersion').textContent = 'v' + APP_VERSION;

  window.addEventListener('beforeunload', () => {
    if (logActive && settings.autosave) {
      try { localStorage.setItem(STORAGE.LOG, JSON.stringify({ rows: logRows, savedAt: Date.now() })); } catch (e) {}
    }
    saveState();
  });
}

/* ============ Старт ============ */
(async function init() {
  const loader = $('loader');
  try {
    const missing = REQUIRED_IDS.filter(id => !$(id));
    if (missing.length) throw new Error('В HTML нет элементов: ' + missing.join(', '));

    await loadChartJs();
    recoverLog();
    renderGauges();
    initCharts();
    initUI();
    loadActiveToState();
    renderAll();
    setStatus('Не подключено');

    if (loader) loader.style.display = 'none';

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  } catch (e) {
    console.error(e);
    if (loader) loader.textContent = 'Ошибка: ' + e.message;
  }
})();
