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
    chrome.storage.local.get(['matchedAdsList', 'adHunterLogs', 'isAutoScrollEnabled', 'geminiKeys', 'deepseekKey', 'twoCaptchaKey'], (res) => {
      adsList = res.matchedAdsList || [];
      logsList = res.adHunterLogs || [];
      if (res.isAutoScrollEnabled !== undefined) {
        isAutoScrollEnabled = Boolean(res.isAutoScrollEnabled);
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
          ${ad.post.url ? `<a href="${escapeHTML(ad.post.url)}" target="_blank" class="btn-card-action" title="Mở bài post trên Facebook dạng story.php">FB Post</a>` : ''}
          ${ad.post.url ? `<button class="btn-card-action btn-copy-story-link" data-url="${escapeHTML(ad.post.url)}" title="Copy link bài post chuẩn story.php">Copy Post</button>` : ''}
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

  // ── TAB 2: Render Nhật Ký Quét & Audit Log Chi Tiết ────────────────
  function renderLogsList() {
    tabLogsBadge.textContent = logsList.length;

    // Lọc theo filter được chọn
    const filteredLogs = logsList.filter(log => {
      if (currentLogFilter === 'all') return true;
      const media = String(log.mediaType || '').toUpperCase();
      if (currentLogFilter === 'video') return media === 'VIDEO';
      if (currentLogFilter === 'photo') return media === 'PHOTO' || media === 'CAROUSEL';
      if (currentLogFilter === 'verified') return log.isVerified === true;
      if (currentLogFilter === 'matched') return log.isMatched === true;
      if (currentLogFilter === 'rejected') return log.isMatched === false;
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
    card.className = `log-card ${log.isMatched ? 'matched' : 'rejected'}`;

    const mediaClass = log.mediaType === 'VIDEO' ? 'video' : 'photo';
    const statusText = log.isMatched ? '✓ THỎA MÃN' : '✗ LOẠI BỎ';
    const statusClass = log.isMatched ? 'matched' : 'rejected';

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
        </div>
        <span class="log-status-pill ${statusClass}">${statusText}</span>
      </div>

      <div class="log-metrics-summary">
        <span>👍 ${(log.likes || 0).toLocaleString()}</span>
        <span>💬 ${(log.comments || 0).toLocaleString()}</span>
        <span>↗️ ${(log.shares || 0).toLocaleString()}</span>
        ${log.buttonText ? `<span style="color:#06b6d4;">[CTA: ${escapeHTML(log.buttonText)}]</span>` : ''}
      </div>

      <div class="audit-checklist">
        ${checklistHTML}
      </div>

      <div class="log-footer">
        <span>ID: ${escapeHTML(String(log.adId).substring(0, 16))}</span>
        ${log.postUrl ? `<a href="${escapeHTML(log.postUrl)}" target="_blank" style="color:#38bdf8; text-decoration:none; margin: 0 8px; font-weight:500;">[🔗 FB Story Post]</a>` : ''}
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
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logsList, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `fb_ads_hunter_logs_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  }

  function exportLogFileText() {
    let logText = `======================================================================\n`;
    logText += `   FB VIDEO ADS HUNTER - AUDIT LOGFILE\n`;
    logText += `   Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n`;
    logText += `   Tổng số Ads kiểm tra: ${logsList.length}\n`;
    logText += `======================================================================\n\n`;

    logsList.forEach((log, index) => {
      const statusStr = log.isMatched ? '[✓ THỎA MÃN ĐIỀU KIỆN]' : '[✗ BỊ LOẠI BỎ]';
      logText += `[#${index + 1}] ${log.timestamp || ''} | ${statusStr}\n`;
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
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadAnchor.setAttribute('download', `fb_ads_hunter_audit_${dateStr}.log`);
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

    const newSettings = {
      minLikes,
      videoEngagementRatio: ratio,
      autoRefreshMinutes,
      warmupEnabled,
      warmupThreshold,
      warmupWatchSeconds
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', payload: newSettings }, () => {
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

      // Nếu đang ở tab Logs, chèn ngay card log vào đầu danh sách (dòng trên cùng là mới nhất)
      const media = String(log.mediaType || '').toUpperCase();
      const matchesFilter = (
        currentLogFilter === 'all' ||
        (currentLogFilter === 'video' && media === 'VIDEO') ||
        (currentLogFilter === 'photo' && (media === 'PHOTO' || media === 'CAROUSEL')) ||
        (currentLogFilter === 'verified' && log.isVerified === true) ||
        (currentLogFilter === 'matched' && log.isMatched === true) ||
        (currentLogFilter === 'rejected' && log.isMatched === false)
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
    } else if (message.action === 'ON_STORE_STEP_UPDATE') {
      const { step, totalSteps, name, detail } = message.payload || {};
      if (statusText) {
        statusText.textContent = `[Bước ${step}/${totalSteps}] ${name}: ${detail || ''}`;
      }
    } else if (message.action === 'ON_STORE_FLOW_FINISHED') {
      if (statusText) {
        statusText.textContent = 'Hoàn tất quy trình Super-Buyer Pixel!';
        setTimeout(() => {
          statusText.textContent = isScanning ? 'Đang tự động quét & lọc Newsfeed...' : 'Hệ thống sẵn sàng';
        }, 3000);
      }
    }
  });

  init();
});
