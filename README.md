# Gladys Waste Collection Schedule

External integration for [Gladys Assistant](https://gladysassistant.com) that
knows your waste collection days, built on the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js)
and the [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

The days come from:

- **a provider**, which publishes the real calendar, public holidays included
  — today [SMICTOM Valcobreizh](https://www.valcobreizh.fr) (which collects
  every town of the Val d'Ille-Aubigné) and any other service running on
  [Publidata](https://www.publidata.io);
- **your own schedule**, written in plain words per waste type (`mardi`,
  `lundi semaines paires`, `1er et 3e mercredi`,
  `vendredi toutes les 2 semaines depuis le 09/01/2026`…), with a configurable
  public-holiday rule — it works everywhere while providers are being added;
  with a provider, it completes the types the provider does not return;
- **manual exceptions** on top (`omr: 25/12/2026 > 26/12/2026`).

It creates a "Next collection" device plus one device per waste type, each with
a `days_until` sensor (0 = today, 1 = tomorrow…) to drive scenes, and a
`next_date` text sensor; plus an "upcoming collections" dashboard widget.

User documentation: [docs/fr.md](docs/fr.md) / [docs/en.md](docs/en.md).

## Project structure

```
.
├─ index.js                     # SDK bootstrap + event wiring (no schedule logic)
├─ src/
│  ├─ schedule.js               # merges provider + custom rules + exceptions, cache
│  ├─ providers/
│  │  ├─ index.js               # provider registry (keys are frozen)
│  │  └─ publidata.js           # Publidata API: geocoder → address id → services
│  ├─ openingHours.js           # OSM `opening_hours` day matcher (Publidata rules)
│  ├─ customRules.js            # plain-language rules (fr/en) + exceptions
│  ├─ holidays.js               # French public holidays + shift rules
│  ├─ dates.js                  # calendar days, ISO weeks, Europe/Paris "today"
│  ├─ wasteTypes.js             # waste types (keys are frozen)
│  ├─ devices/                  # discovery payloads + states
│  ├─ widget.js                 # `upcoming_collections` dashboard widget
│  ├─ actions.js                # "Preview the schedule" / "Test a rule" buttons
│  └─ config.js                 # config defaults + normalization
├─ test/                        # node --test, with recorded Publidata answers
├─ docs/{en,fr}.md              # user documentation (re-hosted by Gladys)
└─ gladys-assistant-integration.json
```

### How a provider works (Publidata)

1. `GET https://api.publidata.io/v2/geocoder?q=<address>&citycode=<insee>&lookup=publidata`
   → the BAN address id (e.g. `35007_0024_00001`). The address id — not the
   coordinates — selects the collection **sector**: a town may have several.
2. `GET /v2/search?types[]=Platform::Services::WasteCollection&instances[]=<id>&address_id=<id>`
   → the services of the sector (`sectorization: "single"`), each with
   `schedules` in the OpenStreetMap `opening_hours` syntax: the regular rule
   (`2024 Mar 11-2030 Dec 30 week 02-53/2 Mo 11:00-23:59`) plus a
   `closing_exception` / `exception` pair per public holiday
   (`2026 Jul 14 off` → `2026 Jul 15`).

`src/openingHours.js` evaluates those rules per day (times ignored); a rule
it does not support (`PH`, `easter`…) is skipped with a warning, never
guessed. Downloads are cached 6 h, retried 15 min after a failure while the
previous data is kept, and saved in `/data` so a restart without network still
has a schedule.

A test cross-checks the real Aubigné data against the equivalent custom
schedule (`mardi`, `lundi semaines paires` + the default holiday rule): both
give the same days until the end of 2027.

### Adding a provider

- **Another Publidata service**: users can already pick "Another service using
  Publidata" and type its instance id. To give it its own entry, add it to
  `PROVIDERS` in `src/providers/index.js` with its `instanceId`, and the same
  `value` to the `provider` select of the manifest (the tests check both lists
  match).
- **Another platform**: write `src/providers/<name>.js` exposing
  `geocode(query)` and `fetchServices({ instanceId, addressId })` returning
  `{ code, name, schedules: [{ type, openingHours, startAt, endAt }] }`, or
  extend `download()` in `src/providers/index.js` for a different shape.

The keys of `PROVIDERS`, of `WASTE_TYPES`, of the config fields, actions and
widget are stored in users' Gladys: never rename them.

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="waste-collection-schedule" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

`DATA_DIR` (default `/data`, the only writable volume of the container) holds
the provider cache.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
npx github:GladysAssistant/integration-store .   # store validation
```

## Publish

1. Push this repository to `github.com/quentinlegay/gladys-waste-collection-schedule`
   and add the topic `gladys-assistant-integration`.
2. **Actions → Release → Run workflow** (`patch` / `minor` / `major`): bumps
   the version everywhere, tags, builds the `linux/amd64` + `linux/arm64`
   image to `ghcr.io`, and the store indexer picks it up.

Requires Gladys **5.1.0** or later (dashboard widgets).

## License

Apache-2.0
