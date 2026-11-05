/**
 * test_m2_m3_engine.js - Comprehensive Verification Test Suite for Milestone 2 & Milestone 3
 * 
 * Tests:
 * 1. AdsLibraryGraphQLService initialization & variable building
 * 2. Relay @defer chunk parser with and without 'for (;;);'
 * 3. Video duration resolver (efg Base64 decoding)
 * 4. 100% Untruncated caption extraction & fallback chain
 * 5. Full Ad Model normalization with 8 mandatory fields
 * 6. Live data testing against captured_graphql_response.json
 * 7. 100% Cursor pagination loop simulation & deduplication & cancellation
 * 8. InoteService text formatting according to R3 specification
 * 9. InoteService network integration (GET redirect -> POST content to inote.net)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== RUNNING MILESTONE 2 & 3 COMPREHENSIVE TEST SUITE ===\n');

// Import background modules
const backgroundPath = path.join(__dirname, 'background.js');
const { AdsLibraryGraphQLService, InoteService } = require(backgroundPath);

assert(AdsLibraryGraphQLService, 'AdsLibraryGraphQLService must be exported from background.js');
assert(InoteService, 'InoteService must be exported from background.js');

let passedTests = 0;
let totalTests = 0;

async function runStep(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`✓ PASS [${totalTests}]: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ FAIL [${totalTests}]: ${name}\n  Error: ${err.message}`);
    process.exit(1);
  }
}

async function runAll() {
  // ────────────────────────────────────────────────────────────────────
  // TEST 1: Service Initialization & Constants
  // ────────────────────────────────────────────────────────────────────
  await runStep('Service initialization & constant verification', () => {
    const service = new AdsLibraryGraphQLService();
    assert.strictEqual(service.docId, '26617181747964058', 'docId must match Meta Ads Library refetch query');
    assert.strictEqual(service.friendlyName, 'AdLibraryMobileFocusedStateProviderRefetchQuery');
    assert.strictEqual(typeof service.sessionID, 'string');
    assert.strictEqual(typeof service.collationToken, 'string');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 2: GraphQL Variables Builder
  // ────────────────────────────────────────────────────────────────────
  await runStep('Variables builder maps UI filters accurately to Meta schema', () => {
    const service = new AdsLibraryGraphQLService();
    const params = {
      keyword: 'DallasWind US',
      country: 'US',
      mediaType: 'VIDEO',
      activeStatus: 'ACTIVE',
      language: 'en',
      publisherPlatforms: ['FACEBOOK', 'INSTAGRAM', 'AUDIENCE_NETWORK'],
      startDate: '2026-11-03',
      sortMode: 'TOTAL_IMPRESSIONS_DESC'
    };

    const vars = service.buildVariables(params);
    assert.strictEqual(vars.queryString, 'DallasWind US');
    assert.strictEqual(vars.country, 'US');
    assert.deepStrictEqual(vars.countries, ['US']);
    assert.strictEqual(vars.mediaType, 'VIDEO');
    assert.strictEqual(vars.activeStatus, 'ACTIVE');
    assert.deepStrictEqual(vars.contentLanguages, ['en']);
    assert.deepStrictEqual(vars.publisherPlatforms, ['FACEBOOK', 'INSTAGRAM', 'AUDIENCE_NETWORK']);
    assert.deepStrictEqual(vars.startDate, { min: '2026-11-03', max: null });
    assert.strictEqual(vars.sortData.mode, 'SORT_BY_TOTAL_IMPRESSIONS');
    assert.strictEqual(vars.sortData.direction, 'DESCENDING');
    assert.strictEqual(vars.cursor, undefined);

    // Test pagination cursor injection
    const pagedVars = service.buildVariables(params, 'CURSOR_TOKEN_TEST_XYZ');
    assert.strictEqual(pagedVars.cursor, 'CURSOR_TOKEN_TEST_XYZ');
    assert.strictEqual(pagedVars.forward_cursor, 'CURSOR_TOKEN_TEST_XYZ');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 2.1: Exact Phrase Search (KEYWORD_EXACT_PHRASE)
  // ────────────────────────────────────────────────────────────────────
  await runStep('Exact Phrase Search builds KEYWORD_EXACT_PHRASE & quoted queryString matching user curl', () => {
    const service = new AdsLibraryGraphQLService();

    // Case A: Input with quotes \"DallasWind US\"
    const varsA = service.buildVariables({ keyword: '"DallasWind US"' });
    assert.strictEqual(varsA.queryString, '"DallasWind US"');
    assert.strictEqual(varsA.searchType, 'KEYWORD_EXACT_PHRASE');

    // Case B: Input without quotes but with isExactPhrase: true
    const varsB = service.buildVariables({ keyword: 'DallasWind US', isExactPhrase: true });
    assert.strictEqual(varsB.queryString, '"DallasWind US"');
    assert.strictEqual(varsB.searchType, 'KEYWORD_EXACT_PHRASE');

    // Verify URL-encoded body matching user's exact curl string
    const body = service.buildRequestBody(varsB);
    assert(body.includes('%22queryString%22%3A%22%5C%22DallasWind+US%5C%22%22') || body.includes('%22queryString%22%3A%22%5C%22DallasWind%20US%5C%22%22'));
    assert(body.includes('%22searchType%22%3A%22KEYWORD_EXACT_PHRASE%22'));

    // Case C: Regular unordered search without quotes
    const varsC = service.buildVariables({ keyword: 'DallasWind US' });
    assert.strictEqual(varsC.queryString, 'DallasWind US');
    assert.strictEqual(varsC.searchType, 'KEYWORD_UNORDERED');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 3: Request Body Builder
  // ────────────────────────────────────────────────────────────────────
  await runStep('Request body builder produces valid application/x-www-form-urlencoded string', () => {
    const service = new AdsLibraryGraphQLService();
    service.cachedUserId = '61577091256835';
    service.cachedDtsg = 'TEST_DTSG_TOKEN';
    service.cachedLsd = 'TEST_LSD_TOKEN';

    const vars = service.buildVariables({ keyword: 'Test' });
    const body = service.buildRequestBody(vars);

    assert(body.includes('doc_id=26617181747964058'));
    assert(body.includes('fb_api_req_friendly_name=AdLibraryMobileFocusedStateProviderRefetchQuery'));
    assert(body.includes('fb_dtsg=TEST_DTSG_TOKEN'));
    assert(body.includes('lsd=TEST_LSD_TOKEN'));
    assert(body.includes('server_timestamps=true'));
    assert(body.includes('variables='));
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 4: Relay Modern Chunk Parser
  // ────────────────────────────────────────────────────────────────────
  await runStep('Relay chunk parser correctly handles XSSI prefix and @defer chunks', () => {
    const service = new AdsLibraryGraphQLService();

    // Test 4.1: Clean raw JSON stream from captured file
    const responseFilePath = path.join(__dirname, '..', 'captured_graphql_response.json');
    const rawResponse = fs.readFileSync(responseFilePath, 'utf8');

    const connection = service.parseRelayResponse(rawResponse);
    assert(connection, 'Must successfully parse search_results_connection from captured response');
    assert.strictEqual(connection.count, 207, 'Total count must equal 207 ads');
    assert.strictEqual(connection.edges.length, 30, 'First batch must contain 30 edges');
    assert.strictEqual(connection.page_info.has_next_page, true, 'has_next_page must be true');
    assert(connection.page_info.end_cursor.startsWith('AQHT'), 'end_cursor must match captured token');

    // Test 4.2: Prefixed with Meta for (;;); anti-XSSI header
    const withPrefix = 'for (;;);\n' + rawResponse;
    const connectionPrefixed = service.parseRelayResponse(withPrefix);
    assert(connectionPrefixed, 'Must parse successfully despite for (;;); prefix');
    assert.strictEqual(connectionPrefixed.count, 207);

    // Test 4.3: Malformed lines
    const invalid = service.parseRelayResponse('INVALID_NON_JSON\n{"foo": "bar"}');
    assert.strictEqual(invalid, null, 'Must return null for response lacking search_results_connection');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 5: Video Duration Resolver (efg Base64 Extraction)
  // ────────────────────────────────────────────────────────────────────
  await runStep('extractVideoDuration decodes efg Base64 payload and extracts duration_s', () => {
    const service = new AdsLibraryGraphQLService();

    // Real CDN URL from captured sample with efg encoding duration_s: 167
    const sampleUrl = 'https://video-ord5-1.xx.fbcdn.net/o1/v/t2/f2/m366/AQOYJ6eLm?efg=eyJ2ZW5jb2RlX3RhZyI6Inhwdl9wcm9ncmVzc2l2ZS5WSV9VU0VDQVNFX1BST0RVQ1RfVFlQRS4uQzMuNzIwLmRhc2hfaDI2NC1iYXNpYy1nZW4yXzcyMHAiLCJ4cHZfYXNzZXRfaWQiOjE2MzU2NDMwNjc5OTU0ODEsImFzc2V0X2FnZV9kYXlzIjo1NSwidmlfdXNlY2FzZV9pZCI6MTA3OTksImR1cmF0aW9uX3MiOjE2NywidXJsZ2VuX3NvdXJjZSI6Ind3dyJ9&ccb=17-1';
    const duration = service.extractVideoDuration(sampleUrl);
    assert.strictEqual(duration, 167, 'Must decode duration_s as 167 seconds');

    // URL without efg
    assert.strictEqual(service.extractVideoDuration('https://video.xx.fbcdn.net/video.mp4'), null);

    // Invalid base64 in efg
    assert.strictEqual(service.extractVideoDuration('https://video.xx.fbcdn.net/video.mp4?efg=NOT_BASE64!'), null);
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 6: Untruncated Caption Extraction
  // ────────────────────────────────────────────────────────────────────
  await runStep('extractFullCaption extracts 100% full text without truncation', () => {
    const service = new AdsLibraryGraphQLService();

    // Test body text preservation (including emoji, newlines, hashtags)
    const fullBodyText = '🚗 Car Rear-Seat Travel Mattress for family trips!\n' +
                         '✅ Memory foam comfort\n' +
                         '✅ Non-slip bottom\n' +
                         '🛒 Order today!\n' +
                         '#CarSleepMattress #RoadTripSleep';
    const snapBody = { body: { text: fullBodyText } };
    assert.strictEqual(service.extractFullCaption(snapBody), fullBodyText);

    // Test Carousel fallback
    const snapCards = {
      cards: [
        { body: { text: 'Card 1 Description' } },
        { title: 'Card 2 Headline' }
      ]
    };
    const carouselCaption = service.extractFullCaption(snapCards);
    assert(carouselCaption.includes('[Thẻ 1] Card 1 Description'));
    assert(carouselCaption.includes('[Thẻ 2] Card 2 Headline'));

    // Test extra_texts fallback
    const snapExtra = { extra_texts: ['Paragraph 1', 'Paragraph 2'] };
    assert.strictEqual(service.extractFullCaption(snapExtra), 'Paragraph 1\nParagraph 2');

    // Test title fallback
    const snapTitle = { title: 'Special Promo Headline' };
    assert.strictEqual(service.extractFullCaption(snapTitle), 'Special Promo Headline');

    // Empty fallback
    assert.strictEqual(service.extractFullCaption({}), '');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 7: Full Ad Model Normalization Against All 30 Captured Ads
  // ────────────────────────────────────────────────────────────────────
  await runStep('normalizeAdNode accurately parses and normalizes 30 real ads from AST', () => {
    const service = new AdsLibraryGraphQLService();
    const responseFilePath = path.join(__dirname, '..', 'captured_graphql_response.json');
    const rawResponse = fs.readFileSync(responseFilePath, 'utf8');
    const conn = service.parseRelayResponse(rawResponse);

    assert.strictEqual(conn.edges.length, 30);

    const normalizedAds = [];
    for (const edge of conn.edges) {
      for (const item of edge.node.collated_results) {
        const ad = service.normalizeAdNode(item);
        normalizedAds.push(ad);
      }
    }

    assert.strictEqual(normalizedAds.length, 30);

    // Check Ad 1
    const ad1 = normalizedAds[0];
    assert.strictEqual(ad1.archive_id, '1793151018506639');
    assert.strictEqual(ad1.page_id, '104568602496853');
    assert.strictEqual(ad1.page_name, 'DallasWind US');
    assert.strictEqual(ad1.is_active, true);
    assert.strictEqual(ad1.creative_format, 'Video (167 giây)');
    assert.strictEqual(ad1.duration_seconds, 167);
    assert(ad1.caption_text.includes('Car Rear-Seat Memory Foam Travel Mattress'));
    assert(ad1.caption_text.includes('#RearSeatMattress'));
    assert.strictEqual(ad1.caption_text.includes('...'), false, 'Caption must NOT be truncated with three dots');
    assert.strictEqual(ad1.cta_text, 'Shop now');
    assert.strictEqual(ad1.link_url, 'https://dallaswind.com/products/car-rear-seat-cushion-for-pet');
    assert(ad1.platforms.includes('Facebook'));
    assert(ad1.platforms.includes('Instagram'));

    // Check Ad 2
    const ad2 = normalizedAds[1];
    assert.strictEqual(ad2.archive_id, '3070101149852765');
    assert.strictEqual(ad2.creative_format, 'Video (49 giây)');
    assert.strictEqual(ad2.duration_seconds, 49);
    assert(ad2.caption_text.includes('Smart shave. Small size.'));

    // Check Ad 3
    const ad3 = normalizedAds[2];
    assert.strictEqual(ad3.archive_id, '1686567520136175');
    assert.strictEqual(ad3.creative_format, 'Video (51 giây)');
    assert.strictEqual(ad3.duration_seconds, 51);
    assert(ad3.caption_text.includes('Eliminate dust mites naturally'));
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 8: Pagination Loop Simulation & Deduplication & Cancellation
  // ────────────────────────────────────────────────────────────────────
  await runStep('searchAndPaginateAll handles cursor loop, deduplication, and cancel flag', async () => {
    const service = new AdsLibraryGraphQLService();

    // Mock fetch to simulate 3 pages totaling 70 ads
    let graphqlCallCount = 0;
    const originalFetch = global.fetch;

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('ads/library')) {
        return {
          ok: true,
          text: async () => '["DTSGInitialData",[],{"token":"MOCK_DTSG"}]\n["LSD",[],{"token":"MOCK_LSD"}]\n"__spin_r":1052846864'
        };
      }

      graphqlCallCount++;
      const params = new URLSearchParams(opts && opts.body ? opts.body : '');
      const vars = params.get('variables') ? JSON.parse(params.get('variables')) : {};
      const cursor = vars.cursor;

      if (graphqlCallCount === 1) {
        assert.strictEqual(cursor, undefined, 'First request has no cursor');
        return {
          ok: true,
          text: async () => JSON.stringify({
            data: {
              ad_library_main: {
                search_results_connection: {
                  count: 70,
                  edges: Array.from({ length: 30 }, (_, i) => ({
                    node: {
                      collated_results: [{
                        ad_archive_id: `ad_${i + 1}`,
                        page_id: '12345',
                        page_name: 'Test Page',
                        is_active: true,
                        publisher_platform: ['FACEBOOK'],
                        snapshot: { body: { text: `Caption ${i + 1}` }, cta_text: 'Shop', link_url: 'https://test.com' }
                      }]
                    }
                  })),
                  page_info: { has_next_page: true, end_cursor: 'CURSOR_PAGE_2' }
                }
              }
            }
          })
        };
      } else if (graphqlCallCount === 2) {
        assert.strictEqual(cursor, 'CURSOR_PAGE_2', 'Second request must pass end_cursor from page 1');
        return {
          ok: true,
          text: async () => JSON.stringify({
            data: {
              ad_library_main: {
                search_results_connection: {
                  count: 70,
                  edges: Array.from({ length: 30 }, (_, i) => ({
                    node: {
                      collated_results: [{
                        ad_archive_id: `ad_${i + 31}`,
                        page_id: '12345',
                        page_name: 'Test Page',
                        is_active: true,
                        publisher_platform: ['FACEBOOK'],
                        snapshot: { body: { text: `Caption ${i + 31}` }, cta_text: 'Shop', link_url: 'https://test.com' }
                      }]
                    }
                  })),
                  page_info: { has_next_page: true, end_cursor: 'CURSOR_PAGE_3' }
                }
              }
            }
          })
        };
      } else if (graphqlCallCount === 3) {
        assert.strictEqual(cursor, 'CURSOR_PAGE_3', 'Third request must pass end_cursor from page 2');
        return {
          ok: true,
          text: async () => JSON.stringify({
            data: {
              ad_library_main: {
                search_results_connection: {
                  count: 70,
                  edges: Array.from({ length: 10 }, (_, i) => ({
                    node: {
                      collated_results: [{
                        ad_archive_id: `ad_${i + 61}`,
                        page_id: '12345',
                        page_name: 'Test Page',
                        is_active: true,
                        publisher_platform: ['FACEBOOK'],
                        snapshot: { body: { text: `Caption ${i + 61}` }, cta_text: 'Shop', link_url: 'https://test.com' }
                      }]
                    }
                  })),
                  page_info: { has_next_page: false, end_cursor: null }
                }
              }
            }
          })
        };
      }
    };

    try {
      const progressHistory = [];
      const results = await service.searchAndPaginateAll({ keyword: 'DallasWind' }, (p) => {
        progressHistory.push(p);
      });

      assert.strictEqual(results.length, 70, 'Must extract exactly 70 ads across 3 batches');
      assert.strictEqual(graphqlCallCount, 3, 'Must execute exactly 3 network requests');
      assert.strictEqual(progressHistory.some(p => p.status === 'COMPLETED'), true);

      // Test cancellation
      graphqlCallCount = 0;
      const cancelPromise = service.searchAndPaginateAll({ keyword: 'CancelTest' }, (p) => {
        if (p.currentPage === 1) {
          service.cancel();
        }
      });
      const cancelResults = await cancelPromise;
      assert(cancelResults.length <= 30, 'Cancelled search must stop immediately after current batch');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 9: InoteService Formatting (8 Mandatory Fields)
  // ────────────────────────────────────────────────────────────────────
  await runStep('InoteService.formatAd produces exact 8-line structure required by R3', () => {
    const sampleAd = {
      archive_id: '1793151018506639',
      page_id: '104568602496853',
      page_name: 'DallasWind US',
      is_active: true,
      platforms: 'Facebook, Instagram, Audience Network',
      creative_format: 'Video (167 giây)',
      caption_text: 'Best Car Rear-Seat Travel Mattress for road trips!',
      cta_text: 'Shop now',
      link_url: 'https://dallaswind.com/products/car-seat-cushion'
    };

    const formatted = InoteService.formatAd(sampleAd, 0);

    const expectedLines = [
      'Mẫu 1: DallasWind US',
      'Archive ID: 1793151018506639',
      'Page ID: 104568602496853 (DallasWind US)',
      'Trạng thái: Đang chạy (is_active: true)',
      'Nền tảng: Facebook, Instagram, Audience Network',
      'Định dạng creative: Video (167 giây)',
      'Nội dung bài viết: "Best Car Rear-Seat Travel Mattress for road trips!"',
      'Kêu gọi hành động (CTA): Shop now',
      'Đường dẫn đích: https://dallaswind.com/products/car-seat-cushion'
    ];

    for (const line of expectedLines) {
      assert(formatted.includes(line), `Formatted text must contain: "${line}"`);
    }

    // Multiple ads separated by double newline
    const allFormatted = InoteService.formatAllAds([sampleAd, { ...sampleAd, archive_id: '222' }]);
    assert(allFormatted.includes('Mẫu 1:'));
    assert(allFormatted.includes('Mẫu 2:'));
    assert(allFormatted.includes('\n\n'));
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 10: InoteService Network Flow (Live probe to https://inote.net/)
  // ────────────────────────────────────────────────────────────────────
  await runStep('InoteService.createNote performs live 2-step allocation & saves payload', async () => {
    const testPayload = `Mẫu 1: Test Integration Note\nArchive ID: 9999999999\nPage ID: 888888 (Integration Page)\nTrạng thái: Đang chạy (is_active: true)\nNền tảng: Facebook\nĐịnh dạng creative: Video (167 giây)\nNội dung bài viết: "Testing live integration note from Milestone 2 & 3 test suite"\nKêu gọi hành động (CTA): Shop now\nĐường dẫn đích: https://example.com`;

    const result = await InoteService.createNote(testPayload, { openTab: false });

    assert.strictEqual(result.success, true);
    assert(result.noteUrl.startsWith('https://inote.net/'));
    assert(typeof result.noteId === 'string' && result.noteId.length >= 6);

    console.log(`     Live note created successfully: ${result.noteUrl} (ID: ${result.noteId})`);

    // Verify the content was genuinely persisted by fetching back the HTML
    const verifyRes = await fetch(result.noteUrl);
    assert.strictEqual(verifyRes.status, 200);
    const verifyHtml = await verifyRes.text();
    assert(verifyHtml.includes('Testing live integration note'), 'Note HTML must contain our saved content');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 11: InoteService.formatAllAds with 'page_name' mode
  // ────────────────────────────────────────────────────────────────────
  await runStep('InoteService.formatAllAds supports page_name deduplicated export', () => {
    const ads = [
      { archive_id: '1', page_name: 'DallasWind US', caption_text: 'A' },
      { archive_id: '2', page_name: 'DallasWind US', caption_text: 'B' },
      { archive_id: '3', page_name: 'TechGadget Store', caption_text: 'C' }
    ];
    const pageNamesOnly = InoteService.formatAllAds(ads, 'page_name');
    assert.strictEqual(pageNamesOnly, 'DallasWind US\nTechGadget Store');
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 12: InoteService.parseInoteUrl & Live fetchKeywordsFromNote
  // ────────────────────────────────────────────────────────────────────
  await runStep('InoteService.parseInoteUrl & live fetchKeywordsFromNote(XUjCy13YJ6)', async () => {
    assert.strictEqual(InoteService.parseInoteUrl('https://inote.net/XUjCy13YJ6'), 'https://inote.net/XUjCy13YJ6');
    assert.strictEqual(InoteService.parseInoteUrl('"https://inote.net/XUjCy13YJ6"'), 'https://inote.net/XUjCy13YJ6');
    assert.strictEqual(InoteService.parseInoteUrl('inote.net/XUjCy13YJ6'), 'https://inote.net/XUjCy13YJ6');
    assert.strictEqual(InoteService.parseInoteUrl('DallasWind US'), null);

    const keywords = await InoteService.fetchKeywordsFromNote('https://inote.net/XUjCy13YJ6');
    assert(Array.isArray(keywords) && keywords.length > 50, `Expected >50 keywords, got ${keywords.length}`);
    assert(keywords[0].includes('Car Rear-Seat Memory Foam Travel Mattress'), 'First line should match expected keyword');
    assert(keywords.every(k => k.trim().length > 0), 'No empty lines should remain');
    console.log(`     Fetched ${keywords.length} non-empty keyword lines from https://inote.net/XUjCy13YJ6`);
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 13: AdsLibraryGraphQLService.searchInoteKeywordBatch (Sequential + Dedup)
  // ────────────────────────────────────────────────────────────────────
  await runStep('searchInoteKeywordBatch runs keywords sequentially and deduplicates archive_id', async () => {
    const svc = new AdsLibraryGraphQLService();
    svc.ensureAuthentication = async () => ({
      fb_dtsg: 'test_dtsg',
      lsd: 'test_lsd'
    });

    const originalFetchNote = InoteService.fetchKeywordsFromNote;
    try {
      InoteService.fetchKeywordsFromNote = async () => ['Keyword One', 'Keyword Two'];

      const queriedKeywords = [];
      svc.searchAndPaginateAll = async (stepParams, onStepProgress) => {
        queriedKeywords.push({ keyword: stepParams.keyword, isExactPhrase: stepParams.isExactPhrase });
        if (stepParams.keyword === '"Keyword One"') {
          const ads1 = [
            { archive_id: 'AD_101', page_name: 'Page Alpha', is_active: true, caption_text: 'Ad 101' },
            { archive_id: 'AD_102', page_name: 'Page Beta', is_active: true, caption_text: 'Ad 102' }
          ];
          onStepProgress({ status: 'PROCESSING_ADS', totalFound: 2, extractedCount: 2, batchAds: ads1 });
          return ads1;
        }
        const ads2 = [
          // AD_102 is a duplicate from Keyword One -> should be deduplicated
          { archive_id: 'AD_102', page_name: 'Page Beta', is_active: true, caption_text: 'Ad 102' },
          { archive_id: 'AD_103', page_name: 'Page Gamma', is_active: true, caption_text: 'Ad 103' }
        ];
        onStepProgress({ status: 'PROCESSING_ADS', totalFound: 2, extractedCount: 2, batchAds: ads2 });
        return ads2;
      };

      const progressEvents = [];
      const batchRes = await svc.searchInoteKeywordBatch(
        'https://inote.net/TESTBATCH',
        { keyword: 'https://inote.net/TESTBATCH', isExactPhrase: true, country: 'US' },
        (prog) => progressEvents.push(prog)
      );

      assert.strictEqual(queriedKeywords.length, 2);
      assert.strictEqual(queriedKeywords[0].keyword, '"Keyword One"');
      assert.strictEqual(queriedKeywords[1].keyword, '"Keyword Two"');
      assert.strictEqual(batchRes.length, 3, 'Should deduplicate AD_102 and return 3 unique ads');
      assert(progressEvents.some(p => p.statusMessage && p.statusMessage.includes('[Từ khóa 1/2]')));
      assert(progressEvents.some(p => p.statusMessage && p.statusMessage.includes('[Từ khóa 2/2]')));
    } finally {
      InoteService.fetchKeywordsFromNote = originalFetchNote;
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // TEST 14: Page Hunter Mode (3 Concurrent Workers + Retry + Dedup + Auto Inote Export)
  // ────────────────────────────────────────────────────────────────────
  await runStep('runPageHunterBatch runs 3 concurrent workers, retries transient failures, deduplicates page_name, and auto-exports to inote.net', async () => {
    const svc = new AdsLibraryGraphQLService();
    svc.ensureAuthentication = async () => ({
      fb_dtsg: 'test_dtsg',
      lsd: 'test_lsd'
    });

    const originalFetchNote = InoteService.fetchKeywordsFromNote;
    const originalCreateNote = InoteService.createNote;
    const originalFetch = global.fetch;

    try {
      // Include a duplicate keyword line ("Line 1" and "line 1") to verify input deduplication
      InoteService.fetchKeywordsFromNote = async () => [
        'Line 1',
        'line 1',
        'Line 2',
        'Line 3',
        'Line 4'
      ];

      let autoSavedText = null;
      InoteService.createNote = async (textPayload) => {
        autoSavedText = textPayload;
        return {
          success: true,
          noteId: 'PAGEHUNTER99',
          noteUrl: 'https://inote.net/PAGEHUNTER99'
        };
      };

      let line2Attempts = 0;
      global.fetch = async (url, opts) => {
        const bodyParams = new URLSearchParams(opts.body);
        const vars = JSON.parse(bodyParams.get('variables'));
        const q = vars.queryString;

        // Simulate transient HTTP 500 on first attempt of Line 2 to prove retry never misses a Page
        if (q.includes('Line 2')) {
          line2Attempts++;
          if (line2Attempts === 1) {
            return { ok: false, status: 500 };
          }
          return {
            ok: true,
            text: async () => JSON.stringify({
              data: {
                ad_library_main: {
                  search_results_connection: {
                    count: 2,
                    edges: [
                      { node: { collated_results: [{ ad_archive_id: '201', page_id: 'P2', page_name: 'Beta Store US' }] } },
                      { node: { collated_results: [{ ad_archive_id: '202', page_id: 'P1', page_name: 'dallaswind us' }] } }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            })
          };
        }

        if (q.includes('Line 1')) {
          return {
            ok: true,
            text: async () => JSON.stringify({
              data: {
                ad_library_main: {
                  search_results_connection: {
                    count: 1,
                    edges: [
                      { node: { collated_results: [{ ad_archive_id: '101', page_id: 'P1', page_name: 'DallasWind US' }] } }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            })
          };
        }

        if (q.includes('Line 3')) {
          return {
            ok: true,
            text: async () => JSON.stringify({
              data: {
                ad_library_main: {
                  search_results_connection: {
                    count: 1,
                    edges: [
                      { node: { collated_results: [{ ad_archive_id: '301', page_id: 'P3', page_name: 'Gamma Gadgets' }] } }
                    ],
                    page_info: { has_next_page: false, end_cursor: null }
                  }
                }
              }
            })
          };
        }

        return {
          ok: true,
          text: async () => JSON.stringify({
            data: {
              ad_library_main: {
                search_results_connection: {
                  count: 1,
                  edges: [
                    { node: { collated_results: [{ ad_archive_id: '401', page_id: 'P4', page_name: 'Omega Home' }] } }
                  ],
                  page_info: { has_next_page: false, end_cursor: null }
                }
              }
            }
          })
        };
      };

      const progressEvents = [];
      const pages = await svc.runPageHunterBatch(
        'https://inote.net/XUjCy13YJ6',
        { isPageHunter: true, country: 'US', openInoteTab: false },
        (prog) => progressEvents.push(prog)
      );

      assert(line2Attempts >= 2, 'Line 2 must retry after transient HTTP 500 and succeed on retry');
      assert.strictEqual(pages.length, 4, 'Must collect all 4 unique pages and deduplicate "DallasWind US" vs "dallaswind us"');
      const names = pages.map(p => p.page_name);
      assert(names.includes('DallasWind US'));
      assert(names.includes('Beta Store US'));
      assert(names.includes('Gamma Gadgets'));
      assert(names.includes('Omega Home'));
      assert.strictEqual(autoSavedText, names.join('\n'), 'Auto-exported Inote text must contain the exact 4 unique page names');
      const completedEvt = progressEvents.find(p => p.status === 'COMPLETED');
      assert(completedEvt && completedEvt.autoNoteResult && completedEvt.autoNoteResult.noteUrl === 'https://inote.net/PAGEHUNTER99');
    } finally {
      InoteService.fetchKeywordsFromNote = originalFetchNote;
      InoteService.createNote = originalCreateNote;
      global.fetch = originalFetch;
    }
  });

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY (Exit Code: 0)`);
  console.log('======================================================\n');
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
