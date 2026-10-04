const test = require("node:test");
const assert = require("node:assert/strict");

const Shared = require("../shared/queue-panel-shared");

test("application metadata matches the current release and Android build", () => {
  assert.equal(Shared.APP_METADATA.version, "1.3.0");
  assert.equal(Shared.APP_METADATA.build, "2");
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
