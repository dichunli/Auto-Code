const fs = require('fs');

const content = fs.readFileSync('supabase/schema.sql', 'utf-8');
const lines = content.split('\n');

let part1 = [];
let part2 = [];
let state = 0; // 0=normal, 1=function, 2=trigger
let buffer = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (state === 0) {
    if (line.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+/i)) {
      part1.push(...buffer);
      buffer = [line];
      state = 1;
    } else if (line.match(/CREATE\s+TRIGGER\s+/i)) {
      part1.push(...buffer);
      buffer = [line];
      state = 2;
    } else {
      buffer.push(line);
    }
  } else if (state === 1) {
    buffer.push(line);
    // Match $$ LANGUAGE 'plpgsql'; or $$ LANGUAGE plpgsql; or just $$;
    if (line.match(/^\s*\$\$\s*(LANGUAGE\s+['"]?\w+['"]?)?\s*;?\s*$/i)) {
      part2.push(...buffer);
      buffer = [];
      state = 0;
    }
  } else if (state === 2) {
    buffer.push(line);
    if (line.match(/EXECUTE\s+FUNCTION\s+[^;]+;\s*$/i)) {
      part2.push(...buffer);
      buffer = [];
      state = 0;
    }
  }
}

if (buffer.length > 0) {
  if (state === 0) part1.push(...buffer);
  else part2.push(...buffer);
}

fs.writeFileSync('supabase/schema_part1_tables.sql', part1.join('\n'));
fs.writeFileSync('supabase/schema_part2_functions.sql', part2.join('\n'));

console.log('Part 1 (tables): ' + part1.length + ' lines');
console.log('Part 2 (functions): ' + part2.length + ' lines');

const p1Functions = part1.filter(l => l.match(/RETURN NEW;/i) || l.match(/\$\$\s*LANGUAGE/i) || l.match(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i));
console.log('Function remnants in part1: ' + p1Functions.length);
for (const l of p1Functions.slice(0, 10)) {
  console.log('  ' + (part1.indexOf(l) + 1) + ': ' + l.trim().substring(0, 80));
}
