/**
 * Search suggestions, fuzzy ranking, and recent-search history chips.
 */
(function () {
  "use strict";
  const S = window.AppState;
  const EXAMPLE_COURSE_CODES = ["CS136", "MATH136", "STAT230"];

function loadSearchHistory(){
  try{
    const raw = localStorage.getItem('uw_search_history') || '[]';
    const arr = JSON.parse(raw);
    if(Array.isArray(arr)) S.searchHistory = arr.slice(0, 10);
  }catch(_){ S.searchHistory = []; }
  renderSearchHistory();
}

function saveSearchHistory(){
  try{ localStorage.setItem('uw_search_history', JSON.stringify(S.searchHistory.slice(0,10))); }catch(_){ }
}

function addToSearchHistory(code){
  code = AppData.normalizeCode(code);
  if(!code) return;
  S.searchHistory = [code, ...S.searchHistory.filter(c => c !== code)].slice(0,10);
  saveSearchHistory();
  renderSearchHistory();
}

function renderSearchHistory(){
  if(!S.searchHistoryEl) return;
  // When no history, show example course chips so new users have one obvious action
  if(S.searchHistory.length === 0){
    S.searchHistoryEl.innerHTML = EXAMPLE_COURSE_CODES.map(code =>
      `<button type="button" class="history-item example-item" data-code="${code}">${code}</button>`
    ).join("");
    return;
  }
  // Render all first
  S.searchHistoryEl.innerHTML = S.searchHistory.map(code => `<button class="history-item" data-code="${code}">${code}</button>`).join("");
  // After render, trim from the right if overflowing the container
  // Keep left-to-right order with newest on the left per addToSearchHistory
  const maxWidth = S.searchHistoryEl.clientWidth;
  const children = Array.from(S.searchHistoryEl.children);
  let total = 0;
  for(let i=0;i<children.length;i++){
    const el = children[i];
    const w = el.offsetWidth + 8; // include gap
    if(total + w <= maxWidth){
      total += w;
    } else {
      // remove this and all to its right (rightmost end)
      for(let j=children.length-1;j>=i;j--){
        if(children[j].parentNode === S.searchHistoryEl) S.searchHistoryEl.removeChild(children[j]);
      }
      break;
    }
  }
}

function shouldSuggest(q){
  // Start suggesting from the second letter (at least 2 characters)
  return q.length >= 2;
}

function renderSuggestions(query){
  const q = (query || "").trim().toUpperCase();
  if(!q || !shouldSuggest(q)){
    S.suggestionsEl.classList.remove("visible");
    S.suggestionsEl.innerHTML = "";
    S.suggestionIndex = -1;
    return;
  }
  
  // Use static data for suggestions
  if(!S.staticDataLoaded){
    return; // Wait for data to load
  }
  
  // Debounce for better performance
  if(S.suggestTimer){ clearTimeout(S.suggestTimer); }
  S.suggestTimer = setTimeout(()=>{
    // Build suggestion list from static data
    const items = [];
    for(const [courseId, course] of S.courseIdToCourse.entries()){
      const code = courseId.toUpperCase();
      const name = (course.course_name || "").toUpperCase();
      
      // Match on code or name
      if(code.includes(q) || name.includes(q)){
        items.push({ 
          code: courseId, 
          title: course.course_name || "" 
        });
      }
    }
    
    // Rank and limit results after collecting all matches
    const ranked = rankFuzzy(items, q);
    renderSuggestionItems(ranked);
  }, 80);
}

function renderSuggestionItems(items){
  if(!items || items.length === 0){ S.suggestionsEl.classList.remove("visible"); S.suggestionsEl.innerHTML = ""; S.suggestionIndex = -1; return; }
  const seen = new Set();
  const deduped = [];
  for(const it of items){ if(!seen.has(it.code)){ seen.add(it.code); deduped.push(it); } }
  const top = deduped.slice(0, 20);
  // Preserve current index if still valid; otherwise default to first
  if(S.suggestionIndex < 0 || S.suggestionIndex >= top.length) S.suggestionIndex = 0;
  S.suggestionsEl.innerHTML = top.map((it, idx)=>
    `<div class="item${idx===S.suggestionIndex?" active":""}" role="option" data-code="${it.code}">`+
    `<span class="code">${it.code}</span>`+
    `<span class="title">${it.title}</span>`+
    `</div>`
  ).join("");
  S.suggestionsEl.classList.add("visible");
  // Ensure only one active item between keyboard and mouse interactions
  const itemsEls = S.suggestionsEl.querySelectorAll('.item');
  itemsEls.forEach((el, idx)=>{
    el.addEventListener('mouseenter', ()=>{
      S.suggestionIndex = idx;
      itemsEls.forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

function fuzzyMatch(text, q){
  // returns match score position or -1; sequential subsequence match
  text = (text || '').toUpperCase();
  q = (q || '').toUpperCase();
  
  // Prioritize exact prefix matches
  if(text.startsWith(q)){
    return 1000 + q.length; // High score for prefix matches
  }
  
  // Then prioritize matches at word boundaries (e.g., "CS" in "CS246")
  if(text.includes(q)){
    // Check if match is at a word boundary (start of string or after non-letter)
    const index = text.indexOf(q);
    if(index === 0 || !/[A-Z]/.test(text[index - 1])){
      return 500 + q.length; // Medium-high score for word boundary matches
    }
    return 100 + q.length; // Lower score for matches in middle of words
  }
  
  // Sequential subsequence match
  let ti = 0, qi = 0, score = 0, last = -1;
  while(ti < text.length && qi < q.length){
    if(text[ti] === q[qi]){ score += last === ti-1 ? 2 : 1; last = ti; qi++; }
    ti++;
  }
  return qi === q.length ? score : -1;
}

function rankFuzzy(items, q){
  const scored = items.map(it => {
    const codeScore = fuzzyMatch(it.code, q);
    const titleScore = fuzzyMatch(it.title || '', q);
    // Prioritize code matches over title matches by giving code matches 10x weight
    const s = codeScore >= 0 ? (codeScore * 10) : (titleScore >= 0 ? titleScore : -1);
    return { it, s };
  }).filter(x => x.s >= 0);
  scored.sort((a,b)=> b.s - a.s || a.it.code.localeCompare(b.it.code));
  return scored.map(x => x.it);
}

function pickSuggestion(code){
  if(!code) return;
  S.navigateToCourse(code);
}

  window.SearchUI = {
    loadSearchHistory: loadSearchHistory,
    saveSearchHistory: saveSearchHistory,
    addToSearchHistory: addToSearchHistory,
    renderSearchHistory: renderSearchHistory,
    renderSuggestions: renderSuggestions,
    pickSuggestion: pickSuggestion,
  };
})();
