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
/** noise floor in W below which a flow counts as idle */
const EPS = 10;
/**
 * Translation keys used by the `anker_solix` integration, best match
 * first. Keys are stable across languages, unlike entity ids.
 * Source: custom_components/anker_solix/translations/en.json
 */
const KEY_MATCH = {
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
const EV_KEYS = {
    power_l1: ['power_l1'],
    power_l2: ['power_l2'],
    power_l3: ['power_l3'],
    power: ['ev_charge_power_avg'],
    status: ['ev_charger_status'],
};
/** the roles that only exist on a system device, never on a solarbank */
const SYSTEM_ROLES = ['home', 'grid', 'grid_to_home', 'home_to_grid'];
/**
 * Fallback for setups without translation keys — matched against the
 * entity_id. Every substring of a group has to be present.
 */
const ID_MATCH = {
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
const suffixIsPowerish = (id) => id.startsWith('sensor.');
/** entity ids of a device and, optionally, of its children */
const entitiesOfDevices = (hass, deviceIds) => {
    const reg = hass.entities;
    if (!reg)
        return [];
    return Object.keys(reg).filter((id) => {
        const dev = reg[id]?.device_id;
        return !!dev && deviceIds.has(dev) && suffixIsPowerish(id);
    });
};
const resolveRoles = (hass, entityIds) => {
    const reg = hass.entities ?? {};
    const found = {};
    for (const role of Object.keys(KEY_MATCH)) {
        const wanted = KEY_MATCH[role];
        let best;
        for (const id of entityIds) {
            const key = reg[id]?.translation_key;
            if (!key)
                continue;
            const rank = wanted.indexOf(key);
            if (rank < 0)
                continue;
            if (!best || rank < best.rank)
                best = { id, rank };
        }
        if (best)
            found[role] = best.id;
    }
    // fall back to entity_id matching for anything still missing
    for (const role of Object.keys(ID_MATCH)) {
        if (found[role])
            continue;
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
const STRINGS = {
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
        bad_unit: 'Diese Sensoren liefern einen Zählerstand. Gebraucht wird die Momentanleistung in Watt:',
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
const t = (lang, key) => {
    const dict = (lang || 'en').toLowerCase().startsWith('de') ? STRINGS.de : STRINGS.en;
    return dict[key] ?? STRINGS.en[key] ?? key;
};
/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */
/** meter readings in these units are counters, not a rate — unusable here */
const ENERGY_UNITS = new Set(['Wh', 'kWh', 'MWh']);
/** the unit of an entity, '' when it has none */
const unitOf = (hass, id) => {
    if (!hass || !id)
        return '';
    return String(hass.states[id]?.attributes?.unit_of_measurement ?? '');
};
/**
 * Reads a value and normalises it to watts. A kWh counter would look like
 * a plausible number and quietly show nonsense, so it is rejected instead.
 */
const readNumber = (hass, id) => {
    if (!hass || !id)
        return null;
    const st = hass.states[id];
    if (!st)
        return null;
    const v = Number(st.state);
    if (!Number.isFinite(v))
        return null;
    const unit = String(st.attributes?.unit_of_measurement ?? '');
    if (ENERGY_UNITS.has(unit))
        return null;
    return unit === 'kW' ? v * 1000 : v;
};
const fmtPower = (w, kwThreshold) => {
    if (w === null)
        return '– W';
    if (kwThreshold > 0 && Math.abs(w) >= kwThreshold) {
        return `${(w / 1000).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} kW`;
    }
    // the app prints raw watts without a group separator
    return `${Math.round(w)} W`;
};
const fmtPct = (v) => (v === null ? '–%' : `${Math.round(v)}%`);
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
const ORIGIN = [392, 520];
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
const p3 = (x, y, h) => [
    ORIGIN[0] + x - y,
    ORIGIN[1] + K * (x + y) - h,
];
const fp = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const poly = (pts) => `M${pts.map(fp).join(' L ')} Z`;
const line = (pts) => `M${pts.map(fp).join(' L ')}`;
/**
 * A polyline with rounded corners. Cables bend, they do not have mitres —
 * and a rounded joint also keeps the travelling pulse from stuttering as
 * it turns.
 */
const smooth = (pts, radius = 18) => {
    if (pts.length < 3)
        return line(pts);
    let d = `M${fp(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const a = pts[i - 1];
        const b = pts[i + 1];
        const da = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
        if (da < 1 || db < 1)
            continue;
        const ra = Math.min(radius, da / 2);
        const rb = Math.min(radius, db / 2);
        const s1 = [p[0] + ((a[0] - p[0]) * ra) / da, p[1] + ((a[1] - p[1]) * ra) / da];
        const e1 = [p[0] + ((b[0] - p[0]) * rb) / db, p[1] + ((b[1] - p[1]) * rb) / db];
        d += ` L${fp(s1)} Q${fp(p)} ${fp(e1)}`;
    }
    return `${d} L${fp(pts[pts.length - 1])}`;
};
/** a point on the visible roof plane: t = 0 at the ridge, t = 1 at the eave */
const roofPt = (x, t) => p3(x, HOUSE.W / 2 + t * ROOF_SPAN, HOUSE.HW + HOUSE.HR - t * ROOF_SPAN * PITCH);
/** three visible faces of an axis aligned box */
const isoBox = (x, y, h, dx, dy, dh, top, front, side) => `<path d="${poly([p3(x, y, h + dh), p3(x + dx, y, h + dh), p3(x + dx, y + dy, h + dh), p3(x, y + dy, h + dh)])}" fill="${top}"/>` +
    `<path d="${poly([p3(x + dx, y, h + dh), p3(x + dx, y, h), p3(x + dx, y + dy, h), p3(x + dx, y + dy, h + dh)])}" fill="${side}"/>` +
    `<path d="${poly([p3(x, y + dy, h + dh), p3(x + dx, y + dy, h + dh), p3(x + dx, y + dy, h), p3(x, y + dy, h)])}" fill="${front}"/>`;
/** soft contact shadow so nothing floats */
const groundShadow = (x, y, dx, dy, o) => {
    const c = p3(x + dx / 2, y + dy / 2, 0);
    const r = (dx + dy) / 2 + 14;
    return `<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * K * 0.95).toFixed(1)}" fill="var(--ak-shadow)" opacity="${o}"/>`;
};
/** a closed polygon with rounded corners — used for the car's body */
const smoothPoly = (pts, radius = 11) => {
    const n = pts.length;
    let d = '';
    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const a = pts[(i - 1 + n) % n];
        const b = pts[(i + 1) % n];
        const da = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
        if (da < 1 || db < 1)
            continue;
        const ra = Math.min(radius, da / 2);
        const rb = Math.min(radius, db / 2);
        const s1 = [p[0] + ((a[0] - p[0]) * ra) / da, p[1] + ((a[1] - p[1]) * ra) / da];
        const e1 = [p[0] + ((b[0] - p[0]) * rb) / db, p[1] + ((b[1] - p[1]) * rb) / db];
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
/**
 * Every solarbank gets one block of four modules, and the blocks stand
 * side by side from left to right — never in two rows. The cabinets sit in
 * the same order below, so each cable is a straight drop into its own
 * storage: no sorting, no crossings, nothing to reason about.
 */
const blockRect = (s, n) => {
    const available = ARRAY.x1 - ARRAY.x0;
    const w = Math.min(MAX_COL_W, (available - ARRAY.gapX * (n - 1)) / n);
    const used = n * w + ARRAY.gapX * (n - 1);
    const x0 = ARRAY.x0 + (available - used) / 2 + s * (w + ARRAY.gapX);
    return { x0, x1: x0 + w, t0: ARRAY.t0, t1: ARRAY.t1 };
};
const blockCentre = (s, n) => {
    const r = blockRect(s, n);
    return (r.x0 + r.x1) / 2;
};
/**
 * Four modules per solarbank, one per MPPT input, as a 2x2 block — that
 * keeps the modules close to a real module's proportions instead of
 * stretching them into slats. Inputs that carry nothing are drawn dark,
 * which makes a shaded or disconnected string obvious at a glance.
 */
const panelMarkup = (blocks) => {
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
            out += `</g>`;
        }
    }
    return out;
};
/* ------------------------------ storages ------------------------------- */
const UNIT = { dx: 44, dy: 66, h: 118, yOff: 62 };
/** shift a projected point in screen space — flow routing is schematic */
const off = (p, dx, dy) => [p[0] + dx, p[1] + dy];
const unitY = HOUSE.W + UNIT.yOff;
/**
 * 109 is the offset that makes the drop from the column above land exactly
 * on the cabinet: it cancels the sideways shift the projection adds between
 * the eave and the ground.
 */
const unitX = (i, units) => blockCentre(i, units) + 109;
const storageMarkup = (units, blocks) => {
    let out = '';
    for (let i = 0; i < units; i++) {
        const x = unitX(i, units);
        const wide = units === 1 && blocks > 1;
        const dx = wide ? UNIT.dx + 22 : UNIT.dx;
        out += `<g class="unit" data-unit="${i}">`;
        out += groundShadow(x, unitY, dx, UNIT.dy, 0.13);
        out += isoBox(x, unitY, 0, dx, UNIT.dy, UNIT.h, 'var(--ak-unit-top)', 'var(--ak-unit-front)', 'var(--ak-unit-side)');
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
const unitFoot = (i, units) => p3(unitX(i, units) + UNIT.dx / 2, unitY + UNIT.dy, 0);
/** the state-of-charge pill floats just above its cabinet */
const chipAnchor = (i, units) => off(p3(unitX(i, units) + UNIT.dx / 2, unitY + UNIT.dy, UNIT.h), 0, -36);
/** the AC rail passes in front of the cabinets, a little below their feet */
/**
 * A point on the AC rail. The cabinets march down-right at the isometric
 * slope, so extending the rail sideways has to follow that same slope —
 * otherwise the stubs stop just short of it or poke through.
 */
const busPt = (i, units, dx = 0, dy = 0) => off(unitFoot(i, units), dx, 46 + dx * K + dy);
/* -------------------------------- flows -------------------------------- */
const METER = { y0: 20, y1: 98, h0: 54, h1: 134 };
const MAST = { x: 482, y: -56, h: 250 };
/** with a parking bay the mast moves back to the plot boundary */
const MAST_EV = { x: 566, y: -132, h: 250 };
const mastOf = (ev) => (ev ? MAST_EV : MAST);
/* --------------------------- parking bay --------------------------- */
const PARK = { x0: 528, x1: 772, y0: 34, y1: 212 };
/**
 * The car is built the way an isometric car actually reads: a lower body
 * swept across the full width, and a greenhouse sitting on top of it, inset
 * on both sides (tumblehome). Both come from a side profile in (length,
 * height) along the car's own axis; sweeping them across the width gives
 * the visible faces without a single hand-placed polygon.
 */
const CAR = { x: 578, y: 84, dx: 176, dy: 68, belt: 46, roof: 72 };
/** how far the cabin is inset from the body sides */
const CAR_TUMBLE = 7;
/** lower body, closed: shoulder line, nose, underside, tail */
const CAR_BODY = [
    [5, 45],
    [18, 47],
    [70, 47],
    [130, 46],
    [162, 43],
    [175, 36],
    [176, 24],
    [168, 13],
    [146, 11],
    [34, 11],
    [10, 13],
    [3, 22],
    [3, 38],
];
/** indices 0..5 sweep into the deck, the shoulder ledges and the bonnet */
const CAR_BODY_TOP = 6;
/** indices 5..7 sweep into the front face */
const CAR_BODY_NOSE = 8;
/** the greenhouse, sitting on the shoulder with a short deck behind it */
const CAR_CAB = [
    [20, 47],
    [40, 61],
    [66, 71],
    [92, 73],
    [118, 71],
    [134, 60],
    [148, 47],
    [148, 41],
    [20, 41],
];
const CAR_CAB_TOP = 7;
/** the window band, inset so the pillars stay body-coloured */
const CAR_GLASS = [
    [29, 50],
    [46, 60],
    [67, 68],
    [92, 70],
    [116, 67],
    [131, 57],
    [141, 50],
    [141, 48],
];
/** the panoramic roof panel */
const CAR_ROOF_GLASS = [
    [68, 71],
    [92, 73],
    [116, 71],
];
const CAR_WHEELS = [40, 140];
const WB = { x: 512, y: 196, d: 32, post: 66, box: 46 };
/** where the charging-power pill sits */
const evChipAnchor = () => off(p3(CAR.x + CAR.dx / 2, CAR.y + CAR.dy, CAR.roof), 0, -48);
const CAR_NEAR = CAR.y + CAR.dy;
const CAR_FAR = CAR.y;
/**
 * How far the body is drawn in from the sides at a given point along its
 * length. A car is widest between the axles and tapers towards both ends;
 * without this the nose is a slab and the tail a brick.
 */
const carTaper = (x) => {
    const t = Math.min(1, Math.max(0, Math.min(x, CAR.dx - x) / 46));
    return 10 * (1 - t) ** 1.6;
};
/** a profile point on one side of the car: +1 near, −1 far */
const carSide = (p, side, inset = 0) => p3(CAR.x + p[0], (side > 0 ? CAR_NEAR : CAR_FAR) - side * (carTaper(p[0]) + inset), p[1]);
/** the surface a chain of profile points sweeps out across the car */
const carBand = (chain, inset = 0) => poly([
    ...chain.map((p) => carSide(p, 1, inset)),
    ...chain.map((p) => carSide(p, -1, inset)).reverse(),
]);
const parkingMarkup = () => {
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
    const wheel = (x, y, r, cls) => {
        const c = p3(CAR.x + x, y, r);
        const a = ((Math.atan(K) * 180) / Math.PI).toFixed(1);
        return `<g class="${cls}" transform="translate(${fp(c).replace(' ', ' ')}) rotate(${a})">
      <ellipse rx="${r}" ry="${(r * 0.95).toFixed(1)}" fill="var(--ak-car-wheel)"/>
      <ellipse rx="${(r * 0.55).toFixed(1)}" ry="${(r * 0.52).toFixed(1)}" fill="var(--ak-car-rim)"/>
      <ellipse rx="${(r * 0.18).toFixed(1)}" ry="${(r * 0.17).toFixed(1)}" fill="var(--ak-car-wheel)"/>
    </g>`;
    };
    const bodyTop = CAR_BODY.slice(0, CAR_BODY_TOP);
    const bodyNose = CAR_BODY.slice(CAR_BODY_TOP - 1, CAR_BODY_NOSE);
    const cabTop = CAR_CAB.slice(0, CAR_CAB_TOP);
    /* a light bar drawn across the car at one point of the profile */
    const bar = (x, h, inset) => line([carSide([x, h], -1, inset), carSide([x, h], 1, inset)]);
    return `
  <path class="bay" d="${bay}"/>
  ${groundShadow(CAR.x + 12, CAR.y + 4, CAR.dx - 24, CAR.dy - 8, 0.15)}
  <g class="car" data-tap="ev">
    ${CAR_WHEELS.map((x) => wheel(x, CAR_FAR + 10, 12, 'wheel-far')).join('')}
    <path class="car-far" d="${smoothPoly(CAR_BODY.map((p) => carSide(p, -1)), 5)}"/>
    <path class="car-shell" d="${carBand(bodyTop)}"/>
    <path class="car-nose" d="${carBand(bodyNose)}"/>
    <path class="car-roof" d="${carBand(cabTop, CAR_TUMBLE)}"/>
    <path class="car-glass-top" d="${carBand(CAR_ROOF_GLASS, CAR_TUMBLE + 8)}"/>
    <path class="car-cab" d="${smoothPoly(CAR_CAB.map((p) => carSide(p, 1, CAR_TUMBLE)), 6)}"/>
    <path class="car-glass" d="${smoothPoly(CAR_GLASS.map((p) => carSide(p, 1, CAR_TUMBLE)), 5)}"/>
    <path class="car-pillar" d="${line([
        carSide([84, 48], 1, CAR_TUMBLE),
        carSide([84, 69], 1, CAR_TUMBLE),
    ])}"/>
    <path class="car-trim" d="${line(cabTop.map((p) => carSide(p, 1, CAR_TUMBLE)))}"/>
    <path class="car-side" d="${smoothPoly(CAR_BODY.map((p) => carSide(p, 1)), 5)}"/>
    <path class="car-crease" d="${line([
        carSide([14, 30], 1),
        carSide([92, 32], 1),
        carSide([158, 29], 1),
    ])}"/>
    ${CAR_WHEELS.map((x) => wheel(x, CAR_NEAR - carTaper(x) - 1, 15, 'wheel')).join('')}
    <path class="car-light" d="${bar(175, 29, 5)}"/>
    <path class="car-tail" d="${line([carSide([4, 34], 1), carSide([19, 38], 1)])}"/>
  </g>
  <g class="wallbox" data-tap="ev">
    ${isoBox(WB.x + 10, WB.y + 10, 0, 12, 12, WB.post, 'var(--ak-unit-top)', 'var(--ak-unit-front)', 'var(--ak-unit-side)')}
    ${isoBox(WB.x, WB.y, WB.post, WB.d, WB.d, WB.box, 'var(--ak-meter)', 'var(--ak-meter)', 'var(--ak-meter-edge)')}
    <path class="wb-accent" d="${line([
        p3(WB.x + 7, WB.y + WB.d, WB.post + 10),
        p3(WB.x + WB.d - 7, WB.y + WB.d, WB.post + 10),
    ])}"/>
  </g>`;
};
/**
 * The charger cable. On a Power Dock it branches off the AC rail — the dock
 * has its own port for the car, so the feed comes from the same system as
 * everything else. Without a dock it leaves the distribution board like any
 * other house circuit.
 */
const flowEv = (fromDock) => fromDock
    ? smooth([
        p3(HOUSE.L + 36, HOUSE.W + 44, 0), // branch off the rail at its corner
        p3(WB.x + 16, WB.y + WB.d, 6),
        p3(WB.x + 16, WB.y + WB.d, WB.post + 16),
    ])
    : smooth([
        p3(HOUSE.L, 44, METER.h0 + 2),
        p3(HOUSE.L, 44, 12),
        p3(HOUSE.L + 30, 70, 6),
        p3(WB.x + 16, WB.y + WB.d, 6),
        p3(WB.x + 16, WB.y + WB.d, WB.post + 16),
    ]);
/** module block -> the solarbank underneath it */
const flowPv = (s, units, blocks) => {
    const r = blockRect(s, blocks);
    const cx = (r.x0 + r.x1) / 2;
    const target = units === blocks ? s : 0;
    const top = p3(unitX(target, units) + UNIT.dx / 2, unitY, UNIT.h);
    const exit = roofPt(cx, r.t1 + 0.05);
    return smooth([exit, [exit[0], exit[1] + 26], off(top, 0, -4)], 12);
};
/**
 * Cabinet i down to the rail. The first stub stops 20 above the rail: the
 * rail's corner starts rounding there, so running all the way down would
 * poke past the bend. The rail is drawn after the stubs and covers the gap.
 */
const flowStub = (i, units) => line([off(unitFoot(i, units), 0, -6), busPt(i, units, 0, i === 0 ? -20 : 0)]);
/** the rail itself, then up the gable to the distribution board */
const flowHome = (units) => {
    const last = Math.max(units - 1, 0);
    return smooth([
        // start up on the first stub, not left of it — a free end sticking out
        // past the junction reads as a broken cable. 40 of lead-in gives the
        // corner room for a full radius.
        busPt(0, units, 0, -40),
        busPt(0, units),
        // far enough past the last cabinet that the corner rounding starts
        // after the junction, not on top of it
        busPt(last, units, 48),
        p3(HOUSE.L + 36, HOUSE.W + 44, 0), // round the front corner
        p3(HOUSE.L + 30, 120, 0), // along the front, past the door
        p3(HOUSE.L + 30, 112, METER.h0 + 2), // climb beside the board
        p3(HOUSE.L, 82, METER.h0 + 16), // and in through its lower edge
    ]);
};
/** distribution board -> mast */
/**
 * The service line runs down the mast and along the ground to the house.
 * Anything cutting across from the mast head would clip the roof verge,
 * which is exactly where the two silhouettes meet.
 */
const flowGrid = (ev) => {
    const m = mastOf(ev);
    return smooth([
        p3(m.x, m.y + 8, m.h - 18), // off the lowest crossarm
        p3(m.x - 5, m.y + 6, 105), // down the mast, clear of the roof corner
        p3(HOUSE.L + 40, 40, 110),
        p3(HOUSE.L, METER.y0 + 12, METER.h1 - 26), // in through the right edge
    ]);
};
const flowPath = (cls, key, d) => `<g data-flow="${key}"><path class="flow-base" pathLength="1000" d="${d}"/>` +
    `<path class="flow-dash ${cls}" pathLength="1000" d="${d}"/></g>`;
/* ------------------------------ the scene ------------------------------ */
const sceneMarkup = (blocks, units, ev, evOnDock) => {
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
  </defs>

  <path d="${poly([p3(-300, -260, 0), p3(L + 320, -260, 0), p3(L + 320, W + 300, 0), p3(-300, W + 300, 0)])}"
        fill="url(#ak-ground)"/>

  <!-- conifer at the back corner of the plot -->
  ${groundShadow(-274, -124, 46, 46, 0.09)}
  <path d="${poly([p3(-258, -104, 0), p3(-244, -104, 0), p3(-244, -104, 62), p3(-258, -104, 62)])}" fill="var(--ak-trunk)"/>
  <g fill="var(--ak-tree)">
    <path d="${line([p3(-251, -98, 300), p3(-207, -98, 206), p3(-295, -98, 206)])} Z"/>
    <path d="${line([p3(-251, -98, 250), p3(-200, -98, 150), p3(-302, -98, 150)])} Z"/>
    <path d="${line([p3(-251, -98, 196), p3(-193, -98, 92), p3(-309, -98, 92)])} Z"/>
    <path d="${line([p3(-251, -98, 138), p3(-188, -98, 30), p3(-314, -98, 30)])} Z"/>
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

  <!-- house -->
  <path d="${poly([p3(0, W, 0), p3(L, W, 0), p3(L, W, HW), p3(0, W, HW)])}" fill="var(--ak-wall-side)"/>
  <path d="${poly([p3(58, W, 30), p3(178, W, 30), p3(178, W, 94), p3(58, W, 94)])}"
        fill="var(--ak-window)" stroke="var(--ak-window-edge)" stroke-width="3"/>
  <path d="${poly([p3(L, 0, 0), p3(L, W, 0), p3(L, W, HW), p3(L, W / 2, HW + HR), p3(L, 0, HW)])}" fill="url(#ak-wall)"/>

  <path d="${poly([p3(L, 108, 0), p3(L, 222, 0), p3(L, 222, 112), p3(L, 108, 112)])}"
        fill="var(--ak-door)" stroke="var(--ak-door-edge)" stroke-width="3"/>
  <path d="${line([p3(L, 165, 0), p3(L, 165, 112)])}" stroke="var(--ak-door-edge)" stroke-width="3" fill="none"/>

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
  <g class="pv-array">${panelMarkup(blocks)}</g>
  <path d="${poly([eaveA, eaveB, p3(L + VO, W + OH, eaveH - T), p3(-VO, W + OH, eaveH - T)])}" fill="var(--ak-eave)"/>
  <path d="${poly([ridgeA, ridgeB, p3(L + VO, W / 2 - 16, HW + HR - 6), p3(-VO, W / 2 - 16, HW + HR - 6)])}" fill="var(--ak-ridge)"/>
  <path d="${poly([p3(L + VO, W / 2, HW + HR), p3(L + VO, W + OH, eaveH), p3(L + VO, W + OH, eaveH - T), p3(L + VO, W / 2, HW + HR - T)])}" fill="var(--ak-verge-1)"/>
  <path d="${poly([p3(L + VO, W / 2, HW + HR), p3(L + VO, -OH, eaveH), p3(L + VO, -OH, eaveH - T), p3(L + VO, W / 2, HW + HR - T)])}" fill="var(--ak-verge-2)"/>

  <!-- shrubs on the ground, front right -->
  ${groundShadow(580, W + 100, 40, 40, 0.1)}
  <g fill="var(--ak-bush)">
    <ellipse cx="${p3(600, W + 120, 16)[0].toFixed(1)}" cy="${p3(600, W + 120, 16)[1].toFixed(1)}" rx="30" ry="23"/>
    <ellipse cx="${p3(644, W + 158, 12)[0].toFixed(1)}" cy="${p3(644, W + 158, 12)[1].toFixed(1)}" rx="22" ry="17"/>
  </g>

  <g class="flows dc" fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: blocks }, (_, i) => flowPath('', `pv${i}`, flowPv(i, units, blocks))).join('')}
  </g>

  ${ev ? parkingMarkup() : ''}

  <g class="storages">${storageMarkup(units, blocks)}</g>

  <g class="flows ac" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
    ${Array.from({ length: units }, (_, i) => flowPath('', `ac${i}`, flowStub(i, units))).join('')}
    ${flowPath('', 'batteryToHome', flowHome(units))}
    ${flowPath('', 'gridToHome', flowGrid(ev))}
    ${ev ? flowPath('', 'ev', flowEv(evOnDock)) : ''}
  </g>

  <g class="chips" id="ak-chips"></g>

  <g class="guides">
    <path d="M300 14 V150"/><path d="M${G2} 14 V150"/>
    <path d="M${GB} 872 V1024"/><path d="M${G2} 872 V1024"/>
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
  --ak-bay:#dfe8f4; --ak-bay-line:#c3d3e6;
  --ak-car-shell:#dde6f1; --ak-car-nose:#b7c4d4; --ak-car-side:#a3b2c4;
  --ak-car-far:#7c8b9e; --ak-car-glass:#2f3c4e; --ak-car-glass-2:#3b4a5e;
  --ak-car-roof:#edf2f9; --ak-car-cab:#ccd7e4; --ak-car-trim:#ffffff;
  --ak-car-wheel:#2b323c; --ak-car-rim:#b6c1cf;
  --ak-car-crease:#8a97a8; --ak-car-light:#7fe4ff; --ak-car-tail:#ff6470;
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
  --ak-bay:#2a3646; --ak-bay-line:#3d4c60;
  --ak-car-shell:#98a4b3; --ak-car-nose:#74808f; --ak-car-side:#64707e;
  --ak-car-far:#454e5b; --ak-car-glass:#1c2430; --ak-car-glass-2:#26313f;
  --ak-car-roof:#a9b5c4; --ak-car-cab:#8794a4; --ak-car-trim:#c8d2de;
  --ak-car-wheel:#161b22; --ak-car-rim:#6e7b8c;
  --ak-car-crease:#4f5967; --ak-car-light:#8fe9ff; --ak-car-tail:#ff5f6b;
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
.car-side { fill:var(--ak-car-side); }
.car-roof { fill:var(--ak-car-roof); stroke:var(--ak-car-cab); stroke-width:1.5;
  stroke-linejoin:round; }
.car-cab { fill:var(--ak-car-cab); }
.car-glass { fill:var(--ak-car-glass); }
.car-pillar { fill:none; stroke:var(--ak-car-cab); stroke-width:4.5; stroke-linecap:round; }
.car-glass-top { fill:var(--ak-car-glass-2); }
.car-trim { fill:none; stroke:var(--ak-car-trim); stroke-width:2;
  stroke-linecap:round; stroke-linejoin:round; opacity:.55; }
.car-crease { fill:none; stroke:var(--ak-car-crease); stroke-width:2.5;
  stroke-linecap:round; stroke-linejoin:round; opacity:.55; }
.car-light { stroke:var(--ak-car-light); stroke-width:5; stroke-linecap:round; }
.car-tail { stroke:var(--ak-car-tail); stroke-width:4; stroke-linecap:round; opacity:.85; }
.wheel ellipse, .wheel-far ellipse { stroke:none; }
.wheel-far { opacity:.75; }
.wallbox.charging .wb-accent { stroke:var(--ak-accent); }

.pv-face { fill:url(#ak-pv); stroke:var(--ak-panel-edge); stroke-width:3; }
.pv-grid { stroke:var(--ak-panel-grid); stroke-width:2; fill:none; }
.pv.off .pv-face { fill:var(--ak-panel-off-1); stroke:var(--ak-panel-off-2); }
.pv.off .pv-grid { stroke:var(--ak-panel-off-2); }

.chip rect { fill:var(--ak-chip-bg); opacity:.92; }
.chip text { font-size:26px; font-weight:600; fill:var(--ak-chip-fg); }

.flow-base { stroke:var(--ak-flow-idle); opacity:.5; }
[data-flow].on .flow-base, [data-spur].on .flow-base { stroke:var(--ak-flow); opacity:1; }
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
const sumOf = (values) => {
    const present = values.filter((v) => v !== null);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
};
const firstOf = (values) => values.find((v) => v !== null) ?? null;
const meanOf = (values) => {
    const present = values.filter((v) => v !== null);
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};
class SonnendeckCard extends HTMLElement {
    constructor() {
        super();
        this._systems = [];
        this._builtKey = '';
        this._els = {};
        this._devicesPending = false;
        this._discovered = new Map();
        this._root = this.attachShadow({ mode: 'open' });
    }
    static getConfigElement() {
        return document.createElement(EDITOR_NAME);
    }
    /**
     * Pre-fill every Anker system that already exists. A system device is
     * recognised by any of the sensors that only ever live on one — hanging
     * this on a single key missed systems without a smart meter.
     */
    static getStubConfig(hass) {
        const reg = hass?.entities ?? {};
        const marks = new Set([
            'home_load_power',
            'solarbank_state_of_charge',
            'solarbank_output_power',
            'solarbank_input_power',
            'solarbank_battery_power_signed',
            'grid_power_signed',
        ]);
        const systems = [];
        const seen = new Set();
        for (const entry of Object.values(reg)) {
            if (entry.platform !== 'anker_solix')
                continue;
            if (!entry.translation_key || !marks.has(entry.translation_key))
                continue;
            if (!entry.device_id || seen.has(entry.device_id))
                continue;
            seen.add(entry.device_id);
            systems.push({ device: entry.device_id });
        }
        return {
            type: `custom:${CARD_NAME}`,
            systems: systems.length ? systems : [{}],
            animation: true,
        };
    }
    setConfig(config) {
        if (!config)
            throw new Error('Invalid configuration');
        this._config = { animation: true, kw_threshold: 0, ...config };
        const clean = (m) => Object.fromEntries(Object.entries(m ?? {}).filter(([, v]) => !!v));
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
    set hass(hass) {
        const previous = this._hass;
        this._hass = hass;
        if (hass.entities !== this._registryRef) {
            this._registryRef = hass.entities;
            this._discovered.clear();
        }
        if (previous && !this._statesChanged(previous, hass))
            return;
        this._render();
    }
    get hass() {
        return this._hass;
    }
    getCardSize() {
        return 9;
    }
    getLayoutOptions() {
        // the parking bay makes the card wider, so it needs fewer rows
        return this._hasEv
            ? { grid_rows: 8, grid_columns: 12, grid_min_rows: 6 }
            : { grid_rows: 9, grid_columns: 6, grid_min_rows: 7 };
    }
    _statesChanged(a, b) {
        for (const id of Object.values(this._config?.house ?? {})) {
            if (id && a.states[id] !== b.states[id])
                return true;
        }
        for (const id of Object.values(this._wallbox())) {
            if (id && a.states[id] !== b.states[id])
                return true;
        }
        for (const sys of this._systems) {
            for (const id of Object.values(this._entities(sys))) {
                if (id && a.states[id] !== b.states[id])
                    return true;
            }
        }
        return a.themes?.darkMode !== b.themes?.darkMode;
    }
    /* --------------------------- discovery --------------------------- */
    _ensureDevices() {
        if (this._devices || this._devicesPending || !this._hass?.callWS)
            return;
        if (!this._systems.some((s) => s.device))
            return;
        this._devicesPending = true;
        this._hass
            .callWS({ type: 'config/device_registry/list' })
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
    _scope(deviceId) {
        const ids = new Set([deviceId]);
        for (const d of Object.values(this._devices ?? {})) {
            if (d.via_device_id === deviceId)
                ids.add(d.id);
        }
        return ids;
    }
    _discover(deviceId) {
        const cached = this._discovered.get(deviceId);
        if (cached)
            return cached;
        const hass = this._hass;
        if (!hass)
            return {};
        let map = resolveRoles(hass, entitiesOfDevices(hass, this._scope(deviceId)));
        const parent = this._devices?.[deviceId]?.via_device_id;
        if (parent && SYSTEM_ROLES.every((role) => !map[role])) {
            const wider = resolveRoles(hass, entitiesOfDevices(hass, this._scope(parent)));
            map = { ...wider, ...map };
        }
        this._discovered.set(deviceId, map);
        return map;
    }
    _entities(sys) {
        if (!sys.device || !this._hass)
            return sys.entities ?? {};
        return { ...this._discover(sys.device), ...(sys.entities ?? {}) };
    }
    _deviceLabel(deviceId) {
        if (!deviceId)
            return undefined;
        const d = this._devices?.[deviceId] ?? this._hass?.devices?.[deviceId];
        return d?.name_by_user || d?.name || undefined;
    }
    /** the storage cabinet of a system — the solarbank, not the system itself */
    _storageLabel(sys, index) {
        if (sys.device_name)
            return sys.device_name;
        if (sys.device && this._devices) {
            const children = Object.values(this._devices).filter((d) => d.via_device_id === sys.device);
            const hit = children.find((d) => /solarbank|power\s?dock|combiner/i.test(`${d.name_by_user ?? ''} ${d.name ?? ''} ${d.model ?? ''}`)) ?? children[0];
            const label = hit?.name_by_user || hit?.name;
            if (label)
                return label;
        }
        return sys.name || this._deviceLabel(sys.device) || `${t(this._lang, 'system')} ${index + 1}`;
    }
    /** a Power Dock takes over charge and discharge across the storages */
    _hasDock() {
        if (!this._devices)
            return false;
        const systemIds = new Set(this._systems.map((s) => s.device).filter(Boolean));
        return Object.values(this._devices).some((d) => d.via_device_id &&
            systemIds.has(d.via_device_id) &&
            /power\s?dock|combiner/i.test(`${d.name_by_user ?? ''} ${d.name ?? ''} ${d.model ?? ''}`));
    }
    get _lang() {
        return this._hass?.locale?.language ?? this._hass?.language;
    }
    /* ----------------------------- data ------------------------------ */
    _readSystem(sys, index) {
        const e = this._entities(sys);
        const h = this._hass;
        const gridSign = this._config?.invert_grid ? -1 : 1;
        const battSign = this._config?.invert_battery ? -1 : 1;
        // every solarbank has four MPPT inputs, so every solarbank gets four
        // slots — an input without a sensor simply stays dark
        const inputIds = [e.solar_1, e.solar_2, e.solar_3, e.solar_4];
        const hasStrings = inputIds.some(Boolean);
        const inputs = inputIds.map((entity) => ({
            entity,
            value: entity ? readNumber(h, entity) : null,
        }));
        let solar = readNumber(h, e.solar);
        if (solar === null && hasStrings)
            solar = sumOf(inputs.map((i) => i.value));
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
        if (grid !== null)
            grid *= gridSign;
        else if (gridToHome !== null || homeToGrid !== null)
            grid = (gridToHome ?? 0) - (homeToGrid ?? 0);
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
    _readAll() {
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
    _readHouse(acTotal, evPower) {
        const h = this._config?.house ?? {};
        const hass = this._hass;
        const imp = readNumber(hass, h.grid_import);
        const exp = readNumber(hass, h.grid_export);
        let grid = readNumber(hass, h.grid);
        if (grid !== null)
            grid *= this._config?.invert_grid ? -1 : 1;
        else if (imp !== null || exp !== null)
            grid = (imp ?? 0) - (exp ?? 0);
        const given = readNumber(hass, h.load);
        if (given !== null)
            return { grid, load: given, computed: false };
        if (grid === null)
            return { grid, load: null, computed: false };
        // the car sits behind the meter, so the balance counts it — take it
        // back out so "Hauslast" means the household, not household plus car
        const inLoad = this._config?.wallbox?.in_home_load !== false;
        const car = inLoad ? (evPower ?? 0) : 0;
        const load = (acTotal ?? 0) + grid - car;
        return { grid, load: load > 0 ? load : 0, computed: true };
    }
    /** resolve the charger's entities from its device, then apply overrides */
    _wallbox() {
        const w = this._config?.wallbox;
        if (!w)
            return {};
        if (!w.device || !this._hass)
            return w;
        const ids = entitiesOfDevices(this._hass, this._scope(w.device));
        const reg = this._hass.entities ?? {};
        const found = {};
        for (const [role, keys] of Object.entries(EV_KEYS)) {
            const hit = ids.find((id) => {
                const k = reg[id]?.translation_key;
                return !!k && keys.includes(k);
            });
            if (hit)
                found[role] = hit;
        }
        return { ...found, ...w };
    }
    /** charging power in W, summed over the phases when needed */
    _evPower() {
        const w = this._wallbox();
        const direct = readNumber(this._hass, w.power);
        if (direct !== null)
            return direct;
        const phases = [w.power_l1, w.power_l2, w.power_l3]
            .map((id) => readNumber(this._hass, id))
            .filter((v) => v !== null);
        return phases.length ? phases.reduce((a, b) => a + b, 0) : null;
    }
    get _hasEv() {
        const w = this._config?.wallbox;
        return !!(w && (w.device || w.power || w.power_l1 || w.power_l2 || w.power_l3));
    }
    /** house meter entities whose unit makes them unusable */
    _meterWarnings() {
        const h = this._config?.house ?? {};
        const out = [];
        for (const id of [h.grid, h.grid_import, h.grid_export, h.load]) {
            if (!id)
                continue;
            const unit = unitOf(this._hass, id);
            if (ENERGY_UNITS.has(unit))
                out.push(`${id} (${unit})`);
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
    _acOf(r) {
        const charge = r.gridToBattery ?? 0;
        if (r.output !== null)
            return r.output - charge;
        if (r.pvToHome !== null || r.batteryToHome !== null) {
            return (r.pvToHome ?? 0) + (r.batteryToHome ?? 0) - charge;
        }
        return r.battery === null ? null : -r.battery;
    }
    /* ---------------------------- rendering -------------------------- */
    _build(panels, units, ev, evOnDock) {
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
        const q = (id) => this._root.getElementById(id);
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
        card.querySelectorAll('g[data-tap]').forEach((g) => {
            g.addEventListener('click', () => this._onTap(g.dataset.tap));
        });
        card.querySelectorAll('g[data-unit]').forEach((g) => {
            g.addEventListener('click', () => this._onUnitTap(Number(g.dataset.unit)));
        });
        card.querySelectorAll('g[data-pv]').forEach((g) => {
            g.addEventListener('click', () => this._onPvTap(Number(g.dataset.pv)));
        });
        this._builtKey = `${panels}:${units}:${ev}:${evOnDock}`;
    }
    _more(id) {
        if (!id)
            return;
        this.dispatchEvent(new CustomEvent('hass-more-info', {
            detail: { entityId: id },
            bubbles: true,
            composed: true,
        }));
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
    _tapEntity(kind) {
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
    _onTap(kind) {
        const id = this._tapEntity(kind);
        if (id)
            this._more(id);
    }
    _onUnitTap(i) {
        const sys = this._systems[i];
        if (!sys)
            return;
        const e = this._entities(sys);
        this._more(e.battery_soc ?? e.battery_power ?? e.output);
    }
    _onPvTap(i) {
        const all = this._readAll().flatMap((r) => r.inputs);
        this._more(all[i]?.entity);
    }
    _render() {
        if (!this._config)
            return;
        this._ensureDevices();
        if (!this._hass) {
            if (!this._builtKey)
                this._build(1, 1, false, false);
            return;
        }
        const cfg = this._config;
        const lang = this._lang;
        const kw = cfg.kw_threshold ?? 0;
        const readings = this._readAll();
        const inputs = readings.flatMap((r) => r.inputs);
        const display = cfg.storage_display ?? 'auto';
        const combined = display === 'combined' || (display === 'auto' && (!!cfg.dock || this._hasDock()));
        const blocks = Math.min(Math.max(readings.length, 1), 4);
        const units = combined ? 1 : blocks;
        const ev = this._hasEv;
        const evOnDock = (cfg.wallbox?.source ?? (combined ? 'dock' : 'house')) === 'dock';
        const key = `${blocks}:${units}:${ev}:${evOnDock}`;
        if (key !== this._builtKey)
            this._build(blocks, units, ev, evOnDock);
        const mode = cfg.dark_mode ?? 'auto';
        const dark = mode === 'dark' ||
            (mode === 'auto' &&
                (this._hass.themes?.darkMode ??
                    window.matchMedia?.('(prefers-color-scheme: dark)').matches ??
                    false));
        this.toggleAttribute('dark', dark);
        const setText = (k, v) => {
            const el = this._els[k];
            if (el)
                el.textContent = v;
        };
        /* title and empty state */
        const title = this._els.title;
        if (title) {
            title.toggleAttribute('hidden', !cfg.title);
            if (cfg.title)
                title.textContent = cfg.title;
        }
        /* aggregate */
        const solarTotal = sumOf(readings.map((r) => r.solar));
        const gridMode = cfg.combine?.grid ?? 'primary';
        const homeMode = cfg.combine?.home ?? 'primary';
        const acTotal = sumOf(readings.map((r) => this._acOf(r)));
        const evPower = ev ? this._evPower() : null;
        const house = this._readHouse(acTotal, evPower);
        const gridTotal = house.grid ??
            (gridMode === 'sum' ? sumOf(readings.map((r) => r.grid)) : firstOf(readings.map((r) => r.grid)));
        const homeTotal = house.load ??
            (homeMode === 'sum' ? sumOf(readings.map((r) => r.home)) : firstOf(readings.map((r) => r.home)));
        // a working house meter must not mask a system that reports nothing
        const systemsEmpty = !readings.some((r) => [r.solar, r.soc, r.battery, r.output].some((v) => v !== null));
        const warnings = this._meterWarnings();
        const hintText = warnings.length
            ? `${t(lang, 'bad_unit')} ${warnings.join(', ')}`
            : systemsEmpty
                ? t(lang, 'pick_device')
                : '';
        const hint = this._els.hint;
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
        const solarChev = this._els.solarChev;
        if (solarChev)
            solarChev.setAttribute('opacity', readings.length === 1 && inputs.some((i) => i.entity) ? '1' : '0');
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
        setText('storeVal', `${fmtPct(socAvg)} · ${fmtPower(batteryTotal === null ? null : Math.abs(batteryTotal), kw)}`);
        const arrow = this._els.storeArrow;
        if (arrow) {
            arrow.setAttribute('d', charging
                ? 'M88 1000 L88 958 M75 971 L88 958 L101 971'
                : 'M88 958 L88 1000 M75 987 L88 1000 L101 987');
            arrow.classList.toggle('idle', !charging);
        }
        // a pointer cursor on a readout that opens nothing is a broken promise
        this._root.querySelectorAll('g.tap').forEach((g) => {
            g.classList.toggle('dead', !this._tapEntity(g.dataset.tap));
        });
        /* per module state */
        this._root.querySelectorAll('g[data-pv]').forEach((g) => {
            const v = inputs[Number(g.dataset.pv)]?.value;
            g.classList.toggle('off', v === null || v <= EPS);
        });
        /* per storage chips, plus the charger */
        this._paintChips(readings, combined, units, evPower);
        this._root.querySelectorAll('g.car, g.wallbox').forEach((g) => {
            g.classList.toggle('charging', (evPower ?? 0) > EPS);
        });
        /* flows */
        const states = {
            batteryToHome: { active: Math.abs(acTotal ?? 0) > EPS, reverse: (acTotal ?? 0) < 0 },
            gridToHome: { active: Math.abs(gridTotal ?? 0) > EPS, reverse: (gridTotal ?? 0) < 0 },
            ev: { active: (evPower ?? 0) > EPS, reverse: false },
        };
        for (let i = 0; i < blocks; i++) {
            states[`pv${i}`] = { active: (readings[i]?.solar ?? 0) > EPS, reverse: false };
        }
        for (let i = 0; i < units; i++) {
            const ac = combined ? acTotal : this._acOf(readings[i] ?? {});
            states[`ac${i}`] = { active: Math.abs(ac ?? 0) > EPS, reverse: (ac ?? 0) < 0 };
        }
        const animate = cfg.animation !== false;
        this._root.querySelectorAll('g[data-flow]').forEach((g) => {
            const s = states[g.dataset.flow];
            if (!s)
                return;
            g.classList.toggle('on', s.active);
            g.classList.toggle('rev', s.reverse);
            g.classList.toggle('animated', animate);
        });
        // the light strip on each cabinet carries its own direction
        this._root.querySelectorAll('g[data-unit]').forEach((g) => {
            const i = Number(g.dataset.unit);
            const power = combined ? batteryTotal : (readings[i]?.battery ?? null);
            g.classList.toggle('charging', (power ?? 0) > EPS);
            g.classList.toggle('idle', Math.abs(power ?? 0) <= EPS);
        });
        this._placeChevron();
        requestAnimationFrame(() => this._placeChevron());
    }
    /** the small state-of-charge pill under every cabinet */
    _paintChips(readings, combined, units, evPower) {
        const host = this._els.chips;
        if (!host)
            return;
        host.innerHTML = '';
        const ns = 'http://www.w3.org/2000/svg';
        // with a dock the cabinets merge into one, but every storage keeps
        // its own state of charge — so the pills line up above the dock
        const entries = readings.map((r) => ({ soc: r.soc, power: r.battery }));
        const spread = 82;
        const [dockX, dockY] = chipAnchor(0, units);
        entries.forEach((entry, i) => {
            if (entry.soc === null && entry.power === null)
                return;
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
    _placeChevron() {
        const chev = this._els.solarChev;
        const val = this._els.solarVal;
        if (!chev || !val)
            return;
        let width = 0;
        try {
            width = val.getComputedTextLength();
        }
        catch {
            width = 0;
        }
        if (!width)
            width = (val.textContent ?? '').length * 24;
        chev.setAttribute('transform', `translate(${(76 + width + 22 - 247).toFixed(1)},0)`);
    }
    connectedCallback() {
        if (this._builtKey)
            requestAnimationFrame(() => this._placeChevron());
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
const HELPERS = {
    de: {
        device: 'Das Anker-System auswählen. Eine Solarbank geht auch — die Karte findet das System darüber selbst.',
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
        storage_display: 'auto folgt dem Power Dock, units zeichnet je System einen Speicher, combined immer einen.',
        combine: 'Zwei Systeme im selben Haus lesen meist denselben Zähler. primary nimmt den Wert vom ersten System, sum addiert alle.',
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
        storage_display: 'auto follows the Power Dock, units draws one cabinet per system, combined always one.',
        combine: 'Two systems in one house usually read the same meter. primary takes the value from the first system, sum adds them all up.',
        kw_threshold: 'For example 1000, so that 2480 W becomes 2.48 kW.',
        name: 'Only a fallback for when no device name is found.',
        device_name: 'Defaults to the name of the solarbank from the device registry.',
    },
};
const LABELS = {
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
        auto_hint: 'Gerät wählen genügt — die Sensoren werden aus der Entity-Registry gelesen, auch für später ergänzte Solarbanks oder ein Power Dock.',
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
        auto_hint: 'Picking the device is enough — the sensors are read from the entity registry, including solarbanks or a Power Dock added later.',
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
    constructor() {
        super();
        this._config = { type: `custom:${CARD_NAME}`, systems: [{}] };
        this._built = false;
        this._rowCount = -1;
        this._root = this.attachShadow({ mode: 'open' });
    }
    setConfig(config) {
        const systems = config.systems?.length
            ? config.systems
            : [{ device: config.device, device_name: config.device_name, entities: config.entities }];
        this._config = { ...config, systems };
        delete this._config.device;
        delete this._config.entities;
        this._render();
    }
    set hass(hass) {
        this._hass = hass;
        this._render();
    }
    get _german() {
        const lang = this._hass?.locale?.language ?? this._hass?.language ?? 'en';
        return lang.toLowerCase().startsWith('de');
    }
    get _labels() {
        return this._german ? LABELS.de : LABELS.en;
    }
    get _helpers() {
        return this._german ? HELPERS.de : HELPERS.en;
    }
    _emit(next) {
        this._config = next;
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: next }, bubbles: true, composed: true }));
        this._render();
    }
    _build() {
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
        const global = document.createElement('ha-form');
        global.addEventListener('value-changed', (ev) => {
            ev.stopPropagation();
            const value = ev.detail.value;
            this._emit({ ...this._config, ...value, systems: this._config.systems });
        });
        this._root.append(style, hint, systems, add, global);
        this._systemsHost = systems;
        this._globalForm = global;
        this._built = true;
    }
    _buildRows() {
        const host = this._systemsHost;
        if (!host)
            return;
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
            const form = document.createElement('ha-form');
            form.dataset.index = String(i);
            form.addEventListener('value-changed', (ev) => {
                ev.stopPropagation();
                const value = ev.detail.value;
                const entities = Object.fromEntries(Object.entries(value.entities ?? {}).filter(([, v]) => !!v));
                const next = [...(this._config.systems ?? [])];
                next[i] = Object.keys(entities).length ? { ...value, entities } : { ...value, entities: undefined };
                this._emit({ ...this._config, systems: next });
            });
            box.append(head, form);
            host.appendChild(box);
        });
        this._rowCount = systems.length;
    }
    _render() {
        if (!this._hass)
            return;
        if (!this._built)
            this._build();
        const labels = this._labels;
        const helpers = this._helpers;
        const systems = this._config.systems ?? [];
        const hint = this._root.getElementById('hint');
        if (hint)
            hint.textContent = labels.auto_hint;
        const add = this._root.querySelector('.add');
        if (add)
            add.textContent = labels.add;
        if (this._rowCount !== systems.length)
            this._buildRows();
        this._root.querySelectorAll('.system').forEach((box, i) => {
            const title = box.querySelector('.system-title');
            if (title)
                title.textContent = `${labels.system} ${i + 1}`;
            const form = box.querySelector('ha-form');
            if (!form)
                return;
            form.hass = this._hass;
            form.schema = SYSTEM_SCHEMA;
            form.data = systems[i] ?? {};
            form.computeLabel = (s) => labels[s.name] ?? s.name;
            form.computeHelper = (s) => helpers[s.name] ?? '';
        });
        if (this._globalForm) {
            this._globalForm.hass = this._hass;
            this._globalForm.schema = GLOBAL_SCHEMA;
            this._globalForm.data = this._config;
            this._globalForm.computeLabel = (s) => labels[s.name] ?? s.name;
            this._globalForm.computeHelper = (s) => helpers[s.name] ?? '';
        }
    }
}
/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */
if (!customElements.get(CARD_NAME))
    customElements.define(CARD_NAME, SonnendeckCard);
if (!customElements.get(EDITOR_NAME))
    customElements.define(EDITOR_NAME, SonnendeckCardEditor);
if (!customElements.get(LEGACY_NAME)) {
    customElements.define(LEGACY_NAME, class extends SonnendeckCard {
    });
}
const w = window;
w.customCards = w.customCards || [];
w.customCards.push({
    type: CARD_NAME,
    name: 'Sonnendeck',
    description: 'Erzeugung, Speicher, Hauslast und Wallbox in einem isometrischen Bild',
    preview: true,
    documentationURL: 'https://github.com/dirknoelke/sonnendeck-card',
});
// eslint-disable-next-line no-console
console.info(`%c SONNENDECK %c ${CARD_VERSION} `, 'color:#fff;background:#4b5f80;font-weight:700;border-radius:3px 0 0 3px', 'color:#4b5f80;background:#e3edfa;font-weight:700;border-radius:0 3px 3px 0');
export { SonnendeckCard, SonnendeckCardEditor };
