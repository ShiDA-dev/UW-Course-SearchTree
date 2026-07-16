/**
 * Recommended-path selection helpers (uses PathFinder).
 */
(function () {
  "use strict";
  const S = window.AppState;

  function isCourseNode(node) {
    return PathFinder.isCourseNode(node);
  }

  function nodeKey(n) {
    return n && (n.uid || n.id);
  }

  function computeSelection() {
    if (!S.lastPrereqRoot) {
      S.currentSelection = new Set();
      return;
    }
    S.currentSelection = PathFinder.computeSelection(S.lastPrereqRoot, S.courseIdToCourse);
  }

  function markHasSelected(node) {
    if (!node) return false;
    const children = node.children || [];
    let any = isCourseNode(node) && S.currentSelection.has(nodeKey(node));
    for (const c of children) {
      any = markHasSelected(c) || any;
    }
    S.hasSelectedMap.set(node, any);
    return any;
  }

  window.Selection = {
    isCourseNode,
    nodeKey,
    computeSelection,
    markHasSelected,
  };
})();
