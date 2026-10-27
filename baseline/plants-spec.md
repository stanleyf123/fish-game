# Plant system spec (live 悠游水族箱)

## Critical: plants are procedural, not sprites

In-tank aquatic plants (`CFG.aquascape.plants` / client `PL`) are **drawn in canvas** by `api.drawPlant` inside the aquascape module embedded in `index.html`. Each plant entry is a parameter bag (`type`, `zone`, `hue`, `sat`, `lit`, `h`, `w`, …). There are **no per-plant PNG/WebP sprites** for shop plants.

`drawPlant` switches on `P.type`:

| type | look |
|------|------|
| carpet | dense low mat |
| grass / ribbon | blades / long ribbons |
| stem / bushy | upright stems / fine bush |
| crypt / rosette / anubias | broad leaf rosettes |
| fern / moss | fronds / moss clumps |
| float / lettuce / lily / waterlily / ball / grape / branch | specialty |

Zones: `fore` | `mid` | `back` | `attach` | `float`.

## Config location

- Default catalog: `GAME_CONFIG` → `"plants":{...}` inside live `index.html` (also served/overridden via `/api/config` from server `config_versions`).
- Live count: **37** plants (34 coin-priced, 3 gem-only).
- Coin price range: **20–380** (median ~120). Gem plants use `price:0` + `priceGems`.
- Fields used by live entries: `name, rarity, price, priceGems?, difficulty, light, co2, grow, zone, type, hue, sat, lit, h, w, absorb, tough, cuttings, cutSell, water, desc, tip?`.

## Art on the web root (related but different)

| path | what it is |
|------|------------|
| `art/export3/moss/*.png` | **Attachable moss hardscape** overlays (side/top + `_shadow`), RGBA PNG ~400–900px — NOT the shop plant catalog |
| `art/export3/hardscape/*.png` | Rocks/wood deco |
| `art/plant-*-v1/mobile.png` | QA screenshots of plant UI, not assets |
| `art/bg/fg-plants.webp` | Background foliage layer |

Shop “我的水草” list previews are **canvas renders** of the procedural plants (see `art/plant-batch-sell-v1/mobile.png`), not file icons.

## Owner request vs live catalog

| requested name | status |
|----------------|--------|
| 牛毛氈 | **already live** `hairgrass` (price 140, grass/fore) |
| 矮珍珠 | **already live** `hc_cuba` (price 260, carpet/fore) |
| 鹿角苔 | **NEW** — propose `riccia` |
| 紅蝴蝶 | **already live** `rotala_macrandra` (price 320, stem/back) |
| 小榕 | **NEW** — propose `anubias_petite` (distinct from live `anubias_nana` 迷你水榕) |
| 鐵皇冠 | **already live** `java_fern` (price 120, fern/attach) |
| 綠宮廷 | **NEW** — propose `green_palace` |
| 大寶塔 | **NEW** — propose `limnophila_pagoda` |
| 水蘭 | **NEW** — propose `water_orchid` |
| 迷你椒草 | **already live** `crypt_parva` (price 110, crypt/fore) |

**Cursor should add only the 5 NEW keys** (and wire shop/list). Do not duplicate the 5 already-live names.

## Package art (`plants/`)

Generated illustrative sheet cut to transparent PNG/WebP for design/shop-icon reference (`plants/check.png` contact sheet). **Integrating gameplay still means adding procedural config entries** like existing plants; optional icon wiring would be a separate UI change (shop does not currently load plant image files).

See `plants-config.json` for proposed entries (zh-TW names, look-only `desc`, coin prices inside existing range).
