const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createModalOperationGuard
} = require("../desktop/modal-operation-guard");

function windowStub({ visible = true } = {}) {
  return {
    showCalls: 0,
    focusCalls: 0,
    isDestroyed: () => false,
    isVisible: () => visible,
    show() {
      visible = true;
      this.showCalls += 1;
    },
    focus() {
      this.focusCalls += 1;
    }
  };
}

test("Settings and About use fixed headers with independently scrolling bodies", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "desktop", "panel.html"),
    "utf8"
  );

  for (const viewId of ["settingsView", "aboutView"]) {
    assert.match(
      html,
      new RegExp(`id="${viewId}" class="fixed-header-view hidden"[\\s\\S]*?<div class="header">[\\s\\S]*?<div class="view-scroll-body(?: about-content)?">`)
    );
  }
});

test("desktop home header keeps one fixed navigation slot in both modes", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "desktop", "panel.html"),
    "utf8"
  );

  assert.match(
    html,
    /id="parkNavSlot"[\s\S]*?id="prevParkBtn"[\s\S]*?id="nextParkBtn"[\s\S]*?id="transientParkBackBtn"[\s\S]*?id="refreshBtn"/
  );
  assert.match(html, /\.park-nav-slot\.transient \.cycle-park-btn\s*{[\s\S]*?visibility:\s*hidden/);
  assert.match(html, /\.transient-park-back-btn\s*{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0/);
});

test("desktop transient drill-down preserves refresh and clears on Home", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "desktop", "renderer.js"),
    "utf8"
  );
  const homeHandler = source.match(
    /async function goHomePark\(\)\s*{([\s\S]*?)\n}/
  )?.[1];
  const refreshHandler = source.match(
    /\$\("refreshBtn"\)\.addEventListener\("click", async \(\) => {([\s\S]*?)\n}\);/
  )?.[1];

  assert.match(homeHandler, /clearTransientParkDrilldown\(\)/);
  assert.doesNotMatch(refreshHandler, /clearTransientParkDrilldown\(\)/);
  assert.match(source, /beginTransientParkDrilldown\(originId\)[\s\S]*?Shared\.viewPark\(state, ride\.parkId/);
  assert.match(source, /transientParkNavigation\.consumeOrigin\(\)[\s\S]*?Shared\.viewPark\(state, origin\.id/);
});

test("normal blur remains eligible to auto-hide outside modal operations", () => {
  const guard = createModalOperationGuard(() => windowStub());

  assert.equal(guard.isActive(), false);
  assert.equal(guard.shouldAutoHide(), true);
});

for (const operationName of ["Export", "Import"]) {
  test(`${operationName} suppresses auto-hide while its native dialog is open`, async () => {
    const window = windowStub();
    const guard = createModalOperationGuard(() => window);
    let release;
    const operation = guard.run(() => new Promise((resolve) => {
      release = resolve;
    }));

    assert.equal(guard.isActive(), true);
    assert.equal(guard.shouldAutoHide(), false);
    release({ canceled: false });
    await operation;

    assert.equal(guard.shouldAutoHide(), true);
    assert.equal(window.focusCalls, 1);
  });

  test(`canceling ${operationName} restores normal auto-hide`, async () => {
    const window = windowStub({ visible: false });
    const guard = createModalOperationGuard(() => window);

    const result = await guard.run(async () => ({ canceled: true }));

    assert.deepEqual(result, { canceled: true });
    assert.equal(guard.shouldAutoHide(), true);
    assert.equal(window.showCalls, 1);
    assert.equal(window.focusCalls, 1);
  });
}

test("successful import restores and focuses the panel before confirmation", async () => {
  const window = windowStub({ visible: false });
  const guard = createModalOperationGuard(() => window);

  const result = await guard.run(async () => ({
    canceled: false,
    content: "backup"
  }));

  assert.equal(result.content, "backup");
  assert.equal(window.showCalls, 1);
  assert.equal(window.focusCalls, 1);
  assert.equal(guard.shouldAutoHide(), true);
});

test("file-operation errors still restore normal auto-hide", async () => {
  const window = windowStub({ visible: false });
  const guard = createModalOperationGuard(() => window);

  await assert.rejects(
    guard.run(async () => {
      throw new Error("disk error");
    }),
    /disk error/
  );

  assert.equal(window.showCalls, 1);
  assert.equal(window.focusCalls, 1);
  assert.equal(guard.shouldAutoHide(), true);
});
