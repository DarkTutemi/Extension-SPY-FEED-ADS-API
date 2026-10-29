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
      chrome.storage.local.set({ adHunterLogs: [] });
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

        chrome.tabs.sendMessage(fbTab.id, {
          action: 'CMD_START_SCANNER',
          payload: scannerState.settings
        }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: 'Không thể kết nối với tab Facebook. Vui lòng tải lại (F5) trang Facebook.' });
          } else {
            restartAutoRefreshTimer();
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

    // ── XỬ LÝ WARMUP FLOW (Bài thứ 11 sau 10 bài trượt) ─────────────
    case 'RUN_WARMUP_FLOW': {
      const { postUrl, postId } = payload;
      scannerState.totalWarmupRuns++;
      scannerState.consecutiveUnmatchedCount = 0;
      console.log(`[Background] Đang khởi chạy Warmup Cycle #${scannerState.totalWarmupRuns} trên bài:`, postUrl);

      // Đánh dấu isWarmup = true trong adLogsList nếu tìm thấy log
      const targetLog = adLogsList.find(l => (postId && String(l.adId) === String(postId)) || (postUrl && l.postUrl === postUrl));
      if (targetLog) {
        targetLog.isWarmup = true;
        chrome.storage.local.set({ adHunterLogs: adLogsList });
      }

      const originalTabId = sender.tab?.id || scannerState.activeTabId;

      // 1. Mở tab nổi bật lên phía trước (active: true) để người dùng nhìn thấy tận mắt
      chrome.tabs.create({ url: postUrl, active: true }, (warmupTab) => {
        if (!warmupTab?.id) return;
        const watchDuration = (scannerState.settings.warmupWatchSeconds || 15);

        // Đợi 3.5s cho tab bài viết render xong rồi kích hoạt tương tác Warmup trực quan
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId: warmupTab.id },
            func: (pId, seconds) => {
              // A. Tạo Banner HUD đếm ngược nổi trên đầu trang
              const banner = document.createElement('div');
              banner.id = 'fb-hunter-warmup-hud';
              banner.style.cssText = `
                position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
                background: linear-gradient(135deg, #0f172a, #1e1b4b);
                border: 2px solid #f59e0b; border-radius: 12px;
                padding: 10px 20px; z-index: 9999999;
                color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 16px rgba(245, 158, 11, 0.4);
                display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 600;
              `;
              banner.innerHTML = `
                <span style="font-size: 20px;">🔥</span>
                <div>
                  <div style="color: #f59e0b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Chế Độ Warmup Tự Động</div>
                  <div id="warmupHudText">Đang bấm Thích & xem video (${seconds}s)...</div>
                </div>
              `;
              document.body.appendChild(banner);

              // B. Bấm Thích (Like) thật sự trên DOM với retry loop (chờ DOM hydrate)
              let clickAttempts = 0;
              const clickInterval = setInterval(() => {
                clickAttempts++;
                const els = Array.from(document.querySelectorAll('[aria-label*="Like" i], [aria-label*="Thích" i]'));
                
                // Kiểm tra xem bài đã được thả Like/Reaction chưa (tránh click nhầm thành gỡ like)
                const alreadyLiked = els.some(el => {
                  const label = (el.getAttribute('aria-label') || '').toLowerCase();
                  return label.includes('gỡ') || label.includes('remove') || label.includes('unlike');
                });
                if (alreadyLiked) {
                  console.log('[Warmup Actor] Bài viết đã được Thích từ trước.');
                  clearInterval(clickInterval);
                  return;
                }

                // Tìm nút Like chuẩn xác nhất trên Facebook UI (Tiếng Việt & Tiếng Anh)
                const btn = els.find(el => {
                  const role = el.getAttribute('role');
                  const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                  return role === 'button' && (label === 'like' || label === 'thích' || label.startsWith('thích') || label.startsWith('like'));
                }) || els.find(el => el.getAttribute('role') === 'button') ||
                document.querySelector('div[role="button"][aria-label="Like"], div[role="button"][aria-label="Thích"], div[role="button"][aria-label*="Thích" i]');

                if (btn) {
                  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  btn.focus();
                  ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
                    btn.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
                  });
                  btn.click();
                  console.log('[Warmup Actor] Đã click nút Like thành công trên DOM!');
                  clearInterval(clickInterval);
                } else if (clickAttempts >= 10) {
                  clearInterval(clickInterval);
                }
              }, 600);

              // C. Phát video thật sự (liên tục kiểm tra và play video khi nạp xong)
              let vidAttempts = 0;
              const vidInterval = setInterval(() => {
                vidAttempts++;
                const video = document.querySelector('video');
                const playOverlay = document.querySelector('div[aria-label*="Play" i], div[aria-label*="Phát" i], div[data-sigil="play-button"], div[role="button"][aria-label*="video" i]');
                if (playOverlay) {
                  playOverlay.click();
                }
                if (video) {
                  video.muted = true; // muted để vượt qua chính sách autoplay của Chrome
                  video.play().then(() => {
                    video.muted = false; // bật lại tiếng nếu trình duyệt cho phép
                  }).catch(() => {
                    video.muted = true;
                    video.play().catch(() => {});
                  });
                  if (!video.paused) clearInterval(vidInterval);
                }
                if (vidAttempts >= 8) clearInterval(vidInterval);
              }, 1000);

              // D. Đếm ngược từng giây trên HUD
              let remain = seconds;
              const timer = setInterval(() => {
                remain--;
                const hud = document.getElementById('warmupHudText');
                if (hud) hud.textContent = `Đang xem video Warmup (${remain}s)...`;
                if (remain <= 0) {
                  clearInterval(timer);
                  if (hud) hud.textContent = '✓ Hoàn tất Warmup! Đang quay lại Newsfeed...';
                }
              }, 1000);
            },
            args: [postId || '', watchDuration]
          }).catch(() => {});
        }, 3500);

        // Đóng tab sau thời gian xem video và trả focus về tab Newsfeed
        setTimeout(() => {
          chrome.tabs.remove(warmupTab.id).catch(() => {});
          if (originalTabId) {
            chrome.tabs.update(originalTabId, { active: true }).catch(() => {});
          }
          console.log('[Background] Đã hoàn tất Warmup Cycle, quay lại Newsfeed.');
          chrome.runtime.sendMessage({
            action: 'ON_WARMUP_COMPLETED',
            payload: { postId, postUrl, totalWarmupRuns: scannerState.totalWarmupRuns }
          }).catch(() => {});
        }, 3500 + (watchDuration * 1000));
      });
      break;
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
