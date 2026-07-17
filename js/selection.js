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

  /**
   * Clone root, keeping only branches that contain a selected course.
   * Does not mutate the original tree (so Clear can re-show the full view).
   */
  function pruneToSelectedSubtree(root) {
    if (!root || !S.currentSelection.size) return root;

    S.hasSelectedMap = new Map();
    markHasSelected(root);

    function clonePruned(node) {
      if (!node || !S.hasSelectedMap.get(node)) return null;

      const kids = node.children || [];
      const prunedChildren = [];
      for (const c of kids) {
        const child = clonePruned(c);
        if (child) prunedChildren.push(child);
      }

      const copy = Object.assign({}, node);
      copy.children = prunedChildren;
      return copy;
    }

    return clonePruned(root) || root;
  }

  function getPrereqDisplayRoot() {
    if (!S.lastPrereqRoot) return null;
    if (!S.pathFocusActive || !S.currentSelection.size) return S.lastPrereqRoot;
    return pruneToSelectedSubtree(S.lastPrereqRoot);
  }

  window.Selection = {
    isCourseNode,
    nodeKey,
    computeSelection,
    markHasSelected,
    pruneToSelectedSubtree,
    getPrereqDisplayRoot,
  };
})();
