/**
 * Collapsed OR baskets for the Path Finder tree.
 * Path scoring stays in pathfinder.js. This module only decides which
 * sibling rows are visible and which course's subtree stays open.
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
    if (v >= 80) return "#008A05";
    if (v >= 50) return "#E07912";
    return "#C13515";
  }

  function nodeKey(n) {
    return window.Selection ? Selection.nodeKey(n) : n && (n.uid || n.id);
  }

  function sortedCourseChildren(orNode) {
    const kids = (orNode.children || []).slice();
    kids.sort((a, b) => courseWeight(b.id) - courseWeight(a.id));
    return kids;
  }

  /** Recommended course in this basket, when Path Finder is on. */
  function pickedChild(orNode) {
    if (!S.pathFocusActive || !S.currentSelection || !S.currentSelection.size) return null;
    return (orNode.children || []).find((c) => S.currentSelection.has(nodeKey(c))) || null;
  }

  function topScoreChild(orNode) {
    const sorted = sortedCourseChildren(orNode);
    return sorted[0] || null;
  }

  /**
   * Outbound edge + depth expand aim at the highest-score course (freeze 46:121).
   * Path Finder preference outline still uses pickedChild separately.
   */
  function aimChild(orNode) {
    return topScoreChild(orNode);
  }

  function orderedChildren(orNode) {
    return sortedCourseChildren(orNode);
  }

  function visibleChildren(orNode) {
    const sorted = sortedCourseChildren(orNode);
    if (isExpanded(orNode)) return sorted;
    const teaser = sorted.slice(0, TEASER);
    const picked = pickedChild(orNode);
    // Keep recommended visible in the collapsed teaser when it falls outside top 3
    if (picked && !teaser.some((c) => nodeKey(c) === nodeKey(picked))) {
      return [...teaser.slice(0, Math.max(0, TEASER - 1)), picked];
    }
    return teaser;
  }

  function hiddenCount(orNode) {
    const n = (orNode.children || []).length;
    return Math.max(0, n - TEASER);
  }

  function layoutChildren(orNode) {
    return visibleChildren(orNode);
  }

  /** Depth 2+: expand only the highest-score course's subtree by default. */
  function shouldShowSubtree(orNode, courseNode) {
    const top = topScoreChild(orNode);
    return !!(top && courseNode && nodeKey(top) === nodeKey(courseNode));
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
    aimChild,
    pickedChild,
    visibleChildren,
    hiddenCount,
    layoutChildren,
    shouldShowSubtree,
    basketWidth,
  };
})();
