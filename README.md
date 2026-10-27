# Sonnendeck

[Deutsch](README.de.md) | **English**

A Lovelace card for Home Assistant that shows the energy flow of a household as one
picture: a house with PV modules on the roof, solar banks on the wall, house
connection and garage with a wall charger, with animated flow lines. House and
devices are pictures (day and night, car in the garage or out), everything that
carries a state is a vector drawn on top.

Built for balcony power plants with storage, especially **Anker SOLIX** through the
[anker_solix](https://github.com/thomluther/ha-anker-solix) integration. With
manually entered entities it runs on any other setup just the same.

**You pick a device, the card finds the rest.** Point it at an `anker_solix` system
and it reads all sensors from the entity registry, including those of hardware that
arrives later, such as a second solar bank or a Power Dock.

**All systems in one picture.** The app shows one system at a time because it has
to. Here one house stands for the whole household: every solar bank gets its own
block of four modules on the roof (one per MPPT input) and its own storage below
with the state of charge on the disc. The blocks always stand **side by side**, and
every storage stands right below its block, so every cable is a vertical line into
the right battery, without crossings and without thinking. Each module gets lighter
or darker with the power of its input (fully sunlit from `panel_peak`, default
400 W), so a shaded or disconnected string is noticed at once. If a **Power Dock**
joins, the storages merge into one device and the charge levels move to a row above it.

If you do not use the Anker integration, enter the entities by hand: the card is
entirely entity agnostic then and works the same with Shelly, Tibber, MQTT or
template sensors.

![Preview light and dark](docs/preview.png)

---

## Installation

### HACS (recommended)

1. HACS → **Frontend** → ⋮ → **Custom repositories**
2. Repository: `https://github.com/dirknoelke/sonnendeck-card`, category: **Lovelace**
3. Install "Sonnendeck"
4. Reload Home Assistant (Ctrl+F5), then search for the card under **Add card**

### Manual

Copy `dist/sonnendeck-card.js` to `config/www/` and add it as a resource
(Settings → Dashboards → ⋮ → Resources, advanced mode must be on):

```yaml
url: /local/sonnendeck-card.js?v=0.10.0
type: module
```

Raise the version number in the URL with every update, otherwise the browser keeps
the old file.

### Moving from `anker-solix-flow-card`

Up to 0.7.4 the card was called `anker-solix-flow-card`. The old element name stays
registered, so existing dashboards keep working, but the resource has to point to
`sonnendeck-card.js`. An old resource entry such as
`/local/anker-solix-flow-card.js` must be removed, otherwise it registers the old
name first and hides the new card. To tidy up, replace
`type: custom:anker-solix-flow-card` with `type: custom:sonnendeck-card` in your YAML.

---

## Configuration

This is usually enough. When you add the card through the UI, it even enters all
systems it finds by itself:

```yaml
type: custom:sonnendeck-card
systems:
  - device: 8d1f0c3a9b7e4d52a1c6f0b3e7d94a15   # Mini-PV roof
  - device: 2c7b48e6d0fa4913b85e1c7d6a03f942   # Mini-PV garden
```

### Options

| Option           | Type     | Default  | Description |
|------------------|----------|----------|-------------|
| `systems`        | list     | –        | One entry per Anker system, see below |
| `title`          | string   | –        | Optional heading above the picture |
| `dock`           | string   | –        | Device ID of the Power Dock. Set means: one storage instead of four |
| `house`          | map      | –        | House meter, see below. Wins over the values from the systems |
| `wallbox`        | map      | –        | Wall charger, see below. Set means: garage with wall charger, the car is inside while it charges |
| `panel_peak`     | number   | `400`    | Power of one input in W from which its module is drawn fully sunlit |
| `house.load`     | string   | –        | Optional. Without it the house load is calculated from the balance |
| `combine`        | map      | –        | `grid` and `home`: `primary` (default) or `sum`, see below |
| `storage_display`| string   | `auto`   | `units` one storage per system, `combined` one for all, `auto` switches as soon as a Power Dock exists |
| `invert_grid`    | boolean  | `false`  | Flip the sign of the grid sensor |
| `invert_battery` | boolean  | `false`  | Flip the sign of the battery sensor |
| `animation`      | boolean  | `true`   | Running dots on the flow lines |
| `kw_threshold`   | number   | `0`      | From this value in W on, switch to kW (`0` = always W) |
| `dark_mode`      | string   | `auto`   | `auto` (follows the HA theme), `light`, `dark` |
| `scene`          | string   | `auto`   | Picture of the house: `auto` (day while `sun.sun` is above the horizon; without that entity it follows the theme), `day`, `night`. The card colours still follow `dark_mode` |
| `corners`        | map      | –        | Own `tap_action` per corner readout (`solar`, `grid`, `storage`, `home`), see corner readouts |
| `labels`         | map      | –        | Overrides `solar`, `grid`, `home` |

### One system

| Field         | Description |
|---------------|-------------|
| `device`      | Device ID of the Anker **system**. A solar bank works as well, the card then climbs one level up to the system. |
| `name`        | Fallback label if no device name is found |
| `device_name` | Label below the storage. Default: the name of the solar bank or Power Dock |
| `entities`    | Manual overrides, they win over everything found |

---

## How detection works

The card reads the entity registry and assigns sensors through their
`translation_key`, which does not depend on the language, unlike entity IDs. It
considers the chosen device **and all devices connected through it**. That is exactly
why a second solar bank or a retrofitted Power Dock appears without any change to
the configuration.

| Role              | `translation_key`, in this order |
|-------------------|----------------------------------|
| PV total          | `solar_power_total`, `solarbank_input_power`, `input_power` |
| PV 1–4            | `solar_power_1` … `solar_power_4` |
| Grid              | `grid_power_signed` |
| House load        | `home_load_power`, `ac_to_home_load` |
| State of charge   | `solarbank_state_of_charge`, `state_of_charge_total`, `state_of_charge` |
| Battery power     | `solarbank_battery_power_signed`, `battery_power_signed_total`, `battery_power_signed` |
| Output            | `solarbank_output_power`, `ac_output_power_total`, `output_power_total`, `ac_output_power` |
| PV → house        | `pv_to_home_power` |
| PV → storage      | `pv_to_battery_power` |
| Storage → house   | `battery_to_home_power` |
| Grid → storage    | `grid_to_battery_power` |
| Grid → house      | `grid_to_home_power` |
| Feed-in           | `photovoltaic_to_grid_power` |

If the card finds no match, it falls back to a pattern in the entity ID
(`home_load_power`, `state_of_charge`, `grid_power` and so on). For everything else
there are the manual overrides.

### House meter

The meter belongs to the house, not to a solar bank. If you have your own (Tasmota
with an SML reading head, Shelly 3EM, a template sensor), enter it once, centrally:

```yaml
house:
  grid_import: sensor.tasmota_sml_in    # import in W
  grid_export: sensor.tasmota_sml_out   # export in W
```

Or a single signed sensor:

```yaml
house:
  grid: sensor.shelly_3em_total_power   # + import / − export
```

Important: **instantaneous power in watts**, not the kWh meter reading. An SML
reading head often delivers both, and the power value (OBIS 16.7.0) is the right one
for the card, not the counters 1.8.0 and 2.8.0. If the card recognises an energy
unit (`Wh`, `kWh`, `MWh`), it discards the value and says so below the picture
instead of showing a plausible number that is none. `kW` is converted automatically.

### The house load is calculated, not measured

A house connection only measures what crosses the boundary. What is consumed inside
the house is a balance:

```
House load = what the solar banks feed into the house grid  +  grid import  −  export
```

That is why the house load is regularly **larger than the grid import**: the part
the storages supply never passes the meter. At one metering point import and export
exclude each other, so only one of the two terms ever contributes.

The card calculates this itself as soon as a house meter is configured. `house.load`
only exists for the case that you have a real consumption sensor; it wins then.

### Wall charger and car

If a wall charger is configured, the parking bay, vehicle and charging post appear
on the right, with a line from the meter box to it. The card gets wider for that;
without a wall charger the scene stays unchanged.

```yaml
wallbox:
  device: 7a2e5c91b3d84f06a2e9c1b7d4f83a52   # V1 Smart EV Charger
```

The device is enough: charging power and status are read from it. Alternatively by
hand, with the three phases added up:

```yaml
wallbox:
  power_l1: sensor.wallbox_power_l1
  power_l2: sensor.wallbox_power_l2
  power_l3: sensor.wallbox_power_l3
  status: sensor.wallbox_status
```

A single power sensor works too, for example from a Shelly on the charger's circuit:

```yaml
wallbox:
  power: sensor.shelly_wallbox_power    # W, not the kWh counter
```

The charging power appears as a pill above the car, in kilowatts from 1 kW on,
because reading a wall charger in watts helps nobody.

#### What the wall charger hangs on

| Field    | Default | Meaning |
|----------|---------|---------|
| `source` | `dock` as soon as a Power Dock is set, otherwise `house` | `dock`: the line branches off the AC rail, because the dock has its own connection for the wall charger. `house`: it leaves the meter box like a normal house circuit |

With a dock everything comes from one system: the modules charge the storages, the
dock supplies house and car from the same rail.

#### The car does not count as house load

The car sits behind the meter, so it shows up in the balance, no matter whether it
charges at the dock or on a house circuit. So that "house load" means the household
and not household plus car, the charging power is subtracted again:

```
House load = Σ AC output + grid import − export − charging power
```

The pill at the car shows the car, the house load at the bottom right shows the
rest. If your output sensor already does not count the car, set
`in_home_load: false`, otherwise it is subtracted twice.

### Grid and house load with several systems

Two Anker systems in the same house usually watch the same meter. Adding up their
grid and house load values would count twice. That is why the card takes both values
by default from the **first system that reports one**:

```yaml
combine:
  grid: primary   # or: sum
  home: primary   # or: sum
```

Switch to `sum` if your systems really have separate meters and separate consumer
circuits. With a `house` meter this is settled anyway, since it wins over both
variants. PV generation and battery power are always summed, the state of charge is
the mean over the storages.

### The four corner readouts

| Corner | Value |
|--------|-------|
| Solar | Sum of the PV inputs of all systems |
| Grid | Amount at the metering point; the direction is a word in the heading (`Grid · import` / `Grid · export`) and an arrow next to the value |
| Storage | Mean state of charge · **amount** of the battery power |
| House load | Σ AC output + grid import − export − car |

The watt figure at the storage is the **battery power**, the flow *into* or *out of*
the cells, not the output to the house. Whether it charges or discharges is a word in
the heading (`Storage · charging` / `Storage · discharging`) and the arrow next to
it. `844 W` while charging means: all storages together take up 844 W right now.
What part of that goes into the house shows in the house load.

Tapping opens the history of an entity if there is exactly one. With several systems,
solar and storage are sums, so a detail sheet opens instead (see below). The way
into a single system also leads through the charge disc on the respective storage.

#### Details behind the sums

With several systems, solar, storage and house load are sums without an entity of
their own. So tapping opens a sheet over the card that shows what the number is made of:

- **Solar**: per system the power of every input (where the sensors exist)
- **Storage**: state of charge and battery power in total and per system, plus the output to the house
- **Grid**: import or export
- **House load**: the balance of storages, grid and car

If a corner has exactly one entity (for example the grid through the house meter),
the history opens as before. `action: details` forces the sheet there as well.

The same values exist as a card of their own, to embed in a pop-up or a view. It
takes the same configuration as the main card (`systems`, `house`, `wallbox`, ...)
plus `view`:

```yaml
type: custom:sonnendeck-details
view: storage          # solar, grid, storage, home or all (default)
systems:
  - device: e5bb30f4a29324f9fcc37ecda58e3b19
  - device: 2178c5fcb8463c87487f063623085bc7
house:
  grid: sensor.keller_tasmota_sml_power
```

The card does not show daily energy yet, the integration offers no fitting sensors
for it.

#### Own action per corner readout

Every corner readout (`solar`, `grid`, `storage`, `home`) can get an action of its
own, in the usual format of any Lovelace card. That makes it possible, for example,
to open a pop-up that shows more than a single entity. With
[Bubble Card](https://github.com/Clooos/Bubble-Card) this is a pop-up with a hash
that the card targets through `navigate`. The card itself does not know Bubble Card
and does not need it, it works with any solution that listens for a hash or path.

```yaml
corners:
  solar:
    tap_action:
      action: navigate
      navigation_path: "#solar"
  storage:
    tap_action:
      action: navigate
      navigation_path: "#storage"
  grid:
    tap_action:
      action: none          # do nothing, not even open the entity
```

Allowed are `more-info`, `navigate`, `url`, `perform-action`, `toggle`, `details`
(the built-in sheet) and `none`. For `more-info` without an `entity` of its own the
card uses the entity behind the corner, if there is exactly one. Without a setting
the previous behaviour stays.

### What the flow lines come from

If the partial flow sensors exist, every line shows exactly its sensor, nothing is
guessed. The lines follow the real layout instead of a scheme:

| Line | from → to | active when |
|------|-----------|-------------|
| DC, per solar bank | module block → its storage | generation of this system > 10 W |
| Stub, per storage | storage → AC rail along the house edge | inverter output of this storage outside ±10 W |
| AC rail | row of storages → left port of the house connection | sum outside ±10 W |
| Grid | middle port → a short piece down, disappears into the ground | grid power outside ±10 W |
| Wall charger | right port → wall charger | charging power > 10 W |

The AC value of a storage is the **inverter output** (`output`, otherwise
`pv_to_home + battery_to_home`), minus `grid_to_battery`. Taking only
`battery_to_home` would be wrong: on a sunny day the storage charges while the
modules supply the house directly, so the line carries power even though the battery
gives nothing.

Negative values reverse the direction: if a storage charges from the grid, its stub
runs backwards; if power is fed in, the grid line runs outwards. A value at 0 W
keeps the line grey and calm, which is not an error but the statement.

The animation is a single pulse that runs through the **whole** line. Through
`pathLength="1000"` every segment is normalised to the same length, so short stubs
and the long rail run in step, independent of the pixel length.

---

## Manual entities

Everything below `entities` is optional and overrides detection:

| Key | Unit | Sign |
|-----|------|------|
| `solar`, `solar_1` … `solar_4` | W | – |
| `grid` | W | **+ import / − export** |
| `home` | W | – |
| `battery_soc` | % | – |
| `battery_power` | W | **+ charging / − discharging** |
| `output` | W | + to the house |
| `pv_to_home`, `pv_to_battery`, `battery_to_home`, `grid_to_battery`, `grid_to_home`, `home_to_grid` | W | + in arrow direction |

If the signs of your meter do not match, flip them with `invert_grid` or
`invert_battery`. The card does not convert anything, it only reads.

---

## Customising

All colours are CSS variables on the host element:

```yaml
card_mod:
  style: |
    :host {
      --ak-sky-1: #e9d9c4;
      --ak-sky-2: #f4e8d8;
      --ak-flow: #f2a33c;
      --ak-accent: #f2a33c;
    }
```

The most important: `--ak-sky-1..4`, `--ak-ground-1/2`, `--ak-shadow`, `--ak-flow`,
`--ak-flow-idle`, `--ak-accent`, `--ak-text`, `--ak-muted`, `--ak-guide`,
`--ak-chip-bg`, `--ak-chip-fg`. House and devices are pictures and cannot be
recoloured, see Pictures below.

---

## Development

The card needs **no runtime dependencies**: no Lit, no bundler. Home Assistant loads
exactly one file.

```bash
npm install     # TypeScript only
npm run build   # src/*.ts  ->  dist/sonnendeck-card.js
npm run watch
```

The scene consists of **pictures with a vector overlay**. House (day and night,
garage closed or with car), solar bank, house connection, wall charger, Power Dock
and two module pictures (dark and sunlit) live in `art/`. On top lie the cables,
values, charge discs and the flow animation as SVG. The geometry for that is in
`src/sonnendeck-card.ts`:

- `PLACE` puts the house picture into the 960×1040 canvas, `at(x, y)` converts picture points.
- `ROOF` is the quad of the roof plane. Every module is a picture placed on a slot in
  the grid by an affine matrix, the sun layer fades in through `--sun` (power of the
  input divided by `panel_peak`).
- Devices hang on the wall along the foot line `baseY(x)`. Bank spacing, house
  connection and wall charger are set in `slotPitch`, `CONN_X`, `wallboxBox()`.

The preview for trying things out is `proto/preview.html` (open it with a local HTTP
server). Parameters: `?n=1..4` (systems), `?dock`, `?noev`, `?idle`, `?dark`,
`?sun=above_horizon|below_horizon`, `?export`, `?nogrid`,
`?sheet=solar|grid|storage|home`, `?details=all`.

## License

MIT, see [LICENSE](LICENSE).

**Sonnendeck is an independent project.** It has no connection to Anker Innovations
and is neither operated, supported nor reviewed by them. "Anker" and "SOLIX" are
trademarks of Anker Innovations and are named here only to describe which hardware
the card works with.

## Pictures

House and devices are WebP files in `art/` and get embedded into `src/art.ts` by
`npm run art`, so that the card stays a single file (`npm run build` puts both
together). To swap a picture: replace the file in `art/`, run `npm run art`, then
`npm run build`. The four house pictures must have the same crop, and so must the two
module pictures (dark and sunlit).
