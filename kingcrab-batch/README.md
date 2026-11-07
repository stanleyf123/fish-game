# 帝王蟹批次（client 4.2.219）

重畫 `o_king_crab`（赤金帝王蟹，**id 不變**），新增藍／黃金／智利三款帝王蟹，四款共用同一套步行動畫。

> GitHub `main` 的 `index.html` 是舊的簡易版，不是線上遊戲。本批次以使用者提供的 **live 4.2.218** 客戶端
> （md5 `0e46c5bfe7fd59c142fb3188e722eee8`）為基準做補丁；基準檔與伺服器設定片段放在 `baseline/`。
> 沒有部署、沒有連線任何線上主機、沒有使用金鑰。

## 交付內容

| 路徑 | 說明 |
| --- | --- |
| `client/index.html` | 補丁後的 **4.2.219** 完整客戶端（可直接取代 live 的 `index.html`）。 |
| `config/kingcrab-species-patch.json` | 三個新物種的伺服器設定補丁（對應 configVersion 65）。 |
| `src/kingcrab-walk.js` | 共用的程序式繪圖＋步行系統（會被內嵌進 `client/index.html`）。 |
| `tools/build-client.mjs` | 由 `baseline/` 重新產生 `client/index.html`；每一處修改都必須「剛好命中一次」，基準檔一變就會報錯。 |
| `tools/render-previews.mjs` | 產生 `previews/` 全部預覽圖（headless Chrome + ffmpeg，只讀本機檔案與 localhost）。 |
| `tools/measure-fit.mjs` | 量測步行一整圈的像素外框，確認剛好貼進 107×60 的素材框。 |
| `tests/` | 43 個測試（設定、商店、步行朝向、其他底棲不退步、真實瀏覽器整合）。 |
| `previews/` | 預覽圖與前後對照。 |
| `baseline/` | live 4.2.218 客戶端、伺服器設定片段，以及舊貼圖的調色盤壓縮參考檔（僅供前後對照）。 |

## 美術與動畫

- **完全程序式（Canvas 2D），不需要新增任何 PNG**：沒有圖檔要上傳、沒有下載量、不用處理快取。
  舊的 `/art/ocean275/kingcrab275-v2.png` 不再被任何程式引用（伺服器上留著也無妨）。
- 3/4 側面行走姿勢；6 條步足（遠側 3 條較暗、近側 3 條在前），腿長約為背甲寬的 2 倍以上，高舉的「膝」與細長的末段像真的帝王蟹；
  大小螯、眼柄、觸角、背甲棘刺與顆粒、關節金環。
- 步態是**三足組交替**（n1+f2+n3 ／ f1+n2+f3）：支撐腳在地面上不滑步（腳相對身體後移的速度剛好等於身體前進速度），
  擺動腳抬起並向前跨；身體隨步伐微微起伏、輕微左右傾；站定時所有腳回到地面，只剩輕微呼吸。
- 步態相位由「實際走過的距離」推進，不是計時器，所以走快走慢、突然停下都不會腳底打滑。
- 朝向：蟹會**面向行進方向**。要反向時先原地轉身（約 0.5 秒，腳持續小幅踏步、身體橫向壓縮後翻面），再朝新方向走；
  不會再被「拖著倒退滑」。吃飼料時朝飼料轉身，吃到後大螯會做進食動作。
- 步行速度：客戶端把 `speed` 乘上 `WALK_SPEED_MUL = 2.4`（設定仍是 6，沒改伺服器數值），否則腳步週期長達十秒以上、看起來像停住。
- 四款外觀（同一套骨架，調色盤＋體型參數不同）：

| id | 名稱 | 學名 | 特徵 |
| --- | --- | --- | --- |
| `o_king_crab` | 赤金帝王蟹 | *Paralithodes camtschaticus* | 深紅殼、金色棘刺與關節環（不是煮熟的橘色） |
| `o_blue_king_crab` | 藍帝王蟹 | *Paralithodes platypus* | 霧藍紫灰、寬圓背甲、粗壯螯、腿上有細毛 |
| `o_golden_king_crab` | 黃金帝王蟹 | *Lithodes aequispinus* | 芥黃金色、背甲與腿多且長的棘、較纖細 |
| `o_chilean_king_crab` | 智利帝王蟹 | *Lithodes santolla* | 鮮活橘色、斑駁背甲、較大的螯 |

## 玩法規則（三款新蟹與赤金完全相同）

2,000,000 金幣或 500 鑽（`altPriceGems`）、玩家 Lv10 解鎖、海洋館 Lv2（`habitat {ocean:2}`）、`role: bottom`、`sizeClass: giant`、
`adultSizeCm 150`、`tankSpace 12`、海水、溫和、`noCrossBreeding: true`（同種仍可繁殖）、`look.len/height` 與赤金相同（107.13×60），
所以尺寸、貼地位置、碰撞寬度與舊蟹一致。`o_king_crab` 本身**不需要改伺服器設定**。

## 接線位置（client）

- `Benthic267.meta`：四款 `kind:'kingcrab'`、`proc:'kingcrab'`、`walk:true`（沒有 `file`，不載入圖片）。
- `Benthic267.draw / step / image / ready`：程序式繪圖、朝向／轉身／步態推進；`image()` 與 `ready()` 會略過沒有圖檔的項目。
- 繪圖路徑：`SPR.draw` 對程序式蟹直接回傳 false（即時繪製、不走相位快取，步態才平滑）；渲染處對蟹套用轉身壓縮；
  `preview()`（商店／圖鑑縮圖）對蟹改用貼合卡片的縮放。
- `TURTLE185_FALLBACK`（離線／舊設定時保住已擁有 ID）新增三款，內容與伺服器補丁逐字相同。
- `NEWX`（商店「新上市」）在 `o_king_crab` 後面加上三款；「深海光境」說明文字更新為四款。
- `GAME_BUILD` `4.2.218` → `4.2.219`（含 `export3/catalog.json?v=` 快取參數）。

## 部署順序（本 PR 不部署）

1. **先**把 `config/kingcrab-species-patch.json` 的 `species` 合併進伺服器設定（可選：把 `optionalUpdates.o_king_crab.scientificName` 一起補上）。
2. **再**發布 `client/index.html`。客戶端的 fallback 只用於「已擁有 ID 的保底」，伺服器設定沒有的物種不會出現在商店。
3. 存檔相容：id 不變，步行狀態（`_bGait/_bAmp/_bYaw`）只存在執行期，不會寫進存檔。

## 驗證

```bash
node --test kingcrab-batch/tests/*.test.cjs   # 43 項；瀏覽器整合測試需要 Chrome（CHROME_BIN），沒有就自動略過
node kingcrab-batch/tools/build-client.mjs    # 重新產生 client/index.html（測試會檢查提交的檔案與重建結果一致）
node kingcrab-batch/tools/measure-fit.mjs     # 步行一圈的外框是否都在素材框內
node kingcrab-batch/tools/render-previews.mjs # 重新產生 previews/
node tests/game.test.cjs                      # 原本 main 的簡易版測試（不受影響）
```

測試涵蓋：

- 設定：三款規則與赤金完全一致、id／名稱／學名不撞、fallback 與伺服器補丁逐字相同、舊 fallback 其餘項目不變。
- 商店：`NEWX` 四款連續出現且原順序保留、「深海光境」文案、真實商店頁面列出四款（2,000,000 金幣＋鑽石選項＋縮圖）。
- 圖鑑：搜尋「帝王蟹」出現四款；圖鑑版本顯示 4.2.219。
- 步行朝向：往右走面右、折返時先轉身再往左走、任何時刻不會「面向與移動方向相反」、轉身中不位移、被鄰居擋住不倒退、吃飼料時面向飼料。
- 步態：三足組交替、任何時刻至少 3 腳著地、擺動腳離地、支撐腳不滑步、步態隨距離推進、停下時所有腳著地、身體起伏幅度。
- 腿長：每條腿長度 > 背甲寬度的 1.35 倍（平均 > 1.45 倍）。
- 不退步：其餘 11 種底棲（海膽／海參／海星）的 `meta`、`is()`、`step()` 4000 步軌跡、`draw()` 的 canvas 呼叫序列（含剪影）與 live 4.2.218 **逐位元相同**；
  燈魚仍走游泳路徑；其他底棲不會長出蟹專用狀態；整份 client 與基準只差預期的幾處。
- 真實瀏覽器：無腳本錯誤、6 分鐘擁擠水族箱模擬、每隻蟹單獨走動與轉身、像素外框貼進素材框且腳碰到沙線、四蟹調色盤確實畫上畫布、
  存檔不含步行狀態、每幀成本（4 隻蟹＋整個遊戲約 9 ms，單隻蟹繪製約 0.1 ms）。

## 已知事項

- 水族箱太擁擠時，底棲生物會彼此擋住（既有行為，舊蟹也一樣）；蟹的外框比舊貼圖略窄，反而更好走。
- 轉身是「橫向壓縮後翻面」的二維近似，不是真的 3D 旋轉。
- 美術為向量風格，與其他 AI 繪圖貼圖的質感不同；若之後想改成點陣貼圖，只要在 `meta` 補上 `file` 並移除 `proc` 即可回到舊路徑，步行系統可保留。

## 4.2.219 更新說明（可貼進公告）

- 赤金帝王蟹重新繪製：更長更細的步足、3/4 側面姿勢、真正的步行動作，並會朝行進方向轉身。
- 新登場：藍帝王蟹、黃金帝王蟹、智利帝王蟹（海洋館 Lv2「深海光境」，200 萬金幣或 500 鑽，擇一付款；同種可繁殖，跨種混種尚未開放）。
