/**
 * Build in-memory AND/OR prerequisite trees and future-course trees.
 * No SVG here — only data structure formation.
 */
(function () {
  "use strict";

function buildPrereqHierarchy(courseId, prereqIndex, maxDepth){
  // Recursively expand prerequisites until leaves or max depth.
  // Depth counts course levels inside OR baskets (1–3). Cycle guard is
  // path-local so sibling branches can each expand the highest-score path.
  function nextUid(){
    if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
    return window.__NODE_UID__++;
  }
  function dfs(courseInfo, depth, pathSet){
    const id = (typeof courseInfo === 'string') ? courseInfo : courseInfo.id;
    const min_grade = (typeof courseInfo === 'object') ? courseInfo.min_grade : undefined;
    const uid = nextUid();

    // At max depth, or cycle on this path: leaf with no further groups
    if(depth >= maxDepth || pathSet.has(id)) return { id, groups: [], min_grade, uid, children: [] };

    pathSet.add(id);
    const groupsMap = prereqIndex.get(id) || new Map();
    const groups = Array.from(groupsMap.keys()).sort((a,b)=>a-b).map(k=>{
      const g = groupsMap.get(k);
      const computedType = (g.courses.length > 1) ? 'OR' : 'AND';
      return { group:k, type:computedType, courses:g.courses };
    });
    const children = [];
    if(groups.length > 1){
      const andNode = { id: `and-${id}`, uid: nextUid(), children:[] };
      for(const g of groups){
        const orNode = {
          id: `or-group-${g.group}`,
          uid: nextUid(),
          children: g.courses.map(c => dfs(c, depth+1, pathSet)),
          isGroup: true,
        };
        andNode.children.push(orNode);
      }
      children.push(andNode);
    } else if (groups.length === 1) {
      const g = groups[0];
      if (g.courses.length > 1) {
        const orNode = {
          id: `or-group-${g.group}`,
          uid: nextUid(),
          children: g.courses.map(c => dfs(c, depth+1, pathSet)),
          isGroup: true,
        };
        children.push(orNode);
      } else {
        children.push(...g.courses.map(c => dfs(c, depth+1, pathSet)));
      }
    }
    pathSet.delete(id);
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
