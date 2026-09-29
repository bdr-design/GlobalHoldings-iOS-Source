# PROJECT_CONTINUITY

Project: NEXORA
Repository: bdr-design/GlobalHoldings-iOS-Source
Branch: nexora-clean-room
Status: Clean-room genesis

## Current rules
- NEXORA is technically independent from the previous game.
- Previous game = ideas/features only, never technical source.
- Smoothness, sustained performance, thermal behavior, and diagnosability are first-class architecture requirements.
- Company architecture will be capability-based and composable so future industries can be added without changing the kernel.
- Financial documents such as incoming/outgoing transfers, cheque images, receipts, and proofs will be supported as product features using a new document-store design rather than embedding large media in core state.
- Build diagnostics/black-box tracing before deep game content.

## First implementation milestone
Design and validate:
1. State Kernel
2. Simulation Clock
3. Event Scheduler
4. Job System
5. Incremental Persistence
6. Diagnostics / Black Box
7. Performance & Thermal Governor

No industry gameplay implementation should precede proof of the core scale architecture.
