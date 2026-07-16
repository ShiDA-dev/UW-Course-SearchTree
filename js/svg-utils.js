/**
 * SVG helpers: create SVG roots, draw shapes, center scroll, minimap.
 */
(function () {
  "use strict";
  const S = window.AppState;

function makeSVG(container){
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);
  container.appendChild(svg);
  // Make sure intrinsic sizing works across browsers
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return { svg, g };
}

function setupMinimap(scrollableContainer, mainSvg, contentDims) {
    let minimapContainer;
    if (scrollableContainer.id === 'prereq-tree') {
        minimapContainer = S.prereqMinimapContainer;
    } else if (scrollableContainer.id === 'future-tree') {
        minimapContainer = S.futureMinimapContainer;
    } else {
        return;
    }
    if (!minimapContainer) return;

    const { contentWidth, contentHeight } = contentDims;
    const isScrollable = scrollableContainer.scrollHeight > scrollableContainer.clientHeight || scrollableContainer.scrollWidth > scrollableContainer.clientWidth;

    if (!isScrollable) {
        minimapContainer.classList.remove('visible');
        return;
    }

    minimapContainer.classList.add('visible');
    minimapContainer.innerHTML = '';
    const minimapSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const minimapG = mainSvg.querySelector('g').cloneNode(true);
    minimapSvg.appendChild(minimapG);
    minimapContainer.appendChild(minimapSvg);

    minimapSvg.addEventListener('click', (e) => {
        e.preventDefault();
        const minimapWidth = minimapContainer.clientWidth;
        const scale = minimapWidth / contentWidth;
        
        const targetSvgX = e.offsetX / scale;
        const targetSvgY = e.offsetY / scale;

        const mainViewBox = mainSvg.getAttribute('viewBox').split(' ').map(Number);
        const [vx, vy, vw, vh] = mainViewBox;

        const mainClientRect = mainSvg.getBoundingClientRect();
        if (mainClientRect.width === 0 || mainClientRect.height === 0) return;

        const scaleX = vw / mainClientRect.width;
        const scaleY = vh / mainClientRect.height;

        const clientWidth = scrollableContainer.clientWidth;
        const clientHeight = scrollableContainer.clientHeight;

        let newScrollLeft = ((targetSvgX - vx) / scaleX) - (clientWidth / 2);
        let newScrollTop = ((targetSvgY - vy) / scaleY) - (clientHeight / 2);

        scrollableContainer.scroll({
            left: newScrollLeft,
            top: newScrollTop,
            behavior: 'smooth'
        });
    });

    const minimapWidth = minimapContainer.clientWidth;
    const scale = minimapWidth / contentWidth;
    const minimapHeight = contentHeight * scale;

    minimapSvg.setAttribute('viewBox', `0 0 ${contentWidth} ${contentHeight}`);
    minimapSvg.setAttribute('width', minimapWidth);
    minimapSvg.setAttribute('height', minimapHeight);

    const viewportRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    viewportRect.setAttribute('class', 'minimap-viewport');
    minimapSvg.appendChild(viewportRect);

    function updateViewport() {
        const mainViewBox = mainSvg.getAttribute('viewBox').split(' ').map(Number);
        const [vx, vy, vw, vh] = mainViewBox;

        const mainClientRect = mainSvg.getBoundingClientRect();
        if (mainClientRect.width === 0 || mainClientRect.height === 0) return;

        const scaleX = vw / mainClientRect.width;
        const scaleY = vh / mainClientRect.height;

        const { scrollLeft, scrollTop, clientWidth, clientHeight } = scrollableContainer;

        const rectX = vx + scrollLeft * scaleX;
        const rectY = vy + scrollTop * scaleY;
        const rectW = clientWidth * scaleX;
        const rectH = clientHeight * scaleY;

        viewportRect.setAttribute('x', rectX);
        viewportRect.setAttribute('y', rectY);
        viewportRect.setAttribute('width', rectW);
        viewportRect.setAttribute('height', rectH);
    }

    // Throttle scroll-driven updates via rAF and use passive listener
    let __minimapRaf = 0;
    function scheduleViewportUpdate(){
        if(__minimapRaf) return;
        __minimapRaf = requestAnimationFrame(()=>{ __minimapRaf = 0; updateViewport(); });
    }

    scrollableContainer.addEventListener('scroll', scheduleViewportUpdate, { passive: true });
    const observer = new MutationObserver(() => scheduleViewportUpdate());
    observer.observe(mainSvg, { attributes: true, attributeFilter: ['viewBox'] });
    updateViewport();
}

function rect(g, x, y, w, h, r, className){
  const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(w));
  el.setAttribute("height", String(h));
  el.setAttribute("rx", String(r));
  el.setAttribute("class", className);
  g.appendChild(el);
  return el;
}

function svgText(g, x, y, text, className, textAnchor, dominantBaseline){
  const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  if(className) t.setAttribute("class", className);
  if(textAnchor) t.setAttribute("text-anchor", textAnchor);
  if(dominantBaseline) t.setAttribute("dominant-baseline", dominantBaseline);
  t.textContent = text;
  g.appendChild(t);
  return t;
}

function centerTree(container) {
  const scrollWidth = container.scrollWidth;
  const scrollHeight = container.scrollHeight;
  const clientWidth = container.clientWidth;
  const clientHeight = container.clientHeight;
  container.scrollLeft = (scrollWidth - clientWidth) / 2;
  container.scrollTop = (scrollHeight - clientHeight) / 2;
}

  window.SvgUtils = {
    makeSVG: makeSVG,
    setupMinimap: setupMinimap,
    rect: rect,
    svgText: svgText,
    centerTree: centerTree,
  };
})();
