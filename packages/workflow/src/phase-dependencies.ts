export interface PhaseDependencyEdge {
  phaseId: string;
  dependsOnPhaseId: string;
}

/** Validates replacement edges without IO or changing execution readiness. */
export function validatePhaseDependencies(
  phaseIds: readonly string[],
  edges: readonly PhaseDependencyEdge[],
  phaseId: string,
  dependencyIds: readonly string[],
): 'DUPLICATE' | 'SELF' | 'FOREIGN' | 'CYCLE' | null {
  if (new Set(dependencyIds).size !== dependencyIds.length) return 'DUPLICATE';
  if (dependencyIds.includes(phaseId)) return 'SELF';
  const known = new Set(phaseIds);
  if (!known.has(phaseId) || dependencyIds.some((id) => !known.has(id))) return 'FOREIGN';
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.phaseId === phaseId) continue;
    const targets = graph.get(edge.phaseId) ?? [];
    targets.push(edge.dependsOnPhaseId);
    graph.set(edge.phaseId, targets);
  }
  graph.set(phaseId, [...dependencyIds]);
  const active = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    active.add(id);
    for (const target of graph.get(id) ?? []) if (cycle(target)) return true;
    active.delete(id);
    visited.add(id);
    return false;
  };
  return phaseIds.some(cycle) ? 'CYCLE' : null;
}
