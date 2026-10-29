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

  function isAndNode(node) {
    return !!node && String(node.id || "").startsWith("and-");
  }

  function isOrNode(node) {
    return !!(node && (node.isGroup || String(node.id || "").startsWith("or-")));
  }

  /** Course ids currently highlighted (stable across uid rebuilds). */
  function selectedCourseIds() {
    const ids = new Set();
    if (!S.lastPrereqRoot || !S.currentSelection || !S.currentSelection.size) return ids;
    (function walk(n) {
      if (isCourseNode(n) && S.currentSelection.has(nodeKey(n))) ids.add(n.id);
      for (const c of n.children || []) walk(c);
    })(S.lastPrereqRoot);
    return ids;
  }

  function computeSelection() {
    if (!S.lastPrereqRoot) {
      S.currentSelection = new Set();
      return;
    }
    S.currentSelection = PathFinder.computeSelection(S.lastPrereqRoot, S.courseIdToCourse);
  }

  /**
   * Path Finder with OR choices constrained to branches that contain a pinned
   * course_id. Used when only depth changes so picks stay stable while deeper
   * layers expand under the same recommended courses.
   */
  function selectWithPins(root, pinnedIds, courseMap) {
    const display = new Set();

    function subtreeHasPin(node) {
      if (!node) return false;
      if (isCourseNode(node) && pinnedIds.has(node.id)) return true;
      return (node.children || []).some(subtreeHasPin);
    }

    function approxCost(node, selectedIds, depth) {
      if (!node) return 0;
      if (isCourseNode(node)) {
        const ids = new Set(selectedIds);
        const isNew = !ids.has(node.id);
        const w = PathFinder.getCourseWeight(node.id, courseMap);
        let c = isNew ? 1 - w / 100 + PathFinder.pv(depth) : 0;
        ids.add(node.id);
        for (const ch of node.children || []) c += approxCost(ch, ids, depth + 1);
        return c;
      }
      if (isAndNode(node)) {
        let c = 0;
        const ids = new Set(selectedIds);
        for (const ch of node.children || []) c += approxCost(ch, ids, depth + 1);
        return c;
      }
      if (isOrNode(node)) {
        const kids = node.children || [];
        const pinnedKids = kids.filter(subtreeHasPin);
        const pool = pinnedKids.length ? pinnedKids : kids;
        let best = Infinity;
        for (const k of pool) best = Math.min(best, approxCost(k, selectedIds, depth + 1));
        return best === Infinity ? 0 : best;
      }
      return (node.children || []).reduce(
        (a, ch) => a + approxCost(ch, selectedIds, depth + 1),
        0
      );
    }

    function walk(node, selectedIds, depth) {
      if (!node) return { cost: 0, selectedIds: new Set(selectedIds || []) };

      if (isCourseNode(node)) {
        const weight = PathFinder.getCourseWeight(node.id, courseMap);
        const idsIn = new Set(selectedIds || []);
        const isNew = !idsIn.has(node.id);
        const baseCost = isNew ? 1 - weight / 100 : 0;
        const penalty = isNew ? PathFinder.pv(depth) : 0;
        let totalCost = baseCost + penalty;
        display.add(nodeKey(node));
        idsIn.add(node.id);
        let idsOut = idsIn;
        for (const c of node.children || []) {
          const res = walk(c, idsOut, depth + 1);
          totalCost += res.cost;
          idsOut = res.selectedIds;
        }
        return { cost: totalCost, selectedIds: idsOut };
      }

      if (isAndNode(node)) {
        let totalCost = 0;
        let ids = new Set(selectedIds || []);
        const kids = node.children || [];
        const scored = kids
          .map((c) => ({ child: c, cost: approxCost(c, ids, depth + 1) }))
          .sort((a, b) => b.cost - a.cost);
        for (const item of scored) {
          const res = walk(item.child, ids, depth + 1);
          totalCost += res.cost;
          ids = res.selectedIds;
        }
        return { cost: totalCost, selectedIds: ids };
      }

      if (isOrNode(node)) {
        const kids = node.children || [];
        const pinnedKids = kids.filter(subtreeHasPin);
        const pool = pinnedKids.length ? pinnedKids : kids;
        let best = null;
        for (const k of pool) {
          const snapshot = new Set(display);
          const res = walk(k, new Set(selectedIds || []), depth + 1);
          if (!best || res.cost < best.cost - 1e-6) {
            best = { cost: res.cost, selectedIds: res.selectedIds, snap: new Set(display) };
          }
          display.clear();
          for (const x of snapshot) display.add(x);
        }
        if (best) {
          display.clear();
          for (const x of best.snap) display.add(x);
          return { cost: best.cost, selectedIds: best.selectedIds };
        }
        return { cost: 0, selectedIds: new Set(selectedIds || []) };
      }

      let total = 0;
      let idsF = new Set(selectedIds || []);
      for (const c of node.children || []) {
        const res = walk(c, idsF, depth + 1);
        total += res.cost;
        idsF = res.selectedIds;
      }
      return { cost: total, selectedIds: idsF };
    }

    walk(root, new Set(), 0);
    return display;
  }

  /** Rematerialize selection from course_id pins after a depth-only rebuild. */
  function computeSelectionPreservingPins(pinnedIds) {
    if (!S.lastPrereqRoot) {
      S.currentSelection = new Set();
      return;
    }
    if (!pinnedIds || !pinnedIds.size) {
      computeSelection();
      return;
    }
    S.currentSelection = selectWithPins(S.lastPrereqRoot, pinnedIds, S.courseIdToCourse);
    if (!S.currentSelection.size) computeSelection();
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
    // Preference outlines the recommended courses. The collapsed baskets
    // (siblings, +N more) stay on screen — do not prune to the chain.
    if (!S.lastPrereqRoot) return null;
    return S.lastPrereqRoot;
  }

  window.Selection = {
    isCourseNode,
    nodeKey,
    computeSelection,
    computeSelectionPreservingPins,
    selectedCourseIds,
    markHasSelected,
    pruneToSelectedSubtree,
    getPrereqDisplayRoot,
  };
})();
