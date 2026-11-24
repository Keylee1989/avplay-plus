const fs = require('fs');
const src = fs.readFileSync('source_script.user.js', 'utf8');

function evalVar(name, isString) {
  const re = new RegExp('var ' + name + ' = (' + (isString ? '"[\\s\\S]*?"' : '\\[[\\s\\S]*?\\]') + ')\\s*;');
  const m = src.match(re);
  if (!m) throw new Error('not found ' + name);
  return eval(m[1]);
}
function evalArrayLiteral(name) {
  const marker = 'var ' + name + ' = [';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('not found ' + name);
  const arrStart = start + marker.length - 1;
  let depth = 0, inStr = null, esc = false;
  for (let i = arrStart; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return eval(src.slice(arrStart, i + 1)); }
  }
  throw new Error('unterminated ' + name);
}

const domains = evalVar('SUA_AD_DOMAINS', true).split(' ').filter(Boolean);
const tokens = evalArrayLiteral('SUA_AD_TOKENS');
const selectors = evalArrayLiteral('AD_SELECTOR');
const live = evalArrayLiteral('LIVE_AD_SELECTOR');
const css = evalArrayLiteral('SUA_AD_CSS');

function ascii(s) { return s.replace(/[\u007f-\uffff]/g, c => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4)); }
const out = 'window.AV_ADBLOCK_DATA = ' + ascii(JSON.stringify({
  domains, tokens, selectors, live, css: Array.isArray(css) ? css.join('') : String(css || '')
})) + ';\n';
fs.writeFileSync('js/adblock_data.js', out);
console.log('domains', domains.length, 'tokens', tokens.length, 'selectors', selectors.length, 'live', live.length, 'bytes', out.length);
