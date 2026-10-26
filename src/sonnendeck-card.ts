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
  /** power at which a module is drawn fully sunlit, in W (default 400) */
  panel_peak?: number;
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
 * The scene
 *
 * The house, the roof modules and the devices are pictures; everything
 * that carries a state (module brightness, charge, cables, readouts) is
 * drawn on top of them. All positions below are in picture pixels of the
 * 1172 x 668 house image, and `at` maps them into the card.
 * ------------------------------------------------------------------ */

type Pt = [number, number];

const fp = (p: Pt): string => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
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

/** the house image, and where it sits in the card */
const PIC = { w: 1172, h: 668 };
const VIEW_W = 960;
const PLACE = { x: 23, y: 265, s: 0.78 };
const at = (x: number, y: number): Pt => [PLACE.x + x * PLACE.s, PLACE.y + y * PLACE.s];

/** the roof plane facing the camera, corners in picture pixels */
const ROOF = { tl: [192, 82], tr: [868, 8], br: [976, 174], bl: [290, 262] } as const;
const roofAt = (u: number, v: number): Pt => {
  const top: Pt = [ROOF.tl[0] + u * (ROOF.tr[0] - ROOF.tl[0]), ROOF.tl[1] + u * (ROOF.tr[1] - ROOF.tl[1])];
  const bot: Pt = [ROOF.bl[0] + u * (ROOF.br[0] - ROOF.bl[0]), ROOF.bl[1] + u * (ROOF.br[1] - ROOF.bl[1])];
  return [top[0] + v * (bot[0] - top[0]), top[1] + v * (bot[1] - top[1])];
};

/** the foot of the long wall rises to the right by this much per pixel */
const SLOPE = -0.099;
const baseY = (x: number): number => 607 + SLOPE * (x - 365);
/** the devices were drawn steeper than this wall; a shear lays them onto it */
const SHEAR = 0.09;

/** the AC cables run on the ground, parallel to the foot of the wall */
const RAIL_BAT = 16;
const RAIL_GRID = 34;

/** where the electrical centre of the wall is */
const WALL_MID = 570;
/** the house connection sits at the right end of the wall */
const CONN_X = 815;

/** a placed picture: x is the centre, y the bottom, in picture pixels */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** one block of four modules per solarbank, all in a row on the roof */
const slotPitch = (n: number): number => [0, 0, 190, 150, 100][Math.min(n, 4)];
const slotX = (i: number, n: number): number => WALL_MID + (i - (n - 1) / 2) * slotPitch(n);
const blockW = (n: number): number => [0, 190, 176, 136, 86][Math.min(n, 4)];

const BANK_ASPECT = 365 / 300;
const bankBox = (i: number, n: number): Box => {
  const x = slotX(i, n);
  const w = n >= 4 ? 92 : 100;
  return { x, y: baseY(x) - 10, w, h: w * BANK_ASPECT };
};
const DOCK_ASPECT = 418 / 420;
const dockBox = (): Box => ({ x: WALL_MID, y: baseY(WALL_MID) - 8, w: 150, h: 150 * DOCK_ASPECT });
const CONN_ASPECT = 370 / 300;
const connBox = (): Box => ({ x: CONN_X, y: baseY(CONN_X) - 4, w: 64, h: 64 * CONN_ASPECT });

/** the picture's top left corner in the card, as a matrix that also applies the shear */
const placeMatrix = (b: Box, naturalW: number): string => {
  const k = (b.w / naturalW) * PLACE.s;
  const [e, f] = at(b.x - b.w / 2, b.y - b.h - (SHEAR * b.w) / 2);
  return `matrix(${k.toFixed(4)} ${(SHEAR * k).toFixed(4)} 0 ${k.toFixed(4)} ${e.toFixed(1)} ${f.toFixed(1)})`;
};

/** a point on a placed picture, as relative coordinates (0..1) */
const onBox = (b: Box, rx: number, ry: number): Pt =>
  at(b.x - b.w / 2 + rx * b.w, b.y - b.h - (SHEAR * b.w) / 2 + ry * b.h + SHEAR * rx * b.w);

/** the white disc on a solarbank, where its charge is printed */
const bankDisc = (i: number, n: number): { c: Pt; size: number } => ({
  c: onBox(bankBox(i, n), 0.637, 0.619),
  size: bankBox(i, n).w * PLACE.s * 0.2,
});

/** the charge pills of a combined dock float above it */
const dockChipAnchor = (): Pt => at(dockBox().x, dockBox().y - dockBox().h - 44);

/** the charging-power pill sits above the garage door */
const evChipAnchor = (): Pt => at(1040, 360);

/** natural size of the module picture */
const PV_PIC = { w: 360, h: 219 };

/**
 * One block per solarbank, four modules each, one per input. The block's
 * bottom centre is where its cable leaves, straight down the wall; the
 * bank stands right below it. Every module is two stacked pictures: dark,
 * and sunlit on top, whose opacity follows the input's power.
 */
const BLOCK_V1 = 0.9;
const blockLayout = (s: number, n: number) => {
  const c = slotX(s, n);
  const bw = blockW(n);
  // solve for the roof coordinate whose bottom edge lands on x = c
  const x0 = (1 - BLOCK_V1) * ROOF.tl[0] + BLOCK_V1 * ROOF.bl[0];
  const run = (1 - BLOCK_V1) * (ROOF.tr[0] - ROOF.tl[0]) + BLOCK_V1 * (ROOF.br[0] - ROOF.bl[0]);
  const uc = (c - x0) / run;
  const du = bw / run;
  const gap = 6;
  const pw = (bw - gap) / 2;
  const ph = pw / 1.5;
  const roofH = 180;
  const vext = (2 * ph + gap) / roofH;
  return { uc, du, gap: gap / run, vext, v1: BLOCK_V1, gv: gap / roofH, exit: roofAt(uc, BLOCK_V1) };
};

const panelMarkup = (blocks: number): string => {
  let out = '';
  for (let s = 0; s < blocks; s++) {
    const b = blockLayout(s, blocks);
    const cw = (b.du - b.gap) / 2;
    const rh = (b.vext - b.gv) / 2;
    for (let k = 0; k < 4; k++) {
      const u0 = b.uc - b.du / 2 + (k % 2) * (cw + b.gap);
      const v0 = b.v1 - b.vext + Math.floor(k / 2) * (rh + b.gv);
      const tl = at(...roofAt(u0, v0));
      const tr = at(...roofAt(u0 + cw, v0));
      const bl = at(...roofAt(u0, v0 + rh));
      const m = [
        (tr[0] - tl[0]) / PV_PIC.w, (tr[1] - tl[1]) / PV_PIC.w,
        (bl[0] - tl[0]) / PV_PIC.h, (bl[1] - tl[1]) / PV_PIC.h,
        tl[0], tl[1],
      ].map((v) => v.toFixed(4)).join(' ');
      out += `<g class="pv" data-pv="${s * 4 + k}" style="--sun:0">` +
        `<use href="#ak-art-panel-dark" transform="matrix(${m})"/>` +
        `<use class="pv-sun" href="#ak-art-panel-sun" transform="matrix(${m})"/></g>`;
    }
  }
  return out;
};

/** a soft contact shadow, so nothing floats */
const footShadow = (b: Box): string => {
  const [cx, cy] = at(b.x + 4, b.y + 2);
  return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(b.w * PLACE.s * 0.62).toFixed(1)}" ry="${(b.w * PLACE.s * 0.13).toFixed(1)}" ` +
    `fill="var(--ak-shadow)" opacity=".28" filter="url(#ak-soft)"/>`;
};

/** several systems on one storage means the dock: it stands in the middle of the wall */
const isDock = (units: number, blocks: number): boolean => units === 1 && blocks > 1;
const storageBox = (i: number, units: number, blocks: number): Box =>
  isDock(units, blocks) ? dockBox() : bankBox(i, units);

const storageMarkup = (units: number, blocks: number): string => {
  let out = '';
  for (let i = 0; i < units; i++) {
    const combined = isDock(units, blocks);
    const b = storageBox(i, units, blocks);
    const [x0, y0] = at(b.x - b.w / 2, b.y - b.h);
    out += `<g class="unit${combined ? ' dock' : ''}" data-unit="${i}">` +
      footShadow(b) +
      `<use class="unit-img" href="#ak-art-${combined ? 'dock' : 'solarbank'}" transform="${placeMatrix(b, combined ? 420 : 300)}"/>` +
      `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(b.w * PLACE.s).toFixed(1)}" height="${(b.h * PLACE.s).toFixed(1)}" fill="transparent"/>` +
      `</g>`;
  }
  return out;
};

/* -------------------------------- flows -------------------------------- */

/** module block -> the solarbank underneath it, or the dock for all of them */
const flowPv = (s: number, units: number, blocks: number): string => {
  const exit = blockLayout(s, blocks).exit;
  const start: Pt = [exit[0], exit[1] - 2];
  if (units === blocks) {
    const b = bankBox(s, units);
    return line([at(...start), at(b.x, b.y - b.h + 5)]);
  }
  // one dock for everything: drop, run along a bus parallel to the wall, drop in
  const d = dockBox();
  const busY = (x: number): number => d.y - d.h - 20 + SLOPE * (x - d.x);
  return smooth([
    at(...start),
    at(start[0], busY(start[0])),
    at(d.x, busY(d.x)),
    at(d.x, d.y - d.h + 5),
  ], 10);
};

const railY = (x: number, off: number): number => baseY(x) + off;

/** a bank's foot down to the rail */
const flowStub = (i: number, units: number, blocks: number): string => {
  const b = storageBox(i, units, blocks);
  return line([at(b.x, b.y - 3), at(b.x, railY(b.x, RAIL_BAT))]);
};

/**
 * From the first bank along the rail to the house connection and up into
 * it. Every run follows an axis of the picture: straight down, or parallel
 * to the foot of the wall.
 */
const flowHome = (units: number, blocks: number): string => {
  const first = storageBox(0, units, blocks);
  const cb = connBox();
  const xr = cb.x - 14;
  return smooth([
    at(first.x, railY(first.x, RAIL_BAT) - 28),
    at(first.x, railY(first.x, RAIL_BAT)),
    at(xr, railY(xr, RAIL_BAT)),
    at(xr, cb.y - 3),
  ], 10);
};

/** the supply cable arrives along the ground from the right and rises into the connection */
const flowGrid = (): string => {
  const cb = connBox();
  const xr = cb.x + 14;
  return smooth([
    at(1230, railY(1230, RAIL_GRID)),
    at(xr, railY(xr, RAIL_GRID)),
    at(xr, cb.y - 3),
  ], 10);
};

/**
 * A cable is four strokes on one path: a soft shadow beneath it, the cable
 * itself, a thin highlight along its upper edge, and the travelling pulse.
 */
const flowPath = (cls: string, key: string, d: string): string =>
  `<g data-flow="${key}"><path class="flow-case" pathLength="1000" d="${d}"/>` +
  `<path class="flow-base" pathLength="1000" d="${d}"/>` +
  `<path class="flow-hi" pathLength="1000" d="${d}"/>` +
  `<path class="flow-dash ${cls}" pathLength="1000" d="${d}"/></g>`;

/* ------------------------------ the scene ------------------------------ */

const HOUSE_LAYERS = ['day-closed', 'day-car', 'night-closed', 'night-car'];

const sceneMarkup = (blocks: number, units: number, ev: boolean, _evOnDock: boolean): string => {
  const VW = VIEW_W;
  const RX = VW - 54; // right hand text anchor
  const G2 = 660; // second guide line
  // the storage caption carries the charge direction in words, so its column
  // needs a little more room than the solar one above it
  const GB = 356;
  const [gx, gy] = at(PIC.w / 2, 640);
  const [gx0, gy0] = at(930, 360);
  const cb = connBox();
  const [cx0, cy0] = at(cb.x - cb.w / 2, cb.y - cb.h);

  const defs = Object.entries(ART)
    .map(([k, href]) => {
      const nat = k.startsWith('house') ? PIC : k.startsWith('panel') ? PV_PIC
        : k === 'dock' ? { w: 420, h: 418 } : k === 'connection' ? { w: 300, h: 370 } : { w: 300, h: 365 };
      return `<image id="ak-art-${k}" width="${nat.w}" height="${nat.h}" href="${href}"/>`;
    }).join('');

  return `
<svg viewBox="0 0 ${VW} 1040" xmlns="http://www.w3.org/2000/svg" data-night="0" data-car="0">
  <defs>
    ${defs}
    <radialGradient id="ak-ground" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="var(--ak-ground-1)" stop-opacity=".85"/>
      <stop offset="1" stop-color="var(--ak-ground-2)" stop-opacity="0"/>
    </radialGradient>

    <!-- soft edges: contact shadows and clouds -->
    <filter id="ak-soft" x="-40%" y="-200%" width="180%" height="500%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="ak-soft-l" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="ak-cloud" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="15"/></filter>

    <!-- the light strip on a solarbank: grey at rest, warm while it discharges -->
    <filter id="ak-f-idle"><feColorMatrix type="saturate" values="0"/></filter>
    <filter id="ak-f-out"><feColorMatrix type="hueRotate" values="-80"/></filter>
  </defs>

  <ellipse cx="${gx.toFixed(0)}" cy="${(gy + 40).toFixed(0)}" rx="520" ry="150" fill="url(#ak-ground)"/>

  <!-- a few clouds, so the sky has depth behind the house -->
  <g class="clouds" filter="url(#ak-cloud)">
    <ellipse cx="150" cy="96" rx="120" ry="26"/><ellipse cx="236" cy="78" rx="84" ry="30"/><ellipse cx="300" cy="104" rx="90" ry="22"/>
    <ellipse cx="${VW - 300}" cy="150" rx="140" ry="30"/><ellipse cx="${VW - 200}" cy="130" rx="96" ry="34"/><ellipse cx="${VW - 130}" cy="158" rx="100" ry="24"/>
    <ellipse cx="${Math.round(VW / 2) - 40}" cy="262" rx="110" ry="22"/><ellipse cx="${Math.round(VW / 2) + 50}" cy="250" rx="80" ry="24"/>
  </g>

  <!-- a soft shadow all round the foot of the house -->
  <ellipse cx="${at(600, 600)[0].toFixed(0)}" cy="${at(600, 600)[1].toFixed(0)}" rx="${(PIC.w * PLACE.s * 0.5).toFixed(0)}" ry="46"
           fill="var(--ak-shadow)" opacity=".2" filter="url(#ak-soft-l)"/>

  <g class="house" transform="translate(${PLACE.x} ${PLACE.y}) scale(${PLACE.s})">
    ${HOUSE_LAYERS.map((k) => `<use class="house-layer h-${k}" href="#ak-art-house-${k}"/>`).join('')}
  </g>

  <g class="pv-array">${panelMarkup(blocks)}</g>

  <g class="storages">${storageMarkup(units, blocks)}</g>

  <g class="tap" data-tap="grid">
    ${footShadow(cb)}
    <use href="#ak-art-connection" transform="${placeMatrix(cb, 300)}"/>
    <rect x="${cx0.toFixed(1)}" y="${cy0.toFixed(1)}" width="${(cb.w * PLACE.s).toFixed(1)}" height="${(cb.h * PLACE.s).toFixed(1)}" fill="transparent"/>
  </g>

  <g class="flows dc" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: blocks }, (_, i) => flowPath('', `pv${i}`, flowPv(i, units, blocks))).join('')}
  </g>

  <g class="flows ac" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: units }, (_, i) => flowPath('', `ac${i}`, flowStub(i, units, blocks))).join('')}
    ${flowPath('', 'batteryToHome', flowHome(units, blocks))}
    ${flowPath('', 'gridToHome', flowGrid())}
  </g>

  ${ev ? `<g class="tap garage" data-tap="ev"><rect x="${gx0.toFixed(1)}" y="${gy0.toFixed(1)}" width="${(230 * PLACE.s).toFixed(1)}" height="${(230 * PLACE.s).toFixed(1)}" fill="transparent"/></g>` : ''}

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
  --ak-cloud:#ffffff; --ak-cloud-o:.6;
  --ak-case:#2b3d57; --ak-case-o:.20; --ak-flow-hi:#ffffff;
  --ak-accent:#5cc6e8; --ak-flow:#54b2d7; --ak-flow-idle:#bfd4e4;
  --ak-text:#1b2532; --ak-muted:#7d8fa5; --ak-guide:#a9bcd4;
  --ak-chip-bg:#ffffff; --ak-chip-fg:#39516d;
  display:block;
}

:host([dark]) {
  --ak-sky-1:#18222f; --ak-sky-2:#1d2836; --ak-sky-3:#22303f; --ak-sky-4:#1b2532;
  --ak-ground-1:#2c3d52; --ak-ground-2:#1b2532; --ak-shadow:#05080d;
  --ak-cloud:#4a5f7a; --ak-cloud-o:.16;
  --ak-case:#000000; --ak-case-o:.38; --ak-flow-hi:#ffffff;
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

/* the picture: the house swaps with the time of day and with the car */
.house-layer { opacity:0; transition:opacity .6s ease; }
svg[data-night="0"][data-car="0"] .h-day-closed,
svg[data-night="0"][data-car="1"] .h-day-car,
svg[data-night="1"][data-car="0"] .h-night-closed,
svg[data-night="1"][data-car="1"] .h-night-car { opacity:1; }

/* every module is two pictures: dark, and sunlit on top at the input's power */
.pv { cursor:pointer; }
.pv-sun { opacity:var(--sun,0); transition:opacity .6s ease; }

.unit { cursor:pointer; }
.unit.idle .unit-img { filter:url(#ak-f-idle); }
.unit:not(.charging):not(.idle) .unit-img { filter:url(#ak-f-out); }
.garage { cursor:pointer; }

.chip rect { fill:var(--ak-chip-bg); opacity:.92; }
.chip text { font-size:26px; font-weight:600; fill:var(--ak-chip-fg); }
/* the charge of a solarbank is printed on its own white disc */
.chip.disc text { fill:#2b3d57; font-weight:700; }

.clouds ellipse { fill:var(--ak-cloud); opacity:var(--ak-cloud-o); }

/* a cable is a thin conduit with its own shadow; it takes the flow colour
   only while energy actually moves through it */
.flow-case { stroke:var(--ak-case); opacity:var(--ak-case-o); transform:translate(0,3px); }
.flows.dc .flow-case { stroke-width:6.4px; }
.flows.ac .flow-case { stroke-width:7.6px; }
.flow-base { stroke:var(--ak-flow-idle); opacity:.95; }
.flow-hi { stroke:var(--ak-flow-hi); stroke-width:1.2px; opacity:.0; transform:translate(-.8px,-1.1px); }
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
    const peak = Math.max(cfg.panel_peak ?? 400, 1);
    this._root.querySelectorAll<SVGGElement>('g[data-pv]').forEach((g) => {
      const v = inputs[Number(g.dataset.pv)]?.value;
      const on = v !== null && v !== undefined && v > EPS;
      g.classList.toggle('off', !on);
      g.style.setProperty('--sun', on ? Math.min(1, v / peak).toFixed(2) : '0');
    });

    /* the picture: night with a dark theme, the car in the garage while it charges */
    const svg = this._root.querySelector('svg');
    if (svg) {
      svg.dataset.night = dark ? '1' : '0';
      svg.dataset.car = ev && (evPower ?? 0) > EPS ? '1' : '0';
    }

    /* per storage chips, plus the charger */
    this._paintChips(readings, combined, units, evPower);

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

    const addPill = (cx: number, cy: number, label: string, minW: number): void => {
      const w = Math.max(minW, label.length * 16 + 24);
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
    };

    entries.forEach((entry, i) => {
      if (entry.soc === null && entry.power === null) return;
      const label = fmtPct(entry.soc);
      if (combined && entries.length > 1) {
        const [dx, dy] = dockChipAnchor();
        addPill(dx + (i - (entries.length - 1) / 2) * spread, dy, label, 76);
        return;
      }
      const { c, size } = bankDisc(i, units);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'chip disc');
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', c[0].toFixed(1));
      text.setAttribute('y', (c[1] + size * 0.36).toFixed(1));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('style', `font-size:${size.toFixed(1)}px`);
      text.textContent = label;
      g.appendChild(text);
      host.appendChild(g);
    });

    if (evPower !== null && Math.abs(evPower) > EPS) {
      const [cx, cy] = evChipAnchor();
      addPill(cx, cy, fmtPower(Math.abs(evPower), Math.max(this._config?.kw_threshold ?? 0, 1000)), 84);
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
