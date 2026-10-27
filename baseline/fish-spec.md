# Fish / 圖鑑 / shop browser data map

## Where species live

1. **Canonical catalog**: `GAME_CONFIG.species` inside live `client-index-live.html` (JS object with unquoted keys; ~346 species after parse).
2. **Runtime**: `applyConfig(cfg)` copies `CFG.species` → flat `SPECIES[id]` via `flatSpecies`, and `SP_KEYS`.
3. **Server**: same catalog in active `config_versions.json` (served as `/api/config`). Purchases/anticheat use `cfg.species`.
4. **Patches**: rare one-offs like `GAME_CONFIG.species.p_dawncrown = {...}`.
5. **Hybrids**: `species/hybrid.js` logic embedded in client; hybrids register into `CFG.species` / `SPECIES` at runtime and are **excluded** from shop list `SP_KEYS` intent.

Snapshot helper in this package: `species-summary.json` (id → name/family/rarity/price/…, no look meshes).

## Fields Cursor needs for a 圖鑑-like shop browser

Per species (from live entries):

| field | role |
|-------|------|
| `name` | zh display |
| `family` | machine id for chips (e.g. `tetra`, `cichlid_sa`) |
| `familyName` | chip label (e.g. `燈魚・脂鯉`, `南美・中美慈鯛`) |
| `rarity` | 0..n index into `CFG.rarity[].name` / client `RARITY` |
| `price` | coin buy price (0 if breed-only / gem) |
| `priceGems` / `sellPrice` | gem / sell |
| `breedOnly` | hide from normal buy list unless premium mode |
| `desc` | short blurb (圖鑑 body) |
| `scientificName` | search |
| `temperament`, `sizeClass`, `waterType` / `water`, `unlockLevel`, `bioload`, `tankSpace`, `adultSizeCm` | filters + 圖鑑 facts |
| `look` | render-only; not needed for list UI |

Live familyName histogram (top): 海水魚, 燈魚・脂鯉, 鯉科・波魚・鲃, 南美・中美慈鯛, 蝦・蟹・螺, 古代魚・奇特魚, 鬥魚・絲足鱸, 限定・寶石魚, …

## Existing shop list API (reuse this)

In client (search `魚店列表：篩選／排序`):

```js
shopList(ids, q)
// q: { temperament, sizeClass, family, water, text, hideLocked, level, capLevel,
//      compatWith, sort: 'price'|'level'|'size'|'name', premium, collect, found, cleaner }
```

- **Name search**: `q.text` already matches `name`, `scientificName`, `familyName`.
- **科別 filter**: `q.family` (special cases for predator plain/pattern sharks).
- **Sort**: `price` | `level` | `size` | `name` — **no rarity sort yet**; add `sort:'rarity'` or compose `rarity*1e6+price`.
- **圖鑑 detail**: dex / collect UI elsewhere (client has 圖鑑 strings + `dexHint` / `sellFromDex`). Fish cards use `info(id)`, `tags(id)`, `badge(...)`. Prefer opening the existing dex/detail sheet on tap rather than inventing a parallel modal.

## Shop shell (SHOPV2)

Full-page shop hides the old tab row (`body.shopv2 #panel .tabs`). Buy-fish is under the 🐠 魚店 flow. Add browser controls on that fish list surface.

## Art

Fish sprites: `art/fish/<id>@1x.webp` + `@2x.webp` (+ some `.json` rigs). Predators/export6 under `art/export6/fish/`. Dex feature folders: `art/fish-dex-v2`, `art/dex-*`.
