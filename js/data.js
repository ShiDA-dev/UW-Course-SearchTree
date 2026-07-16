/**
 * Load static JSON and build prereq / reverse indexes.
 * Backend pipeline (scraper → DB → export) produces data/courses_data.json;
 * this module is the frontend's only data entry point.
 */
(function () {
  "use strict";
  const S = window.AppState;

function normalizeCode(text){
  if(!text) return "";
  return String(text).replace(/\s+/g, "").toUpperCase();
}

function buildIndexes(){
  // Index: course -> groups -> list of prereq course ids
  // We will keep structure: { [group]: { type: 'AND'|'OR', courses: [] } } with type computed from group size
  const map = new Map();
  for(const row of S.prereqRows){
    const courseId = normalizeCode(row.course_id || row.code || "");
    const prereqId = normalizeCode(row.prereq_course_id || "");
    if(!courseId || !prereqId) continue;
    const group = Number(row.prerequisite_group || 1);
    if(!map.has(courseId)) map.set(courseId, new Map());
    const groups = map.get(courseId);
    if(!groups.has(group)) groups.set(group, { type: 'AND', courses: [] });
    groups.get(group).courses.push({id: prereqId, min_grade: row.min_grade});
  }
  return map;
}

function buildReverseIndex(){
  const reverse = new Map();
  for(const row of S.prereqRows){
    const req = normalizeCode(row.prereq_course_id);
    const target = normalizeCode(row.course_id);
    if(!req || !target) continue;
    if(!reverse.has(req)) reverse.set(req, new Set());
    reverse.get(req).add(target);
  }
  return reverse;
}

async function loadData(){
  // Load static JSON data file (exported from database)
  S.statusEl.textContent = "Loading course data...";
  try {
    const response = await fetch('./data/courses_data.json');
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Load courses into Map
    S.courseIdToCourse = new Map();
    for (const [courseId, courseData] of Object.entries(data.courses)) {
      S.courseIdToCourse.set(courseId, courseData);
    }
    
    // Load prerequisites into flat array (for compatibility with existing code)
    S.prereqRows = [];
    for (const [courseId, groups] of Object.entries(data.prereqs)) {
      for (const group of groups) {
        for (const prereqCourse of group.courses) {
          S.prereqRows.push({
            course_id: courseId,
            prereq_course_id: prereqCourse.course_id,
            prerequisite_group: group.group,
            min_grade: prereqCourse.min_grade
          });
        }
      }
    }
    
    // Load global metrics for weighting
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
