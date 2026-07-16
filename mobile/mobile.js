const Shared = window.QueuePanelShared;
const STORAGE_KEY = "queuePanelState";
const usePackagedQueueTimes = Boolean(window.Capacitor?.isNativePlatform?.());
const api = Shared.createApi({
  parksUrl: usePackagedQueueTimes
    ? "https://queue-times.com/parks.json"
    : "/api/parks",
  queueUrl: (parkId) => usePackagedQueueTimes
    ? `https://queue-times.com/parks/${parkId}/queue_times.json`
    : `/api/park/${parkId}`,
  pageUrl: (parkId) => usePackagedQueueTimes
    ? `https://queue-times.com/parks/${parkId}/queue_times`
    : `/api/park-page/${parkId}`,
  timeFormat: () => currentTimeFormat()
});

let state = Shared.loadState(localStorage, STORAGE_KEY);
let allParks = [];
let allPickerRides = [];
let activeCustomListId = null;
let activeCustomSourceParkId = null;
let navigationReturnTarget = null;
let draftCustomListId = null;
let draftCustomListName = null;
let draftCustomListChanged = false;
let lastRefreshTime = null;
let touchStartX = 0;
let touchStartY = 0;
let pullDistance = 0;
let pullGestureStartedAtTop = false;
let isPullRefreshing = false;
let deleteCustomListArmed = false;
let homeLongPressTimer = null;
let homeLongPressRecognized = false;
let homeLongPressStartX = 0;
let homeLongPressStartY = 0;
let settingsLongPressTimer = null;
let settingsLongPressRecognized = false;
let settingsLongPressStartX = 0;
let settingsLongPressStartY = 0;
let toastTimer = null;
let activeDragScrollContainer = null;
let dragAutoScrollFrame = null;
let dragAutoScrollSpeed = 0;
let parkSwipeTimer = null;
let isParkSwipeAnimating = false;
let waitLoadToken = 0;
let currentRenderedRides = [];

const PARK_SWIPE_PHASE_MS = 90;

const $ = (id) => document.getElementById(id);

function getHomeScrollContainer() {
  const rideList = $("rideList");
  let node = rideList;

  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }

  return document.scrollingElement || document.documentElement;
}

function isHomeScrolledToTop() {
  return getHomeScrollContainer().scrollTop <= 1;
}

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

applyThemeToDocument();

function saveState() {
  Shared.saveState(localStorage, STORAGE_KEY, state);
}

function currentTimeFormat() {
  return Shared.timeFormatForState(state);
}

function currentTheme() {
  return Shared.themeForState(state);
}

function currentWaitListTextSize() {
  return Shared.waitListTextSizeForState(state);
}

function showView(name) {
  Object.values(views).forEach((view) => view.classList.add("hidden"));
  views[name].classList.remove("hidden");
  closeParkOverflowMenu();
}

function currentViewName() {
  return Object.entries(views)
    .find(([, view]) => !view.classList.contains("hidden"))?.[0] || "main";
}

function capacitorAppPlugin() {
  return window.Capacitor?.Plugins?.App || window.CapacitorApp;
}

function capacitorHapticsPlugin() {
  return window.Capacitor?.Plugins?.Haptics || window.CapacitorHaptics;
}

function capacitorBrowserPlugin() {
  return window.Capacitor?.Plugins?.Browser || window.CapacitorBrowser;
}

function triggerLongPressHaptic() {
  const haptics = capacitorHapticsPlugin();

  if (window.Capacitor?.isNativePlatform?.() && haptics?.impact) {
    haptics.impact({ style: "LIGHT" }).catch(() => {});
    return;
  }

  navigator.vibrate?.(20);
}

function openExternalUrl(url) {
  const browser = capacitorBrowserPlugin();
  const fallback = () => window.open(url, "_blank", "noopener");

  if (window.Capacitor?.isNativePlatform?.() && browser?.open) {
    browser.open({ url }).catch(fallback);
    return;
  }

  fallback();
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
}

function closeParkOverflowMenu() {
  $("parkOverflowMenu")?.classList.add("hidden");
}

function toggleParkOverflowMenu() {
  $("parkOverflowMenu")?.classList.toggle("hidden");
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

function returnToParkPicker() {
  showView("parkPicker");
  renderParkPicker();
}

function updateSettingsControls() {
  const theme = currentTheme();
  const timeFormat = currentTimeFormat();
  const waitListTextSize = currentWaitListTextSize();
  $("themeLightBtn").classList.toggle("active", theme === "light");
  $("themeDarkBtn").classList.toggle("active", theme === "dark");
  $("timeFormat12Btn").classList.toggle("active", timeFormat === "12h");
  $("timeFormat24Btn").classList.toggle("active", timeFormat === "24h");
  $("waitListTextSmallBtn").classList.toggle("active", waitListTextSize === "small");
  $("waitListTextLargeBtn").classList.toggle("active", waitListTextSize === "large");
}

function applyThemeToDocument() {
  document.documentElement.dataset.theme = currentTheme();
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

  currentRenderedRides = currentRenderedRides.map((ride) =>
    Shared.isParkStatusItem(ride)
      ? { ...ride, statusText: reformatStatusText(ride.statusText) }
      : ride
  );

  if (!views.main.classList.contains("hidden")) {
    renderRides(currentRenderedRides);
  }
}

function applyTheme(theme) {
  if (!["light", "dark"].includes(theme)) return;

  state.settings = {
    ...(state.settings || {}),
    theme
  };
  saveState();
  applyThemeToDocument();
  updateSettingsControls();
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

function currentParkId() {
  return Shared.currentParkId(state);
}

function currentParkName() {
  return Shared.currentParkName(state);
}

function customParkById(id) {
  return Shared.customParkById(state, id);
}

function escapeHtml(value) {
  return Shared.escapeHtml(value);
}

function updateSourceStatus() {
  const el = $("sourceStatus");
  const parkId = currentParkId();
  el.href = parkId && !Shared.isCustomParkId(parkId)
    ? `https://queue-times.com/parks/${parkId}/queue_times`
    : "https://queue-times.com";

  if (!lastRefreshTime) {
    el.textContent = "Powered by Queue-Times.com";
    return;
  }

  const ageSeconds = Math.floor((Date.now() - lastRefreshTime) / 1000);
  const ageText =
    ageSeconds < 60
      ? "Just now"
      : ageSeconds < 3600
        ? `${Math.floor(ageSeconds / 60)}m ago`
        : `${Math.floor(ageSeconds / 3600)}h ago`;

  el.textContent = `Powered by Queue-Times.com - ${ageText}`;
}

function renderHomeShell() {
  updateWaitListTextSizeClass();
  $("parkTitle").textContent = currentParkName();
  updateHomeButtonState();
}

function updateHomeButtonState() {
  const id = currentParkId();
  $("homeBtn").classList.toggle(
    "active",
    Boolean(id && state.homeParkId && String(state.homeParkId) === String(id))
  );
}

function renderRides(rides) {
  currentRenderedRides = rides;
  const rideList = $("rideList");
  rideList.innerHTML = "";

  rides.forEach((ride) => {
    if (ride?.type === "divider") {
      const divider = document.createElement("div");
      divider.className = "custom-ride-divider";
      rideList.appendChild(divider);
      return;
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
      return;
    }

    const row = document.createElement("div");
    row.className = "ride";

    const waitText = ride.placeholderWait
      ? "--"
      : ride.is_open ? ride.wait_time : "Closed";
    const className = ride.placeholderWait
      ? "muted"
      : ride.is_open ? Shared.waitClass(ride.wait_time) : "closed";

    row.innerHTML = `
      <span class="ride-name ${ride.is_open ? "" : "closed"}" title="${escapeHtml(ride.name)}">
        ${escapeHtml(ride.name)}
      </span>
      <span class="${className}" title="${escapeHtml(ride.name)}">${waitText}</span>
    `;

    rideList.appendChild(row);
  });
}

function previewRideItem(item, isCustomList = false) {
  if (Shared.isDividerItem(item)) return item;

  if (Shared.isParkStatusItem(item)) {
    return {
      type: "parkStatus",
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

  if (!name) return null;

  return {
    name,
    placeholderWait: true
  };
}

function renderWaitPreview(savedItems, isCustomList = false) {
  renderRides(
    savedItems
      .map((item) => previewRideItem(item, isCustomList))
      .filter(Boolean)
  );
}

function isCurrentWaitLoad(token, id) {
  return token === waitLoadToken && String(currentParkId()) === String(id);
}

async function loadAllParks() {
  if (allParks.length > 0) return allParks;

  allParks = await api.loadParks();

  for (const park of allParks) {
    state.parkNamesById[park.id] = park.name;
  }

  saveState();
  return allParks;
}

async function loadWaitTimes() {
  const token = ++waitLoadToken;
  renderHomeShell();
  updateSourceStatus();

  const id = currentParkId();
  const rideList = $("rideList");

  if (!id) {
    rideList.innerHTML = `<div class="muted">No park selected.</div>`;
    return;
  }

  if (Shared.isCustomParkId(id)) {
    await loadCustomWaitTimes(id, token);
    return;
  }

  const savedRides = Shared.normalizeStandardRideList(state.ridesByParkId[id] || []);
  if (savedRides.length === 0) {
    rideList.innerHTML = `<div class="muted">No rides selected for this park.</div>`;
    return;
  }

  renderWaitPreview(savedRides);

  try {
    const realSavedRides = savedRides.filter((item) =>
      !Shared.isDividerItem(item) && !Shared.isParkStatusItem(item)
    );
    const allRides = realSavedRides.length > 0
      ? await api.loadRides(id)
      : [];
    const statusText = savedRides.some(Shared.isParkStatusItem)
      ? await api.loadParkStatus(id)
      : null;
    const rides = savedRides
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

    if (!isCurrentWaitLoad(token, id)) return;

    lastRefreshTime = Date.now();
    updateSourceStatus();
    renderRides(rides);
  } catch (error) {
    if (!isCurrentWaitLoad(token, id)) return;

    console.error(error);
    rideList.innerHTML = `<div class="muted">Failed to load wait times.</div>`;
  }
}

async function loadCustomWaitTimes(id, token) {
  const savedRides = state.customParkRides[id] || [];
  const rideList = $("rideList");

  if (savedRides.length === 0) {
    rideList.innerHTML = `<div class="muted">No rides selected for this custom list.</div>`;
    return;
  }

  renderWaitPreview(savedRides, true);

  try {
    const realRides = savedRides.filter((ride) =>
      !Shared.isDividerItem(ride) && !Shared.isParkStatusItem(ride)
    );
    const statusItems = savedRides.filter(Shared.isParkStatusItem);
    const uniqueParkIds = [...new Set(realRides.map((ride) => String(ride.parkId)))];
    const uniqueStatusParkIds = [
      ...new Set(statusItems.map((ride) => String(ride.parkId)))
    ];
    const parkRideMap = {};
    const parkStatusMap = {};

    await Promise.all(
      uniqueParkIds.map(async (parkId) => {
        parkRideMap[parkId] = await api.loadRides(parkId);
      })
    );

    await Promise.all(
      uniqueStatusParkIds.map(async (parkId) => {
        parkStatusMap[parkId] = await api.loadParkStatus(parkId);
      })
    );

    const rides = savedRides
      .map((savedRide) => {
        if (Shared.isDividerItem(savedRide)) return savedRide;
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
        return (parkRideMap[String(savedRide.parkId)] || [])
          .find((ride) => ride.name === savedRide.rideName);
      })
      .filter(Boolean);

    if (!isCurrentWaitLoad(token, id)) return;

    lastRefreshTime = Date.now();
    updateSourceStatus();
    renderRides(rides);
  } catch (error) {
    if (!isCurrentWaitLoad(token, id)) return;

    console.error(error);
    rideList.innerHTML = `<div class="muted">Failed to load custom list wait times.</div>`;
  }
}

async function loadParkPicker() {
  resetFilter("parkFilter");
  $("allParkList").innerHTML = `<div class="muted">Loading parks...</div>`;
  showView("parkPicker");

  try {
    await loadAllParks();
    renderParkPicker();
  } catch (error) {
    console.error(error);
    $("allParkList").innerHTML = `<div class="muted">Failed to load parks.</div>`;
  }
}

function moveItem(array, from, to) {
  if (from === to || from < 0 || to < 0) return;

  const [item] = array.splice(from, 1);
  array.splice(to, 0, item);
}

function makeRowDraggable(row, handle, array, index, onReorder, options = {}) {
  if (!row || !handle) return;

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    handle.setPointerCapture?.(event.pointerId);

    const list = row.parentElement;
    const scrollContainer = row.closest(".scroll-list") || list;
    const rowRect = row.getBoundingClientRect();

    const startIndex = index;
    let targetIndex = index;
    let lastClientY = event.clientY;
    const pointerOffsetY = event.clientY - rowRect.top;

    const ghost = row.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rowRect.width}px`;
    ghost.style.height = `${rowRect.height}px`;
    ghost.style.left = `${rowRect.left}px`;
    ghost.style.top = `${rowRect.top}px`;

    const placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = `${rowRect.height}px`;

    row.replaceWith(placeholder);
    document.body.appendChild(ghost);
    activeDragScrollContainer = scrollContainer;

    const draggableRows = () =>
      [...list.querySelectorAll(".draggable-row")];

    const moveGhost = (clientY) => {
      ghost.style.top = `${clientY - pointerOffsetY}px`;
    };

    const targetIndexFromPointer = (clientY) => {
      const rows = draggableRows();

      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();

        if (clientY < rect.top + rect.height / 2) {
          return i;
        }
      }

      return rows.length;
    };

    const movePlaceholder = (clientY) => {
      const rows = draggableRows();
      const nextIndex = targetIndexFromPointer(clientY);

      if (nextIndex === targetIndex) return;

      targetIndex = nextIndex;

      if (targetIndex >= rows.length) {
        const lastRow = rows[rows.length - 1];
        if (lastRow) lastRow.after(placeholder);
      } else {
        rows[targetIndex].before(placeholder);
      }
    };

    const stopAutoScroll = () => {
      activeDragScrollContainer = null;
      dragAutoScrollSpeed = 0;

      if (dragAutoScrollFrame) {
        cancelAnimationFrame(dragAutoScrollFrame);
        dragAutoScrollFrame = null;
      }
    };

    const startAutoScroll = () => {
      if (dragAutoScrollFrame) return;

      const step = () => {
        if (!activeDragScrollContainer || dragAutoScrollSpeed === 0) {
          stopAutoScroll();
          return;
        }

        movePlaceholder(lastClientY);

        if (
          options.boundToDraggableSection &&
          dragAutoScrollSpeed > 0 &&
          targetIndex >= draggableRows().length
        ) {
          stopAutoScroll();
          return;
        }

        activeDragScrollContainer.scrollTop += dragAutoScrollSpeed;
        movePlaceholder(lastClientY);
        dragAutoScrollFrame = requestAnimationFrame(step);
      };

      dragAutoScrollFrame = requestAnimationFrame(step);
    };

    const updateAutoScroll = (clientY) => {
      if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
        stopAutoScroll();
        return;
      }

      const rect = scrollContainer.getBoundingClientRect();
      const edge = 56;
      const visualViewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : window.innerHeight;
      const bottomSafeOffset = 44;
      const bottomEdge = Math.min(rect.bottom, visualViewportBottom) - bottomSafeOffset;
      const maxSpeed = 18;

      if (clientY < rect.top + edge) {
        const distance = Math.max(0, rect.top + edge - clientY);
        dragAutoScrollSpeed = -Math.min(maxSpeed, 2 + Math.ceil((distance / edge) * maxSpeed));
        activeDragScrollContainer = scrollContainer;
        startAutoScroll();
      } else if (
        clientY > bottomEdge - edge &&
        (!options.boundToDraggableSection || targetIndex < draggableRows().length)
      ) {
        const distance = Math.max(0, clientY - (bottomEdge - edge));
        dragAutoScrollSpeed = Math.min(maxSpeed, 2 + Math.ceil((distance / edge) * maxSpeed));
        activeDragScrollContainer = scrollContainer;
        startAutoScroll();
      } else {
        stopAutoScroll();
      }
    };

    const onPointerMove = (moveEvent) => {
      lastClientY = moveEvent.clientY;
      moveGhost(lastClientY);
      movePlaceholder(lastClientY);
      updateAutoScroll(lastClientY);
    };

    const finishDrag = () => {
      stopAutoScroll();

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);

      placeholder.replaceWith(row);
      ghost.remove();

      if (targetIndex !== startIndex) {
        moveItem(array, startIndex, targetIndex);
      }

      onReorder(true);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);

    moveGhost(event.clientY);
  });
}

function renderParkPicker() {
  const { filter, favoriteParks, otherParks } =
    Shared.parkPickerGroups(state, allParks, $("parkFilter").value);
  const list = $("allParkList");
  list.innerHTML = "";

  const renderAddCustomListRow = () => {
    const row = document.createElement("div");
    row.className = "picker-row add-custom-list-row";
    row.innerHTML = `
      <button class="icon-btn" title="Add custom list">&#9734;</button>
      <span class="park-name">[Add Custom Ride List]</span>
      <span></span>
    `;
    row.addEventListener("click", () => {
      const park = Shared.createCustomList(state);
      draftCustomListId = park.id;
      draftCustomListName = park.name;
      draftCustomListChanged = false;
      saveState();
      renderParkPicker();
      showCustomRideMenu(park.id);
    });
    list.appendChild(row);
  };

  const renderParkRow = (park) => {
    const isFavorite = state.favoriteParkIds.includes(park.id);
    const isCurrent = currentParkId() === park.id;
    const orderIndex = state.parkOrder.indexOf(park.id);
    const row = document.createElement("div");
    row.className = isCurrent ? "picker-row selected" : "picker-row";
    if (!isFavorite && !park.isCustom) row.classList.add("add-favorite-park-row");
    if (isFavorite && !filter) row.classList.add("park-reorder-row");

    row.innerHTML = `
      <button class="icon-btn favorite-park-btn ${isFavorite ? "active" : ""}" title="Favorite park">
        ${isFavorite ? "&#9733;" : "&#9734;"}
      </button>
      ${
        park.isCustom
          ? `
            <span class="inline-rename-control">
              <input class="park-name custom-park-name-input" value="${escapeHtml(park.name)}" title="${escapeHtml(park.name)}" />
              <button class="rename-clear-btn hidden" type="button" title="Clear name">&times;</button>
            </span>
          `
          : `<span class="park-name" title="${escapeHtml(Shared.displayParkName(park))}">${escapeHtml(Shared.displayParkName(park))}</span>`
      }
      <span class="row-actions">
        ${
          isFavorite && !filter
            ? `<button class="icon-btn drag-handle" title="Drag to reorder">&#10303;</button>`
            : ""
        }
        <button class="icon-btn configure-park-btn" title="${park.isCustom ? "Custom list rides" : "Modify ride list"}">&#9881;</button>
      </span>
    `;

    row.addEventListener("click", () => {
      state.currentParkId = park.id;
      state.parkNamesById[park.id] = park.name;
      saveState();
      updateHomeButtonState();
      renderParkPicker();
    });

    const customNameInput = row.querySelector(".custom-park-name-input");
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
        renderHomeShell();
      };

      customNameInput.addEventListener("click", (event) => event.stopPropagation());
      customNameInput.addEventListener("focus", () => {
        canceled = false;
        finishing = false;
        syncInlineRenameClearButton();
      });
      customNameClearButton?.addEventListener("pointerdown", (event) => {
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

    row.querySelector(".favorite-park-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      Shared.toggleFavoritePark(state, park);
      saveState();
      renderParkPicker();
    });

    row.querySelector(".configure-park-btn").addEventListener("click", async (event) => {
      event.stopPropagation();
      state.currentParkId = park.id;
      state.parkNamesById[park.id] = park.name;
      saveState();
      updateHomeButtonState();

      if (park.isCustom) {
        showCustomRideMenu(park.id);
        return;
      }

      await loadRidePicker(park.id);
    });

    if (isFavorite && !filter) {
      row.classList.add("draggable-row");
      makeRowDraggable(
        row,
        row.querySelector(".drag-handle"),
        state.parkOrder,
        orderIndex,
        (commit = true) => {
          if (!commit) return;
          saveState();
          renderParkPicker();
        },
        { boundToDraggableSection: true }
      );
    }

    list.appendChild(row);
  };

  favoriteParks.forEach(renderParkRow);

  if (!filter || "[add custom list]".includes(filter)) {
    renderAddCustomListRow();
  }

  otherParks.forEach(renderParkRow);

  if (favoriteParks.length === 0 && otherParks.length === 0 && filter) {
    list.innerHTML = `<div class="muted">No parks found.</div>`;
  }
}

function showCustomRideMenu(id) {
  const park = customParkById(id);
  if (!park) return;

  activeCustomListId = id;
  deleteCustomListArmed = false;
  $("customRideMenuTitle").textContent = `Configure ${park.name}`;
  $("customAddRidesBtn").querySelector(".menu-label").textContent = "Add Rides";
  $("customReorderRidesBtn").querySelector(".menu-label").textContent = "Manage Ride List";
  $("customDeleteListBtn").querySelector(".menu-label").textContent = `Delete ${park.name}`;
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
  const id = activeCustomListId;

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
  const id = activeCustomListId;
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
    if (updatedPark) {
      $("customDeleteListBtn").querySelector(".menu-label").textContent =
        `Delete ${updatedPark.name}`;
    }
  };

  input.addEventListener("input", () => {
    clearButton.classList.toggle("hidden", input.value.length === 0);
  });

  clearButton.addEventListener("pointerdown", (event) => {
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

async function loadCustomSourceParkPicker(customId) {
  activeCustomListId = customId;
  resetFilter("customSourceParkFilter");
  $("customSourceParkList").innerHTML = `<div class="muted">Loading parks...</div>`;
  showView("customSourceParkPicker");

  try {
    await loadAllParks();
    renderCustomSourceParkPicker();
  } catch (error) {
    console.error(error);
    $("customSourceParkList").innerHTML = `<div class="muted">Failed to load parks.</div>`;
  }
}

function renderCustomSourceParkPicker() {
  const { contributingParks, otherParks } = Shared.customSourceParkGroups(
    state,
    allParks,
    activeCustomListId,
    $("customSourceParkFilter").value
  );
  const list = $("customSourceParkList");
  list.innerHTML = "";

  const renderSourceParkRow = (park, contributes) => {
    const row = document.createElement("div");
    row.className = contributes
      ? "picker-row selected choose-source-park-row"
      : "picker-row choose-source-park-row";
    row.innerHTML = `
      <span class="park-name" title="${escapeHtml(park.name)}">${escapeHtml(park.name)}</span>
      <span class="row-actions"><button class="icon-btn" title="Choose park">&rsaquo;</button></span>
    `;
    row.addEventListener("click", () => loadCustomRidePicker(activeCustomListId, park.id));
    list.appendChild(row);
  };

  contributingParks.forEach((park) => renderSourceParkRow(park, true));

  if (contributingParks.length > 0 && otherParks.length > 0) {
    const divider = document.createElement("div");
    divider.className = "section-break";
    list.appendChild(divider);
  }

  otherParks.forEach((park) => renderSourceParkRow(park, false));

  if (contributingParks.length === 0 && otherParks.length === 0) {
    list.innerHTML = `<div class="muted">No parks found.</div>`;
  }
}

async function loadRidePicker(parkId = currentParkId()) {
  if (!parkId) return;

  activeCustomListId = null;
  activeCustomSourceParkId = null;
  $("ridePickerTitle").textContent = `${currentParkName()} Rides`;
  resetFilter("rideFilter");
  $("allRideList").innerHTML = `<div class="muted">Loading rides...</div>`;
  showView("ridePicker");

  try {
    allPickerRides = (await api.loadRides(parkId))
      .map((ride) => ({ name: ride.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    renderRidePicker();
  } catch (error) {
    console.error(error);
    $("allRideList").innerHTML = `<div class="muted">Failed to load rides.</div>`;
  }
}

async function loadCustomRidePicker(customId, sourceParkId) {
  const sourcePark = allParks.find((park) => String(park.id) === String(sourceParkId));
  if (!sourcePark) return;

  activeCustomListId = customId;
  activeCustomSourceParkId = String(sourceParkId);
  $("ridePickerTitle").textContent = `Add Rides from ${sourcePark.name}`;
  resetFilter("rideFilter");
  $("allRideList").innerHTML = `<div class="muted">Loading rides...</div>`;
  showView("ridePicker");

  try {
    allPickerRides = (await api.loadRides(sourceParkId))
      .map((ride) => ({
        name: ride.name,
        parkId: String(sourceParkId),
        parkName: sourcePark.name
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    renderCustomRidePicker();
  } catch (error) {
    console.error(error);
    $("allRideList").innerHTML = `<div class="muted">Failed to load rides.</div>`;
  }
}

function renderRidePicker() {
  if (activeCustomListId && activeCustomSourceParkId) {
    renderCustomRidePicker();
    return;
  }

  const id = currentParkId();
  const model = Shared.standardRidePickerModel(state, id, allPickerRides, $("rideFilter").value);
  const list = $("allRideList");
  list.innerHTML = "";

  model.selectedMatches.forEach(({ item, index }) => {
    const isDivider = Shared.isDividerItem(item);
    const isParkStatus = Shared.isParkStatusItem(item);
    const rideName = isDivider ? "-- Divider --" : Shared.standardItemName(item);
    const row = document.createElement("div");
    row.className = "picker-row selected";
    row.innerHTML = `
      <button class="icon-btn ride-star-btn active" title="${isDivider ? "Remove divider" : isParkStatus ? "Remove park status" : "Remove ride"}">&#9733;</button>
      <span class="ride-name" title="${escapeHtml(rideName)}">${escapeHtml(rideName)}</span>
      <span class="row-actions">
        ${
          !model.filter
            ? `<button class="icon-btn drag-handle" title="Drag to reorder">&#10303;</button>`
            : ""
        }
      </span>
    `;
    row.querySelector(".ride-star-btn").addEventListener("click", () => {
      model.selected.splice(index, 1);
      state.ridesByParkId[id] = model.selected;
      saveState();
      renderRidePicker();
    });

    if (!model.filter) {
      row.classList.add("draggable-row");
      makeRowDraggable(
        row,
        row.querySelector(".drag-handle"),
        model.selected,
        index,
        (commit = true) => {
          state.ridesByParkId[id] = model.selected;
          if (!commit) return;
          saveState();
          renderRidePicker();
        },
        { boundToDraggableSection: true }
      );
    }

    list.appendChild(row);
  });

  model.availableSpecialItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "picker-row add-favorite-ride-row";
    row.innerHTML = `
      <button class="icon-btn ride-star-btn" title="Add park status">&#9734;</button>
      <span class="ride-name" title="Park Status">[Add Park Status]</span>
      <span></span>
    `;
    const addParkStatus = () => {
      model.selected.push(item);
      state.ridesByParkId[id] = model.selected;
      saveState();
      renderRidePicker();
    };
    row.querySelector(".ride-star-btn").addEventListener("click", addParkStatus);
    row.querySelector(".ride-name").addEventListener("click", addParkStatus);
    list.appendChild(row);
  });

  if (!model.filter) {
    const addDividerRow = document.createElement("div");
    addDividerRow.className = "picker-row add-divider-row";
    addDividerRow.innerHTML = `
      <button class="icon-btn" title="Add divider">&#9734;</button>
      <span class="ride-name">[Add Divider]</span>
      <span></span>
    `;
    addDividerRow.addEventListener("click", () => {
      model.selected.push({ type: "divider", title: "Divider" });
      state.ridesByParkId[id] = model.selected;
      saveState();
      renderRidePicker();
    });
    list.appendChild(addDividerRow);
  }

  model.availableRides.forEach((ride) => {
    const row = document.createElement("div");
    row.className = "picker-row add-favorite-ride-row";
    row.innerHTML = `
      <button class="icon-btn ride-star-btn" title="Add ride">&#9734;</button>
      <span class="ride-name" title="${escapeHtml(ride.name)}">${escapeHtml(ride.name)}</span>
      <span></span>
    `;
    const addRide = () => {
      model.selected.push(ride.name);
      state.ridesByParkId[id] = model.selected;
      saveState();
      renderRidePicker();
    };
    row.querySelector(".ride-star-btn").addEventListener("click", addRide);
    row.querySelector(".ride-name").addEventListener("click", addRide);
    list.appendChild(row);
  });

  if (
    model.selectedMatches.length === 0 &&
    model.availableSpecialItems.length === 0 &&
    model.availableRides.length === 0
  ) {
    list.innerHTML = `<div class="muted">No rides found.</div>`;
  }
}

function renderCustomRidePicker() {
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

  rides.forEach((ride) => {
    const selectedIndex = Shared.customRideIndex(
      state,
      activeCustomListId,
      ride.parkId,
      ride.name
    );
    const isSelected = selectedIndex !== -1;
    const isParkStatus = Shared.isParkStatusItem(ride);
    const label = isParkStatus
      ? isSelected ? "Park Status" : "[Add Park Status]"
      : ride.name;
    const title = isParkStatus ? "Park Status" : ride.name;
    const row = document.createElement("div");
    row.className = isSelected ? "picker-row selected" : "picker-row add-favorite-ride-row";
    row.innerHTML = `
      <button class="icon-btn ride-star-btn ${isSelected ? "active" : ""}">
        ${isSelected ? "&#9733;" : "&#9734;"}
      </button>
      <span class="ride-name" title="${escapeHtml(title)}">${escapeHtml(label)}</span>
      <span></span>
    `;
    const toggleAndRender = () => {
      const wasSelected = Shared.customRideIndex(
        state,
        activeCustomListId,
        ride.parkId,
        ride.name
      ) !== -1;
      Shared.toggleCustomRide(state, activeCustomListId, ride);
      if (!wasSelected && draftCustomListId === activeCustomListId) {
        draftCustomListChanged = true;
      }
      saveState();
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
  });

  if (rides.length === 0) {
    list.innerHTML = `<div class="muted">No rides found.</div>`;
  }
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
    empty.textContent = "No rides selected for this custom list.";
    list.appendChild(empty);
  }

  rides.forEach((ride, index) => {
    const row = document.createElement("div");
    row.className = "order-row draggable-row";
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
      <button class="icon-btn drag-handle" title="Drag to reorder">&#10303;</button>
    `;

    makeRowDraggable(
      row,
      row.querySelector(".drag-handle"),
      rides,
      index,
      (commit = true) => {
        state.customParkRides[activeCustomListId] = rides;
        if (!commit) return;
        saveState();
        renderCustomRideOrder();
      }
    );

    row.querySelector(".small-btn").addEventListener("click", () => {
      rides.splice(index, 1);
      state.customParkRides[activeCustomListId] = rides;
      saveState();
      renderCustomRideOrder();
    });

    list.appendChild(row);
  });

  const addDividerRow = document.createElement("div");
  addDividerRow.className = "order-row add-divider-row custom-order-add-divider-row";
  addDividerRow.innerHTML = `
    <span></span>
    <span class="ride-name">[Add Divider]</span>
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
}

function deleteCustomList(id) {
  clearDraftCustomList(id);

  state.customParks = state.customParks.filter((park) => park.id !== id);
  state.favoriteParkIds = state.favoriteParkIds.filter((parkId) => parkId !== id);
  state.parkOrder = state.parkOrder.filter((parkId) => parkId !== id);
  delete state.parkNamesById[id];
  delete state.customParkRides[id];

  if (state.currentParkId === id) {
    state.currentParkId = state.parkOrder[0] || null;
  }

  if (state.homeParkId === id) {
    state.homeParkId = null;
  }

  saveState();
  updateHomeButtonState();
  showView("parkPicker");
  renderParkPicker();
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

function clearParkSwipeClasses() {
  $("mainView").classList.remove(
    "park-swipe-animating",
    "park-swipe-exit-left",
    "park-swipe-exit-right",
    "park-swipe-enter-left",
    "park-swipe-enter-right"
  );
}

function applyParkCycle(nextParkId) {
  state.currentParkId = nextParkId;
  saveState();
  loadWaitTimes();
}

function animateParkCycle(direction, nextParkId) {
  if (isParkSwipeAnimating) return;

  const mainView = $("mainView");
  const exitClass = direction > 0 ? "park-swipe-exit-left" : "park-swipe-exit-right";
  const enterClass = direction > 0 ? "park-swipe-enter-right" : "park-swipe-enter-left";

  isParkSwipeAnimating = true;
  clearTimeout(parkSwipeTimer);
  clearParkSwipeClasses();

  mainView.classList.add("park-swipe-animating", exitClass);

  parkSwipeTimer = setTimeout(() => {
    applyParkCycle(nextParkId);

    clearParkSwipeClasses();
    mainView.classList.add(enterClass);
    mainView.getBoundingClientRect();
    mainView.classList.add("park-swipe-animating");
    mainView.classList.remove(enterClass);

    parkSwipeTimer = setTimeout(() => {
      clearParkSwipeClasses();
      isParkSwipeAnimating = false;
    }, PARK_SWIPE_PHASE_MS);
  }, PARK_SWIPE_PHASE_MS);
}

function cyclePark(direction, options = {}) {
  if (state.parkOrder.length === 0) return;

  const id = currentParkId();
  const index = Math.max(0, state.parkOrder.indexOf(id));
  const nextIndex = (index + direction + state.parkOrder.length) % state.parkOrder.length;
  const nextParkId = state.parkOrder[nextIndex];

  if (
    options.animate &&
    !prefersReducedMotion() &&
    !views.main.classList.contains("hidden")
  ) {
    animateParkCycle(direction, nextParkId);
    return;
  }

  applyParkCycle(nextParkId);
}

function goHomePark() {
  if (!state.homeParkId) return;
  state.currentParkId = state.homeParkId;
  saveState();
  loadWaitTimes();
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;

  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden", "fading");

  toastTimer = setTimeout(() => {
    toast.classList.add("fading");
    toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
      toast.classList.remove("fading");
    }, 250);
  }, 1500);
}

function showHomeConfirmSheet() {
  const id = currentParkId();
  if (!id) return false;

  const name = currentParkName();
  $("homeConfirmText").textContent = `Set '${name}' as your Home Park?`;
  $("homeConfirmOverlay").classList.remove("hidden");
  return true;
}

function hideHomeConfirmSheet() {
  $("homeConfirmOverlay").classList.add("hidden");
}

function confirmSetHomePark() {
  const id = currentParkId();
  if (!id) return;

  state.homeParkId = id;
  state.parkNamesById[id] = currentParkName();

  if (!state.favoriteParkIds.includes(id)) {
    state.favoriteParkIds.push(id);
  }

  if (!state.parkOrder.includes(id)) {
    state.parkOrder.push(id);
  }

  saveState();
  updateHomeButtonState();
  hideHomeConfirmSheet();
  showToast("Home Park updated.");
}

function clearHomeLongPress() {
  clearTimeout(homeLongPressTimer);
  homeLongPressTimer = null;
  $("homeBtn").classList.remove("long-pressing");
}

function startHomeLongPress(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!currentParkId()) return;

  homeLongPressRecognized = false;
  homeLongPressStartX = event.clientX;
  homeLongPressStartY = event.clientY;
  clearHomeLongPress();
  $("homeBtn").classList.add("long-pressing");

  homeLongPressTimer = setTimeout(() => {
    homeLongPressRecognized = true;
    clearHomeLongPress();
    if (showHomeConfirmSheet()) {
      triggerLongPressHaptic();
    }
  }, 700);
}

function cancelHomeLongPress(navigateHome = false) {
  const shouldNavigate =
    navigateHome &&
    Boolean(homeLongPressTimer) &&
    !homeLongPressRecognized;

  clearHomeLongPress();

  if (shouldNavigate) {
    goHomePark();
  }
}

function moveHomeLongPress(event) {
  if (!homeLongPressTimer) return;

  const deltaX = event.clientX - homeLongPressStartX;
  const deltaY = event.clientY - homeLongPressStartY;

  if (Math.hypot(deltaX, deltaY) > 10) {
    cancelHomeLongPress();
  }
}

function clearSettingsLongPress() {
  clearTimeout(settingsLongPressTimer);
  settingsLongPressTimer = null;
}

async function configureCurrentPark() {
  const id = currentParkId();
  if (!id) return false;

  setNavigationReturnTarget("home");

  if (Shared.isCustomParkId(id)) {
    showCustomRideMenu(id);
    return true;
  }

  await loadRidePicker(id);
  return true;
}

function startSettingsLongPress(event) {
  settingsLongPressRecognized = false;
  settingsLongPressStartX = event.clientX;
  settingsLongPressStartY = event.clientY;
  clearSettingsLongPress();

  settingsLongPressTimer = setTimeout(() => {
    settingsLongPressRecognized = true;
    clearSettingsLongPress();
    configureCurrentPark().then((didConfigure) => {
      if (didConfigure) triggerLongPressHaptic();
    });
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

function handleHomeTap(event) {
  if (homeLongPressRecognized) {
    event.preventDefault();
    event.stopPropagation();
    homeLongPressRecognized = false;
    return;
  }

  goHomePark();
}

function handleParkPickerBack() {
  returnToHomeView();
}

function handleCustomRideMenuBack() {
  leaveCustomRideMenu();
}

function handleCustomSourceParkBack() {
  showCustomRideMenu(activeCustomListId);
}

function handleCustomRideOrderBack() {
  if (activeCustomListId) {
    showCustomRideMenu(activeCustomListId);
    return;
  }

  showView("parkPicker");
  renderParkPicker();
}

function handleRidePickerBack() {
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
}

function closeTopPopup() {
  if (!$("homeConfirmOverlay").classList.contains("hidden")) {
    hideHomeConfirmSheet();
    return true;
  }

  if (!$("parkOverflowMenu").classList.contains("hidden")) {
    closeParkOverflowMenu();
    return true;
  }

  return false;
}

function minimizeAndroidApp() {
  const appPlugin = capacitorAppPlugin();
  if (appPlugin?.minimizeApp) {
    appPlugin.minimizeApp();
  }
}

function handleNativeBackButton() {
  if (closeTopPopup()) return;

  switch (currentViewName()) {
    case "parkPicker":
      handleParkPickerBack();
      break;
    case "ridePicker":
      handleRidePickerBack();
      break;
    case "customRideMenu":
      handleCustomRideMenuBack();
      break;
    case "customSourceParkPicker":
      handleCustomSourceParkBack();
      break;
    case "customRideOrder":
      handleCustomRideOrderBack();
      break;
    case "settings":
    case "about":
      returnToParkPicker();
      break;
    default:
      minimizeAndroidApp();
      break;
  }
}

function registerNativeBackButton() {
  if (!window.Capacitor?.isNativePlatform?.()) return;

  const appPlugin = capacitorAppPlugin();
  if (!appPlugin?.addListener) return;

  appPlugin.addListener("backButton", handleNativeBackButton);
}

$("settingsBtn").addEventListener("pointerdown", startSettingsLongPress);
$("settingsBtn").addEventListener("pointermove", moveSettingsLongPress);
$("settingsBtn").addEventListener("pointerup", cancelSettingsLongPress);
$("settingsBtn").addEventListener("pointerleave", cancelSettingsLongPress);
$("settingsBtn").addEventListener("pointercancel", cancelSettingsLongPress);
$("settingsBtn").addEventListener("click", handleSettingsTap);
$("parkPickerBackBtn").addEventListener("click", handleParkPickerBack);
$("parkOverflowBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleParkOverflowMenu();
});
$("parkSettingsMenuBtn").addEventListener("click", () => {
  closeParkOverflowMenu();
  showSettingsPage();
});
$("parkAboutMenuBtn").addEventListener("click", () => {
  closeParkOverflowMenu();
  showAboutPage();
});
bindFilterClear("parkFilter", renderParkPicker);
$("sourceStatus").addEventListener("click", (event) => {
  if ($("sourceStatus").getAttribute("href") === "#") event.preventDefault();
});
$("homeBtn").addEventListener("pointerdown", startHomeLongPress);
$("homeBtn").addEventListener("pointermove", moveHomeLongPress);
$("homeBtn").addEventListener("pointerup", () => cancelHomeLongPress(true));
$("homeBtn").addEventListener("pointerleave", cancelHomeLongPress);
$("homeBtn").addEventListener("pointercancel", cancelHomeLongPress);
$("homeBtn").addEventListener("click", handleHomeTap);
$("homeBtn").addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
$("homeConfirmCancelBtn").addEventListener("click", hideHomeConfirmSheet);
$("homeConfirmSetBtn").addEventListener("click", confirmSetHomePark);
$("homeConfirmOverlay").addEventListener("click", (event) => {
  if (event.target === $("homeConfirmOverlay")) {
    hideHomeConfirmSheet();
  }
});

$("settingsBackBtn").addEventListener("click", returnToParkPicker);
$("aboutBackBtn").addEventListener("click", returnToParkPicker);
$("themeLightBtn").addEventListener("click", () => applyTheme("light"));
$("themeDarkBtn").addEventListener("click", () => applyTheme("dark"));
$("timeFormat12Btn").addEventListener("click", () => applyTimeFormat("12h"));
$("timeFormat24Btn").addEventListener("click", () => applyTimeFormat("24h"));
$("waitListTextSmallBtn").addEventListener("click", () => applyWaitListTextSize("small"));
$("waitListTextLargeBtn").addEventListener("click", () => applyWaitListTextSize("large"));

$("aboutQueueTimesLink").addEventListener("click", (event) => {
  event.preventDefault();
  openExternalUrl($("aboutQueueTimesLink").href);
});

$("customRideMenuBackBtn").addEventListener("click", handleCustomRideMenuBack);
$("customRideMenuTitle").addEventListener("click", startCustomMenuTitleRename);
$("customAddRidesBtn").addEventListener("click", () => {
  if (activeCustomListId) loadCustomSourceParkPicker(activeCustomListId);
});
$("customReorderRidesBtn").addEventListener("click", () => {
  if (activeCustomListId) showCustomRideOrder(activeCustomListId);
});
$("customDeleteListBtn").addEventListener("click", () => {
  if (!activeCustomListId) return;
  const park = customParkById(activeCustomListId);
  if (!park) return;

  if (!deleteCustomListArmed) {
    deleteCustomListArmed = true;
    $("customDeleteListBtn").querySelector(".menu-label").textContent =
      `Confirm Delete ${park.name}?`;
    return;
  }

  deleteCustomList(activeCustomListId);
});

$("customSourceParkBackBtn").addEventListener("click", handleCustomSourceParkBack);
bindFilterClear("customSourceParkFilter", renderCustomSourceParkPicker);
$("customRideOrderBackBtn").addEventListener("click", handleCustomRideOrderBack);
$("ridePickerBackBtn").addEventListener("click", handleRidePickerBack);
bindFilterClear("rideFilter", renderRidePicker);

document.addEventListener("click", (event) => {
  const menu = $("parkOverflowMenu");
  if (
    !menu ||
    menu.classList.contains("hidden") ||
    menu.contains(event.target) ||
    $("parkOverflowBtn").contains(event.target)
  ) {
    return;
  }

  closeParkOverflowMenu();
});

document.addEventListener("touchstart", (event) => {
  if ($("homeBtn").contains(event.target)) return;

  touchStartX = event.touches[0].clientX;
  touchStartY = event.touches[0].clientY;
  pullDistance = 0;
  pullGestureStartedAtTop =
    !views.main.classList.contains("hidden") &&
    !isPullRefreshing &&
    isHomeScrolledToTop();
});

document.addEventListener("touchmove", (event) => {
  if ($("homeBtn").contains(event.target)) return;
  if (views.main.classList.contains("hidden") || isPullRefreshing) return;
  if (!pullGestureStartedAtTop) return;

  const touch = event.touches[0];
  const diffX = touch.clientX - touchStartX;
  const diffY = touch.clientY - touchStartY;

  if (Math.abs(diffX) > Math.abs(diffY) || diffY <= 0 || !isHomeScrolledToTop()) {
    return;
  }

  pullDistance = Math.min(90, diffY);

  if (pullDistance > 24) {
    $("pullRefreshStatus").classList.add("visible");
    $("pullRefreshStatus").textContent =
      pullDistance >= 70 ? "Release to refresh" : "Pull to refresh";
  }
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if ($("homeBtn").contains(event.target)) return;
  if (views.main.classList.contains("hidden")) return;

  const touchEndX = event.changedTouches[0].clientX;
  const touchEndY = event.changedTouches[0].clientY;
  const diff = touchEndX - touchStartX;

  if (pullGestureStartedAtTop && (pullDistance >= 70 || touchEndY - touchStartY >= 70)) {
    isPullRefreshing = true;
    $("pullRefreshStatus").classList.add("visible");
    $("pullRefreshStatus").textContent = "Refreshing...";
    loadWaitTimes().finally(() => {
      isPullRefreshing = false;
      pullDistance = 0;
      pullGestureStartedAtTop = false;
      $("pullRefreshStatus").textContent = "Pull to refresh";
      $("pullRefreshStatus").classList.remove("visible");
    });
    return;
  }

  pullGestureStartedAtTop = false;
  $("pullRefreshStatus").classList.remove("visible");

  if (Math.abs(diff) < 60 || Math.abs(diff) < Math.abs(touchEndY - touchStartY)) return;

  cyclePark(diff < 0 ? 1 : -1, { animate: true });
});

document.addEventListener("touchcancel", () => {
  pullDistance = 0;
  pullGestureStartedAtTop = false;
  $("pullRefreshStatus").classList.remove("visible");
});

setInterval(updateSourceStatus, 10000);
registerNativeBackButton();
showView("main");
loadWaitTimes();
