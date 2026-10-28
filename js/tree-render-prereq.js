/**
 * Render the prerequisite tree as SVG (Phase C OR freeze + PROTO Balanced):
 * - OR baskets: 1 of N badge, score-sorted pills, collapsed +N more / Show less
 * - Orthogonal fork-join only; arrowheads on the OUTSIDE of the destination box
 * - Depth 2+: highest-score subtree default; that pill gets strong stroke
 * - AND centered H+V between stacked baskets
 * - Stable column gap + centered scene (Figma 121:520), not letterboxed stretch
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
    // Figma PROTO Balanced: basket 168, next column at 280 → 112px clear gap
    const HORIZONTAL_GAP = 112;
    const interGroupGap = 40;
    const intraGroupGap = OB.PILL_GAP;
    const SIDE_INSET = 32;

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
      let est = isJunction ? OB.basketWidth() : Math.max(OB.PILL_MIN_W, Math.min(180, 24 + label.length * 7 + 28));
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
    // Keep Figma column rhythm; only grow gap when the scene would otherwise overflow.
    const sceneNeed = maxDepthForWidth * HORIZONTAL_GAP + Math.max(maxNodeWidth, OB.basketWidth());
    let levelGap = HORIZONTAL_GAP;
    if (maxDepthForWidth > 0 && sceneNeed > containerWidth - SIDE_INSET * 2) {
      levelGap = Math.max(
        72,
        Math.floor((containerWidth - SIDE_INSET * 2 - Math.max(maxNodeWidth, OB.basketWidth())) / maxDepthForWidth)
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
      // OR baskets paint badge + pad above the first pill — include that chrome
      // so stacked 1-of-1 boxes don't visually overlap.
      if (node.isGroup && isFinite(minY)) {
        const chrome = OB.BASKET_PAD + OB.BADGE_H + OB.PILL_GAP;
        const foot = (node.children || []).length > OB.TEASER ? OB.PILL_GAP + OB.FOOT_H : 0;
        minY -= chrome;
        maxY += OB.BASKET_PAD + foot;
      }
      return { minY, maxY };
    }

    function shiftSubtree(node, dy) {
      if (!dy) return;
      (function walk(n) {
        const p = positions.get(n);
        if (p) p.y += dy;
        walkKids(n).forEach(walk);
      })(node);
    }

    function isCourseNode(n) {
      if (!n || n.isGroup) return false;
      const id = n.id || "";
      return !id.startsWith("and-") && !id.startsWith("or-");
    }

    // Align each basket's outbound Y with its parent COURSE pill — kills the
    // needless vertical jog before a straight H into the next box (Figma 121:520).
    // Never align under AND/OR junctions (that collapses stacked branches).
    function alignBasketExits(n) {
      for (const child of walkKids(n)) alignBasketExits(child);
      if (!isCourseNode(n)) return;
      const kids = walkKids(n).filter((c) => c.isGroup);
      const np = positions.get(n);
      if (!np || !kids.length) return;
      const wantY = np.y + NODE_HEIGHT / 2;
      for (const basket of kids) {
        const aim = OB.aimChild(basket);
        const ap = aim && positions.get(aim);
        const exitY = ap ? ap.y + NODE_HEIGHT / 2 : positions.get(basket)?.y;
        if (exitY == null) continue;
        shiftSubtree(basket, wantY - exitY);
      }
    }

    const allNodes = [];
    (function collect(n) {
      allNodes.push(n);
      walkKids(n).forEach(collect);
    })(root);

    function resolveCollisions() {
      const nodesByDepth = new Map();
      for (const node of allNodes) {
        const p = positions.get(node);
        if (!p) continue;
        const depth = Math.round(p.x / Math.max(1, levelGap));
        if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
        nodesByDepth.get(depth).push(node);
      }
      let iterations = 0;
      while (iterations < 6) {
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
            // Intra-basket rows only need pill height — subtree bounds would
            // shove siblings apart when a top-score row has a deep left tree.
            const bounds1 = isIntraGroup
              ? { minY: positions.get(n1).y, maxY: positions.get(n1).y + NODE_HEIGHT }
              : getSubtreeBounds(n1);
            const bounds2 = isIntraGroup
              ? { minY: positions.get(n2).y, maxY: positions.get(n2).y + NODE_HEIGHT }
              : getSubtreeBounds(n2);
            if (!isFinite(bounds1.maxY) || !isFinite(bounds2.minY)) continue;
            const overlap = bounds1.maxY - bounds2.minY;
            if (overlap > -gap) {
              changed = true;
              shiftSubtree(n2, overlap + gap);
            }
          }
        }
        if (!changed) break;
        iterations++;
      }
    }

    // Align for straight H, then resolve overlaps (and once more if align moved things).
    alignBasketExits(root);
    resolveCollisions();
    alignBasketExits(root);
    resolveCollisions();

    const nominalContentWidth = maxDepth * levelGap + Math.max(maxNodeWidth, OB.basketWidth()) + 10;
    function rawLeft(node) {
      const p = positions.get(node);
      return nominalContentWidth - (p.x + getWidth(node));
    }

    // Measure content span, then CENTER in the viewport (Figma scene), with
    // only a light stretch when the scene is wider than the panel.
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

    let xScale = 1;
    let xShift = SIDE_INSET;
    if (isFinite(rawMin) && rawMax > rawMin) {
      const contentW = rawMax - rawMin;
      const usable = Math.max(120, containerWidth - SIDE_INSET * 2);
      if (contentW > usable) {
        xScale = usable / contentW;
        xShift = SIDE_INSET - rawMin * xScale;
      } else {
        xScale = 1;
        xShift = SIDE_INSET + (usable - contentW) / 2 - rawMin;
      }
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
    // course node → owning OR basket (for outside-box arrow tips)
    const courseBasket = new Map();

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
        courseBasket.set(child, node);
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
      basketMeta.set(node, { rectX, rectY, rectWidth, rectHeight, showFoot, visible });
      contentMaxY = Math.max(contentMaxY, rectY + rectHeight);

      const nCount = (node.children || []).length;
      const badgeLabel = `1 of ${nCount}`;
      const badgeW = Math.max(42, 16 + badgeLabel.length * 6);
      const badgeX = rectX + pad;
      const badgeY = rectY + pad;
      SvgUtils.rect(g, badgeX, badgeY, badgeW, OB.BADGE_H, 6, "or-badge");
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

    function addArrow(tipX, tipY, onPath) {
      const baseX = tipX - 9;
      const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      head.setAttribute("points", `${tipX},${tipY} ${baseX},${tipY - 4.5} ${baseX},${tipY + 4.5}`);
      head.setAttribute("class", onPath ? "edge-anchor highlight-anchor" : "edge-anchor");
      edgesFrag.appendChild(head);
    }

    /**
     * Destination port = OUTSIDE of the container box (Figma):
     * - course inside an OR basket → left edge of that basket
     * - root / bare target pill → left edge of the pill
     */
    function destPort(target) {
      const tPos = nodePos(target);
      const basket = courseBasket.get(target);
      if (basket && groupBounds.has(basket)) {
        const b = groupBounds.get(basket);
        // Tip sits on the outer face of the basket stroke (not past it into cells).
        return { x: b.minX, y: tPos.y + NODE_HEIGHT / 2, kind: "basket" };
      }
      return { x: tPos.x, y: tPos.y + NODE_HEIGHT / 2, kind: "pill" };
    }

    // Baskets share one vertical spine into the destination box.
    // Elbows only: H from the basket, V on the spine, H to the tip.
    // Tip sits on the outside of the target box — never inside a course cell.
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
        const port = destPort(target);
        const tipX = port.x;
        const tipY = port.y;
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

        const routeOn = S.pathFocusActive && baskets.some((b) => S.hasSelectedMap.get(b));

        if (sources.length === 1) {
          const s = sources[0];
          const on = S.pathFocusActive && !!S.hasSelectedMap.get(s.basket);
          // Straight H when Y already matches (alignment pass); else H→V→H.
          if (Math.abs(s.y - tipY) < 0.75) {
            const baseX = tipX - 9;
            if (baseX > s.x + 0.5) addEdgePath(`M ${s.x} ${s.y} H ${baseX}`, on);
            addArrow(tipX, tipY, on);
          } else {
            const midX = (s.x + tipX) / 2;
            addEdgePath(`M ${s.x} ${s.y} H ${midX}`, on);
            addEdgePath(`M ${midX} ${s.y} V ${tipY}`, on);
            const baseX = tipX - 9;
            if (baseX > midX + 0.5) addEdgePath(`M ${midX} ${tipY} H ${baseX}`, on);
            addArrow(tipX, tipY, on);
          }
          continue;
        }

        const maxSourceX = Math.max(...sources.map((s) => s.x));
        const ys = sources.map((s) => s.y);
        const minY = Math.min(...ys, tipY);
        const maxY = Math.max(...ys, tipY);
        let spineX = maxSourceX + Math.max(18, (tipX - maxSourceX) * 0.45);
        spineX = Math.min(spineX, tipX - 18);
        spineX = Math.max(spineX, maxSourceX + 8);

        for (const s of sources) {
          const on = S.pathFocusActive && !!S.hasSelectedMap.get(s.basket);
          addEdgePath(`M ${s.x} ${s.y} H ${spineX}`, on);
        }
        if (maxY - minY > 0.5) addEdgePath(`M ${spineX} ${minY} V ${maxY}`, routeOn);
        const baseX = tipX - 9;
        if (baseX > spineX + 0.5) addEdgePath(`M ${spineX} ${tipY} H ${baseX}`, routeOn);
        addArrow(tipX, tipY, routeOn);
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
        const parent = parentMap.get(node);
        const selected = !isRoot && S.pathFocusActive && S.currentSelection.has(Selection.nodeKey(node));
        const isTopScore = parent && parent.isGroup && OB.topScoreChild(parent) === node;
        let cls = "node";
        if (isRoot) cls += " node-target";
        else if (selected) cls += " highlight-node";
        else if (isTopScore) cls += " stroke-strong";
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

    let graphTop = Infinity;
    let graphBottom = -Infinity;
    for (const b of groupBounds.values()) {
      graphTop = Math.min(graphTop, b.minY);
      graphBottom = Math.max(graphBottom, b.maxY);
    }
    for (const n of allNodes) {
      if (n.isGroup || (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-")) continue;
      const p = positions.get(n) && nodePos(n);
      if (!p) continue;
      graphTop = Math.min(graphTop, p.y);
      graphBottom = Math.max(graphBottom, p.y + NODE_HEIGHT);
      contentMaxY = Math.max(contentMaxY, p.y + NODE_HEIGHT);
    }
    if (!isFinite(graphTop)) graphTop = 0;
    const topPad = 24;
    const topShift = graphTop < topPad ? topPad - graphTop : 0;
    const bottomPad = 24;
    const height = Math.max(contentMaxY, graphBottom) + topShift + bottomPad;
    const baseViewBoxWidth = containerWidth;
    const baseViewBoxHeight = Math.max(height, 420);
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
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("viewBox", `${viewBoxXP} ${viewBoxYP} ${viewBoxWidthP} ${viewBoxHeightP}`);
    // Fill the Explore tree panel height (Figma ~542) without huge empty scroll.
    const panelH = Math.max(420, Math.floor(container.clientHeight || 542));
    svg.setAttribute("width", String(containerWidth));
    svg.setAttribute("height", String(panelH));
    svg.style.width = "100%";
    svg.style.height = "100%";
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
