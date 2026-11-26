// Runs each test/*.test.js in its own process. `node --test` on Node 18.13
// crashes on non-ASCII test names (TAP lexer bug), and ours are in Spanish.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = path.join(__dirname, '..', 'test');
const filter = process.argv[2];
const files = fs.readdirSync(testDir)
    .filter(name => name.endsWith('.test.js'))
    .filter(name => !filter || name.includes(filter))
    .sort();

const failed = [];
for (const file of files) {
    console.log(`\n=== ${file}`);
    const result = spawnSync(process.execPath, [path.join(testDir, file)], { stdio: 'inherit' });
    if (result.status !== 0) failed.push(file);
}

console.log(`\n${files.length - failed.length}/${files.length} archivos de test pasaron.`);
if (failed.length) {
    console.log(`Fallaron: ${failed.join(', ')}`);
    process.exit(1);
}
