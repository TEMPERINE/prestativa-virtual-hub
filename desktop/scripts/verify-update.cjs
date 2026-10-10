const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const YAML = require("yaml");
const pkg = require("../package.json");

try {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, "../dist"));
  const manifest = YAML.parse(fs.readFileSync(path.join(dir, "latest.yml"), "utf8"));
  const expected = `Virtual-Office-Setup-${pkg.version}.exe`;
  if (manifest.version !== pkg.version || manifest.path !== expected) {
    throw new Error("Update version/path differs from desktop package");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 1 || manifest.files[0].url !== expected) {
    throw new Error("Update files must reference the generated installer");
  }
  const bytes = fs.readFileSync(path.join(dir, expected));
  const hash = createHash("sha512").update(bytes).digest("base64");
  if (hash !== manifest.sha512 || hash !== manifest.files[0].sha512) {
    throw new Error("Installer checksum mismatch");
  }
  if (bytes.length !== manifest.files[0].size) throw new Error("Installer size mismatch");
  fs.accessSync(path.join(dir, `${expected}.blockmap`));
  console.log(`Validated update ${pkg.version}: ${expected}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
