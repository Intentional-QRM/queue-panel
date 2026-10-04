const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createPinchTextSizeGesture
} = require("../mobile/pinch-text-size");

function touches(distance) {
  return [
    { clientX: 0, clientY: 0 },
    { clientX: distance, clientY: 0 }
  ];
}

test("pinch out selects large once after crossing the threshold", () => {
  const changes = [];
  const gesture = createPinchTextSizeGesture((size) => changes.push(size));

  assert.equal(gesture.begin(touches(100)), true);
  assert.equal(gesture.move(touches(120)), false);
  assert.equal(gesture.move(touches(133)), true);
  assert.equal(gesture.move(touches(60)), false);
  assert.deepEqual(changes, ["large"]);
});

test("pinch in selects small and resets only after all fingers lift", () => {
  const changes = [];
  const gesture = createPinchTextSizeGesture((size) => changes.push(size));

  gesture.begin(touches(140));
  gesture.move(touches(100));
  gesture.end(1);
  assert.equal(gesture.isActive(), true);
  gesture.end(0);
  assert.equal(gesture.isActive(), false);

  gesture.begin(touches(100));
  gesture.move(touches(135));
  assert.deepEqual(changes, ["small", "large"]);
});

test("mobile pinch handling is gated to the home view and leaves desktop untouched", () => {
  const mobileSource = fs.readFileSync(
    path.join(__dirname, "..", "mobile", "mobile.js"),
    "utf8"
  );
  const desktopSource = fs.readFileSync(
    path.join(__dirname, "..", "desktop", "renderer.js"),
    "utf8"
  );

  assert.match(
    mobileSource,
    /event\.touches\.length === 2[\s\S]*?!views\.main\.classList\.contains\("hidden"\)/
  );
  assert.match(mobileSource, /createPinchTextSizeGesture\([\s\S]*?applyWaitListTextSize/);
  assert.doesNotMatch(desktopSource, /PinchTextSize|pinchTextSizeGesture/);
});
