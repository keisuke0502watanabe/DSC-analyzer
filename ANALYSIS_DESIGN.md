# DSC 解析モード 設計メモ（特徴量抽出）

> **目的**: DSC測定から融点・ガラス転移温度・融解エンタルピー/エントロピーを抽出し、
> 専用ストアに格納して測定横断の検索・絞り込みにつなげる。
> **背景**: `xrd_dsc_similarity_design_notes` の二層構造（生波形層 / 特徴量層）の DSC 版。
> **現状**: 既存 v3 (`dsc_analyzer_db_Heatflow_tempdep_timedep_v3.html`) は可視化・整理のみ。解析処理はゼロ。

---

## 確定した設計判断

| 論点 | 決定 |
|---|---|
| 入力形式 | **txt 維持**（Pyris公式の安定テキスト形式）。`.ds8d` 曲線パーサは作らない（散在・非整列チャネルの復元はREコスト大＋バージョン脆弱＋誤パースで静かにデータ破損）。実行時負荷は問題でない（バイナリ読み出しはむしろ軽い）が、**開発・正確性コストが重い**ため。`.ds8d` は将来の校正ドリフト監視で埋め込みスカラー(onset/peak/ΔH)抽出のみに限定。 |
| ΔHm の積分軸 | **時間軸/温度軸の両対応・選択式**（どちらを使ったか記録） |
| ピーク検出・ベースライン設定 | **ハイブリッド**（自動サジェスト → チャート上でドラッグ微調整 → 確定） |
| 試料質量 | 既存 `sampleMass`(mg) を使用 → ΔH は **mJ/mg = J/g** で綺麗に一致 |
| endo/exo 符号 | **自動推定＋手動上書き**（heating の融解は吸熱前提／`endoSign` を保存） |
| 特徴量の保存先 | **専用 `thermal_events` ストア**（横断検索向き。project payload には埋めない） |
| モル量（J/mol·K） | 今回スコープ外（質量ベースまで） |

---

## 既存スキーマの前提（v3 で判明した事実）

- DB: `dsc_analyzer_db` v2。ストアは `files`（生キャッシュ）/ `projects`。
- 各測定は `segments[]` を持ち、各セグメントに:
  - `type`: `'heating'|'cooling'|'isothermal'`（融解=heating・結晶化=cooling を自動判別可）
  - `rate`: β [°C/min]（温度軸積分 ∫HF dT / β に使用）
  - `start`/`end`: `data[]` へのインデックス
  - `segUid`: DB往復で安定なUUID（特徴量の紐づけキー）
- `data[]` の各行: `{time[min], hf_raw[mW], temp[°C], hf[mW]}`
- `sampleMass`[mg] は全 file レコードに存在。

---

## 保存設計: `thermal_events` ストア（DB v2 → v3）

生波形とは別ストア。1測定（=1セグメント）あたり 0..N 行、1行が1つの熱イベント。

```javascript
thermal_events (keyPath: id, autoIncrement)
  index: sampleName            // 横断検索の主キー
  index: eventType             // 'melt'|'crystallization'|'glass_transition'
  index: [sampleName,eventType]
  index: T_peak
```

レコード形状:

```javascript
{
  id, fileName, fuid, segUid,        // 生データ層への紐づけ
  sampleName,                        // 非正規化（高速横断検索）
  eventType,                         // melt / crystallization / glass_transition

  // 温度 [°C]
  T_onset, T_peak, T_endset,

  // エンタルピー
  deltaH_Jg, deltaH_raw_mJ, sampleMass_mg,

  // エントロピー（導出値 ΔS = ΔH / Tm(K)）
  deltaS_JgK, Tm_K_used,             // どの温度を Tm に使ったか

  // ガラス転移専用
  Tg_mid, deltaCp_JgK,

  // 再現・監査用プロヴェナンス
  integrationAxis,                   // 'time'|'temp'
  baselineType,                      // 'linear'（初期）
  baselinePoints: [{x,y},{x,y}],
  integ_xMin, integ_xMax,
  endoSign,                          // +1/-1
  scanRate, method,                  // 'auto'|'manual-adjusted'
  computedAt, appVersion
}
```

DBダンプ（version 2 → 3）に `thermalEvents:[]` を追加。project は参照のみで軽量維持。

---

## 抽出アルゴリズム

### 融解・結晶化
1. 対象セグメントから `integrationAxis` に応じ (x, hf) を切り出し。
2. **ピーク自動提示**: 区間内の卓越極値を prominence 閾値で検出 → 主ピークをサジェスト。
3. **2点直線ベースライン**を自動サジェスト（onset前/endset後で微分≈0 に戻る点）→ ドラッグ微調整。
4. **外挿オンセット** `T_onset` = ベースライン線 × 立ち上がり最急接線の交点。**ピーク温度** `T_peak` = 極値の x。`T_endset` は後縁で対称に。
5. **ΔHm** = ∫(hf − baseline)。時間軸: mW·min → mJ（×60）。温度軸: ∫dT / β。`/sampleMass` で J/g。生値と正規化値の両方を保存。
6. `T_onset`/`T_peak` を両方保存（真の融点=外挿オンセット、ピークは速度・質量依存の慣例差を後から選べる）。

### エントロピー
`ΔSm = ΔHm / Tm(K)`。既定は `T_onset`（平衡融点寄り）。`Tm_K_used` に何を使ったか記録し切替可能。

### ガラス転移（別ロジック）
面積でなく比熱の段差。heating で微分曲線の段を検出 → `Tg_mid`（前後ベースライン中点=half-Cp）と `ΔCp`（段差高さ）。onset/mid/endset の3慣例を保持。

### endo/exo 符号
heating の融解は吸熱前提で `endoSign` を自動推定。誤りはファイル別/全体トグルで上書きし、`endoSign` に保存。

---

## UI（ハイブリッド）
新規「解析モード」パネルをセグメントプロットに追加:
イベント種別選択（融解/結晶化/ガラス転移）→ 区間・ベースライン自動サジェスト → チャート上ドラッグハンドルで微調整 → Tm/ΔH/ΔS/ΔCp ライブ表示 → 保存で `thermal_events` に1行＋マーカー重畳。
既存の zoom/lock・オフセットハンドルの drag 基盤に載せる。

---

## 拡張: 汎用相転移対応（2026-07-08, P1後追い）
- **結晶化/冷却の onset/endset 修正**: onset は「時間的に最初に到達する裾」。加熱(または時間軸)は低温側(lead)、**冷却(温度が時間とともに下降, 例=結晶化)は高温側(trail)** を onset に割り当て（従来は前後が逆転していた）。実PPP冷却で onset(高温)>peak>endset を確認、加熱は不変。
- **汎用「相転移 (transition)」タイプ追加**: 固体–固体/多形転移など任意のピークを、融解と同じ抽出器で**転移温度(onset/peak/endset)＋転移エンタルピー(ΔH)＋ΔS**として取得。endo/exoは自動判定＋手動上書き。
- **自由記述ラベル**(`label`, 例 "α→β'"): 1測定に複数の転移を種類＋名前付きで保存可能。解析カードの入力欄・イベント一覧・特徴量DB表(ラベル列)・CSV に反映。特徴量DBの種別フィルタにも「相転移」を追加。

## 段階リリース

- **Phase 1 ✅ 実装済** (`..._v4.html`): スキーマ v3 + `thermal_events` ストア + 融解/結晶化ピーク抽出（Tm_onset/peak/endset・ΔHm[J/g]・ΔSm）。
  ハイブリッドUI（自動サジェスト→数値/チャートクリックで微調整）、チャートオーバーレイ（ベースライン/積分領域/onset・peak・endsetマーカー）、DBダンプ入出力に `thermalEvents` を追加。endo/exo は自動＋手動上書き。
  - 自動ベースラインも先行実装（10%閾値・弦法）。結晶化ボタンも有効化済み。
- **Phase 2 ✅ 完了**:
  - **外挿オンセット/エンドセットの精度改善**: 単一最急区間 → 温度幅 `ONSET_DT_HALF=0.05°C` の中心差分で変曲点傾きを平滑化（窓は温度で選ぶので積分軸非依存）。同一runのPyris算出値に対し onset を **+0.22/+0.36°C → ≤0.03°C** に是正、両軸で検証、peak不変・合成非回帰。
  - **ベースライン自動サジェストの精度向上**: 閾値10%→5%＋foot–peak幅の0.6倍を平坦部へ外側拡張。AUTO の ΔH が Pyris に **≤0.5% 一致**（Indium 28.26 vs 28.12、decane 204.63 vs 204.42。旧版は約−20%過小評価）。
  - **ドラッグハンドル**: ベースライン端点(●)をチャート上で直接ドラッグ可能に（capture相 mousedown でヒットテスト→zoomに優先、mousemoveで曲線スナップ＋オーバーレイ/読み値ライブ更新、mouseupで確定）。クリック指定・数値入力も併用可。
- **Phase 3 ✅ 完了**: ガラス転移（Tg / ΔCp）。融解とは別ロジック（面積でなく比熱の段差）。
  - `extractGlass`: 領域端点[bl0,bl1]で遷移を挟み、**平坦部（|平滑傾き|<15%*max）だけで前後ベースラインを最小二乗フィット**（段の裾を除外）。Tg_mid=half-Cp交点、Tg_onset/endset=変曲点接線×前/後ベースライン交点、`ΔCp=|段差HF|×60/(β·mass)` [J/(g·K)]。
  - UI: Tgボタン有効化、領域の自動サジェスト（最急段を検出）＋クリック/数値/ドラッグ、専用オーバーレイ（前後ベースライン＋onset/mid/endsetマーカー）、結果表示・保存（thermal_eventsに Tg_mid/deltaCp_JgK）・一覧をTg対応。
  - 検証: 合成ステップ（既知Tg/ΔCp）で **Tg_mid 厳密一致・ΔCp 誤差 ≤2.4%**（漸近の有限領域効果）。ブラウザで parse→抽出→保存往復→表示、融解パス非回帰、コンソールエラーなし。
- **Phase 4 ✅ 完了**: `thermal_events` の測定横断の検索・絞り込みUI（設計メモの本丸）＋校正ドリフト監視。
  - 「特徴量DB」モーダル: 全イベントを横断表示。フィルタ（種別 / Sample部分一致 / T範囲）、並べ替え（測定日・T・ΔH・Sample）、種別で表示分岐（融解/結晶化=Tm/ΔH/ΔS、Tg=Tg_mid/ΔCp）、行削除、CSV出力（BOM付き）。
  - 校正ドリフト監視: プロット ON で「測定日 × 選択量(T/ΔH/ΔCp/ΔS)」の散布図（Sample別に系列化）。Indium/decaneで絞ればドリフトを可視化（検証で INDIUM T_peak 157.3→158.0 の上昇を確認）。測定日は files キャッシュの measEpoch を結合（無ければ computedAt）。
  - 残（follow-on）: `.ds8d` からPyrisスカラー(onset/peak/area/ΔH)を一括抽出して校正データを自動投入するインポータ（283本活用）。曲線パースは不要だが結果オブジェクトのフィールド配置REが必要。

## 検証（Phase 1）
- 単位換算の厳密性: 合成ガウスピーク（既知 ΔH=120.3 J/g）で **温度軸/時間軸とも ΔHm=120.32 J/g** に一致（`∫dT/β` と `∫dt×60` の整合を確認）。Tonset/Tpeak/Tendset も期待値と一致。
- 実データ PPP: Tonset 65.9–68.4°C（β形 literature onset ≈66°C と整合）、ΔHm 140–154 J/g（自動ベースラインは裾を切るため手動調整前提）。
- ブラウザで parse→抽出→`thermal_events` 保存往復→UI表示→オーバーレイ描画まで通し、コンソールエラーなし。

### 校正標準による検証（Indium / n-decane, Pyris `.txt` エクスポート, 2°C/min）
- **ΔH（固定端点）: n-decane 206.85 J/g（文献 ~202, +2.4%）／Indium 27.22 J/g（文献 28.45, −4.3%）** → 実データで積分・単位換算が正しいことを確認。
- 温度: peak/onset とも約0.6°Cの一様上振れ＝この run と基準runの**ゼロ点校正差**（温度非依存オフセット。抽出器の問題ではない）。
- **同一run厳密比較（`.ds8d` 埋め込みのPyris算出値を抽出して確定）**:

| 量 | Pyris(同一run) | 抽出器 | 差 |
|---|---|---|---|
| Indium Peak | 157.937 | 157.94 | ±0.00 ✓ |
| Indium Onset | 157.29 | 157.51 | +0.22 |
| decane Peak | −28.217 | −28.22 | ±0.00 ✓ |
| decane Onset | −29.556 | −29.20 | +0.36 |
| decane ΔH（同一端点−33/−25） | 204.42 J/g | 206.85 | +1.2% ✓ |

  → **ピークは完全一致・ΔHも+1.2%一致**。onsetのみ +0.22〜0.36°C 高い（同一run基準で確定した実アルゴリズムのクセ）。End も −0.17°C。**P2で外挿オンセット/エンドセットの接線を是正**（単一最急区間→立ち上がり直線部の最小二乗接線。onsetは下がりPyris側へ寄る）。
- 備考: `.ds8d`(Pyris バイナリ)は float64 LE で、末尾に解析結果オブジェクト（`AOnsetResult`/`APeakResult`/`DSC8000Enthalpy`）と onset/peak/area/ΔH スカラーが埋め込まれている。曲線の完全パースをせずとも**真値スカラーだけ一括抽出可能**（→ 校正ドリフト監視で283本活用の道）。txt には校正定数テーブルも埋まる（Indium 真値156.600/28.450 ← 測定156.520/25.676）。
