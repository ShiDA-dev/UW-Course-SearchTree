/**
 * Render the prerequisite tree as SVG:
 * - OR group containers + "or" labels
 * - fan-in edges to a convergence hub
 * - course chips with weight / min-grade badges
 * - recommended-path highlighting
 */
(function () {
  "use strict";
  const S = window.AppState;

function renderPrereqTree(container, root){
  // Preserve viewport center point for better zoom behavior
  const { scrollLeft, scrollTop, scrollWidth, clientWidth, scrollHeight, clientHeight } = container;
  const viewportCenterX = scrollLeft + clientWidth / 2;
  const viewportCenterY = scrollTop + clientHeight / 2;
  const contentCenterX = scrollWidth / 2;
  const contentCenterY = scrollHeight / 2;
  const offsetX = viewportCenterX - contentCenterX;
  const offsetY = viewportCenterY - contentCenterY;

  const existingSvg = container.querySelector('svg');
  if (existingSvg) existingSvg.remove();
  const { svg, g } = SvgUtils.makeSVG(container);
  // Left-to-right tidy tree layout (depth → x, siblings stacked along y)
  const NODE_HEIGHT = 26;
  const HORIZONTAL_GAP = 64; // minimal horizontal space between levels
  const interGroupGap = 64; // vertical gap between sibling groups (more room for AND)
  const intraGroupGap = 16; // vertical gap within a group
  const positions = new Map();
  const widthById = new Map();
  let maxNodeWidth = 0;
  (function collect(n){
    const isRoot = (n === root);
    const isJunction = (n.id || "").startsWith("and-") || (n.id || "").startsWith("or-");
    const label = isJunction ? "" : (S.courseIdToCourse.get(n.id)?.course_id || n.id);
    const gradeSpace = isRoot ? 0 : 26; // compacted from 30
    const weightSpace = isRoot ? 0 : 22; // tighter to match right-side spacing
    let est = isJunction ? 1 : Math.max(56, Math.min(180, 14 + (label.length * 8) + gradeSpace));
    est += weightSpace;
    widthById.set(n.id, est);
    if(est > maxNodeWidth) maxNodeWidth = est;
    for(const c of (n.children || [])) collect(c);
  })(root);
  function computeMaxDepth(n){
    const kids = n.children || [];
    if(kids.length === 0) return 0;
    let md = 0;
    for(const c of kids){ md = Math.max(md, 1 + computeMaxDepth(c)); }
    return md;
  }
  const maxDepthForWidth = computeMaxDepth(root);
  const containerWidth = Math.max(300, Math.floor(container.clientWidth || container.getBoundingClientRect().width));
  let levelGap = Math.max(
    HORIZONTAL_GAP,
    Math.floor((containerWidth - maxNodeWidth - 10) / Math.max(1, maxDepthForWidth))
  );
  const estimatedTreeWidth = (maxDepthForWidth * levelGap) + maxNodeWidth;
  if (estimatedTreeWidth < containerWidth * 0.8 && maxDepthForWidth > 0) {
    levelGap = Math.floor((containerWidth * 0.8 - maxNodeWidth - 10) / maxDepthForWidth);
  }

  let maxDepth = 0;
  let yCursor = 40;
  function layout(node, depth){
    maxDepth = Math.max(maxDepth, depth);
    const children = node.children || [];
    let top = Infinity, bottom = -Infinity;
    if(children.length){
      for(const c of children){
        const p = layout(c, depth+1);
        top = Math.min(top, p.y);
        bottom = Math.max(bottom, p.y);
      }
    }
    let y;
    if(children.length){
      y = (top + bottom) / 2;
    } else {
      y = yCursor;
      yCursor += NODE_HEIGHT + interGroupGap;
    }
    const pos = { x: depth * levelGap, y };
    positions.set(node, pos);
    return pos;
  }
  layout(root, 0);

  // Post-processing pass to resolve overlaps
  function getSubtreeBounds(node) {
      let minY = Infinity;
      let maxY = -Infinity;
      const subtreeNodes = [];
      (function collect(n) {
          subtreeNodes.push(n);
          (n.children || []).forEach(collect);
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

  const parentMap = new Map();
  (function buildParentMap(n, p) {
      parentMap.set(n, p);
      (n.children || []).forEach(c => buildParentMap(c, n));
  })(root, null);

  const allNodes = [];
  (function collect(n){ allNodes.push(n); (n.children||[]).forEach(collect); })(root);

  const nodesByDepth = new Map();
  for(const node of allNodes){
      const p = positions.get(node);
      if (!p) continue;
      const depth = Math.round(p.x / levelGap);
      if(!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
      nodesByDepth.get(depth).push(node);
  }
  
  let iterations = 0;
  while(iterations < 5) { // Limit iterations to keep tasks short
      let changed = false;
      for(let d = 0; d <= maxDepth; d++) {
          const nodes = nodesByDepth.get(d) || [];
          if (nodes.length < 2) continue;
          nodes.sort((a,b) => (positions.get(a)?.y || 0) - (positions.get(b)?.y || 0));

          for(let i=0; i < nodes.length - 1; i++){
              const n1 = nodes[i];
              const n2 = nodes[i+1];
              
              const p1 = parentMap.get(n1);
              const p2 = parentMap.get(n2);
              const isIntraGroup = p1 && p2 && p1 === p2 && p1.isGroup;
              const gap = isIntraGroup ? intraGroupGap : interGroupGap;

              const bounds1 = getSubtreeBounds(n1);
              const bounds2 = getSubtreeBounds(n2);

              if (!isFinite(bounds1.maxY) || !isFinite(bounds2.minY)) continue;

              const overlap = bounds1.maxY - bounds2.minY;
              if(overlap > -gap){
                  changed = true;
                  const shift = overlap + gap;
                  const subtreeToShift = [];
                  (function collectSubtree(n){ subtreeToShift.push(n); (n.children||[]).forEach(collectSubtree); })(n2);
                  for(const n of subtreeToShift){
                      const p = positions.get(n);
                      if(p) p.y += shift;
                  }
              }
          }
      }
      if (!changed) break;
      iterations++;
  }

  const nominalContentWidth = (maxDepth + 1) * levelGap + maxNodeWidth + 10;
  const reverse = true; // Prereqs are always reversed (right to left)
  function getWidth(node){ return widthById.get(node.id) || maxNodeWidth; }
  function nodePos(node){
    const p = positions.get(node);
    const w = getWidth(node);
    return { x: nominalContentWidth - (p.x + w), y: p.y };
  }
  let minX = Infinity, maxX = -Infinity;
  (function measure(n){
    const p = nodePos(n);
    const w = getWidth(n);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + w);
    for(const c of (n.children || [])) measure(c);
  })(root);
  const baseTranslateX = isFinite(minX) ? -minX : 0;
  const contentWidth = isFinite(maxX - minX) ? (maxX - minX) : nominalContentWidth;

  const groupNodes = [];
  (function collectGroups(n) {
    if (n.isGroup) groupNodes.push(n);
    for (const c of (n.children || [])) collectGroups(c);
  })(root);

  const groupBounds = new Map();
  let contentMaxY = yCursor;

  for (const node of groupNodes) {
    const children = node.children || [];
    if (children.length > 0) {
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
      for (const child of children) {
        const pos = nodePos(child);
        const w = getWidth(child);
        minY = Math.min(minY, pos.y);
        maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
        minX = Math.min(minX, pos.x);
        maxX = Math.max(maxX, pos.x + w);
      }
      if (isFinite(minY)) {
        const padding = 12;
        const rectX = minX - padding;
        const rectY = minY - padding;
        const rectWidth = maxX - minX + padding * 2;
        const rectHeight = maxY - minY + padding * 2;
        SvgUtils.rect(g, rectX, rectY, rectWidth, rectHeight, 16, "prereq-group-bg");
        groupBounds.set(node, { minY: rectY, maxY: rectY + rectHeight, midX: rectX + rectWidth/2 });
        contentMaxY = Math.max(contentMaxY, rectY + rectHeight);

        for (let i = 0; i < children.length - 1; i++) {
          const child1 = children[i];
          const child2 = children[i+1];
          const pos1 = nodePos(child1);
          const pos2 = nodePos(child2);
          const labelX = minX + rectWidth/2 - padding;
          const labelY = (pos1.y + NODE_HEIGHT + pos2.y) / 2;
          SvgUtils.svgText(g, labelX, labelY, 'or', 'or-label', 'middle');
        }
      }
    }
  }

  const andNodes = [];
  (function collectAnds(n) {
    if ((n.id || "").startsWith("and-")) andNodes.push(n);
    for (const c of (n.children || [])) collectAnds(c);
  })(root);

  for (const node of andNodes) {
      const children = node.children || [];
      for (let i = 0; i < children.length - 1; i++) {
          const group1 = children[i];
          const group2 = children[i+1];
          const bounds1 = groupBounds.get(group1);
          const bounds2 = groupBounds.get(group2);
          if (bounds1 && bounds2) {
              const x = bounds1.midX;
              const y = (bounds1.maxY + bounds2.minY) / 2;
              SvgUtils.svgText(g, x, y, 'AND', 'and-label', 'middle');
          }
      }
  }

  const drawnEdges = new Set();
  const edgesFrag = document.createDocumentFragment();
  
  // Store convergence points for OR groups
  const orGroupConvergencePoints = new Map();
  
  function drawEdges(node){
    const p = nodePos(node);

    for(const child of (node.children || [])){
      // Skip OR groups - they're handled by drawORGroupEdges and drawConvergenceToParent
      if(child.isGroup && child.children && child.children.length > 0){
        // Don't draw edge to OR group itself, but DO recurse into its children to handle deeper levels
        for(const grandchild of (child.children || [])){
          drawEdges(grandchild);
        }
        continue;
      }
      
      const c = nodePos(child);

      const edgeKey = `${Selection.nodeKey(node)}->${Selection.nodeKey(child)}`;
      if(!drawnEdges.has(edgeKey)){
        drawnEdges.add(edgeKey);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        const parentIsJunction = (node.id || "").startsWith("and-") || (node.id || "").startsWith("or-") || node.isGroup;
        const childIsJunction = (child.id || "").startsWith("and-") || (child.id || "").startsWith("or-") || child.isGroup;

        const startX = parentIsJunction ? p.x : (p.x + 6);
        const startY = p.y + NODE_HEIGHT/2;
        const endX = childIsJunction ? c.x : (c.x + getWidth(child) - 6);
        const endY = c.y + NODE_HEIGHT/2;

        const d = `M ${startX} ${startY} L ${endX} ${endY}`;
        path.setAttribute("d", d);
        const highlight = S.currentSelection.size && (S.hasSelectedMap.get(child) || (Selection.isCourseNode(child) && S.currentSelection.has(Selection.nodeKey(child))));
        path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
        edgesFrag.appendChild(path);
      }
      drawEdges(child);
    }
  }
  
  // First pass: draw edges from OR group children to convergence points
  function drawORGroupEdges(node){
    if(node.isGroup && node.children && node.children.length > 0){
      const bounds = groupBounds.get(node);
      if(bounds){
        // Calculate convergence point on the right edge of the OR group
        let orGroupMaxX = -Infinity;
          let orGroupMinY = Infinity;
          let orGroupMaxY = -Infinity;
          for(const grandchild of node.children){
            const gc = nodePos(grandchild);
            const gw = getWidth(grandchild);
            orGroupMaxX = Math.max(orGroupMaxX, gc.x + gw);
            orGroupMinY = Math.min(orGroupMinY, gc.y);
            orGroupMaxY = Math.max(orGroupMaxY, gc.y + NODE_HEIGHT);
          }
          const padding = 12;
          // Right edge of the OR box (parent lies to the right after mirroring)
          const orGroupRightEdge = orGroupMaxX + padding;
        // Convergence Y is at the vertical center of the OR group
        const convergenceY = (orGroupMinY + orGroupMaxY) / 2;
        
        // Find parent of this OR group
        const parent = parentMap.get(node);
        if(parent){
          const parentPos = nodePos(parent);
          const parentIsJunction = (parent.id || "").startsWith("and-") || (parent.id || "").startsWith("or-") || parent.isGroup;
          const parentStartX = parentIsJunction ? parentPos.x : (parentPos.x + 6);
          
          // Convergence X is halfway between OR group right edge and parent left edge
          const convergenceX = (orGroupRightEdge + parentStartX) / 2;
          
          orGroupConvergencePoints.set(node, { x: convergenceX, y: convergenceY });
          
          // Draw edges from each child to convergence point
          for(const grandchild of node.children){
            const gc = nodePos(grandchild);
            const grandchildIsJunction = (grandchild.id || "").startsWith("and-") || (grandchild.id || "").startsWith("or-") || grandchild.isGroup;
            const grandchildEndX = grandchildIsJunction ? gc.x : (gc.x + getWidth(grandchild) - 6);
            const grandchildEndY = gc.y + NODE_HEIGHT/2;
            
            const edgeKey = `${Selection.nodeKey(grandchild)}->converge-${Selection.nodeKey(node)}`;
            if(!drawnEdges.has(edgeKey)){
              drawnEdges.add(edgeKey);
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              const d = `M ${grandchildEndX} ${grandchildEndY} L ${convergenceX} ${convergenceY}`;
              path.setAttribute("d", d);
              const highlight = S.currentSelection.size && (S.hasSelectedMap.get(grandchild) || (Selection.isCourseNode(grandchild) && S.currentSelection.has(Selection.nodeKey(grandchild))));
              path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
              edgesFrag.appendChild(path);
            }
            
            // Recurse into grandchild's descendants to handle deeper prerequisites
            drawORGroupEdges(grandchild);
          }
        }
      }
    } else {
      // Not an OR group, recurse into children
      for(const child of (node.children || [])){
        drawORGroupEdges(child);
      }
    }
  }
  
  // Second pass: draw edges from convergence points to parents, and handle AND convergence
  function drawConvergenceToParent(node){
    if(node.isGroup && node.children && node.children.length > 0){
      const convergencePoint = orGroupConvergencePoints.get(node);
      if(convergencePoint){
        const parent = parentMap.get(node);
        if(parent){
          const parentPos = nodePos(parent);
          const parentIsJunction = (parent.id || "").startsWith("and-") || (parent.id || "").startsWith("or-") || parent.isGroup;
          const parentStartX = parentIsJunction ? parentPos.x : (parentPos.x + 6);
          const parentStartY = parentPos.y + NODE_HEIGHT/2;
          
          // Check if parent is AND node with multiple OR group children
          const isAndNode = (parent.id || "").startsWith("and-");
          const orGroupSiblings = (parent.children || []).filter(c => c.isGroup && c.children && c.children.length > 0);
          
          if(isAndNode && orGroupSiblings.length > 1){
            // Calculate intermediate convergence point for AND
            // The intermediate point is halfway between rightmost convergence and parent
            // and at the vertical center of all OR group convergence Y values
            let rightmostConvergenceX = Infinity;
            let minConvergenceY = Infinity;
            let maxConvergenceY = -Infinity;
            for(const orSibling of orGroupSiblings){
              const convPt = orGroupConvergencePoints.get(orSibling);
              if(convPt){
                rightmostConvergenceX = Math.min(rightmostConvergenceX, convPt.x);
                minConvergenceY = Math.min(minConvergenceY, convPt.y);
                maxConvergenceY = Math.max(maxConvergenceY, convPt.y);
              }
            }
            // Intermediate X is halfway between the rightmost convergence and parent
            const intermediateX = (rightmostConvergenceX + parentStartX) / 2;
            // Intermediate Y is at the vertical center of all OR group convergence points
            const intermediateY = (minConvergenceY + maxConvergenceY) / 2;
            
            // Draw from this OR group's convergence to intermediate point
            const edgeKey = `converge-${Selection.nodeKey(node)}->intermediate-${Selection.nodeKey(parent)}`;
            if(!drawnEdges.has(edgeKey)){
              drawnEdges.add(edgeKey);
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              const d = `M ${convergencePoint.x} ${convergencePoint.y} L ${intermediateX} ${intermediateY}`;
              path.setAttribute("d", d);
              const highlight = S.currentSelection.size && node.children.some(gc => S.hasSelectedMap.get(gc) || (Selection.isCourseNode(gc) && S.currentSelection.has(Selection.nodeKey(gc))));
              path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
              edgesFrag.appendChild(path);
            }
            
            // Draw from intermediate to parent (only once)
            const intermediateToParentKey = `intermediate-${parent.id}->${parent.id}`;
            if(!drawnEdges.has(intermediateToParentKey)){
              drawnEdges.add(intermediateToParentKey);
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              const d = `M ${intermediateX} ${intermediateY} L ${parentStartX} ${parentStartY}`;
              path.setAttribute("d", d);
              const highlight = S.currentSelection.size && orGroupSiblings.some(og => og.children.some(gc => S.hasSelectedMap.get(gc) || (Selection.isCourseNode(gc) && S.currentSelection.has(Selection.nodeKey(gc)))));
              path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
              edgesFrag.appendChild(path);
            }
          } else {
            // Direct connection from convergence point to parent
            const edgeKey = `converge-${Selection.nodeKey(node)}->${Selection.nodeKey(parent)}`;
            if(!drawnEdges.has(edgeKey)){
              drawnEdges.add(edgeKey);
              const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
              const d = `M ${convergencePoint.x} ${convergencePoint.y} L ${parentStartX} ${parentStartY}`;
              path.setAttribute("d", d);
              const highlight = S.currentSelection.size && node.children.some(gc => S.hasSelectedMap.get(gc) || (Selection.isCourseNode(gc) && S.currentSelection.has(Selection.nodeKey(gc))));
              path.setAttribute("class", highlight ? "edge highlight-edge" : "edge");
              edgesFrag.appendChild(path);
            }
          }
        }
      }
    }
    for(const child of (node.children || [])){
      drawConvergenceToParent(child);
    }
  }
  
  S.hasSelectedMap.clear();
  Selection.markHasSelected(root);
  
  // Draw OR group edges first
  drawORGroupEdges(root);
  
  // Draw convergence to parent edges
  drawConvergenceToParent(root);
  
  // Draw remaining normal edges (non-OR-group connections)
  // Note: drawEdges skips OR groups since they're handled above
  drawEdges(root);
  function drawNode(node){
    const isJunction = (node.id || "").startsWith("and-") || (node.id || "").startsWith("or-");
    const pos = nodePos(node);
    if(isJunction){
      // Do not render junction nodes, they are for layout only
    } else {
      const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodeGroup.setAttribute("class", "clickable-node");
      nodeGroup.addEventListener('click', (e) => {
        e.preventDefault();
        S.navigateToCourse(node.id);
      });
      nodesFrag.appendChild(nodeGroup);

      const w = getWidth(node);
      const chip = SvgUtils.rect(nodeGroup, pos.x, pos.y, w, NODE_HEIGHT, 8, "node");
      const label = S.courseIdToCourse.get(node.id)?.course_id || node.id;

      // Weight badge on the left (non-root)
      const isRoot = (node === root);
      let labelStartX = pos.x + 8;
      if(!isRoot){
        try{
          const wValue = PathFinder.getCourseWeight(node.id, S.courseIdToCourse);
          const colorFor = (v)=>{ if(v < 50) return '#AF3434'; if(v < 80) return '#E1863C'; return '#4D7235'; };
          const BADGE_W = 20; // compact and bring closer to label
          const by = pos.y + (NODE_HEIGHT - 16) / 2;
          const bx = pos.x + 4;
          SvgUtils.rect(nodeGroup, bx, by, BADGE_W, 16, 6, 'grade-badge');
          const wt = SvgUtils.svgText(nodeGroup, bx + BADGE_W/2, by + 8, String(Math.round(wValue)), 'weight-text', 'middle', 'middle');
          wt.setAttribute('fill', colorFor(wValue));
          labelStartX = pos.x + 8 + BADGE_W + 3; // tighten gap to match grade side
        }catch(_){ /* ignore */ }
      }

      const t = SvgUtils.svgText(nodeGroup, labelStartX, pos.y + NODE_HEIGHT/2, label, "node-label", "start", "middle");
 
      if(S.currentSelection.size){
        const selected = S.currentSelection.has(Selection.nodeKey(node));
        if(selected){ chip.setAttribute('class','node highlight-node'); }
      }

      const hasGrade = node.min_grade !== undefined && node.min_grade !== null;
 
      if (hasGrade || !isRoot) {
        const GRADE_BADGE_W = 22; // compact to match left
        const bx = pos.x + w - GRADE_BADGE_W - 4;
        const by = pos.y + (NODE_HEIGHT - 16) / 2;
        SvgUtils.rect(nodeGroup, bx, by, GRADE_BADGE_W, 16, 6, "grade-badge");
        if(hasGrade){
          SvgUtils.svgText(nodeGroup, bx + GRADE_BADGE_W/2, by + 8, String(node.min_grade), "grade-text", "middle", "middle");
        }
      }
    }
    for(const child of (node.children || [])) drawNode(child);
  }
  const nodesFrag = document.createDocumentFragment();
  drawNode(root);
  g.appendChild(edgesFrag);
  g.appendChild(nodesFrag);
  const width = containerWidth;
  const height = contentMaxY + 20;
  const padding = 24;
  svg.setAttribute("width", String(width));
  const elementPixelHeightPrereq = Math.max(height, (container.clientHeight || Math.floor(window.innerHeight * 0.8)));
  svg.setAttribute("height", String(elementPixelHeightPrereq));

  const baseViewBoxWidth = contentWidth + padding * 2;
  const baseViewBoxHeight = height;
  let didAutoZoomPrereq = false;
  if (S.shouldAutoZoomPrereq) {
    const clientH = container.clientHeight || Math.floor(window.innerHeight * 0.8);
    const target = Math.max(0.2, Math.min(1.0, clientH / (0.8 * baseViewBoxHeight)));
    S.prereqZoom = target;
    S.shouldAutoZoomPrereq = false;
    didAutoZoomPrereq = true;
  }

  // If the prereq tree is a single node, avoid magnifying it.
  const isSinglePrereq = !root?.children || (root.children.length === 0);
  if (isSinglePrereq) {
    const overscaleH = (elementPixelHeightPrereq || 1) / Math.max(1, baseViewBoxHeight);
    const overscaleW = (containerWidth || 1) / Math.max(1, baseViewBoxWidth);
    const overscale = Math.max(overscaleH, overscaleW);
    if (overscale > 1) {
      const target = 3.5 / overscale;
      const clamped = Math.max(0.8, target); // keep chip readable
      S.prereqZoom = Math.min(S.prereqZoom, clamped);
    }
  }
  const zoom = S.prereqZoom;
  const viewBoxWidthP = baseViewBoxWidth / zoom;
  const viewBoxHeightP = baseViewBoxHeight / zoom;
  const viewBoxXP = (baseViewBoxWidth - viewBoxWidthP) / 2;
  const viewBoxYP = (baseViewBoxHeight - viewBoxHeightP) / 2;
  svg.setAttribute("viewBox", `${viewBoxXP} ${viewBoxYP} ${viewBoxWidthP} ${viewBoxHeightP}`);
  svg.style.width = "";
  svg.style.height = "";
  g.setAttribute("transform", `translate(${baseTranslateX + padding},0)`);

  SvgUtils.setupMinimap(container, svg, { contentWidth: baseViewBoxWidth, contentHeight: baseViewBoxHeight });
  
  // Defer scroll restoration to allow browser to update layout
  requestAnimationFrame(()=>{
      if (didAutoZoomPrereq) {
        SvgUtils.centerTree(container);
      } else {
        // Preserve viewport center point relative to content center
        // Calculate offsets AFTER new content is rendered
        const newContentCenterX = container.scrollWidth / 2;
        const newContentCenterY = container.scrollHeight / 2;
        // Use the stored offsets from BEFORE the render to maintain relative position
        // But clamp to valid scroll ranges
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
