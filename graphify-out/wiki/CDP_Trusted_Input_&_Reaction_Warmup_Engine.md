# CDP Trusted Input & Reaction Warmup Engine

> 24 nodes · cohesion 0.12

## Key Concepts

- **background.js** (13 connections) — `extension/background.js`
- **doInject()** (7 connections) — `extension/background.js`
- **runWarmupTab()** (5 connections) — `extension/background.js`
- **findPostScope()** (5 connections) — `extension/background.js`
- **sidepanel.html (3-Tab Chrome Side Panel UI)** (5 connections) — `extension/sidepanel.html`
- **processNextInoteQueueItem()** (5 connections) — `extension/sidepanel.js`
- **getLiveAuthorName()** (4 connections) — `extension/background.js`
- **triggerStoreFlow()** (4 connections) — `extension/background.js`
- **restartAutoRefreshTimer()** (3 connections) — `extension/background.js`
- **executeGraphQLReaction()** (3 connections) — `extension/background.js`
- **findTargetReactionButton()** (3 connections) — `extension/background.js`
- **Dual-Layer Warmup Reaction (CDP Input.dispatchMouseEvent + Targeted GraphQL Mutation)** (3 connections) — `extension/REACTION_MECHANISM.md`
- **executeAutoRefreshTab()** (2 connections) — `extension/background.js`
- **findDockFlyoutButton()** (2 connections) — `extension/background.js`
- **stopAutoRefreshTimer()** (2 connections) — `extension/background.js`
- **#view-hunter (Video Ads Hunter Tab UI)** (2 connections) — `extension/sidepanel.html`
- **#view-manual (Manual Warmup & Inote Dispatcher Tab UI)** (2 connections) — `extension/sidepanel.html`
- **adLogsList** (1 connections) — `extension/background.js`
- **adsLibraryService** (1 connections) — `extension/background.js`
- **pickRandomReaction()** (1 connections) — `extension/background.js`
- **extractPostStoreUrl()** (1 connections) — `extension/background.js`
- **scannerState** (1 connections) — `extension/background.js`
- **REACTION_MECHANISM.md (CDP Trusted Hardware Input & CometUFIFeedbackReactMutation)** (1 connections) — `extension/REACTION_MECHANISM.md`
- **Rationale: Anchor findPostScope() on <video> element to avoid Notification Dialog Scope Trap** (1 connections) — `extension/REACTION_MECHANISM.md`

## Relationships

- [Sidepanel Hunter & Manual Queue Controller](Sidepanel_Hunter_&_Manual_Queue_Controller.md) (3 shared connections)
- [Ads Library GraphQL & Minea Counter Engine](Ads_Library_GraphQL_&_Minea_Counter_Engine.md) (2 shared connections)
- [Chrome Extension MV3 Manifest & Config](Chrome_Extension_MV3_Manifest_&_Config.md) (2 shared connections)
- [Ads Library GraphQL & Minea Counter Engine (Group 5)](Ads_Library_GraphQL_&_Minea_Counter_Engine_Group_5.md) (1 shared connections)
- [7-Step Super-Buyer Store Actor](7-Step_Super-Buyer_Store_Actor.md) (1 shared connections)
- [Sidepanel Find Ads & Minea Counter UI](Sidepanel_Find_Ads_&_Minea_Counter_UI.md) (1 shared connections)
- [M1 Sidepanel UI & Format Validation Suite](M1_Sidepanel_UI_&_Format_Validation_Suite.md) (1 shared connections)

## Source Files

- `extension/REACTION_MECHANISM.md`
- `extension/background.js`
- `extension/sidepanel.html`
- `extension/sidepanel.js`

## Audit Trail

- EXTRACTED: 41 (93%)
- INFERRED: 3 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*