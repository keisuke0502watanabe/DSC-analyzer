// loader.js — 単体版 DSC waterfall の読み込み部分。
// ファイル / フォルダを選ぶかドロップする → 1 本ずつ読んで段のデータに縮め（元のデータは捨てる）→
// waterfall のビューア（dsc_waterfall_template.html の描画部分）に渡す。データはブラウザの外に出ない。
(function(){
  const $ = s => document.querySelector(s);
  const T = {
    ja: {title: "DSC waterfall", files: "ファイルを選ぶ", folder: "フォルダを選ぶ", clear: "クリア",
         group: "試料のまとめ方", gHeader: "ヘッダーの試料名", gFolder: "フォルダ名", gOne: "ひとつにまとめる",
         hint: "DSC ファイル（Pyris .txt / Shimadzu .txt・.tad）を選ぶか、ここにドロップ。読み込みはこのブラウザの中だけで行い、データはどこにも送らない",
         reading: (i, n, f) => `読み込み中 ${i} / ${n}: ${f}`,
         done: (n, m, bad) => `${n} ファイル / ${m} 段` + (bad.length ? `（読めなかった ${bad.length} 本: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? " …" : ""}）` : ""),
         none: "DSC のファイルが見つからない",
         sub: (n, m) => `${n} ファイル / ${m} 段（段頭を 0、発熱上向き、mW/mg）· このブラウザで読み込み`},
    en: {title: "DSC waterfall", files: "Choose files", folder: "Choose a folder", clear: "Clear",
         group: "Group samples by", gHeader: "sample name in the header", gFolder: "folder name", gOne: "one group",
         hint: "Choose DSC files (Pyris .txt / Shimadzu .txt, .tad) or drop them here. Everything is read inside this browser; nothing is uploaded",
         reading: (i, n, f) => `reading ${i} / ${n}: ${f}`,
         done: (n, m, bad) => `${n} files / ${m} segments` + (bad.length ? ` (could not read ${bad.length}: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? " …" : ""})` : ""),
         none: "no DSC file found",
         sub: (n, m) => `${n} files / ${m} segments (cooling, isothermal, heating) · heat flow per mg, exotherm up, each segment zeroed at its start · read in this browser`}
  };
  let lang = "ja";
  try { if (localStorage.getItem("dsc_waterfall_lang") === "en") lang = "en"; } catch (e) {}
  const runs = [];          // {key, name, folder, headerSample, segs}
  let busy = false, lastMsg = "";

  function text(){
    const L = T[lang];
    $("#wf-files-l").firstChild.textContent = L.files;
    $("#wf-folder-l").firstChild.textContent = L.folder;
    $("#wf-clear").textContent = L.clear;
    $("#wf-group-l").textContent = L.group;
    $("#wf-group").innerHTML = [["header", L.gHeader], ["folder", L.gFolder], ["one", L.gOne]]
      .map(([v, t]) => `<option value="${v}"${v === groupBy ? " selected" : ""}>${t}</option>`).join("");
    $("#wf-msg").textContent = lastMsg || L.hint;
    if (!runs.length){ $("#title").textContent = L.title; document.title = L.title; $("#subtitle").textContent = ""; }
  }
  let groupBy = "header";
  function msg(s){ lastMsg = s; $("#wf-msg").textContent = s; }

  // 同じ名前のファイルが別のフォルダにあってもラン ID が重ならないようにする
  function uniqueId(base){
    const used = new Set(runs.map(r => r.id));
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(`${base} (${i})`)) return `${base} (${i})`;
  }

  async function addFiles(list){
    if (busy) return;
    const files = list.filter(f => /\.(txt|tad)$/i.test(f.name));
    if (!files.length){ msg(T[lang].none); return; }
    busy = true;
    const bad = [];
    for (let i = 0; i < files.length; i++){
      const f = files[i], rel = f.webkitRelativePath || f._rel || f.name;
      const key = rel + "|" + f.size;
      if (runs.some(r => r.key === key)) continue;          // 同じファイルを二度読まない
      msg(T[lang].reading(i + 1, files.length, f.name));
      await new Promise(r => setTimeout(r, 0));              // 進み具合を画面に出す
      try {
        const p = wfParseBuffer(await f.arrayBuffer(), f.name);
        if (!p){ bad.push(f.name); continue; }
        const parts = rel.split("/"), folder = parts.length > 1 ? parts[parts.length - 2] : "";
        const id = uniqueId(f.name.replace(/\.(txt|tad)$/i, ""));
        const headerSample = metaSampleName(p.meta) || folder || f.name;
        // 段にしたら元の行は捨てる（数百 MB を抱えない）
        const segs = wfRunSegments(p, {id, sample: headerSample, date: wfDate(p.meta), op: wfOperator(p.meta)});
        if (!segs.length){ bad.push(f.name); continue; }
        runs.push({key, id, name: f.name, folder, headerSample, segs});
      } catch (e) { bad.push(f.name + " (" + e.message + ")"); }
    }
    busy = false;
    show(bad);
  }

  function sampleOf(r){ return groupBy === "folder" ? (r.folder || r.headerSample) : groupBy === "one" ? "DSC" : r.headerSample; }

  function show(bad){
    const segs = [];
    runs.forEach(r => { const smp = sampleOf(r), [comp, compLabel] = wfCompOf(smp);
      r.segs.forEach(s => segs.push(Object.assign({}, s, {sample: smp, comp, compLabel}))); });
    msg(T[lang].done(runs.length, segs.length, bad || []));
    if (!segs.length) return;
    document.body.classList.add("wf-loaded");
    const D = {generated: new Date().toISOString(), edge0: WF_EDGE0, ana: "DSC-analyzer waterfall", stars: [], init: {},
               subtitle_ja: T.ja.sub(runs.length, segs.length), subtitle_en: T.en.sub(runs.length, segs.length), segments: segs};
    window.wfViewer(D);
  }

  // フォルダのドロップ: 中を順にたどってファイルを集める
  function walk(entry, path){
    return new Promise(res => {
      if (entry.isFile) entry.file(f => { f._rel = path + f.name; res([f]); }, () => res([]));
      else if (entry.isDirectory){
        const rd = entry.createReader(), all = [];
        const more = () => rd.readEntries(async es => {
          if (!es.length){ const nested = await Promise.all(all.map(e => walk(e, path + entry.name + "/"))); res(nested.flat()); return; }
          all.push(...es); more();
        }, () => res([]));
        more();
      } else res([]);
    });
  }

  function setup(){
    $("#wf-files").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
    $("#wf-folder").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
    $("#wf-clear").onclick = () => { runs.length = 0; lastMsg = ""; document.body.classList.remove("wf-loaded"); Plotly.purge("plot"); $("#tbl").innerHTML = ""; text(); };
    $("#wf-group").onchange = () => { groupBy = $("#wf-group").value; if (runs.length) show(); };
    document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("wf-drag"); });
    document.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("wf-drag"); });
    document.addEventListener("drop", async e => {
      e.preventDefault(); document.body.classList.remove("wf-drag");
      const items = [...(e.dataTransfer.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
      const files = items.length ? (await Promise.all(items.map(en => walk(en, "")))).flat() : [...e.dataTransfer.files];
      addFiles(files);
    });
    // 読み込む前の言語切り替え（読み込んだ後はビューアが受け持つ）
    const setL = l => () => { lang = l; $("#ja").setAttribute("aria-pressed", l === "ja"); $("#en").setAttribute("aria-pressed", l === "en"); text();
      if (!runs.length) try { localStorage.setItem("dsc_waterfall_lang", l); } catch (e) {} };
    $("#ja").addEventListener("click", setL("ja")); $("#en").addEventListener("click", setL("en"));
    $("#ja").setAttribute("aria-pressed", lang === "ja"); $("#en").setAttribute("aria-pressed", lang === "en");
    text();
  }
  setup();
})();
