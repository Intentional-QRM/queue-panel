const STORAGE_KEY = "queuePanelState";

const DEFAULT_STATE = {
  homeParkId: null,
  currentParkId: null,
  favoriteParkIds: [],
  parkOrder: [],
  ridesByParkId: {},
  parkNamesById: {},
  customParks: [],
  customParkRides: {}
};

let state = loadState();
let allParks = [];
let allPickerRides = [];
let cycleResizeTimer = null;
let lastRefreshTime = null;
let sourceTimer = null;
let deleteCustomListArmed = false;
let activeCustomListId = null;
let activeCustomSourceParkId = null;
let parkHoursById = {};
let didInitialMainResize = false;
let lastMainPanelHeight = null;

const $ = (id) => document.getElementById(id);

const views = {
  main: $("mainView"),
  parkPicker: $("parkPickerView"),
  customRideMenu: $("customRideMenuView"),
  customSourceParkPicker: $("customSourceParkPickerView"),
  customRideOrder: $("customRideOrderView"),
  ridePicker: $("ridePickerView")
};

function loadState() {
  try {
    return {
      ...DEFAULT_STATE,
      ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {})
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  
  state.favoriteParkIds = uniqueIds(state.favoriteParkIds);
  state.parkOrder = uniqueIds(state.parkOrder).filter((id) =>
    state.favoriteParkIds.includes(id)
  );

  state.customParks = Array.isArray(state.customParks)
  ? state.customParks
  : [];

  state.customParkRides = state.customParkRides || {};

  for (const id of state.favoriteParkIds) {
    if (!state.parkOrder.includes(id)) {
      state.parkOrder.push(id);
    }
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateTrayMenuState();
}

function uniqueIds(ids) {
  return [...new Set(ids.map(String))];
}

function currentParkId() {
  return state.currentParkId ? String(state.currentParkId) : null;
}

function currentParkName() {
  const id = currentParkId();
  if (!id) return "No park selected";

  const customPark = customParkById(id);
  if (customPark) return customPark.name;

  return state.parkNamesById[id] || `Park ${id}`;
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
  if (Array.isArray(data.lands) && data.lands.length > 0) {
    return data.lands.flatMap((land) => land.rides || []);
  }

  if (Array.isArray(data.rides)) {
    return data.rides;
  }

  return [];
}

function parkPageUrl(parkId) {
  return `https://queue-times.com/parks/${parkId}/queue_times`;
}

async function loadParkHoursTooltip(parkId) {
  if (!parkId || isCustomParkId(parkId)) return;

  try {
    const response = await fetch(parkPageUrl(parkId));
    const html = await response.text();

    const doc = new DOMParser().parseFromString(html, "text/html");

    const hoursText = doc.querySelector("p.subtitle")?.textContent
      ?.replace(/\s+/g, " ")
      ?.trim();

    if (!hoursText) return;

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
  return `https://queue-times.com/parks/${parkId}/queue_times.json`;
}

function isCustomParkId(id) {
  return String(id || "").startsWith("custom_");
}

function customParkById(id) {
  return state.customParks.find((park) => park.id === String(id));
}

function displayParkName(park) {
  return park.isCustom ? `[${park.name}]` : park.name;
}

function nextCustomListNumber() {
  let number = 1;

  while (
    state.customParks.some((park) =>
      park.id === `custom_${number}` ||
      park.name === `Custom List ${number}`
    )
  ) {
    number++;
  }

  return number;
}

function createCustomList() {
  const number = nextCustomListNumber();
  const park = {
    id: `custom_${number}`,
    name: `Custom List ${number}`
  };

  state.customParks.push(park);
  state.parkNamesById[park.id] = park.name;
  state.favoriteParkIds.push(park.id);
  state.parkOrder.push(park.id);
  state.currentParkId = park.id;

  if (!state.customParkRides[park.id]) {
    state.customParkRides[park.id] = [];
  }

  saveState();
  renderParkPicker();
}

function showView(name) {
  Object.values(views).forEach((view) => view.classList.add("hidden"));
  views[name].classList.remove("hidden");
  closeHomeContextMenu();
  resizePanelSoon();
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
        !views.ridePicker.classList.contains("hidden");

      if (isManagementView) {
        window.electronAPI?.resizePanel?.(340);
        return;
      }

      if (!didInitialMainResize) {
        didInitialMainResize = true;
        window.electronAPI?.resizePanel?.(260);
      }
    });
  }, delay);
}

function waitClass(wait) {
  if (wait >= 60) return "high";
  if (wait >= 30) return "medium";
  return "low";
}

async function loadAllParks() {
  if (allParks.length > 0) return allParks;

  const response = await fetch("https://queue-times.com/parks.json");
  const groups = await response.json();

  allParks = groups
    .flatMap((group) => group.parks)
    .map((park) => ({
      id: String(park.id),
      name: park.name,
      country: park.country || "",
      continent: park.continent || ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    const response = await fetch(parkQueueUrl(id));
    const data = await response.json();

    lastRefreshTime = Date.now();
    updateSourceStatus();

    const allRides = ridesFromQueueData(data)

    const rides = savedRideNames
      .map((savedRide) => {
        if (savedRide.type === "divider") return savedRide;

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
    const realRides = savedRides.filter((ride) => ride.type !== "divider");

    const uniqueParkIds = [
      ...new Set(realRides.map((ride) => String(ride.parkId)))
    ];

    const parkRideMap = {};

    await Promise.all(
      uniqueParkIds.map(async (parkId) => {
        const response = await fetch(parkQueueUrl(parkId));
        const data = await response.json();
        parkRideMap[parkId] = ridesFromQueueData(data);
      })
    );

    lastRefreshTime = Date.now();
    updateSourceStatus();

    const rides = savedRides
      .map((savedRide) => {
        if (savedRide.type === "divider") {
          return savedRide;
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
    if (ride.type === "divider") {
      const divider = document.createElement("div");
      divider.className = "custom-ride-divider";
      rideList.appendChild(divider);
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
  $("rideFilter").value = "";
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
  const selected = normalizeStandardRideList(state.ridesByParkId[id] || []);
  const filter = $("rideFilter").value.trim().toLowerCase();

  const selectedRideNames = selected
    .filter((item) => item.type !== "divider")
    .map((item) => standardRideName(item));

  const selectedMatches = selected
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (item.type === "divider") return !filter;
      return standardRideName(item).toLowerCase().includes(filter);
    });

  const availableRides = allPickerRides
    .filter((ride) => !selectedRideNames.includes(ride.name))
    .filter((ride) => ride.name.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name));

  const list = $("allRideList");
  list.innerHTML = "";

  selectedMatches.forEach(({ item, index }) => {
    const isDivider = item.type === "divider";
    const rideName = isDivider ? "── Divider ──" : standardRideName(item);

    const row = document.createElement("div");
    row.className = "picker-row selected";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn active" title="${isDivider ? "Remove divider" : "Remove ride"}">★</button>

      <span class="ride-name" title="${escapeHtml(rideName)}">
        ${escapeHtml(rideName)}
      </span>

      <span class="row-actions">
        ${
          !filter
            ? `
              <button class="small-btn" title="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
              <button class="small-btn" title="Move down" ${index === selected.length - 1 ? "disabled" : ""}>↓</button>
            `
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
      const [upBtn, downBtn] = row.querySelectorAll(".small-btn");

      upBtn.addEventListener("click", () => {
        moveItem(selected, index, index - 1);
        state.ridesByParkId[id] = selected;
        saveState();
        renderRidePicker();
      });

      downBtn.addEventListener("click", () => {
        moveItem(selected, index, index + 1);
        state.ridesByParkId[id] = selected;
        saveState();
        renderRidePicker();
      });
    }

    list.appendChild(row);
  });

  if (!filter) {
    const addDividerRow = document.createElement("div");
    addDividerRow.className = "picker-row add-divider-row";

    addDividerRow.innerHTML = `
      <button class="icon-btn" title="Add divider">☆</button>
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
      <button class="icon-btn ride-star-btn" title="Add ride">☆</button>

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

  if (selectedMatches.length === 0 && availableRides.length === 0) {
    list.innerHTML = `<div class="muted">No rides found.</div>`;
  }

  resizePanelSoon();
}

function standardRideName(item) {
  return typeof item === "string" ? item : item?.rideName;
}

function standardRideIndex(rides, rideName) {
  return rides.findIndex((item) => standardRideName(item) === rideName);
}

function normalizeStandardRideList(rides) {
  return (rides || []).filter(Boolean);
}

function toggleRideForCurrentPark(rideName) {
  const id = currentParkId();
  if (!id) return;

  const rides = normalizeStandardRideList(state.ridesByParkId[id] || []);
  const index = standardRideIndex(rides, rideName);

  if (index !== -1) {
    rides.splice(index, 1);
  } else {
    rides.push(rideName);
  }

  state.ridesByParkId[id] = rides;
  saveState();
}

async function loadParkPicker() {
  lastMainPanelHeight = window.innerHeight;
  const list = $("allParkList");
  $("parkFilter").value = "";
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
  const filter = $("parkFilter").value.trim().toLowerCase();

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

  const favoriteParks = matchingParks
    .filter((park) => state.favoriteParkIds.includes(park.id))
    .sort((a, b) => state.parkOrder.indexOf(a.id) - state.parkOrder.indexOf(b.id));

  const otherParks = matchingParks
    .filter((park) => !state.favoriteParkIds.includes(park.id))
    .sort((a, b) => {
      if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

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
              <input
                class="park-name custom-park-name-input"
                value="${escapeHtml(park.name)}"
                title="${escapeHtml(park.name)}"
              />
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
              ? `
                <button class="small-btn move-up-btn" title="Move up" ${orderIndex === 0 ? "disabled" : ""}>↑</button>
                <button class="small-btn move-down-btn" title="Move down" ${orderIndex === state.parkOrder.length - 1 ? "disabled" : ""}>↓</button>
              `
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
        customNameInput.addEventListener("click", (event) => {
          event.stopPropagation();
        });

        customNameInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            customNameInput.blur();
          }

          if (event.key === "Escape") {
            customNameInput.value = park.name;
            customNameInput.blur();
          }
        });

        customNameInput.addEventListener("blur", () => {
          const newName = customNameInput.value.trim();

          if (!newName || newName === park.name) {
            customNameInput.value = park.name;
            return;
          }

          park.name = newName;

          const storedPark = customParkById(park.id);
          if (storedPark) {
            storedPark.name = newName;
          }

          state.parkNamesById[park.id] = newName;

          saveState();
          renderParkPicker();

          if (currentParkId() === park.id) {
            renderHomeShell();
          }
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
        const upBtn = row.querySelector(".move-up-btn");
        const downBtn = row.querySelector(".move-down-btn");

        upBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          moveItem(state.parkOrder, orderIndex, orderIndex - 1);
          saveState();
          renderParkPicker();
        });

        downBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          moveItem(state.parkOrder, orderIndex, orderIndex + 1);
          saveState();
          renderParkPicker();
        });
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

  $("customRideMenuTitle").textContent = `Configure ${park.name}`;

  $("customAddRidesBtn").querySelector(".menu-label").textContent =
    "Add Rides";

  $("customReorderRidesBtn").querySelector(".menu-label").textContent =
    "Manage Ride List";
  $("customDeleteListBtn").querySelector(".menu-label").textContent =
    `Delete ${park.name}`;

  resetDeleteCustomListButton();
  showView("customRideMenu");
}

function sourceParkIdsForCustomList(customId) {
  const rides = state.customParkRides[customId] || [];
  return new Set(rides.map((ride) => String(ride.parkId)));
}

async function loadCustomSourceParkPicker(customId) {
  const customPark = customParkById(customId);
  if (!customPark) return;

  activeCustomListId = customId;

  $("customSourceParkTitle").textContent = "Choose Source Park";
  $("customSourceParkFilter").value = "";
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

  const filter = $("customSourceParkFilter").value.trim().toLowerCase();
  const sourceParkIds = sourceParkIdsForCustomList(activeCustomListId);

  const matchingParks = allParks.filter((park) => {
    const text = `${park.name} ${park.country} ${park.continent}`.toLowerCase();
    return text.includes(filter);
  });

  const contributingParks = matchingParks
    .filter((park) => sourceParkIds.has(String(park.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const otherParks = matchingParks
    .filter((park) => !sourceParkIds.has(String(park.id)))
    .sort((a, b) => a.name.localeCompare(b.name));

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
  const sourcePark = allParks.find((park) => park.id === String(sourceParkId));

  if (!customPark || !sourcePark) return;

  activeCustomListId = customId;
  activeCustomSourceParkId = String(sourceParkId);

  $("ridePickerTitle").textContent = `Add Rides from ${sourcePark.name}`;
  $("rideFilter").value = "";
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

  const selected = state.customParkRides[activeCustomListId] || [];
  const filter = $("rideFilter").value.trim().toLowerCase();

  const rides = allPickerRides
    .filter((ride) => ride.name.toLowerCase().includes(filter))
    .sort((a, b) => {
      const aIndex = customRideIndex(activeCustomListId, a.parkId, a.name);
      const bIndex = customRideIndex(activeCustomListId, b.parkId, b.name);

      const aSelected = aIndex !== -1;
      const bSelected = bIndex !== -1;

      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      if (aSelected && bSelected) return aIndex - bIndex;

      return a.name.localeCompare(b.name);
    });

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

    const row = document.createElement("div");
    row.className = isSelected
      ? "picker-row selected"
      : "picker-row add-favorite-ride-row";

    row.innerHTML = `
      <button class="icon-btn ride-star-btn ${isSelected ? "active" : ""}">
        ${isSelected ? "★" : "☆"}
      </button>

      <span class="ride-name" title="${escapeHtml(ride.name)}">
        ${escapeHtml(ride.name)}
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
  const rides = state.customParkRides[customId] || [];

  return rides.findIndex((ride) =>
    String(ride.parkId) === String(parkId) &&
    ride.rideName === rideName
  );
}

function toggleCustomRide(customId, ride) {
  const rides = state.customParkRides[customId] || [];
  const index = customRideIndex(customId, ride.parkId, ride.name);

  if (index === -1) {
    rides.push({
      parkId: String(ride.parkId),
      parkName: ride.parkName,
      rideName: ride.name
    });
  } else {
    rides.splice(index, 1);
  }

  state.customParkRides[customId] = rides;
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

    const isDivider = ride.type === "divider";

    row.innerHTML = `
      <button class="small-btn" title="Remove">✕</button>

      <span class="ride-name" title="${escapeHtml(isDivider ? "── Divider ──" : ride.rideName)}">
        ${isDivider ? "── Divider ──" : escapeHtml(ride.rideName)}
        ${
          isDivider
            ? `<span class="ride-source">Custom divider</span>`
            : `<span class="ride-source" title="${escapeHtml(ride.parkName || `Park ${ride.parkId}`)}">
                ${escapeHtml(ride.parkName || `Park ${ride.parkId}`)}
              </span>`
        }
      </span>

      <button class="small-btn" title="Move up" ${index === 0 ? "disabled" : ""}>↑</button>
      <button class="small-btn" title="Move down" ${index === rides.length - 1 ? "disabled" : ""}>↓</button>
    `;

    const [deleteBtn, upBtn, downBtn] = row.querySelectorAll("button");

    upBtn.addEventListener("click", () => {
      moveItem(rides, index, index - 1);
      state.customParkRides[activeCustomListId] = rides;
      saveState();
      renderCustomRideOrder();
    });

    downBtn.addEventListener("click", () => {
      moveItem(rides, index, index + 1);
      state.customParkRides[activeCustomListId] = rides;
      saveState();
      renderCustomRideOrder();
    });

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
    <span></span>
  `;

  addDividerRow.addEventListener("click", () => {
    rides.push({
      type: "divider",
      title: "Divider"
    });

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
  state.homeParkId = park.id;
  state.currentParkId = park.id;
  state.parkNamesById[park.id] = park.name;

  if (!state.favoriteParkIds.includes(park.id)) {
    state.favoriteParkIds.push(park.id);
  }

  if (!state.parkOrder.includes(park.id)) {
    state.parkOrder.push(park.id);
  }

  saveState();
}

function toggleFavoritePark(park) {
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
      if (item?.type === "divider") {
        return `<div class="custom-ride-divider"></div>`;
      }

      const name =
        typeof item === "string"
          ? item
          : item?.rideName || item?.name || "Unknown";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// function savedRidePreviewName(item) {
//  if (!item) return "Unknown";
//  if (item.type === "divider") return "───────";
//  if (typeof item === "string") return item;
//  return item.rideName || item.name || "Unknown";
// }

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

$("settingsBtn").addEventListener("click", loadParkPicker);

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

  showView("parkPicker");
  renderParkPicker();
});

$("parkFilter").addEventListener("input", renderParkPicker);
$("rideFilter").addEventListener("input", renderRidePicker);

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

$("customSourceParkFilter").addEventListener("input", renderCustomSourceParkPicker);

$("customRideMenuBackBtn").addEventListener("click", () => {
  showView("parkPicker");
  renderParkPicker();
});

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

startSourceTimer();

showView("main");
loadWaitTimes();
setInterval(loadWaitTimes, 300000);