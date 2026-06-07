const fs = require('fs');
const map = JSON.parse(fs.readFileSync('C:/projects/auto-repair-shop/.next-new/server/chunks/ssr/[root-of-the-server]__013s0~s._.js.map', 'utf8'));
const idx = map.sources.indexOf('../../../../src/lib/17vin/client.ts');
if (idx >= 0) {
  console.log('Found client.ts at index', idx);
  const src = map.sourcesContent[idx];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('getToken') || line.includes('tokenParams') || line.includes('url_parameters') || line.includes('token =')) {
      console.log((i+1) + ': ' + line);
    }
  });
} else {
  console.log('client.ts not found');
  console.log('17vin sources:', map.sources.filter((s) => s.includes('17vin')));
}
