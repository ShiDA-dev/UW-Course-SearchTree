/**
 * Compact prerequisite tree (Figma REVIEW D / Path Finder SoT).
 *
 * Visual grammar:
 * - OR baskets are rigid: pills pack with fixed 8px gaps (never split by subtrees)
 * - Only the aim (top-score) pill opens a deeper subtree
 * - Orthogonal fork-join edges with short stubs (~56px) into destination pills
 * - Stacked baskets use a tight inter-basket gap; no letterboxed column stretch
 */
(function () {
  "use strict";
  const S = window.AppState;
  const OB = window.OrBasket;

  function renderPrereqTree(container, root) {
    OrBasket.ensureState();

    const { scrollLeft, scrollTop, scrollWidth, clientWidth, scrollHeight, clientHeight } = container;
    const viewportCenterX = scrollLeft + clientWidth / 2;
    const viewportCenterY = scrollTop + clientHeight / 2;
    const contentCenterX = scrollWidth / 2;
    const contentCenterY = scrollHeight / 2;
    const offsetX = viewportCenterX - contentCenterX;
    const offsetY = viewportCenterY - contentCenterY;

    const existingSvg = container.querySelector("svg");
    if (existingSvg) existingSvg.remove();
    const { svg, g } = SvgUtils.makeSVG(container);

    const NODE_HEIGHT = OB.PILL_H;
    // REVIEW D SoT (101:508): column clear = 112 (f-a 56 + f-o 46 + arrow ~10)
    const EDGE_CLEAR = 112;
    const STUB_OUT = 56;
    const STUB_IN = 46;
    const interBasketGap = 28; // Figma stacked baskets ~39 incl. AND label air
    const intraGroupGap = OB.PILL_GAP;
    const CANVAS_PAD_X = 24;
    const CANVAS_PAD_Y = 20;
    const ARROW = 10;

    const parentMap = new Map();
    (function buildParentMap(n, p) {
      parentMap.set(n, p);
      (n.children || []).forEach((c) => buildParentMap(c, n));
    })(root, null);

    function isJunction(n) {
      return !!(n && (n.isGroup || (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-")));
    }

    function walkKids(node) {
      if (node.isGroup) return OB.layoutChildren(node);
      const p = parentMap.get(node);
      if (p && p.isGroup && !OB.shouldShowSubtree(p, node)) return [];
      return node.children || [];
    }

    /** Visible pills only — never the open subtree — for rigid basket packing. */
    function pillOnlyBounds(node) {
      const p = positions.get(node);
      if (!p) return { minY: Infinity, maxY: -Infinity };
      return { minY: p.y, maxY: p.y + NODE_HEIGHT };
    }

    /** Full walkKids subtree (used for basket-vs-basket / free-node separation). */
    function getSubtreeBounds(node) {
      let minY = Infinity;
      let maxY = -Infinity;
      (function collect(n) {
        const p = positions.get(n);
        if (p) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y + NODE_HEIGHT);
        }
        walkKids(n).forEach(collect);
      })(node);
      return { minY, maxY };
    }

    const positions = new Map();
    const widthById = new Map();
    let maxNodeWidth = OB.PILL_MIN_W;

    (function collect(n) {
      const rootN = n === root;
      const junction = isJunction(n);
      const label = junction ? "" : S.courseIdToCourse.get(n.id)?.course_id || n.id;
      let est = junction ? OB.basketWidth() : Math.max(OB.PILL_MIN_W, Math.min(160, 24 + label.length * 7 + 28));
      if (rootN) est = Math.max(est, OB.PILL_MIN_W);
      widthById.set(n.id + ":" + (n.uid || ""), est);
      widthById.set(n.id, est);
      if (!junction && est > maxNodeWidth) maxNodeWidth = est;
      for (const c of walkKids(n)) collect(c);
    })(root);

    function getWidth(node) {
      if (node.isGroup) return OB.basketWidth();
      const parent = parentMap.get(node);
      if (parent && parent.isGroup) return OB.PILL_MIN_W;
      return widthById.get(node.id + ":" + (node.uid || "")) || widthById.get(node.id) || maxNodeWidth;
    }

    const containerWidth = Math.max(300, Math.floor(container.clientWidth || container.getBoundingClientRect().width));
    // Pitch so basket-right → destination-left ≈ EDGE_CLEAR when dest is a pill.
    // AND junctions share their parent's column (Figma stacks AND siblings in one column).
    const levelGap = EDGE_CLEAR + OB.PILL_MIN_W;

    function isAndJunction(n) {
      return !!(n && (n.id || "").startsWith("and-"));
    }

    let maxDepth = 0;
    let yCursor = 40;
    function layout(node, col) {
      maxDepth = Math.max(maxDepth, col);
      const children = walkKids(node);
      let top = Infinity;
      let bottom = -Infinity;
      if (children.length) {
        for (const c of children) {
          // Column rules (REVIEW D):
          // - AND junctions share the parent's column (siblings stack, no empty AND column)
          // - OR-basket pills share the basket's column (no phantom pill column)
          // - Only course → prereq-basket advances a column
          let childCol;
          if (isAndJunction(c)) childCol = col;
          else if (node.isGroup) childCol = col;
          else childCol = col + 1;
          const p = layout(c, childCol);
          top = Math.min(top, p.y);
          bottom = Math.max(bottom, p.y);
        }
      }
      let y;
      if (children.length) y = (top + bottom) / 2;
      else {
        y = yCursor;
        yCursor += NODE_HEIGHT + interBasketGap;
      }
      const pos = { x: col * levelGap, y };
      positions.set(node, pos);
      return pos;
    }
    layout(root, 0);

    function packBasketPills(orNode, startYHint) {
      const ordered = OB.visibleChildren(orNode);
      if (!ordered.length) return null;
      const xs = ordered.map((c) => positions.get(c)?.x).filter((v) => v != null);
      const xCol = xs.length ? Math.min(...xs) : positions.get(orNode)?.x || 0;
      const startY =
        startYHint != null
          ? startYHint
          : Math.min(...ordered.map((c) => (positions.get(c) ? positions.get(c).y : 0)));
      ordered.forEach((c, i) => {
        const p = positions.get(c);
        if (!p) return;
        p.x = xCol;
        p.y = startY + i * (NODE_HEIGHT + intraGroupGap);
      });
      const mid = startY + ((ordered.length - 1) * (NODE_HEIGHT + intraGroupGap)) / 2;
      const op = positions.get(orNode);
      if (op) {
        op.x = xCol;
        op.y = mid;
      }
      return { xCol, startY, ordered, mid };
    }

    // Initial rigid pack — pills never inherit subtree height from layout().
    (function collectOr(n) {
      if (n.isGroup) packBasketPills(n);
      walkKids(n).forEach(collectOr);
    })(root);

    // Align each open subtree to its aim pill (subtree must not sit between sibling pills).
    function alignAimSubtrees(orNode) {
      const aim = OB.aimChild(orNode);
      if (!aim || !positions.has(aim)) return;
      const kids = walkKids(aim);
      if (!kids.length) return;
      const aimY = positions.get(aim).y;
      let minY = Infinity;
      let maxY = -Infinity;
      (function collect(n) {
        const p = positions.get(n);
        if (p) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y + NODE_HEIGHT);
        }
        walkKids(n).forEach(collect);
      })(aim);
      // Exclude the aim pill itself from the block shift measure of deeper nodes only
      let deepMin = Infinity;
      let deepMax = -Infinity;
      kids.forEach(function walk(n) {
        const p = positions.get(n);
        if (p) {
          deepMin = Math.min(deepMin, p.y);
          deepMax = Math.max(deepMax, p.y + NODE_HEIGHT);
        }
        walkKids(n).forEach(walk);
      });
      if (!isFinite(deepMin)) return;
      const deepMid = (deepMin + deepMax) / 2;
      const shift = aimY + NODE_HEIGHT / 2 - deepMid;
      if (Math.abs(shift) < 0.5) return;
      kids.forEach(function walk(n) {
        const p = positions.get(n);
        if (p) p.y += shift;
        walkKids(n).forEach(walk);
      });
    }
    (function visit(n) {
      if (n.isGroup) alignAimSubtrees(n);
      walkKids(n).forEach(visit);
    })(root);

    const allNodes = [];
    (function collect(n) {
      allNodes.push(n);
      walkKids(n).forEach(collect);
    })(root);

    // Separation units: OR baskets as one block; free course pills; skip raw intra-basket pills.
    function separationUnitsAtDepth(d) {
      const units = [];
      const seenBasket = new Set();
      for (const node of allNodes) {
        const p = positions.get(node);
        if (!p) continue;
        const depth = Math.round(p.x / levelGap);
        if (depth !== d) continue;
        const parent = parentMap.get(node);
        if (parent && parent.isGroup) {
          if (seenBasket.has(parent)) continue;
          seenBasket.add(parent);
          const pills = OB.visibleChildren(parent);
          if (!pills.length) continue;
          let minY = Infinity;
          let maxY = -Infinity;
          for (const pill of pills) {
            const b = pillOnlyBounds(pill);
            minY = Math.min(minY, b.minY);
            maxY = Math.max(maxY, b.maxY);
            // Include aim subtree in basket block so baskets don't overlap each other
            if (OB.shouldShowSubtree(parent, pill)) {
              const sb = getSubtreeBounds(pill);
              // subtree is in a deeper column; only expand vertical claim for this column's pack height via pills
              void sb;
            }
          }
          // Basket chrome: badge + foot estimated so stacked baskets don't collide
          const showFoot = (parent.children || []).length > OB.TEASER;
          const chromeTop = OB.BASKET_PAD + OB.BADGE_H + OB.PILL_GAP;
          const chromeBot = OB.BASKET_PAD + (showFoot ? OB.PILL_GAP + OB.FOOT_H : 0);
          units.push({
            kind: "basket",
            node: parent,
            minY: minY - chromeTop,
            maxY: maxY + chromeBot,
            shiftRoots: pills,
          });
        } else if (!isJunction(node)) {
          units.push({
            kind: "course",
            node,
            minY: p.y,
            maxY: p.y + NODE_HEIGHT,
            shiftRoots: [node],
          });
        }
      }
      return units;
    }

    function shiftBlock(roots, dy) {
      const seen = new Set();
      for (const rootN of roots) {
        (function walk(n) {
          if (seen.has(n)) return;
          seen.add(n);
          const p = positions.get(n);
          if (p) p.y += dy;
          walkKids(n).forEach(walk);
          // When shifting a basket, also move every visible pill's deeper aim subtree
          if (n.isGroup) {
            for (const pill of OB.visibleChildren(n)) walk(pill);
          }
        })(rootN);
      }
    }

    let iterations = 0;
    while (iterations < 6) {
      let changed = false;
      for (let d = 0; d <= maxDepth; d++) {
        const units = separationUnitsAtDepth(d);
        units.sort((a, b) => a.minY - b.minY);
        for (let i = 0; i < units.length - 1; i++) {
          const a = units[i];
          const b = units[i + 1];
          const overlap = a.maxY - b.minY;
          if (overlap > -interBasketGap) {
            const shift = overlap + interBasketGap;
            shiftBlock(b.shiftRoots, shift);
            // refresh b bounds roughly
            b.minY += shift;
            b.maxY += shift;
            changed = true;
          }
        }
      }
      if (!changed) break;
      iterations++;
    }

    // Final rigid re-pack so intra-basket gaps stay exactly PILL_GAP (fixes MATH 146↔115 class).
    (function finalPack(n) {
      if (n.isGroup) {
        const ordered = OB.visibleChildren(n);
        if (ordered.length) {
          const startY = Math.min(...ordered.map((c) => positions.get(c).y));
          packBasketPills(n, startY);
          alignAimSubtrees(n);
        }
      }
      walkKids(n).forEach(finalPack);
    })(root);

    const nominalContentWidth = (maxDepth + 1) * levelGap + Math.max(maxNodeWidth, OB.basketWidth()) + 10;
    function rawLeft(node) {
      const p = positions.get(node);
      return nominalContentWidth - (p.x + getWidth(node));
    }

    let rawMin = Infinity;
    let rawMax = -Infinity;
    (function spanVisible(n) {
      if (!isJunction(n) && positions.has(n)) {
        const x = rawLeft(n);
        const w = getWidth(n);
        const inBasket = !!(parentMap.get(n) && parentMap.get(n).isGroup);
        const pad = inBasket ? OB.BASKET_PAD : 0;
        rawMin = Math.min(rawMin, x - pad);
        rawMax = Math.max(rawMax, x + w + pad);
      }
      for (const c of walkKids(n)) spanVisible(c);
    })(root);

    let xShift = CANVAS_PAD_X;
    if (isFinite(rawMin) && rawMax > rawMin) {
      const contentW = rawMax - rawMin;
      const avail = Math.max(0, containerWidth - CANVAS_PAD_X * 2);
      if (contentW <= avail) xShift = (containerWidth - contentW) / 2 - rawMin;
      else xShift = CANVAS_PAD_X - rawMin;
    }
    function nodePos(node) {
      const p = positions.get(node);
      return { x: rawLeft(node) + xShift, y: p.y };
    }

    const groupNodes = [];
    (function collectGroups(n) {
      if (n.isGroup) groupNodes.push(n);
      for (const c of walkKids(n)) collectGroups(c);
    })(root);

    const groupBounds = new Map();
    let contentMaxY = 0;

    for (const node of groupNodes) {
      const visible = OB.visibleChildren(node);
      if (!visible.length) continue;
      let minY = Infinity;
      let maxY = -Infinity;
      let minXp = Infinity;
      let maxXp = -Infinity;
      for (const child of visible) {
        const pos = nodePos(child);
        const w = getWidth(child);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
        minXp = Math.min(minXp, pos.x);
        maxXp = Math.max(maxXp, pos.x + w);
      }
      if (!isFinite(minY)) continue;
      const pad = OB.BASKET_PAD;
      const showFoot = (node.children || []).length > OB.TEASER;
      const badgeBlock = OB.BADGE_H + OB.PILL_GAP;
      const footBlock = showFoot ? OB.PILL_GAP + OB.FOOT_H : 0;
      const rectX = minXp - pad;
      const rectY = minY - pad - badgeBlock;
      const rectWidth = Math.max(OB.basketWidth(), maxXp - minXp + pad * 2);
      const rectHeight = maxY - minY + pad * 2 + badgeBlock + footBlock;
      SvgUtils.rect(g, rectX, rectY, rectWidth, rectHeight, 8, "or-basket-bg");
      groupBounds.set(node, {
        minY: rectY,
        maxY: rectY + rectHeight,
        midX: rectX + rectWidth / 2,
        minX: rectX,
        maxX: rectX + rectWidth,
        midY: rectY + rectHeight / 2,
      });
      contentMaxY = Math.max(contentMaxY, rectY + rectHeight);

      const nCount = (node.children || []).length;
      const badgeLabel = `1 of ${nCount}`;
      const badgeW = Math.max(42, 16 + badgeLabel.length * 6);
      const badgeX = rectX + pad;
      const badgeY = rectY + pad;
      SvgUtils.rect(g, badgeX, badgeY, badgeW, OB.BADGE_H, 4, "or-badge");
      SvgUtils.svgText(g, badgeX + badgeW / 2, badgeY + OB.BADGE_H / 2, badgeLabel, "or-badge-text", "middle", "middle");

      if (showFoot) {
        const expanded = OB.isExpanded(node);
        const hidden = OB.hiddenCount(node);
        const footLabel = expanded ? "Show less" : `+${hidden} more`;
        const footY = rectY + rectHeight - pad - OB.FOOT_H / 2;
        const foot = SvgUtils.svgText(g, rectX + rectWidth / 2, footY, footLabel, "or-foot", "middle", "middle");
        foot.style.textDecoration = "underline";
        foot.style.cursor = "pointer";
        foot.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          OB.toggleExpanded(node);
          const displayRoot = Selection.getPrereqDisplayRoot();
          if (displayRoot) PrereqTree.render(container, displayRoot);
        });
      }
    }

    const andNodes = [];
    (function collectAnds(n) {
      if ((n.id || "").startsWith("and-")) andNodes.push(n);
      for (const c of n.children || []) collectAnds(c);
    })(root);

    for (const node of andNodes) {
      const children = (node.children || []).filter((c) => c.isGroup);
      for (let i = 0; i < children.length - 1; i++) {
        const bounds1 = groupBounds.get(children[i]);
        const bounds2 = groupBounds.get(children[i + 1]);
        if (bounds1 && bounds2) {
          const x = (bounds1.midX + bounds2.midX) / 2;
          const y = (bounds1.maxY + bounds2.minY) / 2;
          SvgUtils.svgText(g, x, y, "AND", "and-label", "middle", "middle");
        }
      }
    }

    const edgesFrag = document.createDocumentFragment();

    function courseAncestor(node) {
      let p = parentMap.get(node);
      while (p) {
        if (!isJunction(p)) return p;
        p = parentMap.get(p);
      }
      return null;
    }

    function addEdgePath(d, onPath) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("class", onPath ? "edge highlight-edge" : "edge");
      edgesFrag.appendChild(path);
    }

    function drawBasketRoutes() {
      const byTarget = new Map();
      for (const basket of groupNodes) {
        if (!groupBounds.has(basket)) continue;
        const target = courseAncestor(basket);
        if (!target || !positions.has(target)) continue;
        if (!byTarget.has(target)) byTarget.set(target, []);
        byTarget.get(target).push(basket);
      }

      for (const [target, baskets] of byTarget) {
        const tPos = nodePos(target);
        const targetLeft = tPos.x;
        const targetY = tPos.y + NODE_HEIGHT / 2;
        const sources = baskets.map((basket) => {
          const bounds = groupBounds.get(basket);
          const aim = OB.aimChild(basket);
          let y = bounds.midY;
          if (aim && positions.has(aim)) {
            const ap = nodePos(aim);
            y = ap.y + NODE_HEIGHT / 2;
          }
          return { x: bounds.maxX, y, basket };
        });
        const maxSourceX = Math.max(...sources.map((s) => s.x));
        const ys = sources.map((s) => s.y).concat([targetY]);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const tipX = targetLeft;
        const baseX = tipX - ARROW;
        // REVIEW D: stub-out ~56, stub-in ~46 — never park the spine at the source when clear is large
        let spineX = maxSourceX + STUB_OUT;
        const maxSpine = baseX - STUB_IN;
        if (maxSpine > maxSourceX + 12) spineX = Math.min(spineX, maxSpine);
        spineX = Math.max(spineX, maxSourceX + 12);
        spineX = Math.min(spineX, baseX - 4);

        const routeOn = S.pathFocusActive && baskets.some((b) => S.hasSelectedMap.get(b));
        for (const s of sources) {
          const on = S.pathFocusActive && !!S.hasSelectedMap.get(s.basket);
          addEdgePath(`M ${s.x} ${s.y} H ${spineX}`, on);
        }
        if (maxY - minY > 0.5) addEdgePath(`M ${spineX} ${minY} V ${maxY}`, routeOn);
        if (baseX > spineX + 0.5) addEdgePath(`M ${spineX} ${targetY} H ${baseX}`, routeOn);
        const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        head.setAttribute("points", `${tipX},${targetY} ${baseX},${targetY - 5} ${baseX},${targetY + 5}`);
        head.setAttribute("class", routeOn ? "edge-anchor highlight-anchor" : "edge-anchor");
        edgesFrag.appendChild(head);
      }
    }

    S.hasSelectedMap.clear();
    Selection.markHasSelected(root);
    drawBasketRoutes();

    const nodesFrag = document.createDocumentFragment();
    function drawNode(node) {
      const pos = positions.get(node) ? nodePos(node) : null;
      if (!pos) {
        for (const child of walkKids(node)) drawNode(child);
        return;
      }
      if (!isJunction(node)) {
        const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        nodeGroup.setAttribute("class", "clickable-node");
        nodeGroup.addEventListener("click", (e) => {
          e.preventDefault();
          S.navigateToCourse(node.id);
        });
        nodesFrag.appendChild(nodeGroup);

        const w = getWidth(node);
        const isRoot = node === root;
        const selected = !isRoot && S.pathFocusActive && S.currentSelection.has(Selection.nodeKey(node));
        const pillH = selected ? NODE_HEIGHT + 1 : NODE_HEIGHT;
        const pillY = selected ? pos.y - 0.5 : pos.y;
        let cls = "node";
        if (isRoot) cls += " node-target";
        else if (selected) cls += " highlight-node";
        SvgUtils.rect(nodeGroup, pos.x, pillY, w, pillH, 8, cls);
        if (S.pathFocusActive && !isRoot && !selected) nodeGroup.setAttribute("opacity", "0.7");

        const label = S.courseIdToCourse.get(node.id)?.course_id || node.id;
        const midY = pillY + pillH / 2;
        try {
          const wValue = OB.courseWeight(node.id);
          const st = SvgUtils.svgText(
            nodeGroup,
            selected ? pos.x + 14 : pos.x + 10,
            midY,
            String(Math.round(wValue)),
            "weight-text",
            "start",
            "middle"
          );
          st.setAttribute("fill", OB.scoreColor(wValue));
        } catch (_) {}
        SvgUtils.svgText(nodeGroup, pos.x + w - 10, midY, label, "node-label", "end", "middle");
      }
      for (const child of walkKids(node)) drawNode(child);
    }

    drawNode(root);
    g.appendChild(edgesFrag);
    g.appendChild(nodesFrag);

    let graphTop = Infinity;
    let graphBottom = contentMaxY;
    for (const b of groupBounds.values()) {
      graphTop = Math.min(graphTop, b.minY);
      graphBottom = Math.max(graphBottom, b.maxY);
    }
    for (const n of allNodes) {
      if (isJunction(n) || !positions.has(n)) continue;
      const p = nodePos(n);
      graphTop = Math.min(graphTop, p.y);
      graphBottom = Math.max(graphBottom, p.y + NODE_HEIGHT);
    }
    if (!isFinite(graphTop)) graphTop = 0;

    const canvasH = Math.max(542, Math.floor(container.clientHeight || 542));
    const contentH = Math.max(0, Math.max(graphBottom, contentMaxY) - graphTop);
    const fits = contentH + CANVAS_PAD_Y <= canvasH;
    const topShift = fits ? (canvasH - contentH) / 2 - graphTop : CANVAS_PAD_Y - graphTop;
    const height = fits ? canvasH : Math.ceil(contentH + CANVAS_PAD_Y * 2);

    let didAutoZoomPrereq = false;
    if (S.shouldAutoZoomPrereq) {
      S.prereqZoom = 1;
      S.shouldAutoZoomPrereq = false;
      didAutoZoomPrereq = true;
    }

    const zoom = Math.max(0.2, S.prereqZoom || 1);
    const viewBoxWidthP = containerWidth / zoom;
    const viewBoxHeightP = height / zoom;
    const viewBoxXP = (containerWidth - viewBoxWidthP) / 2;
    const viewBoxYP = (height - viewBoxHeightP) / 2;
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("viewBox", `${viewBoxXP} ${viewBoxYP} ${viewBoxWidthP} ${viewBoxHeightP}`);
    svg.setAttribute("width", String(containerWidth));
    svg.setAttribute("height", String(height));
    svg.style.width = "100%";
    svg.style.height = fits ? "100%" : "auto";
    g.setAttribute("transform", `translate(0,${topShift})`);

    SvgUtils.setupMinimap(container, svg, { contentWidth: containerWidth, contentHeight: height });

    requestAnimationFrame(() => {
      if (didAutoZoomPrereq) {
        SvgUtils.centerTree(container);
      } else {
        const newContentCenterX = container.scrollWidth / 2;
        const newContentCenterY = container.scrollHeight / 2;
        container.scrollLeft = Math.max(
          0,
          Math.min(container.scrollWidth - container.clientWidth, newContentCenterX + offsetX - container.clientWidth / 2)
        );
        container.scrollTop = Math.max(
          0,
          Math.min(container.scrollHeight - container.clientHeight, newContentCenterY + offsetY - container.clientHeight / 2)
        );
      }
    });
  }

  window.PrereqTree = {
    render: renderPrereqTree,
  };
})();
