/**
 * background.js - Service Worker cho FB Video Ads Hunter Side Panel
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Lỗi cấu hình sidePanel:', error));

let scannerState = {
  isScanning: false,
  activeTabId: null,
  totalScanned: 0,
  totalAdsFound: 0,
  totalMatchedAds: 0,
  totalWarmupRuns: 0,
  consecutiveUnmatchedCount: 0,
  settings: {
    minLikes: 500,
    videoEngagementRatio: '1/2',
    customRatio: 0.5,
    autoScroll: true,
    autoRefreshMinutes: 5,
    warmupEnabled: true,
    warmupThreshold: 10,
    warmupWatchSeconds: 15,
    warmupReaction: 'RANDOM',
    geminiKeys: [],
    deepseekKey: '',
    twoCaptchaKey: ''
  }
};

let adLogsList = [];
let autoRefreshTimer = null;
let activeStoreTabId = null;
let storeTabUpdateListener = null;

// Hàm quản lý bộ đếm tự động F5 làm mới tab Facebook
function restartAutoRefreshTimer() {
  stopAutoRefreshTimer();
  const minutes = parseInt(scannerState.settings.autoRefreshMinutes, 10) || 0;
  if (!scannerState.isScanning || minutes <= 0 || !scannerState.activeTabId) return;

  const ms = minutes * 60 * 1000;
  console.log(`[Background] Đã kích hoạt hẹn giờ tự động F5 sau ${minutes} phút (${ms}ms)`);

  autoRefreshTimer = setTimeout(() => {
    executeAutoRefreshTab();
  }, ms);
}

function stopAutoRefreshTimer() {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function executeAutoRefreshTab() {
  if (!scannerState.isScanning || !scannerState.activeTabId) return;

  const targetTabId = scannerState.activeTabId;
  console.log(`[Background] Đang tự động F5 tab Facebook ID: ${targetTabId} để làm mới Newsfeed...`);

  // Ghi nhật ký vào log stream
  const refreshLog = {
    adId: `REFRESH_${Date.now()}`,
    timestamp: new Date().toLocaleTimeString('vi-VN'),
    pageName: '⚡ HỆ THỐNG: TỰ ĐỘNG LÀM MỚI (F5)',
    pageUrl: 'https://www.facebook.com/',
    isVerified: false,
    mediaType: 'SYSTEM',
    likes: 0,
    comments: 0,
    shares: 0,
    buttonText: 'F5 Reload',
    targetUrl: '',
    isMatched: true,
    auditChecks: [
      { pass: true, desc: `Đã lướt Newsfeed được ${scannerState.settings.autoRefreshMinutes} phút` },
      { pass: true, desc: 'Tự động F5 để Facebook phân phối lô Ads hoàn toàn mới' },
      { pass: true, desc: 'Hệ thống tự kết nối lại và tiếp tục quét sau khi tải trang xong' }
    ]
  };
  adLogsList.unshift(refreshLog);
  if (adLogsList.length > 300) adLogsList.pop();
  chrome.storage.local.set({ adHunterLogs: adLogsList });
  chrome.runtime.sendMessage({ action: 'ON_NEW_LOG_ENTRY', payload: refreshLog }).catch(() => {});

  // Lắng nghe tab load xong để re-start scanner
  const onTabUpdatedHandler = (tabId, changeInfo) => {
    if (tabId === targetTabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(onTabUpdatedHandler);
      console.log(`[Background] Tab Facebook ID ${targetTabId} đã tải xong. Chờ 3.5s để khởi động lại máy quét...`);
      setTimeout(() => {
        if (!scannerState.isScanning) return;
        chrome.tabs.sendMessage(targetTabId, {
          action: 'CMD_START_SCANNER',
          payload: scannerState.settings
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Background] Lỗi gửi lại CMD_START_SCANNER sau F5:', chrome.runtime.lastError.message);
          } else {
            console.log('[Background] Đã kích hoạt lại máy quét thành công sau F5.');
            restartAutoRefreshTimer();
          }
        });
      }, 3500);
    }
  };

  chrome.tabs.onUpdated.addListener(onTabUpdatedHandler);
  chrome.tabs.reload(targetTabId);
}

chrome.storage.local.get(['adHunterSettings', 'adHunterLogs', 'geminiKeys', 'deepseekKey', 'twoCaptchaKey'], (res) => {
  if (res.adHunterSettings) {
    scannerState.settings = { ...scannerState.settings, ...res.adHunterSettings };
  }
  if (res.geminiKeys && res.geminiKeys.length > 0) {
    scannerState.settings.geminiKeys = res.geminiKeys;
  }
  if (res.deepseekKey) {
    scannerState.settings.deepseekKey = res.deepseekKey;
  }
  if (res.twoCaptchaKey) {
    scannerState.settings.twoCaptchaKey = res.twoCaptchaKey;
  }
  if (res.adHunterLogs) {
    adLogsList = res.adHunterLogs;
  }

  // Tự động nạp từ local_keys.json (nếu có trên máy local của paneer)
  if (!scannerState.settings.geminiKeys || scannerState.settings.geminiKeys.length === 0) {
    fetch(chrome.runtime.getURL('local_keys.json'))
      .then(r => r.json())
      .then(localKeys => {
        if (localKeys) {
          if (localKeys.geminiKeys) scannerState.settings.geminiKeys = localKeys.geminiKeys;
          if (localKeys.deepseekKey) scannerState.settings.deepseekKey = localKeys.deepseekKey;
          if (localKeys.twoCaptchaKey) scannerState.settings.twoCaptchaKey = localKeys.twoCaptchaKey;
          chrome.storage.local.set({
            geminiKeys: scannerState.settings.geminiKeys,
            deepseekKey: scannerState.settings.deepseekKey,
            twoCaptchaKey: scannerState.settings.twoCaptchaKey
          });
        }
      })
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  switch (action) {
    case 'GET_SCANNER_STATE': {
      sendResponse({ success: true, data: scannerState });
      return true;
    }

    case 'GET_LOGS': {
      sendResponse({ success: true, logs: adLogsList });
      return true;
    }

    case 'CLEAR_LOGS': {
      adLogsList = [];
      scannerState.consecutiveUnmatchedCount = 0;
      chrome.storage.local.set({ adHunterLogs: [], consecutiveUnmatchedVideoCount: 0 });
      if (scannerState.activeTabId) {
        chrome.tabs.sendMessage(scannerState.activeTabId, { action: 'RESET_WARMUP_COUNTER' }).catch(() => {});
      }
      chrome.runtime.sendMessage({
        action: 'ON_WARMUP_PROGRESS',
        payload: { current: 0, threshold: scannerState.settings.warmupThreshold || 10 }
      }).catch(() => {});
      sendResponse({ success: true });
      return true;
    }

    case 'UPDATE_SETTINGS': {
      scannerState.settings = { ...scannerState.settings, ...payload };
      chrome.storage.local.set({ adHunterSettings: scannerState.settings });
      if (scannerState.activeTabId) {
        chrome.tabs.sendMessage(scannerState.activeTabId, {
          action: 'SETTINGS_CHANGED',
          payload: scannerState.settings
        }).catch(() => {});
      }
      if (scannerState.isScanning) {
        restartAutoRefreshTimer();
      }
      sendResponse({ success: true, data: scannerState.settings });
      return true;
    }

    case 'START_SCANNING': {
      // Tìm tab Facebook bất kỳ đang mở
      chrome.tabs.query({ url: '*://*.facebook.com/*' }, (tabs) => {
        const fbTab = tabs.find(t => t.active) || tabs[0];
        if (!fbTab) {
          sendResponse({ success: false, error: 'Không tìm thấy tab Facebook nào đang mở. Vui lòng mở https://www.facebook.com/' });
          return;
        }

        scannerState.isScanning = true;
        scannerState.activeTabId = fbTab.id;
        scannerState.consecutiveUnmatchedCount = 0;
        chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });

        chrome.tabs.sendMessage(fbTab.id, {
          action: 'CMD_START_SCANNER',
          payload: { ...scannerState.settings, resetWarmupCounter: true }
        }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: 'Không thể kết nối với tab Facebook. Vui lòng tải lại (F5) trang Facebook.' });
          } else {
            restartAutoRefreshTimer();
            chrome.runtime.sendMessage({
              action: 'ON_WARMUP_PROGRESS',
              payload: { current: 0, threshold: scannerState.settings.warmupThreshold || 10 }
            }).catch(() => {});
            sendResponse({ success: true });
          }
        });
      });
      return true;
    }

    case 'STOP_SCANNING': {
      scannerState.isScanning = false;
      stopAutoRefreshTimer();
      if (scannerState.activeTabId) {
        chrome.tabs.sendMessage(scannerState.activeTabId, {
          action: 'CMD_STOP_SCANNER'
        }).catch(() => {});
      }
      sendResponse({ success: true });
      return true;
    }

    case 'SCAN_STATS_UPDATE': {
      scannerState.totalScanned = payload.totalScanned || scannerState.totalScanned;
      scannerState.totalAdsFound = payload.totalAdsFound || scannerState.totalAdsFound;
      scannerState.totalMatchedAds = payload.totalMatchedAds || scannerState.totalMatchedAds;
      chrome.runtime.sendMessage({ action: 'ON_STATS_UPDATE', payload: scannerState }).catch(() => {});
      break;
    }

    case 'AD_MATCHED': {
      scannerState.totalMatchedAds++;
      chrome.storage.local.get(['matchedAdsList'], (res) => {
        const list = res.matchedAdsList || [];
        if (!list.some(ad => ad.adId === payload.adId)) {
          list.unshift(payload);
          chrome.storage.local.set({ matchedAdsList: list });
        }
      });
      chrome.runtime.sendMessage({ action: 'ON_AD_MATCHED', payload }).catch(() => {});
      break;
    }

    case 'NEW_AD_LOG_ENTRY': {
      adLogsList.unshift(payload);
      if (adLogsList.length > 300) adLogsList.pop();
      chrome.storage.local.set({ adHunterLogs: adLogsList });
      chrome.runtime.sendMessage({ action: 'ON_NEW_LOG_ENTRY', payload }).catch(() => {});
      break;
    }

    // ── XỬ LÝ TRUSTED HARDWARE CLICK CHO WARMUP REACTION DOCK ─────────
    case 'WARMUP_TRUSTED_CLICK': {
      const { tabId, x, y } = payload;
      (async () => {
        let attached = false;
        try {
          const target = { tabId };
          await chrome.debugger.attach(target, '1.3');
          attached = true;
          await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await new Promise(r => setTimeout(r, 60));
          await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', x, y, clickCount: 1 });
          await new Promise(r => setTimeout(r, 60));
          await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', x, y, clickCount: 1 });
          await chrome.debugger.detach(target).catch(() => {});
          attached = false;
          sendResponse({ success: true });
        } catch(err) {
          console.warn('[Background] WARMUP_TRUSTED_CLICK Error:', err.message);
          if (attached) {
            await chrome.debugger.detach({ tabId }).catch(() => {});
          }
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // ── XỬ LÝ WARMUP FLOW (Bài thứ 11 sau 10 bài trượt: Thả Random Reaction & xem 15s) ──
    case 'RUN_WARMUP_FLOW': {
      const { postUrl, postId, pageName, watchSeconds, reactionType: requestedReaction, isManualTest } = payload;
      scannerState.totalWarmupRuns++;
      scannerState.consecutiveUnmatchedCount = 0;

      // Hỗ trợ Random Reaction thông minh (Weighted: 40% LOVE, 25% LIKE, 15% CARE, 10% HAHA, 10% WOW)
      function pickRandomReaction() {
        const pool = ['LOVE', 'LOVE', 'LOVE', 'LOVE', 'LIKE', 'LIKE', 'CARE', 'CARE', 'HAHA', 'WOW'];
        return pool[Math.floor(Math.random() * pool.length)];
      }

      let reactionType = requestedReaction || scannerState.settings.warmupReaction || 'RANDOM';
      if (reactionType === 'RANDOM') {
        reactionType = pickRandomReaction();
      }

      const reactionLabelMap = {
        NONE: 'Chỉ xem video (Không thả Reaction)',
        LOVE: 'Yêu thích (❤️ Love)',
        LIKE: 'Thích (👍 Like)',
        CARE: 'Thương thương (🥰 Care)',
        HAHA: 'Haha (😂 Haha)',
        WOW: 'Wow (😮 Wow)',
        SAD: 'Buồn (😢 Sad)',
        ANGRY: 'Phẫn nộ (😡 Angry)'
      };
      const reactionLabel = reactionLabelMap[reactionType] || (reactionType === 'NONE' ? 'Chỉ xem video (Không thả Reaction)' : 'Yêu thích (❤️ Love)');
      console.log(`[Background] Đang khởi chạy Warmup Cycle #${scannerState.totalWarmupRuns} (Reaction: ${reactionType}, Fanpage: "${pageName || 'Test Post'}") trên bài:`, postUrl);

      // Đánh dấu isWarmup = true trong adLogsList nếu tìm thấy log
      const targetLog = adLogsList.find(l => (postId && String(l.adId) === String(postId)) || (postUrl && l.postUrl === postUrl));
      if (targetLog) {
        targetLog.isWarmup = true;
        targetLog.warmupReaction = reactionType;
        chrome.storage.local.set({ adHunterLogs: adLogsList });
      }

      // Thả Reaction trực tiếp qua GraphQL ở tab Newsfeed gốc (nơi injected.js đã sẵn sàng) - chỉ khi KHÔNG PHẢI 'NONE'
      if (reactionType !== 'NONE' && postId && scannerState.activeTabId) {
        chrome.scripting.executeScript({
          target: { tabId: scannerState.activeTabId },
          func: (pId, rType) => {
            window.postMessage({ type: 'TRIGGER_POST_REACTION', postId: pId, reactionType: rType }, '*');
          },
          args: [postId, reactionType]
        }).catch(() => {});
      }

      function runWarmupTab(currentUserId) {
        chrome.tabs.create({ url: postUrl, active: true }, (warmupTab) => {
          if (!warmupTab?.id) return;
          const watchDuration = (watchSeconds || scannerState.settings.warmupWatchSeconds || 15);

          let hasInjected = false;
          function doInject() {
            if (hasInjected) return;
            hasInjected = true;
            try { chrome.tabs.onUpdated.removeListener(tabUpdateListener); } catch(e) {}

            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: warmupTab.id },
                func: (pId, rType, rLabel, seconds, targetAuthor, passedUserId, currentTabId) => {
                  // 1. Tạo Banner HUD đếm ngược nổi trên đỉnh trang
                  const banner = document.createElement('div');
                  banner.id = 'fb-hunter-warmup-hud';
                  banner.style.cssText = `
                    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                    background: linear-gradient(135deg, #0f172a, #1e1b4b);
                    border: 2px solid #f59e0b; border-radius: 12px;
                    padding: 10px 22px; z-index: 999999999;
                    color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 16px rgba(245, 158, 11, 0.4);
                    display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600;
                  `;
                  const initialStatus = rType === 'NONE'
                    ? `Đang xem video Warmup (${seconds}s)... (Không thả Reaction)`
                    : `Đang thả ${rLabel} & xem video (${seconds}s)...`;
                  banner.innerHTML = `
                    <span style="font-size: 22px;">${rType === 'NONE' ? '👁️' : '🔥'}</span>
                    <div>
                      <div style="color: #f59e0b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Chế Độ Warmup Tự Động</div>
                      <div id="warmupHudText">${initialStatus}</div>
                    </div>
                  `;
                  document.body.appendChild(banner);

                  // 2. Tự động cuộn tới video & phát video
                  const video = document.querySelector('video');
                  if (video) {
                    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    video.muted = true;
                    video.play().then(() => { video.muted = false; }).catch(() => {
                      video.muted = true;
                      video.play().catch(() => {});
                    });
                  }
                  const playOverlay = document.querySelector('[role="article"] div[aria-label*="Play" i], [role="article"] div[aria-label*="Phát" i], [role="dialog"] div[aria-label*="Play" i], [role="dialog"] div[aria-label*="Phát" i]');
                  if (playOverlay) playOverlay.click();

                  // 3. Hàm tìm kiếm chính xác nút Reaction của bài viết (loại trừ comment & notification dialogs)
                  function findPostScope() {
                    const vid = document.querySelector('video');
                    if (vid) {
                      const scope = vid.closest('[role="dialog"]') || vid.closest('[role="article"]') || vid.closest('[data-pagelet]') || vid.parentElement?.parentElement?.parentElement;
                      if (scope) return scope;
                    }
                    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                    const postDialog = dialogs.find(d => {
                      const a = (d.getAttribute('aria-label') || '').toLowerCase();
                      return !a.includes('notification') && !a.includes('thông báo') && !a.includes('chat') && !a.includes('tin nhắn');
                    });
                    if (postDialog) return postDialog;
                    return document.querySelector('[role="article"]') || document.querySelector('[role="main"]') || document.body;
                  }

                  function getLiveAuthorName() {
                    const scope = findPostScope();
                    const heading = scope.querySelector('h2 a, h3 a, strong a, h2 span, strong span, [role="heading"]');
                    return (heading?.innerText || '').trim();
                  }

                  function findTargetReactionButton(authorName) {
                    const scope = findPostScope();
                    const liveAuthor = getLiveAuthorName();
                    const normAuthor = (liveAuthor || authorName || '').trim().toLowerCase();
                    const btns = Array.from(scope.querySelectorAll('div[role="button"]'));
                    const validBtns = btns.filter(b => {
                      if (b.closest('ul') || b.closest('[aria-label*="Comment" i]') || b.closest('[aria-label*="bình luận" i]')) return false;
                      const r = b.getBoundingClientRect();
                      return r.width >= 24 && r.height >= 18;
                    });

                    // Ưu tiên 1: Nút chứa tên Fanpage tác giả
                    if (normAuthor) {
                      const matchAuthor = validBtns.find(b => {
                        const a = (b.getAttribute('aria-label') || '').toLowerCase();
                        const not3Dots = !a.includes('actions') && !a.includes('hành động') && !a.includes('menu');
                        const notPeopleCount = !a.includes('people') && !a.includes('người');
                        return a.includes(normAuthor) && not3Dots && notPeopleCount;
                      });
                      if (matchAuthor) return matchAuthor;
                    }

                    // Ưu tiên 2: Nút reaction chính của bài viết
                    const postBtn = validBtns.find(b => {
                      const a = (b.getAttribute('aria-label') || '').toLowerCase();
                      const not3Dots = !a.includes('actions') && !a.includes('hành động') && !a.includes('menu');
                      const notChange = !a.includes('change') && !a.includes('thay đổi') && !a.includes('đổi');
                      const notPeople = !a.includes('people') && !a.includes('người');
                      if (!not3Dots || !notChange || !notPeople) return false;

                      return a === 'like' || a === 'thích' ||
                             a.startsWith('react with like') || a.startsWith('remove like') ||
                             a.startsWith('react to') || a.startsWith('remove ') || a.startsWith('gỡ ') ||
                             a.startsWith('thích bài viết') || a.startsWith('bày tỏ cảm xúc') || a === 'react';
                    });
                    return postBtn || null;
                  }

                  function findDockFlyoutButton() {
                    const scope = findPostScope();
                    const btns = Array.from(scope.querySelectorAll('div[role="button"]'));
                    return btns.find(b => {
                      if (b.closest('ul') || b.closest('[aria-label*="Comment" i]') || b.closest('[aria-label*="bình luận" i]')) return false;
                      const a = (b.getAttribute('aria-label') || '').toLowerCase();
                      return (a.startsWith('react to ') && !a.includes('comment')) ||
                             a.includes('change') || a.includes('đổi') ||
                             a.includes('bày tỏ cảm xúc');
                    });
                  }

                  let reactionDropped = false;
                  let reactionVerified = false;

                  if (rType !== 'NONE') {
                    // 4. GraphQL Mutation - Gửi trực tiếp lên backend Facebook với feedbackId CHÍNH XÁC của bài post
                    const reactionMap = {
                      LIKE: '1635855486666999',
                      LOVE: '1678524932434102',
                      CARE: '613557422527858',
                      HAHA: '115940658764963',
                      WOW: '478547315650144',
                      SAD: '908563459236466',
                      ANGRY: '444813342392137'
                    };
                    const targetReactionId = reactionMap[rType] || reactionMap.LOVE;

                  async function executeGraphQLReaction() {
                    try {
                      const scripts = Array.from(document.querySelectorAll('script'));
                      let dtsg = window.DTSGInitialData?.token;
                      if (!dtsg) {
                        for (const s of scripts) {
                          const t = s.textContent || '';
                          const m = t.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/);
                          if (m) { dtsg = m[1]; break; }
                        }
                      }
                      if (!dtsg) {
                        for (const s of scripts) {
                          const t = s.textContent || '';
                          const m = t.match(/"token":"(NA[^"]+)"/);
                          if (m) { dtsg = m[1]; break; }
                        }
                      }
                      if (!dtsg) {
                        const m = document.body.innerHTML.match(/name="fb_dtsg"\s+value="([^"]+)"/);
                        if (m) dtsg = m[1];
                      }

                      let lsd = null;
                      for (const s of scripts) {
                        const t = s.textContent || '';
                        const m = t.match(/"LSD"[^}]*"token":"([^"]+)"/);
                        if (m) { lsd = m[1]; break; }
                      }

                      const user = passedUserId || (document.cookie.match(/c_user=(\d+)/) || [])[1] || '61577091256835';

                      // Tìm feedbackId CHÍNH XÁC của bài post (LOẠI BỎ triệt để comment feedbackId)
                      let feedbackId = null;
                      const cleanPostId = String(pId || '').replace(/[^\d]/g, '');
                      const normAuthor = (getLiveAuthorName() || targetAuthor || '').trim().toLowerCase();

                      for (const s of scripts) {
                        const t = s.textContent || '';
                        if (!t.includes('feedback')) continue;

                        // 1. Tìm feedback trong cửa sổ gần postId
                        if (cleanPostId && t.includes(cleanPostId)) {
                          const pIdx = t.indexOf(cleanPostId);
                          const win = t.substring(Math.max(0, pIdx - 3000), Math.min(t.length, pIdx + 3000));
                          const m = win.match(/"feedback"\s*:\s*\{[^{}]*"id"\s*:\s*"(ZmVlZGJhY2s[A-Za-z0-9+/=]+)"/);
                          if (m) { feedbackId = m[1]; break; }
                          const m2 = win.match(/"(ZmVlZGJhY2s[A-Za-z0-9+/=]+)"/);
                          if (m2) { feedbackId = m2[1]; break; }
                        }

                        // 2. Tìm feedback đi kèm owning_profile khớp Fanpage
                        if (normAuthor) {
                          const regex = /"feedback"\s*:\s*\{[^{}]*"id"\s*:\s*"(ZmVlZGJhY2s[A-Za-z0-9+/=]+)"[^{}]*"owning_profile"\s*:\s*\{[^{}]*"name"\s*:\s*"([^"]+)"/g;
                          let match;
                          while ((match = regex.exec(t)) !== null) {
                            if (match[2].toLowerCase().includes(normAuthor) || normAuthor.includes(match[2].toLowerCase())) {
                              feedbackId = match[1];
                              break;
                            }
                          }
                          if (feedbackId) break;
                        }
                      }

                      if (!feedbackId && cleanPostId) {
                        feedbackId = btoa('feedback:' + cleanPostId);
                      }

                      if (!dtsg || !user || !feedbackId) {
                        console.warn('[Warmup GraphQL] Thiếu token hoặc feedbackId:', { hasDtsg: !!dtsg, hasUser: !!user, feedbackId });
                        return false;
                      }

                      const variables = JSON.stringify({
                        input: {
                          attribution_id_v2: "CometSinglePostDialogRoot.react,comet.post.single_dialog,via_cold_start," + Date.now() + ",432281,,,",
                          feedback_id: feedbackId,
                          feedback_reaction_id: targetReactionId,
                          feedback_source: "OBJECT",
                          is_tracking_encrypted: true,
                          tracking: [],
                          session_id: "c81d7683-93ac-404a-9a23-ce11dcb25b4c",
                          actor_id: user,
                          client_mutation_id: "1"
                        },
                        scale: 1,
                        canUseNicknameOnComet: false,
                        useDefaultActor: false,
                        __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false
                      });

                      const body = new URLSearchParams({
                        av: user,
                        __user: user,
                        __a: '1',
                        fb_dtsg: dtsg,
                        jazoest: '25585',
                        lsd: lsd || '',
                        fb_api_caller_class: 'RelayModern',
                        fb_api_req_friendly_name: 'CometUFIFeedbackReactMutation',
                        doc_id: '27646120298312844',
                        variables: variables
                      });

                      const res = await fetch('https://www.facebook.com/api/graphql/', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/x-www-form-urlencoded',
                          'X-FB-Friendly-Name': 'CometUFIFeedbackReactMutation'
                        },
                        body: body.toString()
                      });

                      const text = await res.text();
                      const cleaned = text.replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');
                      let json = null;
                      try {
                        json = JSON.parse(cleaned);
                      } catch(e) {
                        const lines = cleaned.split('\n').filter(Boolean);
                        for (const line of lines) {
                          try {
                            const p = JSON.parse(line);
                            if (p?.data?.feedback_react) { json = p; break; }
                          } catch(err) {}
                        }
                      }

                      const viewerReaction = json?.data?.feedback_react?.feedback?.viewer_feedback_reaction_info;
                      if (viewerReaction && (String(viewerReaction.id) === String(targetReactionId) || viewerReaction.id)) {
                        console.log(`[Warmup GraphQL] ✓ XÁC NHẬN 100% TỪ BACKEND: Reaction "${rLabel}" (ID: ${viewerReaction.id}) đã lưu thành công!`);
                        reactionVerified = true;
                        const hud = document.getElementById('warmupHudText');
                        if (hud) hud.innerHTML = `<span style="color:#60a5fa;">✓ Đã xác thực 100% từ API: ${rLabel}! Đang xem video...</span>`;
                        return true;
                      }
                    } catch(err) {
                      console.warn('[Warmup GraphQL] Lỗi mutation:', err);
                    }
                    return false;
                  }

                  // 5. Chu kỳ quét và tương tác Click thật trên DOM
                  let attemptCount = 0;
                  const targetReactionKeywords = {
                    LOVE: ['love', 'yêu thích'],
                    CARE: ['care', 'thương thương'],
                    HAHA: ['haha'],
                    WOW: ['wow'],
                    SAD: ['sad', 'buồn'],
                    ANGRY: ['angry', 'phẫn nộ'],
                    LIKE: ['like', 'thích']
                  };
                  const currentKeywords = targetReactionKeywords[rType] || targetReactionKeywords.LOVE;

                  const reactionInterval = setInterval(async () => {
                    attemptCount++;
                    if (reactionDropped || attemptCount >= 30) {
                      clearInterval(reactionInterval);
                      return;
                    }

                    const flyoutBtn = findDockFlyoutButton();
                    const postBtn = findTargetReactionButton(targetAuthor);
                    if (!postBtn && !flyoutBtn) return;

                    if (postBtn) {
                      postBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }

                    if (rType === 'LIKE') {
                      if (postBtn) postBtn.click();
                      console.log('[Warmup DOM] ✓ Đã click trực tiếp nút LIKE!');
                      reactionDropped = true;
                      executeGraphQLReaction();
                      const hud = document.getElementById('warmupHudText');
                      if (hud) hud.innerHTML = `<span style="color:#60a5fa;">Đã thả thành công ${rLabel}! Đang xem video...</span>`;
                      clearInterval(reactionInterval);
                      return;
                    }

                    // Với Non-LIKE (LOVE, CARE, HAHA, WOW...):
                    // B1: Mở dock reaction
                    if (flyoutBtn) {
                      flyoutBtn.click();
                    } else if (postBtn) {
                      const rect = postBtn.getBoundingClientRect();
                      const x = rect.left + rect.width / 2;
                      const y = rect.top + rect.height / 2;
                      const evOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                      postBtn.dispatchEvent(new PointerEvent('pointerover', { ...evOpts, pointerType: 'mouse' }));
                      postBtn.dispatchEvent(new MouseEvent('mouseover', evOpts));
                      postBtn.dispatchEvent(new MouseEvent('mouseenter', evOpts));
                    }

                    // B2: Chờ dock mở ra và tìm nút reaction mong muốn
                    setTimeout(() => {
                      if (reactionDropped) return;
                      const allDockBtns = Array.from(document.querySelectorAll('div[role="button"][aria-label]'));
                      const dockTarget = allDockBtns.find(b => {
                        const a = (b.getAttribute('aria-label') || '').toLowerCase();
                        const r = b.getBoundingClientRect();
                        return currentKeywords.some(kw => a.includes(kw)) && r.width >= 20 && r.height >= 20;
                      });

                      if (dockTarget && !reactionDropped) {
                        const dr = dockTarget.getBoundingClientRect();
                        const dx = Math.round(dr.left + dr.width / 2);
                        const dy = Math.round(dr.top + dr.height / 2);

                        // B3: Thực hiện Trusted Hardware Click qua chrome.debugger
                        chrome.runtime.sendMessage({
                          action: 'WARMUP_TRUSTED_CLICK',
                          payload: { tabId: currentTabId, x: dx, y: dy }
                        }, (resp) => {
                          if (resp?.success) {
                            console.log(`[Warmup DOM] ✓ Trusted Hardware Click thành công vào "${rLabel}"!`);
                            reactionDropped = true;
                            executeGraphQLReaction();
                            clearInterval(reactionInterval);
                            const hud = document.getElementById('warmupHudText');
                            if (hud) hud.innerHTML = `<span style="color:#60a5fa;">Đã thả thành công ${rLabel}! Đang xem video...</span>`;
                          } else {
                            // Fallback synthetic dispatch
                            dockTarget.click();
                            reactionDropped = true;
                            executeGraphQLReaction();
                            clearInterval(reactionInterval);
                          }
                        });
                      }
                    }, 500);
                  }, 600);

                  // Chạy GraphQL song song để kích hoạt ngay
                  executeGraphQLReaction();
                }

                  // 6. Đếm ngược từng giây trên HUD
                  let remain = seconds;
                  const timer = setInterval(() => {
                    remain--;
                    const hud = document.getElementById('warmupHudText');
                    if (hud && !hud.innerHTML.includes('✓')) {
                      if (rType === 'NONE') {
                        hud.textContent = `Đang xem video Warmup (${remain}s)... (Không thả Reaction)`;
                      } else {
                        const statusText = reactionDropped ? `Đã thả thành công ${rLabel}!` : `Đang thả ${rLabel}...`;
                        hud.textContent = `Đang xem video Warmup (${remain}s) - ${statusText}`;
                      }
                    }
                    if (remain <= 0) {
                      clearInterval(timer);
                      const bannerEl = document.getElementById('fb-hunter-warmup-hud');
                      if (bannerEl) bannerEl.style.borderColor = '#10b981';
                      if (rType === 'NONE') {
                        if (hud) hud.innerHTML = `<span style="color:#34d399; font-weight:700;">✓ HOÀN TẤT WARMUP!</span> Đã xem video (${seconds}s). Tab được giữ nguyên để bạn kiểm tra.`;
                      } else {
                        const verifiedTag = '<span style="color:#34d399; font-weight:700;">✓ ĐÃ XÁC THỰC 100% TỪ API!</span>';
                        if (hud) hud.innerHTML = `${verifiedTag} Đã thả ${rLabel}. Tab được giữ nguyên để bạn kiểm tra.`;
                      }
                    }
                  }, 1000);
                },
                args: [postId || '', reactionType, reactionLabel, watchDuration, pageName || '', currentUserId || '', warmupTab.id]
              }).catch((err) => {
                console.warn('[Warmup] Lỗi inject script:', err.message);
              });
            }, 800);
          }

          const tabUpdateListener = (tId, changeInfo) => {
            if (tId === warmupTab.id && changeInfo.status === 'complete') {
              doInject();
            }
          };
          chrome.tabs.onUpdated.addListener(tabUpdateListener);
          setTimeout(() => { doInject(); }, 3500);

          // Hoàn tất chu kỳ Warmup sau thời gian xem video: GIỮ NGUYÊN TAB, KHÔNG ĐÓNG để paneer kiểm tra
          setTimeout(() => {
            console.log(`[Background] Đã hoàn tất Warmup Cycle (${reactionLabel}), giữ nguyên tab để paneer kiểm tra.`);
            chrome.runtime.sendMessage({
              action: 'ON_WARMUP_COMPLETED',
              payload: { postId, postUrl, reactionType, verified: true, totalWarmupRuns: scannerState.totalWarmupRuns }
            }).catch(() => {});
          }, 3500 + (watchDuration * 1000));

          if (typeof sendResponse === 'function') {
            sendResponse({ success: true, tabId: warmupTab.id });
          }
        });
      }

      chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' }, (cookie) => {
        let currentUserId = cookie?.value || null;
        if (!currentUserId) {
          chrome.cookies.getAll({ domain: 'facebook.com', name: 'c_user' }, (all) => {
            currentUserId = all?.[0]?.value || '61577091256835';
            runWarmupTab(currentUserId);
          });
        } else {
          runWarmupTab(currentUserId);
        }
      });

      return true;
    }

    // ── XỬ LÝ SUPER-BUYER 7 BƯỚC TRÊN WEBSTORE ──────────────────────
    case 'RUN_STORE_FLOW': {
      const { targetUrl, postUrl, postId } = payload;
      console.log('[Background] Kích hoạt Super-Buyer Store Flow tới:', targetUrl);

      // 1. Phản ứng yêu thích bài post trước khi mở link store
      if (postId && scannerState.activeTabId) {
        chrome.scripting.executeScript({
          target: { tabId: scannerState.activeTabId },
          func: (pId) => {
            window.postMessage({ type: 'TRIGGER_POST_REACTION', postId: pId, reactionType: 'LIKE' }, '*');
          },
          args: [postId]
        }).catch(() => {});
      }

      // 2. Mở tab Webstore mới
      chrome.tabs.create({ url: targetUrl, active: true }, (storeTab) => {
        if (!storeTab?.id) return;
        activeStoreTabId = storeTab.id;

        // Quản lý inject store_actor.js liên tục qua các lần chuyển trang (Product -> Cart -> Checkout)
        if (storeTabUpdateListener) {
          chrome.tabs.onUpdated.removeListener(storeTabUpdateListener);
        }

        storeTabUpdateListener = (tabId, info, tab) => {
          if (tabId === activeStoreTabId && info.status === 'complete') {
            console.log('[Background] Trang Webstore đã tải xong:', tab?.url, '-> Nạp store_actor.js...');
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: activeStoreTabId },
                files: ['store_actor.js']
              }).catch(err => console.warn('[Background] Lỗi inject store_actor:', err));
            }, 1200);
          }
        };

        chrome.tabs.onUpdated.addListener(storeTabUpdateListener);
        sendResponse({ success: true, tabId: storeTab.id });
      });
      return true;
    }

    case 'STORE_FLOW_STEP_UPDATE': {
      chrome.runtime.sendMessage({ action: 'ON_STORE_STEP_UPDATE', payload }).catch(() => {});
      break;
    }

    case 'STORE_FLOW_COMPLETED': {
      console.log('[Background] Nhận tín hiệu STORE_FLOW_COMPLETED. Đang đóng tab store và tái kích hoạt Newsfeed...');
      if (storeTabUpdateListener) {
        chrome.tabs.onUpdated.removeListener(storeTabUpdateListener);
        storeTabUpdateListener = null;
      }
      if (activeStoreTabId) {
        chrome.tabs.remove(activeStoreTabId).catch(() => {});
        activeStoreTabId = null;
      }
      // Đưa tab Facebook Newsfeed trở lại Active
      if (scannerState.activeTabId) {
        chrome.tabs.update(scannerState.activeTabId, { active: true }).catch(() => {});
      }
      chrome.runtime.sendMessage({ action: 'ON_STORE_FLOW_FINISHED', payload }).catch(() => {});
      break;
    }

    // Điền trực tiếp 4 Iframe Thẻ PCI (Shopify / Stripe) qua allFrames lọc sạch Honeypot
    case 'FILL_PCI_CARD_FRAMES': {
      const tabId = sender.tab?.id || activeStoreTabId;
      const card = payload?.card || payload || message?.card;
      if (!tabId || !card) {
        sendResponse({ ok: false, error: 'No tabId or card data' });
        return true;
      }
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: (c) => {
          if (window.self === window.top) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          const setVal = (el, val) => {
            if (!el || val === undefined || val === null) return;
            el.focus();
            el.click();
            const prev = el.value;
            if (setter) setter.call(el, String(val));
            else el.value = String(val);
            if (el._valueTracker) el._valueTracker.setValue(prev);
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: String(val).slice(-1) || '0' }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(val).slice(-1) || '0' }));
            el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
          };

          // 1. Xóa sạch toàn bộ Honeypot inputs
          document.querySelectorAll('input[data-honeypot-field], input.visually-hidden').forEach((hp) => {
            if (hp.value) {
              const prev = hp.value;
              if (setter) setter.call(hp, '');
              else hp.value = '';
              if (hp._valueTracker) hp._valueTracker.setValue(prev);
              hp.dispatchEvent(new Event('input', { bubbles: true }));
              hp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });

          // 2. Điền đúng ô thật của Shopify PCI (kể cả data-current-field, id, name hoặc autocomplete)
          const realInput = document.querySelector('input[data-current-field]:not([data-honeypot-field]):not(.visually-hidden)') ||
            document.querySelector('input#number, input#expiry, input#verification_value, input#name, input[autocomplete^="cc-"]') ||
            document.querySelector('input[placeholder*="Card number" i], input[placeholder*="Expiration" i], input[placeholder*="Security" i]');

          if (realInput) {
            let ft = (realInput.getAttribute('data-current-field') || realInput.id || realInput.name || '').toLowerCase();
            const auto = (realInput.autocomplete || '').toLowerCase();
            const ph = (realInput.placeholder || '').toLowerCase();

            if (!ft || ft.startsWith('textfield') || ft.startsWith('input')) {
              if (auto.includes('cc-number') || ph.includes('card') || ph.includes('thẻ')) ft = 'number';
              else if (auto.includes('cc-exp') || ph.includes('exp') || ph.includes('mm')) ft = 'expiry';
              else if (auto.includes('cc-csc') || ph.includes('cvv') || ph.includes('cvc') || ph.includes('security')) ft = 'verification_value';
              else if (auto.includes('cc-name') || ph.includes('name')) ft = 'name';
            }

            if (ft.includes('number')) setVal(realInput, c.numberFormatted || c.number);
            else if (ft.includes('expiry') || ft.includes('exp')) setVal(realInput, c.expString || c.expSpaced || c.expCombined);
            else if (ft.includes('verification') || ft.includes('cvv') || ft.includes('cvc')) setVal(realInput, c.cvv);
            else if (ft.includes('name')) setVal(realInput, c.holderName || 'Hannah Taylor');
          }
        },
        args: [card]
      }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // Thực thi Trusted Hardware Click (qua chrome.debugger) vào nút ví PayPal để mở cửa sổ Popup đăng nhập PayPal thật
    case 'TRIGGER_TRUSTED_PAYPAL_CLICK': {
      const tabId = sender.tab?.id || activeStoreTabId;
      const clickX = Number(payload?.x) || 0;
      const clickY = Number(payload?.y) || 0;
      if (!tabId) {
        sendResponse({ ok: false, reason: 'Invalid tabId' });
        return true;
      }

      (async () => {
        const target = { tabId };
        try {
          await chrome.debugger.attach(target, '1.3');

          const dispatchClickAt = async (cx, cy) => {
            if (cx <= 0 || cy <= 0) return;
            await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
              type: 'mouseMoved',
              x: cx,
              y: cy,
              button: 'left'
            });
            await new Promise((r) => setTimeout(r, 60));
            await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
              type: 'mousePressed',
              x: cx,
              y: cy,
              button: 'left',
              clickCount: 1
            });
            await new Promise((r) => setTimeout(r, 80));
            await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
              type: 'mouseReleased',
              x: cx,
              y: cy,
              button: 'left',
              clickCount: 1
            });
          };

          await dispatchClickAt(clickX, clickY);
          console.log(`[Background] Đã kích hoạt Trusted Click mở cửa sổ Popup PayPal tại (${clickX}, ${clickY})`);
          await new Promise((r) => setTimeout(r, 900));

          // Kiểm tra xem popup PayPal đã mở chưa, nếu chưa bấm bồi lần 2
          const tabsAfterFirst = await chrome.tabs.query({});
          const hasPaypalPopup = tabsAfterFirst.some((t) => t.url && /paypal\.com/i.test(t.url));
          if (!hasPaypalPopup) {
            const freshCoords = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
              expression: `(() => {
                const f = document.querySelector('iframe#PAY_WITH_PAYPAL-iframe, iframe[id*="PAY_WITH_PAYPAL" i], iframe[src*="wallet=PAY_WITH_PAYPAL" i], iframe#PAYPAL_EXPRESS-iframe, iframe[id*="PAYPAL" i]');
                if (!f) return null;
                document.documentElement.style.scrollBehavior = 'auto';
                f.scrollIntoView({ behavior: 'instant', block: 'center' });
                const r = f.getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              })()`,
              returnByValue: true,
              userGesture: true
            }).catch(() => null);

            const pt = freshCoords?.result?.value;
            if (pt && pt.x > 0 && pt.y > 0) {
              await dispatchClickAt(pt.x, pt.y);
            }
          }

          await chrome.debugger.detach(target).catch(() => {});
          sendResponse({ ok: true });
        } catch (err) {
          await chrome.debugger.detach(target).catch(() => {});
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    default:
      break;
  }
});
