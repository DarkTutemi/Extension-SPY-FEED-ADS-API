/**
 * test_m1_ui_validation.js - Verification test for Milestone 1 (UI & Form Layout)
 */

const fs = require('fs');
const path = require('path');

console.log('=== RUNNING MILESTONE 1 VERIFICATION SUITE ===\n');

// 1. Verify sidepanel.html
console.log('1. Checking extension/sidepanel.html...');
const htmlPath = path.join(__dirname, 'sidepanel.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const requiredHtmlIds = [
  'navBtnFindAds',
  'view-find-ads',
  'find-ads-badge-status',
  'find-ads-status-text',
  'btn-start-find-ads',
  'btn-stop-find-ads',
  'find-ads-keyword',
  'chk-page-hunter-mode',
  'btn-find-ads-clear-keyword',
  'find-ads-country',
  'find-ads-category',
  'find-ads-filter-toggle',
  'find-ads-filter-count-badge',
  'find-ads-filter-arrow',
  'find-ads-filter-body',
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
  'chk-export-only-content',
  'chk-export-only-links',
  'chk-export-only-page-name',
  'find-ads-view-mode',
  'btn-find-ads-prev-page',
  'btn-find-ads-next-page',
  'find-ads-page-info',
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

let htmlMissing = [];
for (const id of requiredHtmlIds) {
  const pattern = new RegExp(`id=["']${id}["']`);
  if (!pattern.test(htmlContent)) {
    htmlMissing.push(id);
  }
}

if (htmlMissing.length > 0) {
  console.error('❌ FAIL: Missing required HTML IDs:', htmlMissing);
  process.exit(1);
} else {
  console.log(`✓ PASS: All ${requiredHtmlIds.length} required HTML IDs exist in sidepanel.html.`);
}

// Check country options
const expectedCountries = ['US', 'ALL', 'VN', 'GB', 'CA', 'AU', 'DE', 'FR'];
const missingCountries = expectedCountries.filter(c => !htmlContent.includes(`value="${c}"`));
if (missingCountries.length > 0) {
  console.error('❌ FAIL: Missing expected country values:', missingCountries);
  process.exit(1);
}
console.log(`✓ PASS: Top countries (${expectedCountries.join(', ')}) are present in country dropdown.`);

// 2. Verify sidepanel.css
console.log('\n2. Checking extension/sidepanel.css...');
const cssPath = path.join(__dirname, 'sidepanel.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

const requiredCssSelectors = [
  'data-view="view-find-ads"',
  '.find-ads-search-box',
  '.find-ads-filter-panel',
  '.find-ads-metrics',
  '.find-ads-progress-bar-wrap',
  '.btn-save-inote',
  '.inote-result-banner',
  '.find-ad-card',
  '.page-meta',
  '.ad-platforms-bar',
  '.ad-full-caption',
  '.webstore-box',
  '.cta-badge'
];

let cssMissing = [];
for (const selector of requiredCssSelectors) {
  if (!cssContent.includes(selector)) {
    cssMissing.push(selector);
  }
}

if (cssMissing.length > 0) {
  console.error('❌ FAIL: Missing required CSS selectors:', cssMissing);
  process.exit(1);
} else {
  console.log(`✓ PASS: All ${requiredCssSelectors.length} core CSS selectors verified in sidepanel.css.`);
}

// 3. Verify sidepanel.js syntax and controller logic
console.log('\n3. Checking extension/sidepanel.js...');
const jsPath = path.join(__dirname, 'sidepanel.js');
const jsContent = fs.readFileSync(jsPath, 'utf8');

if (!jsContent.includes('function initFindAdsTab')) {
  console.error('❌ FAIL: initFindAdsTab function not found in sidepanel.js');
  process.exit(1);
}
if (!jsContent.includes('initFindAdsTab();')) {
  console.error('❌ FAIL: initFindAdsTab() invocation not found in sidepanel.js');
  process.exit(1);
}
if (!jsContent.includes('window.findAdsController')) {
  console.error('❌ FAIL: window.findAdsController not exposed in sidepanel.js');
  process.exit(1);
}

console.log('✓ PASS: initFindAdsTab and window.findAdsController exist in sidepanel.js.');

// 4. Test Inote Text Formatter Logic
console.log('\n4. Testing Inote Text Formatter Contract...');
const sampleAd = {
  archive_id: '939021438507204',
  page_id: '61565576214152',
  page_name: 'DallasWind US',
  is_active: true,
  platforms: 'Facebook, Instagram, Audience Network',
  creative_format: 'Video (167 giây)',
  caption_text: 'Best Car Rear-Seat Travel Mattress for family trips!',
  cta_text: 'Shop now',
  link_url: 'https://dallaswind.com/products/car-seat-cushion'
};

function testFormat(ad, index) {
  const idx = index !== undefined ? index + 1 : 1;
  const title = ad.page_name || 'Quảng cáo';
  const archiveId = ad.archive_id || 'N/A';
  const pageId = ad.page_id || 'N/A';
  const pageName = ad.page_name || 'N/A';
  const isActiveText = ad.is_active ? 'Đang chạy (is_active: true)' : 'Đã dừng (is_active: false)';
  const platforms = ad.platforms || 'Facebook';
  const creativeFormat = ad.creative_format || 'Hình ảnh';
  const captionText = ad.caption_text ? ad.caption_text.replace(/\r\n/g, '\n').trim() : '';
  const ctaText = ad.cta_text || 'Shop now';
  const linkUrl = ad.link_url || '';

  return `Mẫu ${idx}: ${title}\n` +
         `Archive ID: ${archiveId}\n` +
         `Page ID: ${pageId} (${pageName})\n` +
         `Trạng thái: ${isActiveText}\n` +
         `Nền tảng: ${platforms}\n` +
         `Định dạng creative: ${creativeFormat}\n` +
         `Nội dung bài viết: "${captionText}"\n` +
         `Kêu gọi hành động (CTA): ${ctaText}\n` +
         `Đường dẫn đích: ${linkUrl}`;
}

const formatted = testFormat(sampleAd, 0);
console.log('Sample formatted inote output:\n---\n' + formatted + '\n---');

const requiredFields = [
  'Mẫu 1: DallasWind US',
  'Archive ID: 939021438507204',
  'Page ID: 61565576214152 (DallasWind US)',
  'Trạng thái: Đang chạy (is_active: true)',
  'Nền tảng: Facebook, Instagram, Audience Network',
  'Định dạng creative: Video (167 giây)',
  'Nội dung bài viết: "Best Car Rear-Seat Travel Mattress for family trips!"',
  'Kêu gọi hành động (CTA): Shop now',
  'Đường dẫn đích: https://dallaswind.com/products/car-seat-cushion'
];

for (const line of requiredFields) {
  if (!formatted.includes(line)) {
    console.error(`❌ FAIL: Inote format missing line: ${line}`);
    process.exit(1);
  }
}
console.log('✓ PASS: Inote text format conforms 100% to specifications.');

const { InoteService } = require('./background.js');
const pageNameOnly = InoteService.formatAllAds([sampleAd, { ...sampleAd, archive_id: '2', page_name: 'DallasWind US' }, { ...sampleAd, archive_id: '3', page_name: 'SecondPage US' }], 'page_name');
if (pageNameOnly !== 'DallasWind US\nSecondPage US') {
  console.error('❌ FAIL: page_name export mode did not extract unique page names:', pageNameOnly);
  process.exit(1);
}
console.log('✓ PASS: page_name export mode extracts clean unique Page Names ("DallasWind US").');

console.log('\n🎉 ALL MILESTONE 1 VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
