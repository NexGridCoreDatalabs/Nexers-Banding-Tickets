const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, '..', 'officialnames.csv'), 'utf8');
const lines = raw.split(/\r?\n/);
const seen = new Set();
const names = [];
for (const line of lines) {
  const n = line.trim().replace(/\s+/g, ' ');
  if (!n) continue;
  const key = n.toUpperCase();
  if (seen.has(key)) continue;
  seen.add(key);
  names.push(n);
}
function esc(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
const header = `-- Generated from officialnames.csv; ${names.length} unique display names\n`;
const chunks = [];
const chunkSize = 80;
for (let i = 0; i < names.length; i += chunkSize) {
  const part = names.slice(i, i + chunkSize).map((n) => `(${esc(n)})`).join(',\n');
  chunks.push(
    'INSERT INTO prt_workforce_roster (display_name) VALUES\n' +
      part +
      '\nON CONFLICT (display_name) DO NOTHING;'
  );
}
const out = header + chunks.join('\n\n');
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '043_seed_prt_workforce_roster_data.sql'), out);
console.log('Wrote', names.length, 'names to 043_seed_prt_workforce_roster_data.sql');
