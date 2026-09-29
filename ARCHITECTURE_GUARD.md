# NEXORA Architecture Guard

## Clean-room wall
1. Do not copy code, engines, schemas, runtime files, state models, save logic, transaction logic, route logic, performance patches, or technical assumptions from the previous game.
2. Legacy behavior may be used only as a product requirement reference.
3. Every new subsystem must be designed from first principles using current authoritative sources where applicable.

## Change discipline
1. No random building and no patch-first fixes.
2. Before changing a path, trace its owner, callers, callees, state reads, state writes, side effects, persistence impact, and dependent engines.
3. Every performance-motivated change requires measurement before and after.
4. No cross-engine direct state writes.
5. No heavy work on the main thread.
6. No full-world scans in frame-critical paths.
7. No state mutation for purely visual motion.

## Agent execution gate
Sensitive implementation work must stop if the active agent/model cannot operate at the project's required very-high reasoning/effort level with adequate context.
When conversation/context quality degrades, stop sensitive changes and update PROJECT_CONTINUITY.md before moving to a new conversation.

## Diagnostic wall
Every core engine must expose trace IDs, timing, queue/work counters, failure context, and enough causal data to identify root cause rather than symptoms.
Diagnostics must remain bounded and low overhead.

## Scale gates
All core architecture is tested progressively at:
1k -> 5k -> 20k -> 50k -> 100k entities/assets.

20k with full gameplay behavior is the minimum acceptance gate. 100k is the architectural design target.
