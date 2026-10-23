#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build.py — 単体版 DSC waterfall（webapp/dsc_waterfall.html）を組み立てる。

  python3 waterfall/build.py

材料（この folder の中）:
  dsc_waterfall_template.html  waterfall の画面と描画。tag-analysis の
                               skills/dsc-fat-analysis/scripts/dsc_waterfall_template.html の写し
                               （向こうを直したら、ここに写してから build し直す）
  dsc_parse.js                 ファイルの読み込みと段分割（dsc_analyzer_v11.html から抜き出したもの）
  wf_segments.js               1 ラン → 段のデータ（dsc_waterfall_html.py の計算を JS に移したもの）
  loader.js                    ファイル / フォルダの選択・ドロップ、試料のまとめ方

テンプレートの描画部分は、データ（D）を受け取る関数 window.wfViewer(D) に包む。読み込むたびに
その関数を呼び直すので、テンプレートそのものには手を入れない。
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "webapp", "dsc_waterfall.html")
# tag-analysis に同梱しているのと同じ 2.35.2（cdnjs には 2.35.2 が無い）
PLOTLY = '<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>'

LOAD_BAR = """<div class="bar" id="wf-load">
  <div class="grp">
    <label class="chip" id="wf-files-l">ファイルを選ぶ<input type="file" id="wf-files" multiple accept=".txt,.tad" hidden></label>
    <label class="chip" id="wf-folder-l">フォルダを選ぶ<input type="file" id="wf-folder" webkitdirectory multiple hidden></label>
    <button class="chip" id="wf-clear"></button>
  </div>
  <div class="grp"><b id="wf-group-l"></b><select id="wf-group"></select></div>
  <div class="grp"><span id="wf-msg" class="sub"></span></div>
</div>
"""
LOAD_CSS = """
/* 単体版: 読み込む前はビューアの操作を隠す。ドラッグ中は枠を出す */
label.chip{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:2px 9px;font-size:11.5px;cursor:pointer}
label.chip:hover{border-color:var(--acc);color:var(--acc)}
body:not(.wf-loaded) .bar:not(#wf-load), body:not(.wf-loaded) #plot, body:not(.wf-loaded) #tbl, body:not(.wf-loaded) #savepng{display:none}
body.wf-drag{outline:3px dashed var(--acc);outline-offset:-6px}
"""


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def main():
    tpl = read("dsc_waterfall_template.html")
    head, rest = tpl.split("<script>\nconst D = /*__DATA__*/null;\n", 1)
    viewer, tail = rest.rsplit("</script>", 1)
    assert "</script" not in viewer, "描画部分に </script が入っていると text/plain に包めない"
    assert '<script src="__PLOTLY__"></script>' in head and "</header>" in head and "</style>" in head
    head = (head.replace('<script src="__PLOTLY__"></script>', PLOTLY)
                .replace("</style>", LOAD_CSS + "</style>", 1)
                .replace("</header>", "</header>\n" + LOAD_BAR, 1))
    # 描画部分は文字列として置き、読み込むたびに関数にして呼ぶ（const の宣言が二度目でぶつからない）
    glue = ("<script type=\"text/plain\" id=\"wf-viewer\">" + viewer + "</script>\n<script>\n"
            "window.wfViewer = D => (new Function(\"D\", document.getElementById(\"wf-viewer\").textContent))(D);\n"
            + read("dsc_parse.js") + "\n" + read("wf_segments.js") + "\n" + read("loader.js") + "\n</script>")
    html = head + glue + tail
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("→ %s (%.0f kB)" % (os.path.relpath(OUT), os.path.getsize(OUT) / 1e3))


if __name__ == "__main__":
    main()
