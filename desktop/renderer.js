const Shared = window.QueuePanelShared;
const STORAGE_KEY = "queuePanelState";
const DEFAULT_STATE = Shared.DEFAULT_STATE;
const queueApi = Shared.createApi({
  timeFormat: () => currentTimeFormat()
});

let state = loadState();
let allParks = [];
let allPickerRides = [];
let cycleResizeTimer = null;
let lastRefreshTime = null;
let sourceTimer = null;
let deleteCustomListArmed = false;
let activeCustomListId = null;
let activeCustomSourceParkId = null;
let navigationReturnTarget = null;
let draftCustomListId = null;
let draftCustomListName = null;
let draftCustomListChanged = false;
let parkHoursById = {};
let didInitialMainResize = false;
let lastMainPanelHeight = null;
let activeDragScrollContainer = null;
let dragAutoScrollFrame = null;
let dragAutoScrollSpeed = 0;
let settingsLongPressTimer = null;
let settingsLongPressRecognized = false;
let settingsLongPressStartX = 0;
let settingsLongPressStartY = 0;
let currentRenderedRides = [];

const MANAGEMENT_PANEL_HEIGHT = 510;

const $ = (id) => document.getElementById(id);

const views = {
  main: $("mainView"),
  parkPicker: $("parkPickerView"),
  customRideMenu: $("customRideMenuView"),
  customSourceParkPicker: $("customSourceParkPickerView"),
  customRideOrder: $("customRideOrderView"),
  ridePicker: $("ridePickerView"),
  settings: $("settingsView"),
  about: $("aboutView")
};

function loadState() {
  return Shared.loadState(localStorage, STORAGE_KEY);
}

function saveState() {
  Shared.saveState(localStorage, STORAGE_KEY, state);
  updateTrayMenuState();
}

function uniqueIds(ids) {
  return Shared.uniqueIds(ids);
}

function currentParkId() {
  return Shared.currentParkId(state);
}

function currentParkName() {
  return Shared.currentParkName(state);
}

function currentTimeFormat() {
  return Shared.timeFormatForState(state);
}

function currentWaitListTextSize() {
  return Shared.waitListTextSizeForState(state);
}

function updateTrayMenuState() {
  const parks = state.parkOrder
    .map((id) => ({
      id,
      name: state.parkNamesById[id] || `Park ${id}`
    }));

  window.electronAPI?.updateTrayMenu?.({
    currentParkId: currentParkId(),
    parks
  });
}

function ridesFromQueueData(data) {
  return Shared.ridesFromQueueData(data);
}

function parkPageUrl(parkId) {
  return queueApi.pageUrl(parkId);
}

async function loadParkHoursTooltip(parkId) {
  if (!parkId || isCustomParkId(parkId)) return;

  try {
    const hoursText = await queueApi.loadParkStatus(parkId);
    parkHoursById[String(parkId)] = hoursText;

    if (currentParkId() === String(parkId)) {
      const parkName = currentParkName();
      $("parkTitle").title = `${parkName}: ${hoursText}`;
    }
  } catch (err) {
    console.warn("Failed to load park hours tooltip", err);
  }
}

function parkQueueUrl(parkId) {
  return queueApi.queueUrl(parkId);
}

function isCustomParkId(id) {
  return Shared.isCustomParkId(id);
}

function customParkById(id) {
  return Shared.customParkById(state, id);
}

function displayParkName(park) {
  return park.isCustom ? `[${park.name}]` : park.name;
}

function nextCustomListNumber() {
  return Shared.nextCustomListNumber(state);
}

function createCustomList() {
  const park = Shared.createCustomList(state);
  draftCustomListId = park.id;
  draftCustomListName = park.name;
  draftCustomListChanged = false;
  saveState();
  renderParkPicker();
  showCustomRideMenu(park.id);
}

function showView(name) {
  Object.values(views).forEach((view) => view.classList.add("hidden"));
  views[name].classList.remove("hidden");
  closeHomeContextMenu();
  resizePanelSoon();
}

function setNavigationReturnTarget(target) {
  navigationReturnTarget = target;
}

function consumeNavigationReturnTarget() {
  const target = navigationReturnTarget;
  navigationReturnTarget = null;
  return target;
}

function returnToHomeView() {
  showView("main");
  loadWaitTimes();

  if (lastMainPanelHeight) {
    setTimeout(() => {
      window.electronAPI?.resizePanel?.(lastMainPanelHeight + 8);
      setTimeout(updateRideListScrollState, 50);
    }, 0);
  }
}

function showSettingsPage() {
  updateSettingsControls();
  showView("settings");
}

function showAboutPage() {
  const metadata = Shared.APP_METADATA;
  $("aboutAppName").textContent = metadata.name;
  $("aboutVersion").textContent = `Version ${metadata.version}`;
  $("aboutQueueTimesLink").href = metadata.queueTimesUrl;
  showView("about");
}

async function returnToParkPicker() {
  await loadParkPicker();
}

function updateSettingsControls() {
  const timeFormat = currentTimeFormat();
  const waitListTextSize = currentWaitListTextSize();
  $("timeFormat12Btn").classList.toggle("active", timeFormat === "12h");
  $("timeFormat24Btn").classList.toggle("active", timeFormat === "24h");
  $("waitListTextSmallBtn").classList.toggle("active", waitListTextSize === "small");
  $("waitListTextLargeBtn").classList.toggle("active", waitListTextSize === "large");
}

function updateWaitListTextSizeClass() {
  $("mainView").classList.toggle(
    "wait-list-large",
    currentWaitListTextSize() === "large"
  );
}

function reformatStatusText(statusText) {
  return Shared.formatParkStatusText(statusText, currentTimeFormat());
}

function applyTimeFormat(timeFormat) {
  if (!["12h", "24h"].includes(timeFormat)) return;

  state.settings = {
    ...(state.settings || {}),
    timeFormat
  };
  saveState();
  updateSettingsControls();

  parkHoursById = Object.fromEntries(
    Object.entries(parkHoursById).map(([id, statusText]) => [
      id,
      reformatStatusText(statusText)
    ])
  );

  currentRenderedRides = currentRenderedRides.map((ride) =>
    Shared.isParkStatusItem(ride)
      ? { ...ride, statusText: reformatStatusText(ride.statusText) }
      : ride
  );

  if (!views.main.classList.contains("hidden")) {
    renderRides(currentRenderedRides);
    const id = currentParkId();
    const hoursText = parkHoursById[id];
    if (hoursText) {
      $("parkTitle").title = `${currentParkName()}: ${hoursText}`;
    }
  }
}

function applyWaitListTextSize(waitListTextSize) {
  if (!["small", "large"].includes(waitListTextSize)) return;

  state.settings = {
    ...(state.settings || {}),
    waitListTextSize
  };
  saveState();
  updateSettingsControls();
  updateWaitListTextSizeClass();

  if (!views.main.classList.contains("hidden")) {
    renderRides(currentRenderedRides);
  }
}

function syncFilterClearButton(inputId) {
  const input = $(inputId);
  const clearButton = $(`${inputId}Clear`);
  if (!input || !clearButton) return;

  clearButton.classList.toggle("hidden", input.value.length === 0);
}

function resetFilter(inputId) {
  const input = $(inputId);
  if (!input) return;

  input.value = "";
  syncFilterClearButton(inputId);
}

function bindFilterClear(inputId, renderFn) {
  const input = $(inputId);
  const clearButton = $(`${inputId}Clear`);
  if (!input || !clearButton) return;

  input.addEventListener("input", () => {
    syncFilterClearButton(inputId);
    renderFn();
  });

  clearButton.addEventListener("click", () => {
    input.value = "";
    syncFilterClearButton(inputId);
    renderFn();
    input.focus();
  });

  syncFilterClearButton(inputId);
}

function updateSourceStatus() {
  const el = $("sourceStatus");

  const parkId = currentParkId();

  if (parkId && !isCustomParkId(parkId)) {
    el.href = `https://queue-times.com/parks/${parkId}`;
  } else {
    el.href = "https://queue-times.com";
  }

  if (!el) return;

  if (!lastRefreshTime) {
    el.textContent = "Powered by Queue-Times.com";
    return;
  }

  const ageSeconds = Math.floor(
    (Date.now() - lastRefreshTime) / 1000
  );

  let ageText;

  if (ageSeconds < 60) {
    ageText = "Just now";
  } else if (ageSeconds < 3600) {
    ageText = `${Math.floor(ageSeconds / 60)}m ago`;
  } else {
    ageText = `${Math.floor(ageSeconds / 3600)}h ago`;
  }

  el.textContent = `Powered by Queue-Times.com • ${ageText}`;
}

function startSourceTimer() {
  clearInterval(sourceTimer);

  updateSourceStatus();

  sourceTimer = setInterval(() => {
    updateSourceStatus();
  }, 10000);
}

function fitHomePanelToContent() {
  const mainView = $("mainView");
  const rideList = $("rideList");

  const clone = rideList.cloneNode(true);
  clone.style.position = "absolute";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.flex = "none";
  clone.style.width = `${rideList.clientWidth}px`;

  document.body.appendChild(clone);

  const chromeHeight =
    mainView.scrollHeight - rideList.clientHeight;

  const height = Math.max(
    180,
    Math.min(520, chromeHeight + clone.scrollHeight + 30)
  );

  clone.remove();

  window.electronAPI?.resizePanel?.(height);
  setTimeout(updateRideListScrollState, 50);
}

function updateRideListScrollState() {
  const rideList = $("rideList");
  if (!rideList) return;

  rideList.classList.toggle(
    "has-scrollbar",
    rideList.scrollHeight > rideList.clientHeight + 1
  );
}

function resizePanelSoon(delay = 0) {
  setTimeout(() => {
    requestAnimationFrame(() => {
      const isManagementView =
        !views.parkPicker.classList.contains("hidden") ||
        !views.customRideMenu.classList.contains("hidden") ||
        !views.customSourceParkPicker.classList.contains("hidden") ||
        !views.customRideOrder.classList.contains("hidden") ||
        !views.ridePicker.classList.contains("hidden") ||
        !views.settings.classList.contains("hidden") ||
        !views.about.classList.contains("hidden");

      if (isManagementView) {
        window.electronAPI?.resizePanel?.(MANAGEMENT_PANEL_HEIGHT);
        return;
      }

      if (!didInitialMainResize) {
        didInitialMainResize = true;
        window.electronAPI?.resizePanel?.(MANAGEMENT_PANEL_HEIGHT);
      }
    });
  }, delay);
}

function waitClass(wait) {
  return Shared.waitClass(wait);
}

async function loadAllParks() {
  if (allParks.length > 0) return allParks;

  allParks = await queueApi.loadParks();

  for (const park of allParks) {
    state.parkNamesById[park.id] = park.name;
  }

  saveState();
  return allParks;
}

async function loadWaitTimes() {
  renderHomeShell();

  const id = currentParkId();

  loadParkHoursTooltip(id);

  const rideList = $("rideList");

  if (isCustomParkId(id)) {
    await loadCustomWaitTimes(id);
    return;
  }

  if (!id) {
    rideList.innerHTML = `
      <div class="muted">
        No rides selected.<br>
        Click ⚙ → Modify Ride List.
      </div>
      <div style="height: 34px;"></div>
    `;
    resizePanelSoon();
    return;
  }

  const savedRideNames = normalizeStandardRideList(state.ridesByParkId[id] || []);

  if (savedRideNames.length === 0) {
    rideList.innerHTML = `
      <div class="muted">
        No rides selected.<br>
        Click ⚙ → Add/Remove Rides.
      </div>
    `;
    resizePanelSoon();
    return;
  }

  rideList.innerHTML = `<div class="muted">Loading wait times...</div>`;
  resizePanelSoon();

  try {
    const realSavedRides = savedRideNames.filter((item) =>
      !Shared.isDividerItem(item) && !Shared.isParkStatusItem(item)
    );
    const allRides = realSavedRides.length > 0
      ? ridesFromQueueData(await queueApi.loadQueue(id))
      : [];

    lastRefreshTime = Date.now();
    updateSourceStatus();

    const statusText = savedRideNames.some(Shared.isParkStatusItem)
      ? await queueApi.loadParkStatus(id)
      : null;

    const rides = savedRideNames
      .map((savedRide) => {
        if (Shared.isDividerItem(savedRide)) return savedRide;
        if (Shared.isParkStatusItem(savedRide)) {
          return {
            type: "parkStatus",
            name: "Park Status",
            statusText: statusText || "Unavailable"
          };
        }

        return allRides.find((ride) => ride.name === savedRide);
      })
      .filter(Boolean);

    renderRides(rides);
  } catch (err) {
    console.error(err);
    rideList.innerHTML = `<div class="muted">Failed to load wait times.</div>`;
    resizePanelSoon();
  }
}

async function loadCustomWaitTimes(id) {
  renderHomeShell();

  const rideList = $("rideList");
  const savedRides = state.customParkRides[id] || [];

  if (savedRides.length === 0) {
    rideList.innerHTML = `
      <div class="muted">
        No rides selected.<br>
        Click ⚙ → Add Rides.
      </div>
    `;
    resizePanelSoon();
    return;
  }

  rideList.innerHTML = `<div class="muted">Loading wait times...</div>`;
  resizePanelSoon();

  try {
    const realRides = savedRides.filter((ride) =>
      !Shared.isDividerItem(ride) && !Shared.isParkStatusItem(ride)
    );
    const statusItems = savedRides.filter(Shared.isParkStatusItem);

    const uniqueParkIds = [
      ...new Set(realRides.map((ride) => String(ride.parkId)))
    ];
    const uniqueStatusParkIds = [
      ...new Set(statusItems.map((ride) => String(ride.parkId)))
    ];

    const parkRideMap = {};
    const parkStatusMap = {};

    await Promise.all(
      uniqueParkIds.map(async (parkId) => {
        const response = await fetch(parkQueueUrl(parkId));
        const data = await response.json();
        parkRideMap[parkId] = ridesFromQueueData(data);
      })
    );

    await Promise.all(
      uniqueStatusParkIds.map(async (parkId) => {
        parkStatusMap[parkId] = await queueApi.loadParkStatus(parkId);
      })
    );

    lastRefreshTime = Date.now();
    updateSourceStatus();

    const rides = savedRides
      .map((savedRide) => {
        if (savedRide.type === "divider") {
          return savedRide;
        }

        if (Shared.isParkStatusItem(savedRide)) {
          const parkName = savedRide.parkName || `Park ${savedRide.parkId}`;
          const statusText = parkStatusMap[String(savedRide.parkId)] || "Unavailable";
          return {
            type: "parkStatus",
            name: parkName,
            parkName,
            statusText
          };
        }

        const parkRides = parkRideMap[String(savedRide.parkId)] || [];
        return parkRides.find((ride) => ride.name === savedRide.rideName);
      })
      .filter(Boolean);

    renderRides(rides);
  } catch (err) {
    console.error(err);
    rideList.innerHTML = `<div class="muted">Failed to load custom list wait times.</div>`;
    resizePanelSoon();
  }
}

function renderHomeShell() {
  const id = currentParkId();

  const parkName = currentParkName();

  updateWaitListTextSizeClass();

  $("parkTitle").textContent = parkName;

  const hoursText = parkHoursById[id];

  $("parkTitle").title = hoursText
    ? `${parkName}: ${hoursText}`
    : parkName;

  $("homeBtn").disabled = false;
  $("homeBtn").classList.toggle(
    "active",
    !!id && String(state.homeParkId) === id
  );

  const canCycle = state.parkOrder.length > 1;
  $("prevParkBtn").disabled = !canCycle;
  $("nextParkBtn").disabled = !canCycle;
}

function renderRides(rides) {
  currentRenderedRides = rides;
  const rideList = $("rideList");
  rideList.innerHTML = "";

  if (rides.length === 0) {
    rideList.innerHTML = `
      <div class="muted">
        Saved rides were not found for this park.
      </div>
    `;
    resizePanelSoon();
    return;
  }

  for (const ride of rides) {
    if (Shared.isDividerItem(ride)) {
      const divider = document.createElement("div");
      divider.className = "custom-ride-divider";
      rideList.appendChild(divider);
      continue;
    }

    if (Shared.isParkStatusItem(ride)) {
      const row = document.createElement("div");
      row.className = "ride";
      const statusText = ride.statusText || "Unavailable";
      const statusClass = Shared.parkStatusClass(statusText);
      const label = ride.name || "Park Status";
      row.innerHTML = `
        <span class="ride-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>

        <span class="${statusClass}" title="${escapeHtml(statusText)}">
          ${escapeHtml(statusText)}
        </span>
      `;
      rideList.appendChild(row);
      continue;
    }

    const row = document.createElement("div");
    row.className = "ride";

    const waitText = ride.is_open ? ride.wait_time : "Closed";
    const className = ride.is_open ? waitClass(ride.wait_time) : "closed";

    row.innerHTML = `
      <span
        class="ride-name ${ride.is_open ? "" : "closed"}"
        title="${escapeHtml(ride.name)}"
      >
        ${escapeHtml(ride.name)}
      </span>

      <span class="${className}" title="${escapeHtml(ride.name)}">
        ${waitText}
      </span>
    `;

    rideList.appendChild(row);
  }

  resizePanelSoon();
  setTimeout(updateRideListScrollState, 0);
}

async function loadRidePicker() {
  const id = currentParkId();
  const allRideList = $("allRideList");

  if (!id) {
    allRideList.innerHTML = `<div class="muted">Select a park first.</div>`;
    resizePanelSoon();
    return;
  }

  $("ridePickerTitle").textContent = `${currentParkName()} Rides`;
  resetFilter("rideFilter");
  allRideList.innerHTML = `<div class="muted">Loading rides...</div>`;
  resizePanelSoon();

  try {
    const response = await fetch(parkQueueUrl(id));
    const data = await response.json();

    allPickerRides = ridesFromQueueData(data)
      .map((ride) => ({ name: ride.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    renderRidePicker();
  } catch (err) {
    console.error(err);
    allRideList.innerHTML = `<div class="muted">Failed to load rides.</div>`;
    resizePanelSoon();
  }
}

function renderRidePicker() {
  if (activeCustomListId && activeCustomSourceParkId) {
    renderCustomRidePicker();
    return;
  }

  const id = currentParkId();
  const {
    selected,
    filter,
    selectedMatches,
    availableSpecialItems,
    availableRides
  } = Shared.standardRidePickerModel(state, id, allPickerRides, $("rideFilter").value);

  const list = $("allRideList");
  list.innerHTML = "";

  selectedMatches.forEach(({ item, index }) => {
    const isDivider = Shared.isDividerItem(item);
    const isParkStatus = Shared.isParkStatusItem(item);
    const rideName = isDivider ? "-- Divider --" : Shared.standardItemName(item);

    const row = document.createElement("div");
    row.className = "picker-row selected draggable-row";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn active" title="${isDivider ? "Remove divider" : isParkStatus ? "Remove park status" : "Remove ride"}">&#9733;</button>

      <span class="ride-name" title="${escapeHtml(rideName)}">
        ${escapeHtml(rideName)}
      </span>

      <span class="row-actions">
        ${
          !filter
            ? `<button class="icon-btn drag-handle" title="Drag to reorder">&#9776;</button>`
            : ""
        }
      </span>
    `;

    row.querySelector(".ride-star-btn").addEventListener("click", () => {
      selected.splice(index, 1);
      state.ridesByParkId[id] = selected;
      saveState();
      renderRidePicker();
    });

    if (!filter) {
        makeRowDraggable(
          row,
          row.querySelector(".drag-handle"),
          selected,
          index,
          (commit = true) => {
          state.ridesByParkId[id] = selected;

          if (commit) {
            saveState();
          }

          renderRidePicker();
        },
        { boundToDraggableSection: true }
      );
    }

    list.appendChild(row);
  });

  for (const item of availableSpecialItems) {
    const row = document.createElement("div");
    row.className = "picker-row add-favorite-ride-row";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn" title="Add park status">&#9734;</button>

      <span class="ride-name" title="Park Status">
        [Add Park Status]
      </span>

      <span></span>
    `;

    const addParkStatus = () => {
      selected.push(item);
      state.ridesByParkId[id] = selected;
      saveState();
      renderRidePicker();
    };

    row.querySelector(".ride-star-btn").addEventListener("click", addParkStatus);
    row.querySelector(".ride-name").addEventListener("click", addParkStatus);

    list.appendChild(row);
  }

  if (!filter) {
    const addDividerRow = document.createElement("div");
    addDividerRow.className = "picker-row add-divider-row";

    addDividerRow.innerHTML = `
      <button class="icon-btn" title="Add divider">&#9734;</button>
      <span class="ride-name">[Add Divider]</span>
      <span></span>
    `;

    addDividerRow.addEventListener("click", () => {
      selected.push({
        type: "divider",
        title: "Divider"
      });

      state.ridesByParkId[id] = selected;
      saveState();
      renderRidePicker();
    });

    list.appendChild(addDividerRow);
  }

  for (const ride of availableRides) {
    const row = document.createElement("div");
    row.className = "picker-row add-favorite-ride-row";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn" title="Add ride">&#9734;</button>

      <span class="ride-name" title="${escapeHtml(ride.name)}">
        ${escapeHtml(ride.name)}
      </span>

      <span></span>
    `;

    const addRide = () => {
      selected.push(ride.name);
      state.ridesByParkId[id] = selected;
      saveState();
      renderRidePicker();
    };

    row.querySelector(".ride-star-btn").addEventListener("click", addRide);
    row.querySelector(".ride-name").addEventListener("click", addRide);

    list.appendChild(row);
  }

  if (selectedMatches.length === 0 && availableSpecialItems.length === 0 && availableRides.length === 0) {
    list.innerHTML = `<div class="muted">No rides found.</div>`;
  }

  resizePanelSoon();
}
function standardRideName(item) {
  return Shared.standardRideName(item);
}

function standardRideIndex(rides, rideName) {
  return Shared.standardRideIndex(rides, rideName);
}

function normalizeStandardRideList(rides) {
  return Shared.normalizeStandardRideList(rides);
}

function toggleRideForCurrentPark(rideName) {
  const id = currentParkId();
  if (!id) return;

  Shared.toggleStandardRide(state, id, rideName);
  saveState();
}

async function loadParkPicker() {
  lastMainPanelHeight = window.innerHeight;
  const list = $("allParkList");
  resetFilter("parkFilter");
  list.innerHTML = `<div class="muted">Loading parks...</div>`;
  showView("parkPicker");

  try {
    await loadAllParks();
    renderParkPicker();
    $("parkFilter").focus();
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="muted">Failed to load parks.</div>`;
    resizePanelSoon();
  }
}

function renderParkPicker() {
  const { filter, favoriteParks, otherParks } =
    Shared.parkPickerGroups(state, allParks, $("parkFilter").value);

  const list = $("allParkList");
  list.innerHTML = "";

  function renderAddCustomListRow() {
    const addRow = document.createElement("div");
    addRow.className = "picker-row add-custom-list-row";

    addRow.innerHTML = `
      <button class="icon-btn" title="Add custom list">☆</button>
      <span class="park-name">[Add Custom Ride List]</span>
      <span></span>
    `;

    addRow.addEventListener("click", createCustomList);
    list.appendChild(addRow);
  }

    function renderParkRow(park) {
      const isFavorite = state.favoriteParkIds.includes(park.id);
      const isCurrent = currentParkId() === park.id;
      const orderIndex = state.parkOrder.indexOf(park.id);

      const row = document.createElement("div");
      row.className = isCurrent ? "picker-row selected" : "picker-row";

      if (!isFavorite && !park.isCustom) {
        row.classList.add("add-favorite-park-row");
      }

      row.innerHTML = `
        <button class="icon-btn favorite-park-btn ${isFavorite ? "active" : ""}" title="Favorite park">
          ${isFavorite ? "★" : "☆"}
        </button>

        ${
          park.isCustom
            ? `
              <span class="inline-rename-control">
                <input
                  class="park-name custom-park-name-input"
                  value="${escapeHtml(park.name)}"
                  title="${escapeHtml(park.name)}"
                />
                <button class="rename-clear-btn hidden" type="button" title="Clear name">&times;</button>
              </span>
            `
            : `
              <span class="park-name" title="${escapeHtml(displayParkName(park))}">
                ${escapeHtml(displayParkName(park))}
              </span>
            `
        }

        <span class="row-actions">
          ${
            isFavorite && !filter
              ? `<button class="icon-btn drag-handle" title="Drag to reorder">☰</button>`
              : ""
          }
          <button class="icon-btn configure-park-btn" title="${park.isCustom ? "Custom list rides" : "Modify ride list"}">⚙</button>
        </span>
      `;

      row.addEventListener("click", () => {
        state.currentParkId = park.id;
        state.parkNamesById[park.id] = park.name;
        saveState();
        renderParkPicker();
      });

      const favoriteButton = row.querySelector(".favorite-park-btn");
      const gearButton = row.querySelector(".configure-park-btn");
      const customNameInput = row.querySelector(".custom-park-name-input");

      const parkNameEl = row.querySelector(".park-name");

      if (!isFavorite && parkNameEl && !customNameInput) {
        parkNameEl.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleFavoritePark(park);
          renderParkPicker();
        });
      }

      if (customNameInput) {
        const customNameClearButton = row.querySelector(".rename-clear-btn");
        const previousName = park.name;
        let canceled = false;
        let finishing = false;

        const syncInlineRenameClearButton = () => {
          customNameClearButton?.classList.toggle(
            "hidden",
            document.activeElement !== customNameInput ||
              customNameInput.value.length === 0
          );
        };

        const finishInlineRename = (save) => {
          if (finishing) return;
          finishing = true;

          if (save && !canceled) {
            const newName = customNameInput.value.trim();

            if (newName && newName !== previousName) {
              saveCustomListName(park.id, newName);
            } else {
              customNameInput.value = previousName;
            }
          } else {
            customNameInput.value = previousName;
          }

          customNameInput.blur();
          syncInlineRenameClearButton();
          renderParkPicker();

          if (currentParkId() === park.id) {
            renderHomeShell();
          }
        };

        customNameInput.addEventListener("click", (event) => {
          event.stopPropagation();
        });

        customNameInput.addEventListener("focus", () => {
          canceled = false;
          finishing = false;
          syncInlineRenameClearButton();
        });

        customNameClearButton?.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });

        customNameClearButton?.addEventListener("click", (event) => {
          event.stopPropagation();
          customNameInput.value = "";
          syncInlineRenameClearButton();
          customNameInput.focus();
        });

        customNameInput.addEventListener("input", syncInlineRenameClearButton);

        customNameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finishInlineRename(true);
          }

          if (event.key === "Escape") {
            event.preventDefault();
            canceled = true;
            finishInlineRename(false);
          }
        });

        customNameInput.addEventListener("blur", () => {
          if (!canceled) finishInlineRename(true);
        });
      }

      favoriteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavoritePark(park);
        renderParkPicker();
      });

      gearButton.addEventListener("click", async (event) => {
        event.stopPropagation();

        state.currentParkId = park.id;
        state.parkNamesById[park.id] = park.name;
        saveState();

        if (park.isCustom) {
          showCustomRideMenu(park.id);
          return;
        }

        showView("ridePicker");
        await loadRidePicker();
        $("rideFilter").focus();
      });

      if (isFavorite && !filter) {
        row.classList.add("draggable-row");

        makeRowDraggable(
          row,
          row.querySelector(".drag-handle"),
          state.parkOrder,
          orderIndex,
          () => {
            saveState();
            renderParkPicker();
          },
          { boundToDraggableSection: true }
        );
      }

      list.appendChild(row);
    }

  favoriteParks.forEach(renderParkRow);

  if (!filter || "[add custom list]".includes(filter)) {
    renderAddCustomListRow();
  }

  otherParks.forEach(renderParkRow);

  if (favoriteParks.length === 0 && otherParks.length === 0 && filter) {
    list.innerHTML = `<div class="muted">No parks found.</div>`;
  }

  resizePanelSoon();
}

function showCustomRideMenu(id) {
  const park = customParkById(id);
  if (!park) return;

  activeCustomListId = id;
  activeCustomSourceParkId = null;
  $("customRideMenuTitle").textContent = `Configure ${park.name}`;
  $("customRideMenuTitle").title = "Rename custom list";

  $("customAddRidesBtn").querySelector(".menu-label").textContent =
    "Add Rides";

  $("customReorderRidesBtn").querySelector(".menu-label").textContent =
    "Manage Ride List";
  $("customDeleteListBtn").querySelector(".menu-label").textContent =
    `Delete ${park.name}`;

  resetDeleteCustomListButton();
  showView("customRideMenu");
}

function saveCustomListName(id, newName) {
  const park = customParkById(id);
  if (!park) return false;

  const trimmed = newName.trim();
  if (!trimmed) return false;

  const previousName = park.name;
  if (trimmed === previousName) return true;

  park.name = trimmed;
  state.parkNamesById[id] = trimmed;

  if (draftCustomListId === id) {
    draftCustomListChanged = true;
  }

  saveState();
  renderHomeShell();
  return true;
}

function customListHasContent(id) {
  return (state.customParkRides[id] || []).length > 0;
}

function shouldDiscardDraftCustomList(id) {
  const park = customParkById(id);
  return Boolean(
    park &&
    draftCustomListId === id &&
    !draftCustomListChanged &&
    park.name === draftCustomListName &&
    !customListHasContent(id)
  );
}

function clearDraftCustomList(id) {
  if (draftCustomListId !== id) return;

  draftCustomListId = null;
  draftCustomListName = null;
  draftCustomListChanged = false;
}

function leaveCustomRideMenu() {
  const id = activeCustomListId || currentParkId();

  if (id && shouldDiscardDraftCustomList(id)) {
    clearDraftCustomList(id);
    deleteCustomList(id);
    return;
  }

  if (id) clearDraftCustomList(id);

  if (consumeNavigationReturnTarget() === "home") {
    returnToHomeView();
    return;
  }

  showView("parkPicker");
  renderParkPicker();
}

function startCustomMenuTitleRename() {
  const id = activeCustomListId || currentParkId();
  const park = customParkById(id);
  const title = $("customRideMenuTitle");
  if (!park || !title || title.querySelector("input")) return;

  const previousName = park.name;
  title.innerHTML = `
    <span class="title-rename-control">
      <input class="title-rename-input" value="${escapeHtml(previousName)}" />
      <button class="rename-clear-btn ${previousName ? "" : "hidden"}" type="button" title="Clear name">&times;</button>
    </span>
  `;

  const input = title.querySelector(".title-rename-input");
  const clearButton = title.querySelector(".rename-clear-btn");
  let canceled = false;

  const finish = (save) => {
    if (save && !canceled) {
      saveCustomListName(id, input.value);
    }

    const updatedPark = customParkById(id);
    title.textContent = `Configure ${updatedPark?.name || previousName}`;
    resetDeleteCustomListButton();
  };

  input.addEventListener("input", () => {
    clearButton.classList.toggle("hidden", input.value.length === 0);
  });

  clearButton.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  clearButton.addEventListener("click", () => {
    input.value = "";
    clearButton.classList.add("hidden");
    input.focus();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    }

    if (event.key === "Escape") {
      canceled = true;
      finish(false);
    }
  });

  input.addEventListener("blur", () => {
    if (!canceled) finish(true);
  });

  input.focus();
  input.select();
}

function sourceParkIdsForCustomList(customId) {
  return Shared.sourceParkIdsForCustomList(state, customId);
}

async function loadCustomSourceParkPicker(customId) {
  const customPark = customParkById(customId);
  if (!customPark) return;

  activeCustomListId = customId;

  $("customSourceParkTitle").textContent = "Choose Source Parks";
  resetFilter("customSourceParkFilter");
  $("customSourceParkList").innerHTML = `<div class="muted">Loading parks...</div>`;

  showView("customSourceParkPicker");

  try {
    await loadAllParks();
    renderCustomSourceParkPicker();
    $("customSourceParkFilter").focus();
  } catch (err) {
    console.error(err);
    $("customSourceParkList").innerHTML =
      `<div class="muted">Failed to load parks.</div>`;
    resizePanelSoon();
  }
}

function renderCustomSourceParkPicker() {
  if (!activeCustomListId) return;

  const { contributingParks, otherParks } = Shared.customSourceParkGroups(
    state,
    allParks,
    activeCustomListId,
    $("customSourceParkFilter").value
  );

  const list = $("customSourceParkList");
  list.innerHTML = "";

  if (contributingParks.length === 0 && otherParks.length === 0) {
    list.innerHTML = `<div class="muted">No parks found.</div>`;
    resizePanelSoon();
    return;
  }

  function renderSourceParkRow(park, contributes) {
    const row = document.createElement("div");
    row.className = contributes
      ? "picker-row selected choose-source-park-row"
      : "picker-row choose-source-park-row";

    row.innerHTML = `
      <span class="park-name" title="${escapeHtml(park.name)}">
        ${escapeHtml(park.name)}
      </span>

      <span class="row-actions">
        <button class="icon-btn" title="Choose park">›</button>
      </span>
    `;

    row.addEventListener("click", () => {
      loadCustomRidePicker(activeCustomListId, park.id);
    });

    list.appendChild(row);
  }

  contributingParks.forEach((park) => renderSourceParkRow(park, true));

  if (contributingParks.length > 0 && otherParks.length > 0) {
    const divider = document.createElement("div");
    divider.className = "section-break";
    list.appendChild(divider);
  }

  otherParks.forEach((park) => renderSourceParkRow(park, false));

  resizePanelSoon();
}

async function loadCustomRidePicker(customId, sourceParkId) {
  const customPark = customParkById(customId);
  const sourcePark = allParks.find((park) => String(park.id) === String(sourceParkId));

  if (!customPark || !sourcePark) return;

  activeCustomListId = customId;
  activeCustomSourceParkId = String(sourceParkId);

  $("ridePickerTitle").textContent = `Add Rides from ${sourcePark.name}`;
  resetFilter("rideFilter");
  $("allRideList").innerHTML = `<div class="muted">Loading rides...</div>`;

  showView("ridePicker");

  try {
    const response = await fetch(parkQueueUrl(sourceParkId));
    const data = await response.json();

    allPickerRides = ridesFromQueueData(data)
      .map((ride) => ({
        name: ride.name,
        parkId: String(sourceParkId),
        parkName: sourcePark.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    renderCustomRidePicker();
    $("rideFilter").focus();
  } catch (err) {
    console.error(err);
    $("allRideList").innerHTML = `<div class="muted">Failed to load rides.</div>`;
    resizePanelSoon();
  }
}

function renderCustomRidePicker() {
  if (!activeCustomListId || !activeCustomSourceParkId) return;

  const sourcePark = allParks.find((park) => String(park.id) === String(activeCustomSourceParkId));
  const rides = Shared.customRidePickerRows(
    state,
    activeCustomListId,
    allPickerRides,
    $("rideFilter").value,
    sourcePark
  );

  const list = $("allRideList");
  list.innerHTML = "";

  if (rides.length === 0) {
    list.innerHTML = `<div class="muted">No rides found.</div>`;
    resizePanelSoon();
    return;
  }

  for (const ride of rides) {
    const selectedIndex = customRideIndex(activeCustomListId, ride.parkId, ride.name);
    const isSelected = selectedIndex !== -1;
    const isParkStatus = Shared.isParkStatusItem(ride);
    const label = isParkStatus
      ? isSelected ? "Park Status" : "[Add Park Status]"
      : ride.name;
    const title = isParkStatus ? "Park Status" : ride.name;

    const row = document.createElement("div");
    row.className = isSelected
      ? "picker-row selected"
      : "picker-row add-favorite-ride-row";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn ${isSelected ? "active" : ""}">
        ${isSelected ? "★" : "☆"}
      </button>

      <span class="ride-name" title="${escapeHtml(title)}">
        ${escapeHtml(label)}
      </span>

      <span></span>
    `;

    const toggleAndRender = () => {
      toggleCustomRide(activeCustomListId, ride);
      renderCustomRidePicker();
    };

    row.querySelector(".ride-star-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      toggleAndRender();
    });

    if (!isSelected) {
      row.querySelector(".ride-name").addEventListener("click", toggleAndRender);
    }

    list.appendChild(row);
  }

  resizePanelSoon();
}

function customRideIndex(customId, parkId, rideName) {
  return Shared.customRideIndex(state, customId, parkId, rideName);
}

function toggleCustomRide(customId, ride) {
  const wasSelected = customRideIndex(customId, ride.parkId, ride.name) !== -1;
  Shared.toggleCustomRide(state, customId, ride);
  if (!wasSelected && draftCustomListId === customId) {
    draftCustomListChanged = true;
  }
  saveState();
}

function showCustomRideOrder(customId) {
  const customPark = customParkById(customId);
  if (!customPark) return;

  activeCustomListId = customId;
  $("customRideOrderTitle").textContent = `Manage ${customPark.name}`;

  showView("customRideOrder");
  renderCustomRideOrder();
}

function renderCustomRideOrder() {
  if (!activeCustomListId) return;

  const rides = state.customParkRides[activeCustomListId] || [];
  const list = $("customRideOrderList");
  list.innerHTML = "";

  if (rides.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.innerHTML = "No rides selected for this custom list.";
    list.appendChild(empty);
  }

  rides.forEach((ride, index) => {
    const row = document.createElement("div");
    row.className = "order-row";

    const isDivider = Shared.isDividerItem(ride);
    const isParkStatus = Shared.isParkStatusItem(ride);
    const parkName = ride.parkName || `Park ${ride.parkId}`;
    const rideName = isDivider
      ? "-- Divider --"
      : isParkStatus
        ? parkName
        : ride.rideName;

    row.innerHTML = `
      <button class="small-btn" title="Remove">&times;</button>

      <span class="ride-name" title="${escapeHtml(rideName)}">
        ${escapeHtml(rideName)}
        ${
          isDivider
            ? `<span class="ride-source">Custom divider</span>`
            : isParkStatus
              ? `<span class="ride-source">Park Status</span>`
            : `<span class="ride-source" title="${escapeHtml(parkName)}">
                ${escapeHtml(parkName)}
              </span>`
        }
      </span>

      <button class="icon-btn drag-handle" title="Drag to reorder">&#9776;</button>
    `;

    const deleteBtn = row.querySelector(".small-btn");

    row.classList.add("draggable-row");

    makeRowDraggable(
      row,
      row.querySelector(".drag-handle"),
      rides,
      index,
      () => {
        state.customParkRides[activeCustomListId] = rides;
        saveState();
        renderCustomRideOrder();
      }
    );

    deleteBtn.addEventListener("click", () => {
      rides.splice(index, 1);
      state.customParkRides[activeCustomListId] = rides;
      saveState();
      renderCustomRideOrder();
    });

    list.appendChild(row);
  });

  const addDividerRow = document.createElement("div");
  addDividerRow.className = "order-row add-divider-row";

  addDividerRow.innerHTML = `
    <span class="ride-name">[Add Divider]</span>
    <span></span>
    <span></span>
  `;

  addDividerRow.addEventListener("click", () => {
    rides.push({
      type: "divider",
      title: "Divider"
    });

    if (draftCustomListId === activeCustomListId) {
      draftCustomListChanged = true;
    }

    state.customParkRides[activeCustomListId] = rides;
    saveState();
    renderCustomRideOrder();

    setTimeout(() => {
      list.scrollTop = list.scrollHeight;
    }, 0);
  });

  list.appendChild(addDividerRow);

  resizePanelSoon();
}
function setHomePark(park) {
  Shared.setHomePark(state, park);
  saveState();
}

function toggleFavoritePark(park) {
  Shared.toggleFavoritePark(state, park);
  saveState();
}

function renderCyclePreview() {
  const id = currentParkId();
  const rideList = $("rideList");

  if (!id) {
    rideList.innerHTML = `
      <div class="muted">
        No park selected.
      </div>
    `;
    return;
  }

  const previewItems = isCustomParkId(id)
    ? (state.customParkRides[id] || [])
    : (state.ridesByParkId[id] || []);

  if (previewItems.length === 0) {
    rideList.innerHTML = `
      <div class="muted">
        No rides selected for this park.
      </div>
    `;
    return;
  }

  rideList.innerHTML = previewItems
    .map((item) => {
      if (Shared.isDividerItem(item)) {
        return `<div class="custom-ride-divider"></div>`;
      }

      const name =
        typeof item === "string"
          ? item
          : Shared.standardItemName(item) || item?.name || "Unknown";

      return `
        <div class="ride">
          <span class="ride-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="muted">…</span>
        </div>
      `;
    })
    .join("");
  }

function cyclePark(direction) {
  const order = state.parkOrder;
  if (order.length === 0) return;

  const current = currentParkId();
  const index = Math.max(0, order.indexOf(current));
  const nextIndex = (index + direction + order.length) % order.length;

  state.currentParkId = order[nextIndex];
  saveState();

  renderHomeShell();
  renderCyclePreview();
  setTimeout(updateRideListScrollState, 0);

  clearTimeout(cycleResizeTimer);

  cycleResizeTimer = setTimeout(() => {
    cycleResizeTimer = null;
    loadWaitTimes();
  }, 1500);
}

async function goHomePark() {
  if (!state.homeParkId) return;

  state.currentParkId = String(state.homeParkId);
  saveState();

  await loadWaitTimes();

  setTimeout(() => {
    fitHomePanelToContent();
  }, 100);
}

function moveItem(array, from, to) {
  if (to < 0 || to >= array.length) return;
  const [item] = array.splice(from, 1);
  array.splice(to, 0, item);
}

function makeRowDraggable(row, handle, array, index, onReorder, options = {}) {
  if (!row || !handle) return;

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    const list = row.parentElement;
    const scrollContainer = row.closest(".scroll-list");
    const rowRect = row.getBoundingClientRect();

    const startIndex = index;
    let targetIndex = index;
    let lastClientY = event.clientY;
    const pointerOffsetY = event.clientY - rowRect.top;
    let autoScrollFrame = null;
    let autoScrollSpeed = 0;

    const ghost = row.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.left = `${rowRect.left}px`;
    ghost.style.top = `${rowRect.top}px`;
    ghost.style.width = `${rowRect.width}px`;
    ghost.style.height = `${rowRect.height}px`;

    const placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = `${rowRect.height}px`;

    row.replaceWith(placeholder);
    document.body.appendChild(ghost);

    function draggableRows() {
      return [...list.querySelectorAll(".draggable-row")];
    }

    function moveGhost(clientY) {
      ghost.style.top = `${clientY - pointerOffsetY}px`;
    }

    function targetIndexFromPointer(clientY) {
      const rows = draggableRows();

      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();

        if (clientY < rect.top + rect.height / 2) {
          return i;
        }
      }

      return rows.length;
    }

    function movePlaceholder(clientY) {
      const rows = draggableRows();
      const nextIndex = targetIndexFromPointer(clientY);

      if (nextIndex === targetIndex) return;

      targetIndex = nextIndex;

      if (targetIndex >= rows.length) {
        const lastRow = rows[rows.length - 1];

        if (lastRow) {
          lastRow.after(placeholder);
        }
      } else {
        rows[targetIndex].before(placeholder);
      }
    }

    function updateAutoScroll(clientY) {
      if (!scrollContainer) return;

      if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
        stopAutoScroll();
        return;
      }

      const rect = scrollContainer.getBoundingClientRect();
      const threshold = 42;
      const maxSpeed = 12;

      if (clientY < rect.top + threshold) {
        const distance = rect.top + threshold - clientY;
        autoScrollSpeed = -Math.min(maxSpeed, Math.ceil(distance / 4));
        startAutoScroll();
      } else if (
        clientY > rect.bottom - threshold &&
        (!options.boundToDraggableSection || targetIndex < draggableRows().length)
      ) {
        const distance = clientY - (rect.bottom - threshold);
        autoScrollSpeed = Math.min(maxSpeed, Math.ceil(distance / 4));
        startAutoScroll();
      } else {
        stopAutoScroll();
      }
    }

    function startAutoScroll() {
      if (autoScrollFrame) return;

      const tick = () => {
        if (!scrollContainer || autoScrollSpeed === 0) {
          stopAutoScroll();
          return;
        }

        movePlaceholder(lastClientY);

        if (
          options.boundToDraggableSection &&
          autoScrollSpeed > 0 &&
          targetIndex >= draggableRows().length
        ) {
          stopAutoScroll();
          return;
        }

        scrollContainer.scrollTop += autoScrollSpeed;
        autoScrollFrame = requestAnimationFrame(tick);
      };

      autoScrollFrame = requestAnimationFrame(tick);
    }

    function stopAutoScroll() {
      autoScrollSpeed = 0;

      if (autoScrollFrame) {
        cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = null;
      }
    }

    function onPointerMove(moveEvent) {
      lastClientY = moveEvent.clientY;
      moveGhost(lastClientY);
      movePlaceholder(lastClientY);
      updateAutoScroll(lastClientY);
    }

    function onPointerUp() {
      stopAutoScroll();

      placeholder.replaceWith(row);
      ghost.remove();

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);

      if (targetIndex !== startIndex) {
        moveItem(array, startIndex, targetIndex);
      }

      onReorder(true);
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);

    moveGhost(event.clientY);
  });
}

function escapeHtml(value) {
  return Shared.escapeHtml(value);
}

function closeHomeContextMenu() {
  $("homeContextMenu")?.classList.add("hidden");
}

function showHomeContextMenu(x, y) {
  const menu = $("homeContextMenu");
  if (!menu) return;

  menu.style.left = `${Math.min(x, window.innerWidth - 155)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 40)}px`;
  menu.classList.remove("hidden");
}

function clearSettingsLongPress() {
  clearTimeout(settingsLongPressTimer);
  settingsLongPressTimer = null;
}

async function configureCurrentPark() {
  const id = currentParkId();
  if (!id) return;

  setNavigationReturnTarget("home");

  if (isCustomParkId(id)) {
    showCustomRideMenu(id);
    return;
  }

  showView("ridePicker");
  await loadRidePicker();
  $("rideFilter").focus();
}

function startSettingsLongPress(event) {
  settingsLongPressRecognized = false;
  settingsLongPressStartX = event.clientX;
  settingsLongPressStartY = event.clientY;
  clearSettingsLongPress();

  settingsLongPressTimer = setTimeout(() => {
    settingsLongPressRecognized = true;
    clearSettingsLongPress();
    configureCurrentPark();
  }, 700);
}

function cancelSettingsLongPress() {
  clearSettingsLongPress();
}

function moveSettingsLongPress(event) {
  if (!settingsLongPressTimer) return;

  const deltaX = event.clientX - settingsLongPressStartX;
  const deltaY = event.clientY - settingsLongPressStartY;

  if (Math.hypot(deltaX, deltaY) > 12) {
    cancelSettingsLongPress();
  }
}

function handleSettingsTap(event) {
  if (settingsLongPressRecognized) {
    event.preventDefault();
    event.stopPropagation();
    settingsLongPressRecognized = false;
    return;
  }

  setNavigationReturnTarget(null);
  loadParkPicker();
}

function resetDeleteCustomListButton() {
  deleteCustomListArmed = false;

  const id = currentParkId();
  const park = customParkById(id);

  if (park) {
    $("customDeleteListBtn").querySelector(".menu-label").textContent =
      `Delete ${park.name}`;
  }
}

function deleteCustomList(id) {
  const park = customParkById(id);
  if (!park) return;

  clearDraftCustomList(id);

  state.customParks = state.customParks.filter(
    (customPark) => customPark.id !== id
  );

  delete state.customParkRides[id];
  delete state.ridesByParkId[id];
  delete state.parkNamesById[id];

  state.favoriteParkIds = state.favoriteParkIds.filter(
    (parkId) => parkId !== id
  );

  state.parkOrder = state.parkOrder.filter(
    (parkId) => parkId !== id
  );

  if (state.homeParkId === id) {
    state.homeParkId = null;
  }

  if (state.currentParkId === id) {
    state.currentParkId = state.parkOrder[0] || null;
  }

  saveState();

  resetDeleteCustomListButton();

  showView("parkPicker");
  renderParkPicker();
}

$("parkTitle").addEventListener("dblclick", fitHomePanelToContent);

$("settingsBtn").addEventListener("pointerdown", startSettingsLongPress);
$("settingsBtn").addEventListener("pointermove", moveSettingsLongPress);
$("settingsBtn").addEventListener("pointerup", cancelSettingsLongPress);
$("settingsBtn").addEventListener("pointerleave", cancelSettingsLongPress);
$("settingsBtn").addEventListener("pointercancel", cancelSettingsLongPress);
$("settingsBtn").addEventListener("click", handleSettingsTap);

$("refreshBtn").addEventListener("click", async () => {
  const btn = $("refreshBtn");

  btn.disabled = true;

  try {
    clearTimeout(cycleResizeTimer);
    cycleResizeTimer = null;

    showView("main");
    await loadWaitTimes();

    setTimeout(() => {
      fitHomePanelToContent();
    }, 50);
  } finally {
    btn.disabled = false;
  }
});

$("sourceStatus").addEventListener("click", (event) => {
  event.preventDefault();

  const parkId = currentParkId();
   const url = parkId && !isCustomParkId(parkId)
       ? `https://queue-times.com/parks/${parkId}`
       : "https://queue-times.com";

  window.electronAPI?.openExternal?.(url);
});

$("settingsBackBtn").addEventListener("click", returnToParkPicker);
$("aboutBackBtn").addEventListener("click", returnToParkPicker);
$("timeFormat12Btn").addEventListener("click", () => applyTimeFormat("12h"));
$("timeFormat24Btn").addEventListener("click", () => applyTimeFormat("24h"));
$("waitListTextSmallBtn").addEventListener("click", () => applyWaitListTextSize("small"));
$("waitListTextLargeBtn").addEventListener("click", () => applyWaitListTextSize("large"));

$("aboutQueueTimesLink").addEventListener("click", (event) => {
  event.preventDefault();
  window.electronAPI?.openExternal?.($("aboutQueueTimesLink").href);
});

$("parkPickerBackBtn").addEventListener("click", () => {
  showView("main");
  loadWaitTimes();

  if (lastMainPanelHeight) {
    setTimeout(() => {
      window.electronAPI?.resizePanel?.(lastMainPanelHeight + 8);
      setTimeout(updateRideListScrollState, 50);
    }, 0);
  }
});

$("ridePickerBackBtn").addEventListener("click", () => {
  if (activeCustomListId && activeCustomSourceParkId) {
    activeCustomSourceParkId = null;
    showView("customSourceParkPicker");
    renderCustomSourceParkPicker();
    return;
  }

  if (consumeNavigationReturnTarget() === "home") {
    returnToHomeView();
    return;
  }

  showView("parkPicker");
  renderParkPicker();
});

bindFilterClear("parkFilter", renderParkPicker);
bindFilterClear("rideFilter", renderRidePicker);

$("homeBtn").addEventListener("click", goHomePark);

$("homeBtn").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showHomeContextMenu(event.clientX, event.clientY);
});

$("setHomeParkBtn").addEventListener("click", () => {
  const id = currentParkId();
  if (!id) return;

  setHomePark({
    id,
    name: currentParkName()
  });

  closeHomeContextMenu();
  renderHomeShell();
});

$("customSourceParkBackBtn").addEventListener("click", () => {
  if (activeCustomListId) {
    showCustomRideMenu(activeCustomListId);
  } else {
    showView("customRideMenu");
  }
});

bindFilterClear("customSourceParkFilter", renderCustomSourceParkPicker);

$("customRideMenuBackBtn").addEventListener("click", () => {
  leaveCustomRideMenu();
});

$("customRideMenuTitle").addEventListener("click", startCustomMenuTitleRename);

$("customAddRidesBtn").addEventListener("click", () => {
  const id = currentParkId();
  if (!isCustomParkId(id)) return;

  loadCustomSourceParkPicker(id);
});

$("customReorderRidesBtn").addEventListener("click", () => {
  const id = currentParkId();
  if (!isCustomParkId(id)) return;

  showCustomRideOrder(id);
});

$("customDeleteListBtn").addEventListener("click", () => {
  const id = currentParkId();
  if (!isCustomParkId(id)) return;

  const park = customParkById(id);
  if (!park) return;

  if (!deleteCustomListArmed) {
    deleteCustomListArmed = true;

    $("customDeleteListBtn").querySelector(".menu-label").textContent =
      `Confirm Delete ${park.name}?`;

    return;
  }

  deleteCustomList(id);
});

$("customRideOrderBackBtn").addEventListener("click", () => {
  if (activeCustomListId) {
    showCustomRideMenu(activeCustomListId);
  } else {
    showView("customRideMenu");
  }
});

document.addEventListener("click", (event) => {
  const menu = $("homeContextMenu");

  if (
    !menu ||
    menu.classList.contains("hidden") ||
    menu.contains(event.target) ||
    $("homeBtn").contains(event.target)
  ) {
    return;
  }

  closeHomeContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeHomeContextMenu();
  }
});

$("prevParkBtn").addEventListener("click", () => cyclePark(-1));
$("nextParkBtn").addEventListener("click", () => cyclePark(1));

window.electronAPI?.onGoToPark?.(async (parkId) => {
  state.currentParkId = String(parkId);
  saveState();

  showView("main");
  await loadWaitTimes();

  setTimeout(() => {
    fitHomePanelToContent();
  }, 50);
});

window.electronAPI?.onShowPage?.((page) => {
  if (page === "settings") {
    showSettingsPage();
    return;
  }

  if (page === "about") {
    showAboutPage();
  }
});

startSourceTimer();

showView("main");
loadWaitTimes();
setInterval(loadWaitTimes, 300000);
