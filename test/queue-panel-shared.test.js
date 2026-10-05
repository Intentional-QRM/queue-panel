const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Shared = require("../shared/queue-panel-shared");
const packageMetadata = require("../package.json");

test("application metadata matches the current release and Android build", () => {
  const androidBuild = fs.readFileSync(
    path.join(__dirname, "..", "android", "app", "build.gradle"),
    "utf8"
  );

  assert.equal(packageMetadata.version, "1.4.0");
  assert.equal(Shared.APP_METADATA.version, "1.4.0");
  assert.equal(Shared.APP_METADATA.build, "3");
  assert.equal(Shared.BACKUP_VERSION, 1);
  assert.match(androidBuild, /versionCode\s+3/);
  assert.match(androidBuild, /versionName\s+"1\.4\.0"/);
});

function memoryStorage(initialValue) {
  let value = initialValue;

  return {
    getItem() {
      return value;
    },
    setItem(key, nextValue) {
      value = nextValue;
    }
  };
}

test("loadState supplies defaults for empty and malformed persisted state", () => {
  for (const persisted of [null, "", "{not json"]) {
    const state = Shared.loadState(memoryStorage(persisted), "state");

    assert.equal(state.settings.theme, "dark");
    assert.equal(state.settings.timeFormat, "12h");
    assert.equal(state.settings.waitListTextSize, "small");
    assert.deepEqual(state.favoriteParkIds, []);
    assert.deepEqual(state.parkOrder, []);
    assert.deepEqual(state.customParks, []);
  }
});

test("loadState migrates partial state and repairs favorite park ordering", () => {
  const persisted = JSON.stringify({
    favoriteParkIds: [2, "1", 2],
    parkOrder: ["missing", 2],
    settings: { theme: "invalid", timeFormat: "24h" }
  });

  const state = Shared.loadState(memoryStorage(persisted), "state");

  assert.deepEqual(state.favoriteParkIds, ["2", "1"]);
  assert.deepEqual(state.parkOrder, ["2", "1"]);
  assert.deepEqual(state.settings, {
    theme: "dark",
    timeFormat: "24h",
    waitListTextSize: "small"
  });
});

test("park picker preserves favorite order and sorts remaining parks", () => {
  const state = Shared.normalizeState({
    favoriteParkIds: ["2", "1"],
    parkOrder: ["1", "2"],
    customParks: [],
    settings: {}
  });
  const model = Shared.parkPickerGroups(state, [
    { id: "3", name: "Zulu", country: "", continent: "" },
    { id: "2", name: "Bravo", country: "", continent: "" },
    { id: "1", name: "Alpha", country: "", continent: "" },
    { id: "4", name: "Delta", country: "", continent: "" }
  ], "");

  assert.deepEqual(model.favoriteParks.map((park) => park.id), ["1", "2"]);
  assert.deepEqual(model.otherParks.map((park) => park.id), ["4", "3"]);
});

test("standard ride toggling preserves order and removes a selected ride", () => {
  const state = Shared.normalizeState({ ridesByParkId: {}, settings: {} });

  Shared.toggleStandardRide(state, "7", "Ride B");
  Shared.toggleStandardRide(state, "7", "Ride A");
  assert.deepEqual(state.ridesByParkId["7"], ["Ride B", "Ride A"]);

  Shared.toggleStandardRide(state, "7", "Ride B");
  assert.deepEqual(state.ridesByParkId["7"], ["Ride A"]);
});

test("configured ride-list state follows saved content, not favorite status", () => {
  const state = Shared.normalizeState({
    favoriteParkIds: ["1", "2"],
    parkOrder: ["1", "2"],
    ridesByParkId: {
      1: [],
      2: ["Configured Ride"],
      3: ["Non-Favorite Ride"],
      4: [{ type: "divider", title: "Divider" }]
    },
    settings: {}
  });

  assert.equal(Shared.hasConfiguredRideList(state, "1"), false);
  assert.equal(Shared.hasConfiguredRideList(state, "2"), true);
  assert.equal(Shared.hasConfiguredRideList(state, "3"), true);
  assert.equal(Shared.hasConfiguredRideList(state, "4"), true);
  assert.equal(Shared.hasConfiguredRideList(state, "missing"), false);

  Shared.toggleFavoritePark(state, { id: "2", name: "Configured Favorite" });
  Shared.toggleFavoritePark(state, { id: "3", name: "Configured Non-Favorite" });

  assert.equal(Shared.hasConfiguredRideList(state, "2"), true);
  assert.equal(Shared.hasConfiguredRideList(state, "3"), true);

  state.ridesByParkId[2].splice(0);
  assert.equal(Shared.hasConfiguredRideList(state, "2"), false);
});

test("custom-list configured state requires actual saved list content", () => {
  const state = Shared.normalizeState({
    customParks: [
      { id: "custom_1", name: "Empty List" },
      { id: "custom_2", name: "Renamed But Empty" },
      { id: "custom_3", name: "Populated List" }
    ],
    customParkRides: {
      custom_1: [],
      custom_2: [],
      custom_3: [{ type: "parkStatus", parkId: "7" }]
    },
    settings: {}
  });

  assert.equal(Shared.hasConfiguredRideList(state, "custom_1"), false);
  assert.equal(Shared.hasConfiguredRideList(state, "custom_2"), false);
  assert.equal(Shared.hasConfiguredRideList(state, "custom_3"), true);

  state.customParkRides.custom_1.push({ type: "divider", title: "Divider" });
  assert.equal(Shared.hasConfiguredRideList(state, "custom_1"), true);

  state.customParkRides.custom_1.splice(0);
  state.customParkRides.custom_3.splice(0);
  assert.equal(Shared.hasConfiguredRideList(state, "custom_1"), false);
  assert.equal(Shared.hasConfiguredRideList(state, "custom_3"), false);
});

test("custom list creation initializes normalized state and unique numbering", () => {
  const state = Shared.normalizeState({
    favoriteParkIds: [],
    parkOrder: [],
    parkNamesById: {},
    customParks: [{ id: "custom_2", name: "Custom List 2" }],
    customParkRides: {},
    settings: {}
  });

  const park = Shared.createCustomList(state);

  assert.deepEqual(park, { id: "custom_3", name: "Custom List 3" });
  assert.equal(state.currentParkId, "custom_3");
  assert.deepEqual(state.customParkRides.custom_3, []);
  assert.ok(state.favoriteParkIds.includes("custom_3"));
  assert.ok(state.parkOrder.includes("custom_3"));
});

test("custom rides normalize IDs and toggle without duplicating entries", () => {
  const state = Shared.normalizeState({
    customParks: [{ id: "custom_1", name: "Favorites" }],
    customParkRides: {},
    settings: {}
  });
  const ride = { parkId: 12, parkName: "Test Park", name: "Test Ride" };

  Shared.toggleCustomRide(state, "custom_1", ride);
  assert.deepEqual(state.customParkRides.custom_1, [{
    parkId: "12",
    parkName: "Test Park",
    rideName: "Test Ride"
  }]);

  Shared.toggleCustomRide(state, "custom_1", ride);
  assert.deepEqual(state.customParkRides.custom_1, []);
});

test("Queue-Times URL generators produce the expected endpoints", () => {
  const api = Shared.createApi();

  assert.equal(
    api.queueUrl(42),
    "https://queue-times.com/parks/42/queue_times.json"
  );
  assert.equal(
    api.pageUrl("42"),
    "https://queue-times.com/parks/42/queue_times"
  );
});

test("Queue-Times park responses are flattened, normalized, and sorted", () => {
  const parks = Shared.normalizeParks([
    { parks: [
      { id: 2, name: "Zulu" },
      { id: 1, name: "Alpha", country: "US", continent: "North America" }
    ] },
    null,
    { parks: "malformed" },
    { parks: [{ id: 3 }, null] }
  ]);

  assert.deepEqual(parks, [
    { id: "1", name: "Alpha", country: "US", continent: "North America" },
    { id: "2", name: "Zulu", country: "", continent: "" }
  ]);
  assert.deepEqual(Shared.normalizeParks(null), []);
  assert.deepEqual(Shared.normalizeParks({ parks: [] }), []);
});

test("Queue-Times ride responses support lands, top-level rides, and malformed data", () => {
  const landRide = { id: 1, name: "Land Ride" };
  const topLevelRide = { id: 2, name: "Top-Level Ride" };

  assert.deepEqual(Shared.ridesFromQueueData({
    lands: [{ rides: [landRide] }, null, { rides: "malformed" }]
  }), [landRide]);
  assert.deepEqual(Shared.ridesFromQueueData({ rides: [topLevelRide] }), [
    topLevelRide
  ]);
  assert.deepEqual(Shared.ridesFromQueueData({ lands: [], rides: [] }), []);
  assert.deepEqual(Shared.ridesFromQueueData(null), []);
});

test("failed refresh placeholders preserve selected ride metadata and ordering", () => {
  const savedItems = [
    "Ride One",
    { type: "divider" },
    { type: "parkStatus" },
    "Ride Two"
  ];

  assert.deepEqual(Shared.placeholderRideItems(savedItems), [
    { name: "Ride One", placeholderWait: true },
    { type: "divider" },
    { type: "parkStatus", name: "Park Status", statusText: "--" },
    { name: "Ride Two", placeholderWait: true }
  ]);
});

test("custom-list failure placeholders use saved ride and park names", () => {
  assert.deepEqual(Shared.placeholderRideItems([
    { parkId: 7, parkName: "Test Park", rideName: "Test Ride" },
    { type: "parkStatus", parkId: 7, parkName: "Test Park" },
    null
  ], true), [
    { name: "Test Ride", placeholderWait: true },
    {
      type: "parkStatus",
      parkId: "7",
      parkName: "Test Park",
      name: "Test Park",
      statusText: "--"
    }
  ]);
});

test("transient park viewing changes only the viewed park and name cache", () => {
  const state = Shared.normalizeState({
    currentParkId: "custom_1",
    homeParkId: "1",
    favoriteParkIds: ["1", "custom_1"],
    parkOrder: ["1", "custom_1"],
    parkNamesById: { custom_1: "Summary" },
    ridesByParkId: { 7: ["Saved Ride"] },
    customParks: [{ id: "custom_1", name: "Summary" }],
    customParkRides: {
      custom_1: [{ parkId: "7", rideName: "Saved Ride" }]
    },
    settings: {}
  });
  const configurationBefore = {
    homeParkId: state.homeParkId,
    favoriteParkIds: [...state.favoriteParkIds],
    parkOrder: [...state.parkOrder],
    ridesByParkId: structuredClone(state.ridesByParkId),
    customParkRides: structuredClone(state.customParkRides)
  };

  Shared.viewPark(state, 7, "Test Park");

  assert.equal(state.currentParkId, "7");
  assert.equal(state.parkNamesById["7"], "Test Park");
  assert.deepEqual({
    homeParkId: state.homeParkId,
    favoriteParkIds: state.favoriteParkIds,
    parkOrder: state.parkOrder,
    ridesByParkId: state.ridesByParkId,
    customParkRides: state.customParkRides
  }, configurationBefore);
});

test("viewing an existing favorite leaves its favorite configuration unchanged", () => {
  const state = Shared.normalizeState({
    currentParkId: "custom_1",
    favoriteParkIds: ["7", "custom_1"],
    parkOrder: ["custom_1", "7"],
    parkNamesById: { 7: "Test Park", custom_1: "Summary" },
    customParks: [{ id: "custom_1", name: "Summary" }],
    settings: {}
  });

  Shared.viewPark(state, 7, "Test Park");

  assert.equal(state.currentParkId, "7");
  assert.deepEqual(state.favoriteParkIds, ["7", "custom_1"]);
  assert.deepEqual(state.parkOrder, ["custom_1", "7"]);
});

test("transient navigation returns once and clears stale context", () => {
  const navigation = Shared.createTransientParkNavigation();
  const state = Shared.normalizeState({
    currentParkId: "custom_1",
    favoriteParkIds: ["custom_1"],
    parkOrder: ["custom_1"],
    parkNamesById: { custom_1: "Summary" },
    customParks: [{ id: "custom_1", name: "Summary" }],
    customParkRides: { custom_1: [{ parkId: "7", rideName: "Saved Ride" }] },
    settings: {}
  });
  const customConfiguration = structuredClone(state.customParkRides);

  navigation.begin("custom_1");
  Shared.viewPark(state, "7", "Test Park");
  const origin = navigation.consumeOrigin();
  Shared.viewPark(state, origin, "Summary");

  assert.equal(state.currentParkId, "custom_1");
  assert.deepEqual(state.customParkRides, customConfiguration);
  assert.deepEqual(state.favoriteParkIds, ["custom_1"]);
  assert.deepEqual(state.parkOrder, ["custom_1"]);
  assert.equal(navigation.consumeOrigin(), null);

  navigation.begin("custom_2");
  navigation.clear();
  assert.equal(navigation.consumeOrigin(), null);

  navigation.begin("7");
  assert.equal(navigation.consumeOrigin(), null);
});

test("queue response shape validation distinguishes valid empty data", () => {
  assert.equal(Shared.isQueueData({ rides: [] }), true);
  assert.equal(Shared.isQueueData({ lands: [] }), true);
  assert.equal(Shared.isQueueData({}), false);
  assert.equal(Shared.isQueueData(null), false);
});

test("backup round-trip preserves complete persistent configuration", () => {
  const state = Shared.normalizeState({
    homeParkId: "1",
    currentParkId: "custom_1",
    favoriteParkIds: ["1", "custom_1"],
    parkOrder: ["custom_1", "1"],
    ridesByParkId: {
      1: ["Ride One", { type: "divider", title: "Divider" }]
    },
    parkNamesById: { 1: "Test Park", custom_1: "Trip List" },
    customParks: [{ id: "custom_1", name: "Trip List" }],
    customParkRides: {
      custom_1: [
        { type: "parkStatus", parkId: "1", parkName: "Test Park" },
        { parkId: "1", parkName: "Test Park", rideName: "Ride One" }
      ]
    },
    settings: { theme: "light", timeFormat: "24h", waitListTextSize: "large" }
  });

  const json = Shared.serializeBackup(state, "2026-10-04T18:30:00.000Z");
  const parsedWrapper = JSON.parse(json);
  const imported = Shared.parseBackup(json);

  assert.equal(parsedWrapper.format, "queue-panel-backup");
  assert.equal(parsedWrapper.version, 1);
  assert.equal(parsedWrapper.exportedAt, "2026-10-04T18:30:00.000Z");
  assert.deepEqual(imported, Shared.persistentState(state));
});

test("backup validation rejects invalid JSON, format, version, and state", () => {
  assert.throws(() => Shared.parseBackup("{invalid"), { code: "invalid_json" });
  assert.throws(() => Shared.parseBackup(JSON.stringify({
    format: "unrelated",
    version: 1,
    exportedAt: "2026-10-04T18:30:00.000Z",
    state: {}
  })), { code: "invalid_format" });
  assert.throws(() => Shared.parseBackup(JSON.stringify({
    format: "queue-panel-backup",
    version: 2,
    exportedAt: "2026-10-04T18:30:00.000Z",
    state: {}
  })), { code: "unsupported_version" });
  assert.throws(() => Shared.parseBackup(JSON.stringify({
    format: "queue-panel-backup",
    version: 1,
    exportedAt: "2026-10-04T18:30:00.000Z"
  })), { code: "invalid_state" });
  assert.throws(() => Shared.parseBackup(JSON.stringify({
    format: "queue-panel-backup",
    version: 1,
    exportedAt: "2026-10-04T18:30:00.000Z",
    state: { favoriteParkIds: "not-an-array" }
  })), { code: "invalid_state" });
});

test("failed validation and canceled replacement leave existing state untouched", () => {
  const current = Shared.normalizeState({
    favoriteParkIds: ["1"],
    parkOrder: ["1"],
    ridesByParkId: { 1: ["Ride One"] },
    settings: {}
  });
  const before = structuredClone(current);

  assert.throws(() => Shared.parseBackup("not-json"));
  assert.deepEqual(current, before);
  assert.equal(
    Shared.replaceConfiguration(current, Shared.DEFAULT_STATE, false),
    current
  );
  assert.deepEqual(current, before);
});

test("confirmed import replaces rather than merges existing configuration", () => {
  const current = Shared.normalizeState({
    favoriteParkIds: ["old"],
    parkOrder: ["old"],
    ridesByParkId: { old: ["Old Ride"] },
    settings: { theme: "light" }
  });
  const imported = Shared.parseBackup(Shared.serializeBackup({
    favoriteParkIds: ["new"],
    parkOrder: ["new"],
    ridesByParkId: { new: ["New Ride"] },
    settings: { timeFormat: "24h" }
  }, "2026-10-04T18:30:00.000Z"));

  const replaced = Shared.replaceConfiguration(current, imported, true);

  assert.deepEqual(replaced.favoriteParkIds, ["new"]);
  assert.deepEqual(replaced.parkOrder, ["new"]);
  assert.deepEqual(replaced.ridesByParkId, { new: ["New Ride"] });
  assert.equal(replaced.settings.theme, "dark");
  assert.equal(replaced.settings.timeFormat, "24h");
  assert.equal(replaced.ridesByParkId.old, undefined);
});

test("blank detection ignores defaults and generated park-name cache", () => {
  assert.equal(Shared.hasMeaningfulConfiguration(Shared.DEFAULT_STATE), false);
  assert.equal(Shared.hasMeaningfulConfiguration({
    ...structuredClone(Shared.DEFAULT_STATE),
    parkNamesById: { 1: "Cached Park Name" }
  }), false);
  assert.equal(Shared.hasMeaningfulConfiguration({
    ...structuredClone(Shared.DEFAULT_STATE),
    settings: { ...Shared.DEFAULT_STATE.settings, theme: "light" }
  }), true);
  assert.equal(Shared.hasMeaningfulConfiguration({
    ...structuredClone(Shared.DEFAULT_STATE),
    customParks: [{ id: "custom_1", name: "Empty Custom List" }]
  }), true);
});

test("import normalization fills defaults and repairs invalid custom navigation", () => {
  const backup = {
    format: "queue-panel-backup",
    version: 1,
    exportedAt: "2026-10-04T18:30:00.000Z",
    state: {
      currentParkId: "custom_missing",
      favoriteParkIds: [2],
      parkOrder: [],
      settings: { theme: "invalid", timeFormat: "24h" }
    }
  };

  const imported = Shared.parseBackup(JSON.stringify(backup));

  assert.deepEqual(imported.favoriteParkIds, ["2"]);
  assert.deepEqual(imported.parkOrder, ["2"]);
  assert.equal(imported.currentParkId, "2");
  assert.equal(imported.settings.theme, "dark");
  assert.equal(imported.settings.timeFormat, "24h");
  assert.equal(imported.settings.waitListTextSize, "small");
});

test("backup export excludes transient and unknown runtime fields", () => {
  const state = {
    ...structuredClone(Shared.DEFAULT_STATE),
    favoriteParkIds: ["1"],
    parkOrder: ["1"],
    lastRefreshTime: 12345,
    parkHoursById: { 1: "Open" },
    currentRenderedRides: [{ name: "Runtime Ride", wait_time: 15 }],
    dragState: { active: true }
  };
  const backup = Shared.createBackup(state, "2026-10-04T18:30:00.000Z");

  assert.deepEqual(Object.keys(backup.state), Shared.PERSISTENT_STATE_KEYS);
  assert.equal("lastRefreshTime" in backup.state, false);
  assert.equal("parkHoursById" in backup.state, false);
  assert.equal("currentRenderedRides" in backup.state, false);
  assert.equal("dragState" in backup.state, false);
  assert.equal(
    Shared.serializeBackup(state, "2026-10-04T18:30:00.000Z"),
    JSON.stringify(backup, null, 2)
  );
});

test("backup filenames use the shared cross-platform naming convention", () => {
  assert.equal(
    Shared.backupFileName(new Date("2026-10-04T18:30:00.000Z")),
    "QueuePanel_Backup_2026-10-04.json"
  );
});

function keyedMemoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    }
  };
}

test("clearing fully configured storage returns fresh-install defaults", () => {
  const configured = {
    ...structuredClone(Shared.DEFAULT_STATE),
    homeParkId: "7",
    currentParkId: "7",
    favoriteParkIds: ["7"],
    parkOrder: ["7"],
    ridesByParkId: { 7: [{ id: "8", name: "Ride" }] },
    customParks: [{ id: "custom-1", name: "My List" }],
    customParkRides: { "custom-1": [{ id: "8", name: "Ride" }] },
    settings: { theme: "light", timeFormat: "24h", waitListTextSize: "large" }
  };
  const storage = keyedMemoryStorage({
    [Shared.QUEUE_PANEL_STORAGE_KEY]: JSON.stringify(configured),
    unrelatedApplicationData: "keep-me"
  });

  const cleared = Shared.clearQueuePanelData(storage, true);

  assert.deepEqual(cleared, Shared.loadState(keyedMemoryStorage(), Shared.QUEUE_PANEL_STORAGE_KEY));
  for (const key of Shared.QUEUE_PANEL_STORAGE_KEYS) {
    assert.equal(storage.has(key), false);
  }
  assert.equal(storage.getItem("unrelatedApplicationData"), "keep-me");
});

test("canceling clear changes neither state nor storage", () => {
  const serialized = JSON.stringify({ homeParkId: "7", favoriteParkIds: ["7"] });
  const storage = keyedMemoryStorage({
    [Shared.QUEUE_PANEL_STORAGE_KEY]: serialized
  });

  assert.equal(Shared.clearQueuePanelData(storage, false), null);
  assert.equal(storage.getItem(Shared.QUEUE_PANEL_STORAGE_KEY), serialized);
});

test("backup export and import still work after a clear", () => {
  const storage = keyedMemoryStorage({
    [Shared.QUEUE_PANEL_STORAGE_KEY]: JSON.stringify({ homeParkId: "7" })
  });
  const cleared = Shared.clearQueuePanelData(storage, true);
  const json = Shared.serializeBackup(cleared, "2026-10-04T18:30:00.000Z");

  assert.deepEqual(Shared.parseBackup(json), Shared.persistentState(cleared));
});
