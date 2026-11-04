# COINSINK-B1-CURVE（收入軟上限）

- **公式**：若理論產速 `R`（金幣/小時）≤ `K` 則 `m=1`；否則 `m = (K/R)^(1−exp)`，每次掉幣 × `m`。
- **預設（較溫和）**：`K = 60,000`/h、`exp = 0.8`（等同 α=0.8，指數 `(1−exp)=0.2`）。
- **關閉**：`coins.softcap.enabled = false`。
- **同步處**：客戶端 `coinSoftMult`／`coinValue`、伺服器 `anticheat` `maxCoinRate`、`multi-tanks.js` 背景 settle；新手前 15 分鐘 boost 期間 `m=1`。

## 規劃參考 R 中位數下的影響（K=60,000，exp=0.8）

| 容量等級 | 參考 R（金幣/時） | m | 產速降幅 |
|---|---:|---:|---:|
| Lv9 | 24,000 | 1.000 | 0% |
| Lv10 | 48,000（中位） | 1.000 | 0% |
| Lv10 | 73,586（R>K 時約 −4% 代表點） | 0.960 | **−4.0%** |
| Lv11 | 85,000 | 0.933 | **−6.7%** |
| Lv12 | 141,000 | 0.843 | **−15.7%** |

設定值見 `config/coinsink-b1.patch.json` → `coins.softcap`（合併至 live config，勿硬改 v59 檔）。
