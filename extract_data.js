const fs = require('fs');
const src = fs.readFileSync('source_script.user.js', 'utf8');

function extractArray(name) {
  const marker = 'var ' + name + ' = [';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('not found: ' + name);
  const arrStart = start + marker.length - 1; // index of '['
  let depth = 0, inStr = null, esc = false;
  for (let i = arrStart; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { const lit = src.slice(arrStart, i + 1); return { lit, end: i + 1 }; } }
  }
  throw new Error('no closing bracket: ' + name);
}

function evaluate(name) {
  const { lit } = extractArray(name);
  // eslint-disable-next-line no-eval
  return eval(lit);
}

const out = {};
for (const n of ['SUA_AV_SITES', 'BUILTIN_SUBTITLE_SITES', 'SRT_INDEX_SOURCES', 'SUA_LTX_LIB']) {
  try {
    const v = evaluate(n);
    out[n] = v;
    console.log(n, 'count =', v.length, 'bytes =', JSON.stringify(v).length);
  } catch (e) {
    console.log(n, 'ERROR', e.message);
  }
}

const sites = out.SUA_AV_SITES || [];
const groups = {};
sites.forEach(s => { groups[s.group] = (groups[s.group] || 0) + 1; });
console.log('SUA_AV_SITES groups:', JSON.stringify(groups));

fs.writeFileSync('data_sites.json', JSON.stringify(out.SUA_AV_SITES || [], null, 2));
fs.writeFileSync('data_subtitles.json', JSON.stringify(out.BUILTIN_SUBTITLE_SITES || [], null, 2));
fs.writeFileSync('data_ltx.json', JSON.stringify(out.SUA_LTX_LIB || []));
console.log('written data_sites.json / data_subtitles.json / data_ltx.json');

// Search for other big datasets
for (const kw of ['JAVRANKING', 'JavRanking', 'javranking', 'JAVTOOL', 'javtool', 'ACTOR', '33523', '422880', '18975', '4310']) {
  const idx = src.indexOf(kw);
  console.log('KW', kw, idx);
}
