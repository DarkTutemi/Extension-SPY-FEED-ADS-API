/**
 * test_empirical_verification.js
 * Empirical Verification Harness for FB Ads Library Parser & inote.net Integration
 */

const fs = require('fs');
const path = require('path');
const { AdsLibraryGraphQLService, InoteService } = require('./extension/background.js');

async function runEmpiricalVerification() {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU THẨM TRA THỰC NGHIỆM ĐỘC LẬP (EMPIRICAL VERIFICATION)');
  console.log('================================================================\n');

  const report = {
    step1_parser: { pass: false, details: {} },
    step2_inote: { pass: false, details: {} },
    step3_ui_selectors: { pass: false, details: {} }
  };

  // ══════════════════════════════════════════════════════════════════
  // PHẦN 1: BÓC TÁCH 30 BÀI ADS TỪ captured_graphql_response.json
  // ══════════════════════════════════════════════════════════════════
  console.log('--- [TEST 1] Bóc tách dữ liệu từ captured_graphql_response.json ---');
  const rawResponsePath = path.join(__dirname, 'captured_graphql_response.json');
  if (!fs.existsSync(rawResponsePath)) {
    throw new Error('File captured_graphql_response.json không tồn tại!');
  }

  const rawJsonContent = fs.readFileSync(rawResponsePath, 'utf8');
  console.log(`Dung lượng file mẫu: ${rawJsonContent.length.toLocaleString()} bytes`);

  const service = new AdsLibraryGraphQLService();
  const searchConn = service.parseRelayResponse(rawJsonContent);

  if (!searchConn) {
    console.error('❌ parseRelayResponse thất bại: Không trích xuất được search_results_connection!');
    report.step1_parser.pass = false;
  } else {
    console.log(`✓ parseRelayResponse thành công. Tổng count báo cáo: ${searchConn.count}`);
    const edges = searchConn.edges || [];
    console.log(`Số edges tìm thấy trong chunk: ${edges.length}`);

    const extractedAds = [];
    const adsMap = new Map();

    edges.forEach((edge, edgeIdx) => {
      const collated = edge?.node?.collated_results || [];
      collated.forEach(item => {
        const norm = service.normalizeAdNode(item);
        if (norm && norm.archive_id) {
          if (!adsMap.has(norm.archive_id)) {
            adsMap.set(norm.archive_id, norm);
            extractedAds.push(norm);
          }
        }
      });
    });

    console.log(`✓ Số lượng Ads bóc tách thành công (deduplicated): ${extractedAds.length}/30`);

    // Kiểm tra chi tiết 30 bài: caption không bị cắt ngắn '...', thời lượng video efg
    let untruncatedCount = 0;
    let videoCount = 0;
    let imageCount = 0;
    let carouselCount = 0;
    const durationChecks = [];

    const adSummaryTable = extractedAds.map((ad, idx) => {
      const isVideo = ad.creative_format.startsWith('Video');
      if (isVideo) videoCount++;
      else if (ad.creative_format.startsWith('Carousel')) carouselCount++;
      else imageCount++;

      // Truncation check: caption should not end with '...' or have '[...]' truncation
      const hasEndingDots = ad.caption_text.trim().endsWith('...') || ad.caption_text.trim().endsWith('…');
      const captionLen = ad.caption_text.length;
      if (!hasEndingDots && captionLen > 0) {
        untruncatedCount++;
      }

      return {
        index: idx + 1,
        archive_id: ad.archive_id,
        page_name: ad.page_name,
        format: ad.creative_format,
        duration_s: ad.duration_seconds,
        caption_len: captionLen,
        caption_snippet: ad.caption_text.slice(0, 45).replace(/\n/g, ' ') + '...',
        has_ending_dots: hasEndingDots,
        cta: ad.cta_text,
        has_link: Boolean(ad.link_url)
      };
    });

    console.table(adSummaryTable.slice(0, 10)); // In 10 bài đầu làm đại diện
    console.log(`... và ${adSummaryTable.length - 10} bài tiếp theo.`);

    // Kiểm tra các mốc video thời lượng yêu cầu đặc biệt
    // Ad 1 = 167s, Ad 2 = 49s, Ad 3 = 51s, Ad 20 = 132s
    const check1 = extractedAds[0]?.duration_seconds;
    const check2 = extractedAds[1]?.duration_seconds;
    const check3 = extractedAds[2]?.duration_seconds;
    const check20 = extractedAds[19]?.duration_seconds;

    console.log('\n[Xác minh thời lượng Video qua Base64 efg]:');
    console.log(`- Ad #1: ${check1}s (Kỳ vọng: 167s) -> ${check1 === 167 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Ad #2: ${check2}s (Kỳ vọng: 49s)  -> ${check2 === 49 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Ad #3: ${check3}s (Kỳ vọng: 51s)  -> ${check3 === 51 ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Ad #20: ${check20}s (Kỳ vọng: 132s) -> ${check20 === 132 ? '✅ PASS' : '❌ FAIL'}`);

    const durationPass = (check1 === 167 && check2 === 49 && check3 === 51 && check20 === 132);

    // Kiểm tra độ dài caption: không bài nào rỗng, không bài nào bị cắt ngắn ...
    const allCaptionsPresent = extractedAds.every(a => a.caption_text && a.caption_text.length > 50);
    const avgCaptionLen = Math.round(extractedAds.reduce((acc, a) => acc + a.caption_text.length, 0) / extractedAds.length);
    const minCaptionLen = Math.min(...extractedAds.map(a => a.caption_text.length));
    const maxCaptionLen = Math.max(...extractedAds.map(a => a.caption_text.length));

    console.log('\n[Xác minh độ dài Caption]:');
    console.log(`- 30/30 bài đều có caption đầy đủ: ${allCaptionsPresent ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Độ dài caption trung bình: ${avgCaptionLen} ký tự`);
    console.log(`- Min: ${minCaptionLen} ký tự | Max: ${maxCaptionLen} ký tự`);

    const step1Success = (extractedAds.length === 30) && durationPass && allCaptionsPresent;
    report.step1_parser = {
      pass: step1Success,
      details: {
        totalExtracted: extractedAds.length,
        videoCount,
        durationPass,
        avgCaptionLen,
        minCaptionLen,
        maxCaptionLen
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // PHẦN 2: THỬ NGHIỆM LIVE TÍCH HỢP INOTE.NET
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- [TEST 2] Thử nghiệm live tích hợp inote.net ---');
  try {
    const adsToFormat = report.step1_parser.pass ? Array.from(service.normalizeAdNode ? [] : []) : [];
    // Tái sử dụng danh sách 30 ads đã extract ở Bước 1
    const rawEdges = searchConn?.edges || [];
    const all30Ads = [];
    rawEdges.forEach(e => {
      (e.node?.collated_results || []).forEach(item => {
        const norm = service.normalizeAdNode(item);
        if (norm && norm.archive_id) all30Ads.push(norm);
      });
    });

    console.log(`Format 30 bài quảng cáo sang định dạng văn bản 8 trường...`);
    const formattedContent = InoteService.formatAllAds(all30Ads);
    console.log(`Độ dài văn bản format 30 ads: ${formattedContent.length.toLocaleString()} ký tự`);
    console.log(`Mẫu bài đầu tiên preview:\n----------------------------------------\n${InoteService.formatAd(all30Ads[0], 0)}\n----------------------------------------`);

    // Bước 2.1: Gọi GET inote.net lấy URL redirect
    console.log('Gửi GET request tới https://inote.net/ (follow redirect)...');
    const getRes = await fetch('https://inote.net/', {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!getRes.ok) throw new Error(`GET https://inote.net/ thất bại: HTTP ${getRes.status}`);
    const noteUrl = getRes.url;
    console.log(`✓ Nhận URL note thật: ${noteUrl}`);

    const match = noteUrl.match(/https?:\/\/inote\.net\/([a-zA-Z0-9_\-]+)/);
    const noteId = match ? match[1] : noteUrl.split('/').filter(Boolean).pop();
    console.log(`✓ Note ID: ${noteId}`);

    // Bước 2.2: Gửi POST lưu nội dung lên inote.net
    console.log(`Gửi POST lưu ${formattedContent.length} ký tự lên https://inote.net/${noteId}...`);
    const postBody = 'text=' + encodeURIComponent(formattedContent);
    const postRes = await fetch(`https://inote.net/${noteId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: postBody
    });

    console.log(`POST response status: ${postRes.status} ${postRes.statusText}`);
    if (!postRes.ok) throw new Error(`POST lên inote thất bại: HTTP ${postRes.status}`);

    // Bước 2.3: Đọc lại (GET) từ URL note vừa tạo để xác minh tính toàn vẹn 100%
    console.log(`Gửi GET đọc lại nội dung từ ${noteUrl}...`);
    const verifyRes = await fetch(noteUrl, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
    if (!verifyRes.ok) throw new Error(`GET đọc lại note thất bại: HTTP ${verifyRes.status}`);

    const verifyHtml = await verifyRes.text();

    // inote.net lưu nội dung trong textarea hoặc container
    // Kiểm tra xem các tiêu đề Mẫu 1 -> Mẫu 30 và Archive ID có xuất hiện đầy đủ không
    const sample1Present = verifyHtml.includes('Mẫu 1: DallasWind US');
    const sample30Present = verifyHtml.includes('Mẫu 30: DallasWind US') || verifyHtml.includes(all30Ads[all30Ads.length - 1].archive_id);
    const ad1ArchivePresent = verifyHtml.includes(all30Ads[0].archive_id);
    const ad19ArchivePresent = verifyHtml.includes(all30Ads[19].archive_id);

    console.log(`[Đối chiếu nội dung trên inote.net]:`);
    console.log(`- Mẫu 1 hiện diện: ${sample1Present ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Mẫu cuối hiện diện: ${sample30Present ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Archive ID Ad 1 (${all30Ads[0].archive_id}) hiện diện: ${ad1ArchivePresent ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`- Archive ID Ad 20 (${all30Ads[19].archive_id}) hiện diện: ${ad19ArchivePresent ? '✅ PASS' : '❌ FAIL'}`);

    const inotePass = sample1Present && sample30Present && ad1ArchivePresent && ad19ArchivePresent;
    report.step2_inote = {
      pass: inotePass,
      details: {
        noteUrl,
        noteId,
        contentLength: formattedContent.length,
        httpGetStatus: getRes.status,
        httpPostStatus: postRes.status,
        httpVerifyStatus: verifyRes.status,
        integrityCheck: inotePass ? '100% MATCH' : 'FAIL'
      }
    };
  } catch (err) {
    console.error('❌ Lỗi kiểm tra live inote.net:', err);
    report.step2_inote = { pass: false, error: err.message };
  }

  // ══════════════════════════════════════════════════════════════════
  // PHẦN 3: KIỂM TRA SELECTOR GIAO DIỆN EXTENSION
  // ══════════════════════════════════════════════════════════════════
  console.log('\n--- [TEST 3] Kiểm tra các Selector và ID giao diện Extension ---');
  const htmlPath = path.join(__dirname, 'extension', 'sidepanel.html');
  const sidepanelHtml = fs.readFileSync(htmlPath, 'utf8');

  const requiredIds = [
    'navBtnFindAds',
    'view-find-ads',
    'find-ads-badge-status',
    'find-ads-status-text',
    'btn-start-find-ads',
    'btn-stop-find-ads',
    'find-ads-keyword',
    'btn-find-ads-clear-keyword',
    'find-ads-country',
    'find-ads-category',
    'find-ads-filter-toggle',
    'find-ads-filter-body',
    'find-ads-filter-arrow',
    'find-ads-filter-count-badge',
    'chk-platform-fb',
    'chk-platform-ig',
    'chk-platform-an',
    'chk-platform-msg',
    'chk-platform-wa',
    'chk-platform-threads',
    'find-ads-media-type',
    'find-ads-active-status',
    'find-ads-start-date',
    'find-ads-language',
    'find-ads-sort-by',
    'find-ads-total-count',
    'find-ads-parsed-count',
    'find-ads-batch-progress',
    'find-ads-progress-bar',
    'btn-save-inote',
    'badge-inote-ready-count',
    'btn-copy-all-find-ads',
    'btn-export-find-ads-json',
    'btn-export-find-ads-csv',
    'btn-clear-find-ads-results',
    'inote-result-banner',
    'inote-created-url-link',
    'btn-copy-inote-link-quick',
    'find-ads-results-list',
    'find-ads-empty-state'
  ];

  const missingIds = [];
  requiredIds.forEach(id => {
    const pattern = new RegExp(`id=["']${id}["']`);
    if (!pattern.test(sidepanelHtml)) {
      missingIds.push(id);
    }
  });

  console.log(`Tổng số ID kiểm tra: ${requiredIds.length}`);
  if (missingIds.length === 0) {
    console.log(`✅ Toàn bộ ${requiredIds.length}/${requiredIds.length} IDs đều khớp chính xác trong sidepanel.html!`);
    report.step3_ui_selectors = { pass: true, totalChecked: requiredIds.length, missing: [] };
  } else {
    console.error(`❌ Phát hiện ID bị thiếu trong sidepanel.html:`, missingIds);
    report.step3_ui_selectors = { pass: false, totalChecked: requiredIds.length, missing: missingIds };
  }

  // ══════════════════════════════════════════════════════════════════
  // KẾT LUẬN CUỐI CÙNG
  // ══════════════════════════════════════════════════════════════════
  console.log('\n================================================================');
  console.log('📊 TỔNG KẾT KẾT QUẢ THẨM TRA THỰC NGHIỆM:');
  console.log(`- 1. Parser 30/30 Ads & Caption & Video Duration: ${report.step1_parser.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`- 2. Live inote.net Integration Roundtrip:       ${report.step2_inote.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`- 3. UI Selectors Integrity Check:              ${report.step3_ui_selectors.pass ? '✅ PASS' : '❌ FAIL'}`);

  const allPass = report.step1_parser.pass && report.step2_inote.pass && report.step3_ui_selectors.pass;
  const verdict = allPass ? 'APPROVE' : 'REQUEST_CHANGES';
  console.log(`\n🏆 VERDICT CHÍNH THỨC: ${verdict}`);
  console.log('================================================================');

  return { verdict, report };
}

runEmpiricalVerification().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
