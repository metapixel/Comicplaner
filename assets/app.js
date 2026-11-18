/*!
 * Comic-Planer – App
 * Copyright (C) 2026 Kai Kranz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Quellcode: https://github.com/metapixel/Comicplaner
 */
"use strict";
const STATUS = [
  {k:"interessant", l:"Interessant", c:"var(--s-int)"},
  {k:"kaufen", l:"Kaufen", c:"var(--s-kauf)"},
  {k:"bestellt", l:"Bestellt", c:"var(--s-best)"},
  {k:"da", l:"Da", c:"var(--s-da)"},
  {k:"verworfen", l:"Verworfen", c:"var(--s-weg)"},
];
const SLABEL = Object.fromEntries(STATUS.map(s=>[s.k,s.l]));
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const MSHORT = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
const FIELDS = {title:"Titel", subtitle:"Untertitel", authors:"Urheber", publisher:"Verlag", dateRaw:"Erscheinungstermin", price:"Preis"};

let CSRF = document.querySelector('meta[name="csrf-token"]')?.content || "";
const ME = (()=>{ const m=document.querySelector('meta[name="cp-user"]'); return m?{id:m.content, name:m.dataset.name, admin:m.dataset.admin==="1", mustChange:m.dataset.mustchange==="1"}:{id:"0"}; })();
const UI_KEY="comicplaner-ui-"+ME.id;
try{ ["comicplaner-ui","comicplaner-cache","comicplaner-queue"].forEach(k=>localStorage.removeItem(k)); }catch(e){}   // Speicher aus Version 1.x
async function api(action, body, retried){
  const opt = body===undefined ? {method:"GET",credentials:"same-origin"} :
    {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-CSRF-Token":CSRF},body:JSON.stringify(body)};
  let res;
  try{ res = await fetch("api.php?a="+action, opt); }
  catch(e){ throw {code:"offline", message:"Keine Verbindung zum Server."}; }
  if(res.status===401){ location.href="login.php"; throw {code:"auth",message:"Nicht angemeldet"}; }
  if(res.status===403 && body!==undefined && !retried){   // Sicherheitsschlüssel veraltet → neu holen, einmal wiederholen
    try{ const t=await (await fetch("api.php?a=csrf",{credentials:"same-origin"})).json(); if(t&&t.csrf){ CSRF=t.csrf; return api(action,body,true); } }catch(e){}
  }
  let data=null; try{ data=await res.json(); }catch(e){}
  if(!res.ok || !data || !data.ok) throw {code:"server", message:(data&&data.error)||("Serverfehler "+res.status)};
  return data;
}
let items = new Map();          // isbn -> data
let meta = {imports:[], latestImportId:null};
let latestIsbns = null;         // Set or null
let loaded = false;
const ui = {
  q:"", pub:"", range:"ab",
  statuses:new Set(["interessant","kaufen","bestellt","da"]),
  open:new Set(), closed:new Set(), view:"liste", maybe:false, table:false,
  colStatuses:new Set(["da","bestellt","kaufen"]), colOpen:new Set()
};
try{ const s=JSON.parse(localStorage.getItem(UI_KEY)||"null");
  if(s){ ui.range=s.range||ui.range; if(s.view) ui.view=s.view; ui.maybe=!!s.maybe; if(Array.isArray(s.statuses)) ui.statuses=new Set(s.statuses); if(Array.isArray(s.closed)) ui.closed=new Set(s.closed); if(Array.isArray(s.colStatuses)) ui.colStatuses=new Set(s.colStatuses); }
}catch(e){}
function saveUi(){ try{ localStorage.setItem(UI_KEY, JSON.stringify({range:ui.range,statuses:[...ui.statuses],closed:[...ui.closed],view:ui.view,maybe:ui.maybe,colStatuses:[...ui.colStatuses]})); }catch(e){} }

const $ = s=>document.querySelector(s);
const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const eur = n=> (n==null||isNaN(n)) ? "–" : n.toLocaleString("de-DE",{style:"currency",currency:"EUR"});
function toast(t){ const el=$("#toast"); el.textContent=t; el.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove("show"),2200); }
function banner(t){ $("#banner").hidden=!t; $("#bannerText").textContent=t||""; }
const nowMonth = (()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); })();

/* ---------- normalisation (identical rules for every import) ---------- */
function normIsbn(v){
  let s=String(v??"").toUpperCase().replace(/[^0-9X]/g,"");
  if(s.length===10){ const b="978"+s.slice(0,9); let sum=0; for(let i=0;i<12;i++) sum+=(+b[i])*(i%2?3:1); s=b+((10-sum%10)%10); }
  return /^\d{13}$/.test(s)?s:"";
}
function parsePrice(v){
  if(v==null||v==="") return null;
  if(typeof v==="number") return Math.round(v*100)/100;
  const s=String(v).replace(/[^\d,.-]/g,"");
  if(!s) return null;
  const n = s.includes(",") ? parseFloat(s.replace(/\./g,"").replace(",",".")) : parseFloat(s);
  return isNaN(n)?null:n;
}
function parseDate(v){
  const raw=String(v??"").trim();
  let d="",m="";
  let x;
  if((x=raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))){ m=x[3]+"-"+x[2].padStart(2,"0"); d=m+"-"+x[1].padStart(2,"0"); }
  else if((x=raw.match(/^(\d{1,2})[./](\d{4})$/))){ m=x[2]+"-"+x[1].padStart(2,"0"); }
  else if((x=raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/))){ m=x[1]+"-"+x[2]; if(x[3]) d=m+"-"+x[3]; }
  else if((x=raw.match(/^(\d{4})$/))){ m=x[1]+"-00"; }   // nur Jahr bekannt
  if(m && +m.slice(0,4)>=2090){ m=""; d=""; }   // VLB-Platzhalter wie 01.2099
  return {dateRaw:raw, date:d, month:m};
}
function cleanAuthors(s){ return String(s??"").trim().replace(/^von\s+/i,""); }
function titleKey(t,s){
  return (String(t||"")+" "+String(s||"")).toLowerCase()
    .replace(/\(.*?\)/g," ").replace(/\b(bd|band|vol|volume|teil|nr)\b\.?/g," ")
    .replace(/[^a-z0-9äöüß]+/g," ").trim().replace(/\s+/g," ");
}

const HEADERS = {
  isbn:["produkt","isbn","isbn-13","isbn13","isbn 13","ean","gtin","ean/isbn"],
  title:["titel","title","haupttitel"],
  subtitle:["untertitel","subtitle"],
  authors:["urheber","autor","autoren","verfasser","beteiligte","mitwirkende"],
  publisher:["verlag","publisher"],
  date:["erscheinungsdatum","erscheinungstermin","erscheint","erscheinungsjahr"],
  price:["eur de","preis","preis eur","preis de","eur","ladenpreis"],
  priceSub:["eur de subskriptionspreis","subskriptionspreis"]
};
function mapHeaders(hdr){
  const low=hdr.map(h=>String(h||"").trim().toLowerCase());
  const map={};
  for(const [k,syn] of Object.entries(HEADERS)){
    let idx=-1;
    for(const s of syn){ idx=low.indexOf(s); if(idx>=0) break; }
    map[k]=idx;
  }
  return map;
}

/* ---------- import ---------- */
let XLSXready=null;
function loadXLSX(){
  if(window.XLSX) return Promise.resolve();
  return Promise.reject(new Error("Excel-Bibliothek (assets/xlsx.full.min.js) fehlt."));
}
async function readFile(file){
  await loadXLSX();
  const buf=await file.arrayBuffer();
  let wb;
  if(/\.(csv|txt)$/i.test(file.name)){
    let text=new TextDecoder("utf-8").decode(buf);
    if(text.includes(String.fromCharCode(0xFFFD))) text=new TextDecoder("windows-1252").decode(buf);
    const first=text.split(/\r?\n/)[0]||"";
    const FS=(first.split(";").length>first.split(",").length)?";":(first.includes("\t")?"\t":",");
    wb=XLSX.read(text,{type:"string",FS,raw:true});
  } else {
    wb=XLSX.read(buf,{type:"array",raw:false});
  }
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:""});
  // header row = first row containing a recognisable ISBN column
  let hi=rows.findIndex(r=>{const m=mapHeaders(r); return m.isbn>=0 && m.title>=0;});
  if(hi<0) throw new Error("Keine Spalten für ISBN/Produkt und Titel gefunden.");
  const map=mapHeaders(rows[hi]);
  const out=[]; let skipped=0;
  for(const r of rows.slice(hi+1)){
    if(!r.some(c=>String(c).trim())) continue;
    const isbn=normIsbn(r[map.isbn]);
    if(!isbn){ skipped++; continue; }
    const g=k=>map[k]>=0 ? String(r[map[k]]??"").trim() : "";
    const dt=parseDate(g("date"));
    out.push({isbn, title:g("title"), subtitle:g("subtitle"), authors:cleanAuthors(g("authors")),
      publisher:g("publisher"), ...dt, price:parsePrice(g("price")), priceSub:parsePrice(g("priceSub"))});
  }
  return {rows:out, skipped, header:rows[hi], map};
}

function analyse(rows){
  const seen=new Map(), dupInFile=[], neu=[], changed=[], same=[];
  for(const r of rows){
    if(seen.has(r.isbn)){ dupInFile.push(r); continue; }
    seen.set(r.isbn,r);
    const ex=items.get(r.isbn);
    if(!ex){ neu.push(r); continue; }
    const diffs=[];
    for(const f of Object.keys(FIELDS)){
      const a=ex[f]??(f==="price"?null:""), b=r[f]??(f==="price"?null:"");
      if(f==="price"){ if(b!=null && a!==b) diffs.push({field:f,from:a,to:b}); }
      else if(b && String(a)!==String(b)) diffs.push({field:f,from:a,to:b});
    }
    (diffs.length?changed:same).push({row:r, ex, diffs});
  }
  // gone: known items not in this file
  const gone=[...items.values()].filter(x=>!seen.has(x.isbn));
  // possible duplicates by title (new items vs existing, or new vs new)
  const keyMap=new Map();
  for(const x of items.values()){ const k=titleKey(x.title,x.subtitle); if(k) (keyMap.get(k)||keyMap.set(k,[]).get(k)).push(x); }
  const similar=[];
  for(const r of neu){ const k=titleKey(r.title,r.subtitle); if(!k) continue; const hit=(keyMap.get(k)||[]).filter(x=>x.isbn!==r.isbn);
    if(hit.length) similar.push({row:r, hits:hit}); (keyMap.get(k)||keyMap.set(k,[]).get(k)).push(r); }
  return {neu, changed, same, dupInFile, gone, similar, total:seen.size};
}

/* ---------- helpers ---------- */
function dbErr(e){ return (e&&e.message) || "Speichern fehlgeschlagen."; }

/* ---------- import dialog ---------- */
function openModal(html){ $("#modal").innerHTML=html; $("#modalBg").classList.add("show"); }
function closeModal(){ $("#modalBg").classList.remove("show"); }
$("#modalBg").addEventListener("click",e=>{ if(e.target.id==="modalBg" && !busy && !forcePw) closeModal(); });
let forcePw=false;
let busy=false;

function showImportStart(){
  openModal(`<h2>VLB-TIX Merkliste importieren</h2>
    <div class="sub">Excel (.xlsx) oder CSV aus VLB-TIX. Vor dem Speichern siehst du, was neu ist, was sich geändert hat und welche Titel doppelt sind.</div>
    <label class="dropzone" id="dz"><input type="file" id="file" accept=".xlsx,.xls,.csv,.txt" hidden>
      <b>Datei hierher ziehen</b><br><span style="color:var(--muted);font-size:13px">oder klicken zum Auswählen</span></label>
    <div class="err" id="ierr"></div>
    <div class="actions"><button class="btn ghost" id="cancel">Abbrechen</button></div>`);
  const dz=$("#dz");
  $("#file").addEventListener("change",e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag");}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag");}));
  dz.addEventListener("drop",e=>{ const f=e.dataTransfer.files[0]; if(f) handleFile(f); });
  $("#cancel").onclick=closeModal;
}
async function handleFile(file){
  if(!loaded){ $("#ierr").textContent="Daten sind noch nicht geladen – bitte kurz warten."; return; }
  try{
    $("#ierr").textContent="Lese Datei …";
    const parsed=await readFile(file);
    showPreview(file.name, parsed, analyse(parsed.rows));
  }catch(e){ $("#ierr").textContent=e.message||String(e); }
}
function line(r,extra=""){
  return `<div><b>${esc(r.title)}</b>${r.subtitle?" · "+esc(r.subtitle):""}
    <div class="meta">${esc(r.publisher)} · ${esc(r.dateRaw||"ohne Termin")} · ${eur(r.price)} · <span class="mono">${r.isbn}</span>${r.status?" · "+SLABEL[r.status]:""}</div>${extra}</div>`;
}
function fmtVal(f,v){ return f==="price"?eur(v):esc(v||"–"); }
function showPreview(fname, parsed, A){
  const first=items.size===0;
  const tabs=[
    {k:"neu",l:"Neu",n:A.neu.length,html:()=>A.neu.map(r=>line(r)).join("")},
    {k:"changed",l:"Geändert",n:A.changed.length,html:()=>A.changed.map(c=>line({...c.row,status:c.ex.status},
      c.diffs.map(d=>`<div class="diff">${FIELDS[d.field]}: ${fmtVal(d.field,d.from)} → ${fmtVal(d.field,d.to)}</div>`).join(""))).join("")},
    {k:"similar",l:"Mögliche Dubletten",n:A.similar.length,html:()=>A.similar.map(s=>line(s.row,
      `<div class="diff">ähnlich wie: ${s.hits.map(h=>esc(h.title)+" ("+h.isbn+")").join(", ")}</div>`)).join("")},
    {k:"dup",l:"Doppelt in Datei",n:A.dupInFile.length,html:()=>A.dupInFile.map(r=>line(r)).join("")},
    {k:"same",l:"Unverändert",n:A.same.length,html:()=>A.same.map(c=>line({...c.row,status:c.ex.status})).join("")},
    {k:"gone",l:"Nicht mehr in Liste",n:first?0:A.gone.length,html:()=>A.gone.map(r=>line(r)).join("")},
  ];
  let cur=tabs.find(t=>t.n)?.k||"neu";
  openModal(`<h2>Import prüfen</h2>
    <div class="sub">${esc(fname)} · ${A.total} Titel erkannt${parsed.skipped?` · ${parsed.skipped} Zeilen ohne gültige ISBN übersprungen`:""}</div>
    <div class="sumgrid" id="sg"></div>
    <div class="plist" id="pl"></div>
    <div class="opts">
      <label><input type="checkbox" id="oNew" checked> ${A.neu.length} neue Titel übernehmen (Status „Interessant“)</label>
      <label><input type="checkbox" id="oChg" checked ${A.changed.length?"":"disabled"}> ${A.changed.length} Änderungen übernehmen (Status &amp; Notizen bleiben erhalten)</label>
      ${!first && A.gone.length?`<span style="color:var(--muted);font-size:13px">${A.gone.length} Titel fehlen in dieser Datei. Sie bleiben erhalten und werden als „nicht mehr in Merkliste“ markiert.</span>`:""}
    </div>
    <div class="progress" id="prog"><i></i></div><div class="err" id="ierr"></div>
    <div class="actions"><button class="btn ghost" id="cancel">Abbrechen</button><button class="btn" id="go">Import speichern</button></div>`);
  const renderTabs=()=>{
    $("#sg").innerHTML=tabs.map(t=>`<div class="sumbox ${t.k===cur?"on":""}" data-k="${t.k}"><b>${t.n}</b><span>${t.l}</span></div>`).join("");
    const t=tabs.find(t=>t.k===cur);
    $("#pl").innerHTML=t.n?t.html():`<div class="meta">Keine Einträge.</div>`;
  };
  renderTabs();
  $("#sg").addEventListener("click",e=>{ const b=e.target.closest(".sumbox"); if(b){ cur=b.dataset.k; renderTabs(); } });
  $("#cancel").onclick=()=>{ if(!busy) closeModal(); };
  $("#go").onclick=()=>commitImport(fname,A,$("#oNew").checked,$("#oChg").checked);
}

async function commitImport(fname,A,doNew,doChg){
  if(busy) return; busy=true;
  $("#go").disabled=true; $("#cancel").disabled=true;
  const prog=$("#prog"); prog.style.display="block"; prog.firstChild.style.width="40%";
  const rows=[...A.neu,...A.changed.map(c=>c.row),...A.same.map(c=>c.row)].map(r=>({...r,titleKey:titleKey(r.title,r.subtitle)}));
  try{
    const r=await api("import",{file:fname,rows,doNew,doChg});
    prog.firstChild.style.width="100%";
    await load();
    busy=false; closeModal();
    toast(`Import gespeichert: ${r.neu} neu, ${r.geaendert} geändert`);
  }catch(e){
    busy=false;
    $("#ierr").textContent=dbErr(e);
    $("#cancel").disabled=false; $("#go").disabled=false; $("#cancel").textContent="Schließen";
  }
}

/* ---------- item actions ---------- */
function setStatus(isbn,s){
  const it=items.get(isbn); if(!it||it.status===s) return;
  const prev=it.status; it.status=s; render();
  saveCache();
  send("status",{isbn,status:s}).catch(e=>{ it.status=prev; render(); toast(dbErr(e)); });
}
const noteTimers=new Map();
function setNote(isbn,v){
  const it=items.get(isbn); if(!it) return;
  clearTimeout(noteTimers.get(isbn));
  noteTimers.set(isbn,setTimeout(()=>{
    if((it.note||"")===v) return; it.note=v;
    it._s=null; saveCache();
    send("note",{isbn,note:v}).then(r=>toast(r&&r.queued?"Notiz gespeichert – wird übertragen, sobald du online bist":"Notiz gespeichert"),e=>toast(dbErr(e)));
  },700));
}

/* ---------- Reihe, Band, Suche ---------- */
const isFree=it=>String(it.isbn||"").startsWith("F");
function dispTitle(it){ return it.series ? it.series+(it.volume?" "+it.volume:"") : (it.title||""); }
function dispSub(it){ return it.series ? (it.title||"") : (it.subtitle||""); }
function itemKey(it){ return it.titleKey || titleKey(dispTitle(it), dispSub(it)); }
const fold=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss");
function qMatch(it,q){
  if(!it._s) it._s=fold([it.series,it.volume,it.title,it.subtitle,it.authors,isFree(it)?"":it.isbn,it.note,it.publisher,(it.tags||[]).join(" ")].join(" "));
  return fold(q).split(/\s+/).filter(Boolean).every(w=>it._s.includes(w));
}
function haveLabel(it){
  const st=it.status||"interessant";
  return st==="da"?"vorhanden":st==="bestellt"?"bestellt":st==="kaufen"?"noch kaufen":st==="verworfen"?"verworfen":"Wunschliste";
}

/* ---------- rendering ---------- */
function monthLabel(m){ if(!m) return "Ohne Termin"; if(m.endsWith("-00")) return m.slice(0,4)+" · ohne Monat"; return MONTHS[+m.slice(5,7)-1]+" "+m.slice(0,4); }
function flags(it){
  const f=[];
  const imps=meta.imports||[];
  if(imps.length>1 && it.firstImportId===meta.latestImportId) f.push(`<span class="tag">neu</span>`);
  if(it.changedImportId && it.changedImportId===meta.latestImportId){
    const dch=(it.history||[]).find(h=>h.field==="dateRaw" && h.importId===it.changedImportId);
    f.push(`<span class="tag warn">${dch?"Termin geändert":"geändert"}</span>`);
  }
  if(latestIsbns && (it.source||"vlb")==="vlb" && !latestIsbns.has(it.isbn) && it.firstImportId!==meta.latestImportId) f.push(`<span class="tag grey">nicht mehr in Merkliste</span>`);
  if(it._similar) f.push(`<span class="tag warn" title="Gleicher Titel wie ${esc(it._similar)}">Dublette?</span>`);
  return f.join("");
}
function matches(it){
  if(ui.pub && it.publisher!==ui.pub) return false;
  if(ui.q) return qMatch(it,ui.q);          // Suche durchsucht immer alles
  if(!ui.statuses.has(it.status||"interessant")) return false;
  if(!it.month && it.status==="da") return false;   // Sammlung ohne Termin gehört nicht in die Planung
  return true;
}
function inRange(m){
  if(ui.q || ui.range==="alle") return true;
  if(!m) return ui.range==="ab";
  return ui.range==="ab" ? m>=nowMonth : m<nowMonth;
}
function render(){
  const all=[...items.values()];
  // similar-title detection across the whole list
  const km=new Map(); for(const it of all){ delete it._similar; const k=itemKey(it); if(k)(km.get(k)||km.set(k,[]).get(k)).push(it); }
  for(const arr of km.values()) if(arr.length>1) for(const it of arr) it._similar=arr.filter(x=>x!==it).map(x=>x.isbn).join(", ");

  // stats
  const cnt=s=>all.filter(x=>(x.status||"interessant")===s).length;
  const sum=f=>all.filter(f).reduce((a,x)=>a+(x.price||0),0);
  $("#stats").innerHTML=[
    [all.length,"Titel"],[cnt("kaufen"),"Kaufen"],[cnt("bestellt"),"Bestellt"],[cnt("da"),"Da"],
    [eur(sum(x=>(x.status==="kaufen"||x.status==="bestellt") && (x.month||"9")>=nowMonth)),"offen geplant"]
  ].map(([b,s])=>`<div class="stat"><b>${b}</b><span>${s}</span></div>`).join("");
  const li=(meta.imports||[])[0];
  $("#lastImport").textContent= li ? `Letzter Import: ${new Date(li.at).toLocaleDateString("de-DE")} · ${li.file}` : "VLB-TIX Merkliste · Monatsplanung";

  // publisher select
  const pubs=[...new Set(all.map(x=>x.publisher).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"));
  const ps=$("#pub"); const pv=ui.pub;
  ps.innerHTML=`<option value="">Alle Verlage</option>`+pubs.map(p=>`<option ${p===pv?"selected":""}>${esc(p)}</option>`).join("");

  // status chips
  const curSt = ui.view==="sammlung" ? ui.colStatuses : ui.statuses;
  $("#statusChips").innerHTML=STATUS.map(s=>`<button class="chip ${curSt.has(s.k)?"on":""}" data-s="${s.k}"><span class="dot" style="background:${s.c}"></span>${s.l} <span style="opacity:.7">${cnt(s.k)}</span></button>`).join("");
  $("#statusChips").classList.toggle("dim", !!ui.q);

  document.body.classList.toggle("view-stat", ui.view==="stat");
  document.body.classList.toggle("view-col", ui.view==="sammlung");
  for(const b of document.querySelectorAll("#viewSeg button")) b.classList.toggle("on", b.dataset.v===ui.view);
  const main=$("#main");
  if(all.length && ui.view==="stat"){ $("#monthNav").innerHTML=""; renderStats(all); return; }
  if(all.length && ui.view==="sammlung"){ renderCollection(all); return; }
  if(!all.length){
    main.innerHTML=`<div class="empty drop" id="emptyDrop"><h2>Noch keine Titel</h2><p>Exportiere deine Merkliste in VLB-TIX als Excel oder CSV und importiere sie hier.</p><button class="btn" data-act="import">Merkliste importieren</button></div>`;
    $("#monthNav").innerHTML=""; return;
  }
  const vis=all.filter(matches);
  const groups=new Map();
  let hiddenRange=0;
  for(const it of vis){ const m=it.month||""; if(!inRange(m)){ hiddenRange++; continue; } (groups.get(m)||groups.set(m,[]).get(m)).push(it); }
  const keys=[...groups.keys()].sort((a,b)=> (a||"9999")<(b||"9999")?-1:1);
  if(ui.range==="past") keys.reverse();

  let html=ui.q?`<p class="hint">Suche in allen ${all.length} Titeln – Filter und Zeitraum sind dabei aus. <b>${vis.length}</b> Treffer.</p>`:`<p class="hint">${vis.length-hiddenRange} von ${all.length} Titeln angezeigt`;
  if(!ui.q){
  if(hiddenRange && ui.range==="ab") html+=` · ${hiddenRange} bereits erschienen <button data-act="showall">alle zeigen</button>`;
  const DEF=["interessant","kaufen","bestellt","da"]; if(!(ui.statuses.size===4 && DEF.every(k=>ui.statuses.has(k)))) html+=` · Filter aktiv <button data-act="allstatus">alle Status</button>`;
  html+=`</p>`; }
  if(!keys.length) html+=`<div class="empty"><p>Keine Titel für diese Filter.</p></div>`;
  for(const m of keys){
    const list=groups.get(m).sort((a,b)=>(a.date||a.month||"z").localeCompare(b.date||b.month||"z")||dispTitle(a).localeCompare(dispTitle(b),"de",{numeric:true}));
    const plan=list.filter(x=>x.status==="kaufen").reduce((a,x)=>a+(x.price||0),0);
    const best=list.filter(x=>x.status==="bestellt").reduce((a,x)=>a+(x.price||0),0);
    const da=list.filter(x=>x.status==="da").length;
    const id="m-"+(m||"offen");
    const past=m && m<nowMonth;
    html+=`<section class="month ${ui.closed.has(id)?"closed":""}" id="${id}">
      <div class="mhead ${past?"past":""}" data-toggle="${id}"><h2><span class="caret">▾</span>${monthLabel(m)}</h2>
      <div class="meta"><span><b>${list.length}</b> Titel</span>${plan?`<span>Kaufen <b>${eur(plan)}</b></span>`:""}${best?`<span>Bestellt <b>${eur(best)}</b></span>`:""}${da?`<span><b>${da}</b> da</span>`:""}</div></div>
      <div class="items">${list.map(itemHtml).join("")}</div></section>`;
  }
  main.innerHTML=html;

  // month nav
  let nav="", lastY="";
  for(const m of keys){ const y=m?m.slice(0,4):"–"; if(y!==lastY){ nav+=`<div class="yr">${m?y:"Offen"}</div>`; lastY=y; }
    nav+=`<a href="#m-${m||"offen"}" data-jump="m-${m||"offen"}"><span>${!m?"Ohne Termin":m.endsWith("-00")?m.slice(0,4)+" (Jahr)":MSHORT[+m.slice(5,7)-1]+" "+m.slice(2,4)}</span><span class="n">${groups.get(m).length}</span></a>`; }
  $("#monthNav").innerHTML=nav;
}
function itemHtml(it){
  const st=it.status||"interessant";
  const d=it.date?new Date(it.date+"T12:00:00"):null;
  const day=d?`<div class="day"><b>${d.getDate()}</b><span>${MSHORT[d.getMonth()]}</span></div>`:(it.month&&it.month.endsWith("-00")?`<div class="day unk"><b>${it.month.slice(0,4)}</b><span>Jahr</span></div>`:`<div class="day unk"><b>${it.month?MSHORT[+it.month.slice(5,7)-1]:"?"}</b><span>${it.month?"ohne Tag":"offen"}</span></div>`);
  const open=ui.open.has(it.isbn);
  return `<div class="item st-${st} ${open?"open":""}" data-isbn="${it.isbn}">
    <div class="row" data-row>
      ${day}
      <div class="ttl"><div class="t">${ui.q?`<span class="have st-${st}">${haveLabel(it)}</span> `:""}${esc(dispTitle(it))}${dispSub(it)?` <span class="sub">· ${esc(dispSub(it))}</span>`:""}<span class="tags">${it.publisher?`<span class="tag pub">${esc(shortPub(it.publisher))}</span>`:""}${it.read?`<span class="tag ok">gelesen</span>`:""}${(it.tags||[]).map(t=>`<span class="tag grey">${esc(t)}</span>`).join("")}${flags(it)}${it.note?`<span class="tag grey" title="${esc(it.note)}">Notiz</span>`:""}</span></div>
        <div class="a">${esc(it.authors)}</div></div>
      <div class="right"><span class="price mono">${eur(it.price)}</span>
        <div class="seg">${STATUS.map(s=>`<button data-s="${s.k}" class="${s.k===st?"on":""}">${s.l}</button>`).join("")}</div></div>
    </div>
    ${open?detailHtml(it):`<div class="detail"></div>`}
  </div>`;
}
function shortPub(p){ return String(p||"").replace(/\s+(Verlags\s+GmbH|GmbH(\s*&\s*Co\.?\s*KG)?|Verlag GmbH)$/i,""); }
function detailHtml(it){
  const hist=(it.history||[]).map(h=>`<li>${new Date(h.at).toLocaleDateString("de-DE")}: ${FIELDS[h.field]||h.field} ${fmtVal(h.field,h.from)} → ${fmtVal(h.field,h.to)}</li>`).join("");
  return `<div class="detail">
    <div class="dgrid">
      <div><span>ISBN</span>${isFree(it)?`<span style="color:var(--muted)">ohne ISBN</span>`:`<span class="mono" style="font-size:13px;text-transform:none;color:var(--ink)">${it.isbn}</span> <button class="copy" data-copy="${it.isbn}">kopieren</button>`}</div>
      <div><span>Verlag</span>${esc(it.publisher)}</div>
      <div><span>Erscheinungstermin</span>${esc(it.dateRaw||"offen")}</div>
      <div><span>Preis DE</span>${eur(it.price)}${it.priceSub?` · Subskription ${eur(it.priceSub)}`:""}</div>
      <div><span>Auf der Liste seit</span>${it.firstSeen?new Date(it.firstSeen).toLocaleDateString("de-DE"):"–"}</div>
      ${it._similar?`<div><span>Mögliche Dublette von</span><span class="mono" style="font-size:12.5px;text-transform:none;color:var(--warn)">${esc(it._similar)}</span></div>`:""}
    </div>
    <textarea data-note placeholder="Notiz, z. B. wo bestellt, Variant-Cover, Budget …">${esc(it.note||"")}</textarea>
    ${hist?`<ul class="hist">${hist}</ul>`:""}
    <div class="detail-actions"><label class="chk"><input type="checkbox" data-readchk ${it.read?"checked":""}> gelesen</label><span style="flex:1"></span><button class="copy" data-edit>Bearbeiten</button><button class="copy" data-del>Titel entfernen</button></div>
  </div>`;
}

/* ---------- events ---------- */
$("#q").addEventListener("input",e=>{ ui.q=e.target.value.trim(); render(); });
$("#pub").addEventListener("change",e=>{ ui.pub=e.target.value; render(); });
$("#range").value=ui.range;
$("#range").addEventListener("change",e=>{ ui.range=e.target.value; saveUi(); render(); });
$("#importBtn").addEventListener("click",()=>showImportStart());
$("#statusChips").addEventListener("click",e=>{ const b=e.target.closest(".chip"); if(!b) return;
  const key=ui.view==="sammlung"?"colStatuses":"statuses";
  const s=b.dataset.s; if(e.altKey||e.metaKey){ ui[key]=new Set([s]); } else ui[key].has(s)?ui[key].delete(s):ui[key].add(s);
  saveUi(); render(); });
$("#main").addEventListener("click",e=>{
  const act=e.target.closest("[data-act]");
  if(act && act.dataset.act==="import"){ showImportStart(); return; }
  if(act){ if(act.dataset.act==="showall"){ ui.range="alle"; $("#range").value="alle"; }
    if(act.dataset.act==="allstatus") ui.statuses=new Set(STATUS.map(s=>s.k)); saveUi(); render(); return; }
  const tg=e.target.closest("[data-toggle]");
  if(tg){ const id=tg.dataset.toggle; ui.closed.has(id)?ui.closed.delete(id):ui.closed.add(id); saveUi(); tg.parentElement.classList.toggle("closed"); return; }
  const cp=e.target.closest("[data-copy]");
  if(cp){ navigator.clipboard?.writeText(cp.dataset.copy).then(()=>toast("ISBN kopiert"),()=>toast(cp.dataset.copy)); return; }
  const item=e.target.closest(".item"); if(!item) return;
  const isbn=item.dataset.isbn;
  const sb=e.target.closest(".seg button");
  if(sb){ setStatus(isbn,sb.dataset.s); return; }
  const del=e.target.closest("[data-del]");
  if(del){ confirmDelete(isbn); return; }
  if(e.target.closest("[data-edit]")){ showEdit(isbn); return; }
  if(e.target.closest("[data-readchk]")){ setRead(isbn, e.target.closest("[data-readchk]").checked); return; }
  if(e.target.closest("[data-row]")){
    ui.open.has(isbn)?ui.open.delete(isbn):ui.open.add(isbn);
    const it=items.get(isbn);
    item.classList.toggle("open");
    item.querySelector(".detail").outerHTML=ui.open.has(isbn)?detailHtml(it):`<div class="detail"></div>`;
  }
});
$("#main").addEventListener("input",e=>{ if(e.target.matches("[data-note]")){ const isbn=e.target.closest(".item").dataset.isbn; setNote(isbn,e.target.value); } });
$("#monthNav").addEventListener("click",e=>{ const a=e.target.closest("[data-jump]"); if(!a) return; e.preventDefault();
  const id=a.dataset.jump; if(ui.closed.has(id)){ ui.closed.delete(id); saveUi(); document.getElementById(id)?.classList.remove("closed"); }
  document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"}); });
document.addEventListener("dragover",e=>{ if(!$("#modalBg").classList.contains("show")) e.preventDefault(); });
document.addEventListener("drop",e=>{ if($("#modalBg").classList.contains("show")) return; e.preventDefault();
  const f=e.dataTransfer?.files?.[0]; if(f){ showImportStart(); handleFile(f); } });

/* ---------- Menü, Export, Passwort, Entfernen ---------- */
const menuBtn=$("#menuBtn"), menuPop=$("#menuPop");
menuBtn.addEventListener("click",e=>{ e.stopPropagation(); menuPop.hidden=!menuPop.hidden; menuBtn.setAttribute("aria-expanded",String(!menuPop.hidden)); });
document.addEventListener("click",e=>{ if(!menuPop.hidden && !e.target.closest(".menu")){ menuPop.hidden=true; menuBtn.setAttribute("aria-expanded","false"); } });

$("#exportBtn").addEventListener("click",()=>{
  menuPop.hidden=true;
  const vis=[...items.values()].filter(it=>matches(it) && inRange(it.month||""))
    .sort((a,b)=>(a.month||"9999").localeCompare(b.month||"9999")||(a.date||"").localeCompare(b.date||"")||a.title.localeCompare(b.title,"de"));
  const q=v=>{ const t=String(v??""); return /[;"\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
  const head=["ISBN","Titel","Untertitel","Urheber","Verlag","Erscheinungstermin","Monat","Preis EUR","Status","Notiz"];
  const lines=[head.join(";"),...vis.map(it=>[it.isbn,it.title,it.subtitle,it.authors,it.publisher,it.dateRaw,monthLabel(it.month||""),
    it.price!=null?String(it.price).replace(".",","):"",SLABEL[it.status||"interessant"],it.note].map(q).join(";"))];
  const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download="comic-planer-"+new Date().toISOString().slice(0,10)+".csv"; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
  toast(vis.length+" Titel exportiert (aktuelle Filter)");
});

$("#pwBtn").addEventListener("click",()=>showPwDialog(false));
function showPwDialog(forced){
  menuPop.hidden=true; forcePw=forced;
  openModal(`<h2>${forced?"Bitte eigenes Passwort festlegen":"Passwort ändern"}</h2>
    ${forced?`<div class="sub">Du hast dich mit einem Startpasswort angemeldet. Lege jetzt dein eigenes fest – danach geht's los.</div>`:`<div class="sub">Danach bist du auf allen anderen Geräten abgemeldet.</div>`}
    <form id="pwForm" class="pwform">
      <label>${forced?"Startpasswort":"Aktuelles Passwort"}<input type="password" id="pwOld" required autocomplete="current-password"></label>
      <label>Neues Passwort (min. 10 Zeichen)<input type="password" id="pwNew" required minlength="10" autocomplete="new-password"></label>
      <label>Neues Passwort wiederholen<input type="password" id="pwNew2" required minlength="10" autocomplete="new-password"></label>
      <div class="err" id="pwErr"></div>
      <div class="actions">${forced?"":`<button type="button" class="btn ghost" id="cancel">Abbrechen</button>`}<button class="btn" type="submit">Speichern</button></div>
    </form>`);
  if(!forced) $("#cancel").onclick=closeModal;
  $("#pwForm").addEventListener("submit",async e=>{
    e.preventDefault();
    if($("#pwNew").value!==$("#pwNew2").value){ $("#pwErr").textContent="Die neuen Passwörter stimmen nicht überein."; return; }
    try{ await api("password",{old:$("#pwOld").value,new:$("#pwNew").value}); forcePw=false; closeModal(); toast("Passwort geändert"); if(forced) setTimeout(()=>location.reload(),600); }
    catch(err){ $("#pwErr").textContent=dbErr(err); }
  });
}

function confirmDelete(isbn){
  const it=items.get(isbn); if(!it) return;
  openModal(`<h2>Titel entfernen?</h2>
    <div class="sub">„${esc(dispTitle(it))}${dispSub(it)?" · "+esc(dispSub(it)):""}“ wird mit Status, Notiz und Änderungsverlauf gelöscht.${isFree(it)?"":" Steht der Titel noch in deiner VLB-TIX-Merkliste, kommt er beim nächsten Import als neu wieder."}</div>
    <div class="actions"><button class="btn ghost" id="cancel">Abbrechen</button><button class="btn danger" id="go">Entfernen</button></div>`);
  $("#cancel").onclick=closeModal;
  $("#go").onclick=async()=>{ try{ await api("delete",{isbn}); items.delete(isbn); ui.open.delete(isbn); closeModal(); render(); saveCache(); toast("Titel entfernt"); }
    catch(e){ toast(dbErr(e)); } };
}

/* ---------- Laden ---------- */
let renderPending=false;
function scheduleRender(){ if(renderPending) return; renderPending=true; requestAnimationFrame(()=>{ renderPending=false;
  if(document.activeElement && document.activeElement.matches("[data-note]")) { setTimeout(scheduleRender,1500); return; }
  render(); }); }
/* Offline: letzter Stand liegt im Gerät, Änderungen warten in einer Warteschlange */
const CACHE_KEY="comicplaner-cache-"+ME.id, QUEUE_KEY="comicplaner-queue-"+ME.id;
let offline=false, cachedAt=null;
function applyData(d){
  const m=new Map(); for(const x of d.items) m.set(x.isbn,x);
  items=m;
  meta={imports:d.meta.imports||[], latestImportId:d.meta.latestImportId, complete:new Set(d.meta.complete||[])};
  latestIsbns=d.meta.latestIsbns?new Set(d.meta.latestIsbns):null;
}
function saveCache(){
  try{ localStorage.setItem(CACHE_KEY, JSON.stringify({at:cachedAt||new Date().toISOString(), items:[...items.values()].map(({_s,_similar,...x})=>x),
    meta:{imports:meta.imports, latestImportId:meta.latestImportId, latestIsbns:latestIsbns?[...latestIsbns]:null, complete:[...(meta.complete||[])]}})); }catch(e){}
}
function loadCache(){ try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)||"null"); if(c&&Array.isArray(c.items)){ applyData(c); cachedAt=c.at; return true; } }catch(e){} return false; }
function queue(){ try{ return JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]"); }catch(e){ return []; } }
function setQueue(q){ try{ q.length?localStorage.setItem(QUEUE_KEY,JSON.stringify(q)):localStorage.removeItem(QUEUE_KEY); }catch(e){} }
async function send(action,body){
  try{ return await api(action,body); }
  catch(e){
    if(e.code!=="offline") throw e;
    const q=queue().filter(x=>!(x.action===action && x.body.isbn===body.isbn));   // pro Titel und Art nur die letzte Änderung
    q.push({action,body}); setQueue(q); setOffline(true);
    return {ok:true, queued:true};
  }
}
async function flushQueue(){
  let q=queue(); if(!q.length) return 0; let done=0;
  while(q.length){ try{ await api(q[0].action,q[0].body); }catch(e){ if(e.code==="offline"||e.code==="auth") break; } q.shift(); setQueue(q); done++; }
  return done;
}
function setOffline(v){
  offline=v; document.body.classList.toggle("is-offline",v);
  const n=queue().length;
  if(v) banner(`Offline – du siehst den Stand vom ${cachedAt?new Date(cachedAt).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}):"letzten Abgleich"}.${n?` ${n} Änderung${n>1?"en warten":" wartet"} auf Übertragung.`:""}`);
  else banner("");
}
async function load(){
  const sent=await flushQueue();
  const d=await api("list");
  applyData(d); cachedAt=new Date().toISOString(); saveCache();
  loaded=true; setOffline(false); scheduleRender();
  if(sent) toast(`${sent} Offline-Änderung${sent>1?"en":""} übertragen`);
}
let lastLoad=0;
async function refresh(force){ if(busy || (!force && Date.now()-lastLoad<5000)) return; lastLoad=Date.now();
  try{ await load(); }
  catch(e){
    if(e.code==="auth") return;
    if(e.code==="offline"){ if(!loaded && loadCache()){ loaded=true; scheduleRender(); } setOffline(true); if(!loaded) $("#main").innerHTML=`<p class="hint">Keine Verbindung und noch kein gespeicherter Stand auf diesem Gerät.</p>`; }
    else banner(dbErr(e));
  } }
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(); });
window.addEventListener("focus",()=>refresh());
window.addEventListener("online",()=>refresh(true));
window.addEventListener("offline",()=>setOffline(true));
if(loadCache()){ loaded=true; scheduleRender(); }   // sofort den letzten Stand zeigen, dann abgleichen
refresh(true);
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{});

/* ---------- Statistik ---------- */
const SERIES=[
  {k:"da",l:"Da",c:"#2E8B57"},
  {k:"bestellt",l:"Bestellt",c:"#2F6EB0"},
  {k:"kaufen",l:"Kaufen",c:"#D08A12"},
  {k:"interessant",l:"Möglich (Interessant)",c:"#9B5B8C"},
];
function addMonth(m,n){ let y=+m.slice(0,4), mo=+m.slice(5,7)-1+n; y+=Math.floor(mo/12); mo=((mo%12)+12)%12; return y+"-"+String(mo+1).padStart(2,"0"); }
function niceStep(max){ const raw=max/4; const p=Math.pow(10,Math.floor(Math.log10(raw||1))); const f=raw/p; return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p; }
const eur0=n=>n.toLocaleString("de-DE",{style:"currency",currency:"EUR",maximumFractionDigits:0});
let statData=null;

function renderStats(all){
  const series=SERIES.filter(x=>x.k!=="interessant"||ui.maybe);
  const base=all.filter(it=>{
    if(ui.pub && it.publisher!==ui.pub) return false;
    if(ui.q){ const q=ui.q.toLowerCase(); if(![it.title,it.subtitle,it.authors,it.isbn,it.note,it.publisher].some(v=>String(v||"").toLowerCase().includes(q))) return false; }
    return true; });
  const dated=base.filter(it=>it.month);
  const noDate=base.filter(it=>!it.month && ["kaufen","bestellt"].includes(it.status));
  // Zeitraum
  const ms=dated.map(it=>it.month).sort();
  let from, to;
  const cap=addMonth(nowMonth,23);
  const msIn=ms.filter(m=>m<=cap);
  if(ui.range==="ab"){ from=nowMonth; to=msIn.length?msIn[msIn.length-1]:nowMonth; if(to<addMonth(from,5)) to=addMonth(from,5); }
  else if(ui.range==="past"){ to=addMonth(nowMonth,-1); from=ms.length?ms[0]:addMonth(to,-11); if(from>addMonth(to,-5)) from=addMonth(to,-5); }
  else { from=ms.length?ms[0]:nowMonth; to=msIn.length?msIn[msIn.length-1]:addMonth(nowMonth,11); if(to<nowMonth) to=nowMonth; }
  const later=ui.range==="past"?[]:dated.filter(it=>it.month>to && series.some(s=>s.k===(it.status||"interessant")));
  const months=[]; for(let m=from; m<=to && months.length<60; m=addMonth(m,1)) months.push(m);
  const rows=months.map(m=>{ const r={m,tot:0}; for(const s of SERIES){ const xs=dated.filter(it=>it.month===m && (it.status||"interessant")===s.k); r[s.k]={sum:xs.reduce((a,x)=>a+(x.price||0),0),n:xs.length}; }
    r.tot=series.reduce((a,s)=>a+r[s.k].sum,0); return r; });
  statData={rows,series};

  // Kennzahlen
  const plan=r=>r.kaufen.sum+r.bestellt.sum;
  const fut=rows.filter(r=>r.m>=nowMonth);
  const next3=fut.filter(r=>r.m<addMonth(nowMonth,3)).reduce((a,r)=>a+plan(r),0);
  const next12=fut.filter(r=>r.m<addMonth(nowMonth,12));
  const avg12=next12.length?next12.reduce((a,r)=>a+plan(r),0)/12:0;
  const top=fut.reduce((b,r)=>plan(r)>(b?plan(b):0)?r:b,null);
  const maybeFut=fut.reduce((a,r)=>a+r.interessant.sum,0);
  const spentPast=rows.filter(r=>r.m<nowMonth).reduce((a,r)=>a+r.da.sum,0);
  const tiles = ui.range==="past"
    ? [[eur0(spentPast),"ausgegeben (Status Da)"],[eur0(rows.reduce((a,r)=>a+r.kaufen.sum+r.bestellt.sum,0)),"noch offen (Kaufen + Bestellt)"],[eur0(rows.reduce((a,r)=>a+r.interessant.sum,0)),"verpasst (Interessant)"]]
    : [[eur0(next3),"nächste 3 Monate"],[eur0(avg12),"Ø pro Monat (12 Mon.)"],[top&&plan(top)?eur0(plan(top)):"–",top&&plan(top)?"teuerster Monat: "+monthLabel(top.m):"teuerster Monat"],[eur0(maybeFut),"zusätzlich möglich (Interessant)"]];

  const main=$("#main");
  main.innerHTML=`<div class="statwrap">
    <div class="tiles">${tiles.map(([b,l])=>`<div class="tile"><b>${b}</b><span>${esc(l)}</span></div>`).join("")}</div>
    <div class="chartcard">
      <div class="charthead">
        <div><h2>Ausgaben pro Monat</h2><p class="muted">Summe der Ladenpreise nach Status${ui.pub?" · "+esc(shortPub(ui.pub)):""}${ui.q?" · Suche „"+esc(ui.q)+"“":""}. Klick auf einen Monat öffnet ihn in der Liste.</p></div>
        <label class="chk"><input type="checkbox" id="maybeChk" ${ui.maybe?"checked":""}> „Interessant“ als möglich zeigen</label>
      </div>
      <div class="legend">${series.map(s=>`<span><i style="background:${s.c}"></i>${esc(s.l)}</span>`).join("")}</div>
      <div class="chart" id="chart"></div>
      ${later.length?`<p class="muted small">${later.length} Titel erscheinen nach ${monthLabel(to)} (${eur(later.reduce((a,x)=>a+(x.price||0),0))}) und sind nicht im Diagramm.</p>`:""}
      ${noDate.length?`<p class="muted small">${noDate.length} geplante/bestellte Titel ohne Termin (${eur(noDate.reduce((a,x)=>a+(x.price||0),0))}) sind nicht im Diagramm.</p>`:""}
      <button class="linkbtn" id="tblBtn">${ui.table?"Tabelle ausblenden":"Als Tabelle anzeigen"}</button>
      <div id="tbl"></div>
    </div></div>`;
  drawChart();
  if(ui.table) drawTable();
  $("#maybeChk").addEventListener("change",e=>{ ui.maybe=e.target.checked; saveUi(); render(); });
  $("#tblBtn").addEventListener("click",()=>{ ui.table=!ui.table; render(); });
}

function drawChart(){
  const el=$("#chart"); if(!el||!statData) return;
  const {rows,series}=statData;
  const W=Math.max(320, el.clientWidth||900), H=300, padL=58, padR=12, padT=22, padB=40;
  const cw=W-padL-padR, ch=H-padT-padB;
  const max=Math.max(...rows.map(r=>r.tot),0);
  const step=niceStep(max||100); const yMax=Math.max(step,Math.ceil(max/step)*step);
  const y=v=>padT+ch-(v/yMax)*ch;
  const band=cw/rows.length, bw=Math.min(24, band*0.62);
  const labelEvery=Math.ceil(rows.length/(W<560?6:12));
  let g="";
  for(let v=0; v<=yMax+0.001; v+=step){ g+=`<line x1="${padL}" x2="${W-padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL-8}" y="${y(v)+4}" class="ytick" text-anchor="end" font-size="11" fill="#7A6670">${eur0(v)}</text>`; }
  let bars="", hits="", labels="";
  rows.forEach((r,i)=>{
    const cx=padL+band*i+band/2, x=cx-bw/2;
    let acc=0; const segs=series.filter(s=>r[s.k].sum>0);
    segs.forEach((s,j)=>{
      const v=r[s.k].sum, y0=y(acc), y1=y(acc+v); acc+=v;
      const top=j===segs.length-1;
      const gap=j>0?2:0;
      const h=Math.max(0,y0-y1-gap);
      if(h<=0) return;
      const yy=y1, rr=top?Math.min(4,h,bw/2):0;
      bars+= rr ? `<path d="M${x},${yy+h} V${yy+rr} Q${x},${yy} ${x+rr},${yy} H${x+bw-rr} Q${x+bw},${yy} ${x+bw},${yy+rr} V${yy+h} Z" fill="${s.c}"${s.k==="interessant"?' fill-opacity=".55"':""}/>`
                : `<rect x="${x}" y="${yy}" width="${bw}" height="${h}" fill="${s.c}"${s.k==="interessant"?' fill-opacity=".55"':""}/>`;
    });
    const mi=+r.m.slice(5,7)-1;
    if(i%labelEvery===0 || r.m===nowMonth) labels+=`<text x="${cx}" y="${H-padB+16}" class="xtick${r.m===nowMonth?" cur":""}" text-anchor="middle" font-size="11" fill="${r.m===nowMonth?"#2A1B25":"#7A6670"}">${MSHORT[mi]}</text>`;
    const sub=[(mi===0||i===0)?r.m.slice(0,4):"", r.m===nowMonth?"jetzt":""].filter(Boolean).join(" · ");
    if(sub && (i%labelEvery===0 || r.m===nowMonth || mi===0)) labels+=`<text x="${cx}" y="${H-padB+30}" class="xyear${r.m===nowMonth?" nowl":""}" text-anchor="middle" font-size="10.5" fill="${r.m===nowMonth?"#6B3A5B":"#7A6670"}">${sub}</text>`;
    hits+=`<rect class="hit" data-i="${i}" x="${padL+band*i}" y="${padT}" width="${band}" height="${ch}" fill="transparent"/>`;
  });
  // Maximalwert direkt beschriften
  const mi=rows.reduce((b,r,i)=>r.tot>(rows[b]?.tot||0)?i:b,0);
  if(rows[mi] && rows[mi].tot>0){ const cx=padL+band*mi+band/2; labels+=`<text x="${cx}" y="${y(rows[mi].tot)-6}" class="vlabel" text-anchor="middle" font-size="11.5" font-weight="600" fill="#2A1B25">${eur0(rows[mi].tot)}</text>`; }
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ausgaben pro Monat, gestapelt nach Status">
    ${g}<line x1="${padL}" x2="${W-padR}" y1="${y(0)}" y2="${y(0)}" class="axis"/>${bars}${labels}${hits}</svg><div class="tip" id="tip" hidden></div>`;
  const tip=$("#tip");
  el.querySelectorAll(".hit").forEach(h=>{
    h.addEventListener("mouseenter",()=>{ const r=rows[+h.dataset.i];
      tip.innerHTML=`<b>${monthLabel(r.m)}</b>${series.slice().reverse().filter(s=>r[s.k].n).map(s=>`<div><i style="background:${s.c}"></i>${esc(s.l)}<span>${r[s.k].n} · ${eur(r[s.k].sum)}</span></div>`).join("")}<div class="tt"><span>Summe</span><span>${eur(r.tot)}</span></div>`;
      tip.hidden=false;
      const bx=+h.getAttribute("x")+(+h.getAttribute("width"))/2;
      const left=Math.min(Math.max(8,bx-110),el.clientWidth-228);
      tip.style.left=left+"px"; tip.style.top="8px";
      h.classList.add("on"); });
    h.addEventListener("mouseleave",()=>{ tip.hidden=true; h.classList.remove("on"); });
    h.addEventListener("click",()=>{ const m=rows[+h.dataset.i].m; ui.view="liste";
      if(m<nowMonth && ui.range==="ab"){ ui.range="alle"; $("#range").value="alle"; }
      ui.closed.delete("m-"+m); saveUi(); render();
      setTimeout(()=>{ const t=document.getElementById("m-"+m); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); else toast("Keine Titel in "+monthLabel(m)+" für die aktuellen Filter"); },30); });
  });
}
function drawTable(){
  const {rows,series}=statData;
  $("#tbl").innerHTML=`<table class="stbl"><thead><tr><th>Monat</th>${series.map(s=>`<th>${esc(s.l)}</th>`).join("")}<th>Summe</th></tr></thead><tbody>${
    rows.filter(r=>r.tot>0).map(r=>`<tr><td>${monthLabel(r.m)}</td>${series.map(s=>`<td class="mono">${r[s.k].sum?eur(r[s.k].sum):"–"}</td>`).join("")}<td class="mono"><b>${eur(r.tot)}</b></td></tr>`).join("")
  }</tbody></table>`;
}
document.getElementById("viewSeg").addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b) return; ui.view=b.dataset.v; saveUi(); render(); window.scrollTo({top:0}); });
let rsT; window.addEventListener("resize",()=>{ clearTimeout(rsT); rsT=setTimeout(()=>{ if(ui.view==="stat") drawChart(); },150); });

/* ---------- Titel über die DNB suchen und hinzufügen ---------- */
const dnb={q:"",start:1,total:0,items:[],sel:new Set(),busy:false};
function showAddDialog(){
  openModal(`<h2>Titel hinzufügen</h2>
    <div class="sub">Sucht im Katalog der Deutschen Nationalbibliothek – auch vergriffene Ausgaben. Titel, Reihe, Autor, Verlag oder eine bzw. mehrere ISBNs eingeben.</div>
    <form id="dnbForm" class="dnbform"><input type="search" id="dnbQ" placeholder="z. B. Yoko Tsuno, Gaston Franquin oder 978-3-551-02137-3" autocomplete="off" enterkeyhint="search">
      <button class="btn" type="submit" id="dnbGo">Suchen</button></form>
    <div class="err" id="dnbErr"></div>
    <div id="dnbRes"></div>
    <div class="actions dnbactions" id="dnbActions" hidden>
      <label class="chk">Status <select id="dnbStatus">${STATUS.filter(x=>x.k!=="verworfen").map(x=>`<option value="${x.k}">${x.l}</option>`).join("")}</select></label>
      <span style="flex:1"></span>
      <button class="btn ghost" id="cancel" type="button">Schließen</button>
      <button class="btn" id="dnbAdd" type="button" disabled>Hinzufügen</button>
    </div>
    <div class="actions" id="dnbClose"><button class="btn ghost" type="button" id="cancel2">Schließen</button></div>`);
  dnb.sel.clear(); dnb.items=[]; dnb.total=0;
  const q=$("#dnbQ"); q.value=dnb.q; setTimeout(()=>q.focus(),50);
  $("#dnbForm").addEventListener("submit",e=>{ e.preventDefault(); dnbSearch(q.value.trim(),1); });
  $("#cancel").onclick=closeModal; $("#cancel2").onclick=closeModal;
  $("#dnbAdd").onclick=dnbAddSelected;
  $("#dnbRes").addEventListener("click",e=>{
    const more=e.target.closest("[data-more]"); if(more){ dnbSearch(dnb.q,dnb.start+30,true); return; }
    const row=e.target.closest(".dnbrow"); if(!row || row.classList.contains("have")) return;
    const isbn=row.dataset.isbn; dnb.sel.has(isbn)?dnb.sel.delete(isbn):dnb.sel.add(isbn);
    row.classList.toggle("sel",dnb.sel.has(isbn)); row.querySelector("input").checked=dnb.sel.has(isbn); dnbCount();
  });
  if(dnb.q) dnbSearch(dnb.q,1);
}
function dnbCount(){ const n=dnb.sel.size; $("#dnbAdd").disabled=!n; $("#dnbAdd").textContent=n?`${n} Titel hinzufügen`:"Hinzufügen"; }
async function dnbSearch(q,start,append=false){
  if(!q || dnb.busy) return;
  dnb.busy=true; dnb.q=q; $("#dnbErr").textContent=""; $("#dnbGo").disabled=true;
  if(!append) $("#dnbRes").innerHTML=`<p class="hint">Suche in der Deutschen Nationalbibliothek …</p>`;
  else { const m=$("[data-more]"); if(m) m.textContent="Lade …"; }
  try{
    const r=await api("search&q="+encodeURIComponent(q)+"&start="+start);
    const items=r.items.map(it=>({...it,title:(it.title||"").normalize("NFC"),subtitle:(it.subtitle||"").normalize("NFC"),authors:(it.authors||"").normalize("NFC"),publisher:(it.publisher||"").normalize("NFC")}));
    dnb.items=append?dnb.items.concat(items.filter(x=>!dnb.items.some(y=>y.isbn===x.isbn))):items;
    dnb.total=r.total; dnb.start=start;
    dnbRender();
  }catch(e){ $("#dnbErr").textContent=dbErr(e); if(!append) $("#dnbRes").innerHTML=""; }
  dnb.busy=false; $("#dnbGo").disabled=false;
}
function dnbRender(){
  const res=$("#dnbRes");
  $("#dnbActions").hidden=!dnb.items.length; $("#dnbClose").hidden=!!dnb.items.length;
  if(!dnb.items.length){ res.innerHTML=`<p class="hint">Keine passenden gedruckten Ausgaben mit ISBN gefunden.</p>`; return; }
  const sorted=dnb.items.slice().sort((a,b)=>(b.month||"").localeCompare(a.month||"")||a.title.localeCompare(b.title,"de",{numeric:true}));
  // ähnliche Titel auf der Liste (gleicher Titel, andere ISBN)
  const keys=new Map(); for(const it of items.values()){ const k=it.titleKey||titleKey(it.title,it.subtitle); if(k) keys.set(k,it); }
  res.innerHTML=`<p class="hint">${dnb.total} Treffer${dnb.total>dnb.items.length?`, ${dnb.items.length} geladen`:""}. Antippen zum Auswählen.</p>
    <div class="dnblist">${sorted.map(it=>{
      const have=it.have||(items.has(it.isbn)?items.get(it.isbn).status:null);
      const sim=!have && keys.get(titleKey(it.title,it.subtitle));
      return `<div class="dnbrow ${have?"have":""} ${dnb.sel.has(it.isbn)?"sel":""}" data-isbn="${it.isbn}">
        <input type="checkbox" ${dnb.sel.has(it.isbn)?"checked":""} ${have?"disabled":""} tabindex="-1" aria-hidden="true">
        <div class="ttl"><div class="t">${esc(it.title)}${it.subtitle?` <span class="sub">· ${esc(it.subtitle)}</span>`:""}</div>
          <div class="a">${esc([it.authors,it.publisher,it.dateRaw].filter(Boolean).join(" · "))}${it.price!=null?" · "+eur(it.price):""} · <span class="mono">${it.isbn}</span></div>
          ${have?`<div class="note ok">schon auf der Liste (${esc(SLABEL[have]||have)})</div>`:sim?`<div class="note warn">ähnlicher Titel schon auf der Liste: ${esc(sim.title)} (${sim.isbn})</div>`:""}
        </div></div>`; }).join("")}</div>
    ${dnb.total>dnb.start+29 && dnb.items.length<dnb.total?`<button class="linkbtn" data-more>Weitere Treffer laden</button>`:""}`;
  dnbCount();
}
async function dnbAddSelected(){
  const rows=dnb.items.filter(it=>dnb.sel.has(it.isbn)).map(it=>({...it,titleKey:titleKey(it.title,it.subtitle)}));
  if(!rows.length) return;
  const st=$("#dnbStatus").value;
  $("#dnbAdd").disabled=true;
  try{
    const r=await api("add",{rows,status:st});
    dnb.sel.clear();
    await load();
    for(const it of dnb.items) if(items.has(it.isbn)) it.have=items.get(it.isbn).status;
    dnbRender();
    toast(`${r.added} Titel hinzugefügt (${SLABEL[st]})`);
  }catch(e){ $("#dnbErr").textContent=dbErr(e); $("#dnbAdd").disabled=false; }
}
document.getElementById("addBtn").addEventListener("click",showAddDialog);

/* ---------- gelesen ---------- */
function setRead(isbn,v){
  const it=items.get(isbn); if(!it || it.read===v) return;
  it.read=v; it._s=null; render(); saveCache();
  send("read",{isbn,read:v}).catch(e=>{ it.read=!v; render(); toast(dbErr(e)); });
}

/* ---------- Ansicht „Sammlung“ ---------- */
const coll=new Intl.Collator("de",{numeric:true,sensitivity:"base"});
const sortName=n=>String(n||"").replace(/^(der|die|das|the|les|le|la|el)\s+/i,"");
function renderCollection(all){
  const q=ui.q;
  const vis=all.filter(it=>{ if(ui.pub && it.publisher!==ui.pub) return false; return q ? qMatch(it,q) : ui.colStatuses.has(it.status||"interessant"); });
  const groups=new Map();
  for(const it of vis){ it._g=groupOf(it); const k=it._g.s; (groups.get(k)||groups.set(k,[]).get(k)).push(it); }
  const keys=[...groups.keys()].sort((a,b)=> a===""?-1 : b===""?1 : coll.compare(sortName(a),sortName(b)));
  const read=vis.filter(x=>x.read).length;
  let html=`<p class="hint">${q?`Suche in allen ${all.length} Titeln – <b>${vis.length}</b> Treffer in ${keys.length} Reihen.`:`<b>${keys.length}</b> Reihen · <b>${vis.length}</b> Bände · ${read} gelesen · ${vis.length-read} ungelesen`}
    <button data-act="newfree">+ Eintrag ohne ISBN</button> <button data-act="notes">Aus Apple Notes übernehmen</button></p>`;
  if(!keys.length) html+=`<div class="empty"><p>${q?"Nichts gefunden – den Titel hast du nicht.":"Noch keine Einträge in der Sammlung."}</p></div>`;
  let nav="", lastL="";
  for(const k of keys){
    const list=groups.get(k).sort((a,b)=>coll.compare(a._g.v||"~",b._g.v||"~")||coll.compare(a._g.name||"",b._g.name||""));
    const stored=list.some(x=>x.series===k);
    const id="s-"+(k?hashId(k):"einzel");
    const open=q || ui.colOpen.has(k);
    const rd=list.filter(x=>x.read).length;
    const complete=meta.complete && meta.complete.has(k);
    const L=(k?sortName(k)[0]:"#").toUpperCase(); const letter=/[A-ZÄÖÜ]/.test(L)?L.normalize("NFD")[0]:"#";
    if(letter!==lastL){ nav+=`<a href="#${id}" data-jump="${id}"><span>${letter==="#"?"0–9":letter}</span></a>`; lastL=letter; }
    html+=`<section class="series ${open?"":"closed"}" id="${id}" data-series="${esc(k)}">
      <div class="shead" data-stoggle><span class="caret">▾</span><b>${k?esc(k):"Einzelbände"}</b>
        <span class="meta">${list.length} ${list.length===1?"Band":"Bände"}${rd?` · ${rd===list.length?"alle gelesen":rd+" gelesen"}`:""}</span>
        ${complete?`<span class="tag ok">komplett</span>`:""}
        ${k?`<span class="sacts">${stored?`<button class="copy" data-srename title="Reihe umbenennen">umbenennen</button>`:""}<button class="copy" data-scomplete>${complete?"nicht komplett":"komplett"}</button></span>`:""}
      </div>
      ${open?`<div class="sitems">${list.map(colItemHtml).join("")}</div>`:""}
    </section>`;
  }
  $("#main").innerHTML=html;
  $("#monthNav").innerHTML=`<div class="letters">${nav}</div>`;
}
/* Reihe/Band für VLB-/DNB-Titel ohne eingetragene Reihe aus Titel und Untertitel ableiten */
function groupOf(it){
  if(it.series) return {s:it.series, v:it.volume||"", name:it.title||(it.volume?"Band "+it.volume:""), derived:false};
  const t=(it.title||"").trim(), sub=(it.subtitle||"").trim(); let m;
  const VOL=/(?:Bd\.?|Band|Vol\.?|Teil|Nr\.?)\s*(\d+[a-z]?)\b\s*[:.\-–]?\s*(.*)$/i;
  const z=v=>v.replace(/^0+(?=\d)/,"");
  if(sub && (m=sub.match(new RegExp("^"+VOL.source,"i")))) return {s:t.replace(/[\s.:,\-–]+$/,""), v:z(m[1]), name:m[2]||"", derived:true};
  if((m=t.match(new RegExp("^(.*?)[\\s.:,\\-–]+"+VOL.source,"i"))) && m[1].length>1) return {s:m[1], v:z(m[2]), name:[m[3],sub].filter(Boolean).join(" · "), derived:true};
  if((m=t.match(/^(.*\D)\s+(\d{1,3})$/)) && m[1].trim().length>1) return {s:m[1].trim(), v:z(m[2]), name:sub, derived:true};
  return {s:"", v:"", name:t+(sub?" · "+sub:""), derived:false};
}
function hashId(s){ let h=0; for(const c of s) h=(h*31+c.codePointAt(0))|0; return (h>>>0).toString(36); }
function colItemHtml(it){
  const st=it.status||"interessant";
  const g=it._g||groupOf(it);
  const name = g.name || (g.v?"Band "+g.v:"");
  return `<div class="citem st-${st}" data-isbn="${it.isbn}">
    <span class="vol">${esc(g.v)}</span>
    <span class="cname">${esc(name)}${(it.tags||[]).map(t=>`<span class="tag grey">${esc(t)}</span>`).join("")}${st!=="da"?`<span class="have st-${st}">${haveLabel(it)}</span>`:""}${it.note?`<span class="tag grey" title="${esc(it.note)}">Notiz</span>`:""}</span>
    <button class="readbtn ${it.read?"on":""}" data-read title="${it.read?"gelesen":"ungelesen"}" aria-pressed="${it.read}">${it.read?"gelesen":"ungelesen"}</button>
    <button class="copy" data-edit>Bearbeiten</button>
  </div>`;
}
$("#main").addEventListener("click",e=>{
  if(ui.view!=="sammlung") return;
  e.stopPropagation();
  const act=e.target.closest("[data-act]");
  if(act){ if(act.dataset.act==="newfree") showEdit(null,{status:"da"}); if(act.dataset.act==="notes") showNotesImport(); return; }
  const sec=e.target.closest("section.series"); if(!sec) return;
  const name=sec.dataset.series;
  if(e.target.closest("[data-srename]")){ renameSeries(name); return; }
  if(e.target.closest("[data-scomplete]")){ toggleComplete(name); return; }
  if(e.target.closest("[data-stoggle]")){ if(ui.q) return; ui.colOpen.has(name)?ui.colOpen.delete(name):ui.colOpen.add(name); render(); return; }
  const ci=e.target.closest(".citem"); if(!ci) return;
  const isbn=ci.dataset.isbn;
  if(e.target.closest("[data-read]")){ setRead(isbn,!items.get(isbn).read); return; }
  showEdit(isbn);
}, true);
function renameSeries(name){
  openModal(`<h2>Reihe umbenennen</h2><div class="sub">Alle ${[...items.values()].filter(x=>x.series===name).length} Einträge von „${esc(name)}“ bekommen den neuen Namen. Gibt es den Namen schon, werden beide Reihen zusammengeführt.</div>
    <form id="rnForm" class="pwform"><label>Neuer Name<input id="rnName" value="${esc(name)}" list="seriesList" required></label>${seriesDatalist()}
    <div class="err" id="rnErr"></div><div class="actions"><button type="button" class="btn ghost" id="cancel">Abbrechen</button><button class="btn" type="submit">Umbenennen</button></div></form>`);
  $("#cancel").onclick=closeModal;
  $("#rnForm").addEventListener("submit",async e=>{ e.preventDefault(); const to=$("#rnName").value.trim(); if(!to||to===name){ closeModal(); return; }
    try{ await api("series",{name,rename:to}); if(ui.colOpen.delete(name)) ui.colOpen.add(to); await load(); closeModal(); toast("Reihe umbenannt"); }catch(err){ $("#rnErr").textContent=dbErr(err); } });
}
async function toggleComplete(name){
  const c=!(meta.complete&&meta.complete.has(name));
  try{ await api("series",{name,complete:c}); c?meta.complete.add(name):meta.complete.delete(name); render(); saveCache(); }catch(e){ toast(dbErr(e)); }
}
function seriesDatalist(){ return `<datalist id="seriesList">${[...new Set([...items.values()].map(x=>x.series).filter(Boolean))].sort(coll.compare).map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`; }

/* ---------- Bearbeiten / neu anlegen ---------- */
function showEdit(isbn,preset={}){
  if(offline){ toast("Bearbeiten geht nur mit Verbindung"); return; }
  const it=isbn?items.get(isbn):{status:"da",tags:[],...preset};
  if(!it) return;
  const free=!isbn || isFree(it);
  const f=(id,label,val,extra="")=>`<label>${label}<input id="${id}" value="${esc(val??"")}" ${extra}></label>`;
  openModal(`<h2>${isbn?"Eintrag bearbeiten":"Neuer Eintrag"}</h2>
    <form id="edForm" class="pwform edform">
      <div class="grid2">${f("edSeries","Reihe",it.series,'list="seriesList" placeholder="z. B. Lucky Luke"')}${f("edVol","Band",it.volume,'placeholder="z. B. 17"')}</div>
      ${f("edTitle","Titel",it.title,'placeholder="Bandtitel"')}
      ${f("edSub","Untertitel",it.subtitle)}
      <div class="grid2">
        <label>Status<select id="edStatus">${STATUS.map(x=>`<option value="${x.k}" ${x.k===(it.status||"da")?"selected":""}>${x.l}</option>`).join("")}</select></label>
        <label class="chk" style="margin-top:22px"><input type="checkbox" id="edRead" ${it.read?"checked":""}> gelesen</label>
      </div>
      ${f("edTags","Tags (mit Komma getrennt)",(it.tags||[]).join(", "),'placeholder="z. B. omnibus, englisch, signiert"')}
      <div class="grid2">${f("edPub","Verlag",it.publisher)}${f("edAuth","Urheber",it.authors)}</div>
      <div class="grid2">${f("edDate","Erscheinungstermin",it.dateRaw,'placeholder="TT.MM.JJJJ, MM.JJJJ oder JJJJ"')}${f("edPrice","Preis (EUR)",it.price!=null?String(it.price).replace(".",","):"",'inputmode="decimal"')}</div>
      ${free?f("edIsbn","ISBN (optional – falls du sie nachträglich zuordnen willst)","",'inputmode="numeric" placeholder="978-…"'):`<p class="muted small">ISBN ${esc(it.isbn)}</p>`}
      <label>Notiz<textarea id="edNote" rows="3">${esc(it.note||"")}</textarea></label>
      ${seriesDatalist()}
      <div class="err" id="edErr"></div>
      <div class="actions">${isbn?`<button type="button" class="btn ghost" id="edDel">Entfernen</button><span style="flex:1"></span>`:""}<button type="button" class="btn ghost" id="cancel">Abbrechen</button><button class="btn" type="submit">Speichern</button></div>
    </form>`);
  $("#cancel").onclick=closeModal;
  if(isbn) $("#edDel").onclick=()=>confirmDelete(isbn);
  setTimeout(()=>$(isbn?"#edTitle":"#edSeries").focus(),40);
  $("#edForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const dt=parseDate($("#edDate").value);
    const item={isbn:isbn||"", series:$("#edSeries").value.trim(), volume:$("#edVol").value.trim(), title:$("#edTitle").value.trim(), subtitle:$("#edSub").value.trim(),
      status:$("#edStatus").value, read:$("#edRead").checked, tags:$("#edTags").value.split(",").map(x=>x.trim()).filter(Boolean),
      publisher:$("#edPub").value.trim(), authors:$("#edAuth").value.trim(), dateRaw:dt.dateRaw, date:dt.date, month:dt.month,
      price:parsePrice($("#edPrice").value), note:$("#edNote").value, newIsbn:free&&$("#edIsbn")?$("#edIsbn").value.trim():""};
    item.titleKey=titleKey(dispTitle(item),dispSub(item));
    try{ const r=await api("save",{item}); await load(); closeModal(); toast(isbn?"Gespeichert":"Eintrag angelegt");
      if(item.series && ui.view==="sammlung") { ui.colOpen.add(item.series); render(); } }
    catch(err){ $("#edErr").textContent=dbErr(err); }
  });
}

/* ---------- Apple-Notes-Bestandsliste → Einträge ---------- */
const TAG_MAP={ "omnisbus":"omnibus","omnibis":"omnibus","marvelmusthave":"Marvel Must-Have","marvel":"" };
function notesTags(s){
  const tags=[]; let read=false, order=false, complete=false;
  s=s.replace(/@([\wäöüÄÖÜß\-]+)(\(([^)]*)\))?/g,(m,name,_p,arg)=>{
    const k=name.toLowerCase();
    if(k==="gelesen") read=true;
    else if(k==="komplett") complete=true;
    else if(k==="noch-bestellen") order=true;
    else if(k==="mundart") tags.push("Mundart"+(arg?" ("+arg+")":""));
    else { const t=(k in TAG_MAP)?TAG_MAP[k]:name; if(t && !tags.includes(t)) tags.push(t); }
    return " ";
  }).replace(/(^|\s)@(?=\s|$)/g," ");
  return {text:s.replace(/\s+/g," ").trim(), tags, read, order, complete};
}
function notesVolume(t){
  let m;
  if((m=t.match(/^(?:Band|Bd\.?|Heft|Nr\.?)\s*(\d+[a-z]?)\s*(?:[:\-–]\s*)?(.*)$/i))) return {vol:m[1],title:m[2].trim()};
  if((m=t.match(/^(\d{1,3}[a-z]?)\s*(?:[.:)]|\s[-–])?\s+(.+)$/)) && !/^\d{4}$/.test(m[1])) return {vol:m[1],title:m[2].trim()};
  if((m=t.match(/^(\d{1,3}[a-z]?)[.:]?$/))) return {vol:m[1],title:""};
  return {vol:"",title:t};
}
function parseNotes(text){
  const lines=text.replace(/\r\n?/g,"\n").split("\n");
  const nodes=[];   // {kind:'h0'|'h1'|'item'|'sub', ...}
  let firstText=true;
  for(const raw of lines){
    if(!raw.trim()) continue;
    const ind=(raw.match(/^[\t ]*/)[0]).replace(/ {4}/g,"\t").replace(/ +/g,"").length;
    const bm=raw.match(/^[\t ]*[*\-•]\s+(.*)$/) || raw.match(/^[\t ]*\*(\S.*)$/);
    if(bm){ const body=bm[1];
      nodes.push({kind: ind>0?"bullet1":"bullet0", ...splitNote(body), line:raw}); firstText=false; continue; }
    const body=raw.trim();
    if(firstText && /bestand|sammlung|comics?\b/i.test(body) && !/@/.test(body)){ firstText=false; continue; }  // Überschrift der Notiz
    firstText=false;
    nodes.push({kind: ind>0?"h1":"h0", ...splitNote(body), line:raw});
  }
  // Struktur auflösen
  const items=[], series=new Map(), standalone=[];
  let h0=null, h1=null, lastTop=null;
  const ser=(name,flags)=>{ if(!name) return; const s=series.get(name)||{name,complete:false,count:0}; if(flags&&flags.complete) s.complete=true; series.set(name,s); };
  const childCount=new Map();
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i];
    if(n.kind==="h0"){ h0={...n, name:cleanHead(n.t.text), has:false}; h1=null; lastTop=null; nodes[i]._h=h0; ser(h0.name,n.t); continue; }
    if(n.kind==="h1"){ h1={...n, name:cleanHead(n.t.text), parent:h0, has:false}; lastTop=null; if(h0) h0.has=true; nodes[i]._h=h1; ser(seriesName(h0,h1),n.t); continue; }
    if(n.kind==="bullet1" && lastTop && !h1){   // Inhalt eines Sammelbands
      lastTop.contents.push(n.t.text + (n.story?" ("+n.story+")":""));
      if(n.t.read) lastTop.readParts++;
      continue;
    }
    if(n.kind==="bullet0") h1=null;          // nicht eingerückter Punkt gehört wieder zur Hauptreihe
    const sName = h1 ? seriesName(h0,h1) : (h0? h0.name : "");
    if(h1) h1.has=true; if(h0) h0.has=true;
    const v=notesVolume(n.t.text);
    const order = n.t.order || (h1&&h1.t.order) || (!h1&&h0&&h0.t.order);
    const it={series:sName, volume:v.vol, title:v.title, read:n.t.read, tags:n.t.tags.slice(), order, note:n.story?("Storys: "+n.story):"", contents:[], readParts:0, src:n.line.trim()};
    if(n.t.complete) ser(sName,{complete:true});
    items.push(it);
    if(n.kind==="bullet0") lastTop=it;
  }
  // Überschriften ohne Unterpunkte → Einzeleintrag
  for(const n of nodes){
    if(n.kind!=="h0" || n._h.has) continue;
    const v=notesVolume(n.t.text.replace(/:$/,""));
    standalone.push({series:"", volume:"", title:cleanHead(n.t.text), read:n.t.read, tags:n.t.tags.slice(), order:n.t.order, note:n.story?("Storys: "+n.story):"", contents:[], readParts:0, src:n.line.trim(), standalone:true});
    series.delete(n._h.name);
  }
  // Unterüberschriften ohne Unterpunkte (z. B. „Hefte komplett“) → Eintrag in der Oberreihe
  for(const n of nodes){
    if(n.kind!=="h1" || n._h.has) continue;
    const par=n._h.parent; const sName=par?par.name:"";
    items.push({series:sName, volume:"", title:n._h.name.replace(/^\((.*)\)$/,"$1"), read:n.t.read, tags:n.t.tags.slice(), order:n.t.order, note:n.story?("Storys: "+n.story):"", contents:[], readParts:0, src:n.line.trim()});
    if(n.t.complete) ser(sName,{complete:true});
    series.delete(seriesName(par,n._h));
  }
  for(const it of items){ if(it.contents.length){ it.note=(it.note?it.note+"\n":"")+"Enthält: "+it.contents.join("; "); } }
  const all=items.concat(standalone);
  for(const it of all) if(it.series){ const s=series.get(it.series); if(s) s.count++; }
  for(const [k,s] of series) if(!s.count) series.delete(k);
  return {items:all, series:[...series.values()], standaloneCount:standalone.length};
}
function splitNote(body){
  // "Titel @gelesen | Storys: …"
  let story=""; const p=body.indexOf("|");
  if(p>=0){ story=body.slice(p+1).replace(/^\s*Storys?:\s*/i,"").replace(/^Inhalt:\s*/i,"").trim(); body=body.slice(0,p); }
  return {t:notesTags(body), story};
}
function cleanHead(s){ return s.replace(/[:]\s*$/,"").replace(/\s+/g," ").trim(); }
function seriesName(h0,h1){ if(!h0) return h1.name; if(!h1) return h0.name; return h0.name+" › "+h1.name; }


/* ---------- Übernahme aus Apple Notes ---------- */
function showNotesImport(){
  menuPop.hidden=true;
  if(offline){ toast("Die Übernahme geht nur mit Verbindung"); return; }
  openModal(`<h2>Aus Apple Notes übernehmen</h2>
    <div class="sub">Öffne deine Notiz, wähle alles aus (⌘A), kopiere es (⌘C) und füge es hier ein – oder ziehe eine exportierte .txt-Datei hinein. Überschriften werden zu Reihen, eingerückte Überschriften zu Unterreihen, Aufzählungspunkte zu Bänden. <code>@gelesen</code>, <code>@komplett</code> und <code>@noch-bestellen</code> werden erkannt, alle anderen <code>@…</code> als Tags übernommen.</div>
    <textarea id="ntText" class="nttext" placeholder="Notiz hier einfügen …"></textarea>
    <div id="ntPrev"></div>
    <div class="err" id="ntErr"></div>
    <div class="actions"><button type="button" class="btn ghost" id="cancel">Abbrechen</button><button class="btn" id="ntGo" disabled>Übernehmen</button></div>`);
  $("#cancel").onclick=closeModal;
  const ta=$("#ntText"); let parsed=null, skip=new Set(); let t;
  const upd=()=>{ clearTimeout(t); t=setTimeout(()=>{ parsed=ta.value.trim()?parseNotes(ta.value):null; skip=new Set(); ntPreview(parsed,skip); },250); };
  ta.addEventListener("input",upd);
  ta.addEventListener("dragover",e=>e.preventDefault());
  ta.addEventListener("drop",async e=>{ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f){ ta.value=await f.text(); upd(); } });
  $("#ntPrev").addEventListener("change",e=>{ const c=e.target.closest("[data-skip]"); if(!c) return; c.checked?skip.delete(+c.dataset.skip):skip.add(+c.dataset.skip); ntPreview(parsed,skip,true); });
  $("#ntGo").onclick=async()=>{
    if(!parsed) return;
    const rows=parsed.items.filter((x,i)=>!skip.has(i)).map(x=>({series:x.series,volume:x.volume,title:x.title,read:x.read,tags:x.tags,note:x.note,
      status:x.order?"kaufen":"da", titleKey:titleKey(dispTitle(x),dispSub(x))}));
    $("#ntGo").disabled=true; $("#ntErr").textContent="Speichere …";
    try{ const r=await api("notesimport",{rows,complete:parsed.series.filter(x=>x.complete).map(x=>x.name)});
      await load(); closeModal(); ui.view="sammlung"; saveUi(); render();
      toast(`${r.added} Einträge übernommen${r.dupes?`, ${r.dupes} waren schon da`:""}`); }
    catch(err){ $("#ntErr").textContent=dbErr(err); $("#ntGo").disabled=false; }
  };
}
function ntPreview(p,skip,keepScroll){
  const el=$("#ntPrev"); $("#ntGo").disabled=!p||!p.items.length;
  if(!p){ el.innerHTML=""; return; }
  const n=p.items.length-skip.size, rd=p.items.filter((x,i)=>x.read&&!skip.has(i)).length, ord=p.items.filter(x=>x.order).length;
  const lone=p.items.map((x,i)=>[x,i]).filter(([x])=>x.standalone);
  const top=p.series.slice().sort((a,b)=>b.count-a.count).slice(0,8);
  el.innerHTML=`<div class="sumgrid"><div class="sumbox"><b>${n}</b><span>Einträge</span></div><div class="sumbox"><b>${p.series.length}</b><span>Reihen</span></div>
      <div class="sumbox"><b>${rd}</b><span>gelesen</span></div><div class="sumbox"><b>${p.series.filter(x=>x.complete).length}</b><span>Reihen komplett</span></div>${ord?`<div class="sumbox"><b>${ord}</b><span>noch zu kaufen</span></div>`:""}</div>
    <p class="muted small">Größte Reihen: ${top.map(x=>esc(x.name)+" ("+x.count+")").join(", ")}</p>
    ${lone.length?`<details class="ntlone" open><summary>${lone.length} Überschriften ohne Unterpunkte – als Einzeltitel übernehmen?</summary>
      <p class="muted small">Manche davon sind vermutlich Gruppen (z. B. „Daredevil“) und keine Comics. Abwählen, was kein eigener Titel ist. Reihen kannst du nach der Übernahme in der Sammlung umbenennen oder zusammenführen.</p>
      <div class="ntlist">${lone.map(([x,i])=>`<label><input type="checkbox" data-skip="${i}" ${skip.has(i)?"":"checked"}> ${esc(x.title)}${x.read?" <span class=\"tag ok\">gelesen</span>":""}</label>`).join("")}</div></details>`:""}
    <details class="ntall"><summary>Alle Reihen ansehen</summary><div class="ntlist">${p.series.map(x=>`<div>${esc(x.name)} <span class="muted">(${x.count}${x.complete?", komplett":""})</span></div>`).join("")}</div></details>`;
}

/* ---------- Abmelden, Sicherung, Menü ---------- */
document.querySelector('form[action="logout.php"]')?.addEventListener("submit",e=>{
  if(queue().length && !window.confirmLogout){ e.preventDefault();
    openModal(`<h2>Abmelden?</h2><div class="sub">Es warten noch ${queue().length} Offline-Änderungen. Beim Abmelden gehen sie verloren.</div>
      <div class="actions"><button class="btn ghost" id="cancel">Abbrechen</button><button class="btn danger" id="go">Trotzdem abmelden</button></div>`);
    $("#cancel").onclick=closeModal; $("#go").onclick=()=>{ window.confirmLogout=true; document.querySelector('form[action="logout.php"]').requestSubmit(); };
    return; }
  try{ localStorage.removeItem(CACHE_KEY); localStorage.removeItem(QUEUE_KEY); }catch(_){}
  if(window.caches) caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));
});
$("#notesBtn").addEventListener("click",showNotesImport);
$("#backupBtn").addEventListener("click",()=>{ menuPop.hidden=true; if(offline){ toast("Sicherung geht nur mit Verbindung"); return; } location.href="api.php?a=backup"; });
$("#restoreBtn").addEventListener("click",()=>{
  menuPop.hidden=true;
  if(offline){ toast("Wiederherstellen geht nur mit Verbindung"); return; }
  openModal(`<h2>Sicherung einspielen</h2>
    <div class="sub">Ersetzt <b>alle</b> Einträge, Status, Notizen und den Verlauf durch den Stand aus der Sicherungsdatei. Lade vorher zur Sicherheit eine aktuelle Sicherung herunter.</div>
    <label class="dropzone" id="rsDz"><input type="file" id="rsFile" accept=".json,application/json" hidden><b>Sicherungsdatei auswählen</b><br><span class="muted">comic-planer-sicherung-….json</span></label>
    <div id="rsInfo"></div><div class="err" id="rsErr"></div>
    <div class="actions"><button class="btn ghost" id="cancel">Abbrechen</button><button class="btn danger" id="go" disabled>Alles ersetzen</button></div>`);
  $("#cancel").onclick=closeModal;
  let data=null;
  $("#rsFile").addEventListener("change",async e=>{ const f=e.target.files[0]; if(!f) return; $("#rsErr").textContent="";
    try{ data=JSON.parse(await f.text()); if(data.app!=="Comic-Planer"||!data.tables||!Array.isArray(data.tables.comics)) throw 0;
      $("#rsInfo").innerHTML=`<p class="hint">Sicherung vom ${new Date(data.exported).toLocaleString("de-DE")} (Version ${esc(data.version)}): <b>${data.tables.comics.length}</b> Einträge.</p>`; $("#go").disabled=false; }
    catch(_){ data=null; $("#go").disabled=true; $("#rsErr").textContent="Das ist keine Comic-Planer-Sicherung."; } });
  $("#go").onclick=async()=>{ if(!data) return; $("#go").disabled=true; $("#rsErr").textContent="Spiele ein …";
    try{ const r=await api("restore",data); setQueue([]); await load(); closeModal(); toast(`${r.restored} Einträge wiederhergestellt`); }
    catch(err){ $("#rsErr").textContent=dbErr(err); $("#go").disabled=false; } };
});

/* ---------- Pflicht-Passwortwechsel ---------- */
if(ME.mustChange) setTimeout(()=>showPwDialog(true),300);

/* ---------- Nutzerverwaltung (Admin) ---------- */
function randomPw(){ const a="abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const r=new Uint32Array(14); crypto.getRandomValues(r); return [...r].map(x=>a[x%a.length]).join(""); }
async function showUsers(){
  menuPop.hidden=true;
  if(offline){ toast("Nutzerverwaltung geht nur mit Verbindung"); return; }
  let users=[];
  try{ users=(await api("users")).users; }catch(e){ toast(dbErr(e)); return; }
  const fmt=d=>d?new Date(d).toLocaleDateString("de-DE"):"–";
  openModal(`<h2>Nutzer verwalten</h2>
    <div class="sub">Jeder Nutzer hat eine eigene Sammlung, Planung und Statistik. Die anderen sehen davon nichts – auch du als Admin nicht.</div>
    <table class="utbl"><thead><tr><th>Name</th><th>Benutzername</th><th>Einträge</th><th>Letzte Anmeldung</th><th></th></tr></thead><tbody>
    ${users.map(u=>`<tr data-id="${u.id}"><td>${esc(u.displayName||u.username)}${u.isAdmin?' <span class="tag">Admin</span>':''}${u.me?' <span class="tag grey">du</span>':''}${u.mustChangePw?' <span class="tag warn">Startpasswort</span>':''}</td>
      <td class="mono">${esc(u.username)}</td><td>${u.items}</td><td>${fmt(u.lastLogin)}</td>
      <td class="uacts"><button class="copy" data-uedit>Bearbeiten</button>${u.me?"":`<button class="copy" data-udel>Löschen</button>`}</td></tr>`).join("")}
    </tbody></table>
    <div class="actions"><button class="btn ghost" id="cancel">Schließen</button><button class="btn" id="uNew">+ Nutzer anlegen</button></div>`);
  $("#cancel").onclick=closeModal;
  $("#uNew").onclick=()=>userForm(null);
  $("#modal").querySelector(".utbl").addEventListener("click",e=>{
    const tr=e.target.closest("tr[data-id]"); if(!tr) return;
    const u=users.find(x=>String(x.id)===tr.dataset.id);
    if(e.target.closest("[data-uedit]")) userForm(u);
    if(e.target.closest("[data-udel]")) userDelete(u);
  });
}
function userForm(u){
  const pw=u?"":randomPw();
  openModal(`<h2>${u?"Nutzer bearbeiten":"Neuer Nutzer"}</h2>
    <form id="uForm" class="pwform">
      <div class="grid2"><label>Anzeigename<input id="uDisp" value="${esc(u?.displayName||"")}" placeholder="z. B. Lena"></label>
      <label>Benutzername (für die Anmeldung)<input id="uName" value="${esc(u?.username||"")}" required autocapitalize="none" autocorrect="off" spellcheck="false" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{1,39}"></label></div>
      ${u?.me?"":`<label>${u?"Neues Startpasswort (leer lassen = unverändert)":"Startpasswort"}<input id="uPw" value="${pw}" ${u?"":"required"} minlength="10" autocomplete="off"></label>
      <p class="muted small">${u?"Beim Zurücksetzen wird der Nutzer überall abgemeldet und muss bei der nächsten Anmeldung ein eigenes Passwort festlegen.":"Gib dieses Startpasswort weiter – bei der ersten Anmeldung legt der Nutzer sein eigenes fest."}</p>`}
      <label class="chk" style="margin:10px 0"><input type="checkbox" id="uAdmin" ${u?.isAdmin?"checked":""} ${u?.me?"disabled":""}> Admin (darf Nutzer verwalten)</label>
      <div class="err" id="uErr"></div>
      <div class="actions"><button type="button" class="btn ghost" id="cancel">Zurück</button><button class="btn" type="submit">${u?"Speichern":"Anlegen"}</button></div>
    </form>`);
  $("#cancel").onclick=showUsers;
  setTimeout(()=>$(u?"#uDisp":"#uDisp").focus(),40);
  $("#uForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const body={id:u?.id||0, username:$("#uName").value.trim(), displayName:$("#uDisp").value.trim(), isAdmin:$("#uAdmin").checked||!!u?.me&&u.isAdmin, password:$("#uPw")?$("#uPw").value:""};
    try{ await api("userSave",body); toast(u?"Gespeichert":"Nutzer angelegt"); if(u?.me) setTimeout(()=>location.reload(),600); else showUsers(); }
    catch(err){ $("#uErr").textContent=dbErr(err); }
  });
}
function userDelete(u){
  openModal(`<h2>${esc(u.displayName||u.username)} löschen?</h2>
    <div class="sub">Der Zugang und <b>alle ${u.items} Einträge</b> samt Status, Notizen und Verlauf werden endgültig gelöscht. Das lässt sich nicht rückgängig machen – außer mit einer Sicherung, die der Nutzer selbst heruntergeladen hat.</div>
    <label class="pwform"><span class="muted small">Zur Bestätigung den Benutzernamen <b>${esc(u.username)}</b> eingeben</span><input id="uConfirm" autocomplete="off" autocapitalize="none"></label>
    <div class="err" id="uErr"></div>
    <div class="actions"><button class="btn ghost" id="cancel">Zurück</button><button class="btn danger" id="go" disabled>Endgültig löschen</button></div>`);
  $("#cancel").onclick=showUsers;
  $("#uConfirm").addEventListener("input",e=>{ $("#go").disabled=e.target.value.trim()!==u.username; });
  $("#go").onclick=async()=>{ try{ await api("userDelete",{id:u.id}); toast("Nutzer gelöscht"); showUsers(); }catch(err){ $("#uErr").textContent=dbErr(err); } };
}
document.getElementById("usersBtn")?.addEventListener("click",showUsers);
