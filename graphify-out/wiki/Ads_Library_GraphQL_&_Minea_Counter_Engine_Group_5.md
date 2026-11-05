# Ads Library GraphQL & Minea Counter Engine (Group 5)

> 24 nodes · cohesion 0.17

## Key Concepts

- **AdsLibraryGraphQLService** (22 connections) — `extension/background.js`
- **.fetchCountWithRetry()** (9 connections) — `extension/background.js`
- **.searchAndPaginateAll()** (9 connections) — `extension/background.js`
- **.fetchActiveVsTotalCounts()** (7 connections) — `extension/background.js`
- **.buildVariables()** (5 connections) — `extension/background.js`
- **.normalizeAdNode()** (5 connections) — `extension/background.js`
- **.parseRelayResponse()** (5 connections) — `extension/background.js`
- **.buildRequestBody()** (4 connections) — `extension/background.js`
- **.generateUUID()** (4 connections) — `extension/background.js`
- **libary-API.md (Facebook Ads Library GraphQL Reverse Engineering Spec)** (4 connections) — `libary-API.md`
- **.buildAdsLibraryUrlWithStatus()** (3 connections) — `extension/background.js`
- **.ensureAuthentication()** (3 connections) — `extension/background.js`
- **Meta Relay @defer Multi-Chunk NDJSON Stream** (3 connections) — `libary-API.md`
- **.constructor()** (2 connections) — `extension/background.js`
- **.extractCountFromHTML()** (2 connections) — `extension/background.js`
- **.extractFullCaption()** (2 connections) — `extension/background.js`
- **.extractVideoDuration()** (2 connections) — `extension/background.js`
- **.formatNumberCompact()** (2 connections) — `extension/background.js`
- **.formatNumberWithoutDecimals()** (2 connections) — `extension/background.js`
- **.smartRound()** (2 connections) — `extension/background.js`
- **AdLibrarySearchPaginationQuery (doc_id 26617181747964058)** (2 connections) — `libary-API.md`
- **Rationale: Generate fresh sessionID & collationToken per search/count call to prevent Meta pagination collision** (2 connections) — `libary-API.md`
- **.cancel()** (1 connections) — `extension/background.js`
- **Rationale: Preserve empty publisherPlatforms [] and ALL language [] for 100% parity with Facebook Web & Minea** (1 connections) — `libary-API.md`

## Relationships

- [Ads Library GraphQL & Minea Counter Engine](Ads_Library_GraphQL_&_Minea_Counter_Engine.md) (4 shared connections)
- [Sidepanel Find Ads & Minea Counter UI](Sidepanel_Find_Ads_&_Minea_Counter_UI.md) (2 shared connections)
- [GPM Login & Playwright CDP Automation](GPM_Login_&_Playwright_CDP_Automation.md) (2 shared connections)
- [CDP Trusted Input & Reaction Warmup Engine](CDP_Trusted_Input_&_Reaction_Warmup_Engine.md) (1 shared connections)

## Source Files

- `extension/background.js`
- `libary-API.md`

## Audit Trail

- EXTRACTED: 52 (93%)
- INFERRED: 4 (7%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*