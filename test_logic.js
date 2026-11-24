/* Headless logic smoke test for the generated app modules */
const fs = require('fs');
const vm = require('vm');

function makeDocument() {
  const store = {};
  const doc = {
    getElementById(id) { return store[id] || null; },
    createElement() { return { className:'', innerHTML:'', style:{}, dataset:{}, appendChild(){}, addEventListener(){}, remove(){}, classList:{add(){},remove(){},toggle(){}}, setAttribute(){}, querySelector(){return null;}, querySelectorAll(){return [];} }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, body: { appendChild(){}, innerHTML:'' },
    documentElement: { style:{ setProperty(){} }, setAttribute(){} }
  };
  return doc;
}

const sandbox = {
  console,
  setTimeout, clearTimeout,
  Promise, JSON, Math, Date, URL, encodeURIComponent, decodeURIComponent,
  TextDecoder, TextEncoder, AbortController,
  fetch: () => Promise.reject(new Error('offline test')),
  navigator: { userAgent: 'node' },
  localStorage: (() => { const m = {}; return { getItem:k=>m[k]==null?null:m[k], setItem:(k,v)=>{m[k]=String(v)}, removeItem:k=>{delete m[k]} }; })(),
  location: { href:'http://localhost/', origin:'http://localhost' }
};
sandbox.window = sandbox;
sandbox.document = makeDocument();
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['js/data.js','js/ltx.js','js/core.js','js/subtitles.js','js/player.js','js/search.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}

function ok(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); if (!cond) process.exitCode = 1; }

const A = sandbox.AV, S = sandbox.Search, SUB = sandbox.Subtitles;
ok('AV_DATA sites >= 99 (+JAVTool)', A.D.sites.length >= 99, A.D.sites.length);
ok('JAVTool present (unverified)', A.D.sites.some(x => x.id === 'javtool' && x.unverified === true));
ok('AV_DATA subs=32', A.D.subtitleSites.length === 32, A.D.subtitleSites.length);
ok('AV_LTX=4310', A.LTX.length === 4310, A.LTX.length);
ok('normalizeCode URL', A.normalizeCode('https://missav.ws/SSIS-001') === 'SSIS-001', A.normalizeCode('https://missav.ws/SSIS-001'));

// SRT parse
const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nHello\\NWorld\r\n\r\n2\n00:00:04.000 --> 00:00:06.000\n<i>第二句</i>\n';
const cues = SUB.parseSRT(srt);
ok('parseSRT count=2', cues.length === 2, JSON.stringify(cues));
ok('parseSRT time', cues[0] && cues[0].start === 1 && cues[0].end === 3.5, JSON.stringify(cues[0]));
ok('parseSRT \\N + tag strip', cues[0] && cues[0].text.indexOf('Hello')>=0 && cues[1] && cues[1].text.indexOf('第二句')>=0, JSON.stringify(cues.map(c=>c.text)));

// rank: ltx > non-xunlei > exact > chinese
const items = [
  { url:'x', name:'a.srt', source:'迅雷字幕', language:'中文' },
  { url:'y', name:'CODE.srt', source:'SubtitleCat', language:'其他' },
  { url:'z', name:'c.srt', source:'SubHD', language:'中文', ltx:true },
  { url:'w', name:'d.srt', source:'Subf2m', language:'英文' }
];
const ranked = SUB.rank(items, 'CODE');
ok('rank ltx first', ranked[0].ltx === true, ranked.map(x=>x.source).join(','));
ok('rank xunlei last', ranked[ranked.length-1].source === '迅雷字幕', ranked.map(x=>x.source).join(','));

// LTX subtitle hit (script row with subtitle)
const hit = SUB.ltxHit('200GANA-1131');
ok('ltxHit found', !!hit && /subtitlecat/.test(hit.url), hit && hit.url);

// Search.siteUrl / ltx
const site = A.D.sites.find(x=>x.id==='missav');
ok('siteUrl template', S.siteUrl(site,'ABC-123') === 'https://missav.ws/search/ABC-123', S.siteUrl(site,'ABC-123'));
const ltx = S.ltx('200GANA-1131', 5);
ok('Search.ltx local', ltx.length >= 1 && ltx[0].code === '200GANA-1131', JSON.stringify(ltx[0]||{}));
const ltxTitle = S.ltx('ラグジュ', 5);
ok('Search.ltx title search', ltxTitle.length > 0, ltxTitle.length);

// MD5 known vector
ok('md5 abc', S._md5('abc') === '900150983cd24fb0d6963f7d28e17f72', S._md5('abc'));

console.log('\nDone.');
