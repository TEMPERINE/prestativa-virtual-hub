const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fixture(t, { missing = false, corrupt = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('installer fixture');
  const hash = createHash('sha512').update(bytes).digest('base64');
  const filename = 'Virtual-Office-Setup-1.0.8.exe';
  fs.writeFileSync(path.join(dir, missing ? 'Virtual.Office.Setup.1.0.8.exe' : filename), corrupt ? 'damaged' : bytes);
  fs.writeFileSync(path.join(dir, `${filename}.blockmap`), 'blockmap');
  fs.writeFileSync(path.join(dir, 'latest.yml'), `version: 1.0.8\nfiles:\n  - url: ${filename}\n    sha512: ${hash}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${hash}\n`);
  return spawnSync(process.execPath, [path.join(__dirname, '../scripts/verify-update.cjs'), dir], { encoding: 'utf8' });
}
test('valid installer metadata is accepted', t => {
  const result = fixture(t);
  assert.equal(result.status, 0, result.stderr);
});
test('renamed release asset cannot pass update validation', t => {
  const result = fixture(t, { missing: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Virtual-Office-Setup-1.0.8.exe/);
});
test('corrupted installer cannot pass update validation', t => {
  const result = fixture(t, { corrupt: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum|size/i);
});
