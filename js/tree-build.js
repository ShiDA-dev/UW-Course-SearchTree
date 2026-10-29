/**
 * Build in-memory AND/OR prerequisite trees and future-course trees.
 * No SVG here — only data structure formation.
 */
(function () {
  "use strict";

function buildPrereqHierarchy(courseId, prereqIndex, maxDepth){
  // Recursively expand prerequisites until leaves or max depth
  // Tree build: start at depth=0, use depth >= maxDepth
  const visited = new Set();
  function dfs(courseInfo, depth){
    const id = (typeof courseInfo === 'string') ? courseInfo : courseInfo.id;
    const min_grade = (typeof courseInfo === 'object') ? courseInfo.min_grade : undefined;
    
    // Assign unique uid to each node instance
    const uid = (function(){
      if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
      return window.__NODE_UID__++;
    })();

    // Stop expanding if we've hit the depth limit or already visited
    // At max depth: return leaf node with no groups
    if(depth >= maxDepth || visited.has(id)) return { id, groups: [], min_grade, uid };
    visited.add(id);
    
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
        const orNode = { id: `or-group-${g.group}`, uid: orUid, children: g.courses.map(c => dfs(c, depth+1)), isGroup: true };
        andNode.children.push(orNode);
      }
      children.push(andNode);
    } else if (groups.length === 1) {
      const g = groups[0];
      if (g.courses.length > 1) {
        // Single OR group, needs a junction
        const orUid = (function(){
          if(!window.__NODE_UID__) window.__NODE_UID__ = 1;
          return window.__NODE_UID__++;
        })();
        const orNode = { id: `or-group-${g.group}`, uid: orUid, children: g.courses.map(c => dfs(c, depth+1)), isGroup: true };
        children.push(orNode);
      } else {
        // Single course, no group node needed, just the course itself
        children.push(...g.courses.map(c => dfs(c, depth+1)));
      }
    }
    return { id, uid, groups, children, min_grade };
  }
  return dfs(courseId, 0);
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
