/**
 * Shared application state for UW Course Search Tree.
 * All modules read/write through window.AppState (alias S).
 * Think of this like a Python module-level globals object.
 */
(function () {
  "use strict";

  const S = {
    // --- DOM refs (filled by initDom) ---
    statusEl: null,
    prereqContainer: null,
    futureContainer: null,
    prereqMinimapContainer: null,
    futureMinimapContainer: null,
    courseInput: null,
    searchBtn: null,
    futureDepthSelect: null,
    prereqDepthSelect: null,
    prereqZoomInBtn: null,
    prereqZoomOutBtn: null,
    prereqZoomResetBtn: null,
    futureZoomInBtn: null,
    futureZoomOutBtn: null,
    futureZoomResetBtn: null,
    suggestionsEl: null,
    searchHistoryEl: null,
    prefSelect: null,
    clearSelectionBtn: null,
    donationBtn: null,
    donationModal: null,
    modalCloseBtn: null,
    brandBtn: null,

    // --- Course data (from data/courses_data.json) ---
    courseIdToCourse: new Map(),
    prereqRows: [],
    metricsMedian: { liked: 0, easy: 0, useful: 0 },
    metricsMin: { liked: 0, easy: 0, useful: 0 },
    staticDataLoaded: false,

    // --- Tree session ---
    lastPrereqRoot: null,
    lastFutureRoot: null,
    currentCourseId: null,
    prereqZoom: 1.0,
    futureZoom: 1.0,
    shouldAutoZoomPrereq: false,
    shouldAutoZoomFuture: false,

    // --- Path selection highlight ---
    currentSelection: new Set(),
    hasSelectedMap: new Map(),
    // When true, prereq panel shows only the pathfinder-selected subtree
    pathFocusActive: false,

    // --- Search UI ---
    searchHistory: [],
    suggestionIndex: -1,
    suggestTimer: null,

    // --- Callbacks assigned by app.js (avoids circular load issues) ---
    navigateToCourse: null,
    performSearch: null,
    showTreeEmptyState: null,
    renderTrees: null,
  };

  S.initDom = function initDom() {
    S.statusEl = document.getElementById("status");
    S.prereqContainer = document.getElementById("prereq-tree");
    S.futureContainer = document.getElementById("future-tree");
    S.prereqMinimapContainer = document.getElementById("prereq-minimap");
    S.futureMinimapContainer = document.getElementById("future-minimap");
    S.courseInput = document.getElementById("course-input");
    S.searchBtn = document.getElementById("search-btn");
    S.futureDepthSelect = document.getElementById("future-depth");
    S.prereqDepthSelect = document.getElementById("prereq-depth");
    S.prereqZoomInBtn = document.getElementById("prereq-zoom-in-btn");
    S.prereqZoomOutBtn = document.getElementById("prereq-zoom-out-btn");
    S.prereqZoomResetBtn = document.getElementById("prereq-zoom-reset-btn");
    S.futureZoomInBtn = document.getElementById("future-zoom-in-btn");
    S.futureZoomOutBtn = document.getElementById("future-zoom-out-btn");
    S.futureZoomResetBtn = document.getElementById("future-zoom-reset-btn");
    S.suggestionsEl = document.getElementById("suggestions");
    S.searchHistoryEl = document.getElementById("search-history");
    S.prefSelect = document.getElementById("pref-select");
    S.clearSelectionBtn = document.getElementById("clear-selection-btn");
    S.donationBtn = document.getElementById("donation-btn");
    S.donationModal = document.getElementById("donation-modal");
    S.modalCloseBtn = document.getElementById("modal-close-btn");
    S.brandBtn = document.getElementById("brand");
  };

  window.AppState = S;
})();
