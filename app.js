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
 *   js/search-ui.js        — suggestions + search history
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

  function clearAll() {
    S.currentCourseId = null;
    S.lastPrereqRoot = null;
    S.lastFutureRoot = null;
    S.currentSelection = new Set();
    S.statusEl.textContent = "";
    S.prereqContainer.innerHTML = "";
    S.futureContainer.innerHTML = "";
    showTreeEmptyState(S.prereqContainer, "prereq");
    showTreeEmptyState(S.futureContainer, "future");
    S.prereqMinimapContainer.classList.remove("visible");
    S.futureMinimapContainer.classList.remove("visible");
    if (S.courseInput) S.courseInput.value = "";
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    S.suggestionsEl.classList.remove("visible");
    S.suggestionsEl.innerHTML = "";
    S.searchHistory = [];
    try {
      localStorage.removeItem("uw_search_history");
    } catch (_) {}
    SearchUI.renderSearchHistory();
  }

  function renderTrees(courseId, prereqIndex, reverseIndex) {
    const prereqDepth = Math.max(1, Math.min(100, Number(S.prereqDepthSelect.value || 99)));
    S.lastPrereqRoot = TreeBuild.buildPrereqHierarchy(courseId, prereqIndex, prereqDepth);
    const depth = Math.max(0, Math.min(4, Number(S.futureDepthSelect.value || 0)));
    S.lastFutureRoot = TreeBuild.buildFutureHierarchy(courseId, reverseIndex, depth);
    // Compute selection before first paint so we only render the prereq tree once
    Selection.computeSelection();
    PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
    FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
  }
  S.renderTrees = renderTrees;

  function navigateToCourse(courseId) {
    S.prereqDepthSelect.value = "1";
    S.futureDepthSelect.value = "1";
    S.prereqZoom = 1;
    S.futureZoom = 1;
    S.shouldAutoZoomPrereq = true;
    S.shouldAutoZoomFuture = true;
    if (S.prefSelect) {
      S.prefSelect.value = "balanced";
      PathFinder.setPreference("balanced");
    }

    const normalizedCourseId = AppData.normalizeCode(courseId);
    S.currentCourseId = normalizedCourseId;
    SearchUI.addToSearchHistory(normalizedCourseId);
    S.currentSelection = new Set();

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
    if (S.lastPrereqRoot) PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
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
    PathFinder.setPreference((S.prefSelect && S.prefSelect.value) || "balanced");

    renderTrees(query, prereqIndex, reverseIndex);
    S.statusEl.textContent = "Showing prerequisites for " + query + ".";
  }
  S.performSearch = performSearch;

  // --- Event wiring ---
  if (S.searchHistoryEl) {
    S.searchHistoryEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".history-item");
      if (btn) SearchUI.pickSuggestion(btn.getAttribute("data-code"));
    });
  }

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
      if (S.currentCourseId) {
        S.shouldAutoZoomPrereq = false;
        performSearch();
      }
    });
  }

  window.addEventListener("resize", () => {
    if (S.lastPrereqRoot) PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
    if (S.lastFutureRoot) FutureTree.render(S.futureContainer, S.lastFutureRoot, true);
  });

  if (S.prereqZoomInBtn) S.prereqZoomInBtn.addEventListener("click", () => setPrereqZoom(S.prereqZoom * 1.2));
  if (S.prereqZoomOutBtn) S.prereqZoomOutBtn.addEventListener("click", () => setPrereqZoom(S.prereqZoom / 1.2));
  if (S.prereqZoomResetBtn) {
    S.prereqZoomResetBtn.addEventListener("click", () => {
      S.shouldAutoZoomPrereq = true;
      if (S.lastPrereqRoot) PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
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
      PathFinder.setPreference(S.prefSelect.value);
      Selection.computeSelection();
      S.shouldAutoZoomPrereq = false;
      if (S.lastPrereqRoot) PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
    });
  }

  if (S.clearSelectionBtn) {
    S.clearSelectionBtn.addEventListener("click", () => {
      S.currentSelection = new Set();
      // Keep preference dropdown on current value (Clear only removes highlight)
      S.shouldAutoZoomPrereq = false;
      S.shouldAutoZoomFuture = false;
      if (S.lastPrereqRoot) PrereqTree.render(S.prereqContainer, S.lastPrereqRoot);
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
    const hash = AppData.normalizeCode((location.hash || "").replace(/^#/, ""));
    S.currentCourseId = hash;
    performSearch();
  });

  // Init
  AppData.loadData().then(() => {
    const hash = (location.hash || "").replace(/^#/, "").trim();
    if (S.prefSelect) {
      S.prefSelect.value = "balanced";
      PathFinder.setPreference("balanced");
    }
    if (hash) {
      S.currentCourseId = AppData.normalizeCode(hash);
      performSearch();
    } else {
      if (S.prereqDepthSelect) S.prereqDepthSelect.value = "2";
      if (S.futureDepthSelect) S.futureDepthSelect.value = "2";
      S.currentCourseId = "AMATH250";
      SearchUI.addToSearchHistory("AMATH250");
      performSearch();
    }
    SearchUI.loadSearchHistory();
  });
})();
