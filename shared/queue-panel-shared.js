(function () {
  const DEFAULT_STATE = {
    homeParkId: null,
    currentParkId: null,
    favoriteParkIds: [],
    parkOrder: [],
    ridesByParkId: {},
    parkNamesById: {},
    customParks: [],
    customParkRides: {},
    settings: {
      theme: "dark",
      timeFormat: "12h",
      waitListTextSize: "small"
    }
  };

  const APP_METADATA = {
    name: "Queue Panel",
    version: "1.3.0",
    build: "2",
    repositoryUrl: "https://github.com/Intentional-QRM/queue-panel",
    queueTimesUrl: "https://queue-times.com"
  };

  const BACKUP_FORMAT = "queue-panel-backup";
  const BACKUP_VERSION = 1;
  const QUEUE_PANEL_STORAGE_KEY = "queuePanelState";
  const QUEUE_PANEL_STORAGE_KEYS = [QUEUE_PANEL_STORAGE_KEY];
  const FEATURE_FLAGS = Object.freeze({
    // Development utility: set to false before a public release to remove its UI.
    clearAllDataUtility: true
  });
  const PERSISTENT_STATE_KEYS = [
    "homeParkId",
    "currentParkId",
    "favoriteParkIds",
    "parkOrder",
    "ridesByParkId",
    "parkNamesById",
    "customParks",
    "customParkRides",
    "settings"
  ];

  function loadState(storage, storageKey) {
    try {
      return normalizeState({
        ...DEFAULT_STATE,
        ...(JSON.parse(storage.getItem(storageKey)) || {})
      });
    } catch {
      return normalizeState({ ...DEFAULT_STATE });
    }
  }

  function normalizeState(state) {
    state.settings = {
      ...DEFAULT_STATE.settings,
      ...(state.settings || {})
    };
    if (!["12h", "24h"].includes(state.settings.timeFormat)) {
      state.settings.timeFormat = DEFAULT_STATE.settings.timeFormat;
    }
    if (!["light", "dark"].includes(state.settings.theme)) {
      state.settings.theme = DEFAULT_STATE.settings.theme;
    }
    if (!["small", "large"].includes(state.settings.waitListTextSize)) {
      state.settings.waitListTextSize = DEFAULT_STATE.settings.waitListTextSize;
    }
    state.favoriteParkIds = uniqueIds(state.favoriteParkIds || []);
    state.parkOrder = uniqueIds(state.parkOrder || []).filter((id) =>
      state.favoriteParkIds.includes(id)
    );
    state.ridesByParkId = state.ridesByParkId || {};
    state.parkNamesById = state.parkNamesById || {};
    state.customParks = Array.isArray(state.customParks) ? state.customParks : [];
    state.customParkRides = state.customParkRides || {};

    for (const id of state.favoriteParkIds) {
      if (!state.parkOrder.includes(id)) {
        state.parkOrder.push(id);
      }
    }

    return state;
  }

  function saveState(storage, storageKey, state) {
    storage.setItem(storageKey, JSON.stringify(normalizeState(state)));
  }

  function clearQueuePanelData(storage, confirmed = true) {
    if (!confirmed) return null;

    for (const key of QUEUE_PANEL_STORAGE_KEYS) {
      storage.removeItem(key);
    }

    return loadState(storage, QUEUE_PANEL_STORAGE_KEY);
  }

  function configureOptionalAction(element, enabled) {
    if (!element) return false;
    if (!enabled) {
      element.remove();
      return false;
    }

    element.classList.remove("hidden");
    return true;
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function persistentState(state) {
    const source = isPlainObject(state) ? state : {};
    const snapshot = cloneJson(DEFAULT_STATE);

    for (const key of PERSISTENT_STATE_KEYS) {
      if (
        Object.prototype.hasOwnProperty.call(source, key) &&
        source[key] !== undefined
      ) {
        snapshot[key] = cloneJson(source[key]);
      }
    }

    const normalized = normalizeState(snapshot);
    const customIds = new Set(normalized.customParks.map((park) => String(park.id)));

    if (
      isCustomParkId(normalized.homeParkId) &&
      !customIds.has(String(normalized.homeParkId))
    ) {
      normalized.homeParkId = null;
    }
    if (
      isCustomParkId(normalized.currentParkId) &&
      !customIds.has(String(normalized.currentParkId))
    ) {
      normalized.currentParkId = null;
    }
    if (!normalized.currentParkId) {
      normalized.currentParkId =
        normalized.homeParkId || normalized.parkOrder[0] || null;
    }

    return normalized;
  }

  function createBackup(state, exportedAt = new Date().toISOString()) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt,
      state: persistentState(state)
    };
  }

  function serializeBackup(state, exportedAt) {
    return JSON.stringify(createBackup(state, exportedAt), null, 2);
  }

  function backupError(code, message = "This is not a valid Queue Panel backup.") {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function validateStateShape(value) {
    if (!isPlainObject(value)) throw backupError("invalid_state");

    const nullableId = (id) =>
      id === null || typeof id === "string" || Number.isFinite(id);
    if ("homeParkId" in value && !nullableId(value.homeParkId)) {
      throw backupError("invalid_state");
    }
    if ("currentParkId" in value && !nullableId(value.currentParkId)) {
      throw backupError("invalid_state");
    }

    for (const key of ["favoriteParkIds", "parkOrder"]) {
      if (
        key in value &&
        (!Array.isArray(value[key]) || !value[key].every(nullableId))
      ) {
        throw backupError("invalid_state");
      }
    }

    for (const key of ["ridesByParkId", "customParkRides"]) {
      if (key in value && !isPlainObject(value[key])) {
        throw backupError("invalid_state");
      }
      if (
        isPlainObject(value[key]) &&
        !Object.values(value[key]).every(Array.isArray)
      ) {
        throw backupError("invalid_state");
      }
    }

    if (
      "parkNamesById" in value &&
      (!isPlainObject(value.parkNamesById) ||
        !Object.values(value.parkNamesById).every((name) => typeof name === "string"))
    ) {
      throw backupError("invalid_state");
    }

    if (
      "customParks" in value &&
      (!Array.isArray(value.customParks) ||
        !value.customParks.every((park) =>
          isPlainObject(park) &&
          (typeof park.id === "string" || Number.isFinite(park.id)) &&
          typeof park.name === "string"
        ))
    ) {
      throw backupError("invalid_state");
    }

    if ("settings" in value && !isPlainObject(value.settings)) {
      throw backupError("invalid_state");
    }
  }

  function parseBackup(json) {
    let backup;
    try {
      backup = typeof json === "string" ? JSON.parse(json) : json;
    } catch {
      throw backupError("invalid_json");
    }

    if (!isPlainObject(backup) || backup.format !== BACKUP_FORMAT) {
      throw backupError("invalid_format");
    }
    if (backup.version !== BACKUP_VERSION) {
      throw backupError(
        "unsupported_version",
        "This Queue Panel backup uses an unsupported version."
      );
    }
    if (
      typeof backup.exportedAt !== "string" ||
      Number.isNaN(Date.parse(backup.exportedAt))
    ) {
      throw backupError("invalid_exported_at");
    }

    validateStateShape(backup.state);
    return persistentState(backup.state);
  }

  function hasMeaningfulConfiguration(state) {
    const value = persistentState(state);
    const settings = value.settings || {};

    return Boolean(
      value.homeParkId ||
      value.currentParkId ||
      value.favoriteParkIds.length ||
      value.parkOrder.length ||
      Object.values(value.ridesByParkId).some((items) => items.some(Boolean)) ||
      value.customParks.length ||
      Object.values(value.customParkRides).some((items) => items.some(Boolean)) ||
      settings.theme !== DEFAULT_STATE.settings.theme ||
      settings.timeFormat !== DEFAULT_STATE.settings.timeFormat ||
      settings.waitListTextSize !== DEFAULT_STATE.settings.waitListTextSize
    );
  }

  function replaceConfiguration(currentState, importedState, confirmed) {
    return confirmed ? persistentState(importedState) : currentState;
  }

  function backupFileName(date = new Date()) {
    return `QueuePanel_Backup_${date.toISOString().slice(0, 10)}.json`;
  }

  function uniqueIds(ids) {
    return [...new Set((ids || []).map(String))];
  }

  function ridesFromQueueData(data) {
    if (Array.isArray(data?.lands) && data.lands.length > 0) {
      return data.lands.flatMap((land) =>
        Array.isArray(land?.rides) ? land.rides : []
      );
    }

    if (Array.isArray(data?.rides)) {
      return data.rides;
    }

    return [];
  }

  function isQueueData(data) {
    return Boolean(
      data &&
      (Array.isArray(data.lands) || Array.isArray(data.rides))
    );
  }

  function parseParkStatusHtml(html, timeFormat = "12h") {
    try {
      const statusText = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("p.subtitle")
        ?.textContent
        ?.replace(/\s+/g, " ")
        ?.trim();

      if (!statusText) return "Unavailable";

      return formatParkStatusText(statusText, timeFormat);
    } catch {
      return "Unavailable";
    }
  }

  function isParkStatusOpen(statusText) {
    return /^(currently\s+open|open)\b/i.test(String(statusText || "").trim());
  }

  function timeFormatForState(state) {
    return state?.settings?.timeFormat === "24h" ? "24h" : "12h";
  }

  function themeForState(state) {
    return state?.settings?.theme === "light" ? "light" : "dark";
  }

  function waitListTextSizeForState(state) {
    return state?.settings?.waitListTextSize === "large" ? "large" : "small";
  }

  function formatClockTime(hour, minute, timeFormat = "12h") {
    if (timeFormat === "24h") {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }

    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    const displayMinute = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
    return `${displayHour}${displayMinute} ${period}`;
  }

  function parseStatusTimeParts(hourText, minuteText, meridiemText) {
    let hour = Number(hourText);
    const minute = minuteText === undefined ? 0 : Number(minuteText);
    const meridiem = meridiemText?.toLowerCase();

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      if (meridiem === "pm" && hour !== 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
    } else if (hour > 23) {
      return null;
    }

    return { hour, minute };
  }

  function formatParkStatusText(statusText, timeFormat = "12h") {
    const text = String(statusText || "").trim().replace(/^Currently open\b/i, "Open");
    const match = text.match(
      /^(open)\b(.*?)(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|\u2013|\u2014)\s*(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?(.*)$/i
    );
    if (!match) return text;

    const openParts = parseStatusTimeParts(match[3], match[4], match[5]);
    const closeParts = parseStatusTimeParts(match[6], match[7], match[8]);
    if (!openParts || !closeParts) return text;

    const prefix = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
    return `${prefix}${match[2]}${formatClockTime(openParts.hour, openParts.minute, timeFormat)} \u2013 ${formatClockTime(closeParts.hour, closeParts.minute, timeFormat)}${match[9]}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseStatusCloseTime(statusText, now = new Date()) {
    const text = String(statusText || "").trim();
    const match = text.match(
      /\bopen\b.*?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|–|—)\s*(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i
    );
    if (!match) return null;

    const openParts = parseStatusTimeParts(match[1], match[2], match[3]);
    const closeParts = parseStatusTimeParts(match[4], match[5], match[6]);
    if (!openParts || !closeParts) return null;

    const closeTime = new Date(now);
    closeTime.setHours(closeParts.hour, closeParts.minute, 0, 0);

    if (closeTime <= now) {
      const openMinutes = openParts.hour * 60 + openParts.minute;
      const closeMinutes = closeParts.hour * 60 + closeParts.minute;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (closeMinutes <= openMinutes && nowMinutes >= openMinutes) {
        closeTime.setDate(closeTime.getDate() + 1);
      } else {
        return null;
      }
    }

    return closeTime;
  }

  function parseParkStatusCloseTime(statusText, now = new Date()) {
    const text = String(statusText || "").trim();
    const match = text.match(
      /\bopen\b.*?(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\s*(?:-|\u2013|\u2014)\s*(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?\b/i
    );
    if (!match) return null;

    const openParts = parseStatusTimeParts(match[1], match[2], match[3]);
    const closeParts = parseStatusTimeParts(match[4], match[5], match[6]);
    if (!openParts || !closeParts) return null;

    const closeTime = new Date(now);
    closeTime.setHours(closeParts.hour, closeParts.minute, 0, 0);

    if (closeTime <= now) {
      const openMinutes = openParts.hour * 60 + openParts.minute;
      const closeMinutes = closeParts.hour * 60 + closeParts.minute;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      if (closeMinutes <= openMinutes && nowMinutes >= openMinutes) {
        closeTime.setDate(closeTime.getDate() + 1);
      } else {
        return null;
      }
    }

    return closeTime;
  }

  function parkStatusClass(statusText, now = new Date()) {
    if (!isParkStatusOpen(statusText)) return "closed";

    const closeTime = parseParkStatusCloseTime(statusText, now);
    if (!closeTime) return "closed";

    const millisecondsUntilClose = closeTime.getTime() - now.getTime();
    if (millisecondsUntilClose <= 60 * 60 * 1000) return "medium";

    return "low";
  }

  function waitClass(wait) {
    if (wait >= 60) return "high";
    if (wait >= 30) return "medium";
    return "low";
  }

  function normalizeParks(groups) {
    return (Array.isArray(groups) ? groups : [])
      .flatMap((group) => Array.isArray(group?.parks) ? group.parks : [])
      .filter((park) => park && park.id !== undefined && park.name)
      .map((park) => ({
        id: String(park.id),
        name: park.name,
        country: park.country || "",
        continent: park.continent || ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function createApi(options = {}) {
    const parksUrl = options.parksUrl || "https://queue-times.com/parks.json";
    const queueUrl = options.queueUrl || ((parkId) =>
      `https://queue-times.com/parks/${parkId}/queue_times.json`);
    const pageUrl = options.pageUrl || ((parkId) =>
      `https://queue-times.com/parks/${parkId}/queue_times`);
    const timeFormat = typeof options.timeFormat === "function"
      ? options.timeFormat
      : () => options.timeFormat || "12h";

    return {
      pageUrl,
      queueUrl,
      async loadParks() {
        const response = await fetch(parksUrl);
        return normalizeParks(await response.json());
      },
      async loadQueue(parkId) {
        const response = await fetch(queueUrl(parkId));
        if (response.ok === false) {
          throw new Error(`Queue-Times request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!isQueueData(data)) {
          throw new Error("Queue-Times returned an invalid queue response");
        }

        return data;
      },
      async loadRides(parkId) {
        return ridesFromQueueData(await this.loadQueue(parkId));
      },
      async loadParkStatus(parkId) {
        try {
          const response = await fetch(pageUrl(parkId));
          return parseParkStatusHtml(await response.text(), timeFormat());
        } catch {
          return "Unavailable";
        }
      }
    };
  }

  function isCustomParkId(id) {
    return String(id || "").startsWith("custom_");
  }

  function customParkById(state, id) {
    return (state.customParks || []).find((park) => park.id === String(id));
  }

  function displayParkName(park) {
    return park?.name || `Park ${park?.id}`;
  }

  function currentParkId(state) {
    return state.currentParkId ? String(state.currentParkId) : null;
  }

  function currentParkName(state) {
    const id = currentParkId(state);
    if (!id) return "No park selected";

    const customPark = customParkById(state, id);
    if (customPark) return customPark.name;

    return state.parkNamesById[id] || `Park ${id}`;
  }

  function viewPark(state, parkId, parkName) {
    const id = String(parkId);
    state.currentParkId = id;

    if (parkName) {
      state.parkNamesById[id] = parkName;
    }

    return id;
  }

  function createTransientParkNavigation() {
    let originCustomListId = null;

    return {
      begin(customListId) {
        originCustomListId = isCustomParkId(customListId)
          ? String(customListId)
          : null;
      },
      consumeOrigin() {
        const origin = originCustomListId;
        originCustomListId = null;
        return origin;
      },
      clear() {
        originCustomListId = null;
      }
    };
  }

  function nextCustomListNumber(state) {
    let number = (state.customParks || []).length + 1;

    while (
      (state.customParks || []).some((park) =>
        park.id === `custom_${number}` ||
        park.name === `Custom List ${number}`
      )
    ) {
      number += 1;
    }

    return number;
  }

  function createCustomList(state) {
    const number = nextCustomListNumber(state);
    const park = {
      id: `custom_${number}`,
      name: `Custom List ${number}`
    };

    state.customParks.push(park);
    state.favoriteParkIds.push(park.id);
    state.parkOrder.push(park.id);
    state.currentParkId = park.id;
    state.parkNamesById[park.id] = park.name;

    if (!state.customParkRides[park.id]) {
      state.customParkRides[park.id] = [];
    }

    return park;
  }

  function standardRideName(item) {
    if (item?.type === "parkStatus") return "Park Status";
    return typeof item === "string" ? item : item?.rideName;
  }

  function isDividerItem(item) {
    return item?.type === "divider";
  }

  function isParkStatusItem(item) {
    return item?.type === "parkStatus";
  }

  function parkStatusItem(park) {
    const item = {
      type: "parkStatus",
      title: "Park Status"
    };

    if (park) {
      item.parkId = String(park.id ?? park.parkId);
      item.parkName = park.name ?? park.parkName;
      item.name = "Park Status";
    }

    return item;
  }

  function standardItemName(item) {
    if (isDividerItem(item)) return "-- Divider --";
    if (isParkStatusItem(item)) return "Park Status";
    return standardRideName(item);
  }

  function standardRideIndex(rides, rideName) {
    return (rides || []).findIndex((item) => standardRideName(item) === rideName);
  }

  function parkStatusIndex(rides) {
    return (rides || []).findIndex(isParkStatusItem);
  }

  function normalizeStandardRideList(rides) {
    return (rides || []).filter(Boolean);
  }

  function hasConfiguredRideList(state, parkId) {
    const id = String(parkId);
    const items = isCustomParkId(id)
      ? state?.customParkRides?.[id]
      : state?.ridesByParkId?.[id];

    return Array.isArray(items) && items.some(Boolean);
  }

  function placeholderRideItems(savedItems, isCustomList = false) {
    return (savedItems || [])
      .map((item) => {
        if (isDividerItem(item)) return item;

        if (isParkStatusItem(item)) {
          return {
            type: "parkStatus",
            ...(item.parkId === undefined
              ? {}
              : {
                  parkId: String(item.parkId),
                  parkName: item.parkName
                }),
            name: isCustomList
              ? item.parkName || `Park ${item.parkId}`
              : "Park Status",
            statusText: "--"
          };
        }

        const name =
          typeof item === "string"
            ? item
            : item?.rideName || item?.name;

        return name ? { name, placeholderWait: true } : null;
      })
      .filter(Boolean);
  }

  function toggleStandardRide(state, parkId, rideName) {
    const rides = normalizeStandardRideList(state.ridesByParkId[parkId] || []);
    const index = standardRideIndex(rides, rideName);

    if (index !== -1) {
      rides.splice(index, 1);
    } else {
      rides.push(rideName);
    }

    state.ridesByParkId[parkId] = rides;
    return rides;
  }

  function customRideIndex(state, customId, parkId, rideName) {
    const rides = state.customParkRides[customId] || [];

    return rides.findIndex((ride) => {
      if (isParkStatusItem(ride)) {
        return (
          String(ride.parkId) === String(parkId) &&
          (rideName === "Park Status" || rideName === ride.name || rideName === ride.title)
        );
      }

      return (
        String(ride.parkId) === String(parkId) &&
        ride.rideName === rideName
      );
    });
  }

  function toggleCustomRide(state, customId, ride) {
    const rides = state.customParkRides[customId] || [];
    const index = customRideIndex(state, customId, ride.parkId, ride.name);

    if (index === -1) {
      if (isParkStatusItem(ride)) {
        rides.push({
          type: "parkStatus",
          parkId: String(ride.parkId),
          parkName: ride.parkName,
          title: "Park Status",
          name: "Park Status"
        });
      } else {
        rides.push({
          parkId: String(ride.parkId),
          parkName: ride.parkName,
          rideName: ride.name
        });
      }
    } else {
      rides.splice(index, 1);
    }

    state.customParkRides[customId] = rides;
    return rides;
  }

  function sourceParkIdsForCustomList(state, customId) {
    const rides = state.customParkRides[customId] || [];
    return new Set(rides.map((ride) => String(ride.parkId)));
  }

  function setHomePark(state, park) {
    state.homeParkId = park.id;
    state.currentParkId = park.id;
    state.parkNamesById[park.id] = park.name;

    if (!state.favoriteParkIds.includes(park.id)) {
      state.favoriteParkIds.push(park.id);
    }

    if (!state.parkOrder.includes(park.id)) {
      state.parkOrder.push(park.id);
    }
  }

  function toggleFavoritePark(state, park) {
    const id = park.id;
    state.parkNamesById[id] = park.name;

    if (state.favoriteParkIds.includes(id)) {
      state.favoriteParkIds = state.favoriteParkIds.filter((parkId) => parkId !== id);
      state.parkOrder = state.parkOrder.filter((parkId) => parkId !== id);

      if (state.homeParkId === id) state.homeParkId = null;
      if (state.currentParkId === id) state.currentParkId = state.parkOrder[0] || null;
    } else {
      state.favoriteParkIds.push(id);
      state.parkOrder.push(id);
      state.currentParkId = id;
    }
  }

  function parkPickerGroups(state, allParks, filterValue) {
    const filter = filterValue.trim().toLowerCase();
    const customParks = state.customParks.map((park) => ({
      ...park,
      isCustom: true,
      country: "",
      continent: ""
    }));

    const matchingParks = [...customParks, ...allParks].filter((park) => {
      const text = `${displayParkName(park)} ${park.country} ${park.continent}`.toLowerCase();
      return text.includes(filter);
    });

    return {
      filter,
      favoriteParks: matchingParks
        .filter((park) => state.favoriteParkIds.includes(park.id))
        .sort((a, b) => state.parkOrder.indexOf(a.id) - state.parkOrder.indexOf(b.id)),
      otherParks: matchingParks
        .filter((park) => !state.favoriteParkIds.includes(park.id))
        .sort((a, b) => {
          if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
    };
  }

  function standardRidePickerModel(state, parkId, allRides, filterValue) {
    const filter = filterValue.trim().toLowerCase();
    const selected = normalizeStandardRideList(state.ridesByParkId[parkId] || []);
    const hasParkStatus = parkStatusIndex(selected) !== -1;
    const selectedRideNames = selected
      .filter((item) => !isDividerItem(item) && !isParkStatusItem(item))
      .map((item) => standardRideName(item));

    return {
      filter,
      selected,
      selectedMatches: selected
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (isDividerItem(item)) return !filter;
          return String(standardItemName(item) || "").toLowerCase().includes(filter);
        }),
      availableSpecialItems: !hasParkStatus && "park status".includes(filter)
        ? [parkStatusItem()]
        : [],
      availableRides: allRides
        .filter((ride) => !selectedRideNames.includes(ride.name))
        .filter((ride) => ride.name.toLowerCase().includes(filter))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  function customSourceParkGroups(state, allParks, customId, filterValue) {
    const filter = filterValue.trim().toLowerCase();
    const sourceParkIds = sourceParkIdsForCustomList(state, customId);
    const matchingParks = allParks.filter((park) => {
      const text = `${park.name} ${park.country} ${park.continent}`.toLowerCase();
      return text.includes(filter);
    });

    return {
      filter,
      contributingParks: matchingParks
        .filter((park) => sourceParkIds.has(String(park.id)))
        .sort((a, b) => a.name.localeCompare(b.name)),
      otherParks: matchingParks
        .filter((park) => !sourceParkIds.has(String(park.id)))
        .sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  function customRidePickerRows(state, customId, allRides, filterValue, sourcePark = null) {
    const filter = filterValue.trim().toLowerCase();
    const rows = [...allRides];

    if (sourcePark && "park status".includes(filter)) {
      rows.push(parkStatusItem(sourcePark));
    }

    return rows
      .filter((ride) => ride.name.toLowerCase().includes(filter))
      .sort((a, b) => {
        const aIndex = customRideIndex(state, customId, a.parkId, a.name);
        const bIndex = customRideIndex(state, customId, b.parkId, b.name);
        const aSelected = aIndex !== -1;
        const bSelected = bIndex !== -1;

        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        if (aSelected && bSelected) return aIndex - bIndex;

        const aSpecial = isParkStatusItem(a);
        const bSpecial = isParkStatusItem(b);
        if (aSpecial !== bSpecial) return aSpecial ? -1 : 1;

        return a.name.localeCompare(b.name);
      });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  const QueuePanelShared = {
    APP_METADATA,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    PERSISTENT_STATE_KEYS,
    DEFAULT_STATE,
    FEATURE_FLAGS,
    QUEUE_PANEL_STORAGE_KEY,
    QUEUE_PANEL_STORAGE_KEYS,
    loadState,
    normalizeState,
    saveState,
    clearQueuePanelData,
    configureOptionalAction,
    persistentState,
    createBackup,
    serializeBackup,
    parseBackup,
    hasMeaningfulConfiguration,
    replaceConfiguration,
    backupFileName,
    uniqueIds,
    ridesFromQueueData,
    isQueueData,
    parseParkStatusHtml,
    formatClockTime,
    formatParkStatusText,
    timeFormatForState,
    themeForState,
    waitListTextSizeForState,
    isParkStatusOpen,
    parkStatusClass,
    waitClass,
    normalizeParks,
    createApi,
    isCustomParkId,
    customParkById,
    displayParkName,
    currentParkId,
    currentParkName,
    viewPark,
    createTransientParkNavigation,
    nextCustomListNumber,
    createCustomList,
    standardRideName,
    isDividerItem,
    isParkStatusItem,
    parkStatusItem,
    standardItemName,
    standardRideIndex,
    parkStatusIndex,
    normalizeStandardRideList,
    hasConfiguredRideList,
    placeholderRideItems,
    toggleStandardRide,
    customRideIndex,
    toggleCustomRide,
    sourceParkIdsForCustomList,
    setHomePark,
    toggleFavoritePark,
    parkPickerGroups,
    standardRidePickerModel,
    customSourceParkGroups,
    customRidePickerRows,
    escapeHtml
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QueuePanelShared;
  }

  if (typeof window !== "undefined") {
    window.QueuePanelShared = QueuePanelShared;
  }
})();
