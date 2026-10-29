/**
 * Search suggestions and fuzzy ranking.
 * Search-history UI is deleted — Figma Explore SoT has no recent-search chips.
 */
(function () {
  "use strict";
  const S = window.AppState;

  // One-shot purge of legacy history storage from older builds
  try {
    localStorage.removeItem("uw_search_history");
  } catch (_) {}

  function shouldSuggest(q) {
    return q.length >= 2;
  }

  function renderSuggestions(query) {
    const q = (query || "").trim().toUpperCase();
    if (!q || !shouldSuggest(q)) {
      S.suggestionsEl.classList.remove("visible");
      S.suggestionsEl.innerHTML = "";
      S.suggestionIndex = -1;
      return;
    }

    if (!S.staticDataLoaded) return;

    if (S.suggestTimer) clearTimeout(S.suggestTimer);
    S.suggestTimer = setTimeout(() => {
      const items = [];
      for (const [courseId, course] of S.courseIdToCourse.entries()) {
        const code = courseId.toUpperCase();
        const name = (course.course_name || "").toUpperCase();
        if (code.includes(q) || name.includes(q)) {
          items.push({ code: courseId, title: course.course_name || "" });
        }
      }
      renderSuggestionItems(rankFuzzy(items, q));
    }, 80);
  }

  function renderSuggestionItems(items) {
    if (!items || items.length === 0) {
      S.suggestionsEl.classList.remove("visible");
      S.suggestionsEl.innerHTML = "";
      S.suggestionIndex = -1;
      return;
    }
    const seen = new Set();
    const deduped = [];
    for (const it of items) {
      if (!seen.has(it.code)) {
        seen.add(it.code);
        deduped.push(it);
      }
    }
    const top = deduped.slice(0, 20);
    if (S.suggestionIndex < 0 || S.suggestionIndex >= top.length) S.suggestionIndex = 0;
    S.suggestionsEl.innerHTML = top
      .map(
        (it, idx) =>
          `<div class="item${idx === S.suggestionIndex ? " active" : ""}" role="option" data-code="${it.code}">` +
          `<span class="code">${it.code}</span>` +
          `<span class="title">${it.title}</span>` +
          `</div>`
      )
      .join("");
    S.suggestionsEl.classList.add("visible");
    const itemsEls = S.suggestionsEl.querySelectorAll(".item");
    itemsEls.forEach((el, idx) => {
      el.addEventListener("mouseenter", () => {
        S.suggestionIndex = idx;
        itemsEls.forEach((x) => x.classList.remove("active"));
        el.classList.add("active");
      });
    });
  }

  function fuzzyMatch(text, q) {
    text = (text || "").toUpperCase();
    q = (q || "").toUpperCase();
    if (text.startsWith(q)) return 1000 + q.length;
    if (text.includes(q)) {
      const index = text.indexOf(q);
      if (index === 0 || !/[A-Z]/.test(text[index - 1])) return 500 + q.length;
      return 100 + q.length;
    }
    let ti = 0,
      qi = 0,
      score = 0,
      last = -1;
    while (ti < text.length && qi < q.length) {
      if (text[ti] === q[qi]) {
        score += last === ti - 1 ? 2 : 1;
        last = ti;
        qi++;
      }
      ti++;
    }
    return qi === q.length ? score : -1;
  }

  function rankFuzzy(items, q) {
    const scored = items
      .map((it) => {
        const codeScore = fuzzyMatch(it.code, q);
        const titleScore = fuzzyMatch(it.title || "", q);
        const s = codeScore >= 0 ? codeScore * 10 : titleScore >= 0 ? titleScore : -1;
        return { it, s };
      })
      .filter((x) => x.s >= 0);
    scored.sort((a, b) => b.s - a.s || a.it.code.localeCompare(b.it.code));
    return scored.map((x) => x.it);
  }

  function pickSuggestion(code) {
    if (!code) return;
    S.navigateToCourse(code);
  }

  window.SearchUI = {
    renderSuggestions: renderSuggestions,
    pickSuggestion: pickSuggestion,
  };
})();
