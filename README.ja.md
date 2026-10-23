# DSC-analyzer

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21812143.svg)](https://doi.org/10.5281/zenodo.21812143)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

DSC データを表示・解析するブラウザアプリです。熱流、温度依存・時間依存のワークフロー、
熱イベントと等温 Avrami の特徴量抽出、IndexedDB キャッシュ、プロジェクト保存、
DB の書き出し・取り込みに対応しています。HTML 1 ファイル完結。

**English:** [README.md](README.md)

## 現行版（これを使う）

- **`webapp/dsc_analyzer_v10.html`** — タブ構成（DB · **Review** · Combined · Patterns · Series · Feature DB）。
  Analysis Mode（Tm / ΔHm / ΔSm）、等温 Avrami 速度論、再利用可能なフィットプリセットに加え、
  v10 ではファイルごとのワークフロー状態（raw-checked / analysed / excluded）と、
  大量のキャッシュを 1 測定ずつキーボードで確認していく Review モードを搭載。

## DSC waterfall（単体）

**`webapp/dsc_waterfall.html`** — DSC ファイル（Pyris .txt / Shimadzu .txt・.tad）を選ぶかフォルダごとドロップすると、
冷却・等温・昇温の段を縦に積んだ waterfall にする。試料・実験者・段数・種類・速度・前の最高温度・
保持温度 Ta・保持時間で絞り込み、並べ替え、ラベル・凡例・PNG 保存ができる。読み込みはブラウザの中だけで、
データはどこにも送らない（大きなファイルは 1 本ずつ段に縮めてから元を捨てるので、数 GB でも読める）。

- 試料名・質量・実験者・測定日時はファイルのヘッダー（Sample ID / Sample Weight / Operator ID / Data Collected、
  Shimadzu は 試料名 / 試料量 / オペレータ名 / 収集日）から取る。試料はフォルダ名でまとめることもできる
- 段の分け方と熱流の加工（mW/mg・発熱上向き・段頭を 0）は、解析ライブラリ tagkit の `dsc_waterfall_html.py` と同じ。
  263 ラン / 1222 段で全項目が一致することを確かめてある
- 作り方は [`waterfall/build.py`](waterfall/build.py)（`python3 waterfall/build.py` で組み立て直す）

## http://localhost で起動する（推奨）

`file://` で開くと、ディスク逼迫時に Chrome が IndexedDB キャッシュ（DB とプロジェクト）を
破棄することがあります。`http://localhost` は正規のオリジンなので、データがはるかに確実に
保持されます。ダブルクリックで Python のローカルサーバー（ポート **8754**）を起動し、
アプリを開くランチャを用意しています。

- **macOS** — **`launchers_mac/DSC-localhost.command`** をダブルクリック
- **Linux / 汎用** — `bash launchers_mac/DSC-localhost.sh`
- **Windows** — **`launchers_win/DSC-localhost.bat`** をダブルクリック

いずれもリポジトリ直下を配信し、`http://localhost:8754/webapp/dsc_analyzer_v10.html` を開きます。
ランチャのウィンドウは閉じても構いません（サーバーは動き続けます）。

手動で同じことをする場合:

```bash
python3 -m http.server 8754
```

ブラウザで `http://localhost:8754/webapp/dsc_analyzer_v10.html` を開く。

## 別のマシンにデータを移す（iPad / リモートなど）

**DB Export** で IndexedDB 全体（ファイル + プロジェクト + 特徴量）を JSON に書き出し、
移動先で **DB Import** から読み込みます。フィットプリセットはブラウザごとに
`localStorage` に保存されるため、この方法では移動しません。

## 旧版

旧バージョン（`v4`〜`v8`）と別 UI は **`webapp/`** および **`webapp/old-version/`** にあります。
参照用に残しているだけで、保守対象は `dsc_analyzer_v10.html` です。

## 使い方

1. 上記のランチャで起動する（または `webapp/` を HTTP で配信する）
2. UI から DSC データを読み込む（ドロップゾーンまたはファイルキャッシュ）
3. シリーズごとの Analysis Mode で解析し、特徴量を Feature DB に保存する

## ライセンス

MIT License — [LICENSE](LICENSE) を参照してください。

## 謝辞

本研究は JSPS 科研費 23K04683 の助成を受けたものです。

本リポジトリのコードは Claude (Anthropic) / Claude Code の支援を受けて開発しました。
解析手法の設計、実測データによる検証、科学的な解釈は著者によるものです。

