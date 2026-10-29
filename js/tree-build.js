/**
 * Build in-memory AND/OR prerequisite trees and future-course trees.
 * No SVG here — only data structure formation.
 *
 * Index shape from AppData.buildIndexes():
 *   courseId → { combine: "AND"|"OR", groups: Map<n, { type, courses }> }
 * Legacy Map<n, { type, courses }> still accepted (treated as combine AND).
 */
(function () {
  "use strict";

function nextUid(){
  if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
  return window.__NODE_UID__++;
}

function asCourseInfo(entry){
  if(typeof entry === "string") return { id: entry, min_grade: undefined };
  if(entry && entry.id) return { id: entry.id, min_grade: entry.min_grade };
  return null;
}

function isNestedGroup(entry){
  return !!(entry && entry.type && Array.isArray(entry.courses) && !entry.id);
}

function normalizeIndexEntry(raw){
  if(!raw) return { combine: "AND", groups: new Map() };
  if(raw.groups instanceof Map){
    return { combine: (raw.combine === "OR" ? "OR" : "AND"), groups: raw.groups };
  }
  if(raw instanceof Map){
    return { combine: "AND", groups: raw };
  }
  return { combine: "AND", groups: new Map() };
}

function buildPrereqHierarchy(courseId, prereqIndex, maxDepth){
  // Depth counts course expansions inside baskets (1–3).
  // A course may appear on more than one branch; only an ancestor cycle stops expansion,
  // so raising depth still lengthens the highest-score chain.
  function dfs(courseInfo, depth, stack){
    const id = (typeof courseInfo === "string") ? courseInfo : courseInfo.id;
    const min_grade = (typeof courseInfo === "object") ? courseInfo.min_grade : undefined;
    const uid = nextUid();

    if(depth >= maxDepth || stack.has(id)) return { id, groups: [], min_grade, uid };
    stack.add(id);

    const indexEntry = normalizeIndexEntry(prereqIndex.get(id));
    const groups = Array.from(indexEntry.groups.keys()).sort((a,b)=>a-b).map(k=>{
      const g = indexEntry.groups.get(k);
      const computedType = g.type || ((g.courses.length > 1) ? "OR" : "AND");
      return { group:k, type:computedType, courses:g.courses };
    });

    /** OR basket or AND junction; courses may nest {type, courses}. */
    function buildTypedGroup(type, courses, idBase){
      const uid = nextUid();
      if(type === "AND"){
        const andNode = {
          id: idBase.startsWith("and-") ? idBase : `and-${idBase}`,
          uid,
          children: [],
        };
        courses.forEach((entry, i) => {
          if(isNestedGroup(entry)){
            andNode.children.push(
              buildTypedGroup(entry.type, entry.courses, `${idBase}-n${i}`)
            );
          } else {
            const info = asCourseInfo(entry);
            if(!info) return;
            // Singleton OR basket so AND layout/labels stay basket-oriented.
            andNode.children.push({
              id: `or-group-${idBase}-${i}`,
              uid: nextUid(),
              children: [dfs(info, depth + 1, stack)],
              isGroup: true,
            });
          }
        });
        return andNode;
      }

      // OR: only leaf courses in this basket (nested AND belongs under AND groups).
      const orNode = { id: idBase, uid, children: [], isGroup: true };
      for(const entry of courses){
        if(isNestedGroup(entry)){
          if(entry.type === "OR"){
            for(const c of entry.courses){
              const info = asCourseInfo(c);
              if(info) orNode.children.push(dfs(info, depth + 1, stack));
            }
          } else {
            // AND nested under OR alternatives → sibling and-junction via combine wrapper
            // Caller should prefer groups_combine; still support inline nest:
            orNode.isGroup = false;
            if(!orNode.id.startsWith("or-")) orNode.id = `or-${orNode.id}`;
            const courseWrap = orNode.children.length
              ? [{
                  id: `${idBase}-leafs`,
                  uid: nextUid(),
                  children: orNode.children.slice(),
                  isGroup: true,
                }]
              : [];
            orNode.children = courseWrap.concat([
              buildTypedGroup(entry.type, entry.courses, `${idBase}-and`),
            ]);
          }
        } else {
          const info = asCourseInfo(entry);
          if(info){
            if(!orNode.isGroup){
              // Already demoted — append into first basket or as new basket
              let wrap = orNode.children.find(c => c.isGroup);
              if(!wrap){
                wrap = { id: `${idBase}-leafs`, uid: nextUid(), children: [], isGroup: true };
                orNode.children.unshift(wrap);
              }
              wrap.children.push(dfs(info, depth + 1, stack));
            } else {
              orNode.children.push(dfs(info, depth + 1, stack));
            }
          }
        }
      }
      return orNode;
    }

    function buildGroupNode(g){
      // Legacy JSON marks many single-required courses as type AND.
      // Keep those as a one-pill OR basket (old tree-build behavior).
      if(g.type === "AND"){
        if(g.courses.length === 1 && !isNestedGroup(g.courses[0])){
          return buildTypedGroup("OR", g.courses, `or-group-${g.group}`);
        }
        return buildTypedGroup("AND", g.courses, `or-group-${g.group}`);
      }
      return buildTypedGroup("OR", g.courses, `or-group-${g.group}`);
    }

    const children = [];
    if(groups.length > 1){
      if(indexEntry.combine === "OR"){
        children.push({
          id: `or-combine-${id}`,
          uid: nextUid(),
          children: groups.map(buildGroupNode),
        });
      } else {
        children.push({
          id: `and-${id}`,
          uid: nextUid(),
          children: groups.map(buildGroupNode),
        });
      }
    } else if (groups.length === 1) {
      children.push(buildGroupNode(groups[0]));
    }
    stack.delete(id);
    return { id, uid, groups, children, min_grade };
  }
  return dfs(courseId, 0, new Set());
}

function buildFutureHierarchy(courseId, reverseIndex, depth){
  const visited = new Set();
  function expand(id, d){
    if(d > depth) return { id };
    if(visited.has(id)) return { id };
    visited.add(id);
    const next = Array.from(reverseIndex.get(id) || []);
    return { id, children: next.map(n=>expand(n, d+1)) };
  }
  return expand(courseId, 1);
}

  window.TreeBuild = {
    buildPrereqHierarchy: buildPrereqHierarchy,
    buildFutureHierarchy: buildFutureHierarchy,
  };
})();
