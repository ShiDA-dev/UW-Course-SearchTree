/**
 * Build in-memory AND/OR prerequisite trees and future-course trees.
 * No SVG here — only data structure formation.
 */
(function () {
  "use strict";

function buildPrereqHierarchy(courseId, prereqIndex, maxDepth){
  // Depth counts course expansions inside baskets (1–3).
  // A course may appear on more than one branch; only an ancestor cycle stops expansion,
  // so raising depth still lengthens the highest-score chain.
  function dfs(courseInfo, depth, stack){
    const id = (typeof courseInfo === 'string') ? courseInfo : courseInfo.id;
    const min_grade = (typeof courseInfo === 'object') ? courseInfo.min_grade : undefined;
    
    // Assign unique uid to each node instance
    const uid = (function(){
      if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
      return window.__NODE_UID__++;
    })();

    if(depth >= maxDepth || stack.has(id)) return { id, groups: [], min_grade, uid };
    stack.add(id);
    
    const groupsMap = prereqIndex.get(id) || new Map();
    const groups = Array.from(groupsMap.keys()).sort((a,b)=>a-b).map(k=>{
      const g = groupsMap.get(k);
      const computedType = (g.courses.length > 1) ? 'OR' : 'AND';
      return { group:k, type:computedType, courses:g.courses };
    });
    // Build children with junction nodes
    const children = [];
    if(groups.length > 1){
      // Multiple AND groups: create an intermediate AND junction
      const andUid = (function(){
        if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
        return window.__NODE_UID__++;
      })();
      const andNode = { id: `and-${id}`, uid: andUid, children:[] };
    for(const g of groups){
        const orUid = (function(){
          if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
          return window.__NODE_UID__++;
        })();
        const orNode = { id: `or-group-${g.group}`, uid: orUid, children: g.courses.map(c => dfs(c, depth+1, stack)), isGroup: true };
        andNode.children.push(orNode);
      }
      children.push(andNode);
    } else if (groups.length === 1) {
      const g = groups[0];
      const orUid = (function(){
        if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
        return window.__NODE_UID__++;
      })();
      const orNode = { id: `or-group-${g.group}`, uid: orUid, children: g.courses.map(c => dfs(c, depth+1, stack)), isGroup: true };
      children.push(orNode);
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
