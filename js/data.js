/**
 * Load static JSON and build prereq / reverse indexes.
 * Backend pipeline (scraper → DB → export) produces data/courses_data.json;
 * this module is the frontend's only data entry point.
 *
 * Prereq entry shapes:
 *   - Array of groups (legacy): groups are ANDed; each group's courses are ORed
 *     when length > 1 (tree-build may also honor an explicit group.type).
 *   - Object { groups_combine: "AND"|"OR", groups: [...] }: top-level combine
 *     controls how groups join; a group may nest { type, courses } entries.
 */
(function () {
  "use strict";
  const S = window.AppState;

function normalizeCode(text){
  if(!text) return "";
  return String(text).replace(/\s+/g, "").toUpperCase();
}

/** Normalize one course-or-nested entry from JSON into tree-build shape. */
function normalizePrereqEntry(entry){
  if(!entry || typeof entry !== "object") return null;
  if(entry.type && Array.isArray(entry.courses)){
    const nested = [];
    for(const c of entry.courses){
      const n = normalizePrereqEntry(c);
      if(n) nested.push(n);
    }
    return { type: String(entry.type).toUpperCase() === "AND" ? "AND" : "OR", courses: nested };
  }
  const id = normalizeCode(entry.course_id || entry.id || "");
  if(!id) return null;
  return { id, min_grade: entry.min_grade };
}

/** Walk normalized entries and yield leaf course ids (for reverse index / flat rows). */
function walkLeafIds(entry, out){
  if(!entry) return;
  if(entry.id){ out.push(entry.id); return; }
  if(entry.courses) for(const c of entry.courses) walkLeafIds(c, out);
}

function parsePrereqEntry(raw){
  if(Array.isArray(raw)){
    return { combine: "AND", groups: raw, source_note: null };
  }
  if(raw && typeof raw === "object"){
    const combine = String(raw.groups_combine || "AND").toUpperCase() === "OR" ? "OR" : "AND";
    return {
      combine,
      groups: Array.isArray(raw.groups) ? raw.groups : [],
      source_note: raw.source_note || null,
    };
  }
  return { combine: "AND", groups: [], source_note: null };
}

/**
 * Index: courseId → { combine, groups: Map<groupNum, { type, courses }> }
 * Nested OR/AND kept inside courses[].
 */
function buildIndexes(){
  const map = new Map();
  for(const row of S.prereqRows){
    // Legacy flat rows (no nesting) — used only when structured index absent.
    const courseId = normalizeCode(row.course_id || row.code || "");
    const prereqId = normalizeCode(row.prereq_course_id || "");
    if(!courseId || !prereqId) continue;
    if(S.prereqStructured && S.prereqStructured.has(courseId)) continue;
    const group = Number(row.prerequisite_group || 1);
    if(!map.has(courseId)) map.set(courseId, { combine: "AND", groups: new Map() });
    const entry = map.get(courseId);
    if(!entry.groups.has(group)) entry.groups.set(group, { type: "OR", courses: [] });
    entry.groups.get(group).courses.push({ id: prereqId, min_grade: row.min_grade });
  }
  if(S.prereqStructured){
    for(const [courseId, structured] of S.prereqStructured){
      map.set(courseId, structured);
    }
  }
  return map;
}

function buildReverseIndex(){
  const reverse = new Map();
  function addEdge(req, target){
    if(!req || !target) return;
    if(!reverse.has(req)) reverse.set(req, new Set());
    reverse.get(req).add(target);
  }
  if(S.prereqStructured){
    for(const [courseId, structured] of S.prereqStructured){
      for(const g of structured.groups.values()){
        const leaves = [];
        for(const c of g.courses) walkLeafIds(c, leaves);
        for(const leaf of leaves) addEdge(leaf, courseId);
      }
    }
  }
  for(const row of S.prereqRows){
    const req = normalizeCode(row.prereq_course_id);
    const target = normalizeCode(row.course_id);
    if(S.prereqStructured && S.prereqStructured.has(target)) continue;
    addEdge(req, target);
  }
  return reverse;
}

async function loadData(){
  S.statusEl.textContent = "Loading course data...";
  try {
    const response = await fetch('./data/courses_data.json');
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    const data = await response.json();

    S.courseIdToCourse = new Map();
    for (const [courseId, courseData] of Object.entries(data.courses)) {
      S.courseIdToCourse.set(courseId, courseData);
    }

    S.prereqRows = [];
    S.prereqStructured = new Map();

    for (const [courseId, raw] of Object.entries(data.prereqs)) {
      const parsed = parsePrereqEntry(raw);
      const groupsMap = new Map();
      for (const group of parsed.groups) {
        const gNum = Number(group.group || groupsMap.size + 1);
        const courses = [];
        for (const prereqCourse of group.courses || []) {
          const n = normalizePrereqEntry(prereqCourse);
          if (n) courses.push(n);
        }
        const explicitType = group.type ? String(group.type).toUpperCase() : null;
        const type = explicitType === "AND" || explicitType === "OR"
          ? explicitType
          : (courses.length > 1 ? "OR" : "AND");
        groupsMap.set(gNum, { type, courses });

        // Flat rows for tools that still expect them (leaf edges only).
        const leaves = [];
        for (const c of courses) walkLeafIds(c, leaves);
        for (const leaf of leaves) {
          S.prereqRows.push({
            course_id: courseId,
            prereq_course_id: leaf,
            prerequisite_group: gNum,
            min_grade: null,
          });
        }
      }
      S.prereqStructured.set(courseId, {
        combine: parsed.combine,
        groups: groupsMap,
        source_note: parsed.source_note,
      });
    }

    if (data.metrics) {
      S.metricsMedian = data.metrics.median || S.metricsMedian;
      S.metricsMin = data.metrics.min || S.metricsMin;
    }
    S.staticDataLoaded = true;
    S.statusEl.textContent = "";

    console.log(`✅ Loaded ${S.courseIdToCourse.size} courses and ${S.prereqRows.length} prerequisite relationships`);

  } catch (error) {
    console.error('Error loading static data:', error);
    S.statusEl.textContent = `Error loading course data: ${error.message}. Please refresh the page.`;
  }
}

  window.AppData = {
    normalizeCode: normalizeCode,
    buildIndexes: buildIndexes,
    buildReverseIndex: buildReverseIndex,
    loadData: loadData,
  };
})();
