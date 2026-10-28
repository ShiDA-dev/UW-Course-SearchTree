/**
 * Render the prerequisite tree as SVG (Phase C OR freeze grammar):
 * - OR baskets: 1 of N badge, score-sorted pills, collapsed +N more / Show less
 * - No spider lines inside baskets; fork-join outbound
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
    // Fill available width — small side pads only (no 0.8 letterbox gutters)
    const SIDE_PAD = 28;
    const usableWidth = Math.max(HORIZONTAL_GAP, containerWidth - SIDE_PAD * 2);
    let levelGap = Math.max(
      HORIZONTAL_GAP,
      Math.floor((usableWidth - Math.max(maxNodeWidth, OB.basketWidth())) / Math.max(1, maxDepthForWidth))
    );

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

    // Depths run 0..maxDepth → maxDepth gaps between columns
    const nominalContentWidth = maxDepth * levelGap + Math.max(maxNodeWidth, OB.basketWidth()) + 10;
    function nodePos(node) {
      const p = positions.get(node);
      const w = getWidth(node);
      return { x: nominalContentWidth - (p.x + w), y: p.y };
    }

    let minX = Infinity,
      maxX = -Infinity;
    (function measure(n) {
      const p = nodePos(n);
      const w = getWidth(n);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + w);
      for (const c of walkKids(n)) measure(c);
    })(root);
    const baseTranslateX = isFinite(minX) ? -minX : 0;
    const contentWidth = isFinite(maxX - minX) ? maxX - minX : nominalContentWidth;

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

    const drawnEdges = new Set();
    const edgesFrag = document.createDocumentFragment();

    function isJunctionNode(n) {
      return !!(n && (((n.id || "").startsWith("and-") || (n.id || "").startsWith("or-") || n.isGroup)));
    }

    /** Walk past AND/OR hubs to the course pill that should receive the arrow. */
    function courseTargetOf(node) {
      let n = node;
      while (n && isJunctionNode(n)) n = parentMap.get(n);
      return n;
    }

    /** Orthogonal elbow: H → V → H (or straight H when Y matches). */
    function elbowPath(x1, y1, x2, y2, midX) {
      if (Math.abs(y1 - y2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
      const mx = midX != null ? midX : (x1 + x2) / 2;
      return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
    }

    function appendEdge(d, highlight, arrowAt) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
      edgesFrag.appendChild(path);
      if (arrowAt) {
        const { x, y } = arrowAt;
        const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        // Tip flush on target left edge; base sits on the inbound segment
        head.setAttribute("points", `${x},${y} ${x - 8},${y - 4.5} ${x - 8},${y + 4.5}`);
        head.setAttribute("class", highlight ? "edge-anchor highlight-anchor" : "edge-anchor");
        edgesFrag.appendChild(head);
      }
    }

    /**
     * Basket outbound: fork-join orthogonal routing into the destination course.
     * Arrowheads only on the destination pill — never on AND/OR hubs.
     */
    function drawBasketOutbound(rootNode) {
      const byTarget = new Map();
      (function visit(node) {
        if (node.isGroup && groupBounds.has(node)) {
          const parent = parentMap.get(node);
          const target = courseTargetOf(parent);
          if (target && positions.has(target)) {
            const bounds = groupBounds.get(node);
            const top = OB.aimChild(node);
            const topPos = top && positions.has(top) ? nodePos(top) : null;
            const aimY = topPos ? topPos.y + NODE_HEIGHT / 2 : bounds.midY;
            if (!byTarget.has(target)) byTarget.set(target, []);
            byTarget.get(target).push({ orNode: node, bounds, aimY });
          }
        }
        for (const c of walkKids(node)) visit(c);
      })(rootNode);

      for (const [target, items] of byTarget) {
        const tPos = nodePos(target);
        const targetX = tPos.x;
        const targetY = tPos.y + NODE_HEIGHT / 2;
        const anyOnPath = S.pathFocusActive && items.some((it) => S.hasSelectedMap.get(it.orNode));

        if (items.length === 1) {
          const { bounds, aimY, orNode } = items[0];
          const key = `basket-${Selection.nodeKey(orNode)}->${Selection.nodeKey(target)}`;
          if (drawnEdges.has(key)) continue;
          drawnEdges.add(key);
          const midX = (bounds.maxX + targetX) / 2;
          const onPath = S.pathFocusActive && S.hasSelectedMap.get(orNode);
          appendEdge(elbowPath(bounds.maxX, aimY, targetX, targetY, midX), onPath, { x: targetX, y: targetY });
        } else {
          const maxRight = Math.max(...items.map((it) => it.bounds.maxX));
          const joinX = (maxRight + targetX) / 2;
          const ys = items.map((it) => it.aimY);
          const spineMin = Math.min(...ys, targetY);
          const spineMax = Math.max(...ys, targetY);

          for (const it of items) {
            const stubKey = `basket-${Selection.nodeKey(it.orNode)}->join-${Selection.nodeKey(target)}`;
            if (drawnEdges.has(stubKey)) continue;
            drawnEdges.add(stubKey);
            const onPath = S.pathFocusActive && S.hasSelectedMap.get(it.orNode);
            appendEdge(`M ${it.bounds.maxX} ${it.aimY} L ${joinX} ${it.aimY}`, onPath, null);
          }

          const spineKey = `spine-${Selection.nodeKey(target)}`;
          if (!drawnEdges.has(spineKey)) {
            drawnEdges.add(spineKey);
            if (spineMax - spineMin > 0.5) {
              appendEdge(`M ${joinX} ${spineMin} L ${joinX} ${spineMax}`, anyOnPath, null);
            }
          }

          const outKey = `join-${Selection.nodeKey(target)}->target`;
          if (!drawnEdges.has(outKey)) {
            drawnEdges.add(outKey);
            appendEdge(`M ${joinX} ${targetY} L ${targetX} ${targetY}`, anyOnPath, { x: targetX, y: targetY });
          }
        }
      }
    }

    /** Direct course→course links (no OR basket): orthogonal, arrow on parent (right). */
    function drawDirectCourseEdges(node) {
      for (const child of walkKids(node)) {
        if (child.isGroup) {
          for (const gc of walkKids(child)) drawDirectCourseEdges(gc);
          continue;
        }
        if (isJunctionNode(child)) {
          drawDirectCourseEdges(child);
          continue;
        }
        if (!isJunctionNode(node) && positions.has(node) && positions.has(child)) {
          const edgeKey = `${Selection.nodeKey(child)}->${Selection.nodeKey(node)}`;
          if (!drawnEdges.has(edgeKey)) {
            drawnEdges.add(edgeKey);
            const p = nodePos(node);
            const c = nodePos(child);
            const startX = c.x + getWidth(child);
            const startY = c.y + NODE_HEIGHT / 2;
            const endX = p.x;
            const endY = p.y + NODE_HEIGHT / 2;
            const midX = (startX + endX) / 2;
            const highlight = S.pathFocusActive && S.currentSelection.has(Selection.nodeKey(child));
            appendEdge(elbowPath(startX, startY, endX, endY, midX), highlight, { x: endX, y: endY });
          }
        }
        drawDirectCourseEdges(child);
      }
    }

    S.hasSelectedMap.clear();
    Selection.markHasSelected(root);

    drawBasketOutbound(root);
    drawDirectCourseEdges(root);

    function drawNode(node) {
      const junction = isJunctionNode(node);
      const pos = positions.get(node) ? nodePos(node) : null;
      if (!pos) {
        for (const child of walkKids(node)) drawNode(child);
        return;
      }
      if (!junction) {
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
        const isTopScore = parent && parent.isGroup && OB.topScoreChild(parent) === node;
        const selected = !isRoot && S.pathFocusActive && S.currentSelection.has(Selection.nodeKey(node));
        let cls = "node or-pill";
        if (isRoot) cls += " node-target";
        if (isTopScore) cls += " stroke-strong";
        if (selected) cls += " highlight-node";
        // Pill radius matches basket grammar (full capsule)
        SvgUtils.rect(nodeGroup, pos.x, pos.y, w, NODE_HEIGHT, NODE_HEIGHT / 2, cls);
        if (S.pathFocusActive && !isRoot && !selected && !isTopScore) nodeGroup.setAttribute("opacity", "0.7");

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

    const width = containerWidth;
    const height = contentMaxY + 20;
    const padding = SIDE_PAD;
    svg.setAttribute("width", String(width));
    const elementPixelHeightPrereq = Math.max(height + padding, container.clientHeight || Math.floor(window.innerHeight * 0.8));
    svg.setAttribute("height", String(elementPixelHeightPrereq));

    const baseViewBoxWidth = Math.max(contentWidth + padding * 2, containerWidth);
    const baseViewBoxHeight = Math.max(height + padding, 1);
    let didAutoZoomPrereq = false;
    if (S.shouldAutoZoomPrereq) {
      // Prefer filling width; only shrink if content is wider than the container
      const zoomW = containerWidth / baseViewBoxWidth;
      S.prereqZoom = Math.max(0.2, Math.min(1.0, zoomW));
      S.shouldAutoZoomPrereq = false;
      didAutoZoomPrereq = true;
    }

    const isSinglePrereq = !root?.children || root.children.length === 0;
    if (isSinglePrereq) {
      const overscaleW = (containerWidth || 1) / Math.max(1, contentWidth + padding * 2);
      if (overscaleW > 1) {
        S.prereqZoom = Math.min(S.prereqZoom, Math.max(0.8, 2.5 / overscaleW));
      }
    }
    const zoom = S.prereqZoom;
    // Anchor viewBox to content origin so width-fill does not re-letterbox
    const viewBoxWidthP = baseViewBoxWidth / zoom;
    const viewBoxHeightP = baseViewBoxHeight / zoom;
    svg.setAttribute("viewBox", `0 0 ${viewBoxWidthP} ${viewBoxHeightP}`);
    svg.setAttribute("preserveAspectRatio", "xMinYMid meet");
    svg.style.width = "";
    svg.style.height = "";
    g.setAttribute("transform", `translate(${baseTranslateX + padding},${padding / 2})`);

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
