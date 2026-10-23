// wf_segments.js — 読み込んだ 1 ラン → waterfall の段のデータ。
// tag-analysis skills/dsc-fat-analysis/scripts/dsc_waterfall_html.py の seg_series と main のラン単位の計算を
// そのまま JS に移したもの（台帳の代わりにファイルのヘッダーから試料名・質量・実験者・日時を取る）。
// 加工: mW/mg・発熱上向き・段頭を 0、段頭 EDGE0 分と段尻 TAIL0 分を落とし、1 段 NPT 点までに間引く。
const WF_NPT = 380;     // 1 段あたりの点数の上限
const WF_EDGE0 = 0.15;  // 埋め込み時に落とす段頭の過渡 [min]。これ以上のカットはビューアで選ぶ
const WF_TAIL0 = 0.10;  // 段尻を落とす [min]

// Python の round(x, n) に合わせる。2 進の値そのもので丸め、ちょうど真ん中（-71.125 など）だけは偶数側へ。
// toFixed は真ん中で絶対値を切り上げるので、真ん中に近いときだけ BigInt で厳密に丸める
function pyRound(x, nd){
  x = +x;
  if (!isFinite(x) || x === 0) return x;
  const y = Math.abs(x) * 10 ** nd, f = y - Math.floor(y);
  if (Math.abs(f - 0.5) > 1e-6) return +x.toFixed(nd);
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4), ex = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
  if (ex === 0) e = -1074; else { mant |= 1n << 52n; e = ex - 1075; }
  let num = mant * 10n ** BigInt(nd), den = 1n;     // |x|·10^nd = num / den（厳密）
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  let q = num / den;
  const r2 = 2n * (num % den);
  if (r2 > den || (r2 === den && (q & 1n))) q += 1n;
  const s = q.toString().padStart(nd + 1, "0");
  return (x < 0 ? -1 : 1) * parseFloat(nd ? s.slice(0, -nd) + "." + s.slice(-nd) : s);
}
function pyRoundInt(x){ return pyRound(x, 0); }
// numpy の median（偶数個なら真ん中 2 つの平均）
function npMedian(a){
  const b = Float64Array.from(a).sort(), n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
}
// numpy の std（母標準偏差）
function npStd(a){
  const m = a.reduce((p, v) => p + v, 0) / a.length;
  return Math.sqrt(a.reduce((p, v) => p + (v - m) * (v - m), 0) / a.length);
}

// 段を (時刻[min, ラン開始から], 温度, 熱流 mW/mg・発熱上向き・段頭を 0) にする。短すぎる段は null
function wfSegSeries(rows, seg, mass){
  const a = seg.start, b = seg.end;
  if (b - a + 1 < 60) return null;
  const t0 = rows[a].time, t1 = rows[b].time, m = mass || 1.0;
  let t = [], T = [], y = [];
  for (let i = a; i <= b; i++){
    const r = rows[i];
    if (r.time > t0 + WF_EDGE0 && r.time < t1 - WF_TAIL0){ t.push(r.time); T.push(r.temp); y.push(-(r.hf / m)); }
  }
  if (t.length < 40) return null;
  const k = Math.max(1, Math.floor(t.length / WF_NPT));
  if (k > 1){ const keep = (_, i) => i % k === 0; t = t.filter(keep); T = T.filter(keep); y = y.filter(keep); }
  const base = npMedian(y.slice(0, 40));
  y = y.map(v => v - base);
  const d = t.slice(1).map((v, i) => v - t[i]);
  const dmean = d.length ? d.reduce((p, v) => p + v, 0) / d.length : 0;
  const uniform = d.length > 2 && npStd(d) <= 0.01 * Math.max(dmean, 1e-9);
  const out = {T: T.map(v => pyRound(v, 2)), y: y.map(v => pyRound(v, 4)), t0: pyRound(t[0], 3), dt: pyRound(dmean, 5)};
  if (!uniform) out.t = t.map(v => pyRound(v, 3));   // 間隔が揃っていない段だけ時刻を明示的に持つ
  return out;
}

const WF_COMP_RE = /^LLL\/(\S+) (\d+):(\d+)$/;
// 混合試料名 "LLL/POP 30:70" → [LLL の割合 %, 表示名]。単体は [null, null]
function wfCompOf(sample){
  const m = WF_COMP_RE.exec(sample || "");
  if (!m) return sample === "C12TAG" ? [100, "LLL 100 %"] : [null, null];
  return [+m[2], `LLL ${m[2]} : ${m[1]} ${m[3]}`];
}

// 測定プログラム → 台帳と同じ書き方の熱履歴（"hold80/1min > 80→40@15 > hold40/30min > 40→80@2"）
function wfHistory(steps){
  const g = v => String(+(+v).toFixed(2));
  return steps.map(s => s.type === "isothermal" ? `hold${g(s.fromT)}/${g(s.duration || 0)}min`
                                                 : `${g(s.fromT)}→${g(s.toT)}@${g(s.rate)}`).join(" > ");
}

function wfDate(meta){
  const ep = metaEpoch(meta);
  if (ep == null) return "";
  const d = new Date(ep), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function wfOperator(meta){
  return String(meta["Operator ID"] || meta["Operator"] || meta["オペレータ名"] || "").trim() || null;
}

// 1 ラン（parseDscRawText の結果）→ 段の配列。info = {id, sample, mass, date, op}（無いものはヘッダーから）
function wfRunSegments(parsed, info){
  const rows = parsed.rows, steps = parsed.methodSteps, meta = parsed.meta;
  const segments = assignSegments(rows, steps);
  if (!segments.length) return [];
  const mass = info.mass != null ? info.mass : metaSampleMass(meta);
  let Tmin = Infinity; for (const r of rows) if (r.temp < Tmin) Tmin = r.temp;
  Tmin = pyRound(Tmin, 2);
  const ramps = segments.filter(s => s.type === "cooling" || s.type === "heating" || s.type === "isothermal");
  // ラン単位の Ta: 最後の昇温の直前の等温段（無ければ直前のランプの到達温度）
  let TaRun = null, holdRun = null;
  const hi = segments.map((s, i) => s.type === "heating" ? i : -1).filter(i => i >= 0);
  if (hi.length){
    for (let j = hi[hi.length-1] - 1; j >= 0; j--){
      const sg = segments[j];
      if (sg.type === "isothermal"){
        TaRun = sg.fromT != null ? sg.fromT : (sg.toT != null ? sg.toT : null);
        holdRun = rows[sg.end].time - rows[sg.start].time;
        break;
      }
      if (sg.type === "cooling" || sg.type === "heating"){ TaRun = sg.toT != null ? sg.toT : null; holdRun = 0.0; break; }
    }
  }
  const s0 = segments[0];
  const T1 = (s0.type !== "isothermal" ? s0.toT : s0.fromT);
  const lastof = {};
  ramps.forEach((s, i) => { lastof[s.type] = i; });
  const [comp, compLabel] = wfCompOf(info.sample);
  const hist = wfHistory(steps);
  const out = [];
  // 段の開始までに到達した最高温度。段の頭まで順に伸ばしていく
  let pre = rows[0].temp, upto = 0;
  ramps.forEach((s, i) => {
    for (; upto <= s.start; upto++) if (rows[upto].temp > pre) pre = rows[upto].temp;
    const ser = wfSegSeries(rows, s, mass);
    if (!ser) return;
    out.push(Object.assign({
      id: info.id, sample: info.sample, op: info.op || null, date: info.date, mass: mass == null ? null : mass,
      comp, compLabel, nseg: segments.length, type: s.type, k: i + 1, last: i === lastof[s.type],
      rate: pyRound(+(s.rate || 0), 1), fromT: s.fromT == null ? null : s.fromT, toT: s.toT == null ? null : s.toT, Tmin,
      T1: T1 == null ? null : T1, Tpre: pyRound(pre, 1), Tpre5: pyRoundInt(pre / 5.0) * 5,
      Ta: TaRun, Ta1: TaRun == null ? null : pyRoundInt(TaRun),
      hold: holdRun == null ? null : pyRound(holdRun, 1),
      hold5: holdRun == null ? null : pyRoundInt(holdRun / 5.0) * 5,
      hist
    }, ser));
  });
  return out;
}

// ファイルの中身（ArrayBuffer）→ parseDscRawText の結果。DSC のファイルでなければ null
function wfParseBuffer(buf, fname){
  const txt = isTadBuffer(buf) ? tadToText(buf, fname) : decodeDscBytes(buf);
  return parseDscRawText(txt, fname);
}

if (typeof module !== "undefined") module.exports = {wfRunSegments, wfParseBuffer, wfOperator, wfDate, WF_EDGE0};
