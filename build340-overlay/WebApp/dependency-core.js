(() => {
  'use strict';

  const VERSION = '3.0.0';
  const TERMINAL_STATUSES = new Set(['resolved', 'cancelled']);

  function ensure(state) {
    state.dependencyGraph = state.dependencyGraph && typeof state.dependencyGraph === 'object'
      ? state.dependencyGraph
      : {};
    const graph = state.dependencyGraph;
    graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
    graph.updatedAtSim = Number(graph.updatedAtSim) || 0;
    return graph;
  }

  function edgeKey(parentId, childId, type) {
    return `${parentId}|${childId}|${type || 'depends_on'}`;
  }

  function link(state, parentId, childId, type = 'depends_on', meta = {}) {
    const graph = ensure(state);
    const key = edgeKey(parentId, childId, type);
    let edge = graph.edges.find(candidate => candidate.key === key);
    if (!edge) {
      edge = {
        key,
        parentId: String(parentId),
        childId: String(childId),
        type: String(type),
        status: 'open',
        createdAtSim: Number(state.simSeconds) || 0,
        meta: { ...meta }
      };
      graph.edges.push(edge);
    } else {
      edge.meta = { ...(edge.meta || {}), ...meta };
    }
    graph.updatedAtSim = Number(state.simSeconds) || 0;
    return edge;
  }

  function setStatus(state, parentId, childId, type, status) {
    const edge = ensure(state).edges.find(candidate => candidate.key === edgeKey(parentId, childId, type));
    if (!edge) return false;
    edge.status = String(status);
    edge.updatedAtSim = Number(state.simSeconds) || 0;
    return true;
  }

  function children(state, parentId) {
    return ensure(state).edges.filter(edge => edge.parentId === String(parentId));
  }

  function parents(state, childId) {
    return ensure(state).edges.filter(edge => edge.childId === String(childId));
  }

  function unresolved(state, parentId) {
    return children(state, parentId).filter(edge => !TERMINAL_STATUSES.has(edge.status));
  }

  function detectCycles(state) {
    const edges = Array.isArray(state?.dependencyGraph?.edges) ? state.dependencyGraph.edges : [];
    const adjacency = new Map();
    for (const edge of edges) {
      if (TERMINAL_STATUSES.has(edge.status)) continue;
      if (!adjacency.has(edge.parentId)) adjacency.set(edge.parentId, []);
      adjacency.get(edge.parentId).push(edge.childId);
    }

    // Iterative depth-first traversal avoids call-stack overflow in large saves.
    // Child order and cycle path construction match the former recursive walk.
    const visiting = new Set();
    const complete = new Set();
    const path = [];
    const cycles = [];

    for (const root of adjacency.keys()) {
      if (complete.has(root)) continue;
      const frames = [{ node: root, nextChild: 0 }];
      path.push(root);
      visiting.add(root);

      while (frames.length) {
        const frame = frames[frames.length - 1];
        const childrenOfNode = adjacency.get(frame.node) || [];
        if (frame.nextChild >= childrenOfNode.length) {
          visiting.delete(frame.node);
          complete.add(frame.node);
          frames.pop();
          path.pop();
          continue;
        }

        const child = childrenOfNode[frame.nextChild++];
        if (visiting.has(child)) {
          const cycleStart = path.indexOf(child);
          // The prior recursive contract appended the back-edge node to its
          // path before recording the repeated active node. Preserve that exact
          // output shape for existing diagnostic consumers.
          cycles.push(path.slice(cycleStart).concat(child, child));
          continue;
        }
        if (complete.has(child)) continue;

        visiting.add(child);
        path.push(child);
        frames.push({ node: child, nextChild: 0 });
      }
    }
    return cycles;
  }

  function compact(state, validIds = null) {
    const graph = ensure(state);
    if (validIds instanceof Set) {
      graph.edges = graph.edges.filter(edge => validIds.has(edge.parentId) || validIds.has(edge.childId));
    }
    if (graph.edges.length > 1600) graph.edges = graph.edges.slice(-1600);
    return graph.edges.length;
  }

  const API = Object.freeze({ VERSION, ensure, link, setStatus, children, parents, unresolved, detectCycles, compact });
  globalThis.GH_DEPENDENCY_CORE = API;
  if (globalThis.window && globalThis.window !== globalThis) {
    globalThis.window.GH_DEPENDENCY_CORE = API;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
