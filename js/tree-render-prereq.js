/**
 * Render the prerequisite tree as SVG (Phase C OR freeze grammar):
 * - OR baskets: 1 of N badge, score-sorted pills, collapsed +N more / Show less
 * - No spider lines inside baskets; orthogonal fork-join outbound
 * - One arrowhead on the destination pill's left edge (none at AND hubs)
 * - Depth 2+: highest-score subtree default; that pill gets strong ink stroke
 * - AND centered H+V between stacked baskets
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
    const HORIZONTAL_GAP = 72;
    const interGroupGap = 48;
    const intraGroupGap = OB.PILL_GAP;

    const parentMap = new Map();
    (function buildParentMap(n, p) {
      parentMap.set(n, p);
      (n.children || []).forEach((c) => buildParentMap(c, n));
    })(root, null);

    function walkKids(node) {
      if (node.isGroup) return OB.layoutChildren(node);
      const p = parentMap.get(node);
      if (p && p.isGroup && !OB.shouldShowSubtree(p, node)) return [];
      return node.children || [];
    }

    const positions = new Map();
    const widthById = new Map();
    let maxNodeWidth = OB.PILL_MIN_W;

    (function collect(n) {
      const isRoot = n === root;
      const isJunction = (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-") || n.isGroup;
      const label = isJunction ? "" : S.courseIdToCourse.get(n.id)?.course_id || n.id;
      let est = isJunction ? OB.basketWidth() : Math.max(OB.PILL_MIN_W, Math.min(180, 24 + (label.length * 7) + 28));
      if (isRoot) est = Math.max(est, OB.PILL_MIN_W);
      widthById.set(n.id + ":" + (n.uid || ""), est);
      widthById.set(n.id, est);
      if (!isJunction && est > maxNodeWidth) maxNodeWidth = est;
      for (const c of walkKids(n)) collect(c);
    })(root);

    function getWidth(node) {
      if (node.isGroup) return OB.basketWidth();
      const parent = parentMap.get(node);
      if (parent && parent.isGroup) return OB.PILL_MIN_W;
      return widthById.get(node.id + ":" + (node.uid || "")) || widthById.get(node.id) || maxNodeWidth;
    }

    function computeMaxDepth(n) {
      const kids = walkKids(n);
      if (!kids.length) return 0;
      let md = 0;
      for (const c of kids) md = Math.max(md, 1 + computeMaxDepth(c));
      return md;
    }
    const maxDepthForWidth = computeMaxDepth(root);
    const containerWidth = Math.max(300, Math.floor(container.clientWidth || container.getBoundingClientRect().width));
    const sidePad = 24;
    let levelGap = HORIZONTAL_GAP;
    if (maxDepthForWidth > 0) {
      levelGap = Math.max(
        HORIZONTAL_GAP,
        Math.floor((containerWidth - sidePad * 2 - maxNodeWidth - OB.basketWidth()) / maxDepthForWidth)
      );
    }

    let maxDepth = 0;
    let yCursor = 40;
    function layout(node, depth) {
      maxDepth = Math.max(maxDepth, depth);
      const children = walkKids(node);
      let top = Infinity,
        bottom = -Infinity;
      if (children.length) {
        for (const c of children) {
          const p = layout(c, depth + 1);
          top = Math.min(top, p.y);
          bottom = Math.max(bottom, p.y);
        }
      }
      let y;
      if (children.length) y = (top + bottom) / 2;
      else {
        y = yCursor;
        yCursor += NODE_HEIGHT + interGroupGap;
      }
      const pos = { x: depth * levelGap, y };
      positions.set(node, pos);
      return pos;
    }
    layout(root, 0);

    // Compact each OR basket's visible pills into a tight vertical stack (same column x)
    const orGroupsForRestack = [];
    (function collectOr(n) {
      if (n.isGroup) orGroupsForRestack.push(n);
      walkKids(n).forEach(collectOr);
    })(root);
    for (const orNode of orGroupsForRestack) {
      const ordered = OB.visibleChildren(orNode);
      if (ordered.length < 1) continue;
      const xs = ordered.map((c) => positions.get(c)?.x).filter((v) => v != null);
      const xCol = xs.length ? Math.min(...xs) : positions.get(orNode)?.x || 0;
      const topChild = ordered[0];
      const topPos = topChild && positions.get(topChild);
      const startY = topPos ? topPos.y : Math.min(...ordered.map((c) => positions.get(c).y));
      ordered.forEach((c, i) => {
        const p = positions.get(c);
        if (!p) return;
        p.x = xCol;
        p.y = startY + i * (NODE_HEIGHT + intraGroupGap);
      });
      const mid = startY + ((ordered.length - 1) * (NODE_HEIGHT + intraGroupGap)) / 2;
      const op = positions.get(orNode);
      if (op) {
        op.x = Math.max(0, xCol - levelGap);
        op.y = mid;
      }
    }

    function getSubtreeBounds(node) {
      let minY = Infinity;
      let maxY = -Infinity;
      const subtreeNodes = [];
      (function collect(n) {
        subtreeNodes.push(n);
        walkKids(n).forEach(collect);
      })(node);
      for (const n of subtreeNodes) {
        const p = positions.get(n);
        if (p) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y + NODE_HEIGHT);
        }
      }
      return { minY, maxY };
    }

    const allNodes = [];
    (function collect(n) {
      allNodes.push(n);
      walkKids(n).forEach(collect);
    })(root);

    const nodesByDepth = new Map();
    for (const node of allNodes) {
      const p = positions.get(node);
      if (!p) continue;
      const depth = Math.round(p.x / levelGap);
      if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
      nodesByDepth.get(depth).push(node);
    }

    let iterations = 0;
    while (iterations < 5) {
      let changed = false;
      for (let d = 0; d <= maxDepth; d++) {
        const nodes = nodesByDepth.get(d) || [];
        if (nodes.length < 2) continue;
        nodes.sort((a, b) => (positions.get(a)?.y || 0) - (positions.get(b)?.y || 0));
        for (let i = 0; i < nodes.length - 1; i++) {
          const n1 = nodes[i];
          const n2 = nodes[i + 1];
          const p1 = parentMap.get(n1);
          const p2 = parentMap.get(n2);
          const isIntraGroup = p1 && p2 && p1 === p2 && p1.isGroup;
          const gap = isIntraGroup ? intraGroupGap : interGroupGap;
          const bounds1 = getSubtreeBounds(n1);
          const bounds2 = getSubtreeBounds(n2);
          if (!isFinite(bounds1.maxY) || !isFinite(bounds2.minY)) continue;
          const overlap = bounds1.maxY - bounds2.minY;
          if (overlap > -gap) {
            changed = true;
            const shift = overlap + gap;
            const subtreeToShift = [];
            (function collectSubtree(n) {
              subtreeToShift.push(n);
              walkKids(n).forEach(collectSubtree);
            })(n2);
            for (const n of subtreeToShift) {
              const p = positions.get(n);
              if (p) p.y += shift;
            }
          }
        }
      }
      if (!changed) break;
      iterations++;
    }

    const nominalContentWidth = (maxDepth + 1) * levelGap + Math.max(maxNodeWidth, OB.basketWidth()) + 10;
    function rawLeft(node) {
      const p = positions.get(node);
      return nominalContentWidth - (p.x + getWidth(node));
    }
    // Stretch column gaps so the leftmost basket and the target pill use the viewport width.
    // Pill sizes stay fixed; only the x positions move.
    let rawMin = Infinity;
    let rawMax = -Infinity;
    (function spanVisible(n) {
      const junction = n.isGroup || (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-");
      if (!junction && positions.has(n)) {
        const x = rawLeft(n);
        const w = getWidth(n);
        const inBasket = !!(parentMap.get(n) && parentMap.get(n).isGroup);
        const pad = inBasket ? OB.BASKET_PAD : 0;
        rawMin = Math.min(rawMin, x - pad);
        rawMax = Math.max(rawMax, x + w + pad);
      }
      for (const c of walkKids(n)) spanVisible(c);
    })(root);
    const sideInset = 8;
    let xScale = 1;
    let xShift = 0;
    if (isFinite(rawMin) && rawMax > rawMin) {
      const room = Math.max(rawMax - rawMin, containerWidth - sideInset * 2);
      xScale = room / (rawMax - rawMin);
      xShift = sideInset - rawMin * xScale;
      const scaledRight = rawMax * xScale + xShift;
      if (scaledRight > containerWidth - sideInset) xShift -= scaledRight - (containerWidth - sideInset);
    }
    function nodePos(node) {
      const p = positions.get(node);
      return { x: rawLeft(node) * xScale + xShift, y: p.y };
    }

    const groupNodes = [];
    (function collectGroups(n) {
      if (n.isGroup) groupNodes.push(n);
      for (const c of walkKids(n)) collectGroups(c);
    })(root);

    const groupBounds = new Map();
    let contentMaxY = yCursor;
    const basketMeta = new Map();

    for (const node of groupNodes) {
      const visible = OB.visibleChildren(node);
      if (!visible.length) continue;
      let minY = Infinity,
        maxY = -Infinity,
        minXp = Infinity,
        maxXp = -Infinity;
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
      groupBounds.set(node, { minY: rectY, maxY: rectY + rectHeight, midX: rectX + rectWidth / 2, minX: rectX, maxX: rectX + rectWidth, midY: rectY + rectHeight / 2 });
      basketMeta.set(node, { rectX, rectY, rectWidth, rectHeight, showFoot, visible });
      contentMaxY = Math.max(contentMaxY, rectY + rectHeight);

      // Badge top-left: 1 of N
      const nCount = (node.children || []).length;
      const badgeLabel = `1 of ${nCount}`;
      const badgeW = Math.max(42, 16 + badgeLabel.length * 6);
      const badgeX = rectX + pad;
      const badgeY = rectY + pad;
      SvgUtils.rect(g, badgeX, badgeY, badgeW, OB.BADGE_H, 6, "or-badge");
      SvgUtils.svgText(g, badgeX + badgeW / 2, badgeY + OB.BADGE_H / 2, badgeLabel, "or-badge-text", "middle", "middle");

      // Foot control
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

    // AND labels centered H+V in gutter between stacked OR baskets
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
        const junction = p.isGroup || (p.id || "").startsWith("and-") || (p.id || "").startsWith("or-");
        if (!junction) return p;
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

    // Baskets share one vertical spine into the nearest course pill.
    // Elbows only: H from the basket, V on the spine, H into the pill.
    // The arrow sits on that pill's left edge — never on an AND hub.
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
        let spineX = maxSourceX + Math.max(18, (targetLeft - maxSourceX) * 0.45);
        spineX = Math.min(spineX, targetLeft - 18);
        spineX = Math.max(spineX, maxSourceX + 8);

        const routeOn = S.pathFocusActive && baskets.some((b) => S.hasSelectedMap.get(b));
        for (const s of sources) {
          const on = S.pathFocusActive && !!S.hasSelectedMap.get(s.basket);
          addEdgePath(`M ${s.x} ${s.y} H ${spineX}`, on);
        }
        if (maxY - minY > 0.5) addEdgePath(`M ${spineX} ${minY} V ${maxY}`, routeOn);
        const tipX = targetLeft;
        const baseX = tipX - 9;
        if (baseX > spineX + 0.5) addEdgePath(`M ${spineX} ${targetY} H ${baseX}`, routeOn);
        const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        head.setAttribute("points", `${tipX},${targetY} ${baseX},${targetY - 4.5} ${baseX},${targetY + 4.5}`);
        head.setAttribute("class", routeOn ? "edge-anchor highlight-anchor" : "edge-anchor");
        edgesFrag.appendChild(head);
      }
    }

    S.hasSelectedMap.clear();
    Selection.markHasSelected(root);
    drawBasketRoutes();

    function drawNode(node) {
      const isJunction = (node.id || "").startsWith("and-") || (node.id || "").startsWith("or-") || node.isGroup;
      const pos = positions.get(node) ? nodePos(node) : null;
      if (!pos) {
        for (const child of walkKids(node)) drawNode(child);
        return;
      }
      if (!isJunction) {
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
        let cls = "node";
        if (isRoot) cls += " node-target";
        else if (selected) cls += " highlight-node";
        SvgUtils.rect(nodeGroup, pos.x, pos.y, w, NODE_HEIGHT, 8, cls);
        if (S.pathFocusActive && !isRoot && !selected) nodeGroup.setAttribute("opacity", "0.7");

        const label = S.courseIdToCourse.get(node.id)?.course_id || node.id;
        try {
          const wValue = OB.courseWeight(node.id);
          const scoreStr = String(Math.round(wValue));
          const st = SvgUtils.svgText(nodeGroup, pos.x + 10, pos.y + NODE_HEIGHT / 2, scoreStr, "weight-text", "start", "middle");
          st.setAttribute("fill", OB.scoreColor(wValue));
        } catch (_) {}
        SvgUtils.svgText(nodeGroup, pos.x + w - 10, pos.y + NODE_HEIGHT / 2, label, "node-label", "end", "middle");
      }
      for (const child of walkKids(node)) drawNode(child);
    }

    const nodesFrag = document.createDocumentFragment();
    drawNode(root);
    g.appendChild(edgesFrag);
    g.appendChild(nodesFrag);

    let graphTop = 0;
    for (const b of groupBounds.values()) graphTop = Math.min(graphTop, b.minY);
    const topShift = graphTop < 8 ? 8 - graphTop : 0;
    const height = contentMaxY + topShift + 20;
    const baseViewBoxWidth = containerWidth;
    const baseViewBoxHeight = height;
    let didAutoZoomPrereq = false;
    if (S.shouldAutoZoomPrereq) {
      S.prereqZoom = 1;
      S.shouldAutoZoomPrereq = false;
      didAutoZoomPrereq = true;
    }

    const zoom = Math.max(0.2, S.prereqZoom || 1);
    const viewBoxWidthP = baseViewBoxWidth / zoom;
    const viewBoxHeightP = baseViewBoxHeight / zoom;
    const viewBoxXP = (baseViewBoxWidth - viewBoxWidthP) / 2;
    const viewBoxYP = (baseViewBoxHeight - viewBoxHeightP) / 2;
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svg.setAttribute("viewBox", `${viewBoxXP} ${viewBoxYP} ${viewBoxWidthP} ${viewBoxHeightP}`);
    svg.setAttribute("width", String(containerWidth));
    svg.setAttribute("height", String(Math.max(120, Math.round(containerWidth * (viewBoxHeightP / viewBoxWidthP)))));
    svg.style.width = "100%";
    svg.style.height = "auto";
    g.setAttribute("transform", `translate(0,${topShift})`);

    SvgUtils.setupMinimap(container, svg, { contentWidth: baseViewBoxWidth, contentHeight: baseViewBoxHeight });

    requestAnimationFrame(() => {
      if (didAutoZoomPrereq) {
        SvgUtils.centerTree(container);
      } else {
        const newContentCenterX = container.scrollWidth / 2;
        const newContentCenterY = container.scrollHeight / 2;
        const targetScrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth, newContentCenterX + offsetX - container.clientWidth / 2));
        const targetScrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, newContentCenterY + offsetY - container.clientHeight / 2));
        container.scrollLeft = targetScrollLeft;
        container.scrollTop = targetScrollTop;
      }
    });
  }

  window.PrereqTree = {
    render: renderPrereqTree,
  };
})();
