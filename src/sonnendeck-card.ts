/**
 * Sonnendeck
 * ----------
 * A Home Assistant Lovelace card that shows a household's energy flow as
 * one picture: an isometric house with PV on the roof, storage in the
 * basement, a meter box, a mast, a parking bay — and animated flow lines
 * between them.
 *
 * Point it at an anker_solix system (or solarbank) device and it works
 * out the sensors on its own — including devices that join later, such
 * as a Power Dock combining several solarbanks. Every role can still be
 * overridden by hand, so the card also works with Shelly, MQTT or
 * template sensors, on any hardware.
 *
 * Independent project, not affiliated with Anker Innovations.
 *
 * Dependency free on purpose — no Lit, no bundler, no build tooling
 * beyond `tsc`. That keeps the shipped file small and avoids pulling a
 * second copy of Lit into the Home Assistant frontend.
 */

const CARD_NAME = 'sonnendeck-card';
const EDITOR_NAME = 'sonnendeck-card-editor';
/**
 * The card was published as anker-solix-flow-card up to 0.7.4. Dashboards
 * out there still say `type: custom:anker-solix-flow-card`, so the old tag
 * stays registered as the same element — nobody has to touch their YAML.
 */
const LEGACY_NAME = 'anker-solix-flow-card';
const CARD_VERSION = '0.8.0';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export interface EntityMap {
  /** total PV production in W */
  solar?: string;
  /** individual MPPT inputs in W, summed when `solar` is missing */
  solar_1?: string;
  solar_2?: string;
  solar_3?: string;
  solar_4?: string;
  /** grid power in W — positive = import, negative = export */
  grid?: string;
  /** total house consumption in W */
  home?: string;
  /** state of charge in % */
  battery_soc?: string;
  /** battery power in W — positive = charging */
  battery_power?: string;
  /** AC output of the storage towards the house in W */
  output?: string;

  /* Partial flows. When present these drive the four lines directly
   * instead of the card inferring directions from the totals. */
  pv_to_home?: string;
  pv_to_battery?: string;
  battery_to_home?: string;
  grid_to_battery?: string;
  grid_to_home?: string;
  home_to_grid?: string;
}

export type EntityRole = keyof EntityMap;

/**
 * The meter belongs to the house, not to a solarbank. Anything set here
 * wins over what the systems report — which is what you want with a
 * Tasmota SML reader, a Shelly 3EM or any other whole-house meter.
 */
export interface HouseMeter {
  /** signed grid power in W, + import / − export */
  grid?: string;
  /** import power in W, e.g. Tasmota SML_in */
  grid_import?: string;
  /** export power in W, e.g. Tasmota SML_out */
  grid_export?: string;
  /** total house consumption in W */
  load?: string;
}

/**
 * A wall charger and the car it feeds. Configuring one adds a parking bay
 * to the scene and widens it — the Power Dock brings CEE ports for exactly
 * this, so the picture should have room for it.
 */
export interface WallboxConfig {
  /** device_id of the charger, everything else is derived from it */
  device?: string;
  /** charging power in W */
  power?: string;
  /** or one entity per phase, summed */
  power_l1?: string;
  power_l2?: string;
  power_l3?: string;
  /** optional, opened when the car is tapped */
  status?: string;
  /**
   * Where the charger hangs. A Power Dock has its own port for it, so with
   * a dock the cable branches off the AC rail instead of leaving the
   * distribution board. Defaults to 'dock' as soon as one is configured.
   */
  source?: 'house' | 'dock';
  /**
   * Whether the charging power is part of the calculated house load.
   * True by default: the car sits behind the meter either way, so the
   * balance counts it and it has to come back out to leave the household
   * on its own. Set false if your solarbank output sensor already excludes
   * the car.
   */
  in_home_load?: boolean;
}

export interface SystemConfig {
  /** device_id of the anker_solix system — everything else is derived */
  device?: string;
  /** label in the system switcher; defaults to the device name */
  name?: string;
  /** label under the storage unit */
  device_name?: string;
  /** manual overrides, they win over anything discovered */
  entities?: EntityMap;
}

export interface SonnendeckCardConfig {
  type: string;
  title?: string;
  /** one entry per Anker system; the card shows a switcher above two */
  systems?: SystemConfig[];

  /* single system shorthand, also the v0.1 config format */
  device?: string;
  device_name?: string;
  entities?: EntityMap;

  /** device_id of a Power Dock, if one manages the storages */
  dock?: string;
  /** whole-house meter, overrides whatever the systems report */
  house?: HouseMeter;
  /** wall charger; set it and the parking bay appears */
  wallbox?: WallboxConfig;
  invert_grid?: boolean;
  invert_battery?: boolean;
  animation?: boolean;
  /** switch to kW above this many watts; 0 keeps everything in W */
  kw_threshold?: number;
  /** follow the Home Assistant theme (default), or pin the palette */
  dark_mode?: 'auto' | 'light' | 'dark';
  /**
   * Two Anker systems in one house usually watch the same meter, so
   * summing their grid and house readings would count them twice.
   * 'primary' takes the value from the first system that reports one.
   */
  combine?: { grid?: 'primary' | 'sum'; home?: 'primary' | 'sum' };
  /**
   * 'units' draws one cabinet per system. 'combined' draws a single
   * one — the shape a Power Dock takes once it manages the storages.
   * 'auto' picks 'combined' as soon as a dock is found.
   */
  storage_display?: 'auto' | 'units' | 'combined';
  labels?: { solar?: string; grid?: string; home?: string };
}

interface EntityRegistryDisplay {
  device_id?: string | null;
  platform?: string;
  translation_key?: string | null;
}

interface DeviceEntry {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  via_device_id?: string | null;
  model?: string | null;
}

interface HassLike {
  states: Record<string, { state: string; attributes: Record<string, unknown> }>;
  locale?: { language?: string };
  language?: string;
  themes?: { darkMode?: boolean };
  entities?: Record<string, EntityRegistryDisplay>;
  devices?: Record<string, DeviceEntry>;
  callWS?: <T>(msg: Record<string, unknown>) => Promise<T>;
}

/** noise floor in W below which a flow counts as idle */
const EPS = 10;

/**
 * Translation keys used by the `anker_solix` integration, best match
 * first. Keys are stable across languages, unlike entity ids.
 * Source: custom_components/anker_solix/translations/en.json
 */
const KEY_MATCH: Record<EntityRole, string[]> = {
  solar: ['solar_power_total', 'solarbank_input_power', 'input_power'],
  solar_1: ['solar_power_1'],
  solar_2: ['solar_power_2'],
  solar_3: ['solar_power_3'],
  solar_4: ['solar_power_4'],
  grid: ['grid_power_signed'],
  home: ['home_load_power', 'ac_to_home_load'],
  battery_soc: ['solarbank_state_of_charge', 'state_of_charge_total', 'state_of_charge'],
  battery_power: [
    'solarbank_battery_power_signed',
    'battery_power_signed_total',
    'battery_power_signed',
  ],
  output: [
    'solarbank_output_power',
    'ac_output_power_total',
    'output_power_total',
    'ac_output_power',
  ],
  pv_to_home: ['pv_to_home_power'],
  pv_to_battery: ['pv_to_battery_power'],
  battery_to_home: ['battery_to_home_power'],
  grid_to_battery: ['grid_to_battery_power'],
  grid_to_home: ['grid_to_home_power'],
  home_to_grid: ['photovoltaic_to_grid_power'],
};

/** translation keys of the `anker_solix` EV charger */
const EV_KEYS: Record<string, string[]> = {
  power_l1: ['power_l1'],
  power_l2: ['power_l2'],
  power_l3: ['power_l3'],
  power: ['ev_charge_power_avg'],
  status: ['ev_charger_status'],
};

/** the roles that only exist on a system device, never on a solarbank */
const SYSTEM_ROLES: EntityRole[] = ['home', 'grid', 'grid_to_home', 'home_to_grid'];

/**
 * Fallback for setups without translation keys — matched against the
 * entity_id. Every substring of a group has to be present.
 */
const ID_MATCH: Partial<Record<EntityRole, string[][]>> = {
  solar: [['solar_power'], ['photovoltaic_power'], ['pv_power']],
  solar_1: [['solar_power_1'], ['solar_pv1']],
  solar_2: [['solar_power_2'], ['solar_pv2']],
  solar_3: [['solar_power_3'], ['solar_pv3']],
  solar_4: [['solar_power_4'], ['solar_pv4']],
  grid: [['grid_power']],
  home: [['home_load_power'], ['home_demand'], ['house_load']],
  battery_soc: [['state_of_charge'], ['battery_soc'], ['battery_level']],
  battery_power: [['battery_power'], ['charging_power']],
  output: [['output_power']],
  grid_to_home: [['grid_import'], ['grid_to_home']],
  home_to_grid: [['grid_export'], ['to_grid']],
};

/* ------------------------------------------------------------------ *
 * Entity discovery
 *
 * Given the device_id of an Anker system, collect every sensor that
 * belongs to it or to one of its child devices, then sort them into
 * the roles the card needs. Because this runs against the live
 * registry, hardware added later — a second solarbank, a Power Dock —
 * shows up without touching the card configuration.
 * ------------------------------------------------------------------ */

const suffixIsPowerish = (id: string): boolean => id.startsWith('sensor.');

/** entity ids of a device and, optionally, of its children */
const entitiesOfDevices = (hass: HassLike, deviceIds: Set<string>): string[] => {
  const reg = hass.entities;
  if (!reg) return [];
  return Object.keys(reg).filter((id) => {
    const dev = reg[id]?.device_id;
    return !!dev && deviceIds.has(dev) && suffixIsPowerish(id);
  });
};

const resolveRoles = (hass: HassLike, entityIds: string[]): EntityMap => {
  const reg = hass.entities ?? {};
  const found: EntityMap = {};

  for (const role of Object.keys(KEY_MATCH) as EntityRole[]) {
    const wanted = KEY_MATCH[role];
    let best: { id: string; rank: number } | undefined;
    for (const id of entityIds) {
      const key = reg[id]?.translation_key;
      if (!key) continue;
      const rank = wanted.indexOf(key);
      if (rank < 0) continue;
      if (!best || rank < best.rank) best = { id, rank };
    }
    if (best) found[role] = best.id;
  }

  // fall back to entity_id matching for anything still missing
  for (const role of Object.keys(ID_MATCH) as EntityRole[]) {
    if (found[role]) continue;
    for (const group of ID_MATCH[role] ?? []) {
      const hit = entityIds.find((id) => group.every((part) => id.includes(part)));
      if (hit) {
        found[role] = hit;
        break;
      }
    }
  }
  return found;
};

/* ------------------------------------------------------------------ *
 * Localisation
 * ------------------------------------------------------------------ */

const STRINGS: Record<string, Record<string, string>> = {
  de: {
    solar: 'Solarbetrieb',
    grid: 'Netz',
    home: 'Hauslast',
    storage: 'Speicher',
    charging: 'lädt',
    discharging: 'entlädt',
    idle: 'ruht',
    system: 'System',
    pick_device: 'Kein System gewählt — Gerät im Editor auswählen',
    bad_unit:
      'Diese Sensoren liefern einen Zählerstand. Gebraucht wird die Momentanleistung in Watt:',
  },
  en: {
    solar: 'Solar',
    grid: 'Grid',
    home: 'Home load',
    storage: 'Storage',
    charging: 'charging',
    discharging: 'discharging',
    idle: 'idle',
    system: 'System',
    pick_device: 'No system selected — pick a device in the editor',
    bad_unit: 'These sensors report a meter reading. Instantaneous power in watts is needed:',
  },
};

const t = (lang: string | undefined, key: string): string => {
  const dict = (lang || 'en').toLowerCase().startsWith('de') ? STRINGS.de : STRINGS.en;
  return dict[key] ?? STRINGS.en[key] ?? key;
};
/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** meter readings in these units are counters, not a rate — unusable here */
const ENERGY_UNITS = new Set(['Wh', 'kWh', 'MWh']);

/** the unit of an entity, '' when it has none */
const unitOf = (hass: HassLike | undefined, id?: string): string => {
  if (!hass || !id) return '';
  return String(hass.states[id]?.attributes?.unit_of_measurement ?? '');
};

/**
 * Reads a value and normalises it to watts. A kWh counter would look like
 * a plausible number and quietly show nonsense, so it is rejected instead.
 */
const readNumber = (hass: HassLike | undefined, id?: string): number | null => {
  if (!hass || !id) return null;
  const st = hass.states[id];
  if (!st) return null;
  const v = Number(st.state);
  if (!Number.isFinite(v)) return null;
  const unit = String(st.attributes?.unit_of_measurement ?? '');
  if (ENERGY_UNITS.has(unit)) return null;
  return unit === 'kW' ? v * 1000 : v;
};

const fmtPower = (w: number | null, kwThreshold: number): string => {
  if (w === null) return '– W';
  if (kwThreshold > 0 && Math.abs(w) >= kwThreshold) {
    return `${(w / 1000).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} kW`;
  }
  // the app prints raw watts without a group separator
  return `${Math.round(w)} W`;
};

const fmtPct = (v: number | null): string => (v === null ? '–%' : `${Math.round(v)}%`);


/* ------------------------------------------------------------------ *
 * Isometric scene
 *
 * Constructed, not traced. Two ground axes and one vertical axis:
 *
 *   screen = O + x*(1, K) + y*(-1, K) + h*(0, -1)
 *
 *   +x  right and down — the ridge direction
 *   +y  left and down  — the direction the visible roof plane falls in
 *   +h  up
 *
 * Because every point goes through the same projection, the ridge is
 * parallel to the eave by construction, the roof plane can be tiled
 * edge to edge, and everything stands on one ground plane at h = 0.
 * ------------------------------------------------------------------ */

/** isometric flattening — 0 would be a plan view, 1 a 45° view */
const K = 0.28;
/** screen position of the world origin */
const ORIGIN: [number, number] = [392, 520];

const HOUSE = {
  L: 470, // ridge length, along x
  W: 340, // gable width, along y
  HW: 150, // wall height
  HR: 180, // ridge above the eave
  OH: 24, // eave overhang
  VO: 20, // verge overhang at the gable
  T: 13, // roof thickness, shown at the eave and the verges
};
const PITCH = HOUSE.HR / (HOUSE.W / 2);
const ROOF_SPAN = HOUSE.W / 2 + HOUSE.OH;

type Pt = [number, number];

const p3 = (x: number, y: number, h: number): Pt => [
  ORIGIN[0] + x - y,
  ORIGIN[1] + K * (x + y) - h,
];

const fp = (p: Pt): string => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const poly = (pts: Pt[]): string => `M${pts.map(fp).join(' L ')} Z`;
const line = (pts: Pt[]): string => `M${pts.map(fp).join(' L ')}`;

/**
 * A polyline with rounded corners. Cables bend, they do not have mitres —
 * and a rounded joint also keeps the travelling pulse from stuttering as
 * it turns.
 */
const smooth = (pts: Pt[], radius = 18): string => {
  if (pts.length < 3) return line(pts);
  let d = `M${fp(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const da = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (da < 1 || db < 1) continue;
    const ra = Math.min(radius, da / 2);
    const rb = Math.min(radius, db / 2);
    const s1: Pt = [p[0] + ((a[0] - p[0]) * ra) / da, p[1] + ((a[1] - p[1]) * ra) / da];
    const e1: Pt = [p[0] + ((b[0] - p[0]) * rb) / db, p[1] + ((b[1] - p[1]) * rb) / db];
    d += ` L${fp(s1)} Q${fp(p)} ${fp(e1)}`;
  }
  return `${d} L${fp(pts[pts.length - 1])}`;
};

/** a point on the visible roof plane: t = 0 at the ridge, t = 1 at the eave */
const roofPt = (x: number, t: number): Pt =>
  p3(x, HOUSE.W / 2 + t * ROOF_SPAN, HOUSE.HW + HOUSE.HR - t * ROOF_SPAN * PITCH);

/** three visible faces of an axis aligned box */
const isoBox = (
  x: number,
  y: number,
  h: number,
  dx: number,
  dy: number,
  dh: number,
  top: string,
  front: string,
  side: string,
): string =>
  `<path d="${poly([p3(x, y, h + dh), p3(x + dx, y, h + dh), p3(x + dx, y + dy, h + dh), p3(x, y + dy, h + dh)])}" fill="${top}"/>` +
  `<path d="${poly([p3(x + dx, y, h + dh), p3(x + dx, y, h), p3(x + dx, y + dy, h), p3(x + dx, y + dy, h + dh)])}" fill="${side}"/>` +
  `<path d="${poly([p3(x, y + dy, h + dh), p3(x + dx, y + dy, h + dh), p3(x + dx, y + dy, h), p3(x, y + dy, h)])}" fill="${front}"/>`;

/** soft contact shadow so nothing floats */
const groundShadow = (x: number, y: number, dx: number, dy: number, o: number): string => {
  const c = p3(x + dx / 2, y + dy / 2, 0);
  const r = (dx + dy) / 2 + 14;
  return `<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * K * 0.95).toFixed(1)}" fill="var(--ak-shadow)" opacity="${o}" filter="url(#ak-soft)"/>`;
};

/** a closed polygon with rounded corners — used for the car's body */
const smoothPoly = (pts: Pt[], radius = 11): string => {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const da = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (da < 1 || db < 1) continue;
    const ra = Math.min(radius, da / 2);
    const rb = Math.min(radius, db / 2);
    const s1: Pt = [p[0] + ((a[0] - p[0]) * ra) / da, p[1] + ((a[1] - p[1]) * ra) / da];
    const e1: Pt = [p[0] + ((b[0] - p[0]) * rb) / db, p[1] + ((b[1] - p[1]) * rb) / db];
    d += `${d ? ' L' : 'M'}${fp(s1)} Q${fp(p)} ${fp(e1)}`;
  }
  return `${d} Z`;
};

/* ----------------------------- solar array ----------------------------- */

/**
 * The array sits on the left of the roof: every cabinet is placed 109 to
 * the right of its column so the cable drops straight down, and that shift
 * has to stay inside the plot. The bare tiles towards the gable are the
 * price, and they read fine.
 */
const ARRAY = { x0: -10, x1: 400, gapX: 24, t0: 0.07, t1: 0.86 };

/** a module column never gets wider than this, so one system stays readable */
const MAX_COL_W = 230;

interface BlockRect {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
}

/**
 * Every solarbank gets one block of four modules, and the blocks stand
 * side by side from left to right — never in two rows. The cabinets sit in
 * the same order below, so each cable is a straight drop into its own
 * storage: no sorting, no crossings, nothing to reason about.
 */
const blockRect = (s: number, n: number): BlockRect => {
  const available = ARRAY.x1 - ARRAY.x0;
  const w = Math.min(MAX_COL_W, (available - ARRAY.gapX * (n - 1)) / n);
  const used = n * w + ARRAY.gapX * (n - 1);
  const x0 = ARRAY.x0 + (available - used) / 2 + s * (w + ARRAY.gapX);
  return { x0, x1: x0 + w, t0: ARRAY.t0, t1: ARRAY.t1 };
};

const blockCentre = (s: number, n: number): number => {
  const r = blockRect(s, n);
  return (r.x0 + r.x1) / 2;
};

/**
 * Four modules per solarbank, one per MPPT input, as a 2x2 block — that
 * keeps the modules close to a real module's proportions instead of
 * stretching them into slats. Inputs that carry nothing are drawn dark,
 * which makes a shaded or disconnected string obvious at a glance.
 */
const panelMarkup = (blocks: number): string => {
  let out = '';
  for (let s = 0; s < blocks; s++) {
    const r = blockRect(s, blocks);
    const gx = 8;
    const gt = 0.022;
    const cw = (r.x1 - r.x0 - gx) / 2;
    const ch = (r.t1 - r.t0 - gt) / 2;
    for (let k = 0; k < 4; k++) {
      const ax = r.x0 + (k % 2) * (cw + gx);
      const at = r.t0 + Math.floor(k / 2) * (ch + gt);
      const bx = ax + cw;
      const bt = at + ch;
      out += `<g class="pv" data-pv="${s * 4 + k}">`;
      out += `<path class="pv-face" d="${poly([roofPt(ax, at), roofPt(bx, at), roofPt(bx, bt), roofPt(ax, bt)])}"/>`;
      out += `<path class="pv-grid" d="${line([roofPt(ax, (at + bt) / 2), roofPt(bx, (at + bt) / 2)])}"/>`;
      out += `<path class="pv-grid" d="${line([roofPt((ax + bx) / 2, at), roofPt((ax + bx) / 2, bt)])}"/>`;
      // glass: a reflection across the upper-left corner, and a lit top edge
      out += `<path class="pv-sheen" d="${poly([roofPt(ax, at), roofPt(bx, at), roofPt(ax, bt)])}"/>`;
      out += `<path class="pv-edge" d="${line([roofPt(ax, at), roofPt(bx, at)])}"/>`;
      out += `</g>`;
    }
  }
  return out;
};

/* ------------------------------ storages ------------------------------- */

const UNIT = { dx: 44, dy: 66, h: 118, yOff: 62 };

/** shift a projected point in screen space — flow routing is schematic */
const off = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];

const unitY = HOUSE.W + UNIT.yOff;

/**
 * 109 is the offset that makes the drop from the column above land exactly
 * on the cabinet: it cancels the sideways shift the projection adds between
 * the eave and the ground.
 */
const unitX = (i: number, units: number): number => blockCentre(i, units) + 109;

const storageMarkup = (units: number, blocks: number): string => {
  let out = '';
  for (let i = 0; i < units; i++) {
    const x = unitX(i, units);
    const wide = units === 1 && blocks > 1;
    const dx = wide ? UNIT.dx + 22 : UNIT.dx;
    out += `<g class="unit" data-unit="${i}">`;
    out += groundShadow(x, unitY, dx, UNIT.dy, 0.13);
    out += isoBox(x, unitY, 0, dx, UNIT.dy, UNIT.h,
      'url(#ak-u-top)', 'url(#ak-u-front)', 'url(#ak-u-side)');
    // a lit edge along the top of the front face and a dark foot give the
    // cabinet its volume — the same box, just read as a solid
    out += `<path class="unit-rim" d="${line([
      p3(x, unitY + UNIT.dy, UNIT.h),
      p3(x + dx, unitY + UNIT.dy, UNIT.h),
    ])}"/>`;
    out += `<path class="unit-rim side" d="${line([
      p3(x + dx, unitY + UNIT.dy, UNIT.h),
      p3(x + dx, unitY, UNIT.h),
    ])}"/>`;
    out += `<path class="unit-accent" d="${line([
      p3(x + 8, unitY + UNIT.dy, 14),
      p3(x + 8, unitY + UNIT.dy, UNIT.h - 22),
    ])}"/>`;
    out += `<path class="unit-vent" d="${poly([
      p3(x + 10, unitY + UNIT.dy, UNIT.h - 16),
      p3(x + dx - 10, unitY + UNIT.dy, UNIT.h - 16),
      p3(x + dx - 10, unitY + UNIT.dy, UNIT.h - 26),
      p3(x + 10, unitY + UNIT.dy, UNIT.h - 26),
    ])}"/>`;
    out += `</g>`;
  }
  return out;
};

const unitFoot = (i: number, units: number): Pt =>
  p3(unitX(i, units) + UNIT.dx / 2, unitY + UNIT.dy, 0);

/** the state-of-charge pill floats just above its cabinet */
const chipAnchor = (i: number, units: number): Pt =>
  off(p3(unitX(i, units) + UNIT.dx / 2, unitY + UNIT.dy, UNIT.h), 0, -36);

/* -------------------------------- flows -------------------------------- */

/**
 * The gable wall carries everything electrical, and each thing has its own
 * stretch of it, back to front: meter, wallbox, terrace door. One cable
 * runs along the foot of the wall — and goes underground beneath the
 * terrace in front of the door, so nothing hangs in front of it.
 */
const METER = { y0: 14, y1: 70, h0: 40, h1: 122 };
const METER_Y = (METER.y0 + METER.y1) / 2;
/** the service line arrives at the meter's back edge at this height */
const SERVICE_H = 104;
/** the cable follows the wall a hand's breadth out */
const TRUNK_X = HOUSE.L + 8;
const DOOR = { y0: 158, y1: 258, h: 120 };
/** the terrace slab in front of the door; the cable runs beneath it */
const TERRACE = { y0: DOOR.y0 - 14, y1: DOOR.y1 + 14, d: 54, h: 5 };
/** wall mounted: the box sits on the gable wall and protrudes by d */
const WB = { y: 96, dy: 32, h0: 38, dh: 40, d: 22 };
/** the wallbox is fed from the front half of its underside */
const WB_FEED_Y = WB.y + WB.dy - 6;
/** the charging cable leaves the middle of its outer face and ends at the car's tail */
const WB_OUT_Y = WB.y + WB.dy / 2;
const MAST = { x: 482, y: -56, h: 250 };
/** with a parking bay the mast moves back to the plot boundary */
const MAST_EV = { x: 566, y: -132, h: 250 };
const mastOf = (ev: boolean) => (ev ? MAST_EV : MAST);

/* --------------------------- parking bay --------------------------- */

const PARK = { x0: 528, x1: 772, y0: 34, y1: 212 };
/**
 * The car is built the way an isometric car actually reads: a lower body
 * swept across the full width, and a greenhouse sitting on top of it, inset
 * on both sides (tumblehome). Both come from a side profile in (length,
 * height) along the car's own axis; sweeping them across the width gives
 * the visible faces without a single hand-placed polygon.
 */
const CAR = { x: 578, y: 84, dx: 176, dy: 68, roof: 58 };
/**
 * Proportions of a long, low saloon, in picture units (one unit is about
 * 2.8 cm): 176 long, 68 wide, 54 to the roof. The earlier car stood 72 high,
 * which is a van — that is why it looked stubby.
 */
/** how far the cabin is inset from the body sides */
const CAR_TUMBLE = 8;

/** lower body, closed: shoulder line, nose, underside, tail */
const CAR_BODY: Array<[number, number]> = [
  [3, 29],
  [18, 34],
  [70, 36],
  [124, 36],
  [152, 31],
  [168, 25],
  [175, 17],
  [176, 10],
  [172, 6],
  [150, 6],
  [32, 6],
  [8, 7],
  [2, 12],
  [2, 22],
];
/** indices 0..5 sweep into the deck, the shoulder and the bonnet */
const CAR_BODY_TOP = 6;
/** indices 5..7 sweep into the front face */
const CAR_BODY_NOSE = 8;

/**
 * The greenhouse: a long fastback — the roof peaks over the front seats and
 * falls away to a short deck, and the screen is raked far back.
 */
const CAR_CAB: Array<[number, number]> = [
  [18, 34],
  [30, 43],
  [52, 53],
  [80, 58],
  [104, 54],
  [126, 40],
  [133, 34],
  [133, 30],
  [18, 30],
];
/** indices 0..4 are the roof and the fastback, 4..6 the raked screen */
const CAR_CAB_ROOF = 5;
const CAR_CAB_SCREEN_FROM = 4;
const CAR_CAB_SCREEN_TO = 7;
/** the side glass, inset so the pillars stay body-coloured */
const CAR_GLASS: Array<[number, number]> = [
  [25, 37],
  [35, 44],
  [54, 52.5],
  [80, 56],
  [102, 52],
  [122, 40],
  [128, 37],
];
/** the glass roof */
const CAR_ROOF_GLASS: Array<[number, number]> = [
  [40, 51],
  [80, 57],
  [106, 53],
];

/** wheel centres along the car; the wheelbase is 104 */
const CAR_WHEELS = [36, 140];

/** where the charging-power pill sits */
const evChipAnchor = (): Pt =>
  off(p3(CAR.x + CAR.dx / 2, CAR.y + CAR.dy, CAR.roof), 34, -48);

const CAR_NEAR = CAR.y + CAR.dy;
const CAR_FAR = CAR.y;

/**
 * How far the body is drawn in from the sides at a given point along its
 * length. A car is widest between the axles and tapers towards both ends;
 * without this the nose is a slab and the tail a brick.
 */
const carTaper = (x: number): number => {
  const t = Math.min(1, Math.max(0, Math.min(x, CAR.dx - x) / 46));
  return 10 * (1 - t) ** 1.6;
};

/** a profile point on one side of the car: +1 near, −1 far */
const carSide = (p: [number, number], side: 1 | -1, inset = 0): Pt =>
  p3(CAR.x + p[0], (side > 0 ? CAR_NEAR : CAR_FAR) - side * (carTaper(p[0]) + inset), p[1]);

/** the surface a chain of profile points sweeps out across the car */
const carBand = (chain: Array<[number, number]>, inset = 0): string =>
  poly([
    ...chain.map((p) => carSide(p, 1, inset)),
    ...chain.map((p) => carSide(p, -1, inset)).reverse(),
  ]);

const parkingMarkup = (): string => {
  const bay = poly([
    p3(PARK.x0, PARK.y0, 0),
    p3(PARK.x1, PARK.y0, 0),
    p3(PARK.x1, PARK.y1, 0),
    p3(PARK.x0, PARK.y1, 0),
  ]);

  /**
   * A wheel. A disc standing in the x/h plane projects to an ellipse tilted
   * by the isometric slope — atan(K) ≈ 15.6° — which is what makes it read
   * as a wheel rather than a sticker.
   */
  const tilt = ((Math.atan(K) * 180) / Math.PI).toFixed(1);
  const wheel = (x: number, y: number, r: number, cls: string): string => {
    const c = p3(CAR.x + x, y, r);
    const rim = r * 0.86;
    // five spokes, drawn in the wheel's own (already tilted) frame
    const spokes = Array.from({ length: 5 }, (_, k) => {
      const t = ((-90 + k * 72) * Math.PI) / 180;
      return `M0 0 L${(rim * 0.92 * Math.cos(t)).toFixed(1)} ${(rim * 0.92 * 0.95 * Math.sin(t)).toFixed(1)}`;
    }).join(' ');
    return `<g class="${cls}" transform="translate(${fp(c)}) rotate(${tilt})">
      <ellipse rx="${r}" ry="${(r * 0.95).toFixed(1)}" fill="var(--ak-car-wheel)"/>
      <ellipse rx="${rim.toFixed(1)}" ry="${(rim * 0.95).toFixed(1)}" fill="var(--ak-car-rim)"/>
      <path d="${spokes}" stroke="var(--ak-car-slit)" stroke-width="${Math.max(1.6, r * 0.13).toFixed(1)}" stroke-linecap="round" fill="none"/>
      <ellipse rx="${(r * 0.14).toFixed(1)}" ry="${(r * 0.13).toFixed(1)}" fill="var(--ak-car-slit)"/>
    </g>`;
  };
  /** the dark recess the wheel sits in, cut off at the sill */
  const arch = (x: number, r: number): string => {
    const c = p3(CAR.x + x, CAR_NEAR - carTaper(x) - 1, r);
    return `<ellipse class="arch" transform="translate(${fp(c)}) rotate(${tilt})" rx="${r + 4}" ry="${((r + 4) * 0.95).toFixed(1)}"/>`;
  };

  const bodyTop = CAR_BODY.slice(0, CAR_BODY_TOP);
  const bodyNose = CAR_BODY.slice(CAR_BODY_TOP - 1, CAR_BODY_NOSE);
  const cabRoof = CAR_CAB.slice(0, CAR_CAB_ROOF);
  const cabScreen = CAR_CAB.slice(CAR_CAB_SCREEN_FROM, CAR_CAB_SCREEN_TO);
  const bodySide = smoothPoly(CAR_BODY.map((p) => carSide(p, 1)), 6);

  /* a headlamp: a short strip near each corner of the nose, not a full bar */
  const lampBar = line([carSide([175.5, 20], -1, 6), carSide([175.5, 20], 1, 6)]);
  const lampCorner = line([carSide([174.5, 9], 1, 6), carSide([174.5, 17], 1, 6)]);

  return `
  <path class="bay" d="${bay}"/>
  ${groundShadow(CAR.x + 12, CAR.y + 4, CAR.dx - 24, CAR.dy - 8, 0.15)}
  <!-- the charging cable lies on the ground and runs under the car's tail -->
  <g class="flows ac" fill="none" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
    ${flowPath('', 'ev', flowEvRun())}
  </g>
  <g class="car" data-tap="ev">
    <clipPath id="ak-car-clip"><path d="${bodySide}"/></clipPath>
    ${CAR_WHEELS.map((x) => wheel(x, CAR_FAR + 8, 11, 'wheel-far')).join('')}
    <path class="car-far" d="${smoothPoly(CAR_BODY.map((p) => carSide(p, -1)), 6)}"/>
    <path class="car-shell" d="${carBand(bodyTop)}"/>
    <path class="car-nose" d="${carBand(bodyNose)}"/>
    <path class="car-roof" d="${carBand(cabRoof, CAR_TUMBLE)}"/>
    <path class="car-cab" d="${carBand(cabScreen, CAR_TUMBLE)}"/>
    <path class="car-glass" d="${carBand(cabScreen, CAR_TUMBLE + 3)}"/>
    <path class="car-glass-top" d="${carBand(CAR_ROOF_GLASS, CAR_TUMBLE + 6)}"/>
    <path class="car-cab" d="${smoothPoly(CAR_CAB.map((p) => carSide(p, 1, CAR_TUMBLE)), 6)}"/>
    <path class="car-glass" d="${smoothPoly(CAR_GLASS.map((p) => carSide(p, 1, CAR_TUMBLE)), 5)}"/>
    <path class="car-pillar" d="${line([
      carSide([61, 38], 1, CAR_TUMBLE),
      carSide([61, 50], 1, CAR_TUMBLE),
    ])}"/>
    <path class="car-trim" d="${line(cabRoof.map((p) => carSide(p, 1, CAR_TUMBLE)))}"/>
    <path class="car-side" d="${bodySide}"/>
    <path class="car-crease" d="${line([
      carSide([16, 26], 1),
      carSide([88, 27], 1),
      carSide([152, 24], 1),
    ])}"/>
    <path class="car-shine" d="${line([
      carSide([24, 33.5], 1),
      carSide([84, 35.2], 1),
      carSide([132, 34.4], 1),
    ])}"/>
    <g clip-path="url(#ak-car-clip)">${CAR_WHEELS.map((x) => arch(x, 13)).join('')}</g>
    ${CAR_WHEELS.map((x) => wheel(x, CAR_NEAR - carTaper(x) - 1, 13, 'wheel')).join('')}
    <path class="car-light" d="${lampBar} ${lampCorner}"/>
    <path class="car-tail" d="${line([carSide([2.5, 24], -1, 5), carSide([2.5, 24], 1, 5)])}"/>
  </g>
  <g class="wallbox" data-tap="ev">
    ${isoBox(HOUSE.L, WB.y, WB.h0, WB.d, WB.dy, WB.dh, 'var(--ak-meter)', 'var(--ak-meter-edge)', 'var(--ak-meter)')}
    <path class="wb-accent" d="${line([
      p3(HOUSE.L + WB.d, WB.y + 8, WB.h0 + WB.dh - 12),
      p3(HOUSE.L + WB.d, WB.y + WB.dy - 8, WB.h0 + WB.dh - 12),
    ])}"/>
  </g>`;
};

/**
 * The charger takes its feed from the cable at the foot of the wall: a short
 * riser up to the underside of the box. The car's cable hangs from the box
 * to the car's tail and sags between them, as a charging cable does. Dock or
 * house circuit, the picture is the same — the feed is whatever the cable
 * carries.
 */
const flowEvFeed = (): string =>
  line([p3(TRUNK_X, WB_FEED_Y, 0), p3(TRUNK_X, WB_FEED_Y, WB.h0 - 6)]);

const flowEvRun = (): string =>
  smooth([
    p3(HOUSE.L + WB.d, WB_OUT_Y, WB.h0 + 8),
    p3(HOUSE.L + 52, WB_OUT_Y, 22), // the low point of the sag
    p3(CAR.x + 4, WB_OUT_Y, 30),
  ], 26);

/** module block -> the solarbank underneath it */
const flowPv = (s: number, units: number, blocks: number): string => {
  const r = blockRect(s, blocks);
  const cx = (r.x0 + r.x1) / 2;
  const target = units === blocks ? s : 0;
  const top = p3(unitX(target, units) + UNIT.dx / 2, unitY, UNIT.h);
  const exit = roofPt(cx, r.t1 + 0.05);
  return smooth([exit, [exit[0], exit[1] + 26], off(top, 0, -4)], 12);
};

/**
 * The AC rail is a line on the ground in front of the cabinets, parallel to
 * the front wall. A stub drops from each cabinet to it; because the rail
 * lies RAIL_D further out along both ground axes, that drop is a straight
 * vertical on screen — the same trick as the DC cables above.
 */
const RAIL_D = 36;
const railY = unitY + UNIT.dy + RAIL_D;
/** where the stub of cabinet i meets the rail, along the rail */
const railX = (i: number, units: number): number =>
  unitX(i, units) + UNIT.dx / 2 + RAIL_D;

/**
 * Cabinet i down to the rail. The first stub stops 20 above the rail: the
 * rail's corner starts rounding there, so running all the way down would
 * poke past the bend. The rail is drawn after the stubs and covers the gap.
 */
const flowStub = (i: number, units: number): string =>
  line([off(unitFoot(i, units), 0, -6), off(p3(railX(i, units), railY, 0), 0, i === 0 ? -20 : 0)]);

/**
 * From the rail to the meter, in straight runs and nothing diagonal: along
 * the rail, back along the foot of the gable wall — beneath the terrace,
 * where the slab hides it — and up the wall into the meter's underside.
 * Every run follows one of the three axes of the picture.
 */
const flowHome = (units: number): string => {
  const x0 = railX(0, units);
  const xLast = railX(Math.max(units - 1, 0), units);
  // the turn sits at the wall, unless the last cabinet stands beyond it
  const xTurn = xLast <= TRUNK_X ? TRUNK_X : xLast + 16;
  const pts: Pt[] = [
    // start up on the first stub, not left of it — a free end sticking out
    // past the junction reads as a broken cable
    off(p3(x0, railY, 0), 0, -40),
    p3(x0, railY, 0),
    p3(xTurn, railY, 0),
  ];
  if (xTurn > TRUNK_X) {
    pts.push(p3(xTurn, HOUSE.W + 10, 0), p3(TRUNK_X, HOUSE.W + 10, 0));
  }
  pts.push(
    p3(TRUNK_X, METER_Y, 0), // along the wall, under the terrace slab
    p3(TRUNK_X, METER_Y, METER.h0 + 1), // and up into the meter
  );
  return smooth(pts, 10);
};

/**
 * The service line comes off the mast and reaches the house at the back
 * end of the gable, where the meter is. It never crosses the roof verge:
 * it drops to wall height first and arrives level.
 */
const flowGrid = (ev: boolean): string => {
  const m = mastOf(ev);
  return smooth([
    p3(m.x, m.y + 8, m.h - 18), // off the lowest crossarm
    p3(m.x - 5, m.y + 6, SERVICE_H), // down the mast to wall height
    p3(HOUSE.L + 36, METER.y0 + 8, SERVICE_H),
    p3(HOUSE.L, METER.y0 + 8, SERVICE_H), // level in through the meter's back edge
  ], 12);
};

/**
 * A cable is four strokes on one path: a soft shadow beneath it, the cable
 * itself, a thin highlight along its upper edge, and the travelling pulse.
 * Thin and straight reads as a real conduit; the shadow lifts it off the wall.
 */
const flowPath = (cls: string, key: string, d: string): string =>
  `<g data-flow="${key}"><path class="flow-case" pathLength="1000" d="${d}"/>` +
  `<path class="flow-base" pathLength="1000" d="${d}"/>` +
  `<path class="flow-hi" pathLength="1000" d="${d}"/>` +
  `<path class="flow-dash ${cls}" pathLength="1000" d="${d}"/></g>`;

/* ------------------------------ the scene ------------------------------ */

const sceneMarkup = (blocks: number, units: number, ev: boolean, evOnDock: boolean): string => {
  const VW = ev ? 1140 : 960;
  const RX = VW - 54; // right hand text anchor
  const G2 = ev ? 846 : 660; // second guide line
  // the storage caption carries the charge direction in words, so its column
  // needs a little more room than the solar one above it
  const GB = 356;
  const m = mastOf(ev);
  const { L, W, HW, HR, OH, VO, T } = HOUSE;
  const ridgeA = p3(-VO, W / 2, HW + HR);
  const ridgeB = p3(L + VO, W / 2, HW + HR);
  const eaveA = roofPt(-VO, 1);
  const eaveB = roofPt(L + VO, 1);
  const eaveH = HW - OH * PITCH;

  return `
<svg viewBox="0 0 ${VW} 1040" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ak-roof" x1="0" y1="0" x2=".5" y2="1">
      <stop offset="0" stop-color="var(--ak-roof-1)"/><stop offset="1" stop-color="var(--ak-roof-2)"/>
    </linearGradient>
    <linearGradient id="ak-pv" x1="0" y1="0" x2=".4" y2="1">
      <stop offset="0" stop-color="var(--ak-panel-1)"/><stop offset="1" stop-color="var(--ak-panel-2)"/>
    </linearGradient>
    <linearGradient id="ak-wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--ak-wall-1)"/><stop offset="1" stop-color="var(--ak-wall-2)"/>
    </linearGradient>
    <radialGradient id="ak-ground" cx=".45" cy=".45" r=".7">
      <stop offset="0" stop-color="var(--ak-ground-1)" stop-opacity=".85"/>
      <stop offset="1" stop-color="var(--ak-ground-2)" stop-opacity="0"/>
    </radialGradient>

    <!-- soft edges: contact shadows and clouds -->
    <filter id="ak-soft" x="-40%" y="-200%" width="180%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="ak-soft-l" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="ak-cloud" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="15"/></filter>
    <filter id="ak-lift" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="var(--ak-shadow)" flood-opacity=".4"/>
    </filter>

    <!-- walls: shaded under the eave, darker where they meet the ground -->
    <linearGradient id="ak-wall-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ak-shadow)" stop-opacity=".30"/>
      <stop offset=".16" stop-color="var(--ak-shadow)" stop-opacity=".08"/>
      <stop offset=".34" stop-color="var(--ak-shadow)" stop-opacity="0"/>
      <stop offset=".72" stop-color="var(--ak-shadow)" stop-opacity="0"/>
      <stop offset="1" stop-color="var(--ak-shadow)" stop-opacity=".16"/>
    </linearGradient>
    <linearGradient id="ak-wall-side-shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--ak-shadow)" stop-opacity=".12"/>
      <stop offset="1" stop-color="var(--ak-shadow)" stop-opacity="0"/>
    </linearGradient>

    <!-- roof: a faint sheen sliding across it, brighter towards the ridge -->
    <linearGradient id="ak-roof-sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".55" stop-color="#fff" stop-opacity=".10"/>
      <stop offset="1" stop-color="#fff" stop-opacity=".02"/>
    </linearGradient>

    <!-- storage cabinets: brushed light on top, falling off to the foot -->
    <linearGradient id="ak-u-top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--ak-unit-top)"/>
      <stop offset="1" stop-color="var(--ak-unit-front)"/>
    </linearGradient>
    <linearGradient id="ak-u-front" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ak-unit-front)"/>
      <stop offset="1" stop-color="var(--ak-unit-front-lo)"/>
    </linearGradient>
    <linearGradient id="ak-u-side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ak-unit-side)"/>
      <stop offset="1" stop-color="var(--ak-unit-side-lo)"/>
    </linearGradient>

    <!-- the car's flank: light on the shoulder, darker at the sill -->
    <linearGradient id="ak-car-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ak-car-side-hi)"/>
      <stop offset=".55" stop-color="var(--ak-car-side)"/>
      <stop offset="1" stop-color="var(--ak-car-nose)"/>
    </linearGradient>

    <!-- lit windows -->
    <linearGradient id="ak-lit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--ak-lit-1)"/>
      <stop offset="1" stop-color="var(--ak-lit-2)"/>
    </linearGradient>
    <radialGradient id="ak-halo" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="var(--ak-lit-1)" stop-opacity=".55"/>
      <stop offset="1" stop-color="var(--ak-lit-1)" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <path d="${poly([p3(-300, -260, 0), p3(L + 320, -260, 0), p3(L + 320, W + 300, 0), p3(-300, W + 300, 0)])}"
        fill="url(#ak-ground)"/>

  <!-- a few clouds, so the sky has depth behind the house -->
  <g class="clouds" filter="url(#ak-cloud)">
    <ellipse cx="150" cy="96" rx="120" ry="26"/><ellipse cx="236" cy="78" rx="84" ry="30"/><ellipse cx="300" cy="104" rx="90" ry="22"/>
    <ellipse cx="${VW - 300}" cy="150" rx="140" ry="30"/><ellipse cx="${VW - 200}" cy="130" rx="96" ry="34"/><ellipse cx="${VW - 130}" cy="158" rx="100" ry="24"/>
    <ellipse cx="${Math.round(VW / 2) - 40}" cy="262" rx="110" ry="22"/><ellipse cx="${Math.round(VW / 2) + 50}" cy="250" rx="80" ry="24"/>
  </g>

  <!-- grid mast, behind the house so the roof overlaps its base -->
  ${groundShadow(m.x - 14, m.y - 6, 24, 24, 0.08)}
  <g class="mast" fill="none" stroke-linecap="round">
    <path d="${line([p3(m.x - 12, m.y - 4, 0), p3(m.x - 4, m.y + 4, m.h + 68)])}"/>
    <path d="${line([p3(m.x + 12, m.y - 4, 0), p3(m.x + 4, m.y + 4, m.h + 68)])}"/>
    <path d="${line([p3(m.x - 8, m.y, m.h - 12), p3(m.x + 8, m.y, m.h - 12)])}"/>
    <path d="${line([p3(m.x - 10, m.y, m.h + 26), p3(m.x + 10, m.y, m.h + 26)])}"/>
    <path d="${line([p3(m.x - 18, m.y, m.h + 54), p3(m.x + 18, m.y, m.h + 54)])}"/>
  </g>

  <!-- house: a soft shadow all round the foot, then the walls -->
  <path d="${poly([p3(-26, -20, 0), p3(L + 30, -20, 0), p3(L + 30, W + 34, 0), p3(-26, W + 34, 0)])}"
        fill="var(--ak-shadow)" opacity=".16" filter="url(#ak-soft-l)"/>
  <path d="${poly([p3(0, W, 0), p3(L, W, 0), p3(L, W, HW), p3(0, W, HW)])}" fill="var(--ak-wall-side)"/>
  <path d="${poly([p3(0, W, 0), p3(L, W, 0), p3(L, W, HW), p3(0, W, HW)])}" fill="url(#ak-wall-shade)"/>

  <path d="${poly([p3(58, W, 30), p3(178, W, 30), p3(178, W, 94), p3(58, W, 94)])}"
        fill="var(--ak-window)" stroke="var(--ak-window-edge)" stroke-width="3"/>

  <path d="${poly([p3(L, 0, 0), p3(L, W, 0), p3(L, W, HW), p3(L, W / 2, HW + HR), p3(L, 0, HW)])}" fill="url(#ak-wall)"/>
  <path d="${poly([p3(L, 0, 0), p3(L, W, 0), p3(L, W, HW), p3(L, W / 2, HW + HR), p3(L, 0, HW)])}" fill="url(#ak-wall-side-shade)"/>

  <!-- the attic window in the gable: it is the one place nothing stands in
       front of, so a warm light behind the glass always shows -->
  <path class="halo" d="${poly([p3(L, 52, 152), p3(L, 148, 152), p3(L, 148, 228), p3(L, 52, 228)])}"
        fill="url(#ak-halo)" filter="url(#ak-soft)"/>
  <path d="${poly([p3(L, 75, 168), p3(L, 125, 168), p3(L, 125, 212), p3(L, 75, 212)])}"
        fill="url(#ak-lit)" stroke="var(--ak-window-edge)" stroke-width="3"/>
  <path d="${line([p3(L, 100, 168), p3(L, 100, 212)])}" stroke="var(--ak-window-edge)" stroke-width="3" fill="none"/>
  <path d="${poly([p3(L, 70, 164), p3(L, 130, 164), p3(L, 130, 168), p3(L, 70, 168)])}" fill="var(--ak-window-edge)"/>
  <path d="${poly([p3(L, 0, 0), p3(L, W, 0), p3(L, W, 26), p3(L, 0, 26)])}" fill="url(#ak-wall-shade)" opacity=".7"/>

  <!-- the terrace door: two leaves of glass in a frame -->
  <path d="${poly([p3(L, DOOR.y0, 0), p3(L, DOOR.y1, 0), p3(L, DOOR.y1, DOOR.h), p3(L, DOOR.y0, DOOR.h)])}"
        fill="var(--ak-window)" stroke="var(--ak-door-edge)" stroke-width="4"/>
  <path d="${line([p3(L, (DOOR.y0 + DOOR.y1) / 2, 0), p3(L, (DOOR.y0 + DOOR.y1) / 2, DOOR.h)])}" stroke="var(--ak-door-edge)" stroke-width="3" fill="none"/>

  <g class="meter">
    <path d="${poly([p3(L, METER.y0, METER.h0), p3(L, METER.y1, METER.h0), p3(L, METER.y1, METER.h1), p3(L, METER.y0, METER.h1)])}"
          fill="var(--ak-meter)" stroke="var(--ak-meter-edge)" stroke-width="3"/>
    <path d="${poly([p3(L, METER.y0 + 17, METER.h0 + 16), p3(L, METER.y1 - 17, METER.h0 + 16), p3(L, METER.y1 - 17, METER.h1 - 34), p3(L, METER.y0 + 17, METER.h1 - 34)])}"
          fill="var(--ak-meter-face)"/>
    <path d="${line([p3(L, METER.y0 + 22, METER.h1 - 16), p3(L, METER.y1 - 22, METER.h1 - 16)])}"
          stroke="var(--ak-meter-edge)" stroke-width="5" fill="none" stroke-linecap="round"/>
  </g>

  <!-- roof: only the plane facing the camera, plus its edges -->
  <path d="${poly([ridgeA, ridgeB, eaveB, eaveA])}" fill="url(#ak-roof)"/>
  <path d="${poly([ridgeA, ridgeB, eaveB, eaveA])}" fill="url(#ak-roof-sheen)"/>
  <g class="pv-array" filter="url(#ak-lift)">${panelMarkup(blocks)}</g>
  <path d="${poly([eaveA, eaveB, p3(L + VO, W + OH, eaveH - T), p3(-VO, W + OH, eaveH - T)])}" fill="var(--ak-eave)"/>
  <path d="${poly([ridgeA, ridgeB, p3(L + VO, W / 2 - 16, HW + HR - 6), p3(-VO, W / 2 - 16, HW + HR - 6)])}" fill="var(--ak-ridge)"/>
  <path d="${poly([p3(L + VO, W / 2, HW + HR), p3(L + VO, W + OH, eaveH), p3(L + VO, W + OH, eaveH - T), p3(L + VO, W / 2, HW + HR - T)])}" fill="var(--ak-verge-1)"/>
  <path d="${poly([p3(L + VO, W / 2, HW + HR), p3(L + VO, -OH, eaveH), p3(L + VO, -OH, eaveH - T), p3(L + VO, W / 2, HW + HR - T)])}" fill="var(--ak-verge-2)"/>

  <g class="flows dc" fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: blocks }, (_, i) => flowPath('', `pv${i}`, flowPv(i, units, blocks))).join('')}
  </g>

  ${ev ? parkingMarkup() : ''}

  <g class="storages">${storageMarkup(units, blocks)}</g>

  <g class="flows ac" fill="none" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: units }, (_, i) => flowPath('', `ac${i}`, flowStub(i, units))).join('')}
    ${flowPath('', 'batteryToHome', flowHome(units))}
    ${flowPath('', 'gridToHome', flowGrid(ev))}
    ${ev ? flowPath('', 'ev', flowEvFeed()) : ''}
  </g>

  <!-- the terrace slab is drawn over the cable, which runs beneath it -->
  <g class="terrace">
    ${isoBox(HOUSE.L, TERRACE.y0, 0, TERRACE.d, TERRACE.y1 - TERRACE.y0, TERRACE.h,
      'var(--ak-door)', 'var(--ak-door-edge)', 'var(--ak-wall-side)')}
  </g>

  <g class="chips" id="ak-chips"></g>

  <g class="guides">
    <path d="M300 14 V150"/><path d="M${G2} 14 V150"/>
    <path d="M${GB} 872 V1024"/><path d="M${G2} 872 V1024"/>
    <circle cx="300" cy="150" r="5"/><circle cx="${G2}" cy="150" r="5"/>
    <circle cx="${GB}" cy="872" r="5"/><circle cx="${G2}" cy="872" r="5"/>
  </g>

  <g class="tap" data-tap="solar">
    <rect x="46" y="18" width="250" height="126" fill="transparent"/>
    <text class="cap" x="76" y="62" id="ak-solar-cap"></text>
    <text class="val" x="76" y="126" id="ak-solar-val"></text>
    <path class="chev" id="ak-solar-chev" d="M247 99 L264 113 L247 127"/>
  </g>

  <g class="tap" data-tap="grid">
    <rect x="${RX - 250}" y="18" width="250" height="126" fill="transparent"/>
    <text class="cap" x="${RX}" y="62" text-anchor="end" id="ak-grid-cap"></text>
    <text class="val" x="${RX}" y="126" text-anchor="end" id="ak-grid-val"></text>
  </g>

  <g class="tap" data-tap="battery">
    <rect x="46" y="876" width="${GB - 52}" height="148" fill="transparent"/>
    <text class="cap" x="76" y="920" id="ak-store-cap"></text>
    <path class="arrow" id="ak-store-arrow" d="M88 1000 L88 958 M75 971 L88 958 L101 971"/>
    <text class="val" x="114" y="996" id="ak-store-val"></text>
  </g>

  <g class="tap" data-tap="home">
    <rect x="${RX - 250}" y="876" width="250" height="148" fill="transparent"/>
    <text class="cap" x="${RX}" y="920" text-anchor="end" id="ak-home-cap"></text>
    <text class="val" x="${RX}" y="996" text-anchor="end" id="ak-home-val"></text>
  </g>
</svg>`;
};

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const STYLE = `
:host {
  --ak-sky-1:#cbe1fe; --ak-sky-2:#d8e9fd; --ak-sky-3:#e4f0fe; --ak-sky-4:#eaf3fe;
  --ak-ground-1:#ffffff; --ak-ground-2:#cfe0f5; --ak-shadow:#3b567a;
  --ak-roof-1:#7396bd; --ak-roof-2:#56789f;
  --ak-panel-1:#4a6591; --ak-panel-2:#39527c;
  --ak-panel-edge:#c3d3e6; --ak-panel-grid:#a8bdd8;
  --ak-panel-off-1:#8b9aad; --ak-panel-off-2:#78879b;
  --ak-eave:#3d5a80; --ak-ridge:#3a5680;
  --ak-verge-1:#33456a; --ak-verge-2:#2b3a5a;
  --ak-wall-1:#ffffff; --ak-wall-2:#eef3fa; --ak-wall-side:#dfe8f3;
  --ak-window:#cfdcec; --ak-window-edge:#c2d1e4;
  --ak-door:#f7fafd; --ak-door-edge:#dde7f2;
  --ak-meter:#ffffff; --ak-meter-edge:#d5e0ee; --ak-meter-face:#3d4652;
  --ak-unit-top:#95a0ad; --ak-unit-front:#79838f; --ak-unit-side:#4c545e;
  --ak-unit-vent:#2b323a;
  --ak-unit-front-lo:#626c78; --ak-unit-side-lo:#383f48;
  --ak-lit-1:#ffe2ae; --ak-lit-2:#f6bf84; --ak-glow-o:.55; --ak-halo-o:.0;
  --ak-cloud:#ffffff; --ak-cloud-o:.6;
  --ak-case:#2b3d57; --ak-case-o:.20; --ak-flow-hi:#ffffff;
  --ak-bay:#dfe8f4; --ak-bay-line:#c3d3e6;
  --ak-car-shell:#dde6f1; --ak-car-nose:#b7c4d4; --ak-car-side:#a3b2c4;
  --ak-car-far:#7c8b9e; --ak-car-glass:#b3c3d6; --ak-car-glass-2:#d2deec;
  --ak-car-roof:#edf2f9; --ak-car-cab:#ccd7e4; --ak-car-trim:#ffffff;
  --ak-car-wheel:#2b323c; --ak-car-rim:#b9c3d0; --ak-car-slit:#8d9aab;
  --ak-car-crease:#8a97a8; --ak-car-light:#7fe4ff; --ak-car-tail:#ff6470;
  --ak-car-side-hi:#c4d0df; --ak-car-arch:#232b36;
  --ak-mast:#b9cbe0; --ak-tree:#4e8570; --ak-trunk:#7b6350; --ak-bush:#69987e;
  --ak-accent:#5cc6e8; --ak-flow:#54b2d7; --ak-flow-idle:#bfd4e4;
  --ak-text:#1b2532; --ak-muted:#7d8fa5; --ak-guide:#a9bcd4;
  --ak-chip-bg:#ffffff; --ak-chip-fg:#39516d;
  display:block;
}

:host([dark]) {
  --ak-sky-1:#18222f; --ak-sky-2:#1d2836; --ak-sky-3:#22303f; --ak-sky-4:#1b2532;
  --ak-ground-1:#2c3d52; --ak-ground-2:#1b2532; --ak-shadow:#05080d;
  --ak-roof-1:#4b6a90; --ak-roof-2:#365070;
  --ak-panel-1:#33496e; --ak-panel-2:#263957;
  --ak-panel-edge:#7d93b3; --ak-panel-grid:#64799a;
  --ak-panel-off-1:#4c5768; --ak-panel-off-2:#3f4a59;
  --ak-eave:#2a3f5b; --ak-ridge:#293d5b;
  --ak-verge-1:#232e47; --ak-verge-2:#1c2439;
  --ak-wall-1:#c6d2e2; --ak-wall-2:#adbccf; --ak-wall-side:#93a4bb;
  --ak-window:#8fa3bd; --ak-window-edge:#7d92ad;
  --ak-door:#cfd9e7; --ak-door-edge:#a9b8cb;
  --ak-meter:#dbe3ef; --ak-meter-edge:#a5b4c7; --ak-meter-face:#2b3542;
  --ak-unit-top:#727d8a; --ak-unit-front:#5b646f; --ak-unit-side:#363d46;
  --ak-unit-vent:#1b2027;
  --ak-unit-front-lo:#454d57; --ak-unit-side-lo:#232930;
  --ak-lit-1:#ffd48a; --ak-lit-2:#f0a95c; --ak-glow-o:1; --ak-halo-o:.9;
  --ak-cloud:#4a5f7a; --ak-cloud-o:.16;
  --ak-case:#000000; --ak-case-o:.38; --ak-flow-hi:#ffffff;
  --ak-bay:#2a3646; --ak-bay-line:#3d4c60;
  --ak-car-shell:#98a4b3; --ak-car-nose:#74808f; --ak-car-side:#64707e;
  --ak-car-far:#454e5b; --ak-car-glass:#46556c; --ak-car-glass-2:#5b6b84;
  --ak-car-roof:#a9b5c4; --ak-car-cab:#8794a4; --ak-car-trim:#c8d2de;
  --ak-car-wheel:#161b22; --ak-car-rim:#78859a; --ak-car-slit:#505c6d;
  --ak-car-crease:#4f5967; --ak-car-light:#8fe9ff; --ak-car-tail:#ff5f6b;
  --ak-car-side-hi:#8795a6; --ak-car-arch:#0d1117;
  --ak-mast:#5b7290; --ak-tree:#3a6558; --ak-trunk:#584739; --ak-bush:#4e7561;
  --ak-accent:#4fb6d8; --ak-flow:#4fb6d8; --ak-flow-idle:#3d556f;
  --ak-text:#e9eff8; --ak-muted:#93a6bd; --ak-guide:#465c7a;
  --ak-chip-bg:#243244; --ak-chip-fg:#c8d8ea;
}

ha-card {
  /* ha-card is block in Home Assistant; spelling it out keeps the sky
     gradient painting when the card is rendered outside the frontend */
  display:block;
  overflow:hidden; padding:0; position:relative;
  background:linear-gradient(180deg,var(--ak-sky-1) 0%,var(--ak-sky-2) 34%,
             var(--ak-sky-3) 66%,var(--ak-sky-4) 100%);
}

.title {
  font-size:22px; font-weight:600; line-height:1.25;
  padding:14px 18px 0; margin:0; color:var(--ak-text);
}
.title[hidden] { display:none; }

.hint {
  padding:12px 18px; font-size:.9rem; color:var(--ak-muted);
  font-family:var(--paper-font-body1_-_font-family,inherit);
}
.hint[hidden] { display:none; }

.scene svg { display:block; width:100%; height:auto;
             font-family:var(--paper-font-body1_-_font-family,inherit); }

text { fill:var(--ak-text); }
.cap { font-size:32px; fill:var(--ak-muted); }
.val { font-size:44px; font-weight:700; fill:var(--ak-text); }
.chev { stroke:var(--ak-muted); stroke-width:5; fill:none;
        stroke-linecap:round; stroke-linejoin:round; }
.arrow { stroke:var(--ak-accent); stroke-width:6; fill:none;
         stroke-linecap:round; stroke-linejoin:round; }
.arrow.idle { stroke:var(--ak-muted); }
.guides path { stroke:var(--ak-guide); stroke-width:2.5; stroke-dasharray:3 9; fill:none; }
.guides circle { fill:var(--ak-guide); }
.tap { cursor:pointer; }
.tap:hover .val { opacity:.75; }
.tap.dead { cursor:default; }
.tap.dead:hover .val { opacity:1; }

.mast path { stroke:var(--ak-mast); stroke-width:4.5; }
.unit-accent { stroke:var(--ak-accent); stroke-width:7; stroke-linecap:round; }
.unit.idle .unit-accent { stroke:var(--ak-flow-idle); }
.unit { cursor:pointer; }
.unit-vent { fill:var(--ak-unit-vent); }
.bay { fill:var(--ak-bay); stroke:var(--ak-bay-line); stroke-width:3; stroke-dasharray:14 12; }
.car, .wallbox { cursor:pointer; }
.wb-accent { stroke:var(--ak-flow-idle); stroke-width:6; stroke-linecap:round; }
.car-far { fill:var(--ak-car-far); }
.car-shell { fill:var(--ak-car-shell); }
.car-nose { fill:var(--ak-car-nose); }
.car-side { fill:url(#ak-car-body); }
.arch { fill:var(--ak-car-arch); }
.car-shine { fill:none; stroke:#fff; stroke-width:2.5; stroke-linecap:round;
  stroke-linejoin:round; opacity:.5; }
.car-roof { fill:var(--ak-car-roof); stroke:var(--ak-car-cab); stroke-width:1.5;
  stroke-linejoin:round; }
.car-cab { fill:var(--ak-car-cab); }
.car-glass { fill:var(--ak-car-glass); }
.car-pillar { fill:none; stroke:var(--ak-car-cab); stroke-width:3; stroke-linecap:round; }
.car-glass-top { fill:var(--ak-car-glass-2); }
.car-trim { fill:none; stroke:var(--ak-car-trim); stroke-width:2;
  stroke-linecap:round; stroke-linejoin:round; opacity:.55; }
.car-crease { fill:none; stroke:var(--ak-car-crease); stroke-width:2.5;
  stroke-linecap:round; stroke-linejoin:round; opacity:.55; }
.car-light { stroke:var(--ak-car-light); stroke-width:3; stroke-linecap:round; }
.car-tail { stroke:var(--ak-car-tail); stroke-width:3; stroke-linecap:round; opacity:.85; }
.wheel ellipse, .wheel-far ellipse { stroke:none; }
.wheel-far { opacity:.75; }
.wallbox.charging .wb-accent { stroke:var(--ak-accent); }

.pv-face { fill:url(#ak-pv); stroke:var(--ak-panel-edge); stroke-width:3; }
.pv-grid { stroke:var(--ak-panel-grid); stroke-width:2; fill:none; }
.pv.off .pv-face { fill:var(--ak-panel-off-1); stroke:var(--ak-panel-off-2); }
.pv.off .pv-grid { stroke:var(--ak-panel-off-2); }

.chip rect { fill:var(--ak-chip-bg); opacity:.92; }
.chip text { font-size:26px; font-weight:600; fill:var(--ak-chip-fg); }

.clouds ellipse { fill:var(--ak-cloud); opacity:var(--ak-cloud-o); }
.halo { opacity:var(--ak-halo-o); }
.unit-rim { fill:none; stroke:#fff; stroke-width:2.5; stroke-linecap:round; opacity:.38; }
.unit-rim.side { opacity:.16; }
.pv-sheen { fill:#fff; opacity:.09; stroke:none; }
.pv-edge { stroke:#fff; stroke-width:2; opacity:.22; fill:none; stroke-linecap:round; }
.pv.off .pv-sheen, .pv.off .pv-edge { opacity:.05; }

/* a cable is a thin conduit with its own shadow; it takes the flow colour
   only while energy actually moves through it */
.flow-case { stroke:var(--ak-case); opacity:var(--ak-case-o); transform:translate(0,3px); }
.flows.dc .flow-case { stroke-width:8px; }
.flows.ac .flow-case { stroke-width:9px; }
.flow-base { stroke:var(--ak-flow-idle); opacity:.95; }
.flow-hi { stroke:var(--ak-flow-hi); stroke-width:1.6px; opacity:.0; transform:translate(-.8px,-1.1px); }
[data-flow].on .flow-base, [data-spur].on .flow-base { stroke:var(--ak-flow); opacity:1; }
[data-flow].on .flow-hi { opacity:.38; }
/* pathLength normalises every run to 1000 units, so a single pulse
   travels the whole line at the same speed no matter how long it is */
.flow-dash { stroke:#ffffff; opacity:0; stroke-dasharray:70 930; }
[data-flow].on.animated .flow-dash { opacity:.9; animation:ak-dash 2.6s linear infinite; }
[data-flow].on.animated.rev .flow-dash { animation-direction:reverse; }
@keyframes ak-dash { from { stroke-dashoffset:1000; } to { stroke-dashoffset:0; } }
@media (prefers-reduced-motion:reduce) {
  .flow-dash { animation:none !important; opacity:0 !important; }
}
`;

/* ------------------------------------------------------------------ *
 * The card
 * ------------------------------------------------------------------ */

interface SystemReading {
  label: string;
  solar: number | null;
  /** the four MPPT inputs of this solarbank, in order */
  inputs: Array<{ entity?: string; value: number | null }>;
  grid: number | null;
  home: number | null;
  soc: number | null;
  battery: number | null;
  output: number | null;
  pvToHome: number | null;
  pvToBattery: number | null;
  batteryToHome: number | null;
  gridToBattery: number | null;
  gridToHome: number | null;
  homeToGrid: number | null;
}

const sumOf = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

const firstOf = (values: Array<number | null>): number | null =>
  values.find((v): v is number => v !== null) ?? null;

const meanOf = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};

class SonnendeckCard extends HTMLElement {
  private _config?: SonnendeckCardConfig;
  private _systems: SystemConfig[] = [];
  private _hass?: HassLike;
  private _root: ShadowRoot;
  private _builtKey = '';
  private _els: Record<string, Element | null> = {};

  private _devices?: Record<string, DeviceEntry>;
  private _devicesPending = false;
  private _discovered = new Map<string, EntityMap>();
  private _registryRef?: unknown;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
  }

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_NAME);
  }

  /**
   * Pre-fill every Anker system that already exists. A system device is
   * recognised by any of the sensors that only ever live on one — hanging
   * this on a single key missed systems without a smart meter.
   */
  static getStubConfig(hass: HassLike): SonnendeckCardConfig {
    const reg = hass?.entities ?? {};
    const marks = new Set([
      'home_load_power',
      'solarbank_state_of_charge',
      'solarbank_output_power',
      'solarbank_input_power',
      'solarbank_battery_power_signed',
      'grid_power_signed',
    ]);
    const systems: SystemConfig[] = [];
    const seen = new Set<string>();
    for (const entry of Object.values(reg)) {
      if (entry.platform !== 'anker_solix') continue;
      if (!entry.translation_key || !marks.has(entry.translation_key)) continue;
      if (!entry.device_id || seen.has(entry.device_id)) continue;
      seen.add(entry.device_id);
      systems.push({ device: entry.device_id });
    }
    return {
      type: `custom:${CARD_NAME}`,
      systems: systems.length ? systems : [{}],
      animation: true,
    };
  }

  public setConfig(config: SonnendeckCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    this._config = { animation: true, kw_threshold: 0, ...config };

    const clean = (m?: EntityMap): EntityMap =>
      Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => !!v)) as EntityMap;

    this._systems = config.systems?.length
      ? config.systems.map((s) => ({ ...s, entities: clean(s.entities) }))
      : [
          {
            device: config.device,
            name: config.title,
            device_name: config.device_name,
            entities: clean(config.entities),
          },
        ];

    this._discovered.clear();
    this._builtKey = '';
    this._root.innerHTML = '';
    this._render();
  }

  public set hass(hass: HassLike) {
    const previous = this._hass;
    this._hass = hass;
    if (hass.entities !== this._registryRef) {
      this._registryRef = hass.entities;
      this._discovered.clear();
    }
    if (previous && !this._statesChanged(previous, hass)) return;
    this._render();
  }

  public get hass(): HassLike | undefined {
    return this._hass;
  }

  public getCardSize(): number {
    return 9;
  }

  public getLayoutOptions(): Record<string, number> {
    // the parking bay makes the card wider, so it needs fewer rows
    return this._hasEv
      ? { grid_rows: 8, grid_columns: 12, grid_min_rows: 6 }
      : { grid_rows: 9, grid_columns: 6, grid_min_rows: 7 };
  }

  private _statesChanged(a: HassLike, b: HassLike): boolean {
    for (const id of Object.values(this._config?.house ?? {})) {
      if (id && a.states[id] !== b.states[id]) return true;
    }
    for (const id of Object.values(this._wallbox())) {
      if (id && a.states[id] !== b.states[id]) return true;
    }
    for (const sys of this._systems) {
      for (const id of Object.values(this._entities(sys))) {
        if (id && a.states[id] !== b.states[id]) return true;
      }
    }
    return a.themes?.darkMode !== b.themes?.darkMode;
  }

  /* --------------------------- discovery --------------------------- */

  private _ensureDevices(): void {
    if (this._devices || this._devicesPending || !this._hass?.callWS) return;
    if (!this._systems.some((s) => s.device)) return;
    this._devicesPending = true;
    this._hass
      .callWS<DeviceEntry[]>({ type: 'config/device_registry/list' })
      .then((list) => {
        this._devices = Object.fromEntries(list.map((d) => [d.id, d]));
      })
      .catch(() => {
        this._devices = {};
      })
      .then(() => {
        this._devicesPending = false;
        this._discovered.clear();
        this._render();
      });
  }

  private _scope(deviceId: string): Set<string> {
    const ids = new Set<string>([deviceId]);
    for (const d of Object.values(this._devices ?? {})) {
      if (d.via_device_id === deviceId) ids.add(d.id);
    }
    return ids;
  }

  private _discover(deviceId: string): EntityMap {
    const cached = this._discovered.get(deviceId);
    if (cached) return cached;
    const hass = this._hass;
    if (!hass) return {};

    let map = resolveRoles(hass, entitiesOfDevices(hass, this._scope(deviceId)));
    const parent = this._devices?.[deviceId]?.via_device_id;
    if (parent && SYSTEM_ROLES.every((role) => !map[role])) {
      const wider = resolveRoles(hass, entitiesOfDevices(hass, this._scope(parent)));
      map = { ...wider, ...map };
    }
    this._discovered.set(deviceId, map);
    return map;
  }

  private _entities(sys: SystemConfig): EntityMap {
    if (!sys.device || !this._hass) return sys.entities ?? {};
    return { ...this._discover(sys.device), ...(sys.entities ?? {}) };
  }

  private _deviceLabel(deviceId?: string): string | undefined {
    if (!deviceId) return undefined;
    const d = this._devices?.[deviceId] ?? this._hass?.devices?.[deviceId];
    return d?.name_by_user || d?.name || undefined;
  }

  /** the storage cabinet of a system — the solarbank, not the system itself */
  private _storageLabel(sys: SystemConfig, index: number): string {
    if (sys.device_name) return sys.device_name;
    if (sys.device && this._devices) {
      const children = Object.values(this._devices).filter((d) => d.via_device_id === sys.device);
      const hit =
        children.find((d) =>
          /solarbank|power\s?dock|combiner/i.test(`${d.name_by_user ?? ''} ${d.name ?? ''} ${d.model ?? ''}`),
        ) ?? children[0];
      const label = hit?.name_by_user || hit?.name;
      if (label) return label;
    }
    return sys.name || this._deviceLabel(sys.device) || `${t(this._lang, 'system')} ${index + 1}`;
  }

  /** a Power Dock takes over charge and discharge across the storages */
  private _hasDock(): boolean {
    if (!this._devices) return false;
    const systemIds = new Set(this._systems.map((s) => s.device).filter(Boolean));
    return Object.values(this._devices).some(
      (d) =>
        d.via_device_id &&
        systemIds.has(d.via_device_id) &&
        /power\s?dock|combiner/i.test(`${d.name_by_user ?? ''} ${d.name ?? ''} ${d.model ?? ''}`),
    );
  }

  private get _lang(): string | undefined {
    return this._hass?.locale?.language ?? this._hass?.language;
  }

  /* ----------------------------- data ------------------------------ */

  private _readSystem(sys: SystemConfig, index: number): SystemReading {
    const e = this._entities(sys);
    const h = this._hass;
    const gridSign = this._config?.invert_grid ? -1 : 1;
    const battSign = this._config?.invert_battery ? -1 : 1;

    // every solarbank has four MPPT inputs, so every solarbank gets four
    // slots — an input without a sensor simply stays dark
    const inputIds = [e.solar_1, e.solar_2, e.solar_3, e.solar_4];
    const hasStrings = inputIds.some(Boolean);
    const inputs: Array<{ entity?: string; value: number | null }> = inputIds.map((entity) => ({
      entity,
      value: entity ? readNumber(h, entity) : null,
    }));

    let solar = readNumber(h, e.solar);
    if (solar === null && hasStrings) solar = sumOf(inputs.map((i) => i.value));

    // without per string sensors the whole block follows the total
    if (!hasStrings) {
      for (const slot of inputs) {
        slot.entity = e.solar;
        slot.value = solar;
      }
    }

    const gridToHome = readNumber(h, e.grid_to_home);
    const homeToGrid = readNumber(h, e.home_to_grid);
    let grid = readNumber(h, e.grid);
    if (grid !== null) grid *= gridSign;
    else if (gridToHome !== null || homeToGrid !== null) grid = (gridToHome ?? 0) - (homeToGrid ?? 0);

    const battery = readNumber(h, e.battery_power);

    return {
      label: this._storageLabel(sys, index),
      solar,
      inputs,
      grid,
      home: readNumber(h, e.home),
      soc: readNumber(h, e.battery_soc),
      battery: battery === null ? null : battery * battSign,
      output: readNumber(h, e.output),
      pvToHome: readNumber(h, e.pv_to_home),
      pvToBattery: readNumber(h, e.pv_to_battery),
      batteryToHome: readNumber(h, e.battery_to_home),
      gridToBattery: readNumber(h, e.grid_to_battery),
      gridToHome,
      homeToGrid,
    };
  }

  private _readAll(): SystemReading[] {
    return this._systems.map((s, i) => this._readSystem(s, i));
  }

  /**
   * The meter is the authority on the grid. The house load is a balance,
   * not a measurement:
   *
   *   Hauslast = was die Solarbanks ins Hausnetz abgeben
   *              + Netzbezug − Einspeisung
   *
   * At one meter point import and export exclude each other, so the two
   * terms never both contribute. A dedicated load sensor still wins if one
   * is configured.
   */
  private _readHouse(
    acTotal: number | null,
    evPower: number | null,
  ): { grid: number | null; load: number | null; computed: boolean } {
    const h = this._config?.house ?? {};
    const hass = this._hass;
    const imp = readNumber(hass, h.grid_import);
    const exp = readNumber(hass, h.grid_export);

    let grid = readNumber(hass, h.grid);
    if (grid !== null) grid *= this._config?.invert_grid ? -1 : 1;
    else if (imp !== null || exp !== null) grid = (imp ?? 0) - (exp ?? 0);

    const given = readNumber(hass, h.load);
    if (given !== null) return { grid, load: given, computed: false };
    if (grid === null) return { grid, load: null, computed: false };

    // the car sits behind the meter, so the balance counts it — take it
    // back out so "Hauslast" means the household, not household plus car
    const inLoad = this._config?.wallbox?.in_home_load !== false;
    const car = inLoad ? (evPower ?? 0) : 0;
    const load = (acTotal ?? 0) + grid - car;
    return { grid, load: load > 0 ? load : 0, computed: true };
  }

  /** resolve the charger's entities from its device, then apply overrides */
  private _wallbox(): WallboxConfig {
    const w = this._config?.wallbox;
    if (!w) return {};
    if (!w.device || !this._hass) return w;
    const ids = entitiesOfDevices(this._hass, this._scope(w.device));
    const reg = this._hass.entities ?? {};
    const found: Record<string, string> = {};
    for (const [role, keys] of Object.entries(EV_KEYS)) {
      const hit = ids.find((id) => {
        const k = reg[id]?.translation_key;
        return !!k && keys.includes(k);
      });
      if (hit) found[role] = hit;
    }
    return { ...found, ...w };
  }

  /** charging power in W, summed over the phases when needed */
  private _evPower(): number | null {
    const w = this._wallbox();
    const direct = readNumber(this._hass, w.power);
    if (direct !== null) return direct;
    const phases = [w.power_l1, w.power_l2, w.power_l3]
      .map((id) => readNumber(this._hass, id))
      .filter((v): v is number => v !== null);
    return phases.length ? phases.reduce((a, b) => a + b, 0) : null;
  }

  private get _hasEv(): boolean {
    const w = this._config?.wallbox;
    return !!(w && (w.device || w.power || w.power_l1 || w.power_l2 || w.power_l3));
  }

  /** house meter entities whose unit makes them unusable */
  private _meterWarnings(): string[] {
    const h = this._config?.house ?? {};
    const out: string[] = [];
    for (const id of [h.grid, h.grid_import, h.grid_export, h.load]) {
      if (!id) continue;
      const unit = unitOf(this._hass, id);
      if (ENERGY_UNITS.has(unit)) out.push(`${id} (${unit})`);
    }
    return out;
  }

  /**
   * Signed AC line between a solarbank and the house: + feeds the house,
   * − means the house or the grid is charging the storage.
   *
   * This is the inverter's output, so it carries solar going straight to
   * the house as well as anything coming out of the battery. Reading only
   * `battery_to_home` would leave the line dead on a sunny day when the
   * storage is charging and the panels supply the house directly.
   */
  private _acOf(r: SystemReading): number | null {
    const charge = r.gridToBattery ?? 0;
    if (r.output !== null) return r.output - charge;
    if (r.pvToHome !== null || r.batteryToHome !== null) {
      return (r.pvToHome ?? 0) + (r.batteryToHome ?? 0) - charge;
    }
    return r.battery === null ? null : -r.battery;
  }

  /* ---------------------------- rendering -------------------------- */

  private _build(panels: number, units: number, ev: boolean, evOnDock: boolean): void {
    this._root.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = STYLE;

    const card = document.createElement('ha-card');
    card.innerHTML = `
      <h2 class="title" id="ak-title" hidden></h2>
      <div class="scene">${sceneMarkup(panels, units, ev, evOnDock)}</div>
      <div class="hint" id="ak-hint" hidden></div>
    `;
    this._root.append(style, card);

    const q = (id: string) => this._root.getElementById(id);
    this._els = {
      title: q('ak-title'),
      hint: q('ak-hint'),
      chips: q('ak-chips'),
      solarCap: q('ak-solar-cap'),
      solarVal: q('ak-solar-val'),
      solarChev: q('ak-solar-chev'),
      gridCap: q('ak-grid-cap'),
      gridVal: q('ak-grid-val'),
      homeCap: q('ak-home-cap'),
      homeVal: q('ak-home-val'),
      storeCap: q('ak-store-cap'),
      storeVal: q('ak-store-val'),
      storeArrow: q('ak-store-arrow'),
    };

    card.querySelectorAll<SVGGElement>('g[data-tap]').forEach((g) => {
      g.addEventListener('click', () => this._onTap(g.dataset.tap as string));
    });
    card.querySelectorAll<SVGGElement>('g[data-unit]').forEach((g) => {
      g.addEventListener('click', () => this._onUnitTap(Number(g.dataset.unit)));
    });
    card.querySelectorAll<SVGGElement>('g[data-pv]').forEach((g) => {
      g.addEventListener('click', () => this._onPvTap(Number(g.dataset.pv)));
    });

    this._builtKey = `${panels}:${units}:${ev}:${evOnDock}`;
  }

  private _more(id?: string): void {
    if (!id) return;
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId: id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The entity behind a headline, or undefined when there is none to show.
   *
   * The four corner readouts are sums over every system. With more than one
   * system there is no single entity behind them, so opening system 1 would
   * answer a question nobody asked — the per-cabinet chips are the way into
   * an individual system. Grid and home stay tappable whenever the house
   * meter supplies them, because that really is one entity.
   */
  private _tapEntity(kind: string): string | undefined {
    const multi = this._systems.length > 1;
    const first = this._systems[0] ?? {};
    const e = this._entities(first);
    const h = this._config?.house ?? {};
    switch (kind) {
      case 'ev': {
        const w = this._wallbox();
        return w.status ?? w.power ?? w.power_l1;
      }
      case 'solar':
        return multi ? undefined : e.solar ?? e.solar_1;
      case 'battery':
        return multi ? undefined : e.battery_soc ?? e.battery_power;
      case 'grid':
        return h.grid ?? h.grid_import ?? (multi ? undefined : e.grid ?? e.grid_to_home);
      case 'home':
        return h.load ?? (multi ? undefined : e.home);
      default:
        return undefined;
    }
  }

  private _onTap(kind: string): void {
    const id = this._tapEntity(kind);
    if (id) this._more(id);
  }

  private _onUnitTap(i: number): void {
    const sys = this._systems[i];
    if (!sys) return;
    const e = this._entities(sys);
    this._more(e.battery_soc ?? e.battery_power ?? e.output);
  }

  private _onPvTap(i: number): void {
    const all = this._readAll().flatMap((r) => r.inputs);
    this._more(all[i]?.entity);
  }

  private _render(): void {
    if (!this._config) return;
    this._ensureDevices();
    if (!this._hass) {
      if (!this._builtKey) this._build(1, 1, false, false);
      return;
    }

    const cfg = this._config;
    const lang = this._lang;
    const kw = cfg.kw_threshold ?? 0;
    const readings = this._readAll();

    const inputs = readings.flatMap((r) => r.inputs);
    const display = cfg.storage_display ?? 'auto';
    const combined =
      display === 'combined' || (display === 'auto' && (!!cfg.dock || this._hasDock()));
    const blocks = Math.min(Math.max(readings.length, 1), 4);
    const units = combined ? 1 : blocks;

    const ev = this._hasEv;
    const evOnDock = (cfg.wallbox?.source ?? (combined ? 'dock' : 'house')) === 'dock';
    const key = `${blocks}:${units}:${ev}:${evOnDock}`;
    if (key !== this._builtKey) this._build(blocks, units, ev, evOnDock);

    const mode = cfg.dark_mode ?? 'auto';
    const dark =
      mode === 'dark' ||
      (mode === 'auto' &&
        (this._hass.themes?.darkMode ??
          window.matchMedia?.('(prefers-color-scheme: dark)').matches ??
          false));
    this.toggleAttribute('dark', dark);

    const setText = (k: string, v: string) => {
      const el = this._els[k];
      if (el) el.textContent = v;
    };

    /* title and empty state */
    const title = this._els.title as HTMLElement | null;
    if (title) {
      title.toggleAttribute('hidden', !cfg.title);
      if (cfg.title) title.textContent = cfg.title;
    }

    /* aggregate */
    const solarTotal = sumOf(readings.map((r) => r.solar));
    const gridMode = cfg.combine?.grid ?? 'primary';
    const homeMode = cfg.combine?.home ?? 'primary';
    const acTotal = sumOf(readings.map((r) => this._acOf(r)));
    const evPower = ev ? this._evPower() : null;
    const house = this._readHouse(acTotal, evPower);
    const gridTotal =
      house.grid ??
      (gridMode === 'sum' ? sumOf(readings.map((r) => r.grid)) : firstOf(readings.map((r) => r.grid)));
    const homeTotal =
      house.load ??
      (homeMode === 'sum' ? sumOf(readings.map((r) => r.home)) : firstOf(readings.map((r) => r.home)));
    // a working house meter must not mask a system that reports nothing
    const systemsEmpty = !readings.some((r) =>
      [r.solar, r.soc, r.battery, r.output].some((v) => v !== null),
    );
    const warnings = this._meterWarnings();
    const hintText = warnings.length
      ? `${t(lang, 'bad_unit')} ${warnings.join(', ')}`
      : systemsEmpty
        ? t(lang, 'pick_device')
        : '';
    const hint = this._els.hint as HTMLElement | null;
    if (hint) {
      hint.toggleAttribute('hidden', !hintText);
      hint.textContent = hintText;
    }

    const socAvg = meanOf(readings.map((r) => r.soc));
    const batteryTotal = sumOf(readings.map((r) => r.battery));

    /* readouts */
    setText('solarCap', cfg.labels?.solar ?? t(lang, 'solar'));
    setText('solarVal', fmtPower(solarTotal, kw));
    // with several systems the headline is a sum — a chevron would promise
    // a drill-down into one of them, which is exactly the wrong impression
    const solarChev = this._els.solarChev as SVGElement | null;
    if (solarChev) solarChev.setAttribute('opacity', readings.length === 1 && inputs.some((i) => i.entity) ? '1' : '0');

    setText('gridCap', cfg.labels?.grid ?? t(lang, 'grid'));
    setText('gridVal', fmtPower(gridTotal === null ? null : Math.abs(gridTotal), kw));

    setText('homeCap', cfg.labels?.home ?? t(lang, 'home'));
    setText('homeVal', fmtPower(homeTotal, kw));

    // the arrow alone is easy to miss, so the caption says it in words:
    // the watts are the flow into (lädt) or out of (entlädt) the batteries
    const charging = (batteryTotal ?? 0) > EPS;
    const moving = Math.abs(batteryTotal ?? 0) > EPS;
    const dir = batteryTotal === null ? '' : moving ? t(lang, charging ? 'charging' : 'discharging') : t(lang, 'idle');
    setText('storeCap', dir ? `${t(lang, 'storage')} · ${dir}` : t(lang, 'storage'));
    setText(
      'storeVal',
      `${fmtPct(socAvg)} · ${fmtPower(batteryTotal === null ? null : Math.abs(batteryTotal), kw)}`,
    );
    const arrow = this._els.storeArrow as SVGPathElement | null;
    if (arrow) {
      arrow.setAttribute(
        'd',
        charging
          ? 'M88 1000 L88 958 M75 971 L88 958 L101 971'
          : 'M88 958 L88 1000 M75 987 L88 1000 L101 987',
      );
      arrow.classList.toggle('idle', !charging);
    }

    // a pointer cursor on a readout that opens nothing is a broken promise
    this._root.querySelectorAll<SVGGElement>('g.tap').forEach((g) => {
      g.classList.toggle('dead', !this._tapEntity(g.dataset.tap as string));
    });

    /* per module state */
    this._root.querySelectorAll<SVGGElement>('g[data-pv]').forEach((g) => {
      const v = inputs[Number(g.dataset.pv)]?.value;
      g.classList.toggle('off', v === null || v <= EPS);
    });

    /* per storage chips, plus the charger */
    this._paintChips(readings, combined, units, evPower);
    this._root.querySelectorAll<SVGGElement>('g.car, g.wallbox').forEach((g) => {
      g.classList.toggle('charging', (evPower ?? 0) > EPS);
    });

    /* flows */
    const states: Record<string, { active: boolean; reverse: boolean }> = {
      batteryToHome: { active: Math.abs(acTotal ?? 0) > EPS, reverse: (acTotal ?? 0) < 0 },
      gridToHome: { active: Math.abs(gridTotal ?? 0) > EPS, reverse: (gridTotal ?? 0) < 0 },
      ev: { active: (evPower ?? 0) > EPS, reverse: false },
    };
    for (let i = 0; i < blocks; i++) {
      states[`pv${i}`] = { active: (readings[i]?.solar ?? 0) > EPS, reverse: false };
    }
    for (let i = 0; i < units; i++) {
      const ac = combined ? acTotal : this._acOf(readings[i] ?? ({} as SystemReading));
      states[`ac${i}`] = { active: Math.abs(ac ?? 0) > EPS, reverse: (ac ?? 0) < 0 };
    }
    const animate = cfg.animation !== false;
    this._root.querySelectorAll<SVGGElement>('g[data-flow]').forEach((g) => {
      const s = states[g.dataset.flow as string];
      if (!s) return;
      g.classList.toggle('on', s.active);
      g.classList.toggle('rev', s.reverse);
      g.classList.toggle('animated', animate);
    });
    // the light strip on each cabinet carries its own direction
    this._root.querySelectorAll<SVGGElement>('g[data-unit]').forEach((g) => {
      const i = Number(g.dataset.unit);
      const power = combined ? batteryTotal : (readings[i]?.battery ?? null);
      g.classList.toggle('charging', (power ?? 0) > EPS);
      g.classList.toggle('idle', Math.abs(power ?? 0) <= EPS);
    });

    this._placeChevron();
    requestAnimationFrame(() => this._placeChevron());
  }

  /** the small state-of-charge pill under every cabinet */
  private _paintChips(
    readings: SystemReading[],
    combined: boolean,
    units: number,
    evPower: number | null,
  ): void {
    const host = this._els.chips as SVGGElement | null;
    if (!host) return;
    host.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';

    // with a dock the cabinets merge into one, but every storage keeps
    // its own state of charge — so the pills line up above the dock
    const entries = readings.map((r) => ({ soc: r.soc, power: r.battery }));
    const spread = 82;
    const [dockX, dockY] = chipAnchor(0, units);

    entries.forEach((entry, i) => {
      if (entry.soc === null && entry.power === null) return;
      const [cx, cy] = combined
        ? [dockX + (i - (entries.length - 1) / 2) * spread, dockY]
        : chipAnchor(i, units);
      const label = fmtPct(entry.soc);
      const w = Math.max(76, label.length * 16 + 24);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'chip');
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', (cx - w / 2).toFixed(1));
      rect.setAttribute('y', (cy - 20).toFixed(1));
      rect.setAttribute('rx', '19');
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', '38');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', cx.toFixed(1));
      text.setAttribute('y', (cy + 8).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = label;
      g.append(rect, text);
      host.appendChild(g);
    });

    if (evPower !== null && Math.abs(evPower) > EPS) {
      const [cx, cy] = evChipAnchor();
      const label = fmtPower(Math.abs(evPower), Math.max(this._config?.kw_threshold ?? 0, 1000));
      const w = Math.max(84, label.length * 16 + 24);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'chip');
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', (cx - w / 2).toFixed(1));
      rect.setAttribute('y', (cy - 20).toFixed(1));
      rect.setAttribute('rx', '19');
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', '38');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', cx.toFixed(1));
      text.setAttribute('y', (cy + 8).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = label;
      g.append(rect, text);
      host.appendChild(g);
    }
  }

  private _placeChevron(): void {
    const chev = this._els.solarChev as SVGPathElement | null;
    const val = this._els.solarVal as SVGTextElement | null;
    if (!chev || !val) return;
    let width = 0;
    try {
      width = val.getComputedTextLength();
    } catch {
      width = 0;
    }
    if (!width) width = (val.textContent ?? '').length * 24;
    chev.setAttribute('transform', `translate(${(76 + width + 22 - 247).toFixed(1)},0)`);
  }

  public connectedCallback(): void {
    if (this._builtKey) requestAnimationFrame(() => this._placeChevron());
  }
}
/* ------------------------------------------------------------------ *
 * Visual editor
 * ------------------------------------------------------------------ */

const POWER_SELECTOR = { entity: { filter: { domain: ['sensor', 'number', 'input_number'] } } };

const SYSTEM_SCHEMA = [
  { name: 'device', selector: { device: { integration: 'anker_solix' } } },
  { name: 'name', selector: { text: {} } },
  { name: 'device_name', selector: { text: {} } },
  {
    name: 'entities',
    type: 'expandable',
    schema: [
      { name: 'solar', selector: POWER_SELECTOR },
      { name: 'solar_1', selector: POWER_SELECTOR },
      { name: 'solar_2', selector: POWER_SELECTOR },
      { name: 'solar_3', selector: POWER_SELECTOR },
      { name: 'solar_4', selector: POWER_SELECTOR },
      { name: 'grid', selector: POWER_SELECTOR },
      { name: 'home', selector: POWER_SELECTOR },
      { name: 'battery_soc', selector: POWER_SELECTOR },
      { name: 'battery_power', selector: POWER_SELECTOR },
      { name: 'output', selector: POWER_SELECTOR },
      { name: 'pv_to_home', selector: POWER_SELECTOR },
      { name: 'pv_to_battery', selector: POWER_SELECTOR },
      { name: 'battery_to_home', selector: POWER_SELECTOR },
      { name: 'grid_to_battery', selector: POWER_SELECTOR },
      { name: 'grid_to_home', selector: POWER_SELECTOR },
      { name: 'home_to_grid', selector: POWER_SELECTOR },
    ],
  },
];

const GLOBAL_SCHEMA = [
  { name: 'title', selector: { text: {} } },
  { name: 'dock', selector: { device: { integration: 'anker_solix' } } },
  {
    name: 'wallbox',
    type: 'expandable',
    schema: [
      { name: 'device', selector: { device: { integration: 'anker_solix' } } },
      { name: 'power', selector: POWER_SELECTOR },
      { name: 'power_l1', selector: POWER_SELECTOR },
      { name: 'power_l2', selector: POWER_SELECTOR },
      { name: 'power_l3', selector: POWER_SELECTOR },
      { name: 'status', selector: { entity: {} } },
      {
        name: 'source',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'dock', label: 'dock' },
              { value: 'house', label: 'house' },
            ],
          },
        },
      },
      { name: 'in_home_load', selector: { boolean: {} } },
    ],
  },
  {
    name: 'house',
    type: 'expandable',
    schema: [
      { name: 'grid', selector: POWER_SELECTOR },
      { name: 'grid_import', selector: POWER_SELECTOR },
      { name: 'grid_export', selector: POWER_SELECTOR },
      { name: 'load', selector: POWER_SELECTOR },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'invert_grid', selector: { boolean: {} } },
      { name: 'invert_battery', selector: { boolean: {} } },
      { name: 'animation', selector: { boolean: {} } },
    ],
  },
  { name: 'kw_threshold', selector: { number: { min: 0, max: 100000, step: 100, mode: 'box' } } },
  {
    name: 'storage_display',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'auto', label: 'auto' },
          { value: 'units', label: 'units' },
          { value: 'combined', label: 'combined' },
        ],
      },
    },
  },
  {
    name: 'combine',
    type: 'expandable',
    schema: [
      {
        name: 'grid',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'primary', label: 'primary' },
              { value: 'sum', label: 'sum' },
            ],
          },
        },
      },
      {
        name: 'home',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'primary', label: 'primary' },
              { value: 'sum', label: 'sum' },
            ],
          },
        },
      },
    ],
  },
  {
    name: 'dark_mode',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      },
    },
  },
];

const HELPERS: Record<string, Record<string, string>> = {
  de: {
    device:
      'Das Anker-System auswählen. Eine Solarbank geht auch — die Karte findet das System darüber selbst.',
    dock: 'Nur setzen, wenn ein Power Dock die Speicher steuert. Dann zeichnet die Karte einen Speicher statt mehrerer, die Ladestände bleiben einzeln sichtbar.',
    entities: 'Nur nötig, wenn die automatische Erkennung danebenliegt.',
    wallbox: 'Gerät wählen genügt — dann erscheinen Stellplatz, Auto und Wandladestation im Bild, und die Karte wird dafür breiter. Ohne Wallbox bleibt die Szene wie sie ist.',
    power: 'Nur nötig, wenn die Erkennung nichts findet. Sonst die drei Phasen einzeln angeben, sie werden addiert.',
    source: 'dock: die Leitung zweigt von der AC-Schiene ab, weil das Power Dock einen eigenen Anschluss für die Wallbox hat. house: sie geht vom Zählerkasten weg. Standard ist dock, sobald ein Dock eingetragen ist.',
    in_home_load: 'An lassen. Das Auto hängt hinter dem Zähler, steckt also in der Bilanz und wird abgezogen, damit „Hauslast" den Haushalt meint und nicht Haushalt plus Auto. Nur ausschalten, wenn dein Ausgangssensor das Auto schon nicht mitzählt.',
    house: 'Der Zähler gehört zum Haus, nicht zu einer Solarbank — was hier steht, gewinnt gegen die Werte aus den Systemen. Entweder einen vorzeichenbehafteten Netzsensor, oder Bezug und Einspeisung getrennt.',
    grid_import: 'Momentanleistung in Watt, nicht der kWh-Zählerstand.',
    grid_export: 'Momentanleistung in Watt, nicht der kWh-Zählerstand.',
    load: 'Am besten leer lassen. Die Karte rechnet die Hauslast dann aus: was die Solarbanks ins Hausnetz abgeben, plus Netzbezug, minus Einspeisung.',
    storage_display:
      'auto folgt dem Power Dock, units zeichnet je System einen Speicher, combined immer einen.',
    combine:
      'Zwei Systeme im selben Haus lesen meist denselben Zähler. primary nimmt den Wert vom ersten System, sum addiert alle.',
    kw_threshold: 'Zum Beispiel 1000, damit aus 2480 W ein 2.48 kW wird.',
    name: 'Nur ein Fallback, falls kein Gerätename gefunden wird.',
    device_name: 'Standard ist der Name der Solarbank aus der Geräte-Registry.',
  },
  en: {
    device: 'Pick the Anker system. A solarbank works too — the card walks up to its system.',
    dock: 'Only set this when a Power Dock manages the storages. The card then draws one cabinet instead of several, the states of charge stay separate.',
    entities: 'Only needed when the automatic discovery gets something wrong.',
    wallbox: 'Picking the device is enough — the parking bay, the car and the charger appear and the scene widens for them. Without a charger the scene stays as it is.',
    power: 'Only needed when discovery finds nothing. Otherwise give the three phases, they are summed.',
    source: 'dock: the cable branches off the AC rail, because the Power Dock has its own port for the charger. house: it leaves the distribution board. Defaults to dock once a dock is configured.',
    in_home_load: 'Leave it on. The car sits behind the meter, so the balance counts it and it is taken back out — that way "home load" means the household, not household plus car. Turn it off only if your output sensor already excludes the car.',
    house: 'The meter belongs to the house, not to a solarbank — what you set here wins over the systems. Either one signed grid sensor, or import and export separately.',
    grid_import: 'Instantaneous power in watts, not the kWh meter reading.',
    grid_export: 'Instantaneous power in watts, not the kWh meter reading.',
    load: 'Best left empty. The card then works the house load out: what the solarbanks feed into the house, plus grid import, minus export.',
    storage_display:
      'auto follows the Power Dock, units draws one cabinet per system, combined always one.',
    combine:
      'Two systems in one house usually read the same meter. primary takes the value from the first system, sum adds them all up.',
    kw_threshold: 'For example 1000, so that 2480 W becomes 2.48 kW.',
    name: 'Only a fallback for when no device name is found.',
    device_name: 'Defaults to the name of the solarbank from the device registry.',
  },
};

const LABELS: Record<string, Record<string, string>> = {
  de: {
    device: 'Anker-System (Gerät)',
    name: 'Anzeigename im Umschalter',
    device_name: 'Beschriftung unter dem Speicher',
    entities: 'Entitäten manuell überschreiben',
    solar: 'PV gesamt',
    solar_1: 'PV 1',
    solar_2: 'PV 2',
    solar_3: 'PV 3',
    solar_4: 'PV 4',
    grid: 'Netz (+ Bezug / − Einspeisung)',
    home: 'Hauslast',
    battery_soc: 'Ladestand (%)',
    battery_power: 'Batterieleistung (+ laden)',
    output: 'Ausgangsleistung zum Haus',
    pv_to_home: 'PV → Haus',
    pv_to_battery: 'PV → Speicher',
    battery_to_home: 'Speicher → Haus',
    grid_to_battery: 'Netz → Speicher',
    grid_to_home: 'Netz → Haus',
    home_to_grid: 'Einspeisung',
    title: 'Kartentitel',
    storage_display: 'Speicher zeichnen als',
    combine: 'Netz und Hauslast zusammenführen',
    invert_grid: 'Netz-Vorzeichen drehen',
    invert_battery: 'Batterie-Vorzeichen drehen',
    animation: 'Flussanimation',
    dock: 'Power Dock (Gerät)',
    house: 'Hauszähler',
    wallbox: 'Wallbox und Auto',
    power: 'Ladeleistung (W)',
    power_l1: 'Ladeleistung L1 (W)',
    power_l2: 'Ladeleistung L2 (W)',
    power_l3: 'Ladeleistung L3 (W)',
    status: 'Status der Wallbox',
    source: 'Angeschlossen an',
    in_home_load: 'Ladeleistung steckt in der Hauslast',
    grid_import: 'Netzbezug (W) — z. B. Tasmota SML_in',
    grid_export: 'Einspeisung (W) — z. B. Tasmota SML_out',
    load: 'Hausverbrauch (W) — optional',
    kw_threshold: 'kW ab … W (0 = immer W)',
    dark_mode: 'Farbschema',
    add: '+ System hinzufügen',
    remove: 'System entfernen',
    system: 'System',
    auto_hint:
      'Gerät wählen genügt — die Sensoren werden aus der Entity-Registry gelesen, auch für später ergänzte Solarbanks oder ein Power Dock.',
  },
  en: {
    device: 'Anker system (device)',
    name: 'Label in the switcher',
    device_name: 'Label below the storage',
    entities: 'Override entities manually',
    solar: 'PV total',
    solar_1: 'PV 1',
    solar_2: 'PV 2',
    solar_3: 'PV 3',
    solar_4: 'PV 4',
    grid: 'Grid (+ import / − export)',
    home: 'Home load',
    battery_soc: 'State of charge (%)',
    battery_power: 'Battery power (+ charging)',
    output: 'Output power to the house',
    pv_to_home: 'PV → home',
    pv_to_battery: 'PV → storage',
    battery_to_home: 'Storage → home',
    grid_to_battery: 'Grid → storage',
    grid_to_home: 'Grid → home',
    home_to_grid: 'Export',
    title: 'Card title',
    storage_display: 'Draw storages as',
    combine: 'Combining grid and home load',
    invert_grid: 'Invert grid sign',
    invert_battery: 'Invert battery sign',
    animation: 'Flow animation',
    dock: 'Power Dock (device)',
    house: 'House meter',
    wallbox: 'Wall charger and car',
    power: 'Charging power (W)',
    power_l1: 'Charging power L1 (W)',
    power_l2: 'Charging power L2 (W)',
    power_l3: 'Charging power L3 (W)',
    status: 'Charger status',
    source: 'Connected to',
    in_home_load: 'Charging power is part of the house load',
    grid_import: 'Grid import (W) — e.g. Tasmota SML_in',
    grid_export: 'Grid export (W) — e.g. Tasmota SML_out',
    load: 'House consumption (W) — optional',
    kw_threshold: 'kW above … W (0 = always W)',
    dark_mode: 'Colour scheme',
    add: '+ Add system',
    remove: 'Remove system',
    system: 'System',
    auto_hint:
      'Picking the device is enough — the sensors are read from the entity registry, including solarbanks or a Power Dock added later.',
  },
};

const EDITOR_STYLE = `
:host { display:block; }
.hint { font-size:.85rem; color:var(--secondary-text-color); margin:0 0 12px; }
.system {
  border:1px solid var(--divider-color,#e0e0e0); border-radius:10px;
  padding:10px 12px; margin-bottom:12px;
}
.system-head {
  display:flex; align-items:center; justify-content:space-between;
  font-weight:500; margin-bottom:6px;
}
.remove {
  background:none; border:none; cursor:pointer; font-size:1rem; line-height:1;
  color:var(--secondary-text-color); padding:4px 6px; border-radius:6px;
}
.remove:hover { color:var(--error-color,#db4437); background:var(--secondary-background-color,#f0f0f0); }
.add {
  background:none; border:1px dashed var(--divider-color,#bbb); border-radius:10px;
  color:var(--primary-color); cursor:pointer; padding:10px 12px; width:100%;
  font:inherit; margin-bottom:16px;
}
.add:hover { background:var(--secondary-background-color,#f5f5f5); }
`;

class SonnendeckCardEditor extends HTMLElement {
  private _config: SonnendeckCardConfig = { type: `custom:${CARD_NAME}`, systems: [{}] };
  private _hass?: HassLike;
  private _root: ShadowRoot;
  private _built = false;
  private _systemsHost?: HTMLElement;
  private _globalForm?: HTMLElement & Record<string, unknown>;
  private _rowCount = -1;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
  }

  public setConfig(config: SonnendeckCardConfig): void {
    const systems: SystemConfig[] = config.systems?.length
      ? config.systems
      : [{ device: config.device, device_name: config.device_name, entities: config.entities }];
    this._config = { ...config, systems };
    delete this._config.device;
    delete this._config.entities;
    this._render();
  }

  public set hass(hass: HassLike) {
    this._hass = hass;
    this._render();
  }

  private get _german(): boolean {
    const lang = this._hass?.locale?.language ?? this._hass?.language ?? 'en';
    return lang.toLowerCase().startsWith('de');
  }

  private get _labels(): Record<string, string> {
    return this._german ? LABELS.de : LABELS.en;
  }

  private get _helpers(): Record<string, string> {
    return this._german ? HELPERS.de : HELPERS.en;
  }

  private _emit(next: SonnendeckCardConfig): void {
    this._config = next;
    this.dispatchEvent(
      new CustomEvent('config-changed', { detail: { config: next }, bubbles: true, composed: true }),
    );
    this._render();
  }

  private _build(): void {
    const style = document.createElement('style');
    style.textContent = EDITOR_STYLE;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = 'hint';
    const systems = document.createElement('div');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.addEventListener('click', () => {
      this._rowCount = -1;
      this._emit({ ...this._config, systems: [...(this._config.systems ?? []), {}] });
    });
    const global = document.createElement('ha-form') as HTMLElement & Record<string, unknown>;
    global.addEventListener('value-changed', (ev: Event) => {
      ev.stopPropagation();
      const value = (ev as CustomEvent).detail.value as SonnendeckCardConfig;
      this._emit({ ...this._config, ...value, systems: this._config.systems });
    });

    this._root.append(style, hint, systems, add, global);
    this._systemsHost = systems;
    this._globalForm = global;
    this._built = true;
  }

  private _buildRows(): void {
    const host = this._systemsHost;
    if (!host) return;
    host.innerHTML = '';
    const systems = this._config.systems ?? [];
    systems.forEach((_, i) => {
      const box = document.createElement('div');
      box.className = 'system';

      const head = document.createElement('div');
      head.className = 'system-head';
      const title = document.createElement('span');
      title.className = 'system-title';
      head.appendChild(title);

      if (systems.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'remove';
        del.textContent = '✕';
        del.addEventListener('click', () => {
          const next = (this._config.systems ?? []).filter((_, j) => j !== i);
          this._rowCount = -1;
          this._emit({ ...this._config, systems: next.length ? next : [{}] });
        });
        head.appendChild(del);
      }

      const form = document.createElement('ha-form') as HTMLElement & Record<string, unknown>;
      form.dataset.index = String(i);
      form.addEventListener('value-changed', (ev: Event) => {
        ev.stopPropagation();
        const value = (ev as CustomEvent).detail.value as SystemConfig;
        const entities = Object.fromEntries(
          Object.entries(value.entities ?? {}).filter(([, v]) => !!v),
        ) as EntityMap;
        const next = [...(this._config.systems ?? [])];
        next[i] = Object.keys(entities).length ? { ...value, entities } : { ...value, entities: undefined };
        this._emit({ ...this._config, systems: next });
      });

      box.append(head, form);
      host.appendChild(box);
    });
    this._rowCount = systems.length;
  }

  private _render(): void {
    if (!this._hass) return;
    if (!this._built) this._build();
    const labels = this._labels;
    const helpers = this._helpers;
    const systems = this._config.systems ?? [];

    const hint = this._root.getElementById('hint');
    if (hint) hint.textContent = labels.auto_hint;
    const add = this._root.querySelector('.add');
    if (add) add.textContent = labels.add;

    if (this._rowCount !== systems.length) this._buildRows();

    this._root.querySelectorAll<HTMLElement>('.system').forEach((box, i) => {
      const title = box.querySelector('.system-title');
      if (title) title.textContent = `${labels.system} ${i + 1}`;
      const form = box.querySelector('ha-form') as (HTMLElement & Record<string, unknown>) | null;
      if (!form) return;
      form.hass = this._hass;
      form.schema = SYSTEM_SCHEMA;
      form.data = systems[i] ?? {};
      form.computeLabel = (s: { name: string }) => labels[s.name] ?? s.name;
      form.computeHelper = (s: { name: string }) => helpers[s.name] ?? '';
    });

    if (this._globalForm) {
      this._globalForm.hass = this._hass;
      this._globalForm.schema = GLOBAL_SCHEMA;
      this._globalForm.data = this._config;
      this._globalForm.computeLabel = (s: { name: string }) => labels[s.name] ?? s.name;
      this._globalForm.computeHelper = (s: { name: string }) => helpers[s.name] ?? '';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

if (!customElements.get(CARD_NAME)) customElements.define(CARD_NAME, SonnendeckCard);
if (!customElements.get(EDITOR_NAME)) customElements.define(EDITOR_NAME, SonnendeckCardEditor);
if (!customElements.get(LEGACY_NAME)) {
  customElements.define(LEGACY_NAME, class extends SonnendeckCard {});
}

const w = window as unknown as { customCards?: unknown[] };
w.customCards = w.customCards || [];
w.customCards.push({
  type: CARD_NAME,
  name: 'Sonnendeck',
  description: 'Erzeugung, Speicher, Hauslast und Wallbox in einem isometrischen Bild',
  preview: true,
  documentationURL: 'https://github.com/dirknoelke/sonnendeck-card',
});

// eslint-disable-next-line no-console
console.info(
  `%c SONNENDECK %c ${CARD_VERSION} `,
  'color:#fff;background:#4b5f80;font-weight:700;border-radius:3px 0 0 3px',
  'color:#4b5f80;background:#e3edfa;font-weight:700;border-radius:0 3px 3px 0',
);

export { SonnendeckCard, SonnendeckCardEditor };
