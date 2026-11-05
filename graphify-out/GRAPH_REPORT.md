# Graph Report - Extension-SPY-FEED-ADS-API  (2026-11-05)

## Corpus Check
- 28 files · ~76,864 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 3, .css 1)

## Summary
- 248 nodes · 410 edges · 12 communities (10 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.88)
- Token cost: 18,500 input · 4,200 output

## Community Hubs (Navigation)
- Newsfeed Hybrid Video Ads Scanner & Filter
- Ads Library GraphQL & Minea Counter Engine
- Sidepanel Hunter & Manual Queue Controller
- Chrome Extension MV3 Manifest & Config
- CDP Trusted Input & Reaction Warmup Engine
- Ads Library GraphQL & Minea Counter Engine (Group 5)
- Sidepanel Find Ads & Minea Counter UI
- M1 Sidepanel UI & Format Validation Suite
- 7-Step Super-Buyer Store Actor
- GPM Login & Playwright CDP Automation
- Gemini Vision & DeepSeek AI Helper

## God Nodes (most connected - your core abstractions)
1. `AdsLibraryGraphQLService` - 22 edges
2. `initFindAdsTab()` - 22 edges
3. `runMasterStoreFlow()` - 11 edges
4. `reportProgress()` - 10 edges
5. `evaluateGraphqlStory()` - 9 edges
6. `extractDataFromDomCard()` - 8 edges
7. `init()` - 8 edges
8. `AIHelper` - 7 edges
9. `doInject()` - 7 edges
10. `auditAndFilterAd()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `AdsLibraryGraphQLService` --implements--> `libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec)`  [EXTRACTED]
  extension/background.js → libary-API.md
- `auditAndFilterAd()` --implements--> `5-Criteria Dropship Video Ad Filter (External Store, Video, Unverified, MinLikes, Anti-Buff Ratio)`  [EXTRACTED]
  extension/content_script.js → extension/Video-Ads-Hunter.md
- `default_path` --references--> `sidepanel.html (3-Tab Chrome Side Panel UI)`  [EXTRACTED]
  extension/manifest.json → extension/sidepanel.html
- `init()` --references--> `#view-hunter (Video Ads Hunter Tab UI)`  [EXTRACTED]
  extension/sidepanel.js → extension/sidepanel.html
- `runEmpiricalVerification()` --calls--> `AdsLibraryGraphQLService`  [EXTRACTED]
  test_empirical_verification.js → extension/background.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Facebook Ads Library Search, Pagination & Inote Export Pipeline** — extension_sidepanel_initfindadstab, extension_sidepanel_initfindadstab_getsearchparams, extension_background_adslibrarygraphqlservice_searchandpaginateall, extension_background_adslibrarygraphqlservice_parserelayresponse, extension_background_adslibrarygraphqlservice_normalizeadnode, extension_background_inoteservice_createnote [EXTRACTED 1.00]
- **Minea Active vs Total Camp & Ratio % Analytics Flow** — extension_sidepanel_html_minea_counter, extension_sidepanel_initfindadstab_updatemineacounterui, extension_background_adslibrarygraphqlservice_fetchactivevstotalcounts, extension_background_adslibrarygraphqlservice_fetchcountwithretry, extension_background_adslibrarygraphqlservice_extractcountfromhtml [EXTRACTED 1.00]
- **Newsfeed Dual-Engine Video Ads Hunter Pipeline** — extension_injected_handleincominggraphqltext, extension_content_script_evaluategraphqlstory, extension_content_script_scandomads, extension_content_script_auditandfilterad, extension_sidepanel_renderadslist [EXTRACTED 1.00]
- **7-Step Super-Buyer E-Commerce Pixel Warmup Pipeline** — extension_background_triggerstoreflow, extension_store_actor_runmasterstoreflow, extension_store_actor_detectstoreplatform, extension_store_actor_addtocartandinitiatecheckout, extension_store_actor_filluscustomershippinginfo, extension_store_actor_simulatecreditcardpaymentandcount10s, extension_store_actor_simulatepaypalgatewayandcount10s [EXTRACTED 1.00]

## Communities (12 total, 2 thin omitted)

### Community 0 - "Newsfeed Hybrid Video Ads Scanner & Filter"
Cohesion: 0.12
Nodes (25): ADS_API_PLAYBOOK.md (Post Taxonomy P-01..P-08 & Comet DOM Fingerprints), Post Taxonomy Matrix (P-01 Organic to P-05 Target Video Ad & P-08 Boosted No Store), auditAndFilterAd(), checkWarmupExclusion(), cleanName(), decodeRelayId(), evaluateGraphqlStory(), extractDataFromDomCard() (+17 more)

### Community 1 - "Ads Library GraphQL & Minea Counter Engine"
Cohesion: 0.09
Nodes (20): InoteService, { AdsLibraryGraphQLService, InoteService }, assert, backgroundPath, fs, path, runAllTests(), safeHtml() (+12 more)

### Community 2 - "Sidepanel Hunter & Manual Queue Controller"
Cohesion: 0.15
Nodes (23): classifyLink(), createAdCardElement(), createLogCardElement(), escapeHTML(), getInoteLinksFromTextarea(), init(), onMouseInteractionDetected(), openExclusionModal() (+15 more)

### Community 3 - "Chrome Extension MV3 Manifest & Config"
Cohesion: 0.08
Nodes (24): AGENTS.md (Graphify Always-On Rules for Coding Agents), action, default_icon, default_title, background, service_worker, content_scripts, 128 (+16 more)

### Community 4 - "CDP Trusted Input & Reaction Warmup Engine"
Cohesion: 0.12
Nodes (20): adLogsList, adsLibraryService, executeAutoRefreshTab(), restartAutoRefreshTimer(), runWarmupTab(), doInject(), executeGraphQLReaction(), findDockFlyoutButton() (+12 more)

### Community 5 - "Ads Library GraphQL & Minea Counter Engine (Group 5)"
Cohesion: 0.17
Nodes (4): AdsLibraryGraphQLService, AdLibrarySearchPaginationQuery (doc_id 26617181747964058), Meta Relay @defer Multi-Chunk NDJSON Stream, libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec)

### Community 6 - "Sidepanel Find Ads & Minea Counter UI"
Cohesion: 0.14
Nodes (21): #find-ads-start-preset-select (On or After 3/6/12/15/18/24 Months Dropdown), #find-ads-export-inote-btn (Export Ads to inote.net UI), #minea-active-total-box (Minea Active vs Total Camp & Ratio % UI), #view-find-ads (Facebook Ads Library Search Tab UI), initFindAdsTab(), calculatePastDate(), clearResults(), copyText() (+13 more)

### Community 7 - "M1 Sidepanel UI & Format Validation Suite"
Cohesion: 0.11
Nodes (17): cssContent, cssMissing, cssPath, expectedCountries, formatted, fs, htmlContent, htmlMissing (+9 more)

### Community 8 - "7-Step Super-Buyer Store Actor"
Cohesion: 0.32
Nodes (16): manual.md (Manual Tab: Inote Smart Dispatcher & 7-Step Super-Buyer Pixel), 7-Step Super-Buyer E-Commerce Pixel Warmup Flow (ViewContent -> AddToCart -> Checkout -> PCI/PayPal), addToCartAndInitiateCheckout(), detectStorePlatform(), fillCreditCardFieldsOnTopAndSameOrigin(), fillUSCustomerShippingInfo(), finalizeAndCloseStoreTab(), reportProgress() (+8 more)

### Community 9 - "GPM Login & Playwright CDP Automation"
Cohesion: 0.16
Nodes (3): get_gpm_remote_debugging_port(), main(), parse_relay_deferred_response()

## Knowledge Gaps
- **4 isolated node(s):** `Find-ads.md (Hybrid API Pagination & Physical Scroll Specification)`, `REACTION_MECHANISM.md (CDP Trusted Hardware Input & CometUFIFeedbackReactMutation)`, `manual.md (Manual Tab: Inote Smart Dispatcher & 7-Step Super-Buyer Pixel)`, `AGENTS.md (Graphify Always-On Rules for Coding Agents)`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 84 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `initFindAdsTab()` connect `Sidepanel Find Ads & Minea Counter UI` to `Ads Library GraphQL & Minea Counter Engine`, `Sidepanel Hunter & Manual Queue Controller`, `Ads Library GraphQL & Minea Counter Engine (Group 5)`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `initFindAdsTab()` (e.g. with `.fetchActiveVsTotalCounts()` and `.searchAndPaginateAll()`) actually correct?**
  _`initFindAdsTab()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Find-ads.md (Hybrid API Pagination & Physical Scroll Specification)`, `REACTION_MECHANISM.md (CDP Trusted Hardware Input & CometUFIFeedbackReactMutation)`, `manual.md (Manual Tab: Inote Smart Dispatcher & 7-Step Super-Buyer Pixel)` to the rest of the system?**
  _4 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Newsfeed Hybrid Video Ads Scanner & Filter` be split into smaller, more focused modules?**
  _Cohesion score 0.11693548387096774 - nodes in this community are weakly interconnected._
- **Why does `AdsLibraryGraphQLService` connect `Ads Library GraphQL & Minea Counter Engine (Group 5)` to `Ads Library GraphQL & Minea Counter Engine`, `CDP Trusted Input & Reaction Warmup Engine`?**
  _High betweenness centrality (0.236) - this node is a cross-community bridge._
- **Should `Ads Library GraphQL & Minea Counter Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.09195402298850575 - nodes in this community are weakly interconnected._
- **Should `Sidepanel Hunter & Manual Queue Controller` be split into smaller, more focused modules?**
  _Cohesion score 0.14814814814814814 - nodes in this community are weakly interconnected._