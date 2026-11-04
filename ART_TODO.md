# COINSINK Batch 1 — Art assets (placeholder paths until final Ghibli-style watercolor)

All paths are relative to `client/art/`. Format: **WebP**, original work only.

**Pricing:** see `docs/COINSINK-B1-PRICES.md`.

## Backgrounds (`coinsink/`)

Each theme ships **portrait** (900×1600, phone / tall tank) and **wide** (1600×900, desktop).

| Asset ID | Portrait (`image`) | Wide (`imageWide`) | Max size |
|---|---|---|---|
| `bg_coin_forest_spring` | `coinsink/bg_coin_forest_spring.webp` | `coinsink/bg_coin_forest_spring-wide.webp` | ≤150KB each |
| `bg_coin_summer_cloud` | `coinsink/bg_coin_summer_cloud.webp` | `coinsink/bg_coin_summer_cloud-wide.webp` | ≤150KB each |
| `bg_coin_cloud_ruins` | `coinsink/bg_coin_cloud_ruins.webp` | `coinsink/bg_coin_cloud_ruins-wide.webp` | ≤150KB each |
| `bg_coin_star_sea` | `coinsink/bg_coin_star_sea.webp` | `coinsink/bg_coin_star_sea-wide.webp` | ≤150KB each |
| `bg_coin_xmas_town` | `coinsink/bg_coin_xmas_town.webp` | `coinsink/bg_coin_xmas_town-wide.webp` | ≤150KB each |

## Decorations (`coinsink/deco/`)

Each decoration sprite: **≤512px** long edge, **≤40KB**, transparent WebP. Optional config `scale` (0.4–2.0) balances wide vs tall sprites in-game.

### 典藏・水彩庭園 (Lv10, 100,000/件)

| ID | File | scale | Description |
|---|---|---:|---|
| `cs_b1_garden_lantern` | `coinsink/deco/cs_b1_garden_lantern.webp` | 1 | 苔石燈籠 |
| `cs_b1_garden_moss_rock` | `coinsink/deco/cs_b1_garden_moss_rock.webp` | 1 | 青苔岩 |
| `cs_b1_garden_bamboo` | `coinsink/deco/cs_b1_garden_bamboo.webp` | 1.15 | 竹筧 |
| `cs_b1_garden_lotus` | `coinsink/deco/cs_b1_garden_lotus.webp` | 1 | 睡蓮石 |
| `cs_b1_garden_bridge` | `coinsink/deco/cs_b1_garden_bridge.webp` | 0.75 | 迷你木橋 |
| `cs_b1_garden_bench` | `coinsink/deco/cs_b1_garden_bench.webp` | 0.85 | 木製長椅 |

### 典藏・雲上遺跡 (Lv11, 200,000/件)

| ID | File | scale | Description |
|---|---|---:|---|
| `cs_b1_ruins_pillar` | `coinsink/deco/cs_b1_ruins_pillar.webp` | 1.1 | 斷柱 |
| `cs_b1_ruins_arch` | `coinsink/deco/cs_b1_ruins_arch.webp` | 0.8 | 石拱門 |
| `cs_b1_ruins_steps` | `coinsink/deco/cs_b1_ruins_steps.webp` | 0.75 | 石階 |
| `cs_b1_ruins_windmill` | `coinsink/deco/cs_b1_ruins_windmill.webp` | 0.9 | 舊風車 |
| `cs_b1_ruins_gate` | `coinsink/deco/cs_b1_ruins_gate.webp` | 0.8 | 石門框 |
| `cs_b1_ruins_obelisk` | `coinsink/deco/cs_b1_ruins_obelisk.webp` | 1.2 | 方尖碑 |

### 典藏・星海燈塔 (Lv12, 360,000/件)

| ID | File | scale | Description |
|---|---|---:|---|
| `cs_b1_star_lighthouse` | `coinsink/deco/cs_b1_star_lighthouse.webp` | 1.1 | 星海燈塔 |
| `cs_b1_star_shell_hut` | `coinsink/deco/cs_b1_star_shell_hut.webp` | 0.9 | 貝殼小屋 |
| `cs_b1_star_sand_jar` | `coinsink/deco/cs_b1_star_sand_jar.webp` | 1 | 星砂瓶 |
| `cs_b1_star_moon_stone` | `coinsink/deco/cs_b1_star_moon_stone.webp` | 1 | 月之石 |
| `cs_b1_star_wreck` | `coinsink/deco/cs_b1_star_wreck.webp` | 0.75 | 星塵沉木 |
| `cs_b1_star_flag` | `coinsink/deco/cs_b1_star_flag.webp` | 1.15 | 航海旗 |

### 限定・冬日小鎮 (聖誕窗口)

| ID | File | scale | Price (coins) | Description |
|---|---|---:|---:|---|
| `cs_b1_xmas_snowman` | `coinsink/deco/cs_b1_xmas_snowman.webp` | 1 | 100,000 | 雪人燈籠 |
| `cs_b1_xmas_ginger` | `coinsink/deco/cs_b1_xmas_ginger.webp` | 0.85 | 100,000 | 薑餅小屋 |
| `cs_b1_xmas_fir` | `coinsink/deco/cs_b1_xmas_fir.webp` | 1.2 | 160,000 | 雪松 |
| `cs_b1_xmas_gifts` | `coinsink/deco/cs_b1_xmas_gifts.webp` | 0.9 | 160,000 | 禮物堆 |
| `cs_b1_xmas_sleigh` | `coinsink/deco/cs_b1_xmas_sleigh.webp` | 0.75 | 240,000 | 馴鹿雪橇 |
| `cs_b1_xmas_arch` | `coinsink/deco/cs_b1_xmas_arch.webp` | 0.8 | 400,000 | 星光燈串拱門 |

## Optional UI (Phase 1 notice)

| ID | File | Description |
|---|---|---|
| `coinsink/ui/popularity_icon.webp` | ≤64×64, ≤8KB | 「館內人氣」小圖示（收入曲線說明用，尚未接 UI） |
