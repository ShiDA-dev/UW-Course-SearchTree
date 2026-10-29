/**
 * UW Course Search Tree — application entry point.
 *
 * Module map (load order in index.html):
 *   pathfinder.js          — recommended-path algorithm
 *   js/app-state.js        — shared state (like Python module globals)
 *   js/svg-utils.js        — SVG helpers + minimap
 *   js/selection.js        — path highlight helpers
 *   js/data.js             — load JSON + indexes
 *   js/tree-build.js       — build prereq / future tree structures
 *   js/tree-render-future.js — draw future-course SVG
 *   js/tree-render-prereq.js — draw prereq SVG (OR boxes, fan-in lines)
 *   js/search-ui.js        — suggestions (history UI removed)
 *   app.js (this file)     — wire UI events and orchestrate search
 */
(function () {
  "use strict";

  const S = window.AppState;
  S.initDom();

  function showTreeEmptyState(container, type) {
    if (!container) return;
    const msg =
      type === "prereq"
        ? "Search a course above to see its prerequisites and the recommended path."
        : "Search a course above to see what courses it unlocks.";
    container.innerHTML = `<div class="tree-empty" role="status">${msg}</div>`;
  }
  S.showTreeEmptyState = showTreeEmptyState;

  function isPathFinderOff() {
    return !S.prefSelect || S.prefSelect.value === "none";
  }

  const PREF_LABELS = {
    balanced: "Balanced",
    useful: "Useful",
    liked: "Liked",
    easy: "Easy",
  };

  function applyView() {
    const raw = (location.hash || "").replace(/^#/, "").trim().toLowerCase();
    const view = raw === "guide" || raw === "about" ? raw : "explore";
    document.body.dataset.view = view;
    const explore = document.getElementById("view-explore");
    const guide = document.getElementById("view-guide");
    const about = document.getElementById("view-about");
    if (explore) explore.hidden = view !== "explore";
    if (guide) guide.hidden = view !== "guide";
    if (about) about.hidden = view !== "about";
    document.querySelectorAll(".navlinks a").forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("data-view") === view);
    });
  }

  function syncPfChrome() {
    const pref = (S.prefSelect && S.prefSelect.value) || "balanced";
    document.body.dataset.pref = pref;
    document.querySelectorAll(".pf-chip").forEach((chip) => {
      const on = chip.getAttribute("data-pref") === pref;
      chip.classList.toggle("is-on", on);
      chip.setAttribute("aria-checked", on ? "true" : "false");
    });
    const banner = document.getElementById("mode-banner");
    if (banner) banner.hidden = pref === "none";
    const title = document.getElementById("mode-banner-title");
    if (title && PREF_LABELS[pref]) title.textContent = "Recommended path · " + PREF_LABELS[pref];
    const depth = Math.max(1, Math.min(3, Number(S.prereqDepthSelect && S.prereqDepthSelect.value) || 2));
    const depthLabel = document.getElementById("depth-label");
    if (depthLabel) depthLabel.textContent = String(depth);
    const minus = document.getElementById("depth-minus");
    const plus = document.getElementById("depth-plus");
    if (minus) minus.disabled = depth <= 1;
    if (plus) plus.disabled = depth >= 3;
    const courseTitle = document.getElementById("course-title");
    if (courseTitle && S.currentCourseId) courseTitle.textContent = S.currentCourseId;
  }

  function applyPathFinderNone() {
    S.pathFocusActive = false;
    S.currentSelection = new Set();
    if (S.prefSelect) S.prefSelect.value = "none";
    syncPfChrome();
    renderPrereqView();
  }

  function clearAll() {
    S.currentCourseId = null;
    S.lastPrereqRoot = null;
    S.lastFutureRoot = null;
    S.currentSelection = new Set();
    S.pathFocusActive = false;
    S.statusEl.textContent = "";
    S.prereqContainer.innerHTML = "";
    S.futureContainer.innerHTML = "";
    showTreeEmptyState(S.prereqContainer, "prereq");
    showTreeEmptyState(S.futureContainer, "future");
    S.prereqMinimapContainer.classList.remove("visible");
    S.futureMinimapContainer.classList.remove("visible");
    if (S.courseInput) S.courseInput.value = "";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    applyView();
    S.suggestionsEl.classList.remove("visible");
    S.suggestionsEl.innerHTML = "";
  }

  function renderPrereqView() {
    const root = Selection.getPrereqDisplayRoot();
    if (root) PrereqTree.render(S.prereqContainer, root);
  }

  function renderTrees(courseId, prereqIndex, reverseIndex) {
    if (window.OrBasket) OrBasket.clearExpanded();
    const prereqDepth = Math.max(1, Math.min(3, Number(S.prereqDepthSelect.value || 2)));
    if (S.prereqDepthSelect) S.prereqDepthSelect.value = String(prereqDepth);
    S.lastPrereqRoot = TreeBuild.buildPrereqHierarchy(courseId, prereqIndex, prereqDepth);
    const depth = Math.max(0, Math.min(4, Number(S.futureDepthSelect && S.futureDepthSelect.value || 0)));
    S.lastFutureRoot = TreeBuild.buildFutureHierarchy(courseId, reverseIndex, depth);
    const pref = (S.prefSelect && S.prefSelect.value) || "balanced";
    if (pref !== "none") {
      PathFinder.setPreference(pref);
      S.pathFocusActive = true;
      Selection.computeSelection();
    } else {
      S.pathFocusActive = false;
      S.currentSelection = new Set();
    }
    syncPfChrome();
    renderPrereqView();
    FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
  }
  S.renderTrees = renderTrees;

  function navigateToCourse(courseId) {
    S.prereqDepthSelect.value = "2";
    if (S.futureDepthSelect) S.futureDepthSelect.value = "2";
    S.prereqZoom = 1;
    S.futureZoom = 1;
    S.shouldAutoZoomPrereq = true;
    S.shouldAutoZoomFuture = true;

    const normalizedCourseId = AppData.normalizeCode(courseId);
    S.currentCourseId = normalizedCourseId;
    S.currentSelection = new Set();
    S.pathFocusActive = false;

    S.courseInput.value = "";
    S.suggestionsEl.classList.remove("visible");
    S.suggestionsEl.innerHTML = "";

    if (AppData.normalizeCode((location.hash || "").replace(/^#/, "")) !== normalizedCourseId) {
      location.hash = normalizedCourseId;
    } else {
      performSearch();
    }
  }
  S.navigateToCourse = navigateToCourse;

  function setPrereqZoom(z) {
    const minZ = 0.2,
      maxZ = 1.0;
    S.prereqZoom = Math.max(minZ, Math.min(maxZ, z));
    S.shouldAutoZoomPrereq = false;
    renderPrereqView();
  }

  function setFutureZoom(z) {
    const minZ = 0.2,
      maxZ = 1.0;
    S.futureZoom = Math.max(minZ, Math.min(maxZ, z));
    S.shouldAutoZoomFuture = false;
    if (S.lastFutureRoot) FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
  }

  async function performSearch() {
    const query = AppData.normalizeCode(S.currentCourseId || "");
    if (!query) {
      S.statusEl.textContent = "";
      S.prereqContainer.innerHTML = "";
      S.futureContainer.innerHTML = "";
      showTreeEmptyState(S.prereqContainer, "prereq");
      showTreeEmptyState(S.futureContainer, "future");
      S.prereqMinimapContainer.classList.remove("visible");
      S.futureMinimapContainer.classList.remove("visible");
      S.lastPrereqRoot = null;
      S.lastFutureRoot = null;
      return;
    }

    S.statusEl.textContent = "Searching...";

    if (!S.staticDataLoaded) {
      S.statusEl.textContent = "Loading data, please wait...";
      await AppData.loadData();
    }

    S.prereqContainer.innerHTML = "";
    S.futureContainer.innerHTML = "";
    S.lastPrereqRoot = null;
    S.lastFutureRoot = null;
    S.statusEl.textContent = "Building tree...";

    if (!S.courseIdToCourse.has(query)) {
      S.statusEl.textContent = `Course not found: ${query}`;
      showTreeEmptyState(S.prereqContainer, "prereq");
      showTreeEmptyState(S.futureContainer, "future");
      return;
    }

    const prereqIndex = AppData.buildIndexes();
    const reverseIndex = AppData.buildReverseIndex();

    PathFinder.updateMetrics({ median: S.metricsMedian, min: S.metricsMin });
    if (!isPathFinderOff()) {
      PathFinder.setPreference(S.prefSelect.value);
    }

    renderTrees(query, prereqIndex, reverseIndex);
    S.statusEl.textContent = "";
  }
  S.performSearch = performSearch;

  // --- Event wiring ---
  S.searchBtn.addEventListener("click", () => navigateToCourse(S.courseInput.value));
  S.courseInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (S.suggestionsEl.classList.contains("visible") && S.suggestionIndex >= 0) {
        const el = S.suggestionsEl.querySelectorAll(".item")[S.suggestionIndex];
        if (el) SearchUI.pickSuggestion(el.getAttribute("data-code"));
      } else {
        navigateToCourse(S.courseInput.value);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = S.suggestionsEl.querySelectorAll(".item");
      if (items.length) {
        e.preventDefault();
        if (e.key === "ArrowDown") S.suggestionIndex = (S.suggestionIndex + 1) % items.length;
        else S.suggestionIndex = (S.suggestionIndex - 1 + items.length) % items.length;
        SearchUI.renderSuggestions(S.courseInput.value);
      }
    } else if (e.key === "Escape") {
      S.suggestionsEl.classList.remove("visible");
      S.suggestionIndex = -1;
    }
  });
  S.courseInput.addEventListener("input", () => {
    S.suggestionIndex = -1;
    SearchUI.renderSuggestions(S.courseInput.value);
  });
  S.suggestionsEl.addEventListener("mousedown", (e) => {
    const target = e.target.closest(".item");
    if (target) SearchUI.pickSuggestion(target.getAttribute("data-code"));
  });

  S.futureDepthSelect.addEventListener("change", () => {
    if (S.currentCourseId) {
      S.shouldAutoZoomFuture = false;
      performSearch();
    }
  });

    if (S.prereqDepthSelect) {
    S.prereqDepthSelect.addEventListener("change", () => {
      syncPfChrome();
      if (S.currentCourseId) {
        S.shouldAutoZoomPrereq = false;
        performSearch();
      }
    });
  }

  const depthMinus = document.getElementById("depth-minus");
  const depthPlus = document.getElementById("depth-plus");
  if (depthMinus && S.prereqDepthSelect) {
    depthMinus.addEventListener("click", () => {
      const next = Math.max(1, Number(S.prereqDepthSelect.value || 2) - 1);
      S.prereqDepthSelect.value = String(next);
      S.prereqDepthSelect.dispatchEvent(new Event("change"));
    });
  }
  if (depthPlus && S.prereqDepthSelect) {
    depthPlus.addEventListener("click", () => {
      const next = Math.min(3, Number(S.prereqDepthSelect.value || 2) + 1);
      S.prereqDepthSelect.value = String(next);
      S.prereqDepthSelect.dispatchEvent(new Event("change"));
    });
  }

  document.querySelectorAll(".pf-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!S.prefSelect) return;
      S.prefSelect.value = chip.getAttribute("data-pref");
      S.prefSelect.dispatchEvent(new Event("change"));
    });
  });

  const headerSearch = document.getElementById("header-search");
  if (headerSearch) headerSearch.addEventListener("submit", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    renderPrereqView();
    if (S.lastFutureRoot) FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
  });

  if (S.prereqZoomInBtn) S.prereqZoomInBtn.addEventListener("click", () => setPrereqZoom(S.prereqZoom * 1.2));
  if (S.prereqZoomOutBtn) S.prereqZoomOutBtn.addEventListener("click", () => setPrereqZoom(S.prereqZoom / 1.2));
  if (S.prereqZoomResetBtn) {
    S.prereqZoomResetBtn.addEventListener("click", () => {
      S.shouldAutoZoomPrereq = true;
      renderPrereqView();
    });
  }
  if (S.futureZoomInBtn) S.futureZoomInBtn.addEventListener("click", () => setFutureZoom(S.futureZoom * 1.2));
  if (S.futureZoomOutBtn) S.futureZoomOutBtn.addEventListener("click", () => setFutureZoom(S.futureZoom / 1.2));
  if (S.futureZoomResetBtn) {
    S.futureZoomResetBtn.addEventListener("click", () => {
      S.shouldAutoZoomFuture = true;
      if (S.lastFutureRoot) FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
    });
  }

  if (S.prefSelect) {
    S.prefSelect.addEventListener("change", () => {
      if (isPathFinderOff()) {
        applyPathFinderNone();
        return;
      }
      S.pathFocusActive = true;
      PathFinder.setPreference(S.prefSelect.value);
      Selection.computeSelection();
      S.shouldAutoZoomPrereq = true;
      syncPfChrome();
      renderPrereqView();
    });
  }

  if (S.clearSelectionBtn) {
    S.clearSelectionBtn.addEventListener("click", () => {
      S.shouldAutoZoomPrereq = false;
      S.shouldAutoZoomFuture = false;
      applyPathFinderNone();
    });
  }

  if (S.donationBtn && S.donationModal && S.modalCloseBtn) {
    S.donationBtn.addEventListener("click", () => {
      S.donationModal.style.display = "flex";
    });
    S.modalCloseBtn.addEventListener("click", () => {
      S.donationModal.style.display = "none";
    });
    S.donationModal.addEventListener("click", (e) => {
      if (e.target === S.donationModal) S.donationModal.style.display = "none";
    });
  }

  if (S.brandBtn) {
    S.brandBtn.style.cursor = "pointer";
    S.brandBtn.setAttribute("title", "Reset page");
    S.brandBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearAll();
    });
  }

  window.addEventListener("hashchange", () => {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    const key = raw.toLowerCase();
    applyView();
    if (key === "guide" || key === "about") return;
    if (!raw || key === "explore") {
      if (!S.currentCourseId) {
        S.currentCourseId = "AMATH250";
        performSearch();
      }
      return;
    }
    S.currentCourseId = AppData.normalizeCode(raw);
    performSearch();
  });

  // Init — prototype starts on Explore · Prerequisites · Balanced (depth 2)
  AppData.loadData().then(() => {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    const key = raw.toLowerCase();
    if (S.prefSelect && !S.prefSelect.value) S.prefSelect.value = "balanced";
    if (S.prereqDepthSelect && !S.prereqDepthSelect.value) S.prereqDepthSelect.value = "2";
    applyView();
    syncPfChrome();
    if (key === "guide" || key === "about") {
      return;
    }
    if (!raw || key === "explore") {
      if (S.prereqDepthSelect) S.prereqDepthSelect.value = "2";
      if (S.futureDepthSelect) S.futureDepthSelect.value = "2";
      S.shouldAutoZoomPrereq = true;
      S.currentCourseId = "AMATH250";
      performSearch();
    } else {
      S.currentCourseId = AppData.normalizeCode(raw);
      performSearch();
    }
  });
})();
