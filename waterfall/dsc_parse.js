// dsc_parse.js — DSC ファイルの読み込みと段分割。
// DSC-analyzer webapp/dsc_analyzer_v11.html の decodeDscBytes … nearestTimeIndex をそのまま写したもの
// （tagkit.dsc.parse / segments はこれの Python 移植で、ビット一致を確認済み）。
// 変更は 1 点だけ: 段の最低・最高温度を Math.min(...配列) ではなくループで求める（長い保持で
// 引数が数百万になりスタックが溢れるため。返す値は同じ）。
function slMin(sl){let m=Infinity;for(const r of sl)if(r.temp<m)m=r.temp;return m;}
function slMax(sl){let m=-Infinity;for(const r of sl)if(r.temp>m)m=r.temp;return m;}
// Shimadzu TA60 writes UTF-16LE with a BOM; PerkinElmer Pyris writes single-byte text. Read the
// bytes and pick the codec from the BOM — readAsText(…,'UTF-8') turns UTF-16 into mojibake, and the
// decoded string is what gets cached as rawText, so getting this wrong poisons the DB record too.
function decodeDscBytes(buf){
  const b=new Uint8Array(buf);
  if(b.length>=2&&b[0]===0xFF&&b[1]===0xFE)return new TextDecoder('utf-16le').decode(b.subarray(2));
  if(b.length>=2&&b[0]===0xFE&&b[1]===0xFF)return new TextDecoder('utf-16be').decode(b.subarray(2));
  if(b.length>=3&&b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)return new TextDecoder('utf-8').decode(b.subarray(3));
  return new TextDecoder('utf-8').decode(b);
}
// ── Shimadzu .tad (binary) ───────────────────────────────────────────────────────────────────────
// TA60 saves an MFC-serialized "TA-60 FILE VER2.00". We do NOT implement CArchive — we walk the four
// float32 channels (id 1=time[s], 2=sample temp, 3=program temp, 4=DSC[mW]), the CTATempStep program
// table and the CDSCFileInf string block, then re-emit them in TA60's own .txt layout. So the cached
// rawText is exactly what a manual TA60 export would have produced, and every downstream consumer
// (parse, DB cache, re-parse on load, JSON export) stays untouched. Two things are better than the
// .txt: full float precision (the export rounds to 2 decimals) and the program-temperature channel,
// which the .txt drops. Reverse-engineered from DSC-60 / VER2.00 only — a different instrument or
// file version is rejected loudly rather than misread.
const TAD_MAGIC='TA-60 FILE';
function isTadBuffer(buf){
  const b=new Uint8Array(buf,0,Math.min(TAD_MAGIC.length,buf.byteLength));
  return String.fromCharCode.apply(null,b)===TAD_MAGIC;
}
function tadFind(u8,ascii,from=0){
  const pat=[];for(let i=0;i<ascii.length;i++)pat.push(ascii.charCodeAt(i));
  outer:for(let i=from;i<=u8.length-pat.length;i++){
    for(let k=0;k<pat.length;k++)if(u8[i+k]!==pat[k])continue outer;
    return i;
  }
  return -1;
}
// Each channel record: id u16, count i32, max f32, min f32, flag u16 (always 2), then count × f32.
// Records are chained: the next one is introduced either by a fresh class name (0xFFFF, schema, len,
// name) or by a 2-byte back-reference to a class already named (0x8000 bit set) — CTempData appears
// twice that way (sample temp, then program temp).
function tadChannels(u8,dv){
  let i=tadFind(u8,'CTimeData');
  if(i<0)throw new Error('CTimeData not found');
  i+='CTimeData'.length;
  const ch={};
  for(;;){
    if(i+16>u8.length)break;
    const id=dv.getUint16(i,true),n=dv.getInt32(i+2,true),flag=dv.getUint16(i+14,true);
    if(flag!==2||!(n>0&&n<1e7)||i+16+4*n>u8.length)break;   // self-check: a misparse can't slip through
    const a=new Float64Array(n);
    for(let k=0;k<n;k++)a[k]=dv.getFloat32(i+16+4*k,true);
    ch[id]=a;
    i+=16+4*n;
    if(i+2>u8.length)break;
    const tag=dv.getUint16(i,true);
    if(tag===0xffff){
      const len=dv.getUint16(i+4,true);
      const nm=String.fromCharCode.apply(null,u8.subarray(i+6,i+6+len));
      if(!/Data$/.test(nm))break;                          // next object isn't a channel → done
      i+=6+len;
    }else if(tag&0x8000)i+=2;
    else break;
  }
  return ch;
}
// Temperature program: one CTATempStep per ramp+hold = 3 floats (rate, hold temp, hold min) + 10
// bytes, chained by a back-reference tag. NOTE the rate is unsigned in practice — see parseShimadzu.
function tadSteps(u8,dv){
  let k=tadFind(u8,'CTATempStep');
  if(k<0)return [];
  k+='CTATempStep'.length;
  const steps=[];
  for(;;){
    if(k+22>u8.length)break;
    const rate=dv.getFloat32(k,true),toT=dv.getFloat32(k+4,true),hold=dv.getFloat32(k+8,true);
    if(!(Math.abs(rate)<1000&&toT>-300&&toT<2000&&hold>=0&&hold<10000))break;
    steps.push({rate,toT,hold});
    k+=22;
    if(k+2>u8.length)break;
    if(dv.getUint16(k,true)&0x8000)k+=2;else break;
  }
  return steps;
}
// CDSCFileInf holds MFC wide CStrings (ff fe ff, len, UTF-16LE) in a fixed order, interleaved with
// numeric fields of mixed width. Rather than model every field, anchor on the strings: 試料量 is the
// f32 immediately before the LAST string (the cell name), ガス流量 the f32 before the one before it.
function tadInfo(u8,dv){
  const lo=tadFind(u8,'CDSCFileInf');
  const hi=lo<0?-1:tadFind(u8,'CTaDetInf',lo);
  const S=[];
  if(lo<0||hi<0)return {s:()=>'',mass:null,gasFlow:null};
  for(let i=lo;i<hi-4;){
    if(u8[i]===0xff&&u8[i+1]===0xfe&&u8[i+2]===0xff){
      let n=u8[i+3],j=i+4;
      if(n===0xff){n=dv.getUint16(j,true);j+=2;}
      if(j+2*n<=hi){
        let s='';for(let c=0;c<n;c++)s+=String.fromCharCode(dv.getUint16(j+2*c,true));
        S.push({off:i,s});i=j+2*n;continue;
      }
    }
    i++;
  }
  const at=k=>(S[k]?S[k].s:'');
  const fBefore=k=>(S[k]&&S[k].off>=4)?dv.getFloat32(S[k].off-4,true):null;
  return {s:at,n:S.length,mass:fBefore(S.length-1),gasFlow:fBefore(S.length-2)};
}
function tadToText(buf,fname){
  const ver=new TextDecoder('ascii').decode(new Uint8Array(buf,0,Math.min(18,buf.byteLength)));
  if(!/^TA-60 FILE VER2\./.test(ver))throw new Error(`unsupported format "${ver.trim()}"`);
  const u8=new Uint8Array(buf),dv=new DataView(buf);
  const ch=tadChannels(u8,dv),t=ch[1],T=ch[2],D=ch[4];
  if(!t||!T||!D)throw new Error('time / temperature / DSC channels not found');
  const n=Math.min(t.length,T.length,D.length);
  const P=(ch[3]&&ch[3].length>=n)?ch[3]:null;   // program temperature — present in .tad, absent from the .txt
  const inf=tadInfo(u8,dv),s=inf.s;
  const L=['[ファイル情報]'];
  const kv=(k,v)=>{if(v!=null&&v!=='')L.push(`${k}：\t${v}`);};
  kv('ファイル名',s(1)||fname);
  kv('試料名',s(2));
  kv('収集日',s(4));
  kv('収集時間',s(5)?`${s(5)}(${s(6)})`:'');
  kv('機体番号',s(7));
  kv('オペレータ名',s(8));
  kv('雰囲気ガス',s(9));
  if(inf.gasFlow!=null)kv('ガス流量',`${+inf.gasFlow.toFixed(1)}[ml/min]`);
  kv('セル',s(inf.n-1));
  if(inf.mass!=null)kv('試料量',`${inf.mass.toFixed(3)}[mg]`);
  L.push('','[測定プログラム]','加熱速度\tホールド温度\tホールド時間','[ﾟC/min ]\t[  ﾟC   ]\t[  min  ]');
  tadSteps(u8,dv).forEach(st=>L.push(`${st.rate.toFixed(2)}\t${st.toT.toFixed(1)}\t${+st.hold.toFixed(1)}`));
  // Data block. DSC stays in the instrument's own endotherm-DOWN sign, exactly as the .txt writes it —
  // parseShimadzuRawText does the flip, so .tad and .txt of the same run land on identical rows.
  L.push('','[データ]','Time\tTemp\tDSC'+(P?'\tProgTemp':''),'sec\tﾟC\tmW'+(P?'\tﾟC':''));
  for(let i=0;i<n;i++)
    L.push(`${t[i].toFixed(2)}\t${T[i].toFixed(4)}\t${D[i].toFixed(4)}`+(P?`\t${P[i].toFixed(4)}`:''));
  return L.join('\r\n');
}
function countDataRows(txt){const p=parseDscRawText(txt);return p?p.rows.length:0;}
// Two vendor formats are supported. Both parsers return the same shape — {meta, methodSteps, rows}
// with rows = {time (MINUTES), temp (°C), hf (mW, ENDOTHERM UP), hf_raw} — so everything downstream
// (segmentation, charts, ΔH integration, the thermal-event store) stays vendor-agnostic.
const SHIMADZU_DATA_RE=/^\s*\[(?:データ|Data)\]\s*$/;
function isShimadzuText(txt){return SHIMADZU_DATA_RE.test(txt.slice(0,20000).split('\n').map(l=>l.replace(/\r$/,'')).join('\n'))||/^\s*(?:機種名|試料名)\s*[:：]/m.test(txt.slice(0,4000));}
function parseDscRawText(txt,fname=''){return isShimadzuText(txt)?parseShimadzuRawText(txt,fname):parsePyrisRawText(txt,fname);}
// Shimadzu TA60 (DSC-60) export: Japanese "key：<TAB>value" header, a temperature-program table, and
// the signal under "[データ]" as two header rows (names, units) + Time[sec] / Temp[°C] / DSC[mW].
function parseShimadzuRawText(txt,fname=''){
  const lines=txt.replace(/^﻿/,'').split('\n').map(l=>l.replace(/\r$/,''));
  const meta={},prog=[];let dataStart=-1,inProg=false;
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(SHIMADZU_DATA_RE.test(l)){dataStart=i+3;break;}   // +1 = column names, +2 = units
    // Temperature program: "加熱速度 / ホールド温度 / ホールド時間" table, one row per ramp+hold.
    if(/^\s*(?:加熱速度|Heating Rate)/.test(l)){inProg=true;continue;}
    if(inProg){
      const c=l.split('\t').map(s=>s.trim());
      const rate=parseFloat(c[0]),toT=parseFloat(c[1]),hold=parseFloat(c[2]);
      if(isFinite(rate)&&isFinite(toT)){prog.push({rate:Math.abs(rate),toT,hold:isFinite(hold)?hold:0});continue;}
      if(/^\[/.test(c[0]||''))continue;                  // the "[ﾟC/min ]" unit row
      inProg=false;                                      // blank line → table done
    }
    const kv=l.split('\t');
    if(kv.length>=2){const k=kv[0].trim().replace(/[:：]\s*$/,'');const v=kv.slice(1).join('\t').trim();if(k&&v&&!(k in meta))meta[k]=v;}
  }
  if(dataStart<0||dataStart>=lines.length)return null;
  const names=(lines[dataStart-2]||'').split('\t').map(s=>s.trim());
  const units=(lines[dataStart-1]||'').split('\t').map(s=>s.trim());
  const colOf=(re,dflt)=>{const i=names.findIndex(t=>re.test(t));return i>=0?i:dflt;};
  const cTime=colOf(/^time/i,0),cTemp=colOf(/^temp/i,1),cHf=colOf(/^dsc/i,2);
  const timeInMin=/min/i.test(units[cTime]||'');         // exports are seconds; honour a min export
  const rows=[];
  for(let i=dataStart;i<lines.length;i++){
    const c=lines[i].split('\t');if(c.length<3)continue;
    const t=parseFloat(c[cTime]),T=parseFloat(c[cTemp]),d=parseFloat(c[cHf]);
    if(!isFinite(t)||!isFinite(T)||!isFinite(d))continue;
    const hf=-d;                                         // Shimadzu is endotherm-DOWN → flip to endo-up
    rows.push({time:timeInMin?t:t/60,hf_raw:hf,temp:T,hf});
  }
  if(!rows.length)return null;
  // Expand the program table into Pyris-style steps. The table's rate column is unsigned in practice
  // (a cool-down can be written "+20.00"), so the ramp direction comes from from→to, not the sign.
  const methodSteps=[];let cur=rows[0].temp,num=0;
  for(const p of prog){
    if(p.rate>0&&isFinite(p.toT)&&Math.abs(p.toT-cur)>0.5){
      methodSteps.push({num:++num,type:p.toT>cur?'heating':'cooling',fromT:cur,toT:p.toT,rate:p.rate,duration:null});
      cur=p.toT;
    }
    if(p.hold>0)methodSteps.push({num:++num,type:'isothermal',fromT:cur,toT:cur,rate:0,duration:p.hold});
  }
  return {meta,methodSteps,rows,hfFallback:false,vendor:'shimadzu',hfInverted:true};
}
function parsePyrisRawText(txt,fname=''){
  const lines=txt.split('\n');const meta={};const methodSteps=[];let dataStart=-1;
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/^\s*Time\s+Unsubtracted/i.test(l)){dataStart=i+2;break;}
    const kv=l.split('\t');if(kv.length>=2){const k=kv[0].trim().replace(/:$/,'');const v=kv.slice(1).join('\t').trim();if(k&&v)meta[k]=v;}
    const scanMatch=l.match(/^(\d+)\)\s*(Cool|Heat)\s+from\s+([-\d.]+).C\s+to\s+([-\d.]+).C\s+at\s+([\d.]+).C\/min/i);
    if(scanMatch)methodSteps.push({num:+scanMatch[1],type:scanMatch[2].toLowerCase()==='heat'?'heating':'cooling',fromT:+scanMatch[3],toT:+scanMatch[4],rate:+scanMatch[5],duration:null});
    const holdMatch=l.match(/^(\d+)\)\s*Hold\s+for\s+([\d.]+)\s*min\s+at\s+([-\d.]+).C/i);
    if(holdMatch)methodSteps.push({num:+holdMatch[1],type:'isothermal',fromT:+holdMatch[3],toT:+holdMatch[3],rate:0,duration:+holdMatch[2]});
  }
  if(dataStart<0)return null;
  // Resolve the Sample-Temperature and Heat-Flow columns by header name so a different
  // PerkinElmer export layout (inserted/reordered columns) can't silently shift them to
  // the wrong index. The column title spans two header rows (lines[dataStart-2] names,
  // lines[dataStart-1] continuation), e.g. "Sample"+"Temperature", "Uncorrected"+"Heat Flow".
  // Data rows are left-trimmed before splitting, so leading empty header columns are dropped
  // to keep header names aligned with the trimmed data indices. Falls back to the historical
  // fixed layout (temp=4, heat flow=7) when a name can't be matched — proven correct for the
  // standard export, where these resolve to exactly 4 and 7.
  const h1=(lines[dataStart-2]||'').split('\t'), h2=(lines[dataStart-1]||'').split('\t');
  const rawNames=h1.map((t,i)=>(String(t||'').trim()+' '+String(h2[i]||'').trim()).trim());
  let lead=0;while(lead<rawNames.length&&rawNames[lead]==='')lead++;
  const names=rawNames.slice(lead); // names[k] aligns with trimmed data column k
  const cTemp=(()=>{const i=names.findIndex(t=>/sample\s*temp/i.test(t));return i>=0?i:4;})();
  const cHf=(()=>{const i=names.findIndex(t=>/uncorrected\s*heat\s*flow/i.test(t));return i>=0?i:7;})();
  const rows=[];let hfFallback=false;
  for(let i=dataStart;i<lines.length;i++){
    const c=lines[i].trim().split(/\t/);if(c.length<5)continue;
    const n=c.map(v=>parseFloat(v.trim()));if(n.slice(0,5).some(isNaN)||isNaN(n[cTemp]))continue;
    let hf=n[cHf];
    if(isNaN(hf)){hf=n[1];hfFallback=true;} // heat-flow column missing/short: plot the unsubtracted signal, flagged below
    rows.push({time:n[0],hf_raw:n[1],temp:n[cTemp],hf});
  }
  if(!rows.length)return null;
  return {meta,methodSteps,rows,hfFallback,vendor:'pyris',hfInverted:false};
}
// PerkinElmer Pyris "Data Collected" is DD/MM/YYYY [HH:MM:SS] → epoch ms (or null).
function pyrisDate(s){
  const m=String(s||'').trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(!m)return null;
  const d=new Date(+m[3],+m[2]-1,+m[1],+(m[4]||0),+(m[5]||0),+(m[6]||0));
  return isNaN(d.getTime())?null:d.getTime();
}
// Shimadzu splits the timestamp: 収集日 = YY/MM/DD, 収集時間 = HH:MM:SS(+0900).
function shimadzuDate(ds,ts){
  const m=String(ds||'').trim().match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})/);
  if(!m)return null;
  const y=+m[1]<100?2000+ +m[1]:+m[1];
  const t=String(ts||'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const d=new Date(y,+m[2]-1,+m[3],t?+t[1]:0,t?+t[2]:0,(t&&t[3])?+t[3]:0);
  return isNaN(d.getTime())?null:d.getTime();
}
// Header lookups shared by the cache-stat builders, the legend and the ΔH mass — one place per field
// so a vendor's key names never have to be repeated (and diverge) across call sites.
function metaSampleName(meta){
  const v=meta['Sample ID']||meta['Sample']||meta['Sample Name']||meta['試料名']||'';
  return String(v).trim();
}
function metaSampleMass(meta){   // mg
  const v=meta['Sample Weight']||meta['Display Weight']||meta['Weight']||meta['試料量']||'';
  const m=String(v).match(/-?\d+(\.\d+)?/);
  return m?+m[0]:null;
}
function metaEpoch(meta){
  const ep=pyrisDate(meta['Data Collected']||meta['Run Date']||meta['Date/Time']||'');
  return ep!=null?ep:shimadzuDate(meta['収集日'],meta['収集時間']);
}
function assignSegments(rows,methodSteps){
  if(!methodSteps.length)return autoSegments(rows);
  const N=rows.length,segments=[],time0=rows[0].time,time1=rows[N-1].time,measuredTotal=Math.max(1e-6,time1-time0);
  const rawDur=methodSteps.map(st=>st.type==='isothermal'?Math.max(0,st.duration||0):((!isFinite(st.rate)||st.rate<=0)?0:Math.max(0,Math.abs(st.toT-st.fromT)/st.rate)));
  let predTotal=rawDur.reduce((a,b)=>a+b,0);if(!isFinite(predTotal)||predTotal<=0)predTotal=measuredTotal;
  const scale=measuredTotal/predTotal,cumEnds=[];let acc=0;rawDur.map(d=>Math.max(0,d*scale)).forEach(d=>{acc+=d;cumEnds.push(acc);});
  let cursor=0;
  methodSteps.forEach((step,si)=>{
    if(cursor>=N-1)return;
    let endIdx=si===methodSteps.length-1?N-1:Math.max(cursor+5,Math.min(nearestTimeIndex(rows,time0+cumEnds[si]),N-2));
    if(endIdx<=cursor)endIdx=Math.min(cursor+10,N-1);
    const sl=rows.slice(cursor,endIdx+1);
    segments.push({...step,start:cursor,end:endIdx,tmin:slMin(sl),tmax:slMax(sl),tStart:rows[cursor].time,tEnd:rows[endIdx].time});
    cursor=endIdx+1;
  });
  if(!segments.length)return autoSegments(rows);
  const last=segments[segments.length-1];
  if(last.end<N-1){last.end=N-1;const sl=rows.slice(last.start,last.end+1);last.tmin=slMin(sl);last.tmax=slMax(sl);last.tEnd=rows[last.end].time;}
  return segments;
}
function autoSegments(rows){
  const segs=[];let dir=0,ss=0,idx=0;const sm=10;
  const ld=i=>rows[Math.min(rows.length-1,i+sm)].temp-rows[Math.max(0,i-sm)].temp;
  for(let i=sm;i<rows.length-sm;i+=5){
    const d=ld(i),nd=Math.abs(d)<0.5?0:(d>0?1:-1);
    if(nd!==dir&&i-ss>100){
      if(i-ss>200){const sl=rows.slice(ss,i),tp=dir===1?'heating':dir===-1?'cooling':'isothermal';segs.push({num:idx+1,type:tp,start:ss,end:i-1,rate:15,tmin:slMin(sl),tmax:slMax(sl),tStart:rows[ss].time,tEnd:rows[i-1].time});idx++;}
      ss=i;dir=nd;
    }
  }
  if(rows.length-ss>200){const sl=rows.slice(ss),tp=dir===1?'heating':dir===-1?'cooling':'isothermal';segs.push({num:idx+1,type:tp,start:ss,end:rows.length-1,rate:15,tmin:slMin(sl),tmax:slMax(sl),tStart:rows[ss].time,tEnd:rows[rows.length-1].time});}
  return segs;
}
function nearestTimeIndex(rows,t){
  if(!rows.length)return -1;if(t<=rows[0].time)return 0;if(t>=rows[rows.length-1].time)return rows.length-1;
  let lo=0,hi=rows.length-1;while(lo<hi-1){const m=(lo+hi)>>1;if(rows[m].time<=t)lo=m;else hi=m;}
  return Math.abs(rows[lo].time-t)<=Math.abs(rows[hi].time-t)?lo:hi;
}
