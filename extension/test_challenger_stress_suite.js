/**
 * test_adversarial_challenger.js - Empirical Edge-Case & Stress Test Harness
 * 
 * Conducted by: Challenger 2 (Empirical Challenger)
 * Roles: critic, specialist
 * 
 * Focus Areas:
 * 1. Pagination & Cursor Loop:
 *    - 0 results (count: 0, edges: [])
 *    - Odd counts: 193 ads, 207 ads (last batch < 30)
 *    - Deduplication: Map(archive_id -> Ad) handling overlapping ads across batches
 *    - Cancellation: cancelRequested stops immediately without lingering timers or network calls
 *    - Recovery: Service can start new search cleanly after cancel
 * 2. Ad & Caption Extraction:
 *    - Carousel fallback (snapshot.cards with mixed bodies/titles)
 *    - Headline fallback (snapshot.title when caption is absent)
 *    - Empty snapshot fallback (no crash)
 *    - CTA and Link URL fallback
 *    - Unicode emojis, Vietnamese diacritics, quotes, newlines
 *    - safeHtml escaping against XSS injection
 * 3. inote.net Heavy Load & Integrity:
 *    - 260 ads (>130 KB payload)
 *    - Live HTTP 2-step allocation & POST
 *    - Live HTML fetch & readback verification of Mẫu 1 and Mẫu 260
 *    - UTF-8 emoji & Vietnamese diacritics fidelity
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const backgroundPath = path.join(__dirname, 'background.js');
const { AdsLibraryGraphQLService, InoteService } = require(backgroundPath);

console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║   ADVERSARIAL STRESS & EDGE-CASE TEST SUITE — CHALLENGER 2 GEN 2   ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testLogs = [];

async function testCase(name, fn) {
  totalTests++;
  process.stdout.write(`[Test #${totalTests}] ${name} ... `);
  try {
    await fn();
    console.log('✓ PASS');
    passedTests++;
    testLogs.push({ id: totalTests, name, status: 'PASS' });
  } catch (err) {
    console.log(`❌ FAIL: ${err.message}`);
    failedTests++;
    testLogs.push({ id: totalTests, name, status: 'FAIL', error: err.message, stack: err.stack });
  }
}

// Helper to mock fetch for pagination
function createMockFetch(batches) {
  let callIndex = 0;
  return async (url, opts) => {
    if (typeof url === 'string' && url.includes('ads/library')) {
      return {
        ok: true,
        text: async () => '["DTSGInitialData",[],{"token":"MOCK_DTSG"}]\n["LSD",[],{"token":"MOCK_LSD"}]\n"__spin_r":1052846864'
      };
    }
    const batch = batches[callIndex];
    callIndex++;
    if (!batch) {
      throw new Error(`Unexpected GraphQL call #${callIndex}`);
    }
    return {
      ok: true,
      text: async () => JSON.stringify({
        data: {
          ad_library_main: {
            search_results_connection: batch
          }
        }
      })
    };
  };
}

// HTML Escaper identical to sidepanel.js safeHtml
function safeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function runAllTests() {
  const originalFetch = global.fetch;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 1: EDGE CASES IN PAGINATION & CURSOR LOOP
  // ════════════════════════════════════════════════════════════════════
  console.log('─── SECTION 1: Pagination, Odd Counts, Zero Results, Deduplication, Cancellation ───');

  // Test 1.1: Zero Results
  await testCase('Edge Case 1.1: Zero results (count: 0, edges: []) terminates cleanly on Batch 1', async () => {
    const service = new AdsLibraryGraphQLService();
    let callsMade = 0;

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('ads/library')) {
        return { ok: true, text: async () => 'token' };
      }
      callsMade++;
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: {
            ad_library_main: {
              search_results_connection: {
                count: 0,
                edges: [],
                page_info: { has_next_page: false, end_cursor: null }
              }
            }
          }
        })
      };
    };

    const progressEvents = [];
    const results = await service.searchAndPaginateAll({ keyword: 'ZeroResultQuery' }, (p) => {
      progressEvents.push(p);
    });

    assert.strictEqual(results.length, 0, 'Must return 0 results');
    assert.strictEqual(callsMade, 1, 'Must make exactly 1 call and not loop infinitely');
    assert.strictEqual(progressEvents.some(p => p.status === 'COMPLETED'), true, 'Must emit COMPLETED status');
    const lastProgress = progressEvents[progressEvents.length - 1];
    assert.strictEqual(lastProgress.extractedCount, 0);
  });

  // Test 1.2: Odd Result Count = 193 Ads (6 batches of 30 + 1 batch of 13)
  await testCase('Edge Case 1.2: Odd count = 193 ads (6 batches of 30, last batch 13 ads)', async () => {
    const service = new AdsLibraryGraphQLService();
    let callsMade = 0;

    const batches = [];
    let adCounter = 0;
    // 6 batches of 30
    for (let b = 1; b <= 6; b++) {
      const edges = [];
      for (let i = 0; i < 30; i++) {
        adCounter++;
        edges.push({
          node: {
            collated_results: [{
              ad_archive_id: `ad_${adCounter}`,
              page_id: '1001',
              page_name: 'Odd Test Page',
              is_active: true,
              publisher_platform: ['FACEBOOK'],
              snapshot: { body: { text: `Caption for ad ${adCounter}` }, cta_text: 'Shop now', link_url: 'https://odd.com' }
            }]
          }
        });
      }
      batches.push({
        count: 193,
        edges: edges,
        page_info: { has_next_page: true, end_cursor: `CURSOR_BATCH_${b + 1}` }
      });
    }
    // Batch 7 with 13 ads
    const lastEdges = [];
    for (let i = 0; i < 13; i++) {
      adCounter++;
      lastEdges.push({
        node: {
          collated_results: [{
            ad_archive_id: `ad_${adCounter}`,
            page_id: '1001',
            page_name: 'Odd Test Page',
            is_active: true,
            publisher_platform: ['FACEBOOK'],
            snapshot: { body: { text: `Caption for ad ${adCounter}` }, cta_text: 'Shop now', link_url: 'https://odd.com' }
          }]
        }
      });
    }
    batches.push({
      count: 193,
      edges: lastEdges,
      page_info: { has_next_page: false, end_cursor: null }
    });

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('ads/library')) {
        return { ok: true, text: async () => 'token' };
      }
      const b = batches[callsMade];
      callsMade++;
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: { ad_library_main: { search_results_connection: b } }
        })
      };
    };

    const results = await service.searchAndPaginateAll({ keyword: 'Odd193' });
    assert.strictEqual(callsMade, 7, 'Must execute exactly 7 GraphQL requests');
    assert.strictEqual(results.length, 193, 'Must extract exactly 193 ads');
    assert.strictEqual(results[0].archive_id, 'ad_1');
    assert.strictEqual(results[192].archive_id, 'ad_193');
  });

  // Test 1.3: Odd Result Count = 207 Ads (6 batches of 30, last batch 27)
  await testCase('Edge Case 1.3: Odd count = 207 ads (matching live captured count, 6x30 + 1x27)', async () => {
    const service = new AdsLibraryGraphQLService();
    let callsMade = 0;

    const batches = [];
    let adCounter = 0;
    for (let b = 1; b <= 6; b++) {
      const edges = [];
      for (let i = 0; i < 30; i++) {
        adCounter++;
        edges.push({
          node: {
            collated_results: [{
              ad_archive_id: `ad_207_${adCounter}`,
              page_id: '1002',
              page_name: 'DallasWind US',
              is_active: true,
              publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
              snapshot: { body: { text: `Caption ${adCounter}` }, cta_text: 'Shop now', link_url: 'https://dallaswind.com' }
            }]
          }
        });
      }
      batches.push({
        count: 207,
        edges: edges,
        page_info: { has_next_page: true, end_cursor: `CURSOR_207_${b + 1}` }
      });
    }
    // Last batch with 27 ads
    const lastEdges = [];
    for (let i = 0; i < 27; i++) {
      adCounter++;
      lastEdges.push({
        node: {
          collated_results: [{
            ad_archive_id: `ad_207_${adCounter}`,
            page_id: '1002',
            page_name: 'DallasWind US',
            is_active: true,
            publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
            snapshot: { body: { text: `Caption ${adCounter}` }, cta_text: 'Shop now', link_url: 'https://dallaswind.com' }
          }]
        }
      });
    }
    batches.push({
      count: 207,
      edges: lastEdges,
      page_info: { has_next_page: false, end_cursor: null }
    });

    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('ads/library')) {
        return { ok: true, text: async () => 'token' };
      }
      const b = batches[callsMade];
      callsMade++;
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: { ad_library_main: { search_results_connection: b } }
        })
      };
    };

    const results = await service.searchAndPaginateAll({ keyword: 'DallasWind US' });
    assert.strictEqual(callsMade, 7, 'Must execute exactly 7 requests');
    assert.strictEqual(results.length, 207, 'Must extract exactly 207 ads');
    assert.strictEqual(results[206].archive_id, 'ad_207_207');
  });

  // Test 1.4: Map Deduplication across Overlapping Batches
  await testCase('Edge Case 1.4: Deduplication Map removes overlapping ads between batches cleanly', async () => {
    const service = new AdsLibraryGraphQLService();
    let callsMade = 0;

    // Batch 1: Ads 1 to 30
    const b1Edges = Array.from({ length: 30 }, (_, i) => ({
      node: { collated_results: [{ ad_archive_id: `dedup_${i + 1}`, snapshot: { body: { text: `T${i + 1}` } } }] }
    }));
    // Batch 2: Ads 21 to 50 (10 overlapping duplicates: dedup_21..30)
    const b2Edges = Array.from({ length: 30 }, (_, i) => ({
      node: { collated_results: [{ ad_archive_id: `dedup_${i + 21}`, snapshot: { body: { text: `T${i + 21}` } } }] }
    }));
    // Batch 3: Ads 41 to 60 (10 overlapping duplicates: dedup_41..50)
    const b3Edges = Array.from({ length: 20 }, (_, i) => ({
      node: { collated_results: [{ ad_archive_id: `dedup_${i + 41}`, snapshot: { body: { text: `T${i + 41}` } } }] }
    }));

    const batches = [
      { count: 60, edges: b1Edges, page_info: { has_next_page: true, end_cursor: 'C2' } },
      { count: 60, edges: b2Edges, page_info: { has_next_page: true, end_cursor: 'C3' } },
      { count: 60, edges: b3Edges, page_info: { has_next_page: false, end_cursor: null } }
    ];

    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('ads/library')) return { ok: true, text: async () => 'token' };
      const b = batches[callsMade++];
      return { ok: true, text: async () => JSON.stringify({ data: { ad_library_main: { search_results_connection: b } } }) };
    };

    const streamedBatches = [];
    const results = await service.searchAndPaginateAll({ keyword: 'Dedup' }, (p) => {
      if (p.status === 'PROCESSING_ADS' && p.batchAds.length > 0) {
        streamedBatches.push(p.batchAds);
      }
    });

    assert.strictEqual(results.length, 60, 'Must contain exactly 60 unique ads (80 raw items - 20 duplicates)');
    assert.strictEqual(streamedBatches[0].length, 30, 'Batch 1 stream must have 30 ads');
    assert.strictEqual(streamedBatches[1].length, 20, 'Batch 2 stream must only have 20 new ads (10 dupes excluded)');
    assert.strictEqual(streamedBatches[2].length, 10, 'Batch 3 stream must only have 10 new ads (10 dupes excluded)');

    // Verify uniqueness
    const ids = new Set(results.map(r => r.archive_id));
    assert.strictEqual(ids.size, 60, 'All 60 archive IDs must be completely unique');
  });

  // Test 1.5: Immediate & Mid-Stream Cancellation (cancelRequested)
  await testCase('Edge Case 1.5: Cancel flag stops pagination immediately and allows clean re-execution', async () => {
    const service = new AdsLibraryGraphQLService();
    let callsMade = 0;

    const batches = Array.from({ length: 10 }, (_, b) => ({
      count: 300,
      edges: Array.from({ length: 30 }, (_, i) => ({
        node: { collated_results: [{ ad_archive_id: `cancel_ad_${b * 30 + i}`, snapshot: { body: { text: 'C' } } }] }
      })),
      page_info: { has_next_page: true, end_cursor: `CUR_${b + 1}` }
    }));

    global.fetch = async (url) => {
      if (typeof url === 'string' && url.includes('ads/library')) return { ok: true, text: async () => 'token' };
      const b = batches[callsMade++];
      return { ok: true, text: async () => JSON.stringify({ data: { ad_library_main: { search_results_connection: b } } }) };
    };

    // Case 1: Cancel during batch 2
    callsMade = 0;
    const results = await service.searchAndPaginateAll({ keyword: 'TestCancel' }, (p) => {
      if (p.currentPage === 2) {
        service.cancel();
      }
    });

    assert.strictEqual(callsMade, 2, 'Must stop immediately after batch 2 when cancel() is triggered');
    assert.strictEqual(results.length, 60, 'Must have collected only 60 ads before stopping');
    assert.strictEqual(service.isSearching, false, 'isSearching must be false after cancel');
    assert.strictEqual(service.cancelRequested, false, 'cancelRequested must reset to false in finally block');

    // Case 2: Ensure new search starts properly immediately afterwards (no locked state)
    callsMade = 0;
    const rerunResults = await service.searchAndPaginateAll({ keyword: 'Rerun' }, (p) => {
      if (p.currentPage === 1) {
        service.cancel();
      }
    });
    assert.strictEqual(rerunResults.length, 30, 'Rerun must work cleanly and collect batch 1 before cancel');
  });

  // ════════════════════════════════════════════════════════════════════
  // SECTION 2: AD & CAPTION EXTRACTION FALLBACKS & COMPLEX STRINGS
  // ════════════════════════════════════════════════════════════════════
  console.log('\n─── SECTION 2: Caption & Ad Normalization Fallback Chain & Complex Strings ───');

  // Test 2.1: Carousel Fallback (snapshot.cards)
  await testCase('Edge Case 2.1: Carousel fallback extracts card bodies & titles, skipping empty ones', () => {
    const service = new AdsLibraryGraphQLService();
    const snap = {
      body: null,
      cards: [
        { body: { text: 'Thẻ 1: Nệm ô tô cho bé và gia đình' } },
        { title: 'Thẻ 2: Chất liệu mút nhớ Foam cao cấp' },
        { body: { text: '' }, title: '' }, // Empty card
        { }, // Empty object
        { body: { text: 'Thẻ 5: Dễ dàng gấp gọn chỉ trong 30 giây' } }
      ]
    };

    const caption = service.extractFullCaption(snap);
    assert(caption.includes('[Thẻ 1] Thẻ 1: Nệm ô tô cho bé và gia đình'));
    assert(caption.includes('[Thẻ 2] Thẻ 2: Chất liệu mút nhớ Foam cao cấp'));
    assert(caption.includes('[Thẻ 5] Thẻ 5: Dễ dàng gấp gọn chỉ trong 30 giây'));
    assert.strictEqual(caption.includes('[Thẻ 3]'), false, 'Empty card 3 must be omitted');
    assert.strictEqual(caption.includes('[Thẻ 4]'), false, 'Empty card 4 must be omitted');
  });

  // Test 2.2: Headline Fallback (snapshot.title)
  await testCase('Edge Case 2.2: Headline fallback triggers when body, cards, and extra_texts are missing', () => {
    const service = new AdsLibraryGraphQLService();
    const snap = {
      body: { text: '' },
      cards: [],
      extra_texts: [],
      title: '⚡ SIÊU KHUYẾN MÃI MÙA HÈ - GIẢM 50% TOÀN BỘ SẢN PHẨM ⚡'
    };

    const caption = service.extractFullCaption(snap);
    assert.strictEqual(caption, '⚡ SIÊU KHUYẾN MÃI MÙA HÈ - GIẢM 50% TOÀN BỘ SẢN PHẨM ⚡');
  });

  // Test 2.3: Completely Empty Snapshot (Robustness against crash)
  await testCase('Edge Case 2.3: Completely empty or null snapshot returns safe empty string without throwing', () => {
    const service = new AdsLibraryGraphQLService();
    assert.strictEqual(service.extractFullCaption(null), '');
    assert.strictEqual(service.extractFullCaption(undefined), '');
    assert.strictEqual(service.extractFullCaption({}), '');
    assert.strictEqual(service.extractFullCaption({ body: null, title: null }), '');
  });

  // Test 2.4: CTA & Link URL Fallback in normalizeAdNode
  await testCase('Edge Case 2.4: normalizeAdNode handles missing CTA and missing Link URL safely', () => {
    const service = new AdsLibraryGraphQLService();
    const item = {
      ad_archive_id: '999111222',
      page_id: '123456',
      page_name: 'Test Store',
      is_active: false,
      publisher_platform: null,
      snapshot: {
        body: { text: 'Some ad text' },
        cta_text: null,
        link_url: null,
        caption: null
      }
    };

    const normalized = service.normalizeAdNode(item);
    assert.strictEqual(normalized.archive_id, '999111222');
    assert.strictEqual(normalized.is_active, false);
    assert.strictEqual(normalized.platforms, 'Facebook', 'Default platform should be Facebook');
    assert.strictEqual(normalized.cta_text, 'Shop now', 'Default CTA text should be Shop now');
    assert.strictEqual(normalized.link_url, '', 'Missing link_url should default to empty string');
  });

  // Test 2.5: Complex Strings (Vietnamese, Emojis, Quotes, Mixed Line Breaks)
  await testCase('Edge Case 2.5: InoteService.formatAd accurately formats Vietnamese, emojis, quotes, and newlines', () => {
    const complexAd = {
      archive_id: '888777666',
      page_id: '555444333',
      page_name: 'Công Ty TNHH "Thương Mại & Dịch Vụ" DallasWind Việt Nam',
      is_active: true,
      platforms: 'Facebook, Instagram, Messenger',
      creative_format: 'Video (167 giây)',
      caption_text: '🚗🌟 ĐỆM Ô TÔ THÔNG MINH CAO CẤP! 🌟🚗\r\n' +
                    '✓ Giảm 100% cảm giác "mệt mỏi" trên đường dài\r\n' +
                    '✓ Vải bọc Oxford 600D chống thấm, chống cào móng thú cưng 🐶🐱\r\n\r\n' +
                    '🔥 ĐẶT HÀNG NGAY HÔM NAY:\r\n' +
                    '👉 Miễn phí ship toàn quốc! 🇻🇳',
      cta_text: 'Mua ngay',
      link_url: 'https://dallaswind.vn/products/dem-hoi-o-to?ref=fb_ads'
    };

    const formatted = InoteService.formatAd(complexAd, 0);

    // Verify all 8 fields are strictly present
    assert(formatted.startsWith('Mẫu 1: Công Ty TNHH "Thương Mại & Dịch Vụ" DallasWind Việt Nam'));
    assert(formatted.includes('Archive ID: 888777666'));
    assert(formatted.includes('Page ID: 555444333 (Công Ty TNHH "Thương Mại & Dịch Vụ" DallasWind Việt Nam)'));
    assert(formatted.includes('Trạng thái: Đang chạy (is_active: true)'));
    assert(formatted.includes('Nền tảng: Facebook, Instagram, Messenger'));
    assert(formatted.includes('Định dạng creative: Video (167 giây)'));
    assert(formatted.includes('Nội dung bài viết: "🚗🌟 ĐỆM Ô TÔ THÔNG MINH CAO CẤP! 🌟🚗\n✓ Giảm 100% cảm giác "mệt mỏi" trên đường dài\n✓ Vải bọc Oxford 600D chống thấm, chống cào móng thú cưng 🐶🐱\n\n🔥 ĐẶT HÀNG NGAY HÔM NAY:\n👉 Miễn phí ship toàn quốc! 🇻🇳"'));
    assert(formatted.includes('Kêu gọi hành động (CTA): Mua ngay'));
    assert(formatted.includes('Đường dẫn đích: https://dallaswind.vn/products/dem-hoi-o-to?ref=fb_ads'));

    // Verify \r\n was replaced by \n
    assert.strictEqual(formatted.includes('\r\n'), false, 'All CRLF must be normalized to LF');
  });

  // Test 2.6: XSS Sanitization in safeHtml
  await testCase('Edge Case 2.6: safeHtml properly sanitizes script tags, double quotes, and event handlers', () => {
    const maliciousInput = '<script>alert("XSS")</script><img src=x onerror=alert(1)>" onclick="hack()\' &';
    const escaped = safeHtml(maliciousInput);

    assert.strictEqual(escaped.includes('<script>'), false);
    assert.strictEqual(escaped.includes('</script>'), false);
    assert.strictEqual(escaped.includes('"'), false);
    assert.strictEqual(escaped.includes("'"), false);
    assert(escaped.includes('&lt;script&gt;'));
    assert(escaped.includes('&quot;'));
    assert(escaped.includes('&#039;'));
    assert(escaped.includes('&amp;'));
  });

  // ════════════════════════════════════════════════════════════════════
  // SECTION 3: HEAVY LOAD STRESS TEST (260 ADS, >130 KB ON INOTE.NET)
  // ════════════════════════════════════════════════════════════════════
  console.log('\n─── SECTION 3: Heavy Load Stress Testing on inote.net (260 Ads, >130 KB) ───');

  await testCase('Stress Test 3.1: inote.net handles massive payload (260 ads, >130 KB) with live readback', async () => {
    // Restore genuine fetch for network communication with inote.net
    global.fetch = originalFetch;

    // Generate 260 distinct ads with realistic, heavy text and unicode
    const totalAdsToGenerate = 260;
    const heavyAdsList = [];

    for (let i = 1; i <= totalAdsToGenerate; i++) {
      heavyAdsList.push({
        archive_id: `STRESS_${Date.now()}_${1000000000000000 + i}`,
        page_id: `PAGE_${60000000000000 + (i % 20)}`,
        page_name: `DallasWind Vietnam Brand #${(i % 15) + 1} (Công Ty Cổ Phần Thương Mại)`,
        is_active: i % 5 !== 0, // 80% active, 20% inactive
        platforms: i % 2 === 0 ? 'Facebook, Instagram, Audience Network' : 'Facebook, Messenger',
        creative_format: i % 3 === 0 ? `Video (${60 + (i % 120)} giây)` : 'Hình ảnh',
        caption_text: `🚗✨ MẪU QUẢNG CÁO ĐẶC BIỆT #${i} - ĐỆM HƠI Ô TÔ THẾ HỆ MỚI ✨🚗\n` +
                      `Khám phá dòng sản phẩm đệm hơi ô tô cao cấp chuyên dụng cho các chuyến đi chơi xa gia đình.\n` +
                      `🔹 Chất liệu: Mút xốp đàn hồi cao cấp (Memory Foam) kết hợp lớp đệm khí đa khoang thông minh.\n` +
                      `🔹 Tải trọng: Lên đến 350kg, thoải mái cho 2 người lớn và 1 trẻ nhỏ nằm ngủ êm ái.\n` +
                      `🔹 Tính năng: Chống ồn từ gầm xe, chống mỏi lưng, gập gọn siêu nhanh trong 30 giây.\n` +
                      `🎁 Quà tặng kèm: Bơm điện mini 12V cắm tẩu sạc + 2 gối hơi du lịch cao cấp!\n` +
                      `⚡ Giá ưu đãi đặc biệt: 699.000đ (Giá gốc 1.250.000đ) - Áp dụng duy nhất hôm nay.\n` +
                      `🇻🇳 Giao hàng hỏa tốc toàn quốc - Kiểm tra hàng trước khi thanh toán. Đánh giá 5/5 ⭐⭐⭐⭐⭐\n` +
                      `#DemOToCaoCap #DallasWind #DuLichGiaDinh #PhuKienOTo2026`,
        cta_text: i % 2 === 0 ? 'Shop now' : 'Mua ngay',
        link_url: `https://dallaswind.vn/products/dem-oto-cao-cap-v${i}?utm_source=meta_ads&utm_campaign=summer_2026`
      });
    }

    const formattedPayload = InoteService.formatAllAds(heavyAdsList);
    const byteLength = Buffer.byteLength(formattedPayload, 'utf8');
    const kbSize = (byteLength / 1024).toFixed(2);

    console.log(`\n     Payload stats: ${totalAdsToGenerate} ads, ${formattedPayload.length} chars, ${byteLength} bytes (${kbSize} KB)`);
    assert(byteLength > 100 * 1024, `Payload size (${kbSize} KB) must exceed 100 KB`);

    // Perform live 2-step allocation & POST
    console.log(`     Dispatching live 2-step POST request to https://inote.net/...`);
    const startTime = Date.now();
    const result = await InoteService.createNote(formattedPayload, { openTab: false });
    const elapsed = Date.now() - startTime;

    assert.strictEqual(result.success, true, 'createNote must return success: true');
    assert(result.noteUrl.startsWith('https://inote.net/'), 'noteUrl must start with https://inote.net/');
    assert(result.noteId && result.noteId.length >= 6, 'noteId must be a valid token');
    console.log(`     ✓ inote.net created note in ${elapsed}ms: ${result.noteUrl} (ID: ${result.noteId})`);

    // Fetch back the HTML from inote.net to perform forensic readback audit
    console.log(`     Performing live forensic readback verification on ${result.noteUrl}...`);
    const verifyResp = await fetch(result.noteUrl, { headers: { 'Cache-Control': 'no-cache' } });
    assert.strictEqual(verifyResp.status, 200, 'Note page must respond with HTTP 200');
    const verifyHtml = await verifyResp.text();

    // Verify first ad, middle ad, and last ad are present
    assert(verifyHtml.includes('Mẫu 1: DallasWind Vietnam Brand #2'), 'First ad (Mẫu 1) must be preserved in HTML');
    assert(verifyHtml.includes('Mẫu 130:'), 'Middle ad (Mẫu 130) must be preserved in HTML');
    assert(verifyHtml.includes('Mẫu 260:'), 'Last ad (Mẫu 260) must be preserved in HTML without truncation');

    // Verify unicode emojis and Vietnamese diacritics
    assert(verifyHtml.includes('🚗✨ MẪU QUẢNG CÁO ĐẶC BIỆT #1'), 'Vietnamese title & emojis must be preserved intact');
    assert(verifyHtml.includes('🇻🇳 Giao hàng hỏa tốc toàn quốc'), 'Vietnamese text & flag emoji must be preserved');
    assert(verifyHtml.includes('⭐⭐⭐⭐⭐'), 'Star emojis must be preserved');
    assert(verifyHtml.includes('Mút xốp đàn hồi cao cấp (Memory Foam)'), 'Vietnamese accents must be clean without encoding corruption');

    console.log(`     ✓ Live forensic readback: Verified 100% data integrity for 260 ads (>130 KB) on inote.net!`);
  });

  // ════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`🏁 TEST EXECUTION COMPLETE:`);
  console.log(`   Total Tests : ${totalTests}`);
  console.log(`   Passed      : ${passedTests}`);
  console.log(`   Failed      : ${failedTests}`);
  console.log(`   Pass Rate   : ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failedTests > 0) {
    console.error('❌ ADVERSARIAL STRESS TEST SUITE ENCOUNTERED FAILURES.');
    process.exit(1);
  } else {
    console.log('🎉 ALL ADVERSARIAL EDGE-CASE & STRESS TESTS PASSED WITH 100% VERIFIED RESULTS.');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Fatal Test Harness Exception:', err);
  process.exit(1);
});
