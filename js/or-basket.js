/**
 * Phase C OR-basket helpers (freeze grammar).
 * SoT: docs/or-basket-phase-c-freeze.md · tokens: docs/uwtree-design-tokens.md
 */
(function () {
  "use strict";
  const S = window.AppState;

  const PILL_H = 31;
  const PILL_MIN_W = 120;
  const BASKET_PAD = 14;
  const PILL_GAP = 8;
  const BADGE_H = 16;
  const FOOT_H = 16;
  const TEASER = 3;

  function ensureState() {
    if (!S.orBasketExpanded) S.orBasketExpanded = new Set();
  }

  function clearExpanded() {
    ensureState();
    S.orBasketExpanded.clear();
  }

  function isExpanded(orNode) {
    ensureState();
    return S.orBasketExpanded.has(orNode.uid || orNode.id);
  }

  function toggleExpanded(orNode) {
    ensureState();
    const key = orNode.uid || orNode.id;
    if (S.orBasketExpanded.has(key)) S.orBasketExpanded.delete(key);
    else S.orBasketExpanded.add(key);
  }

  function courseWeight(id) {
    try {
      return PathFinder.getCourseWeight(id, S.courseIdToCourse);
    } catch (_) {
      return 0;
    }
  }

  function scoreColor(v) {
    if (v >= 80) return "var(--score-hi)";
    if (v >= 50) return "var(--score-mid)";
    return "var(--score-lo)";
  }

  function sortedCourseChildren(orNode) {
    const kids = (orNode.children || []).slice();
    kids.sort((a, b) => courseWeight(b.id) - courseWeight(a.id));
    return kids;
  }

  function topScoreChild(orNode) {
    const sorted = sortedCourseChildren(orNode);
    return sorted[0] || null;
  }

  function visibleChildren(orNode) {
    const sorted = sortedCourseChildren(orNode);
    if (isExpanded(orNode)) return sorted;
    return sorted.slice(0, TEASER);
  }

  function hiddenCount(orNode) {
    const n = (orNode.children || []).length;
    return Math.max(0, n - TEASER);
  }

  /** Children to walk during layout/draw under an OR basket. */
  function layoutChildren(orNode) {
    return visibleChildren(orNode);
  }

  /** Whether a course inside an OR should expand its prereq subtree (depth 2+ rule). */
  function shouldShowSubtree(orNode, courseNode) {
    const top = topScoreChild(orNode);
    return top && courseNode && top.uid === courseNode.uid;
  }

  function basketInnerHeight(visibleCount, showFoot) {
    const pills = visibleCount * PILL_H + Math.max(0, visibleCount - 1) * PILL_GAP;
    const foot = showFoot ? PILL_GAP + FOOT_H : 0;
    return BASKET_PAD + BADGE_H + PILL_GAP + pills + foot + BASKET_PAD;
  }

  function basketWidth() {
    return BASKET_PAD * 2 + PILL_MIN_W;
  }

  window.OrBasket = {
    PILL_H,
    PILL_MIN_W,
    BASKET_PAD,
    PILL_GAP,
    BADGE_H,
    FOOT_H,
    TEASER,
    ensureState,
    clearExpanded,
    isExpanded,
    toggleExpanded,
    courseWeight,
    scoreColor,
    sortedCourseChildren,
    topScoreChild,
    visibleChildren,
    hiddenCount,
    layoutChildren,
    shouldShowSubtree,
    basketInnerHeight,
    basketWidth,
  };
})();
