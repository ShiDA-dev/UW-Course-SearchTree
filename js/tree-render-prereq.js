/**
 * Prerequisite tree — column-block layout (Figma REVIEW D SoT).
 *
 * New model (not the old packer):
 * - A course owns a vertical stack of OR-basket *blocks* in the next column.
 * - AND junctions are transparent (siblings share one column).
 * - Each basket is a fixed auto-layout frame: badge + rigid PILL_GAP pills + foot.
 * - Only the aim (top-score) pill opens a subtree; that subtree lives in the
 *   following column and is centered on the aim pill. Sibling baskets stack by
 *   *basket frame height only* — subtrees never open gaps inside a basket.
 * - Per-column collision resolve pushes whole blocks (basket + its aim subtree).
 * - Edges: fork-join with stub-out 56 / stub-in 46 over a 112px clear.
 *
 * Reuses: OrBasket visibility/aim, Path Finder selection, tree-build data.
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

    // REVIEW D scene (101:529): basket→next clear 112; f-a 56 / f-o 46; stack gap 39.
    // Pitch uses basket width; subtract pad so chrome-right → pill-left ≈ 112.
    const PILL_H = OB.PILL_H;
    const PILL_GAP = OB.PILL_GAP;
    const EDGE_CLEAR = 112;
    const STUB_OUT = 56;
    const STUB_IN = 46;
    const STACK_GAP = 39;
    const CANVAS_PAD_X = 24;
    const CANVAS_PAD_Y = 20;
    const ARROW = 10;
    const BASKET_W = OB.basketWidth();
    const COL_PITCH = BASKET_W + EDGE_CLEAR - OB.BASKET_PAD;

    const parentMap = new Map();
    (function buildParentMap(n, p) {
      parentMap.set(n, p);
      (n.children || []).forEach((c) => buildParentMap(c, n));
    })(root, null);

    function isJunction(n) {
      return !!(n && (n.isGroup || (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-")));
    }

    function isAndJunction(n) {
      return !!(n && (n.id || "").startsWith("and-"));
    }

    /** OR baskets that feed a course (AND unwrapped). */
    function prereqBaskets(courseNode) {
      const out = [];
      for (const c of courseNode.children || []) {
        if (isAndJunction(c)) {
          for (const g of c.children || []) if (g.isGroup) out.push(g);
        } else if (c.isGroup) {
          out.push(c);
        }
      }
      return out;
    }

    function basketChrome(orNode) {
      const showFoot = (orNode.children || []).length > OB.TEASER;
      const top = OB.BASKET_PAD + OB.BADGE_H + PILL_GAP;
      const bot = OB.BASKET_PAD + (showFoot ? PILL_GAP + OB.FOOT_H : 0);
      return { top, bot, showFoot };
    }

    function basketFrameHeight(orNode) {
      const pills = OB.visibleChildren(orNode);
      const n = Math.max(1, pills.length);
      const { top, bot } = basketChrome(orNode);
      return top + n * PILL_H + Math.max(0, n - 1) * PILL_GAP + bot;
    }

    const positions = new Map();
    /** @type {Map<number, Array<{kind:string, node:any, col:number, y0:number, h:number, pills?:any[], aim?:any}>>} */
    const blocksByCol = new Map();
    let maxCol = 0;

    function addBlock(block) {
      maxCol = Math.max(maxCol, block.col);
      if (!blocksByCol.has(block.col)) blocksByCol.set(block.col, []);
      blocksByCol.get(block.col).push(block);
    }

    function pillWidth(node) {
      if (node === root) return OB.PILL_MIN_W;
      const parent = parentMap.get(node);
      if (parent && parent.isGroup) return OB.PILL_MIN_W;
      const label = S.courseIdToCourse.get(node.id)?.course_id || node.id;
      return Math.max(OB.PILL_MIN_W, Math.min(160, 24 + label.length * 7 + 28));
    }

    function getWidth(node) {
      if (node.isGroup) return BASKET_W;
      return pillWidth(node);
    }

    /** Place course pill (column slot left). */
    function placeCourse(course, col, y) {
      positions.set(course, { x: col * COL_PITCH, y });
    }

    /** Place basket frame + rigid pills; returns block record. */
    function placeBasket(orNode, col, frameTop) {
      const pills = OB.visibleChildren(orNode);
      const { top } = basketChrome(orNode);
      const h = basketFrameHeight(orNode);
      const x = col * COL_PITCH;
      const aim = OB.aimChild(orNode);

      pills.forEach((pill, i) => {
        positions.set(pill, {
          x,
          y: frameTop + top + i * (PILL_H + PILL_GAP),
        });
      });

      // Junction marker at mid of pill stack (for debugging / AND mid)
      const midY =
        pills.length > 0
          ? positions.get(pills[0]).y + ((pills.length - 1) * (PILL_H + PILL_GAP)) / 2
          : frameTop + h / 2;
      positions.set(orNode, { x, y: midY });

      const block = {
        kind: "basket",
        node: orNode,
        col,
        y0: frameTop,
        h,
        pills,
        aim: aim && OB.shouldShowSubtree(orNode, aim) ? aim : null,
      };
      addBlock(block);
      return block;
    }

    /** Collect every positioned node under course's prereq baskets (not the course pill). */
    function collectPrereqNodes(course, into) {
      for (const b of prereqBaskets(course)) {
        into.add(b);
        for (const pill of OB.visibleChildren(b)) {
          into.add(pill);
          if (OB.shouldShowSubtree(b, pill)) collectPrereqNodes(pill, into);
        }
      }
    }

    /** Full vertical claim of a positioned node set (basket frames preferred). */
    function nodesYSpan(nodeSet) {
      let minY = Infinity;
      let maxY = -Infinity;
      for (const n of nodeSet) {
        const p = positions.get(n);
        if (!p) continue;
        if (n.isGroup) {
          const colBlocks = blocksByCol.get(Math.round(p.x / COL_PITCH)) || [];
          const bb = colBlocks.find((bl) => bl.node === n);
          if (bb) {
            minY = Math.min(minY, bb.y0);
            maxY = Math.max(maxY, bb.y0 + bb.h);
            continue;
          }
        }
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y + PILL_H);
      }
      return { minY, maxY };
    }

    function syncBasketBlockY(nodeSet, dy) {
      for (const n of nodeSet) {
        if (!n.isGroup) continue;
        const col = Math.round((positions.get(n)?.x || 0) / COL_PITCH);
        const list = blocksByCol.get(col) || [];
        const bb = list.find((bl) => bl.node === n);
        if (bb) bb.y0 += dy;
      }
    }

    function alignAimSubtree(block) {
      const aim = block.aim;
      if (!aim || !positions.has(aim)) return null;
      const nodes = new Set();
      collectPrereqNodes(aim, nodes);
      if (!nodes.size) return null;

      const span = nodesYSpan(nodes);
      if (!isFinite(span.minY)) return null;

      const aimMid = positions.get(aim).y + PILL_H / 2;
      const subMid = (span.minY + span.maxY) / 2;
      const dy = aimMid - subMid;
      if (Math.abs(dy) >= 0.5) {
        shiftNodes(nodes, dy);
        syncBasketBlockY(nodes, dy);
        span.minY += dy;
        span.maxY += dy;
      }
      return span;
    }

    /**
     * Layout prereq basket stack for `course` into column courseCol+1.
     * Each sibling reserves max(frame, aim-subtree) so CS136 vs CS136L-class
     * branches keep distinct vertical space (occurrence-stable via node uid).
     */
    function layoutPrereqs(course, courseCol) {
      const baskets = prereqBaskets(course);
      if (!baskets.length) return;

      // Deep first: each aim's prereqs occupy courseCol+2 …
      for (const b of baskets) {
        const aim = OB.aimChild(b);
        if (aim && OB.shouldShowSubtree(b, aim) && prereqBaskets(aim).length) {
          if (!positions.has(aim)) placeCourse(aim, courseCol + 1, 0);
          layoutPrereqs(aim, courseCol + 1);
        }
      }

      let y = 0;
      const placed = [];
      for (const b of baskets) {
        const block = placeBasket(b, courseCol + 1, y);
        placed.push(block);
        let spanBot = block.y0 + block.h;
        if (block.aim) {
          const span = alignAimSubtree(block);
          if (span && isFinite(span.maxY)) spanBot = Math.max(spanBot, span.maxY);
        }
        y = spanBot + STACK_GAP;
      }
      if (placed.length) y -= STACK_GAP;

      const stackTop = placed[0].y0;
      const stackBot = placed[placed.length - 1].y0 + placed[placed.length - 1].h;
      const courseY = (stackTop + stackBot) / 2 - PILL_H / 2;
      placeCourse(course, courseCol, courseY);
    }

    function shiftNodes(nodeSet, dy) {
      for (const n of nodeSet) {
        const p = positions.get(n);
        if (p) p.y += dy;
      }
    }

    /** Shift a basket block and its aim prereq subtree. */
    function shiftBlockDeep(block, dy) {
      if (Math.abs(dy) < 0.5) return;
      block.y0 += dy;
      const nodes = new Set([block.node]);
      for (const pill of block.pills || []) nodes.add(pill);
      if (block.aim) collectPrereqNodes(block.aim, nodes);
      shiftNodes(nodes, dy);
      // Sync nested basket block y0
      for (const n of nodes) {
        if (!n.isGroup || n === block.node) continue;
        const col = Math.round((positions.get(n)?.x || 0) / COL_PITCH);
        const list = blocksByCol.get(col) || [];
        const bb = list.find((bl) => bl.node === n);
        if (bb) bb.y0 += dy;
      }
    }

    // --- Build scene ---
    placeCourse(root, 0, 0);
    layoutPrereqs(root, 0);

    // Root-only course block (no basket) for column-0 collision / bounds
    if (positions.has(root)) {
      addBlock({
        kind: "course",
        node: root,
        col: 0,
        y0: positions.get(root).y,
        h: PILL_H,
      });
    }

    /** Vertical claim including aim subtree (sibling branches stay separated). */
    function blockClaimBottom(block) {
      let bot = block.y0 + block.h;
      if (block.kind === "basket" && block.aim) {
        const nodes = new Set();
        collectPrereqNodes(block.aim, nodes);
        const span = nodesYSpan(nodes);
        if (isFinite(span.maxY)) bot = Math.max(bot, span.maxY);
      }
      return bot;
    }

    function resolveColumnOverlaps() {
      for (let col = maxCol; col >= 0; col--) {
        const list = (blocksByCol.get(col) || []).slice().sort((a, b) => a.y0 - b.y0);
        for (let i = 0; i < list.length - 1; i++) {
          const a = list[i];
          const b = list[i + 1];
          const need = blockClaimBottom(a) + STACK_GAP;
          if (b.y0 < need - 0.5) {
            const dy = need - b.y0;
            if (b.kind === "basket") shiftBlockDeep(b, dy);
            else {
              b.y0 += dy;
              const p = positions.get(b.node);
              if (p) p.y += dy;
            }
          }
        }
      }
    }

    resolveColumnOverlaps();

    // Re-center free courses (never in-basket aim pills — those stay on the rigid pack)
    (function recentering(course) {
      const parent = parentMap.get(course);
      const inBasket = !!(parent && parent.isGroup);
      const baskets = prereqBaskets(course);
      if (baskets.length) {
        const frames = baskets
          .map((b) => {
            const col = Math.round((positions.get(b)?.x || 0) / COL_PITCH);
            return (blocksByCol.get(col) || []).find((bl) => bl.node === b);
          })
          .filter(Boolean);
        if (frames.length && !inBasket) {
          const top = Math.min(...frames.map((f) => f.y0));
          const bot = Math.max(...frames.map((f) => f.y0 + f.h));
          const y = (top + bot) / 2 - PILL_H / 2;
          const p = positions.get(course);
          if (p) p.y = y;
          if (course === root) {
            const rb = (blocksByCol.get(0) || []).find((bl) => bl.node === root);
            if (rb) {
              rb.y0 = y;
              rb.h = PILL_H;
            }
          }
        }
        for (const b of baskets) {
          const aim = OB.aimChild(b);
          if (aim && OB.shouldShowSubtree(b, aim)) {
            const col = Math.round((positions.get(b)?.x || 0) / COL_PITCH);
            const block = (blocksByCol.get(col) || []).find((bl) => bl.node === b);
            if (block) alignAimSubtree(block);
            recentering(aim);
          }
        }
      }
    })(root);

    // Final passes after recentering/align (subtree-aware; no course-specific offsets)
    for (let pass = 0; pass < 4; pass++) {
      const before = JSON.stringify(
        [...blocksByCol.values()].flat().map((bl) => [bl.node.uid || bl.node.id, bl.y0])
      );
      resolveColumnOverlaps();
      const after = JSON.stringify(
        [...blocksByCol.values()].flat().map((bl) => [bl.node.uid || bl.node.id, bl.y0])
      );
      if (before === after) break;
    }

    // --- Mirror to screen coords (root on the right) ---
    const containerWidth = Math.max(300, Math.floor(container.clientWidth || container.getBoundingClientRect().width));
    const nominalContentWidth = (maxCol + 1) * COL_PITCH + Math.max(BASKET_W, OB.PILL_MIN_W) + 10;

    function rawLeft(node) {
      const p = positions.get(node);
      return nominalContentWidth - (p.x + getWidth(node));
    }

    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const [node, p] of positions) {
      if (isJunction(node) && !node.isGroup) continue;
      if (node.isGroup) {
        const left = nominalContentWidth - (p.x + BASKET_W);
        rawMin = Math.min(rawMin, left);
        rawMax = Math.max(rawMax, left + BASKET_W);
      } else if (!isJunction(node)) {
        const left = rawLeft(node);
        const w = getWidth(node);
        const inBasket = !!(parentMap.get(node) && parentMap.get(node).isGroup);
        const pad = inBasket ? OB.BASKET_PAD : 0;
        rawMin = Math.min(rawMin, left - pad);
        rawMax = Math.max(rawMax, left + w + pad);
      }
    }

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

    // --- Draw baskets ---
    const groupNodes = [];
    for (const list of blocksByCol.values()) {
      for (const bl of list) if (bl.kind === "basket") groupNodes.push(bl.node);
    }

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
        if (!positions.has(child)) continue;
        const pos = nodePos(child);
        const w = getWidth(child);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y + PILL_H);
        minXp = Math.min(minXp, pos.x);
        maxXp = Math.max(maxXp, pos.x + w);
      }
      if (!isFinite(minY)) continue;
      const pad = OB.BASKET_PAD;
      const showFoot = (node.children || []).length > OB.TEASER;
      const badgeBlock = OB.BADGE_H + PILL_GAP;
      const footBlock = showFoot ? PILL_GAP + OB.FOOT_H : 0;
      const rectX = minXp - pad;
      const rectY = minY - pad - badgeBlock;
      const rectWidth = Math.max(BASKET_W, maxXp - minXp + pad * 2);
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

    // AND labels: tied to the AND junction's child baskets, mid-gap only (never inside a basket)
    (function drawAndLabels() {
      (function walk(n) {
        if (isAndJunction(n)) {
          const kids = (n.children || []).filter((c) => c.isGroup && groupBounds.has(c));
          for (let i = 0; i < kids.length - 1; i++) {
            const b1 = groupBounds.get(kids[i]);
            const b2 = groupBounds.get(kids[i + 1]);
            if (!b1 || !b2) continue;
            const gap = b2.minY - b1.maxY;
            if (gap < 10) continue; // refuse to paint over crowded rows
            const x = (b1.midX + b2.midX) / 2;
            const y = b1.maxY + gap / 2;
            const label = SvgUtils.svgText(g, x, y, "AND", "and-label", "middle", "middle");
            label.setAttribute("data-and-uid", String(n.uid || n.id));
            label.setAttribute("data-joins", `${kids[i].uid || kids[i].id},${kids[i + 1].uid || kids[i + 1].id}`);
          }
        }
        for (const c of n.children || []) walk(c);
      })(root);
    })();

    // --- Edges (occurrence-stable via node uid) ---
    const edgesFrag = document.createDocumentFragment();

    function courseAncestor(node) {
      let p = parentMap.get(node);
      while (p) {
        if (!isJunction(p)) return p;
        p = parentMap.get(p);
      }
      return null;
    }

    function addEdgePath(d, onPath, meta) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("class", onPath ? "edge highlight-edge" : "edge");
      if (meta) {
        if (meta.fromUid != null) path.setAttribute("data-from-uid", String(meta.fromUid));
        if (meta.toUid != null) path.setAttribute("data-to-uid", String(meta.toUid));
        if (meta.role) path.setAttribute("data-edge-role", meta.role);
      }
      edgesFrag.appendChild(path);
    }

    function drawBasketRoutes() {
      // Group by target *occurrence* (object identity / uid), never by course code alone
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
        const targetY = tPos.y + PILL_H / 2;
        const targetUid = target.uid || target.id;
        const sources = baskets.map((basket) => {
          const bounds = groupBounds.get(basket);
          const aim = OB.aimChild(basket);
          // Row port: aim pill midY; group port fallback: basket mid
          let y = bounds.midY;
          if (aim && positions.has(aim)) y = nodePos(aim).y + PILL_H / 2;
          return {
            x: bounds.maxX,
            y,
            basket,
            fromUid: (aim && aim.uid) || basket.uid || basket.id,
          };
        });
        const maxSourceX = Math.max(...sources.map((s) => s.x));
        const ys = sources.map((s) => s.y).concat([targetY]);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const tipX = targetLeft;
        const baseX = tipX - ARROW;
        let spineX = maxSourceX + STUB_OUT;
        const maxSpine = baseX - STUB_IN;
        if (maxSpine > maxSourceX + 12) spineX = Math.min(spineX, maxSpine);
        spineX = Math.max(spineX, maxSourceX + 12);
        spineX = Math.min(spineX, baseX - 4);

        const routeOn = S.pathFocusActive && baskets.some((b) => S.hasSelectedMap.get(b));
        for (const s of sources) {
          const on = S.pathFocusActive && !!S.hasSelectedMap.get(s.basket);
          addEdgePath(`M ${s.x} ${s.y} H ${spineX}`, on, {
            fromUid: s.fromUid,
            toUid: targetUid,
            role: "stub-out",
          });
        }
        if (maxY - minY > 0.5) {
          addEdgePath(`M ${spineX} ${minY} V ${maxY}`, routeOn, {
            toUid: targetUid,
            role: "spine",
          });
        }
        if (baseX > spineX + 0.5) {
          addEdgePath(`M ${spineX} ${targetY} H ${baseX}`, routeOn, {
            toUid: targetUid,
            role: "stub-in",
          });
        }
        const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        head.setAttribute("points", `${tipX},${targetY} ${baseX},${targetY - 5} ${baseX},${targetY + 5}`);
        head.setAttribute("class", routeOn ? "edge-anchor highlight-anchor" : "edge-anchor");
        head.setAttribute("data-to-uid", String(targetUid));
        edgesFrag.appendChild(head);
      }
    }

    S.hasSelectedMap.clear();
    Selection.markHasSelected(root);
    drawBasketRoutes();

    // --- Course pills ---
    const nodesFrag = document.createDocumentFragment();
    function drawCourse(node) {
      if (!positions.has(node) || isJunction(node)) return;
      const pos = nodePos(node);
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
      const pillH = selected ? PILL_H + 1 : PILL_H;
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

    for (const node of positions.keys()) {
      if (!isJunction(node)) drawCourse(node);
    }

    g.appendChild(edgesFrag);
    g.appendChild(nodesFrag);

    let graphTop = Infinity;
    let graphBottom = contentMaxY;
    for (const b of groupBounds.values()) {
      graphTop = Math.min(graphTop, b.minY);
      graphBottom = Math.max(graphBottom, b.maxY);
    }
    for (const [node] of positions) {
      if (isJunction(node)) continue;
      const p = nodePos(node);
      graphTop = Math.min(graphTop, p.y);
      graphBottom = Math.max(graphBottom, p.y + PILL_H);
    }
    if (!isFinite(graphTop)) graphTop = 0;

    // Fill the flex tree region; fall back sensibly if layout not yet sized
    const canvasH = Math.max(240, Math.floor(container.clientHeight || container.getBoundingClientRect().height || 480));
    const contentH = Math.max(0, Math.max(graphBottom, contentMaxY) - graphTop);
    const fits = contentH + CANVAS_PAD_Y * 2 <= canvasH;
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
    svg.style.height = "100%";
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
