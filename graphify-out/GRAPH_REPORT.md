# Graph Report - Extension-SPY-FEED-ADS-API  (2026-11-05)

## Corpus Check
- 27 files · ~97,469 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 3, .css 1, .bat 1)

## Summary
- 369 nodes · 711 edges · 14 communities (10 shown, 4 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `654785ce`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Newsfeed Hybrid Video Ads Scanner & Filter
- Ads Library GraphQL & Minea Counter Engine
- Sidepanel Hunter & Manual Queue Controller
- Chrome Extension MV3 Manifest & Config
- test_m1_ui_validation.js
- Ads Library GraphQL & Minea Counter Engine (Group 5)
- Sidepanel Find Ads & Minea Counter UI
- FindAdsRequestHandler
- 7-Step Super-Buyer Store Actor
- app.py
- Gemini Vision & DeepSeek AI Helper
- FacebookAdsHunterEngine

## God Nodes (most connected - your core abstractions)
1. `FacebookAdsHunterEngine` - 36 edges
2. `initFindAdsTab()` - 30 edges
3. `AdsLibraryGraphQLService` - 27 edges
4. `run_cli()` - 13 edges
5. `InoteService` - 13 edges
6. `start_search_job()` - 11 edges
7. `main()` - 11 edges
8. `runMasterStoreFlow()` - 11 edges
9. `reportProgress()` - 10 edges
10. `FindAdsRequestHandler` - 9 edges

## Surprising Connections (you probably didn't know these)
- `AdsLibraryGraphQLService` --implements--> `libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec)`  [EXTRACTED]
  extension/background.js → libary-API.md
- `auditAndFilterAd()` --implements--> `5-Criteria Dropship Video Ad Filter (External Store, Video, Unverified, MinLikes, Anti-Buff Ratio)`  [EXTRACTED]
  extension/content_script.js → extension/Video-Ads-Hunter.md
- `init()` --references--> `#view-hunter (Video Ads Hunter Tab UI)`  [EXTRACTED]
  extension/sidepanel.js → extension/sidepanel.html
- `default_path` --references--> `sidepanel.html (3-Tab Chrome Side Panel UI)`  [EXTRACTED]
  extension/manifest.json → extension/sidepanel.html
- `plane-test.md (GPM Login CDP Empirical Test Plan & Warmup Counter Root Cause Analysis)` --references--> `auditAndFilterAd()`  [EXTRACTED]
  extension/plane-test.md → extension/content_script.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Facebook Ads Library Search, Pagination & Inote Export Pipeline** — extension_sidepanel_initfindadstab, extension_sidepanel_initfindadstab_getsearchparams, extension_background_adslibrarygraphqlservice_searchandpaginateall, extension_background_adslibrarygraphqlservice_parserelayresponse, extension_background_adslibrarygraphqlservice_normalizeadnode, extension_background_inoteservice_createnote [EXTRACTED 1.00]
- **Minea Active vs Total Camp & Ratio % Analytics Flow** — extension_sidepanel_html_minea_counter, extension_sidepanel_initfindadstab_updatemineacounterui, extension_background_adslibrarygraphqlservice_fetchactivevstotalcounts, extension_background_adslibrarygraphqlservice_fetchcountwithretry, extension_background_adslibrarygraphqlservice_extractcountfromhtml [EXTRACTED 1.00]
- **Newsfeed Dual-Engine Video Ads Hunter Pipeline** — extension_injected_handleincominggraphqltext, extension_content_script_evaluategraphqlstory, extension_content_script_scandomads, extension_content_script_auditandfilterad, extension_sidepanel_renderadslist [EXTRACTED 1.00]
- **7-Step Super-Buyer E-Commerce Pixel Warmup Pipeline** — extension_background_triggerstoreflow, extension_store_actor_runmasterstoreflow, extension_store_actor_detectstoreplatform, extension_store_actor_addtocartandinitiatecheckout, extension_store_actor_filluscustomershippinginfo, extension_store_actor_simulatecreditcardpaymentandcount10s, extension_store_actor_simulatepaypalgatewayandcount10s [EXTRACTED 1.00]

## Communities (14 total, 4 thin omitted)

### Community 0 - "Newsfeed Hybrid Video Ads Scanner & Filter"
Cohesion: 0.12
Nodes (25): ADS_API_PLAYBOOK.md (Post Taxonomy P-01..P-08 & Comet DOM Fingerprints), Post Taxonomy Matrix (P-01 Organic to P-05 Target Video Ad & P-08 Boosted No Store), auditAndFilterAd(), checkWarmupExclusion(), cleanName(), decodeRelayId(), evaluateGraphqlStory(), extractDataFromDomCard() (+17 more)

### Community 1 - "Ads Library GraphQL & Minea Counter Engine"
Cohesion: 0.11
Nodes (18): { AdsLibraryGraphQLService, InoteService }, assert, backgroundPath, fs, path, runAllTests(), safeHtml(), testCase() (+10 more)

### Community 2 - "Sidepanel Hunter & Manual Queue Controller"
Cohesion: 0.15
Nodes (23): classifyLink(), createAdCardElement(), createLogCardElement(), escapeHTML(), getInoteLinksFromTextarea(), init(), onMouseInteractionDetected(), openExclusionModal() (+15 more)

### Community 3 - "Chrome Extension MV3 Manifest & Config"
Cohesion: 0.08
Nodes (24): AGENTS.md (Graphify Always-On Rules for Coding Agents), action, default_icon, default_title, background, service_worker, content_scripts, 128 (+16 more)

### Community 4 - "test_m1_ui_validation.js"
Cohesion: 0.06
Nodes (38): adLogsList, adsLibraryService, executeAutoRefreshTab(), restartAutoRefreshTimer(), runWarmupTab(), doInject(), executeGraphQLReaction(), findDockFlyoutButton() (+30 more)

### Community 5 - "Ads Library GraphQL & Minea Counter Engine (Group 5)"
Cohesion: 0.12
Nodes (6): AdsLibraryGraphQLService, InoteService, AdLibrarySearchPaginationQuery (doc_id 26617181747964058), Meta Relay @defer Multi-Chunk NDJSON Stream, libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec), runEmpiricalVerification()

### Community 6 - "Sidepanel Find Ads & Minea Counter UI"
Cohesion: 0.14
Nodes (29): #find-ads-start-preset-select (On or After 3/6/12/15/18/24 Months Dropdown), #find-ads-export-inote-btn (Export Ads to inote.net UI), #minea-active-total-box (Minea Active vs Total Camp & Ratio % UI), #view-find-ads (Facebook Ads Library Search Tab UI), initFindAdsTab(), appendIncomingBatchToCurrentPage(), applyPageHunterUIState(), calculatePastDate() (+21 more)

### Community 8 - "7-Step Super-Buyer Store Actor"
Cohesion: 0.32
Nodes (16): manual.md (Manual Tab: Inote Smart Dispatcher & 7-Step Super-Buyer Pixel), 7-Step Super-Buyer E-Commerce Pixel Warmup Flow (ViewContent -> AddToCart -> Checkout -> PCI/PayPal), addToCartAndInitiateCheckout(), detectStorePlatform(), fillCreditCardFieldsOnTopAndSameOrigin(), fillUSCustomerShippingInfo(), finalizeAndCloseStoreTab(), reportProgress() (+8 more)

### Community 9 - "app.py"
Cohesion: 0.06
Nodes (9): get_gpm_remote_debugging_port(), main(), parse_relay_deferred_response(), AppLogger, find_free_port(), main(), normalize_ui_filters(), start_search_job() (+1 more)

### Community 12 - "FacebookAdsHunterEngine"
Cohesion: 0.10
Nodes (8): run_cli(), FacebookAdsHunterEngine, minea_worker_loop(), worker_loop(), process_connection_edges(), InoteService, main(), on_progress()

## Knowledge Gaps
- **4 isolated node(s):** `Find-ads.md (Hybrid API Pagination & Physical Scroll Specification)`, `AGENTS.md (Graphify Always-On Rules for Coding Agents)`, `REACTION_MECHANISM.md (CDP Trusted Hardware Input & CometUFIFeedbackReactMutation)`, `manual.md (Manual Tab: Inote Smart Dispatcher & 7-Step Super-Buyer Pixel)`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 115 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AdsLibraryGraphQLService` connect `Ads Library GraphQL & Minea Counter Engine (Group 5)` to `Ads Library GraphQL & Minea Counter Engine`, `test_m1_ui_validation.js`?**
  _High betweenness centrality (0.488) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `initFindAdsTab()` (e.g. with `.fetchActiveVsTotalCounts()` and `.searchAndPaginateAll()`) actually correct?**
  _`initFindAdsTab()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Find-ads.md (Hybrid API Pagination & Physical Scroll Specification)`, `AGENTS.md (Graphify Always-On Rules for Coding Agents)`, `REACTION_MECHANISM.md (CDP Trusted Hardware Input & CometUFIFeedbackReactMutation)` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Newsfeed Hybrid Video Ads Scanner & Filter` be split into smaller, more focused modules?**
  _Cohesion score 0.11693548387096774 - nodes in this community are weakly interconnected._
- **Why does `libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec)` connect `Ads Library GraphQL & Minea Counter Engine (Group 5)` to `app.py`?**
  _High betweenness centrality (0.423) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `run_cli()` (e.g. with `_cb()` and `.fetch_active_vs_total_counts()`) actually correct?**
  _`run_cli()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `Ads Library GraphQL & Minea Counter Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.10666666666666667 - nodes in this community are weakly interconnected._