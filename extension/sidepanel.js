/**
 * sidepanel.js - Điều khiển giao diện Side Panel cho FB Video Ads Hunter (hỗ trợ Tab Log & Filter)
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── DOM Elements ──────────────────────────────────────────────────
  const btnToggleScan = document.getElementById('btnToggleScan');
  const btnIcon = document.getElementById('btnIcon');
  const btnLabel = document.getElementById('btnLabel');
  const badgeStatus = document.getElementById('badgeStatus');
  const statusText = document.getElementById('statusText');

  const statScanned = document.getElementById('statScanned');
  const statAdsFound = document.getElementById('statAdsFound');
  const statMatched = document.getElementById('statMatched');
  const listCount = document.getElementById('listCount');

  const settingsToggle = document.getElementById('settingsToggle');
  const settingsBody = document.getElementById('settingsBody');
  const inputMinLikes = document.getElementById('inputMinLikes');
  const selectRatio = document.getElementById('selectRatio');
  const selectAutoRefresh = document.getElementById('selectAutoRefresh');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const btnClearList = document.getElementById('btnClearList');

  const selectWarmupEnabled = document.getElementById('selectWarmupEnabled');
  const inputWarmupThreshold = document.getElementById('inputWarmupThreshold');
  const inputWarmupWatchSeconds = document.getElementById('inputWarmupWatchSeconds');
  const selectWarmupReactionMode = document.getElementById('selectWarmupReactionMode');

  // Exclusion Modal DOM Elements
  const btnOpenExclusionModal = document.getElementById('btnOpenExclusionModal');
  const btnExclusionModalText = document.getElementById('btnExclusionModalText');
  const warmupExclusionModal = document.getElementById('warmupExclusionModal');
  const btnCloseExclusionModal = document.getElementById('btnCloseExclusionModal');
  const btnCancelExclusionModal = document.getElementById('btnCancelExclusionModal');
  const btnSaveExclusionModal = document.getElementById('btnSaveExclusionModal');
  const txtWarmupExcludedPages = document.getElementById('txtWarmupExcludedPages');
  const txtWarmupExcludedKeywords = document.getElementById('txtWarmupExcludedKeywords');
  const badgeCountExcludedPages = document.getElementById('badgeCountExcludedPages');
  const badgeCountExcludedKeywords = document.getElementById('badgeCountExcludedKeywords');

  let warmupExcludedPages = [];
  let warmupExcludedKeywords = [];

  // AI Vision & Captcha Controls
  const aiSettingsToggle = document.getElementById('aiSettingsToggle');
  const aiSettingsBody = document.getElementById('aiSettingsBody');
  const aiSettingsArrow = document.getElementById('aiSettingsArrow');
  const txtGeminiPool = document.getElementById('txtGeminiPool');
  const txtDeepseekKey = document.getElementById('txtDeepseekKey');
  const txtTwoCaptchaKey = document.getElementById('txtTwoCaptchaKey');
  const btnSaveAIKeys = document.getElementById('btnSaveAIKeys');

  // Tabs
  const tabNavBtns = document.querySelectorAll('.tab-nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const tabAdsBadge = document.getElementById('tabAdsBadge');
  const tabLogsBadge = document.getElementById('tabLogsBadge');
  const tabTestBadge = document.getElementById('tabTestBadge');

  // Ads List
  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const adsListContainer = document.getElementById('adsListContainer');
  const emptyState = document.getElementById('emptyState');

  // Logs Tab
  const logsListContainer = document.getElementById('logsListContainer');
  const emptyLogState = document.getElementById('emptyLogState');
  const btnClearLogs = document.getElementById('btnClearLogs');
  const btnDownloadLogText = document.getElementById('btnDownloadLogText');
  const btnDownloadLogJson = document.getElementById('btnDownloadLogJson');
  const logFilterPills = document.querySelectorAll('[data-log-filter]');
  const autoScrollBadge = document.getElementById('autoScrollBadge');
  const autoScrollDot = document.getElementById('autoScrollDot');
  const autoScrollStatusText = document.getElementById('autoScrollStatusText');

  let isScanning = false;
  let adsList = [];
  let logsList = [];
  let currentLogFilter = 'all';

  function updateExclusionBadgeUI() {
    const total = warmupExcludedPages.length + warmupExcludedKeywords.length;
    if (btnExclusionModalText) {
      btnExclusionModalText.textContent = `Danh sách Fanpage & Từ khóa loại trừ (${total})`;
    }
    if (badgeCountExcludedPages) {
      badgeCountExcludedPages.textContent = `${warmupExcludedPages.length} Fanpage`;
    }
    if (badgeCountExcludedKeywords) {
      badgeCountExcludedKeywords.textContent = `${warmupExcludedKeywords.length} từ khóa`;
    }
  }

  // ── Auto-scroll State ─────────────────────────────────────────────
  let isAutoScrollEnabled = true;
  let isMouseInsideLogs = false;
  let isUserInteractingWithLogs = false;
  let autoScrollLoopTimer = null;
  let idleResumeTimer = null;
  let activeTabName = 'tab-ads';

  // ── Khởi tạo & Đọc trạng thái ban đầu ─────────────────────────────
  function init() {
    chrome.runtime.sendMessage({ action: 'GET_SCANNER_STATE' }, (res) => {
      if (res?.data) {
        const state = res.data;
        updateScanButtonUI(state.isScanning);
        updateStatsUI(state);

        if (state.settings) {
          inputMinLikes.value = state.settings.minLikes || 500;
          selectRatio.value = state.settings.videoEngagementRatio || '1/2';
          if (selectAutoRefresh) {
            selectAutoRefresh.value = state.settings.autoRefreshMinutes !== undefined ? String(state.settings.autoRefreshMinutes) : '5';
          }
          if (selectWarmupEnabled) {
            selectWarmupEnabled.value = state.settings.warmupEnabled ? 'true' : 'false';
          }
          if (inputWarmupThreshold) {
            inputWarmupThreshold.value = state.settings.warmupThreshold || 10;
          }
          if (inputWarmupWatchSeconds) {
            inputWarmupWatchSeconds.value = state.settings.warmupWatchSeconds || 15;
          }
          if (selectWarmupReactionMode && state.settings.warmupReaction) {
            selectWarmupReactionMode.value = state.settings.warmupReaction;
          }
          if (Array.isArray(state.settings.warmupExcludedPages)) {
            warmupExcludedPages = state.settings.warmupExcludedPages;
          }
          if (Array.isArray(state.settings.warmupExcludedKeywords)) {
            warmupExcludedKeywords = state.settings.warmupExcludedKeywords;
          }
          updateExclusionBadgeUI();
          if (txtGeminiPool && Array.isArray(state.settings.geminiKeys) && state.settings.geminiKeys.length > 0) {
            txtGeminiPool.value = state.settings.geminiKeys.join('\n');
          }
          if (txtDeepseekKey && state.settings.deepseekKey) {
            txtDeepseekKey.value = state.settings.deepseekKey;
          }
          if (txtTwoCaptchaKey && state.settings.twoCaptchaKey) {
            txtTwoCaptchaKey.value = state.settings.twoCaptchaKey;
          }
          if (state.settings.autoScroll !== undefined) {
            isAutoScrollEnabled = Boolean(state.settings.autoScroll);
            updateAutoScrollBadgeUI();
          }
        }
      }
    });

    // Tải danh sách ads đã lưu và trạng thái tự cuộn
    chrome.storage.local.get(['matchedAdsList', 'adHunterLogs', 'isAutoScrollEnabled', 'geminiKeys', 'deepseekKey', 'twoCaptchaKey', 'warmupReaction', 'warmupExcludedPages', 'warmupExcludedKeywords'], (res) => {
      adsList = res.matchedAdsList || [];
      logsList = res.adHunterLogs || [];
      if (res.isAutoScrollEnabled !== undefined) {
        isAutoScrollEnabled = Boolean(res.isAutoScrollEnabled);
      }
      if (selectWarmupReactionMode && res.warmupReaction) {
        selectWarmupReactionMode.value = res.warmupReaction;
      }
      if (Array.isArray(res.warmupExcludedPages)) {
        warmupExcludedPages = res.warmupExcludedPages;
      }
      if (Array.isArray(res.warmupExcludedKeywords)) {
        warmupExcludedKeywords = res.warmupExcludedKeywords;
      }
      updateExclusionBadgeUI();
      if (txtGeminiPool && Array.isArray(res.geminiKeys) && res.geminiKeys.length > 0) {
        txtGeminiPool.value = res.geminiKeys.join('\n');
      }
      if (txtDeepseekKey && res.deepseekKey) {
        txtDeepseekKey.value = res.deepseekKey;
      }
      if (txtTwoCaptchaKey && res.twoCaptchaKey) {
        txtTwoCaptchaKey.value = res.twoCaptchaKey;
      }
      updateAutoScrollBadgeUI();
      renderAdsList();
      renderLogsList();
    });
  }

  // ── Quản lý 2 Tab Lớn (Video Ads Hunter vs Manual) ─────────────────
  const topNavBtns = document.querySelectorAll('.top-nav-btn');
  const mainViews = document.querySelectorAll('.main-view');

  topNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      topNavBtns.forEach(b => b.classList.remove('active'));
      mainViews.forEach(v => {
        v.classList.remove('active');
        v.style.display = 'none';
      });

      btn.classList.add('active');
      const viewEl = document.getElementById(targetView);
      if (viewEl) {
        viewEl.classList.add('active');
        viewEl.style.display = 'flex';
      }

      if (targetView !== 'view-hunter') {
        stopAutoScrollLoop();
      } else if (activeTabName === 'tab-logs') {
        startAutoScrollLoop();
        performAutoScrollStep();
      }
    });
  });

  // ── Quản lý Chuyển Tab Con (Bên trong Video Ads Hunter) ───────────
  tabNavBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.dataset.tab;
      activeTabName = targetTabId;

      tabNavBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(targetTabId);
      if (targetContent) targetContent.classList.add('active');

      if (targetTabId === 'tab-logs') {
        startAutoScrollLoop();
        performAutoScrollStep();
      } else {
        stopAutoScrollLoop();
      }
    });
  });

  // ── Cập nhật giao diện Trạng thái Quét ────────────────────────────
  function updateScanButtonUI(scanning) {
    isScanning = scanning;
    if (isScanning) {
      btnToggleScan.classList.add('scanning');
      btnIcon.textContent = '⏹';
      btnLabel.textContent = 'Dừng quét';
      badgeStatus.classList.add('active');
      statusText.textContent = 'Đang quét Newsfeed...';
    } else {
      btnToggleScan.classList.remove('scanning');
      btnIcon.textContent = '▶';
      btnLabel.textContent = 'Bắt đầu quét';
      badgeStatus.classList.remove('active');
      statusText.textContent = 'Sẵn sàng';
    }
  }

  function updateStatsUI(state) {
    statScanned.textContent = (state.totalScanned || 0).toLocaleString();
    statAdsFound.textContent = (state.totalAdsFound || 0).toLocaleString();
    statMatched.textContent = (state.totalMatchedAds || adsList.length || 0).toLocaleString();
    listCount.textContent = adsList.length;
    tabAdsBadge.textContent = adsList.length;
    tabLogsBadge.textContent = logsList.length;
  }

  // ── TAB 1: Render Danh sách Ads Khớp Bộ Lọc ───────────────────────
  function renderAdsList() {
    listCount.textContent = adsList.length;
    tabAdsBadge.textContent = adsList.length;

    if (adsList.length === 0) {
      emptyState.style.display = 'flex';
      Array.from(adsListContainer.children).forEach((child) => {
        if (child !== emptyState) child.remove();
      });
      return;
    }

    emptyState.style.display = 'none';

    const existingCards = Array.from(adsListContainer.querySelectorAll('.ad-card'));
    const existingIds = new Set(existingCards.map(c => c.dataset.adId));

    adsList.forEach((ad) => {
      if (!existingIds.has(String(ad.adId))) {
        const cardEl = createAdCardElement(ad);
        adsListContainer.appendChild(cardEl);
      }
    });
  }

  function createAdCardElement(ad) {
    const card = document.createElement('article');
    card.className = 'ad-card';
    card.dataset.adId = ad.adId;

    const pageInitial = (ad.page.name || 'P').charAt(0).toUpperCase();
    const durationText = ad.post.videoDuration ? `${ad.post.videoDuration}s` : 'VIDEO';

    let displayDomain = ad.cta.domain;
    if (!displayDomain && ad.cta.targetUrl) {
      try {
        const urlObj = new URL(ad.cta.targetUrl);
        displayDomain = urlObj.hostname.replace('www.', '');
      } catch (e) {
        displayDomain = 'WEBSTORE';
      }
    }

    card.innerHTML = `
      <div class="ad-card-top">
        <div class="page-meta">
          <div class="page-avatar">${pageInitial}</div>
          <div class="page-details">
            <a href="${ad.page.url || '#'}" target="_blank" class="page-name">${escapeHTML(ad.page.name)}</a>
            <div class="page-badges">
              <span class="tag-unverified">Chưa tích xanh</span>
              <span class="capture-time">${ad.capturedAt || ''}</span>
            </div>
          </div>
        </div>
        <div class="video-pill">
          <span>🎬</span>
          <span>${durationText}</span>
        </div>
      </div>

      <div class="ad-content" id="content-${ad.adId}">${escapeHTML(ad.post.content || '(Không có văn bản)')}</div>
      ${(ad.post.content && ad.post.content.length > 120) ? `<button class="btn-expand-content" data-target="content-${ad.adId}">Xem thêm...</button>` : ''}

      ${ad.cta.targetUrl ? `
        <div class="webstore-box">
          <div class="store-info">
            <span class="store-domain">${escapeHTML(displayDomain)}</span>
            <span class="store-title">${escapeHTML(ad.cta.headline || ad.cta.buttonText || 'Mua hàng tại store')}</span>
          </div>
          <a href="${escapeHTML(ad.cta.targetUrl)}" target="_blank" class="cta-badge">${escapeHTML(ad.cta.buttonText || 'Shop now')} ↗</a>
        </div>
      ` : ''}

      <div class="ad-metrics">
        <div class="metric-group">
          <div class="metric-item" title="Lượt thích">
            <span>👍</span>
            <span>${(ad.metrics.likes || 0).toLocaleString()}</span>
          </div>
          <div class="metric-item" title="Bình luận (Tỉ lệ: ${ad.metrics.cmtRatio || '0'}x Like)">
            <span>💬</span>
            <span>${(ad.metrics.comments || 0).toLocaleString()}</span>
            <span class="ratio-badge">${ad.metrics.cmtRatio}x</span>
          </div>
          <div class="metric-item" title="Chia sẻ (Tỉ lệ: ${ad.metrics.shareRatio || '0'}x Like)">
            <span>↗️</span>
            <span>${(ad.metrics.shares || 0).toLocaleString()}</span>
            <span class="ratio-badge">${ad.metrics.shareRatio}x</span>
          </div>
        </div>

        <div class="ad-card-actions">
          ${(ad.post.url || ad.page.url) ? `<a href="${escapeHTML(ad.post.url || ad.page.url)}" target="_blank" class="btn-card-action" title="Mở bài post trên Facebook dạng story.php">FB Post</a>` : ''}
          ${(ad.post.url || ad.page.url) ? `<button class="btn-card-action btn-copy-story-link" data-url="${escapeHTML(ad.post.url || ad.page.url)}" title="Copy link bài post chuẩn story.php">Copy Post</button>` : ''}
          <button class="btn-card-action btn-copy-link" data-url="${escapeHTML(ad.cta.targetUrl || ad.post.url || '')}" title="Copy link Webstore ngoài">Store</button>
        </div>
      </div>
    `;

    const expandBtn = card.querySelector('.btn-expand-content');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        const target = card.querySelector(`#${expandBtn.dataset.target}`);
        if (target) {
          target.classList.toggle('expanded');
          expandBtn.textContent = target.classList.contains('expanded') ? 'Thu gọn' : 'Xem thêm...';
        }
      });
    }

    const copyStoryBtn = card.querySelector('.btn-copy-story-link');
    if (copyStoryBtn) {
      copyStoryBtn.addEventListener('click', () => {
        const url = copyStoryBtn.dataset.url;
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            copyStoryBtn.textContent = 'Đã copy Post!';
            setTimeout(() => { copyStoryBtn.textContent = 'Copy Post'; }, 1500);
          });
        }
      });
    }

    const copyBtn = card.querySelector('.btn-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const url = copyBtn.dataset.url;
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            copyBtn.textContent = 'Đã copy Store!';
            setTimeout(() => { copyBtn.textContent = 'Store'; }, 1500);
          });
        }
      });
    }

    return card;
  }

  // Cập nhật số đếm trên các Pill Filter của Tab Nhật Ký Quét
  function updateLogFilterPillCounts() {
    let countAll = logsList.length;
    let countVideo = 0;
    let countPhoto = 0;
    let countVerified = 0;
    let countMatched = 0;
    let countRejected = 0;
    let countWarmup = 0;

    for (let i = 0; i < logsList.length; i++) {
      const log = logsList[i];
      const media = String(log.mediaType || '').toUpperCase();
      // Chỉ Video: bài video ads và KHÔNG có tích xanh
      if (media === 'VIDEO' && log.isVerified !== true) countVideo++;
      if (media === 'PHOTO' || media === 'CAROUSEL') countPhoto++;
      if (log.isVerified === true) countVerified++;
      if (log.isMatched === true) countMatched++;
      if (log.isMatched === false) countRejected++;
      if (log.isWarmup === true) countWarmup++;
    }

    const badgeAll = document.getElementById('pillBadgeAll');
    if (badgeAll) badgeAll.textContent = countAll;
    const badgeVideo = document.getElementById('pillBadgeVideo');
    if (badgeVideo) badgeVideo.textContent = countVideo;
    const badgePhoto = document.getElementById('pillBadgePhoto');
    if (badgePhoto) badgePhoto.textContent = countPhoto;
    const badgeVerified = document.getElementById('pillBadgeVerified');
    if (badgeVerified) badgeVerified.textContent = countVerified;
    const badgeMatched = document.getElementById('pillBadgeMatched');
    if (badgeMatched) badgeMatched.textContent = countMatched;
    const badgeRejected = document.getElementById('pillBadgeRejected');
    if (badgeRejected) badgeRejected.textContent = countRejected;
    const badgeWarmup = document.getElementById('pillBadgeWarmup');
    if (badgeWarmup) {
      chrome.storage.local.get(['consecutiveUnmatchedVideoCount', 'scannerSettings'], res => {
        const current = res?.consecutiveUnmatchedVideoCount || 0;
        const threshold = res?.scannerSettings?.warmupThreshold || 10;
        badgeWarmup.textContent = countWarmup > 0 ? `${countWarmup} (${current}/${threshold})` : (current > 0 ? `${current}/${threshold}` : '0');
        badgeWarmup.title = `Đã warmup: ${countWarmup} bài | Tiến độ hiện tại: ${current}/${threshold} bài video ads không tích xanh trượt`;
      });
    }
  }

  // ── TAB 2: Render Nhật Ký Quét & Audit Log Chi Tiết ────────────────
  function renderLogsList() {
    tabLogsBadge.textContent = logsList.length;
    updateLogFilterPillCounts();

    // Lọc theo filter được chọn
    const filteredLogs = logsList.filter(log => {
      if (currentLogFilter === 'all') return true;
      const media = String(log.mediaType || '').toUpperCase();
      if (currentLogFilter === 'video') return media === 'VIDEO' && log.isVerified !== true;
      if (currentLogFilter === 'photo') return media === 'PHOTO' || media === 'CAROUSEL';
      if (currentLogFilter === 'verified') return log.isVerified === true;
      if (currentLogFilter === 'matched') return log.isMatched === true;
      if (currentLogFilter === 'rejected') return log.isMatched === false;
      if (currentLogFilter === 'warmup') return log.isWarmup === true;
      return true;
    });

    if (filteredLogs.length === 0) {
      emptyLogState.style.display = 'flex';
      Array.from(logsListContainer.children).forEach(child => {
        if (child !== emptyLogState) child.remove();
      });
      return;
    }

    emptyLogState.style.display = 'none';

    // Xóa và vẽ lại danh sách log
    Array.from(logsListContainer.children).forEach(child => {
      if (child !== emptyLogState) child.remove();
    });

    // Render theo thứ tự: Mới nhất luôn ở trên cùng (filteredLogs[0] ở đầu)
    filteredLogs.forEach(log => {
      const logCard = createLogCardElement(log);
      logsListContainer.appendChild(logCard);
    });

    // Nếu không có chuột tác động, tự động cuộn mượt lên đỉnh đón bài mới nhất
    if (isAutoScrollEnabled && !isMouseInsideLogs && !isUserInteractingWithLogs) {
      setTimeout(() => {
        logsListContainer.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }, 60);
    }
  }

  function createLogCardElement(log) {
    const card = document.createElement('div');
    const isWarmup = Boolean(log.isWarmup);
    card.className = `log-card ${log.isMatched ? 'matched' : 'rejected'}${isWarmup ? ' warmup-card' : ''}`;

    const mediaClass = log.mediaType === 'VIDEO' ? 'video' : 'photo';
    let statusText = log.isMatched ? '✓ THỎA MÃN' : '✗ LOẠI BỎ';
    let statusClass = log.isMatched ? 'matched' : 'rejected';
    if (isWarmup) {
      statusText = '🔥 ĐÃ WARMUP';
      statusClass = 'warmup';
    }

    const checklistHTML = (log.auditChecks || []).map(check => `
      <div class="audit-item ${check.pass ? 'pass' : 'fail'}">
        <span class="audit-icon">${check.pass ? '✓' : '✗'}</span>
        <span>${escapeHTML(check.desc)}</span>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="log-card-header">
        <div class="log-page-info">
          <a href="${log.pageUrl || '#'}" target="_blank" class="log-page-title">${escapeHTML(log.pageName)}</a>
          <span class="log-media-tag ${mediaClass}">${log.mediaType}</span>
          ${log.isVerified ? '<span style="font-size:10px; color:#38bdf8;">[Tích xanh]</span>' : ''}
          ${isWarmup ? '<span class="log-badge-warmup" title="Bài đã được hệ thống thực hiện chu kỳ tương tác Warmup (Reaction & xem video 15s)">🔥 Warmup</span>' : ''}
        </div>
        <span class="log-status-pill ${statusClass}">${statusText}</span>
      </div>

      <div class="log-metrics-summary">
        <span>👍 ${(log.likes || 0).toLocaleString()}</span>
        <span>💬 ${(log.comments || 0).toLocaleString()}</span>
        <span>↗️ ${(log.shares || 0).toLocaleString()}</span>
        ${log.buttonText ? `<span style="color:#06b6d4;">[CTA: ${escapeHTML(log.buttonText)}]</span>` : ''}
        ${isWarmup ? `<span style="color:#10b981; font-weight:600;">[✓ Đã xác thực 100% API: ${escapeHTML(log.warmupReaction || 'Reaction')}]</span>` : ''}
      </div>

      <div class="audit-checklist">
        ${checklistHTML}
      </div>

      <div class="log-footer">
        <span>ID: ${escapeHTML(String(log.adId).substring(0, 16))}</span>
        ${log.postUrl ? `<a href="${escapeHTML(log.postUrl)}" target="_blank" style="color:#38bdf8; text-decoration:none; margin: 0 8px; font-weight:500;">[🔗 FB Story Post]</a>` : (log.pageUrl ? `<a href="${escapeHTML(log.pageUrl)}" target="_blank" style="color:#38bdf8; text-decoration:none; margin: 0 8px; font-weight:500;">[🔗 FB Fanpage]</a>` : '')}
        <span>${log.timestamp || ''}</span>
      </div>
    `;

    return card;
  }

  // ── Xử lý Filter Pills trong Tab Log ──────────────────────────────
  logFilterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      logFilterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentLogFilter = pill.dataset.logFilter;
      renderLogsList();
    });
  });

  // Tải Logfile dạng .log text
  if (btnDownloadLogText) {
    btnDownloadLogText.addEventListener('click', () => {
      if (logsList.length === 0) {
        alert('Chưa có bản ghi nhật ký nào để tải về!');
        return;
      }
      exportLogFileText();
    });
  }

  // Tải Logfile dạng JSON
  if (btnDownloadLogJson) {
    btnDownloadLogJson.addEventListener('click', () => {
      if (logsList.length === 0) {
        alert('Chưa có bản ghi nhật ký nào để tải về!');
        return;
      }
      const logsToExport = currentLogFilter === 'all' ? logsList : logsList.filter(log => {
        const media = String(log.mediaType || '').toUpperCase();
        if (currentLogFilter === 'video') return media === 'VIDEO' && log.isVerified !== true;
        if (currentLogFilter === 'photo') return media === 'PHOTO' || media === 'CAROUSEL';
        if (currentLogFilter === 'verified') return log.isVerified === true;
        if (currentLogFilter === 'matched') return log.isMatched === true;
        if (currentLogFilter === 'rejected') return log.isMatched === false;
        if (currentLogFilter === 'warmup') return log.isWarmup === true;
        return true;
      });

      if (logsToExport.length === 0) {
        alert(`Không có bản ghi nào khớp với bộ lọc "${currentLogFilter}" để tải về!`);
        return;
      }

      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logsToExport, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      const filterSuffix = currentLogFilter !== 'all' ? `_${currentLogFilter}` : '';
      downloadAnchor.setAttribute('download', `fb_ads_hunter_logs${filterSuffix}_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  }

  function exportLogFileText() {
    const logsToExport = currentLogFilter === 'all' ? logsList : logsList.filter(log => {
      const media = String(log.mediaType || '').toUpperCase();
      if (currentLogFilter === 'video') return media === 'VIDEO' && log.isVerified !== true;
      if (currentLogFilter === 'photo') return media === 'PHOTO' || media === 'CAROUSEL';
      if (currentLogFilter === 'verified') return log.isVerified === true;
      if (currentLogFilter === 'matched') return log.isMatched === true;
      if (currentLogFilter === 'rejected') return log.isMatched === false;
      if (currentLogFilter === 'warmup') return log.isWarmup === true;
      return true;
    });

    if (logsToExport.length === 0) {
      alert(`Không có bản ghi nào khớp với bộ lọc "${currentLogFilter}" để tải về!`);
      return;
    }

    let logText = `======================================================================\n`;
    logText += `   FB VIDEO ADS HUNTER - AUDIT LOGFILE${currentLogFilter === 'warmup' ? ' [CÁC BÀI ĐÃ WARMUP]' : ''}\n`;
    logText += `   Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n`;
    logText += `   Bộ lọc hiện tại: ${currentLogFilter.toUpperCase()}\n`;
    logText += `   Số bản ghi: ${logsToExport.length} / Tổng: ${logsList.length}\n`;
    logText += `======================================================================\n\n`;

    logsToExport.forEach((log, index) => {
      const statusStr = log.isMatched ? '[✓ THỎA MÃN ĐIỀU KIỆN]' : (log.isWarmup ? '[🔥 ĐÃ THỰC HIỆN WARMUP]' : '[✗ BỊ LOẠI BỎ]');
      logText += `[#${index + 1}] ${log.timestamp || ''} | ${statusStr}\n`;
      if (log.isWarmup) {
        logText += `TRẠNG THÁI WARMUP: ĐÃ TƯƠNG TÁC THÀNH CÔNG (Reaction LOVE/LIKE + Xem video 15s)\n`;
      }
      logText += `Fanpage: ${log.pageName || 'Unknown'} (ID: ${log.adId || 'N/A'})\n`;
      logText += `Page URL: ${log.pageUrl || 'N/A'}\n`;
      logText += `FB Story Post: ${log.postUrl || 'N/A'}\n`;
      logText += `Định dạng: ${log.mediaType} | Tích xanh: ${log.isVerified ? 'CÓ (Thương hiệu lớn)' : 'KHÔNG'}\n`;
      logText += `Tương tác: Likes: ${log.likes || 0} | Comments: ${log.comments || 0} | Shares: ${log.shares || 0}\n`;
      logText += `CTA Button: ${log.buttonText || 'N/A'} | Target URL: ${log.targetUrl || 'None'}\n`;
      logText += `Chi tiết thẩm định (Audit Checklist):\n`;
      (log.auditChecks || []).forEach(check => {
        logText += `  ${check.pass ? '[PASS]' : '[FAIL]'} ${check.desc}\n`;
      });
      logText += `----------------------------------------------------------------------\n\n`;
    });

    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    const filterSuffix = currentLogFilter !== 'all' ? `_${currentLogFilter}` : '';
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadAnchor.setAttribute('download', `fb_ads_hunter_audit${filterSuffix}_${dateStr}.log`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
  }

  // Nút xóa log
  btnClearLogs.addEventListener('click', () => {
    if (confirm('Bạn có muốn xóa toàn bộ nhật ký quét không?')) {
      chrome.runtime.sendMessage({ action: 'CLEAR_LOGS' }, () => {
        logsList = [];
        renderLogsList();
        const badgeWarmup = document.getElementById('pillBadgeWarmup');
        if (badgeWarmup) badgeWarmup.textContent = '0';
      });
    }
  });

  // ── Auto-Scroll Controller cho Tab Nhật Ký Quét ──────────────────
  function updateAutoScrollBadgeUI() {
    if (!autoScrollDot || !autoScrollStatusText || !autoScrollBadge) return;
    autoScrollBadge.setAttribute('aria-checked', String(isAutoScrollEnabled));

    if (!isAutoScrollEnabled) {
      autoScrollBadge.classList.add('manual-mode');
      autoScrollDot.className = 'scroll-status-dot manual';
      autoScrollStatusText.textContent = 'Manual (Lăn tay)';
      autoScrollBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
      autoScrollBadge.title = 'Chế độ Manual: Đang tắt tự cuộn (bạn có thể lăn chuột tự do). Bấm để chuyển sang Auto.';
      return;
    }

    autoScrollBadge.classList.remove('manual-mode');
    autoScrollBadge.title = 'Chế độ Auto: Đang tự cuộn theo log mới (tự dừng khi rê chuột). Bấm để gạt sang Manual.';

    if (isMouseInsideLogs || isUserInteractingWithLogs) {
      autoScrollDot.className = 'scroll-status-dot paused';
      autoScrollStatusText.textContent = isMouseInsideLogs ? 'Tạm dừng (chuột rê)' : 'Tạm dừng (chờ 5s)';
      autoScrollBadge.style.borderColor = 'rgba(245, 158, 11, 0.5)';
    } else {
      autoScrollDot.className = 'scroll-status-dot active';
      autoScrollStatusText.textContent = 'Auto (Tự cuộn)';
      autoScrollBadge.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    }
  }

  function performAutoScrollStep() {
    if (!isAutoScrollEnabled || isMouseInsideLogs || isUserInteractingWithLogs) return;
    if (activeTabName !== 'tab-logs' || !logsListContainer) return;

    // Trượt mượt về dòng trên cùng (bài mới nhất)
    if (logsListContainer.scrollTop > 0) {
      logsListContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function startAutoScrollLoop() {
    stopAutoScrollLoop();
    if (!isAutoScrollEnabled) return;
    updateAutoScrollBadgeUI();
    autoScrollLoopTimer = setInterval(() => {
      performAutoScrollStep();
    }, 1200);
  }

  function stopAutoScrollLoop() {
    if (autoScrollLoopTimer) {
      clearInterval(autoScrollLoopTimer);
      autoScrollLoopTimer = null;
    }
  }

  function onMouseInteractionDetected(reason) {
    if (!isAutoScrollEnabled) return;
    isUserInteractingWithLogs = true;
    updateAutoScrollBadgeUI();
    clearTimeout(idleResumeTimer);

    // Hẹn giờ đếm đúng 5s: nếu không có bất kỳ cử động chuột nào và chuột không hover -> BẬT LẠI TỰ TRƯỢT
    scheduleResumeAfter5s();
  }

  function scheduleResumeAfter5s() {
    if (!isAutoScrollEnabled) return;
    clearTimeout(idleResumeTimer);
    idleResumeTimer = setTimeout(() => {
      // Chỉ tự động trượt lại nếu chuột KHÔNG đang rê trong vùng logs
      if (!isMouseInsideLogs) {
        isUserInteractingWithLogs = false;
        updateAutoScrollBadgeUI();
        startAutoScrollLoop();
        performAutoScrollStep();
      } else {
        // Chuột vẫn đang rê trong vùng log -> tiếp tục tạm dừng và đợi chuột rời đi
        updateAutoScrollBadgeUI();
      }
    }, 5000);
  }

  // Gắn sự kiện theo dõi tác động của chuột trên logsListContainer
  if (logsListContainer) {
    // 1. Phát hiện chuột rê vào (mouseenter) -> DỪNG NGAY
    logsListContainer.addEventListener('mouseenter', () => {
      isMouseInsideLogs = true;
      onMouseInteractionDetected('hover_enter');
    });

    // 2. Chuột di chuyển bên trong (mousemove) -> Tiếp tục tạm dừng và reset bộ đếm 5s
    logsListContainer.addEventListener('mousemove', () => {
      isMouseInsideLogs = true;
      onMouseInteractionDetected('mouse_move');
    });

    // 3. Chuột rời khỏi (mouseleave) -> Bắt đầu đếm ngược 5s để tự trượt lại
    logsListContainer.addEventListener('mouseleave', () => {
      isMouseInsideLogs = false;
      scheduleResumeAfter5s();
    });

    // 4. Lăn chuột (wheel) -> DỪNG NGAY
    logsListContainer.addEventListener('wheel', () => {
      onMouseInteractionDetected('wheel');
    }, { passive: true });

    // 5. Bấm chuột hoặc kéo (mousedown / touchstart) -> DỪNG NGAY
    logsListContainer.addEventListener('mousedown', () => {
      onMouseInteractionDetected('mousedown');
    });
  }

  // Bấm vào badge Tự cuộn để gạt giữa Auto và Manual
  function toggleAutoScrollMode() {
    isAutoScrollEnabled = !isAutoScrollEnabled;
    chrome.storage.local.set({ isAutoScrollEnabled });

    // Đồng bộ cập nhật cấu hình autoScroll vào background và content_script
    chrome.runtime.sendMessage({
      action: 'UPDATE_SETTINGS',
      payload: { autoScroll: isAutoScrollEnabled }
    });

    if (isAutoScrollEnabled) {
      isMouseInsideLogs = false;
      isUserInteractingWithLogs = false;
      clearTimeout(idleResumeTimer);
      updateAutoScrollBadgeUI();
      startAutoScrollLoop();
      performAutoScrollStep();
    } else {
      stopAutoScrollLoop();
      clearTimeout(idleResumeTimer);
      updateAutoScrollBadgeUI();
    }
  }

  if (autoScrollBadge) {
    autoScrollBadge.addEventListener('click', toggleAutoScrollMode);
    autoScrollBadge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleAutoScrollMode();
      }
    });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  // ── Xử lý Sự Kiện Bấm Nút ─────────────────────────────────────────

  // 1. Nút Bắt đầu / Dừng quét
  btnToggleScan.addEventListener('click', () => {
    if (!isScanning) {
      chrome.runtime.sendMessage({ action: 'START_SCANNING' }, (res) => {
        if (res && !res.success) {
          alert(res.error || 'Không thể bắt đầu quét. Hãy đảm bảo bạn đang ở trang Facebook Newsfeed.');
        } else {
          updateScanButtonUI(true);
        }
      });
    } else {
      chrome.runtime.sendMessage({ action: 'STOP_SCANNING' }, () => {
        updateScanButtonUI(false);
      });
    }
  });

  // 2. Mở / Đóng Accordion Cài Đặt
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      settingsToggle.classList.toggle('open');
      settingsBody.classList.toggle('show');
    });
  }

  // 2.1 Mở / Đóng Accordion Mắt Thần AI Vision
  if (aiSettingsToggle && aiSettingsBody) {
    aiSettingsToggle.addEventListener('click', () => {
      aiSettingsToggle.classList.toggle('open');
      aiSettingsBody.classList.toggle('show');
    });
  }

  // 3. Lưu Cài Đặt Chung & Warmup
  btnSaveSettings.addEventListener('click', () => {
    const minLikes = parseInt(inputMinLikes.value, 10) || 500;
    const ratio = selectRatio.value;
    const autoRefreshMinutes = selectAutoRefresh ? parseInt(selectAutoRefresh.value, 10) : 5;
    const warmupEnabled = selectWarmupEnabled ? (selectWarmupEnabled.value === 'true') : true;
    const warmupThreshold = inputWarmupThreshold ? parseInt(inputWarmupThreshold.value, 10) || 10 : 10;
    const warmupWatchSeconds = inputWarmupWatchSeconds ? parseInt(inputWarmupWatchSeconds.value, 10) || 15 : 15;
    const warmupReaction = selectWarmupReactionMode ? selectWarmupReactionMode.value : 'RANDOM';

    const newSettings = {
      minLikes,
      videoEngagementRatio: ratio,
      autoRefreshMinutes,
      warmupEnabled,
      warmupThreshold,
      warmupWatchSeconds,
      warmupReaction,
      warmupExcludedPages,
      warmupExcludedKeywords
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', payload: newSettings }, () => {
      chrome.storage.local.set({ warmupReaction, warmupExcludedPages, warmupExcludedKeywords });
      btnSaveSettings.textContent = '✓ Đã lưu cài đặt';
      setTimeout(() => { btnSaveSettings.textContent = 'Lưu cài đặt'; }, 1500);
    });
  });

  // 3.0 Quản lý Dialog Loại Trừ Warmup
  function openExclusionModal() {
    if (txtWarmupExcludedPages) txtWarmupExcludedPages.value = warmupExcludedPages.join('\n');
    if (txtWarmupExcludedKeywords) txtWarmupExcludedKeywords.value = warmupExcludedKeywords.join('\n');
    updateExclusionBadgeUI();
    if (warmupExclusionModal) warmupExclusionModal.style.display = 'flex';
  }

  function closeExclusionModal() {
    if (warmupExclusionModal) warmupExclusionModal.style.display = 'none';
  }

  if (btnOpenExclusionModal) {
    btnOpenExclusionModal.addEventListener('click', openExclusionModal);
  }

  if (btnCloseExclusionModal) {
    btnCloseExclusionModal.addEventListener('click', closeExclusionModal);
  }

  if (btnCancelExclusionModal) {
    btnCancelExclusionModal.addEventListener('click', closeExclusionModal);
  }

  if (warmupExclusionModal) {
    warmupExclusionModal.addEventListener('click', (e) => {
      if (e.target === warmupExclusionModal) closeExclusionModal();
    });
  }

  if (txtWarmupExcludedPages) {
    txtWarmupExcludedPages.addEventListener('input', () => {
      const count = txtWarmupExcludedPages.value.split('\n').map(s => s.trim()).filter(Boolean).length;
      if (badgeCountExcludedPages) badgeCountExcludedPages.textContent = `${count} Fanpage`;
    });
  }

  if (txtWarmupExcludedKeywords) {
    txtWarmupExcludedKeywords.addEventListener('input', () => {
      const count = txtWarmupExcludedKeywords.value.split('\n').map(s => s.trim()).filter(Boolean).length;
      if (badgeCountExcludedKeywords) badgeCountExcludedKeywords.textContent = `${count} từ khóa`;
    });
  }

  if (btnSaveExclusionModal) {
    btnSaveExclusionModal.addEventListener('click', () => {
      warmupExcludedPages = (txtWarmupExcludedPages?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      warmupExcludedKeywords = (txtWarmupExcludedKeywords?.value || '').split('\n').map(s => s.trim()).filter(Boolean);

      updateExclusionBadgeUI();
      chrome.storage.local.set({ warmupExcludedPages, warmupExcludedKeywords });

      chrome.runtime.sendMessage({
        action: 'UPDATE_SETTINGS',
        payload: {
          warmupExcludedPages,
          warmupExcludedKeywords
        }
      }, () => {
        btnSaveExclusionModal.textContent = '✓ Đã lưu danh sách!';
        setTimeout(() => {
          btnSaveExclusionModal.textContent = '✓ Lưu Danh Sách Loại Trừ';
          closeExclusionModal();
        }, 500);
      });
    });
  }

  // 3.1 Lưu Cấu hình Keys AI Vision & Solver
  if (btnSaveAIKeys) {
    btnSaveAIKeys.addEventListener('click', () => {
      const rawPool = (txtGeminiPool?.value || '').trim();
      const geminiKeys = rawPool.split('\n').map(k => k.trim()).filter(k => k.length > 0);
      const deepseekKey = (txtDeepseekKey?.value || '').trim();
      const twoCaptchaKey = (txtTwoCaptchaKey?.value || '').trim();

      const aiSettings = {
        geminiKeys,
        deepseekKey,
        twoCaptchaKey
      };

      chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', payload: aiSettings }, () => {
        chrome.storage.local.set(aiSettings, () => {
          btnSaveAIKeys.textContent = '✓ Đã lưu Keys AI';
          setTimeout(() => { btnSaveAIKeys.textContent = 'Lưu cấu hình AI & Warmup'; }, 1500);
        });
      });
    });
  }

  // 3.2 Kích Hoạt Demo 7 Bước Super-Buyer Webstore
  const btnRunDemoStoreFlow = document.getElementById('btnRunDemoStoreFlow');
  const txtDemoStoreUrl = document.getElementById('txtDemoStoreUrl');
  const demoFlowStatus = document.getElementById('demoFlowStatus');

  if (btnRunDemoStoreFlow) {
    btnRunDemoStoreFlow.addEventListener('click', () => {
      const url = (txtDemoStoreUrl?.value || '').trim();
      if (!url || !url.startsWith('http')) {
        alert('Vui lòng nhập URL webstore hợp lệ (bắt đầu bằng http:// hoặc https://)');
        return;
      }

      btnRunDemoStoreFlow.disabled = true;
      btnRunDemoStoreFlow.textContent = '⏳ Đang khởi chạy 7 bước Pixel...';
      if (demoFlowStatus) demoFlowStatus.textContent = 'Đang mở tab webstore và tiêm kịch bản Super-Buyer...';

      chrome.runtime.sendMessage({
        action: 'RUN_STORE_FLOW',
        payload: {
          targetUrl: url,
          adId: `DEMO_${Date.now()}`
        }
      }, (res) => {
        if (res && res.success) {
          if (demoFlowStatus) demoFlowStatus.textContent = 'Đã mở tab store thành công! Đang tự động tương tác...';
        } else {
          btnRunDemoStoreFlow.disabled = false;
          btnRunDemoStoreFlow.textContent = '⚡ Kích Hoạt 7 Bước Super-Buyer Ngay';
          if (demoFlowStatus) demoFlowStatus.textContent = 'Lỗi khởi chạy: ' + (res?.error || 'Không rõ');
        }
      });
    });
  }

  // 3.3 Kích Hoạt Test Warmup Tương Tác (Thả Tim / Like & Xem Video)
  const btnRunTestWarmup = document.getElementById('btnRunTestWarmup');
  const txtTestWarmupUrl = document.getElementById('txtTestWarmupUrl');
  const selectWarmupPreset = document.getElementById('selectWarmupPreset');
  const selectWarmupReaction = document.getElementById('selectWarmupReaction');
  const inputTestWarmupSeconds = document.getElementById('inputTestWarmupSeconds');
  const testWarmupStatus = document.getElementById('testWarmupStatus');

  if (selectWarmupPreset && txtTestWarmupUrl) {
    selectWarmupPreset.addEventListener('change', () => {
      txtTestWarmupUrl.value = selectWarmupPreset.value;
    });
  }

  if (btnRunTestWarmup) {
    btnRunTestWarmup.addEventListener('click', () => {
      const url = (txtTestWarmupUrl?.value || '').trim();
      if (!url || !url.startsWith('http')) {
        alert('Vui lòng nhập link bài viết Facebook hợp lệ (bắt đầu bằng https://)');
        return;
      }

      const rType = selectWarmupReaction?.value || 'RANDOM';
      const rLabel = rType === 'NONE' ? '👁️ Chỉ xem video (Không thả Reaction)' :
                     rType === 'RANDOM' ? '🎲 Random Cảm xúc' :
                     rType === 'LOVE' ? '❤️ Yêu thích (Love)' : 
                     rType === 'CARE' ? '🥰 Thương thương (Care)' :
                     rType === 'HAHA' ? '😂 Haha' :
                     rType === 'WOW' ? '😮 Wow' : '👍 Thích (Like)';
      const sec = parseInt(inputTestWarmupSeconds?.value, 10) || 15;

      btnRunTestWarmup.disabled = true;
      btnRunTestWarmup.innerHTML = rType === 'NONE'
        ? `<span>⏳ Đang xem Video Warmup (${sec}s)...</span>`
        : `<span>⏳ Đang khởi chạy Warmup (${rType})...</span>`;
      if (testWarmupStatus) {
        testWarmupStatus.textContent = rType === 'NONE'
          ? `Đang mở tab bài viết và xem video trong ${sec}s (Không thả Reaction)...`
          : `Đang mở tab bài viết, thả ${rLabel} và xem video trong ${sec}s...`;
      }

      chrome.runtime.sendMessage({
        action: 'RUN_WARMUP_FLOW',
        payload: {
          postUrl: url,
          reactionType: rType,
          watchSeconds: sec,
          isManualTest: true
        }
      }, (res) => {
        if (res && res.success) {
          if (testWarmupStatus) {
            testWarmupStatus.textContent = rType === 'NONE'
              ? `✓ Đã kích hoạt Warmup chỉ xem video thành công! Theo dõi tab vừa mở...`
              : `✓ Đã kích hoạt Warmup ${rLabel} thành công! Theo dõi tab vừa mở...`;
          }
        } else {
          btnRunTestWarmup.disabled = false;
          btnRunTestWarmup.innerHTML = `<span>🔥 Kích Hoạt Test Warmup Thả Tim Ngay</span>`;
          if (testWarmupStatus) testWarmupStatus.textContent = 'Lỗi khởi chạy: ' + (res?.error || 'Không rõ');
        }
        setTimeout(() => {
          btnRunTestWarmup.disabled = false;
          btnRunTestWarmup.innerHTML = `<span>🔥 Kích Hoạt Test Warmup Thả Tim Ngay</span>`;
        }, 3000);
      });
    });
  }

  // 4. Xóa danh sách Ads
  btnClearList.addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa sạch toàn bộ danh sách Ads đã lọc không?')) {
      adsList = [];
      chrome.storage.local.set({ matchedAdsList: [] }, () => {
        Array.from(adsListContainer.children).forEach(child => {
          if (child !== emptyState) child.remove();
        });
        emptyState.style.display = 'flex';
        listCount.textContent = '0';
        tabAdsBadge.textContent = '0';
        statMatched.textContent = '0';
      });
    }
  });

  // 5. Xuất JSON
  btnExportJSON.addEventListener('click', () => {
    if (adsList.length === 0) return alert('Danh sách hiện tại đang trống.');
    const blob = new Blob([JSON.stringify(adsList, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb_video_ads_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 6. Xuất CSV
  btnExportCSV.addEventListener('click', () => {
    if (adsList.length === 0) return alert('Danh sách hiện tại đang trống.');

    const headers = ['Ad ID', 'Fanpage', 'Page URL', 'FB Story Post URL', 'Likes', 'Comments', 'Shares', 'Cmt Ratio', 'Share Ratio', 'Webstore URL', 'CTA Button', 'Post Content', 'Captured At'];
    const rows = adsList.map(ad => [
      `"${ad.adId || ''}"`,
      `"${(ad.page.name || '').replace(/"/g, '""')}"`,
      `"${ad.page.url || ''}"`,
      `"${ad.post?.url || ''}"`,
      ad.metrics.likes || 0,
      ad.metrics.comments || 0,
      ad.metrics.shares || 0,
      ad.metrics.cmtRatio || 0,
      ad.metrics.shareRatio || 0,
      `"${ad.cta.targetUrl || ''}"`,
      `"${ad.cta.buttonText || ''}"`,
      `"${(ad.post.content || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${ad.capturedAt || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb_video_ads_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Lắng nghe Realtime Event từ Background ────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'ON_AD_MATCHED') {
      const newAd = message.payload;
      if (!adsList.some(a => a.adId === newAd.adId)) {
        adsList.unshift(newAd);
        emptyState.style.display = 'none';
        const cardEl = createAdCardElement(newAd);
        adsListContainer.insertBefore(cardEl, adsListContainer.firstChild);
        listCount.textContent = adsList.length;
        tabAdsBadge.textContent = adsList.length;
        statMatched.textContent = adsList.length;
      }
    } else if (message.action === 'ON_STATS_UPDATE') {
      updateStatsUI(message.payload);
    } else if (message.action === 'ON_NEW_LOG_ENTRY') {
      const log = message.payload;
      logsList.unshift(log);
      if (logsList.length > 300) logsList.pop();
      tabLogsBadge.textContent = logsList.length;
      updateLogFilterPillCounts();

      // Nếu đang ở tab Logs, chèn ngay card log vào đầu danh sách (dòng trên cùng là mới nhất)
      const media = String(log.mediaType || '').toUpperCase();
      const matchesFilter = (
        currentLogFilter === 'all' ||
        (currentLogFilter === 'video' && media === 'VIDEO' && log.isVerified !== true) ||
        (currentLogFilter === 'photo' && (media === 'PHOTO' || media === 'CAROUSEL')) ||
        (currentLogFilter === 'verified' && log.isVerified === true) ||
        (currentLogFilter === 'matched' && log.isMatched === true) ||
        (currentLogFilter === 'rejected' && log.isMatched === false) ||
        (currentLogFilter === 'warmup' && log.isWarmup === true)
      );

      if (matchesFilter) {
        emptyLogState.style.display = 'none';
        const logCard = createLogCardElement(log);
        logsListContainer.insertBefore(logCard, logsListContainer.firstChild);

        // Tự động cuộn mượt lên trên cùng đón bài log mới nhất nếu không có chuột tác động
        if (isAutoScrollEnabled && !isMouseInsideLogs && !isUserInteractingWithLogs && activeTabName === 'tab-logs') {
          logsListContainer.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }
      }
    } else if (message.action === 'ON_WARMUP_COMPLETED') {
      const { postId, postUrl, reactionType, verified } = message.payload || {};
      const target = logsList.find(l => (postId && String(l.adId) === String(postId)) || (postUrl && l.postUrl === postUrl));
      if (target) {
        target.isWarmup = true;
        target.warmupReaction = reactionType;
        target.warmupVerified = verified !== false;
        renderLogsList();
      }
      const testWarmupStatus = document.getElementById('testWarmupStatus');
      if (testWarmupStatus) {
        const rName = reactionType || 'Reaction';
        testWarmupStatus.innerHTML = `<span style="color:#10b981; font-weight:600;">✓ Backend Facebook đã xác nhận 100% tương tác (${rName})!</span>`;
      }
    } else if (message.action === 'ON_WARMUP_PROGRESS') {
      const { current, threshold } = message.payload || {};
      const badgeWarmup = document.getElementById('pillBadgeWarmup');
      if (badgeWarmup) {
        const countWarmup = logsList.filter(l => l.isWarmup === true).length;
        badgeWarmup.textContent = countWarmup > 0 ? `${countWarmup} (${current}/${threshold})` : (current > 0 ? `${current}/${threshold}` : '0');
        badgeWarmup.title = `Đã warmup: ${countWarmup} bài | Tiến độ hiện tại: ${current}/${threshold} bài video ads không tích xanh trượt`;
      }
    } else if (message.action === 'ON_STORE_STEP_UPDATE') {
      const { step, totalSteps, name, detail } = message.payload || {};
      if (statusText) {
        statusText.textContent = `[Bước ${step}/${totalSteps}] ${name}: ${detail || ''}`;
      }
      if (demoFlowStatus) {
        demoFlowStatus.textContent = `[Bước ${step}/${totalSteps}] ${name}: ${detail || ''}`;
      }
    } else if (message.action === 'ON_STORE_FLOW_FINISHED') {
      if (statusText) {
        statusText.textContent = 'Hoàn tất quy trình Super-Buyer Pixel!';
        setTimeout(() => {
          statusText.textContent = isScanning ? 'Đang tự động quét & lọc Newsfeed...' : 'Hệ thống sẵn sàng';
        }, 3000);
      }
      if (demoFlowStatus) {
        demoFlowStatus.textContent = '✓ Hoàn thành trọn vẹn 7 bước nuôi Pixel!';
      }
      if (btnRunDemoStoreFlow) {
        btnRunDemoStoreFlow.disabled = false;
        btnRunDemoStoreFlow.textContent = '⚡ Kích Hoạt 7 Bước Super-Buyer Ngay';
      }
    }
  });

  // ── 3.4 INOTE SMART DISPATCHER (TỰ ĐỘNG PHÂN LUỒNG DANH SÁCH LINKS) ──
  const txtInoteUrl = document.getElementById('txtInoteUrl');
  const btnFetchInote = document.getElementById('btnFetchInote');
  const fileInoteUpload = document.getElementById('fileInoteUpload');
  const btnUploadTxtFile = document.getElementById('btnUploadTxtFile');
  const txtInoteLinkList = document.getElementById('txtInoteLinkList');
  const btnClearInoteList = document.getElementById('btnClearInoteList');
  const badgeTotalLinks = document.getElementById('badgeTotalLinks');
  const badgeFbLinks = document.getElementById('badgeFbLinks');
  const badgeStoreLinks = document.getElementById('badgeStoreLinks');
  const selectInoteReaction = document.getElementById('selectInoteReaction');
  const inputInoteWatchSeconds = document.getElementById('inputInoteWatchSeconds');
  const chkAutoClickCta = document.getElementById('chkAutoClickCta');
  const btnRunInoteQueue = document.getElementById('btnRunInoteQueue');
  const btnStopInoteQueue = document.getElementById('btnStopInoteQueue');
  const inoteQueueStatusText = document.getElementById('inoteQueueStatusText');
  const inoteCurrentTaskDetail = document.getElementById('inoteCurrentTaskDetail');

  function classifyLink(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    let url = rawUrl.trim();
    if (!url) return null;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('facebook.com') || url.includes('l.facebook.com') || url.includes('.')) {
        url = 'https://' + url;
      } else {
        return null;
      }
    }

    // 1. Phân luồng A: Bài viết Facebook (FB Story / Post / Reel / Video)
    const isFbPost = /facebook\.com\/(?:story\.php|[^\/]+\/posts\/|reel\/|watch\/?\?v=|share\/p\/|share\/r\/)|fb\.watch\//i.test(url);

    // 2. Phân luồng B: Link Mua Hàng Trực Tiếp (Direct Webstore hoặc l.facebook.com)
    const isFbShim = /l\.facebook\.com\/l\.php/i.test(url);

    if (isFbPost) {
      return {
        type: 'FB_POST',
        url: url,
        label: 'Bài viết Facebook (Warmup + Click CTA)'
      };
    } else if (isFbShim) {
      let target = url;
      try {
        const parsed = new URL(url);
        const u = parsed.searchParams.get('u');
        if (u) target = decodeURIComponent(u);
      } catch (e) {}
      return {
        type: 'WEBSTORE_DIRECT',
        url: target,
        originalUrl: url,
        label: 'Link Mua Hàng (l.facebook.com)'
      };
    } else {
      return {
        type: 'WEBSTORE_DIRECT',
        url: url,
        originalUrl: url,
        label: 'Link Mua Hàng Trực Tiếp (7 Bước Super-Buyer)'
      };
    }
  }

  function getInoteLinksFromTextarea() {
    if (!txtInoteLinkList) return [];
    const lines = txtInoteLinkList.value.split('\n');
    const items = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const classified = classifyLink(trimmed);
      if (classified) items.push(classified);
    });
    return items;
  }

  function updateInoteBadges() {
    const items = getInoteLinksFromTextarea();
    const fbCount = items.filter(i => i.type === 'FB_POST').length;
    const storeCount = items.filter(i => i.type === 'WEBSTORE_DIRECT').length;

    if (badgeTotalLinks) badgeTotalLinks.textContent = `📊 Tổng: ${items.length} link`;
    if (badgeFbLinks) badgeFbLinks.textContent = `🔵 FB Post (Warmup + Click CTA): ${fbCount}`;
    if (badgeStoreLinks) badgeStoreLinks.textContent = `🟢 Mua Hàng Trực Tiếp (7 Bước): ${storeCount}`;
  }

  if (txtInoteLinkList) {
    txtInoteLinkList.addEventListener('input', updateInoteBadges);
    updateInoteBadges();
  }

  if (btnClearInoteList && txtInoteLinkList) {
    btnClearInoteList.addEventListener('click', () => {
      txtInoteLinkList.value = '';
      updateInoteBadges();
      if (inoteQueueStatusText) inoteQueueStatusText.textContent = 'Đã xóa trắng danh sách links.';
      if (inoteCurrentTaskDetail) inoteCurrentTaskDetail.style.display = 'none';
    });
  }

  // Tải danh sách links từ file .txt trên máy tính
  if (btnUploadTxtFile && fileInoteUpload && txtInoteLinkList) {
    btnUploadTxtFile.addEventListener('click', () => {
      fileInoteUpload.click();
    });

    fileInoteUpload.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result || '';
        txtInoteLinkList.value = text.trim();
        updateInoteBadges();
        if (inoteQueueStatusText) {
          inoteQueueStatusText.textContent = `✓ Đã nạp danh sách từ file "${file.name}"`;
        }
      };
      reader.readAsText(file);
      fileInoteUpload.value = '';
    });
  }

  // Tải danh sách links từ https://inote.net/
  if (btnFetchInote && txtInoteUrl && txtInoteLinkList) {
    btnFetchInote.addEventListener('click', async () => {
      const rawInoteUrl = (txtInoteUrl.value || '').trim();
      if (!rawInoteUrl) {
        alert('Vui lòng nhập đường dẫn trang Inote (VD: https://inote.net/abcxyz)');
        return;
      }

      btnFetchInote.disabled = true;
      btnFetchInote.textContent = '⏳ Đang tải...';
      if (inoteQueueStatusText) inoteQueueStatusText.textContent = 'Đang kết nối tới inote.net để bóc tách danh sách links...';

      try {
        let cleanUrl = rawInoteUrl;
        if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

        const res = await fetch(cleanUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: Máy chủ Inote phản hồi lỗi.`);
        const html = await res.text();

        // Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Bóc tách content từ textarea hoặc element note
        const textareaEl = doc.querySelector('textarea#content, textarea.content, #note-content, textarea');
        let noteContent = textareaEl ? (textareaEl.value || textareaEl.textContent) : '';

        if (!noteContent) {
          const noteEl = doc.querySelector('.note-content, #note_content, .note-body, pre');
          if (noteEl) noteContent = noteEl.innerText || noteEl.textContent;
        }

        if (!noteContent) {
          noteContent = html;
        }

        // Regex quét tất cả các URL
        const urlRegex = /(?:https?:\/\/|l\.facebook\.com\/)[^\s"'<>\n\r]+/gi;
        const matches = (noteContent.match(urlRegex) || []).map(u => u.trim().replace(/[.,;)]+$/, '')).filter(u => u.length > 8);
        const uniqueLinks = Array.from(new Set(matches));

        if (uniqueLinks.length === 0) {
          alert('Không tìm thấy link nào trong trang Inote này. Bạn có thể mở inote và copy nội dung dán thẳng vào ô bên dưới!');
          if (inoteQueueStatusText) inoteQueueStatusText.textContent = 'Không tìm thấy URL hợp lệ trong note.';
        } else {
          txtInoteLinkList.value = uniqueLinks.join('\n');
          updateInoteBadges();
          if (inoteQueueStatusText) {
            inoteQueueStatusText.innerHTML = `<span style="color:#34d399; font-weight:600;">✓ Đã tải thành công ${uniqueLinks.length} links từ Inote!</span>`;
          }
        }
      } catch (err) {
        console.error('[Inote Fetch] Lỗi:', err);
        alert('Không thể tự động tải từ link Inote này (do cấu hình mạng hoặc trang yêu cầu đăng nhập).\n\nBạn có thể mở Inote trên trình duyệt, copy toàn bộ link và dán trực tiếp vào khung "Danh sách links" bên dưới!');
        if (inoteQueueStatusText) inoteQueueStatusText.textContent = 'Lỗi tải inote: ' + err.message;
      } finally {
        btnFetchInote.disabled = false;
        btnFetchInote.textContent = '📥 Tải Link';
      }
    });
  }

  // ── BỘ ĐIỀU PHỐI HÀNG ĐỢI TUẦN TỰ (INOTE QUEUE RUNNER) ──────────────
  let inoteQueueState = {
    isRunning: false,
    items: [],
    currentIndex: 0
  };

  function stopInoteQueue() {
    inoteQueueState.isRunning = false;
    if (btnRunInoteQueue) {
      btnRunInoteQueue.disabled = false;
      btnRunInoteQueue.style.display = 'flex';
      btnRunInoteQueue.innerHTML = '<span>🚀 Bắt Đầu Tự Động Phân Luồng</span>';
    }
    if (btnStopInoteQueue) {
      btnStopInoteQueue.style.display = 'none';
    }
    if (inoteQueueStatusText) {
      inoteQueueStatusText.innerHTML = '<span style="color:#ef4444; font-weight:600;">⏹️ Đã dừng tiến trình phân luồng.</span>';
    }
    if (inoteCurrentTaskDetail) {
      inoteCurrentTaskDetail.style.display = 'none';
    }
  }

  function processNextInoteQueueItem() {
    if (!inoteQueueState.isRunning) return;

    if (inoteQueueState.currentIndex >= inoteQueueState.items.length) {
      // Đã hoàn tất toàn bộ danh sách!
      inoteQueueState.isRunning = false;
      if (btnRunInoteQueue) {
        btnRunInoteQueue.disabled = false;
        btnRunInoteQueue.style.display = 'flex';
        btnRunInoteQueue.innerHTML = '<span>🚀 Bắt Đầu Tự Động Phân Luồng</span>';
      }
      if (btnStopInoteQueue) {
        btnStopInoteQueue.style.display = 'none';
      }
      if (inoteQueueStatusText) {
        inoteQueueStatusText.innerHTML = `<span style="color:#34d399; font-weight:700;">🎉 ĐÃ HOÀN TẤT TOÀN BỘ DANH SÁCH (${inoteQueueState.items.length} LINKS)!</span>`;
      }
      if (inoteCurrentTaskDetail) {
        inoteCurrentTaskDetail.innerHTML = '<span style="color:#10b981;">Tất cả bài viết Facebook và link Webstore đã được tương tác & nuôi Pixel thành công.</span>';
      }
      return;
    }

    const item = inoteQueueState.items[inoteQueueState.currentIndex];
    const total = inoteQueueState.items.length;
    const idxDisplay = inoteQueueState.currentIndex + 1;

    const rType = selectInoteReaction ? selectInoteReaction.value : 'RANDOM';
    const watchSec = inputInoteWatchSeconds ? (parseInt(inputInoteWatchSeconds.value, 10) || 15) : 15;
    const shouldClickCta = chkAutoClickCta ? chkAutoClickCta.checked : true;

    if (inoteQueueStatusText) {
      inoteQueueStatusText.innerHTML = `<b>[Link ${idxDisplay}/${total}]</b> Đang xử lý: <span style="color:#a78bfa; font-weight:600;">${escapeHTML(item.label)}</span>`;
    }

    if (item.type === 'FB_POST') {
      if (inoteCurrentTaskDetail) {
        inoteCurrentTaskDetail.style.display = 'block';
        inoteCurrentTaskDetail.innerHTML = `Đang mở bài viết FB -> Xem video (${watchSec}s) & Thả ${rType}...${shouldClickCta ? ' (Tự động click link CTA nối tiếp 7 bước)' : ''}`;
      }

      chrome.runtime.sendMessage({
        action: 'RUN_WARMUP_FLOW',
        payload: {
          postUrl: item.url,
          reactionType: rType,
          watchSeconds: watchSec,
          autoClickCta: shouldClickCta,
          isManualTest: true
        }
      }, (res) => {
        if (!res?.success) {
          console.warn('[Inote Queue] Lỗi khởi chạy Warmup:', res?.error);
        }
      });
    } else if (item.type === 'WEBSTORE_DIRECT') {
      if (inoteCurrentTaskDetail) {
        inoteCurrentTaskDetail.style.display = 'block';
        inoteCurrentTaskDetail.innerHTML = `Đang mở trang Store trực tiếp -> Thực thi 7 bước Super-Buyer Pixel...<br><span style="color:#94a3b8; font-size:10px;">${escapeHTML(item.url.substring(0, 75))}...</span>`;
      }

      chrome.runtime.sendMessage({
        action: 'RUN_STORE_FLOW',
        payload: {
          targetUrl: item.url,
          adId: `INOTE_${Date.now()}`
        }
      }, (res) => {
        if (!res?.success) {
          console.warn('[Inote Queue] Lỗi khởi chạy Webstore:', res?.error);
        }
      });
    }
  }

  if (btnRunInoteQueue) {
    btnRunInoteQueue.addEventListener('click', () => {
      const items = getInoteLinksFromTextarea();
      if (items.length === 0) {
        alert('Danh sách links đang trống! Vui lòng nhập link Inote hoặc dán danh sách link vào ô textarea trước khi bắt đầu.');
        return;
      }

      inoteQueueState = {
        isRunning: true,
        items: items,
        currentIndex: 0
      };

      btnRunInoteQueue.style.display = 'none';
      if (btnStopInoteQueue) btnStopInoteQueue.style.display = 'block';

      processNextInoteQueueItem();
    });
  }

  if (btnStopInoteQueue) {
    btnStopInoteQueue.addEventListener('click', stopInoteQueue);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'INOTE_TASK_STEP_UPDATED') {
      const { step, targetUrl } = message.payload || {};
      if (inoteCurrentTaskDetail) {
        inoteCurrentTaskDetail.style.display = 'block';
        if (step === 'WARMUP_CTA_TRANSITION') {
          inoteCurrentTaskDetail.innerHTML = `<span style="color:#34d399; font-weight:600;">⚡ Đã tìm thấy link CTA mua hàng!</span> Đang chuyển tiếp sang 7 bước Super-Buyer...<br><span style="color:#94a3b8; font-size:10px;">${escapeHTML(String(targetUrl || '').substring(0, 75))}...</span>`;
        }
      }
    } else if (message.action === 'INOTE_ITEM_FINISHED') {
      if (inoteQueueState.isRunning) {
        if (inoteCurrentTaskDetail) {
          inoteCurrentTaskDetail.innerHTML = `<span style="color:#10b981; font-weight:600;">✓ Hoàn tất mục ${inoteQueueState.currentIndex + 1}/${inoteQueueState.items.length}!</span> Đang chuyển sang link tiếp theo sau 2 giây...`;
        }
        inoteQueueState.currentIndex++;
        setTimeout(() => {
          processNextInoteQueueItem();
        }, 2000);
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // ── FIND ADS CONTROLLER (Milestone 1: UI & Form Layout) ───────────
  // ══════════════════════════════════════════════════════════════════

  function initFindAdsTab() {
    // 1. Dual ID Resolution Helper
    function getEl(primaryId, aliasId) {
      return document.getElementById(primaryId) || (aliasId ? document.getElementById(aliasId) : null);
    }

    // Elements
    const viewFindAds = document.getElementById('view-find-ads');
    const badgeStatus = getEl('find-ads-badge-status', 'findAdsBadgeStatus');
    const statusText = getEl('find-ads-status-text', 'findAdsStatusText');
    const btnStart = getEl('btn-start-find-ads', 'btnStartFindAds');
    const btnStop = getEl('btn-stop-find-ads', 'btnStopFindAds');

    // Search controls
    const inputKeyword = getEl('find-ads-keyword', 'findAdsKeyword');
    const chkExactPhrase = getEl('find-ads-exact-phrase', 'chkExactPhrase');
    const chkPageHunter = getEl('chk-page-hunter-mode', 'chkPageHunterMode');
    const badgeSearchType = getEl('find-ads-search-type-badge', 'findAdsSearchTypeBadge');
    const btnClearKeyword = getEl('btn-find-ads-clear-keyword', 'btnFindAdsClearKeyword');
    const selectCountry = getEl('find-ads-country', 'findAdsCountry');
    const selectCategory = getEl('find-ads-category', 'findAdsCategory');

    // Filter controls
    const filterToggle = getEl('find-ads-filter-toggle', 'findAdsFilterToggle');
    const filterBody = getEl('find-ads-filter-body', 'findAdsFilterBody');
    const filterArrow = getEl('find-ads-filter-arrow', 'findAdsFilterArrow');
    const filterCountBadge = getEl('find-ads-filter-count-badge', 'badgeFilterCount');

    // Platforms
    const chkFb = getEl('chk-platform-fb', 'chkPlatformFb');
    const chkIg = getEl('chk-platform-ig', 'chkPlatformIg');
    const chkAn = getEl('chk-platform-an', 'chkPlatformAn');
    const chkMsg = getEl('chk-platform-msg', 'chkPlatformMsg');
    const chkWa = getEl('chk-platform-wa', 'chkPlatformWa');
    const chkThreads = getEl('chk-platform-threads', 'chkPlatformThreads');

    // Other filter fields
    const selectMediaType = getEl('find-ads-media-type', 'findAdsMediaType');
    const selectActiveStatus = getEl('find-ads-active-status', 'findAdsActiveStatus');
    const selectStartDate = getEl('find-ads-start-date', 'findAdsStartDate');
    const inputCustomDate = document.getElementById('find-ads-custom-date');
    const customDateWrapper = document.getElementById('find-ads-custom-date-wrapper');
    const btnClearStartDate = document.getElementById('btn-clear-start-date');
    const selectLanguage = getEl('find-ads-language', 'findAdsLanguage');
    const selectSortBy = getEl('find-ads-sort-by', 'findAdsSortBy');

    // Minea Active vs Total Counter Elements
    const mineaCounterPanel = document.getElementById('find-ads-minea-counter');
    const btnCheckActiveTotal = document.getElementById('btn-check-active-total');
    const mineaActiveCountEl = document.getElementById('minea-active-count');
    const mineaActiveRawEl = document.getElementById('minea-active-raw');
    const mineaTotalCountEl = document.getElementById('minea-total-count');
    const mineaTotalRawEl = document.getElementById('minea-total-raw');
    const mineaRatioPercentEl = document.getElementById('minea-ratio-percent');
    const mineaRatioStatusEl = document.getElementById('minea-ratio-status');
    const mineaRatioBarFillEl = document.getElementById('minea-ratio-bar-fill');

    // Metrics & Progress
    const statLabelTotal = document.getElementById('find-ads-stat-label-total');
    const statLabelParsed = document.getElementById('find-ads-stat-label-parsed');
    const totalCountEl = getEl('find-ads-total-count', 'findAdsTotalCount');
    const parsedCountEl = getEl('find-ads-parsed-count', 'findAdsParsedCount');
    const batchProgressEl = getEl('find-ads-batch-progress', 'findAdsBatchProgress');
    const progressBar = getEl('find-ads-progress-bar', 'findAdsProgressBar');

    // Actions & Inote
    const btnSaveInote = getEl('btn-save-inote', 'btnSaveFindAdsToInote');
    const badgeInoteReadyCount = getEl('badge-inote-ready-count', 'badgeInoteReadyCount');
    const btnCopyAll = getEl('btn-copy-all-find-ads', 'btnCopyAllFindAdsText');
    const btnExportJson = getEl('btn-export-find-ads-json', 'btnExportFindAdsJson');
    const btnExportCsv = getEl('btn-export-find-ads-csv', 'btnExportFindAdsCsv');
    const btnClearResults = getEl('btn-clear-find-ads-results', 'btnClearFindAdsResults');

    const inoteBanner = getEl('inote-result-banner', 'inoteSuccessAlert');
    const inoteLink = getEl('inote-created-url-link', 'inoteCreatedUrlLink');
    const btnCopyInoteQuick = getEl('btn-copy-inote-link-quick', 'btnCopyInoteLinkQuick');

    // Results container & Pagination / View Mode controls
    const resultsContainer = getEl('find-ads-results-list', 'findAdsListContainer');
    const emptyState = getEl('find-ads-empty-state', 'findAdsEmptyState');
    const selectViewMode = document.getElementById('find-ads-view-mode');
    const btnPrevPage = document.getElementById('btn-find-ads-prev-page');
    const btnNextPage = document.getElementById('btn-find-ads-next-page');
    const pageInfoEl = document.getElementById('find-ads-page-info');
    const paginationControlsEl = document.getElementById('find-ads-pagination-controls');

    // State
    const findAdsState = {
      isSearching: false,
      ads: [],
      seenArchiveIds: new Set(),
      totalFound: 0,
      extractedCount: 0,
      currentBatch: 0,
      totalBatches: 0,
      lastNoteUrl: '',
      lastNoteId: '',
      viewMode: 'card', // 'card' (20/page) | 'compact' (50/page) | 'data_only' (0 DOM cards)
      currentPage: 1,
      renderedCountOnPage: 0
    };

    // Helper: Escape HTML
    function safeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    if (typeof window.escapeHTML !== 'function') {
      window.escapeHTML = safeHtml;
    }

    // Helper: Copy to Clipboard
    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) {
        console.warn('Clipboard API failed, using textarea fallback:', e);
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }

    function calculatePastDate(months) {
      const num = parseInt(months, 10);
      if (isNaN(num) || num <= 0) return null;
      const d = new Date();
      const targetDay = d.getDate();
      d.setMonth(d.getMonth() - num);
      if (d.getDate() !== targetDay) d.setDate(0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    // ── Minea Active vs Total Helpers & UI Updater ───────────────────
    function smartRound(num) {
      const n = Number(num) || 0;
      if (n < 100) return n;
      if (n >= 10000) return Math.round(n / 1000) * 1000;
      if (n >= 1000) return Math.round(n / 100) * 100;
      if (n >= 100) return Math.round(n / 10) * 10;
      return n;
    }

    function formatNumberWithoutDecimals(num) {
      const n = Number(num) || 0;
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(n);
    }

    function formatNumberCompact(num) {
      const n = Number(num) || 0;
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
      return n.toString();
    }

    function updateMineaCounterUI(payload = {}) {
      const status = payload.status || 'SUCCESS';

      if (status === 'LOADING') {
        if (btnCheckActiveTotal) {
          btnCheckActiveTotal.disabled = true;
          btnCheckActiveTotal.textContent = '⏳ Đang đo...';
        }
        if (mineaActiveCountEl) mineaActiveCountEl.textContent = '...';
        if (mineaActiveRawEl) mineaActiveRawEl.textContent = 'Đang lấy Active...';
        if (mineaTotalCountEl) mineaTotalCountEl.textContent = '...';
        if (mineaTotalRawEl) mineaTotalRawEl.textContent = 'Đang lấy Total...';
        if (mineaRatioPercentEl) mineaRatioPercentEl.textContent = '...%';
        if (mineaRatioStatusEl) mineaRatioStatusEl.textContent = 'Đang tính tỷ lệ...';
        if (mineaRatioBarFillEl) mineaRatioBarFillEl.style.width = '15%';
        return;
      }

      if (btnCheckActiveTotal) {
        btnCheckActiveTotal.disabled = false;
        btnCheckActiveTotal.textContent = '⚡ Check nhanh';
      }

      if (status === 'ERROR') {
        if (mineaActiveCountEl) mineaActiveCountEl.textContent = 'N/A';
        if (mineaActiveRawEl) mineaActiveRawEl.textContent = 'Không lấy được';
        if (mineaTotalCountEl) mineaTotalCountEl.textContent = 'N/A';
        if (mineaTotalRawEl) mineaTotalRawEl.textContent = 'Không lấy được';
        if (mineaRatioPercentEl) mineaRatioPercentEl.textContent = '0%';
        if (mineaRatioStatusEl) mineaRatioStatusEl.textContent = payload.error || 'Lỗi kết nối';
        if (mineaRatioBarFillEl) mineaRatioBarFillEl.style.width = '0%';
        return;
      }

      const rawActive = typeof payload.activeCount === 'number' ? Math.max(0, payload.activeCount) : 0;
      const rawTotal = typeof payload.totalCount === 'number' ? Math.max(rawActive, payload.totalCount) : rawActive;
      const ratioPercent = typeof payload.ratioPercent === 'number'
        ? payload.ratioPercent
        : (rawTotal > 0 ? Number(((rawActive / rawTotal) * 100).toFixed(1)) : 0);

      const roundedActive = typeof payload.smartActive === 'number' ? payload.smartActive : smartRound(rawActive);
      const roundedTotal = typeof payload.smartTotal === 'number' ? payload.smartTotal : smartRound(rawTotal);

      const formattedActive = payload.formattedActive || `~${formatNumberWithoutDecimals(roundedActive)}`;
      const formattedTotal = payload.formattedTotal || `${rawTotal > 50000 ? '>' : '~'}${formatNumberCompact(roundedTotal)}`;

      if (mineaActiveCountEl) mineaActiveCountEl.textContent = formattedActive;
      if (mineaActiveRawEl) mineaActiveRawEl.textContent = `Chính xác: ${formatNumberWithoutDecimals(rawActive)} camp`;

      if (mineaTotalCountEl) mineaTotalCountEl.textContent = formattedTotal;
      if (mineaTotalRawEl) mineaTotalRawEl.textContent = `Tổng: ${formatNumberWithoutDecimals(rawTotal)} camp`;

      if (mineaRatioPercentEl) {
        mineaRatioPercentEl.textContent = `${ratioPercent}%`;
        if (ratioPercent >= 50) {
          mineaRatioPercentEl.style.color = '#22c55e';
        } else if (ratioPercent >= 20) {
          mineaRatioPercentEl.style.color = '#fb923c';
        } else {
          mineaRatioPercentEl.style.color = '#94a3b8';
        }
      }

      if (mineaRatioStatusEl) {
        if (rawTotal === 0) {
          mineaRatioStatusEl.textContent = '0 / 0 camp';
        } else if (ratioPercent >= 50) {
          mineaRatioStatusEl.textContent = `🔥 Đang vít mạnh (${formatNumberWithoutDecimals(rawActive)}/${formatNumberWithoutDecimals(rawTotal)})`;
        } else if (ratioPercent >= 20) {
          mineaRatioStatusEl.textContent = `⚡ Duy trì đều (${formatNumberWithoutDecimals(rawActive)}/${formatNumberWithoutDecimals(rawTotal)})`;
        } else {
          mineaRatioStatusEl.textContent = `💤 Giảm camp (${formatNumberWithoutDecimals(rawActive)}/${formatNumberWithoutDecimals(rawTotal)})`;
        }
      }

      if (mineaRatioBarFillEl) {
        const clampedWidth = Math.min(100, Math.max(0, ratioPercent));
        mineaRatioBarFillEl.style.width = `${clampedWidth}%`;
      }
    }

    function parseInoteUrlInput(rawInput) {
      if (!rawInput || typeof rawInput !== 'string') return null;
      const cleaned = rawInput.trim().replace(/^["“']+|["”']+$/g, '').trim();
      const match = cleaned.match(/^(?:https?:\/\/)?(?:www\.)?inote\.net\/([a-zA-Z0-9_\-]+)\/?$/i);
      return match ? `https://inote.net/${match[1]}` : null;
    }

    // ── Function 1: getSearchParams() ────────────────────────────────
    function getSearchParams() {
      let rawKeyword = (inputKeyword ? inputKeyword.value : '').trim();
      const inoteUrl = parseInoteUrlInput(rawKeyword);
      const isExactChecked = chkExactPhrase ? chkExactPhrase.checked : false;
      const hasQuotes = !inoteUrl && /^["“'].*["”']$/.test(rawKeyword);
      const isExactPhrase = isExactChecked || hasQuotes;

      if (inoteUrl) {
        rawKeyword = inoteUrl;
      } else if (isExactPhrase) {
        const unquoted = rawKeyword.replace(/^["“']+|["”']+$/g, '').trim();
        rawKeyword = `"${unquoted}"`;
      }
      const searchType = isExactPhrase ? 'KEYWORD_EXACT_PHRASE' : 'KEYWORD_UNORDERED';
      const keyword = rawKeyword;
      const country = selectCountry ? selectCountry.value : 'US';
      const category = selectCategory ? selectCategory.value : 'ALL';

      const publisherPlatforms = [];
      if (chkFb && chkFb.checked) publisherPlatforms.push('FACEBOOK');
      if (chkIg && chkIg.checked) publisherPlatforms.push('INSTAGRAM');
      if (chkAn && chkAn.checked) publisherPlatforms.push('AUDIENCE_NETWORK');
      if (chkMsg && chkMsg.checked) publisherPlatforms.push('MESSENGER');
      if (chkWa && chkWa.checked) publisherPlatforms.push('WHATSAPP');
      if (chkThreads && chkThreads.checked) publisherPlatforms.push('THREADS');

      const mediaType = selectMediaType ? selectMediaType.value : 'ALL';
      const activeStatus = selectActiveStatus ? selectActiveStatus.value : 'ACTIVE';
      let startDate = null;
      if (selectStartDate) {
        const val = selectStartDate.value;
        if (val === 'CUSTOM') {
          startDate = (inputCustomDate && inputCustomDate.value) ? inputCustomDate.value.trim() : null;
        } else if (val && val !== 'ALL') {
          startDate = calculatePastDate(val);
        }
      }
      const language = selectLanguage ? selectLanguage.value : 'ALL';
      const sortMode = selectSortBy ? selectSortBy.value : 'TOTAL_IMPRESSIONS_DESC';

      // Nếu người dùng chọn cả 6 nền tảng (hoặc không chọn nền tảng nào), gửi mảng rỗng [] để quét 100% nền tảng như curl Ads Library
      const finalPlatforms = (publisherPlatforms.length === 6 || publisherPlatforms.length === 0) ? [] : publisherPlatforms;
      const isPageHunter = Boolean(chkPageHunter && chkPageHunter.checked);

      return {
        keyword,
        rawKeyword,
        inoteUrl: inoteUrl || null,
        isInoteBatch: Boolean(inoteUrl),
        isPageHunter,
        isExactPhrase,
        searchType,
        country,
        category,
        publisherPlatforms: finalPlatforms,
        mediaType,
        activeStatus,
        startDate: startDate || null,
        language: language || 'ALL',
        sortMode,
        sortBy: sortMode
      };
    }

    // ── Function 2: updateProgressUI() ───────────────────────────────
    function updateProgressUI(status, current, total, message) {
      findAdsState.extractedCount = typeof current === 'number' ? current : findAdsState.extractedCount;
      if (typeof total === 'number' && total > 0) {
        findAdsState.totalFound = total;
      }

      // Update counters
      const isHunterActive = Boolean(chkPageHunter && chkPageHunter.checked);
      if (totalCountEl) {
        totalCountEl.textContent = findAdsState.totalFound > 0
          ? (isHunterActive ? `${findAdsState.totalFound}` : `~${findAdsState.totalFound}`)
          : '0';
      }
      if (parsedCountEl) {
        parsedCountEl.textContent = String(findAdsState.extractedCount);
      }
      if (batchProgressEl) {
        if (message) {
          batchProgressEl.textContent = message;
        } else if (findAdsState.totalFound > 0) {
          batchProgressEl.textContent = `${findAdsState.extractedCount} / ${findAdsState.totalFound}`;
        } else {
          batchProgressEl.textContent = status === 'SEARCHING' ? 'Đang chuẩn bị...' : 'Sẵn sàng';
        }
      }

      // Progress bar fill %
      if (progressBar) {
        let percent = 0;
        if (status === 'COMPLETED') {
          percent = 100;
        } else if (findAdsState.totalFound > 0) {
          percent = Math.min(100, Math.max(5, Math.round((findAdsState.extractedCount / findAdsState.totalFound) * 100)));
        } else if (status === 'SEARCHING' || status === 'FETCHING_PAGE') {
          percent = 20;
        }
        progressBar.style.width = `${percent}%`;
      }

      // Status indicator badge
      if (badgeStatus && statusText) {
        if (status === 'SEARCHING' || status === 'FETCHING_PAGE' || status === 'PROCESSING_ADS') {
          badgeStatus.className = 'badge-status active';
          statusText.textContent = message || 'Đang quét Ads Library...';
          if (btnStart) btnStart.style.display = 'none';
          if (btnStop) btnStop.style.display = 'flex';
        } else if (status === 'COMPLETED') {
          badgeStatus.className = 'badge-status active';
          statusText.textContent = `Hoàn tất: ${findAdsState.extractedCount} ads`;
          if (btnStart) btnStart.style.display = 'flex';
          if (btnStop) btnStop.style.display = 'none';
        } else if (status === 'ERROR') {
          badgeStatus.className = 'badge-status error';
          badgeStatus.style.background = 'rgba(239, 68, 68, 0.2)';
          badgeStatus.style.borderColor = '#ef4444';
          badgeStatus.style.color = '#ef4444';
          statusText.textContent = 'Lỗi tìm kiếm';
          if (batchProgressEl) {
            batchProgressEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">⚠️ ${escapeHTML(message || 'Lỗi quét Ads')}</span> <button type="button" id="btn-open-fb-login" style="margin-left:8px; padding:3px 10px; font-size:11px; font-weight:bold; background:#1877f2; color:#fff; border:none; border-radius:4px; cursor:pointer;">Mở Facebook Ads Library</button>`;
            const btnOpen = document.getElementById('btn-open-fb-login');
            if (btnOpen) {
              btnOpen.addEventListener('click', () => {
                if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
                  chrome.tabs.create({ url: 'https://www.facebook.com/ads/library/?country=US' });
                } else {
                  window.open('https://www.facebook.com/ads/library/?country=US', '_blank');
                }
              });
            }
          }
          if (progressBar) {
            progressBar.style.width = '100%';
            progressBar.style.background = '#ef4444';
          }
          if (btnStart) btnStart.style.display = 'flex';
          if (btnStop) btnStop.style.display = 'none';
        } else {
          badgeStatus.className = 'badge-status';
          statusText.textContent = 'Sẵn sàng tìm kiếm';
          if (btnStart) btnStart.style.display = 'flex';
          if (btnStop) btnStop.style.display = 'none';
        }
      }

      // Inote button state
      if (btnSaveInote) {
        btnSaveInote.disabled = findAdsState.ads.length === 0;
      }
      if (badgeInoteReadyCount) {
        const unitLabel = (chkPageHunter && chkPageHunter.checked) ? 'pages' : 'ads';
        badgeInoteReadyCount.textContent = `${findAdsState.ads.length} ${unitLabel}`;
      }
    }

    // ── Formatters for inote.net Text Format ──────────────────────────
    function formatAdToInoteText(ad, index) {
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

    function getExportFormatMode() {
      const chkContent = getEl('chk-export-only-content', 'chkExportOnlyContent');
      const chkLinks = getEl('chk-export-only-links', 'chkExportOnlyLinks');
      const chkPageName = getEl('chk-export-only-page-name', 'chkExportOnlyPageName');
      if (chkPageName && chkPageName.checked) return 'page_name';
      if (chkContent && chkContent.checked) return 'content';
      if (chkLinks && chkLinks.checked) return 'links';
      return 'full';
    }

    function updateExportModeBadgeUI() {
      const badgeExportMode = document.getElementById('badge-export-mode');
      if (!badgeExportMode) return;
      const mode = getExportFormatMode();
      if (mode === 'page_name') {
        badgeExportMode.textContent = 'Chỉ lấy tên Page';
      } else if (mode === 'content') {
        badgeExportMode.textContent = 'Chỉ nội dung bài viết';
      } else if (mode === 'links') {
        badgeExportMode.textContent = 'Chỉ đường dẫn đích';
      } else {
        badgeExportMode.textContent = 'Đầy đủ 8 trường';
      }
    }

    const chkExportContentEl = getEl('chk-export-only-content', 'chkExportOnlyContent');
    const chkExportLinksEl = getEl('chk-export-only-links', 'chkExportOnlyLinks');
    const chkExportPageNameEl = getEl('chk-export-only-page-name', 'chkExportOnlyPageName');
    const exportCheckboxes = [chkExportContentEl, chkExportLinksEl, chkExportPageNameEl].filter(Boolean);
    exportCheckboxes.forEach((chk) => {
      chk.addEventListener('change', () => {
        if (chk.checked) {
          exportCheckboxes.forEach((other) => {
            if (other !== chk) other.checked = false;
          });
        }
        updateExportModeBadgeUI();
      });
    });

    function formatAllAdsToInoteText(ads, mode = null) {
      const exportMode = mode || getExportFormatMode();
      if (!Array.isArray(ads) || ads.length === 0) return '';

      // Tích chọn: Chỉ lấy tên Page, mỗi tên Page 1 dòng (lọc trùng giữ thứ tự)
      if (exportMode === 'page_name' || exportMode === 'ONLY_PAGE_NAME') {
        const uniquePages = Array.from(
          new Set(
            ads
              .map(ad => (ad.page_name || ad.pageName || '').trim())
              .filter(Boolean)
          )
        );
        return uniquePages.join('\n');
      }

      // Tích chọn: Chỉ lấy nội dung bài viết, mỗi mẫu cách nhau 1 dòng trống
      if (exportMode === 'content' || exportMode === 'ONLY_CONTENT') {
        return ads
          .map(ad => (ad.caption_text || ad.caption || '').trim())
          .filter(Boolean)
          .join('\n\n');
      }

      // Tích chọn: Chỉ lấy đường dẫn đích, mỗi link xuống dòng
      if (exportMode === 'links' || exportMode === 'ONLY_LINKS') {
        return ads
          .map(ad => (ad.link_url || '').trim())
          .filter(Boolean)
          .join('\n');
      }

      // Mặc định: Đầy đủ 8 trường
      return ads.map((ad, i) => formatAdToInoteText(ad, i)).join('\n\n');
    }

    // ── Function 3: renderAdCard() ───────────────────────────────────
    function renderAdCard(ad, index) {
      const card = document.createElement('article');
      card.className = 'ad-card find-ad-card';
      card.dataset.archiveId = ad.archive_id || '';

      const archiveId = safeHtml(ad.archive_id || '');
      const pageId = safeHtml(ad.page_id || '');
      const pageName = safeHtml(ad.page_name || 'Advertiser');
      const firstLetter = (ad.page_name ? ad.page_name.charAt(0) : 'A').toUpperCase();
      const isActive = Boolean(ad.is_active);
      const platforms = ad.platforms || 'Facebook';
      const creativeFormat = ad.creative_format || 'Hình ảnh';
      const isVideo = creativeFormat.toLowerCase().includes('video');
      const captionText = ad.caption_text || '';
      const ctaText = safeHtml(ad.cta_text || 'Shop now');
      const linkUrl = ad.link_url || '';
      const safeLinkUrl = safeHtml(linkUrl);
      const destinationDomain = linkUrl ? (() => {
        try { return new URL(linkUrl).hostname; } catch (e) { return linkUrl.substring(0, 30); }
      })() : 'facebook.com';

      // Parse platforms for visual badges
      const platformBadgesHtml = platforms.split(',').map(p => {
        const pTrimmed = p.trim();
        let cls = 'other';
        const pLower = pTrimmed.toLowerCase();
        if (pLower.includes('facebook')) cls = 'fb';
        else if (pLower.includes('instagram')) cls = 'ig';
        else if (pLower.includes('audience')) cls = 'an';
        else if (pLower.includes('messenger')) cls = 'msg';
        return `<span class="platform-badge ${cls}">${safeHtml(pTrimmed)}</span>`;
      }).join(' ');

      // Media preview thumbnail
      let mediaPreviewHtml = '';
      if (ad.image_url) {
        mediaPreviewHtml = `
          <div class="ad-media-preview-box">
            <img src="${safeHtml(ad.image_url)}" alt="Ad Media Preview" loading="lazy" onerror="this.parentElement.style.display='none';">
            ${isVideo ? `<div class="media-duration-tag">${safeHtml(creativeFormat)}</div>` : ''}
          </div>
        `;
      }

      // Unique caption ID for expand toggle
      const captionId = `caption-${ad.archive_id || Math.random().toString(36).substring(2, 9)}`;
      const isLongCaption = captionText.length > 160;

      card.innerHTML = `
        <!-- Card Header -->
        <div class="ad-card-top">
          <div class="page-meta">
            <div class="page-avatar">${safeHtml(firstLetter)}</div>
            <div class="page-details">
              <a href="https://www.facebook.com/${safeHtml(pageId || '')}" target="_blank" class="page-name">${pageName}</a>
              <div class="page-badges">
                <span class="tag-page-id">Page ID: ${pageId}</span>
                <span class="tag-active-status ${isActive ? 'active' : 'inactive'}">
                  ${isActive ? 'Đang chạy' : 'Đã dừng'}
                </span>
              </div>
            </div>
          </div>
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px;">
            <a href="https://www.facebook.com/ads/library/?id=${archiveId}" target="_blank" class="archive-pill" title="Xem trên Facebook Ads Library">ID: ${archiveId} ↗</a>
            <span class="${isVideo ? 'video-pill' : 'image-pill'}">${safeHtml(creativeFormat)}</span>
          </div>
        </div>

        <!-- Platforms Bar -->
        <div class="ad-platforms-bar">
          <span>Nền tảng:</span>
          ${platformBadgesHtml}
        </div>

        <!-- Media Preview -->
        ${mediaPreviewHtml}

        <!-- Caption Box (100% full text caption) -->
        <div class="ad-content-box">
          <div class="ad-full-caption" id="${captionId}">${safeHtml(captionText)}</div>
          ${isLongCaption ? `<button type="button" class="btn-expand-caption" data-target="${captionId}">Xem toàn bộ bài viết ▼</button>` : ''}
        </div>

        <!-- Webstore Destination & CTA -->
        <div class="webstore-box">
          <div class="store-info">
            <span class="store-domain">${safeHtml(destinationDomain)}</span>
            <span class="store-title" title="${safeLinkUrl}">${safeLinkUrl || 'Link sản phẩm'}</span>
          </div>
          ${linkUrl ? `<a href="${safeLinkUrl}" target="_blank" class="cta-badge">${ctaText} ↗</a>` : `<span class="cta-badge" style="opacity:0.6;">${ctaText}</span>`}
        </div>

        <!-- Card Footer Actions -->
        <div class="ad-card-footer">
          <span style="color: var(--text-muted); font-weight: 600;">Mẫu #${index + 1}</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-card-action btn-copy-ad-sample" title="Copy mẫu text chuẩn inote cho bài này">Copy Mẫu Text</button>
            ${linkUrl ? `<button type="button" class="btn-card-action btn-copy-ad-link" data-url="${safeLinkUrl}" title="Copy link sản phẩm">Copy Link</button>` : ''}
          </div>
        </div>
      `;

      // Event: Expand/Collapse Caption
      if (isLongCaption) {
        const btnExpand = card.querySelector('.btn-expand-caption');
        const captionEl = card.querySelector(`#${captionId}`);
        if (btnExpand && captionEl) {
          btnExpand.addEventListener('click', () => {
            const isExpanded = captionEl.classList.toggle('expanded');
            btnExpand.textContent = isExpanded ? 'Thu gọn ▲' : 'Xem toàn bộ bài viết ▼';
          });
        }
      }

      // Event: Copy Single Sample Text
      const btnCopySample = card.querySelector('.btn-copy-ad-sample');
      if (btnCopySample) {
        btnCopySample.addEventListener('click', async () => {
          const currentMode = getExportFormatMode();
          const sampleText = currentMode === 'full'
            ? formatAdToInoteText(ad, index)
            : formatAllAdsToInoteText([ad], currentMode);
          const ok = await copyText(sampleText);
          if (ok) {
            const oldText = btnCopySample.textContent;
            btnCopySample.textContent = '✓ Đã copy!';
            btnCopySample.style.color = '#34d399';
            setTimeout(() => {
              btnCopySample.textContent = oldText;
              btnCopySample.style.color = '';
            }, 1500);
          }
        });
      }

      // Event: Copy Destination Link
      const btnCopyLink = card.querySelector('.btn-copy-ad-link');
      if (btnCopyLink && linkUrl) {
        btnCopyLink.addEventListener('click', async () => {
          const ok = await copyText(linkUrl);
          if (ok) {
            const oldText = btnCopyLink.textContent;
            btnCopyLink.textContent = '✓ Đã copy!';
            btnCopyLink.style.color = '#38bdf8';
            setTimeout(() => {
              btnCopyLink.textContent = oldText;
              btnCopyLink.style.color = '';
            }, 1500);
          }
        });
      }

      return card;
    }

    // ── Function 3b: renderCompactAdRow() (Lightweight 50/page row) ──
    function renderCompactAdRow(ad, index) {
      const row = document.createElement('div');
      row.className = 'find-ad-compact-row';
      row.dataset.archiveId = ad.archive_id || '';

      const archiveId = safeHtml(ad.archive_id || '');
      const pageId = safeHtml(ad.page_id || '');
      const pageName = safeHtml(ad.page_name || 'Advertiser');
      const isActive = Boolean(ad.is_active);
      const creativeFormat = safeHtml(ad.creative_format || 'Hình ảnh');
      const isVideo = (ad.creative_format || '').toLowerCase().includes('video');
      const linkUrl = ad.link_url || '';
      const safeLinkUrl = safeHtml(linkUrl);
      const destinationDomain = linkUrl ? (() => {
        try { return new URL(linkUrl).hostname.replace(/^www\./, ''); } catch (e) { return linkUrl.substring(0, 24); }
      })() : '';
      const captionSnippet = safeHtml((ad.caption_text || '').replace(/\s+/g, ' ').trim().substring(0, 110));

      row.innerHTML = `
        <div class="find-ad-compact-main">
          <div class="find-ad-compact-left">
            <span class="find-ad-compact-idx">#${index + 1}</span>
            <span class="tag-active-status ${isActive ? 'active' : 'inactive'}" style="flex-shrink:0;">${isActive ? '●' : '○'}</span>
            <a href="https://www.facebook.com/${pageId}" target="_blank" class="find-ad-compact-page" title="Page ID: ${pageId}">${pageName}</a>
            <span class="${isVideo ? 'video-pill' : 'image-pill'}" style="flex-shrink:0;">${creativeFormat}</span>
            ${destinationDomain ? `<span class="find-ad-compact-domain" title="${safeLinkUrl}">${safeHtml(destinationDomain)}</span>` : ''}
          </div>
          <div class="find-ad-compact-actions">
            <button type="button" class="btn-card-action btn-copy-ad-sample" style="padding:2px 6px; font-size:10px;" title="Copy mẫu theo tùy chọn xuất">Copy</button>
            ${linkUrl ? `<a href="${safeLinkUrl}" target="_blank" class="archive-pill" style="padding:2px 5px; font-size:9.5px;" title="Mở Link Đích">Link ↗</a>` : ''}
            <a href="https://www.facebook.com/ads/library/?id=${archiveId}" target="_blank" class="archive-pill" style="padding:2px 5px; font-size:9.5px;" title="Mở trên Ads Library">ID ↗</a>
          </div>
        </div>
        ${captionSnippet ? `<div class="find-ad-compact-snippet">${captionSnippet}</div>` : ''}
      `;

      const btnCopySample = row.querySelector('.btn-copy-ad-sample');
      if (btnCopySample) {
        btnCopySample.addEventListener('click', async () => {
          const currentMode = getExportFormatMode();
          const sampleText = currentMode === 'full'
            ? formatAdToInoteText(ad, index)
            : formatAllAdsToInoteText([ad], currentMode);
          const ok = await copyText(sampleText);
          if (ok) {
            const oldText = btnCopySample.textContent;
            btnCopySample.textContent = '✓';
            btnCopySample.style.color = '#34d399';
            setTimeout(() => {
              btnCopySample.textContent = oldText;
              btnCopySample.style.color = '';
            }, 1200);
          }
        });
      }

      return row;
    }

    function getFindAdsPageSize() {
      return findAdsState.viewMode === 'compact' ? 50 : 20;
    }

    function updatePaginationBarUI() {
      const totalAds = findAdsState.ads.length;
      if (findAdsState.viewMode === 'data_only') {
        if (paginationControlsEl) paginationControlsEl.style.display = 'none';
        const dataCountEl = document.getElementById('find-ads-data-only-count');
        if (dataCountEl) dataCountEl.textContent = String(totalAds);
        return;
      }

      if (paginationControlsEl) paginationControlsEl.style.display = 'flex';
      const pageSize = getFindAdsPageSize();
      const totalPages = Math.max(1, Math.ceil(totalAds / pageSize));
      if (findAdsState.currentPage > totalPages) {
        findAdsState.currentPage = totalPages;
      }
      if (findAdsState.currentPage < 1) {
        findAdsState.currentPage = 1;
      }

      if (pageInfoEl) {
        pageInfoEl.textContent = `Trang ${findAdsState.currentPage}/${totalPages} (${totalAds})`;
      }
      if (btnPrevPage) {
        btnPrevPage.disabled = findAdsState.currentPage <= 1 || totalAds === 0;
      }
      if (btnNextPage) {
        btnNextPage.disabled = findAdsState.currentPage >= totalPages || totalAds === 0;
      }
    }

    function renderCurrentFindAdsPage(scrollToTop = false) {
      if (!resultsContainer) return;
      const totalAds = findAdsState.ads.length;
      updatePaginationBarUI();

      if (totalAds === 0) {
        resultsContainer.innerHTML = '';
        findAdsState.renderedCountOnPage = 0;
        if (emptyState) {
          emptyState.style.display = 'flex';
          resultsContainer.appendChild(emptyState);
        }
        return;
      }

      if (emptyState) emptyState.style.display = 'none';

      if (findAdsState.viewMode === 'data_only') {
        resultsContainer.innerHTML = `
          <div class="find-ads-data-only-banner">
            <div style="font-size: 24px;">⚡</div>
            <div style="font-size: 12.5px; font-weight: 700; color: #38bdf8;">
              Chế độ Siêu Tốc (Tắt render thẻ DOM chống lag)
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1; line-height: 1.5;">
              Đã thu thập và lưu trữ an toàn <strong id="find-ads-data-only-count" style="color: #34d399; font-size: 13px;">${totalAds}</strong> mẫu quảng cáo trong RAM.<br>
              Ông chủ có thể bấm <strong>📝 Lưu Vào inote.net</strong> hoặc <strong>📋 Copy Tất Cả</strong> ở trên để xuất toàn bộ 100% kết quả ngay lập tức!
            </div>
          </div>
        `;
        findAdsState.renderedCountOnPage = 0;
        return;
      }

      const pageSize = getFindAdsPageSize();
      const startIdx = (findAdsState.currentPage - 1) * pageSize;
      const endIdx = Math.min(totalAds, startIdx + pageSize);
      const slice = findAdsState.ads.slice(startIdx, endIdx);

      const frag = document.createDocumentFragment();
      for (let i = 0; i < slice.length; i++) {
        const globalIdx = startIdx + i;
        const ad = slice[i];
        const el = findAdsState.viewMode === 'compact'
          ? renderCompactAdRow(ad, globalIdx)
          : renderAdCard(ad, globalIdx);
        frag.appendChild(el);
      }

      resultsContainer.innerHTML = '';
      resultsContainer.appendChild(frag);
      findAdsState.renderedCountOnPage = slice.length;

      if (scrollToTop) {
        resultsContainer.scrollTop = 0;
      }
    }

    function appendIncomingBatchToCurrentPage() {
      const totalAds = findAdsState.ads.length;
      updatePaginationBarUI();
      if (!resultsContainer || totalAds === 0) return;

      if (emptyState && emptyState.parentElement === resultsContainer) {
        emptyState.style.display = 'none';
      }

      if (findAdsState.viewMode === 'data_only') {
        if (!resultsContainer.querySelector('.find-ads-data-only-banner')) {
          renderCurrentFindAdsPage(false);
        } else {
          const dataCountEl = document.getElementById('find-ads-data-only-count');
          if (dataCountEl) dataCountEl.textContent = String(totalAds);
        }
        return;
      }

      const pageSize = getFindAdsPageSize();
      const startIdx = (findAdsState.currentPage - 1) * pageSize;
      const targetEndIdx = Math.min(totalAds, startIdx + pageSize);
      const currentRenderedEndIdx = startIdx + findAdsState.renderedCountOnPage;

      // Only append if the current page still has unfilled slots (< 20 or < 50 cards)
      if (targetEndIdx > currentRenderedEndIdx) {
        const frag = document.createDocumentFragment();
        for (let globalIdx = currentRenderedEndIdx; globalIdx < targetEndIdx; globalIdx++) {
          const ad = findAdsState.ads[globalIdx];
          const el = findAdsState.viewMode === 'compact'
            ? renderCompactAdRow(ad, globalIdx)
            : renderAdCard(ad, globalIdx);
          frag.appendChild(el);
        }
        resultsContainer.appendChild(frag);
        findAdsState.renderedCountOnPage = targetEndIdx - startIdx;
      }
    }

    if (selectViewMode) {
      selectViewMode.addEventListener('change', () => {
        findAdsState.viewMode = selectViewMode.value || 'card';
        findAdsState.currentPage = 1;
        renderCurrentFindAdsPage(true);
      });
    }

    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', () => {
        if (findAdsState.currentPage > 1) {
          findAdsState.currentPage--;
          renderCurrentFindAdsPage(true);
        }
      });
    }

    if (btnNextPage) {
      btnNextPage.addEventListener('click', () => {
        const pageSize = getFindAdsPageSize();
        const totalPages = Math.max(1, Math.ceil(findAdsState.ads.length / pageSize));
        if (findAdsState.currentPage < totalPages) {
          findAdsState.currentPage++;
          renderCurrentFindAdsPage(true);
        }
      });
    }

    // ── Function 4: clearResults() ───────────────────────────────────
    function clearResults() {
      findAdsState.ads = [];
      findAdsState.seenArchiveIds.clear();
      findAdsState.totalFound = 0;
      findAdsState.extractedCount = 0;
      findAdsState.currentBatch = 0;
      findAdsState.totalBatches = 0;
      findAdsState.currentPage = 1;
      findAdsState.renderedCountOnPage = 0;

      if (resultsContainer) {
        resultsContainer.innerHTML = '';
        if (emptyState) {
          emptyState.style.display = 'flex';
          resultsContainer.appendChild(emptyState);
        }
      }

      if (inoteBanner) inoteBanner.style.display = 'none';
      updatePaginationBarUI();
      updateProgressUI('READY', 0, 0, 'Sẵn sàng tìm kiếm');
    }

    // ── Filter Accordion Toggle ──────────────────────────────────────
    if (filterToggle && filterBody) {
      filterToggle.addEventListener('click', () => {
        const isShown = filterBody.classList.toggle('show');
        if (filterArrow) {
          filterArrow.style.transform = isShown ? 'rotate(180deg)' : 'rotate(0deg)';
        }
      });
    }

    function applyPageHunterUIState(isHunter) {
      if (mineaCounterPanel) {
        mineaCounterPanel.style.display = isHunter ? 'none' : '';
      }
      if (statLabelTotal) {
        statLabelTotal.textContent = isHunter ? 'Tổng từ khóa' : 'Tổng tìm thấy';
      }
      if (statLabelParsed) {
        statLabelParsed.textContent = isHunter ? 'Page độc nhất' : 'Đã thu thập';
      }
      if (isHunter) {
        if (chkExportPageNameEl) {
          chkExportPageNameEl.checked = true;
          if (chkExportContentEl) chkExportContentEl.checked = false;
          if (chkExportLinksEl) chkExportLinksEl.checked = false;
          updateExportModeBadgeUI();
        }
        // Chuyển sang danh sách gọn (50 dòng/trang, 0 video DOM) để hiển thị tên Page mượt 100%
        findAdsState.viewMode = 'compact';
        if (selectViewMode) selectViewMode.value = 'compact';
      }
    }

    // ── Keyword Clear Button & Inote Auto-Detect ────────────────────
    if (btnClearKeyword && inputKeyword) {
      function updateSearchTypeBadge(isExact, isInote = false) {
        const isHunter = Boolean(chkPageHunter && chkPageHunter.checked);
        if (badgeSearchType) {
          if (isHunter) {
            badgeSearchType.textContent = '🎯 PAGE_HUNTER_TURBO';
            badgeSearchType.style.color = '#10b981';
            badgeSearchType.style.background = 'rgba(16, 185, 129, 0.2)';
            badgeSearchType.style.borderColor = 'rgba(16, 185, 129, 0.45)';
            badgeSearchType.title = 'Chế độ Page Hunter: Chạy 3 luồng song song, lọc trùng tên Page và tự xuất ra Inote';
          } else if (isInote) {
            badgeSearchType.textContent = '📑 INOTE_BATCH_QUEUE';
            badgeSearchType.style.color = '#34d399';
            badgeSearchType.style.background = 'rgba(16, 185, 129, 0.15)';
            badgeSearchType.style.borderColor = 'rgba(16, 185, 129, 0.35)';
            badgeSearchType.title = 'Tự động tải và quét lần lượt từng dòng từ khóa từ link inote.net';
          } else if (isExact) {
            badgeSearchType.textContent = 'KEYWORD_EXACT_PHRASE';
            badgeSearchType.style.color = '#38bdf8';
            badgeSearchType.style.background = 'rgba(56, 189, 248, 0.15)';
            badgeSearchType.style.borderColor = 'rgba(56, 189, 248, 0.3)';
            badgeSearchType.title = 'Tìm kiếm cụm từ chính xác (Exact Phrase - \"...\")';
          } else {
            badgeSearchType.textContent = 'KEYWORD_UNORDERED';
            badgeSearchType.style.color = '#818cf8';
            badgeSearchType.style.background = 'rgba(99, 102, 241, 0.15)';
            badgeSearchType.style.borderColor = 'rgba(99, 102, 241, 0.3)';
            badgeSearchType.title = 'Tìm kiếm từ khóa thông thường (Unordered)';
          }
        }
      }

      if (chkPageHunter) {
        chkPageHunter.addEventListener('change', () => {
          const isHunter = chkPageHunter.checked;
          applyPageHunterUIState(isHunter);
          const val = inputKeyword ? inputKeyword.value.trim() : '';
          updateSearchTypeBadge(
            Boolean(chkExactPhrase && chkExactPhrase.checked),
            Boolean(parseInoteUrlInput(val))
          );
        });
      }

      if (inputKeyword) {
        inputKeyword.addEventListener('input', () => {
          const val = inputKeyword.value.trim();
          const inoteDetected = Boolean(parseInoteUrlInput(val));
          if (inoteDetected) {
            updateSearchTypeBadge(chkExactPhrase ? chkExactPhrase.checked : false, true);
            return;
          }
          const hasQuotes = /^["“'].*["”']$/.test(val);
          if (hasQuotes) {
            if (chkExactPhrase) chkExactPhrase.checked = true;
            updateSearchTypeBadge(true, false);
          } else if (chkExactPhrase && !chkExactPhrase.checked) {
            updateSearchTypeBadge(false, false);
          } else {
            updateSearchTypeBadge(Boolean(chkExactPhrase && chkExactPhrase.checked), false);
          }
        });
      }

      if (chkExactPhrase) {
        chkExactPhrase.addEventListener('change', () => {
          const checked = chkExactPhrase.checked;
          let val = inputKeyword ? inputKeyword.value.trim() : '';
          const inoteUrl = parseInoteUrlInput(val);
          if (inoteUrl) {
            inputKeyword.value = inoteUrl;
            updateSearchTypeBadge(checked, true);
            return;
          }
          if (checked) {
            if (val && !/^["“'].*["”']$/.test(val)) {
              inputKeyword.value = `"${val}"`;
            }
          } else {
            if (val && /^["“'].*["”']$/.test(val)) {
              inputKeyword.value = val.replace(/^["“']+|["”']+$/g, '').trim();
            }
          }
          updateSearchTypeBadge(checked, false);
        });
      }

      btnClearKeyword.addEventListener('click', () => {
        inputKeyword.value = '';
        updateSearchTypeBadge(Boolean(chkExactPhrase && chkExactPhrase.checked), false);
        inputKeyword.focus();
      });
    }

    if (selectStartDate) {
      selectStartDate.addEventListener('change', () => {
        if (selectStartDate.value === 'CUSTOM') {
          if (customDateWrapper) customDateWrapper.style.display = 'flex';
          if (inputCustomDate) inputCustomDate.focus();
        } else {
          if (customDateWrapper) customDateWrapper.style.display = 'none';
        }
      });
    }

    if (btnClearStartDate) {
      btnClearStartDate.addEventListener('click', () => {
        if (selectStartDate) selectStartDate.value = 'ALL';
        if (inputCustomDate) inputCustomDate.value = '';
        if (customDateWrapper) customDateWrapper.style.display = 'none';
      });
    }

    // ── Minea Quick Check Active vs Total Button Handler ─────────────
    if (btnCheckActiveTotal) {
      btnCheckActiveTotal.addEventListener('click', () => {
        const params = getSearchParams();
        if (!params.keyword) {
          alert('Vui lòng nhập từ khóa tìm kiếm hoặc tên Page trước khi Check Active / Total!');
          if (inputKeyword) inputKeyword.focus();
          return;
        }

        updateMineaCounterUI({ status: 'LOADING' });

        chrome.runtime.sendMessage({
          action: 'FETCH_ACTIVE_VS_TOTAL',
          payload: params
        }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('FETCH_ACTIVE_VS_TOTAL warning:', chrome.runtime.lastError.message);
            return;
          }
          if (res && res.success && res.data) {
            updateMineaCounterUI({ status: 'SUCCESS', ...res.data });
          } else if (res && !res.success) {
            updateMineaCounterUI({ status: 'ERROR', error: res.error || 'Lỗi đo camp' });
          }
        });
      });
    }

    // ── Search Button Handler ────────────────────────────────────────
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (findAdsState.isSearching) return;
        const params = getSearchParams();
        if (!params.keyword) {
          alert('Vui lòng nhập từ khóa tìm kiếm (ví dụ: DallasWind US)!');
          if (inputKeyword) inputKeyword.focus();
          return;
        }

        clearResults();
        if (emptyState) emptyState.style.display = 'none';

        findAdsState.isSearching = true;
        applyPageHunterUIState(Boolean(params.isPageHunter));
        if (params.isPageHunter) {
          updateProgressUI('SEARCHING', 0, 0, '🎯 Page Hunter: Đang khởi tạo 3 luồng săn tên Page...');
        } else {
          updateProgressUI('SEARCHING', 0, 0, 'Đang gửi truy vấn tới Facebook Ads Library...');
          updateMineaCounterUI({ status: 'LOADING' });
        }

        // Dispatch action to background service worker (single dispatch)
        chrome.runtime.sendMessage({
          action: 'FETCH_ADS_SEARCH',
          payload: params
        }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('FETCH_ADS_SEARCH runtime warning:', chrome.runtime.lastError.message);
          }
        });
      });
    }

    // ── Stop Button Handler ──────────────────────────────────────────
    if (btnStop) {
      btnStop.addEventListener('click', () => {
        findAdsState.isSearching = false;
        updateProgressUI('READY', findAdsState.extractedCount, findAdsState.totalFound, 'Đã dừng tìm kiếm');

        chrome.runtime.sendMessage({ action: 'CANCEL_ADS_SEARCH' }, () => {});
        chrome.runtime.sendMessage({ action: 'FIND_ADS_STOP' }, () => {});
      });
    }

    // ── Save to inote.net Handler ─────────────────────────────────────
    if (btnSaveInote) {
      btnSaveInote.addEventListener('click', async () => {
        if (findAdsState.ads.length === 0) {
          alert('Chưa có quảng cáo nào để lưu lên inote.net!');
          return;
        }

        const fullText = formatAllAdsToInoteText(findAdsState.ads);
        btnSaveInote.disabled = true;
        const originalHtml = btnSaveInote.innerHTML;
        btnSaveInote.innerHTML = '<span>⏳ Đang tạo note trên inote.net...</span>';

        // Helper to update UI when inote is created
        function handleInoteCreated(noteUrl, noteId, tabOpened) {
          findAdsState.lastNoteUrl = noteUrl;
          findAdsState.lastNoteId = noteId;

          if (inoteBanner && inoteLink) {
            inoteBanner.style.display = 'flex';
            inoteLink.href = noteUrl;
            inoteLink.textContent = noteUrl;
          }

          copyText(noteUrl).then(() => {
            console.log('✓ inote.net URL copied to clipboard:', noteUrl);
          });

          // Open in new tab (if not already opened by background service worker)
          if (!tabOpened) {
            if (chrome.tabs && chrome.tabs.create) {
              chrome.tabs.create({ url: noteUrl });
            } else {
              window.open(noteUrl, '_blank');
            }
          }

          btnSaveInote.disabled = false;
          btnSaveInote.innerHTML = originalHtml;
        }

        // Try asking background worker first
        chrome.runtime.sendMessage({
          action: 'CREATE_INOTE',
          payload: { content: fullText, ads: findAdsState.ads, formatMode: getExportFormatMode() }
        }, async (res) => {
          if (res && res.success && res.noteUrl) {
            handleInoteCreated(res.noteUrl, res.noteId || '', Boolean(res.tabOpened));
            return;
          }

          // Fallback: Direct 2-step inote creation from sidepanel (permitted by <all_urls> host_permissions)
          try {
            console.log('Attempting direct inote.net 2-step allocation...');
            const getResp = await fetch('https://inote.net/', {
              method: 'GET',
              redirect: 'follow'
            });

            const finalUrl = getResp.url || '';
            const match = finalUrl.match(/https?:\/\/inote\.net\/([a-zA-Z0-9_\-]+)/);
            const noteId = match ? match[1] : '';

            if (!noteId) {
              throw new Error('Không lấy được note ID từ inote.net');
            }

            const postResp = await fetch(`https://inote.net/${noteId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'text=' + encodeURIComponent(fullText)
            });

            if (!postResp.ok) {
              throw new Error(`Lỗi lưu dữ liệu lên inote.net (HTTP ${postResp.status})`);
            }

            const createdNoteUrl = `https://inote.net/${noteId}`;
            handleInoteCreated(createdNoteUrl, noteId);
          } catch (err) {
            console.error('Lỗi lưu inote.net:', err);
            alert(`Không thể lưu lên inote.net: ${err.message}. Đã tự động sao chép toàn bộ văn bản vào clipboard.`);
            copyText(fullText);
            btnSaveInote.disabled = false;
            btnSaveInote.innerHTML = originalHtml;
          }
        });
      });
    }

    // ── Quick Copy inote Link ────────────────────────────────────────
    if (btnCopyInoteQuick) {
      btnCopyInoteQuick.addEventListener('click', async () => {
        if (findAdsState.lastNoteUrl) {
          await copyText(findAdsState.lastNoteUrl);
          const oldText = btnCopyInoteQuick.textContent;
          btnCopyInoteQuick.textContent = '✓ Đã copy!';
          setTimeout(() => {
            btnCopyInoteQuick.textContent = oldText;
          }, 1500);
        }
      });
    }

    // ── Copy All Formatted Ads ───────────────────────────────────────
    if (btnCopyAll) {
      btnCopyAll.addEventListener('click', async () => {
        if (findAdsState.ads.length === 0) {
          alert('Danh sách kết quả đang trống!');
          return;
        }
        const fullText = formatAllAdsToInoteText(findAdsState.ads);
        const ok = await copyText(fullText);
        if (ok) {
          const oldText = btnCopyAll.textContent;
          btnCopyAll.textContent = '✓ Đã copy tất cả!';
          btnCopyAll.style.color = '#34d399';
          setTimeout(() => {
            btnCopyAll.textContent = oldText;
            btnCopyAll.style.color = '';
          }, 1500);
        }
      });
    }

    // ── Export JSON ──────────────────────────────────────────────────
    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => {
        if (findAdsState.ads.length === 0) {
          alert('Chưa có quảng cáo nào để xuất JSON!');
          return;
        }
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(findAdsState.ads, null, 2));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `fb_ads_${Date.now()}.json`;
        a.click();
      });
    }

    // ── Export CSV ───────────────────────────────────────────────────
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', () => {
        if (findAdsState.ads.length === 0) {
          alert('Chưa có quảng cáo nào để xuất CSV!');
          return;
        }
        const headers = ['archive_id', 'page_id', 'page_name', 'is_active', 'platforms', 'creative_format', 'caption_text', 'cta_text', 'link_url'];
        const rows = findAdsState.ads.map(ad => {
          return headers.map(h => {
            const val = String(ad[h] !== undefined ? ad[h] : '').replace(/"/g, '""');
            return `"${val}"`;
          }).join(',');
        });
        const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fb_ads_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // ── Clear Results Button ─────────────────────────────────────────
    if (btnClearResults) {
      btnClearResults.addEventListener('click', () => {
        if (findAdsState.ads.length > 0 && confirm('Bạn có chắc muốn xóa toàn bộ kết quả tìm kiếm Ads hiện tại?')) {
          clearResults();
        } else if (findAdsState.ads.length === 0) {
          clearResults();
        }
      });
    }

    // ── Background Message Listener for Real-time Streaming ─────────
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.action) return;

      // Protocol 1: SEARCH_PROGRESS_UPDATE
      if (message.action === 'SEARCH_PROGRESS_UPDATE') {
        const { status, currentPage, totalFound, extractedCount, batchAds, error, statusMessage, isPageHunter, autoNoteResult } = message.payload || {};

        if (Array.isArray(batchAds) && batchAds.length > 0) {
          batchAds.forEach(ad => {
            const key = String(ad.archive_id || '');
            if (key && !findAdsState.seenArchiveIds.has(key)) {
              findAdsState.seenArchiveIds.add(key);
              findAdsState.ads.push(ad);
            } else if (!key) {
              findAdsState.ads.push(ad);
            }
          });
          appendIncomingBatchToCurrentPage();
        }

        if (status === 'COMPLETED') {
          findAdsState.isSearching = false;
          updatePaginationBarUI();
          updateProgressUI('COMPLETED', extractedCount || findAdsState.ads.length, totalFound || findAdsState.ads.length, statusMessage || `Đã thu thập trọn vẹn ${findAdsState.ads.length} ads`);

          if (autoNoteResult && autoNoteResult.noteUrl) {
            findAdsState.lastNoteUrl = autoNoteResult.noteUrl;
            findAdsState.lastNoteId = autoNoteResult.noteId || '';
            if (inoteBanner && inoteLink) {
              inoteBanner.style.display = 'flex';
              inoteLink.href = autoNoteResult.noteUrl;
              inoteLink.textContent = autoNoteResult.noteUrl;
            }
            copyText(autoNoteResult.noteUrl);
          } else if ((isPageHunter || (chkPageHunter && chkPageHunter.checked)) && findAdsState.ads.length > 0 && btnSaveInote) {
            // Dự phòng: Nếu background chưa kịp tạo Inote thì Side Panel tự động kích hoạt Lưu Vào inote.net
            btnSaveInote.click();
          }
        } else if (status === 'ERROR') {
          findAdsState.isSearching = false;
          updateProgressUI('ERROR', findAdsState.ads.length, findAdsState.totalFound, error || 'Có lỗi xảy ra');
        } else {
          updateProgressUI(status || 'SEARCHING', extractedCount || findAdsState.ads.length, totalFound || findAdsState.totalFound, statusMessage || `Đang xử lý Batch ${currentPage || 1}...`);
        }
      }

      // Protocol 2: FIND_ADS_BATCH_RECEIVED / FIND_ADS_PROGRESS / FIND_ADS_COMPLETED
      else if (message.action === 'FIND_ADS_BATCH_RECEIVED') {
        const { batchAds, totalCount, batchNumber, statusMessage } = message.payload || {};
        if (Array.isArray(batchAds) && batchAds.length > 0) {
          batchAds.forEach(ad => {
            const key = String(ad.archive_id || '');
            if (key && !findAdsState.seenArchiveIds.has(key)) {
              findAdsState.seenArchiveIds.add(key);
              findAdsState.ads.push(ad);
            } else if (!key) {
              findAdsState.ads.push(ad);
            }
          });
          appendIncomingBatchToCurrentPage();
        }
        updateProgressUI('PROCESSING_ADS', findAdsState.ads.length, totalCount || findAdsState.totalFound, statusMessage || `Batch ${batchNumber || 1} đã nhận (+${(batchAds || []).length})`);
      } else if (message.action === 'FIND_ADS_PROGRESS') {
        const { parsedCount, totalCount, statusText: msg } = message.payload || {};
        updateProgressUI('SEARCHING', parsedCount, totalCount, msg);
      } else if (message.action === 'FIND_ADS_COMPLETED') {
        const { totalParsed, totalFound, statusMessage } = message.payload || {};
        findAdsState.isSearching = false;
        const preservedTotal = totalFound || findAdsState.totalFound || totalParsed || findAdsState.ads.length;
        updateProgressUI('COMPLETED', totalParsed || findAdsState.ads.length, preservedTotal, statusMessage || 'Thu thập hoàn tất 100%');
      } else if (message.action === 'INOTE_SAVE_RESULT') {
        const { success, noteUrl, noteId } = message.payload || {};
        if (success && noteUrl) {
          findAdsState.lastNoteUrl = noteUrl;
          findAdsState.lastNoteId = noteId;
          if (inoteBanner && inoteLink) {
            inoteBanner.style.display = 'flex';
            inoteLink.href = noteUrl;
            inoteLink.textContent = noteUrl;
          }
          copyText(noteUrl);
        }
      } else if (message.action === 'ACTIVE_VS_TOTAL_UPDATE') {
        updateMineaCounterUI(message.payload || {});
      }
    });

    // Expose controller globally on window for automated testing / auditor inspection
    window.findAdsController = {
      state: findAdsState,
      getSearchParams,
      updateProgressUI,
      updateMineaCounterUI,
      smartRound,
      formatNumberWithoutDecimals,
      formatNumberCompact,
      renderAdCard,
      renderCompactAdRow,
      renderCurrentFindAdsPage,
      updatePaginationBarUI,
      formatAdToInoteText,
      formatAllAdsToInoteText,
      clearResults
    };
  }

  init();
  initFindAdsTab();
});
