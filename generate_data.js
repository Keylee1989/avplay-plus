const fs = require('fs');
const sites = JSON.parse(fs.readFileSync('data_sites.json', 'utf8'));
const subs = JSON.parse(fs.readFileSync('data_subtitles.json', 'utf8'));
const ltx = JSON.parse(fs.readFileSync('data_ltx.json', 'utf8'));

fs.mkdirSync('js', { recursive: true });
fs.mkdirSync('css', { recursive: true });

// Escape all non-ASCII to \uXXXX so the generated JS is byte-order / charset independent
// (local python http.server does not send a charset for .js files).
function asciiJson(obj, pretty) {
  var s = JSON.stringify(obj, null, pretty ? 2 : 0);
  return s.replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

fs.writeFileSync('js/data.js',
  'window.AV_DATA = ' + asciiJson({
    sites: sites,
    subtitleSites: subs,
    srtIndex: ['qucihe','javsubtitled','javfilms','avsubtitles','subtitlecat'],
    apis: {
      xunlei: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name={q}',
      javdb: 'https://jdforrepam.com',
      javRankingWorker: 'https://app.keylee.eu.cc',
      gateway: ''
    },
    groups: { play: '在线播放', lib: '番号资料', magnet: '磁力 / 论坛', sub: '字幕 / 社群' },
    extraSites: [
      { id: 'javtool', name: 'JAVTool', host: 'javtool.com', group: 'lib', url: 'https://javtool.com', unverified: true, source: 'spec' },
      { id: 'javhd_insav', name: 'JavHD（Insav 线路）', host: 'javhd.com', group: 'play', url: 'https://javhd.com/en/search?q={q}', verified: true, source: 'insav-ipa' },
      { id: 'upload18', name: 'Upload18（Insav）', host: 'upload18.org', group: 'play', url: 'https://upload18.org/', unverified: true, source: 'insav-ipa' }
    ]
  }, true) + ';\n');
fs.writeFileSync('js/ltx.js', 'window.AV_LTX = ' + asciiJson(ltx, false) + ';\n');
// JAVTool is required by the spec but not defined in the script's SUA_AV_SITES.
// Add it with the bare homepage and mark unverified — never guess a search format.
const all = JSON.parse(fs.readFileSync('js/data.js', 'utf8').replace(/^window\.AV_DATA = /, '').replace(/;\s*$/, ''));
all.sites.push.apply(all.sites, all.extraSites || []);
delete all.extraSites;
fs.writeFileSync('js/data.js', 'window.AV_DATA = ' + asciiJson(all, true) + ';\n');
console.log('data.js', fs.statSync('js/data.js').size, 'ltx.js', fs.statSync('js/ltx.js').size);
console.log('sites', sites.length, 'subs', subs.length, 'ltx', ltx.length);
