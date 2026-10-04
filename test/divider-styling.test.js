const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("desktop divider labels use cool blue and retain add-row hover styling", () => {
  const cssAndHtml = read("desktop/panel.html");
  const renderer = read("desktop/renderer.js");

  assert.match(cssAndHtml, /\.divider-label\s*{\s*color:\s*#78aaff;/);
  assert.match(cssAndHtml, /\.add-divider-row:hover \.ride-name[\s\S]*?color:\s*var\(--accent\)/);
  assert.match(cssAndHtml, /\.custom-ride-divider\s*{[\s\S]*?background:\s*var\(--divider\)/);
  assert.equal(renderer.match(/divider-label/g)?.length, 4);
  assert.doesNotMatch(renderer, /Custom divider/);
});

test("mobile divider labels match desktop and retain active feedback", () => {
  const css = read("mobile/mobile.css");
  const renderer = read("mobile/mobile.js");

  assert.match(css, /\.divider-label\s*{\s*color:\s*#78aaff;/);
  assert.match(css, /\.add-divider-row:active \.divider-label\s*{\s*color:\s*var\(--accent\)/);
  assert.match(css, /\.custom-ride-divider\s*{\s*margin:\s*8px 0;/);
  assert.equal(renderer.match(/divider-label/g)?.length, 4);
  assert.doesNotMatch(renderer, /Custom divider/);
});
