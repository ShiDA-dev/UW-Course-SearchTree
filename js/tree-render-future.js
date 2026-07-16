/**
 * Render the future-courses tree as SVG (left-to-right).
 */
(function () {
  "use strict";
  const S = window.AppState;

function renderSideTree(container, root, isFuture){
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
  const HORIZONTAL_GAP = 24; // minimal horizontal space between levels
  const siblingGap = 12; // vertical gap between siblings

  // Use node object references as keys to avoid collisions when the same
  // course id appears in multiple branches. Using ids would collapse nodes.
  const positions = new Map();

  // Compute compact widths per course id so boxes only take the space they need
  const widthById = new Map();
  let maxNodeWidth = 0;
  (function collect(n){
    const label = S.courseIdToCourse.get(n.id)?.course_id || n.id;
    // Estimate text width: base padding + approx 8px per char, clamped
    const est = Math.max(56, Math.min(180, 14 + (label.length * 8)));
    widthById.set(n.id, est);
    if(est > maxNodeWidth) maxNodeWidth = est;
    for(const c of (n.children || [])) collect(c);
  })(root);

  // Determine depth first to compute a level gap that fills available width
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
  // Compute layout with DFS stacking along y
  let yCursor = 0;
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
      yCursor += NODE_HEIGHT + siblingGap;
    }
    const pos = { x: depth * levelGap, y };
    positions.set(node, pos);
    return pos;
  }

  layout(root, 0);

  // Content width for non-mirrored layout (used as basis for mirroring)
  const nominalContentWidth = (maxDepth + 1) * levelGap + maxNodeWidth + 10;
  const reverse = !isFuture; // reverse only the prerequisites tree
  function getWidth(node){ return widthById.get(node.id) || maxNodeWidth; }
  function nodePos(node){
    const p = positions.get(node);
    if(!reverse) return p;
    const w = getWidth(node);
    return { x: nominalContentWidth - (p.x + w), y: p.y };
  }

  // Compute tight bounds after optional mirroring for proper centering
  let minX = Infinity, maxX = -Infinity;
  const allNodes = new Set();
  const inDegree = new Map();
  (function measure(n){
    allNodes.add(n);
    const p = nodePos(n);
    const w = getWidth(n);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + w);
    for(const c of (n.children || [])){
      inDegree.set(c, (inDegree.get(c) || 0) + 1);
      measure(c);
    }
  })(root);
  const baseTranslateX = isFinite(minX) ? -minX : 0;
  const contentWidth = isFinite(maxX - minX) ? (maxX - minX) : nominalContentWidth;

  // Draw edges (batched)
  const drawnEdges = new Set();
  const edgeFrag = document.createDocumentFragment();
  function drawEdges(node){
    const p = nodePos(node);
    for(const child of (node.children || [])){
      const c = nodePos(child);
      // Avoid drawing duplicate edges for repeated child entries
      const edgeKey = `${node.id}->${child.id}`;
      if(!drawnEdges.has(edgeKey)){
        drawnEdges.add(edgeKey);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const startX = reverse ? p.x : (p.x + getWidth(node));
        const startY = p.y + NODE_HEIGHT/2;
        const endX = reverse ? (c.x + getWidth(child)) : c.x;
        const endY = c.y + NODE_HEIGHT/2;
        // Straight connector
        const d = `M ${startX} ${startY} L ${endX} ${endY}`;
        path.setAttribute("d", d);
        path.setAttribute("class", isFuture ? "edge-future" : "edge");
        edgeFrag.appendChild(path);
      }
      drawEdges(child);
    }
  }

  drawEdges(root);
  g.appendChild(edgeFrag);

  // Draw nodes (batched)
  const nodeFrag = document.createDocumentFragment();
  function drawNode(node){
    const pos = nodePos(node);
    const w = getWidth(node);

    const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    nodeGroup.setAttribute("class", "clickable-node");
    nodeGroup.addEventListener('click', (e) => {
      e.preventDefault();
      S.navigateToCourse(node.id);
    });
    nodeFrag.appendChild(nodeGroup);

    SvgUtils.rect(nodeGroup, pos.x, pos.y, w, NODE_HEIGHT, 8, "node");
    const label = S.courseIdToCourse.get(node.id)?.course_id || node.id;
    SvgUtils.svgText(nodeGroup, pos.x + 8, pos.y + NODE_HEIGHT/2, label, "node-label", "start", "middle");

    for(const child of (node.children || [])) drawNode(child);
  }

  drawNode(root);
  g.appendChild(nodeFrag);

  // Resize SVG to content, and center the tree within the container width
  const width = containerWidth;
  const height = Math.max(yCursor, NODE_HEIGHT + 20);
  svg.setAttribute("width", String(width));
  const elementPixelHeightFuture = Math.max(height, (container.clientHeight || Math.floor(window.innerHeight * 0.8)));
  svg.setAttribute("height", String(elementPixelHeightFuture));
  // Base viewBox equals tight content bounds before zoom
  const baseViewBoxWidth = contentWidth;
  const baseViewBoxHeight = height;

  let didAutoZoomFuture = false;
  if (S.shouldAutoZoomFuture) {
    const clientH = container.clientHeight || Math.floor(window.innerHeight * 0.8);
    // Choose zoom so visible fraction >= 80%; don't zoom in above 1.0
    const target = Math.max(0.2, Math.min(1.0, clientH / (0.8 * baseViewBoxHeight)));
    S.futureZoom = target;
    S.shouldAutoZoomFuture = false;
    didAutoZoomFuture = true;
  }

  // If the tree has only one node, avoid magnifying it to container size.
  const isSingleFuture = !root?.children || (root.children.length === 0);
  if (isSingleFuture) {
    const overscaleH = (elementPixelHeightFuture || 1) / Math.max(1, baseViewBoxHeight);
    const overscaleW = (containerWidth || 1) / Math.max(1, baseViewBoxWidth);
    const overscale = Math.max(overscaleH, overscaleW);
    if (overscale > 1) {
      const target = 3.5 / overscale; // scale down so size remains normal
      S.futureZoom = Math.min(S.futureZoom, target);
    }
  }

  const zoom = S.futureZoom;
  // Zoom by shrinking the viewBox so content appears larger while
  // keeping intrinsic SVG size managed by earlier width/height attrs
  const viewBoxWidthF = baseViewBoxWidth / zoom;
  const viewBoxHeightF = baseViewBoxHeight / zoom;
  const viewBoxXF = (baseViewBoxWidth - viewBoxWidthF) / 2;
  const viewBoxYF = (baseViewBoxHeight - viewBoxHeightF) / 2;
  svg.setAttribute("viewBox", `${viewBoxXF} ${viewBoxYF} ${viewBoxWidthF} ${viewBoxHeightF}`);
  svg.style.width = "";
  svg.style.height = "";

  // Translate to remove left margin and let preserveAspectRatio center the result
  g.setAttribute("transform", `translate(${baseTranslateX},0)`);

  SvgUtils.setupMinimap(container, svg, { contentWidth: baseViewBoxWidth, contentHeight: baseViewBoxHeight, zoom: isFuture ? S.futureZoom : S.prereqZoom });
  
  // Defer scroll restoration to allow browser to update layout
  requestAnimationFrame(()=>{
    if (didAutoZoomFuture) {
      SvgUtils.centerTree(container);
    } else {
      // Preserve viewport center point relative to content center
      const newContentCenterX = container.scrollWidth / 2;
      const newContentCenterY = container.scrollHeight / 2;
      container.scrollLeft = Math.max(0, newContentCenterX + offsetX - container.clientWidth / 2);
      container.scrollTop = Math.max(0, newContentCenterY + offsetY - container.clientHeight / 2);
    }
  });
}

  window.FutureTree = {
    render: renderSideTree,
  };
})();
