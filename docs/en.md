# Waste Collection Schedule

This integration knows your waste collection days and brings them to Gladys:
sensors for your scenes ("take the bin out tonight") and a dashboard widget
listing the next collections.

The days come from **one of two sources**:

- **a provider**: the collection service publishes its own calendar, public
  holidays included. The most reliable source;
- **your own schedule**, described in plain words ("tuesday", "monday even
  weeks"…). It works everywhere, until your collection service is supported
  by a provider.

## Available providers

| Provider                            | Area                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **SMICTOM Valcobreizh**             | Val d'Ille-Aubigné, Bretagne Romantique, Liffré-Cormier, Couesnon-Marches de Bretagne, Saint-Méen-Montauban (52 towns, France) |
| **Another service using Publidata** | Any collection service whose "waste info" website or app runs on Publidata (see below)                                         |

Every town of the **Val d'Ille-Aubigné** (Melesse, La Mézière, Saint-Aubin
d'Aubigné, Aubigné, Guipel…) is collected by SMICTOM Valcobreizh: pick
"SMICTOM Valcobreizh".

## Setup with a provider

1. In the **Configuration** tab, pick your provider in **Schedule source**.
2. Enter your **full address**: number, street, postcode and town, e.g.
   `1 rue de la Mairie 35250 Aubigné`. A town may have several collection
   sectors (town centre, hamlets, some streets): the address finds yours.
3. Save, then click **Preview the schedule**: the message shows the **matched
   address** and the next days of each waste type. If the matched address is
   not yours, make it more precise or fill in the **INSEE code** of your town
   (not the postcode; Aubigné: 35007).
4. Open the **Discovery** tab and add the devices.

The provider calendar is downloaded again every 6 hours. When the network is
down, the last received data is kept (even across a restart) and a message
says so in the Configuration tab.

Public holidays are **already handled** by the provider: July 14th, 2026
being a Tuesday, the household waste collection of Aubigné moves to
Wednesday 15th, with nothing to configure.

### Another service using Publidata

Publidata runs the "waste info" websites and apps of many French services
(Métropole Européenne de Lille, Orléans Métropole, Tours Métropole, Grand
Nancy, Le Cotentin, Le Havre Seine Métropole…). To use yours:

1. open the waste info website of your service in a desktop browser, then the
   developer tools (F12 key), **Network** tab;
2. type an address in the widget and filter the requests on `api.publidata`;
3. the number after `instances[]=` is the **instance id** (1003 for
   Valcobreizh): enter it in **Publidata instance id** and pick "Another
   service using Publidata".

## Setup with your own schedule

Pick **My own schedule**, then describe each waste type in plain words. Leave
a type empty when it is not collected.

| What you write                         | Meaning                                         |
| -------------------------------------- | ----------------------------------------------- |
| `tuesday`                              | every Tuesday                                   |
| `monday and thursday`                  | twice a week                                    |
| `monday even weeks`                    | Monday of even weeks (ISO week number)          |
| `thursday odd weeks`                   | Thursday of odd weeks                           |
| `friday every 2 weeks from 2026-01-09` | every other Friday, from a known collection day |
| `every other friday from 2026-01-09`   | same                                            |
| `1st and 3rd wednesday`                | 1st and 3rd Wednesday of every month            |
| `last friday`                          | last Friday of every month                      |
| `wednesday from march to november`     | some months only                                |
| `tuesday until 2026-12-31`             | until a date                                    |
| `2026-11-14, 2026-12-12`               | explicit days (bulky waste, Christmas trees…)   |
| `tuesday ; 1st saturday`               | several rules, separated by `;`                 |

Dates are written `2026-01-09` or `09/01/2026` (day first). Times ("from
11am") are accepted and ignored. French works too (`mardi`, `lundi semaines
paires`, `1er et 3e mercredi`…). Power users may write the OpenStreetMap
`opening_hours` syntax (`week 02-53/2 Mo`).

**Even weeks or "every other week"?** If your service talks about even/odd
weeks, use them. Otherwise prefer "every 2 weeks from" a known collection
day: it is safer at the end of a 53-week year (such as 2026).

The **Test a rule** button shows the next days of a rule without saving it,
and explains what is not understood.

### Public holidays

The **Public holidays** setting tells how your own schedule reacts to the 11
French public holidays:

- **the holiday and the following days of the week are collected one day
  later** (default, the most common rule): on a Monday holiday, the Monday
  collection moves to Tuesday, the Tuesday one to Wednesday… until Saturday;
- **only a collection on the holiday moves to the next day**;
- **no collection on public holidays**;
- **collected even on public holidays**.

The Alsace-Moselle extra holidays (Good Friday, December 26th) are not
included: add an exception.

### Completing a provider

With a provider, the rules of your own schedule **complete** the types it
does not return (e.g. a glass collection organized by the town hall). They
never replace a type the provider returns.

## Exceptions

The **Exceptions** field fixes a day by hand, whatever the source:

- `2026-12-25 > 2026-12-26` moves a collection;
- `-2027-01-01` cancels a collection;
- `+2026-12-31` adds a collection.

Without a prefix, the exception applies to every type. To target one,
prefix it with its code: `omr:` (household waste), `emb:` (recycling),
`verre:` (glass), `papier:` (paper), `bio:` (food waste), `dv:` (garden
waste), `enc:` (bulky waste). Separate exceptions with `;`:

```
omr: 2026-12-25 > 2026-12-26 ; emb: -2027-01-01 ; enc: +2026-11-14
```

## Devices

The **Discovery** tab offers:

- **Next collection**: the next collection, whatever the type;
- one **Collection …** device per waste type.

Each one carries two sensors:

- **Days until collection**: `0` = today, `1` = tomorrow, `2` = the day
  after… (`400` when nothing is scheduled);
- **Next collection**: the date in words, e.g. "Tuesday 6 October 2026"
  (preceded by the types on the "Next collection" device).

Names and texts are in French by default: switch **Language of device names
and texts** to English. Values are refreshed every minute: the counter
changes at most one minute after midnight.

## Example scene: "take the bin out"

1. Trigger: **Schedule**, every day at 19:00.
2. Action: **Continue only if** the "Collection Household waste" device,
   "Days until collection" sensor, **equals 1**.
3. Action: **Send a message** "Take the household waste out tonight 🗑️".

Duplicate the scene for recycling, or use the "Next collection" device for a
single scene covering every type.

## Widget

Add the **Waste collections** widget to a dashboard: it lists the next
collections with a "Today" / "Tomorrow" badge. Its settings: the number of
rows (1 to 8) and the waste types to show (empty = all).

## Troubleshooting

- **"Address not found"**: write the full address with postcode and town, or
  fill in the INSEE code.
- **"No collection found"**: the address is matched but the chosen provider
  does not serve it; check the provider.
- **"Unknown word"**: a word of your rule is not understood; adjust it with
  the "Test a rule" button.
- The integration logs (`LOG_LEVEL=debug` for details) are available from the
  Gladys interface.
