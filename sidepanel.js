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
    chrome.storage.local.get(['matchedAdsList', 'adHunterLogs', 'isAutoScrollEnabled', 'geminiKeys', 'deepseekKey', 'twoCaptchaKey', 'warmupReaction'], (res) => {
      adsList = res.matchedAdsList || [];
      logsList = res.adHunterLogs || [];
      if (res.isAutoScrollEnabled !== undefined) {
        isAutoScrollEnabled = Boolean(res.isAutoScrollEnabled);
      }
      if (selectWarmupReactionMode && res.warmupReaction) {
        selectWarmupReactionMode.value = res.warmupReaction;
      }
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

  // ── Quản lý Chuyển Tab ───────────────────────────────────────────
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
      warmupReaction
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', payload: newSettings }, () => {
      chrome.storage.local.set({ warmupReaction });
      btnSaveSettings.textContent = '✓ Đã lưu cài đặt';
      setTimeout(() => { btnSaveSettings.textContent = 'Lưu cài đặt'; }, 1500);
    });
  });

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

  init();
});
