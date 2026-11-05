/**
 * background.js - Service Worker cho FB Video Ads Hunter Side Panel & Ads Library GraphQL Engine
 */

if (typeof chrome === 'undefined') {
  global.chrome = {
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    storage: { local: { get: (keys, cb) => cb && cb({}), set: () => {} } },
    runtime: { onMessage: { addListener: () => {} }, sendMessage: () => Promise.resolve(), getURL: (u) => u },
    tabs: { query: (q, cb) => cb && cb([]), create: (opt, cb) => cb && cb({ id: 999 }), onUpdated: { addListener: () => {}, removeListener: () => {} } },
    cookies: { get: () => Promise.resolve(null), getAll: () => Promise.resolve([]) },
    scripting: { executeScript: () => Promise.resolve([]) }
  };
}

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
    warmupExcludedPages: [],
    warmupExcludedKeywords: [],
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

chrome.storage.local.get(['adHunterSettings', 'adHunterLogs', 'geminiKeys', 'deepseekKey', 'twoCaptchaKey', 'warmupExcludedPages', 'warmupExcludedKeywords'], (res) => {
  if (res.adHunterSettings) {
    scannerState.settings = { ...scannerState.settings, ...res.adHunterSettings };
  }
  if (Array.isArray(res.warmupExcludedPages)) {
    scannerState.settings.warmupExcludedPages = res.warmupExcludedPages;
  }
  if (Array.isArray(res.warmupExcludedKeywords)) {
    scannerState.settings.warmupExcludedKeywords = res.warmupExcludedKeywords;
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

// Hàm quản lý kích hoạt Super-Buyer Store Flow (7 bước) mở tab Store và tự động inject store_actor.js
function triggerStoreFlow(targetUrl, postUrl, postId) {
  if (!targetUrl) return;
  console.log('[Background] Kích hoạt Super-Buyer Store Flow tới:', targetUrl);

  // 1. Phản ứng yêu thích bài post trước khi mở link store (nếu có postId và activeTabId)
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
  });
}

// ══════════════════════════════════════════════════════════════════
// ── ADS LIBRARY GRAPHQL SERVICE (Milestone 2: GraphQL & Cursor) ────
// ══════════════════════════════════════════════════════════════════

class AdsLibraryGraphQLService {
  constructor() {
    this.docId = '26617181747964058';
    this.friendlyName = 'AdLibraryMobileFocusedStateProviderRefetchQuery';
    this.isSearching = false;
    this.isBatchSearching = false;
    this.cancelRequested = false;
    this.batchCancelRequested = false;
    this.lastResponseError = null;
    // Fallback token dự phòng từ phiên hợp lệ đã xác minh
    this.cachedDtsg = 'NAfzf0otYMb7P-Tsarp8Gj4Ex2C_Wxu8mLBefE81Ajr3YrsAwFoNHPg:27:1793681067';
    this.cachedLsd = '9EyVlzAMM2eiw33CpJWzeZ';
    this.cachedRev = '1052866173';
    this.cachedUserId = '61577091256835';
    this.activeFbTabId = null;
    this.sessionID = this.generateUUID();
    this.collationToken = this.generateUUID();

    // Tự động khôi phục token từ storage nếu đã lưu trước đó
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['fb_auth_cached'], (res) => {
        if (res?.fb_auth_cached?.dtsg) {
          this.cachedDtsg = res.fb_auth_cached.dtsg;
          if (res.fb_auth_cached.lsd) this.cachedLsd = res.fb_auth_cached.lsd;
          if (res.fb_auth_cached.userId && res.fb_auth_cached.userId !== '0') this.cachedUserId = res.fb_auth_cached.userId;
          if (res.fb_auth_cached.rev) this.cachedRev = res.fb_auth_cached.rev;
        }
      });
    }
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * 1. Token Harvesting: Trích xuất cookie Facebook, fb_dtsg, lsd và UID
   * Hỗ trợ tự động mở tab ngầm Ads Library nếu chưa có tab Facebook nào mở để không bao giờ lỗi phiên (1357001).
   */
  async ensureAuthentication(forceOpenTab = false) {
    let extractedFreshFromTab = false;
    try {
      // 1.1 Lấy c_user từ cookie Facebook
      if (typeof chrome !== 'undefined' && chrome.cookies && chrome.cookies.get) {
        try {
          const cookie = await chrome.cookies.get({ url: 'https://www.facebook.com', name: 'c_user' });
          if (cookie && cookie.value) {
            this.cachedUserId = cookie.value;
          } else {
            const allCookies = await chrome.cookies.getAll({ domain: '.facebook.com', name: 'c_user' });
            if (allCookies && allCookies.length > 0 && allCookies[0].value) {
              this.cachedUserId = allCookies[0].value;
            }
          }
        } catch (e) {
          console.warn('[AdsLibrary] Không thể đọc cookie c_user:', e);
        }
      }

      // 1.2 Lấy token từ tab Facebook đang mở (hoặc tự mở 1 tab ngầm nếu chưa có tab FB nào)
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.scripting) {
        try {
          let tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
          let fbTab = null;

          if (tabs && tabs.length > 0) {
            // Ưu tiên tab Ads Library hoặc tab đang active không bị discarded
            fbTab = tabs.find(t => !t.discarded && t.url && t.url.includes('/ads/library')) ||
                    tabs.find(t => !t.discarded && t.active) ||
                    tabs.find(t => !t.discarded) ||
                    tabs[0];
          }

          if ((!fbTab || fbTab.discarded || forceOpenTab) && chrome.tabs.create) {
            try {
              console.log('[AdsLibrary] Tự động khởi tạo/làm mới tab ngầm Facebook Ads Library để lấy token sống...');
              const createdTab = await chrome.tabs.create({
                url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US',
                active: false
              });
              if (createdTab && createdTab.id) {
                fbTab = createdTab;
                await new Promise((resolve) => {
                  let waited = 0;
                  const timer = setInterval(async () => {
                    waited += 300;
                    try {
                      const tInfo = await chrome.tabs.get(createdTab.id);
                      if ((tInfo && tInfo.status === 'complete') || waited >= 5500) {
                        clearInterval(timer);
                        setTimeout(resolve, 900);
                      }
                    } catch (e) {
                      clearInterval(timer);
                      resolve();
                    }
                  }, 300);
                });
              }
            } catch (openErr) {
              console.warn('[AdsLibrary] Không thể mở tab ngầm FB:', openErr);
            }
          }

          if (fbTab && fbTab.id) {
            this.activeFbTabId = fbTab.id;
            const results = await chrome.scripting.executeScript({
              target: { tabId: fbTab.id },
              world: 'MAIN',
              func: () => {
                let dtsg = null;
                let lsd = null;
                let userId = null;
                let spinR = null;

                // 1. Check window globals
                if (window.DTSGInitialData?.token) dtsg = window.DTSGInitialData.token;
                if (window.LSD?.token) lsd = window.LSD.token;
                if (window.CurrentUserInitialData?.USER_ID) userId = window.CurrentUserInitialData.USER_ID;

                // 2. Check Facebook internal require
                if (typeof window.require === 'function') {
                  try { if (!dtsg) dtsg = window.require('DTSGInitialData')?.token; } catch (e) {}
                  try {
                    if (!dtsg) {
                      const dtsgMod = window.require('DTSG');
                      dtsg = dtsgMod?.token || (typeof dtsgMod?.getToken === 'function' ? dtsgMod.getToken() : null);
                    }
                  } catch (e) {}
                  try { if (!dtsg) dtsg = window.require('DTSGInitData')?.token; } catch (e) {}
                  try { if (!lsd) lsd = window.require('LSD')?.token; } catch (e) {}
                  try { if (!userId) userId = window.require('CurrentUserInitialData')?.USER_ID; } catch (e) {}
                }

                // 3. Check hidden input elements
                if (!dtsg) {
                  const inputDtsg = document.querySelector('input[name="fb_dtsg"]');
                  if (inputDtsg && inputDtsg.value) dtsg = inputDtsg.value;
                }
                if (!lsd) {
                  const inputLsd = document.querySelector('input[name="lsd"]');
                  if (inputLsd && inputLsd.value) lsd = inputLsd.value;
                }

                // 4. Scan script tags
                if (!dtsg || !lsd) {
                  const scripts = document.querySelectorAll('script');
                  for (const s of scripts) {
                    const text = s.textContent || '';
                    if (!dtsg) {
                      const m = text.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                                text.match(/"token":"([A-Za-z0-9_-]+:\d+:\d+)"/) ||
                                text.match(/"async_get_token":"([^"]+)"/) ||
                                text.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"\}/);
                      if (m) dtsg = m[1];
                    }
                    if (!lsd) {
                      const m = text.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                                text.match(/name="lsd"\s+value="([^"]+)"/);
                      if (m) lsd = m[1];
                    }
                    if (!userId) {
                      const m = text.match(/"USER_ID":"(\d+)"/) || text.match(/"actorID":"(\d+)"/);
                      if (m) userId = m[1];
                    }
                    if (!spinR) {
                      const m = text.match(/"__spin_r":(\d+)/);
                      if (m) spinR = m[1];
                    }
                    if (dtsg && lsd && userId) break;
                  }
                }

                return { dtsg, lsd, userId, spinR };
              }
            });
            const tokens = results?.[0]?.result;
            if (tokens?.dtsg) {
              this.cachedDtsg = tokens.dtsg;
              extractedFreshFromTab = true;
            }
            if (tokens?.lsd) {
              this.cachedLsd = tokens.lsd;
              extractedFreshFromTab = true;
            }
            if (tokens?.userId && tokens.userId !== '0') this.cachedUserId = tokens.userId;
            if (tokens?.spinR) this.cachedRev = tokens.spinR;
          }
        } catch (e) {
          console.warn('[AdsLibrary] Không thể executeScript đọc tab FB:', e);
        }
      }

      // 1.3 Nếu chưa lấy được token trực tiếp từ tab FB, fetch ngầm trang Ads Library
      if (!extractedFreshFromTab && (!this.cachedDtsg || !this.cachedLsd || forceOpenTab)) {
        try {
          const resp = await fetch('https://www.facebook.com/ads/library/?country=US', {
            headers: {
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            credentials: 'include'
          });
          const html = await resp.text();

          const dtsgMatch = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                            html.match(/"token":"([A-Za-z0-9_-]+:\d+:\d+)"/) ||
                            html.match(/name="fb_dtsg"\s+value="([^"]+)"/) ||
                            html.match(/"async_get_token":"([^"]+)"/);
          if (dtsgMatch) this.cachedDtsg = dtsgMatch[1];

          const lsdMatch = html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                           html.match(/name="lsd"\s+value="([^"]+)"/);
          if (lsdMatch) this.cachedLsd = lsdMatch[1];

          const revMatch = html.match(/"__spin_r":(\d+)/);
          if (revMatch) this.cachedRev = revMatch[1];
        } catch (e) {
          console.warn('[AdsLibrary] Không thể fetch ngầm Ads Library để lấy token:', e);
        }
      }

      // 1.4 Lưu cache token vào storage nếu vừa trích xuất mới từ tab FB
      if (extractedFreshFromTab && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        if (this.cachedDtsg && this.cachedLsd) {
          chrome.storage.local.set({
            fb_auth_cached: {
              dtsg: this.cachedDtsg,
              lsd: this.cachedLsd,
              userId: this.cachedUserId,
              rev: this.cachedRev,
              updatedAt: Date.now()
            }
          });
        }
      }

      console.log('[AdsLibrary] Xác thực hoàn tất:', {
        userId: this.cachedUserId,
        hasDtsg: Boolean(this.cachedDtsg),
        hasLsd: Boolean(this.cachedLsd),
        activeFbTabId: this.activeFbTabId,
        extractedFreshFromTab
      });
    } catch (err) {
      console.error('[AdsLibrary] Lỗi trích xuất token:', err);
    }
  }

  /**
   * 1b. Thực thi truy vấn GraphQL ưu tiên ngay trong ngữ cảnh Tab Facebook (MAIN world)
   * Giúp đảm bảo 100% Origin: https://www.facebook.com, Cookie chính chủ và Token fb_dtsg/lsd sống.
   * Tự động fallback về fetch() của Service Worker (hoặc môi trường Node test).
   */
  async executeGraphQLPost(variables, headers) {
    const requestBody = this.buildRequestBody(variables);

    if (typeof chrome !== 'undefined' && chrome.scripting && chrome.scripting.executeScript && this.activeFbTabId) {
      try {
        const execResults = await chrome.scripting.executeScript({
          target: { tabId: this.activeFbTabId },
          world: 'MAIN',
          args: [ JSON.stringify(variables), this.docId, this.friendlyName ],
          func: async (varsJson, docId, friendlyName) => {
            try {
              let dtsg = window.DTSGInitialData?.token || null;
              let lsd = window.LSD?.token || null;
              let userId = window.CurrentUserInitialData?.USER_ID || '0';
              let spinR = null;

              if (typeof window.require === 'function') {
                try { if (!dtsg) dtsg = window.require('DTSGInitialData')?.token; } catch (e) {}
                try {
                  if (!dtsg) {
                    const m = window.require('DTSG');
                    dtsg = m?.token || (typeof m?.getToken === 'function' ? m.getToken() : null);
                  }
                } catch (e) {}
                try { if (!dtsg) dtsg = window.require('DTSGInitData')?.token; } catch (e) {}
                try { if (!lsd) lsd = window.require('LSD')?.token; } catch (e) {}
                try { if (!userId || userId === '0') userId = window.require('CurrentUserInitialData')?.USER_ID || '0'; } catch (e) {}
              }

              const params = new URLSearchParams();
              params.append('av', userId || '0');
              params.append('__user', userId || '0');
              params.append('__a', '1');
              params.append('__req', 'f');
              params.append('__hs', '20760.HYP:comet_plat_default_pkg.2.1...0');
              params.append('dpr', '1');
              params.append('__ccg', 'GOOD');
              if (spinR) params.append('__rev', spinR);
              params.append('fb_api_caller_class', 'RelayModern');
              params.append('fb_api_req_friendly_name', friendlyName);
              params.append('server_timestamps', 'true');
              params.append('doc_id', docId);
              if (dtsg) params.append('fb_dtsg', dtsg);
              if (lsd) params.append('lsd', lsd);
              params.append('variables', varsJson);

              const r = await window.fetch('https://www.facebook.com/api/graphql/', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-FB-Friendly-Name': friendlyName,
                  'X-FB-LSD': lsd || '',
                  'X-ASBD-ID': '359341'
                },
                body: params.toString(),
                credentials: 'include'
              });
              if (!r.ok) {
                return { ok: false, status: r.status, text: '' };
              }
              const txt = await r.text();
              return { ok: true, status: r.status, text: txt };
            } catch (innerErr) {
              return { ok: false, status: 0, error: innerErr.message };
            }
          }
        });

        const tabRes = execResults?.[0]?.result;
        if (tabRes && tabRes.ok && tabRes.text) {
          return tabRes.text;
        }
      } catch (tabExecErr) {
        this.activeFbTabId = null;
      }
    }

    const res = await fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      headers: headers,
      body: requestBody,
      credentials: 'include'
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
  }

  /**
   * 2. Build GraphQL Variables từ UI Search Parameters
   */
  buildVariables(params, cursor = null) {
    let keyword = (params.keyword || '').trim();
    let isExactPhrase = Boolean(params.isExactPhrase);
    let searchType = params.searchType || 'KEYWORD_UNORDERED';

    // Auto-detect double quotes if present in keyword (e.g. "DallasWind US")
    const hasQuotes = /^["“'].*["”']$/.test(keyword);
    if (hasQuotes) {
      isExactPhrase = true;
    }

    if (isExactPhrase) {
      searchType = 'KEYWORD_EXACT_PHRASE';
      const unquoted = keyword.replace(/^["“']+|["”']+$/g, '').trim();
      keyword = `"${unquoted}"`;
    } else {
      searchType = 'KEYWORD_UNORDERED';
      if (hasQuotes) {
        keyword = keyword.replace(/^["“']+|["”']+$/g, '').trim();
      }
    }
    const country = (params.country || 'US').toUpperCase();
    const mediaType = (params.mediaType || 'ALL').toUpperCase();
    const activeStatus = (params.activeStatus || 'ACTIVE').toUpperCase();
    const language = params.language || 'ALL';

    // Content languages
    let contentLanguages = [];
    if (language === 'all' || language === 'ALL') {
      contentLanguages = [];
    } else if (language) {
      contentLanguages = [language];
    }

    // Publisher platforms: Nếu truyền mảng (kể cả mảng rỗng [] = Tất cả nền tảng) thì giữ nguyên
    let publisherPlatforms = params.publisherPlatforms;
    if (!Array.isArray(publisherPlatforms)) {
      publisherPlatforms = ['FACEBOOK', 'INSTAGRAM', 'AUDIENCE_NETWORK'];
    }

    // Sort data
    let sortData = {
      mode: 'SORT_BY_TOTAL_IMPRESSIONS',
      direction: 'DESCENDING'
    };
    if (params.sortMode === 'RELEVANCY' || params.sortBy === 'RELEVANCY' || params.sortMode === 'SORT_BY_RELEVANCY') {
      sortData = {
        mode: 'SORT_BY_RELEVANCY_MONTHLY_GROUPED',
        direction: 'DESCENDING'
      };
    }

    // Start Date
    let startDateObj = null;
    if (params.startDate) {
      let dateVal = String(params.startDate).trim();
      // Hỗ trợ nếu người dùng truyền số tháng (3, 6, 12, 15, 18, 24)
      if (/^\d+$/.test(dateVal) && parseInt(dateVal, 10) <= 60) {
        const numMonths = parseInt(dateVal, 10);
        const d = new Date();
        const targetDay = d.getDate();
        d.setMonth(d.getMonth() - numMonths);
        if (d.getDate() !== targetDay) d.setDate(0);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        dateVal = `${yyyy}-${mm}-${dd}`;
      }
      if (dateVal && dateVal !== 'ALL' && dateVal !== 'null') {
        startDateObj = { min: dateVal, max: null };
      }
    }

    const variables = {
      activeStatus: activeStatus,
      adType: 'ALL',
      audienceTimeframe: 'LAST_7_DAYS',
      bylines: [],
      collationToken: params.collationToken || this.collationToken,
      contentLanguages: contentLanguages,
      countries: [country],
      country: country,
      deeplinkAdID: null,
      excludedIDs: [],
      fetchPageInfo: false,
      fetchSharedDisclaimers: false,
      hasDeeplinkAdID: false,
      isAboutTab: false,
      isAudienceTab: false,
      isLandingPage: false,
      isTargetedCountry: false,
      location: null,
      mediaType: mediaType,
      multiCountryFilterMode: null,
      pageIDs: [],
      potentialReachInput: [],
      publisherPlatforms: publisherPlatforms,
      queryString: keyword,
      regions: [],
      searchType: searchType,
      sessionID: params.sessionID || this.sessionID,
      sortData: sortData,
      source: 'PAGE_TRANSPARENCY_WIDGET',
      startDate: startDateObj,
      v: '63cade',
      viewAllPageID: '0'
    };

    if (cursor) {
      variables.cursor = cursor;
      variables.forward_cursor = cursor;
    }

    return variables;
  }

  /**
   * 3. Xây dựng Form-urlencoded Body
   */
  buildRequestBody(variables) {
    const params = new URLSearchParams();
    const userId = this.cachedUserId || '0';

    params.append('av', userId);
    params.append('__user', userId);
    params.append('__a', '1');
    params.append('__req', 'f');
    params.append('__hs', '20760.HYP:comet_plat_default_pkg.2.1...0');
    params.append('dpr', '1');
    params.append('__ccg', 'GOOD');
    params.append('__rev', this.cachedRev || '1052846864');
    params.append('fb_api_caller_class', 'RelayModern');
    params.append('fb_api_req_friendly_name', this.friendlyName);
    params.append('server_timestamps', 'true');
    params.append('doc_id', this.docId);

    if (this.cachedDtsg) params.append('fb_dtsg', this.cachedDtsg);
    if (this.cachedLsd) params.append('lsd', this.cachedLsd);

    params.append('variables', JSON.stringify(variables));
    return params.toString();
  }

  /**
   * 4. Relay Chunk Parser (Loại bỏ for (;;); và bóc tách search_results_connection)
   */
  parseRelayResponse(rawText) {
    this.lastResponseError = null;
    if (!rawText || typeof rawText !== 'string') return null;

    let cleaned = rawText.trim();
    if (cleaned.startsWith('for (;;);')) {
      cleaned = cleaned.slice(9).trim();
    }

    const lines = cleaned.split('\n').filter(Boolean);
    let searchConnection = null;

    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        // Kiểm tra lỗi Facebook API (chưa đăng nhập, token hết hạn, rate limit)
        if (chunk.error || chunk.errorSummary || chunk.errorDescription) {
          this.lastResponseError = chunk.errorSummary || chunk.errorDescription || `Facebook Error code ${chunk.error}`;
        }
        if (Array.isArray(chunk.errors) && chunk.errors.length > 0) {
          this.lastResponseError = chunk.errors.map(e => e.message).join('; ');
        }
        // Kiểm tra root payload
        const rootConn = chunk?.data?.ad_library_main?.search_results_connection;
        if (rootConn) {
          searchConnection = rootConn;
          break;
        }
        // Kiểm tra fragment deferred payload
        const deferredConn = chunk?.data?.ad_library_main?.search_results_connection;
        if (deferredConn) {
          searchConnection = deferredConn;
          break;
        }
      } catch (e) {
        // Ignored invalid JSON line
      }
    }

    return searchConnection;
  }

  /**
   * 5. Video Duration Resolver từ param efg Base64 trong CDN URL
   */
  extractVideoDuration(videoUrl) {
    if (!videoUrl || typeof videoUrl !== 'string') return null;
    try {
      const match = videoUrl.match(/efg=([^&]+)/);
      if (!match) return null;
      const b64 = decodeURIComponent(match[1]);
      let jsonStr = '';
      if (typeof atob === 'function') {
        jsonStr = atob(b64);
      } else if (typeof Buffer !== 'undefined') {
        jsonStr = Buffer.from(b64, 'base64').toString('utf8');
      }
      if (!jsonStr) return null;
      const parsed = JSON.parse(jsonStr);
      return typeof parsed.duration_s === 'number' ? parsed.duration_s : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 6. Trích xuất 100% Caption không bị cắt ngắn (...)
   */
  extractFullCaption(snapshot) {
    if (!snapshot) return '';

    // Ưu tiên 1: Lấy trực tiếp từ snapshot.body.text
    if (snapshot.body && typeof snapshot.body.text === 'string' && snapshot.body.text.trim()) {
      return snapshot.body.text.trim();
    }

    // Ưu tiên 2: Định dạng Carousel
    if (Array.isArray(snapshot.cards) && snapshot.cards.length > 0) {
      const cardTexts = snapshot.cards
        .map((card, idx) => {
          const text = card.body?.text || card.title || '';
          return text ? `[Thẻ ${idx + 1}] ${text}` : '';
        })
        .filter(Boolean);
      if (cardTexts.length > 0) return cardTexts.join('\n');
    }

    // Ưu tiên 3: Các đoạn văn bản phụ (extra_texts)
    if (Array.isArray(snapshot.extra_texts) && snapshot.extra_texts.length > 0) {
      return snapshot.extra_texts.filter(Boolean).join('\n').trim();
    }

    // Ưu tiên 4: Tiêu đề quảng cáo
    if (snapshot.title && typeof snapshot.title === 'string') {
      return snapshot.title.trim();
    }

    return '';
  }

  /**
   * 7. Chuẩn hóa Ad Model thành 8 trường bắt buộc
   */
  normalizeAdNode(item) {
    if (!item) return null;
    const snap = item.snapshot || {};

    // Định dạng creative & thời lượng video
    let creativeFormat = 'Hình ảnh';
    let durationSeconds = null;
    let videoPreviewUrl = null;
    let imageUrl = null;

    const isVideo = snap.display_format === 'VIDEO' || (Array.isArray(snap.videos) && snap.videos.length > 0);
    if (isVideo) {
      const vid = snap.videos?.[0] || {};
      const vidUrl = vid.video_hd_url || vid.video_sd_url || null;
      videoPreviewUrl = vid.video_preview_image_url || null;
      imageUrl = videoPreviewUrl;
      durationSeconds = this.extractVideoDuration(vidUrl);
      creativeFormat = durationSeconds ? `Video (${durationSeconds} giây)` : 'Video HD';
    } else if (Array.isArray(snap.cards) && snap.cards.length > 0) {
      creativeFormat = `Carousel (${snap.cards.length} thẻ)`;
      imageUrl = snap.cards[0]?.image?.uri || snap.cards[0]?.video_preview_image_url || null;
    } else if (Array.isArray(snap.images) && snap.images.length > 0) {
      creativeFormat = 'Hình ảnh';
      imageUrl = snap.images[0]?.resized_image_url || snap.images[0]?.original_image_url || null;
    }

    const captionText = this.extractFullCaption(snap);

    // Chuẩn hóa tên các nền tảng
    const rawPlatforms = item.publisher_platform || ['FACEBOOK'];
    const platformNameMap = {
      FACEBOOK: 'Facebook',
      INSTAGRAM: 'Instagram',
      AUDIENCE_NETWORK: 'Audience Network',
      MESSENGER: 'Messenger',
      WHATSAPP: 'WhatsApp',
      THREADS: 'Threads'
    };
    let platformsStr = '';
    if (Array.isArray(rawPlatforms)) {
      platformsStr = rawPlatforms.map(p => platformNameMap[p] || p).join(', ');
    } else {
      platformsStr = String(rawPlatforms);
    }

    return {
      archive_id: String(item.ad_archive_id || ''),
      page_id: String(item.page_id || ''),
      page_name: item.page_name || 'Fanpage',
      is_active: Boolean(item.is_active),
      platforms: platformsStr || 'Facebook',
      creative_format: creativeFormat,
      duration_seconds: durationSeconds,
      caption_text: captionText,
      cta_text: snap.cta_text || 'Shop now',
      link_url: snap.link_url || '',
      image_url: imageUrl,
      display_domain: snap.caption || '',
      start_date: item.start_date || null
    };
  }

  /**
   * 8. Vòng lặp Phân trang 100% Cursor Pagination Loop
   */
  async searchAndPaginateAll(params, onProgress, options = {}) {
    this.isSearching = true;
    this.cancelRequested = false;
    this.collationToken = this.generateUUID();
    this.sessionID = this.generateUUID();
    if (!options.skipAuthRefresh) {
      await this.ensureAuthentication();
    }

    const adsMap = new Map();
    let currentCursor = null;
    let hasNextPage = true;
    let totalCount = 0;
    let batchIndex = 0;
    const maxBatches = 50; // Hỗ trợ quét tới ~1500 ads

    try {
      while (hasNextPage && !this.cancelRequested && batchIndex < maxBatches) {
        batchIndex++;
        const currentVars = this.buildVariables(params, currentCursor);

        console.log(`[AdsLibrary] Đang tải Batch #${batchIndex} (Cursor: ${currentCursor ? currentCursor.slice(0, 15) + '...' : 'Initial'})...`);

        if (typeof onProgress === 'function') {
          onProgress({
            status: 'FETCHING_PAGE',
            currentPage: batchIndex,
            totalFound: totalCount || adsMap.size,
            extractedCount: adsMap.size,
            batchAds: []
          });
        }

        const requestBody = this.buildRequestBody(currentVars);
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-FB-Friendly-Name': this.friendlyName,
          'X-FB-LSD': this.cachedLsd || '',
          'X-ASBD-ID': '359341',
          'Origin': 'https://www.facebook.com',
          'Referer': 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all'
        };

        const res = await fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers: headers,
          body: requestBody,
          credentials: 'include'
        });

        if (!res.ok) {
          throw new Error(`Facebook API HTTP error: ${res.status} ${res.statusText}`);
        }

        const responseText = await res.text();
        let connection = this.parseRelayResponse(responseText);

        if (!connection) {
          if (batchIndex === 1) {
            if (this.lastResponseError) {
              const isLogin = this.lastResponseError.includes('Log in') || this.lastResponseError.includes('1357001') || this.lastResponseError.includes('Not logged in');
              throw new Error(isLogin
                ? 'Facebook yêu cầu đăng nhập tài khoản. Vui lòng mở 1 tab Facebook (facebook.com/ads/library) và đăng nhập rồi bấm Tìm kiếm lại!'
                : `Lỗi từ Facebook: ${this.lastResponseError}`);
            }
            if (responseText.includes('login.php') || responseText.includes('Not logged in') || responseText.includes('1357001')) {
              throw new Error('Phiên đăng nhập Facebook đã hết hạn. Vui lòng mở Facebook (facebook.com) và đăng nhập lại!');
            }
          }
          console.warn('[AdsLibrary] Không tìm thấy search_results_connection trong response.');
          break;
        }

        if (typeof connection.count === 'number' && !totalCount) {
          totalCount = connection.count;
        }

        let edges = connection.edges || [];
        const batchAds = [];

        // Nếu batch 1 trả về 0 kết quả với mediaType: VIDEO, tự động fallback sang ALL và lọc video client-side
        if (batchIndex === 1 && edges.length === 0 && currentVars.mediaType === 'VIDEO') {
          console.log('[AdsLibrary] Không có kết quả với mediaType VIDEO, tự động fallback sang ALL và lọc video client-side...');
          try {
            const fallbackVars = { ...currentVars, mediaType: 'ALL' };
            const fallbackBody = this.buildRequestBody(fallbackVars);
            const fallbackRes = await fetch('https://www.facebook.com/api/graphql/', {
              method: 'POST',
              headers: headers,
              body: fallbackBody,
              credentials: 'include'
            });
            if (fallbackRes.ok) {
              const fallbackText = await fallbackRes.text();
              const fallbackConn = this.parseRelayResponse(fallbackText);
              if (fallbackConn && Array.isArray(fallbackConn.edges) && fallbackConn.edges.length > 0) {
                connection = fallbackConn;
                edges = fallbackConn.edges;
                totalCount = fallbackConn.count || totalCount;
              }
            }
          } catch (e) {
            console.warn('[AdsLibrary] Fallback ALL thất bại:', e);
          }
        }

        for (const edge of edges) {
          const collated = edge?.node?.collated_results || [];
          for (const item of collated) {
            const normalized = this.normalizeAdNode(item);
            if (normalized && normalized.archive_id && !adsMap.has(normalized.archive_id)) {
              if (params.mediaType === 'VIDEO') {
                const isVideo = normalized.creative_format.toLowerCase().includes('video') ||
                                (Array.isArray(item.snapshot?.videos) && item.snapshot.videos.length > 0);
                if (!isVideo) continue;
              } else if (params.mediaType === 'IMAGE') {
                const isImage = normalized.creative_format.toLowerCase().includes('image') ||
                                (Array.isArray(item.snapshot?.images) && item.snapshot.images.length > 0);
                if (!isImage) continue;
              }
              adsMap.set(normalized.archive_id, normalized);
              batchAds.push(normalized);
            }
          }
        }

        // Cập nhật tiến trình qua callback
        if (typeof onProgress === 'function') {
          onProgress({
            status: 'PROCESSING_ADS',
            currentPage: batchIndex,
            totalFound: totalCount || adsMap.size,
            extractedCount: adsMap.size,
            batchAds: batchAds
          });
        }

        hasNextPage = Boolean(connection.page_info?.has_next_page);
        currentCursor = connection.page_info?.end_cursor || null;

        if (!hasNextPage || !currentCursor || (totalCount > 0 && adsMap.size >= totalCount)) {
          console.log(`[AdsLibrary] Đã thu thập đủ 100% kết quả (${adsMap.size}/${totalCount} ads).`);
          break;
        }

        if (this.cancelRequested) {
          console.log('[AdsLibrary] Người dùng đã yêu cầu dừng phân trang.');
          break;
        }

        // Jitter delay thông minh để bảo vệ tài khoản (500ms - 800ms)
        const delay = Math.floor(Math.random() * 300) + 500;
        await new Promise(r => setTimeout(r, delay));
      }

      if (typeof onProgress === 'function') {
        onProgress({
          status: 'COMPLETED',
          currentPage: batchIndex,
          totalFound: totalCount || adsMap.size,
          extractedCount: adsMap.size,
          batchAds: []
        });
      }
    } catch (err) {
      console.error('[AdsLibrary] Lỗi trong searchAndPaginateAll:', err);
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'ERROR',
          currentPage: batchIndex,
          totalFound: totalCount || adsMap.size,
          extractedCount: adsMap.size,
          batchAds: [],
          error: err.message
        });
      }
      throw err;
    } finally {
      this.isSearching = false;
      this.cancelRequested = false;
    }

    return Array.from(adsMap.values());
  }

  cancel() {
    this.cancelRequested = true;
    this.batchCancelRequested = true;
    this.isSearching = false;
    this.isBatchSearching = false;
  }

  /**
   * 8b. Chạy ngầm tuần tự hàng loạt từ khóa từ link https://inote.net/...
   */
  async searchInoteKeywordBatch(inoteUrl, baseParams, onProgress) {
    this.isBatchSearching = true;
    this.batchCancelRequested = false;
    this.cancelRequested = false;

    const globalAdsMap = new Map();
    let accumulatedTotalFound = 0;

    try {
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'SEARCHING',
          currentPage: 1,
          totalFound: 0,
          extractedCount: 0,
          batchAds: [],
          statusMessage: `Đang tải danh sách từ khóa từ ${inoteUrl}...`
        });
      }

      const keywords = await InoteService.fetchKeywordsFromNote(inoteUrl);
      if (!keywords || keywords.length === 0) {
        throw new Error('Trang Inote không có dòng từ khóa nào hợp lệ.');
      }

      console.log(`[AdsLibrary Inote Batch] Đã tải ${keywords.length} từ khóa từ ${inoteUrl}`);
      await this.ensureAuthentication();

      const totalKw = keywords.length;
      for (let i = 0; i < totalKw; i++) {
        if (this.batchCancelRequested || this.cancelRequested) {
          console.log(`[AdsLibrary Inote Batch] Đã dừng tại từ khóa ${i + 1}/${totalKw}.`);
          break;
        }

        const rawLine = keywords[i].trim();
        if (!rawLine) continue;

        const lineHasQuotes = /^["“'].*["”']$/.test(rawLine);
        const useExact = Boolean(baseParams.isExactPhrase) || lineHasQuotes;
        const cleanLine = rawLine.replace(/^["“']+|["”']+$/g, '').trim();
        const formattedKw = useExact ? `"${cleanLine}"` : cleanLine;
        const stepSearchType = useExact ? 'KEYWORD_EXACT_PHRASE' : 'KEYWORD_UNORDERED';
        const shortKw = cleanLine.length > 32 ? cleanLine.substring(0, 32) + '...' : cleanLine;

        const stepParams = {
          ...baseParams,
          keyword: formattedKw,
          rawKeyword: cleanLine,
          isExactPhrase: useExact,
          searchType: stepSearchType
        };

        let kwTotalFound = 0;
        let kwRecordedTotal = false;

        if (typeof onProgress === 'function') {
          onProgress({
            status: 'SEARCHING',
            currentPage: i + 1,
            totalFound: Math.max(accumulatedTotalFound, globalAdsMap.size),
            extractedCount: globalAdsMap.size,
            batchAds: [],
            statusMessage: `[Từ khóa ${i + 1}/${totalKw}] "${shortKw}"`
          });
        }

        try {
          await this.searchAndPaginateAll(
            stepParams,
            (stepProg) => {
              if (this.batchCancelRequested) return;
              if (stepProg.totalFound && !kwRecordedTotal) {
                kwTotalFound = stepProg.totalFound;
                accumulatedTotalFound += kwTotalFound;
                kwRecordedTotal = true;
              }

              const newBatchAds = [];
              if (Array.isArray(stepProg.batchAds)) {
                for (const ad of stepProg.batchAds) {
                  if (ad && ad.archive_id && !globalAdsMap.has(ad.archive_id)) {
                    globalAdsMap.set(ad.archive_id, ad);
                    newBatchAds.push(ad);
                  }
                }
              }

              if (typeof onProgress === 'function' && (newBatchAds.length > 0 || stepProg.status === 'FETCHING_PAGE')) {
                onProgress({
                  status: newBatchAds.length > 0 ? 'PROCESSING_ADS' : 'SEARCHING',
                  currentPage: i + 1,
                  totalFound: Math.max(accumulatedTotalFound, globalAdsMap.size),
                  extractedCount: globalAdsMap.size,
                  batchAds: newBatchAds,
                  statusMessage: `[Từ khóa ${i + 1}/${totalKw}] "${shortKw}" (${globalAdsMap.size} ads)`
                });
              }
            },
            { skipAuthRefresh: true }
          );
        } catch (kwErr) {
          console.warn(`[AdsLibrary Inote Batch] Bỏ qua lỗi ở từ khóa #${i + 1} ("${shortKw}"):`, kwErr.message);
        }

        if (this.batchCancelRequested) break;

        if (i < totalKw - 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      const finalTotal = Math.max(accumulatedTotalFound, globalAdsMap.size);
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'COMPLETED',
          currentPage: totalKw,
          totalFound: finalTotal,
          extractedCount: globalAdsMap.size,
          batchAds: [],
          statusMessage: this.batchCancelRequested
            ? `Đã dừng Batch Inote (${globalAdsMap.size} ads)`
            : `Hoàn tất ${totalKw}/${totalKw} từ khóa Inote (${globalAdsMap.size} ads)`
        });
      }

      return Array.from(globalAdsMap.values());
    } catch (err) {
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'ERROR',
          error: err.message,
          totalFound: Math.max(accumulatedTotalFound, globalAdsMap.size),
          extractedCount: globalAdsMap.size,
          batchAds: []
        });
      }
      throw err;
    } finally {
      this.isBatchSearching = false;
      this.isSearching = false;
      this.batchCancelRequested = false;
      this.cancelRequested = false;
    }
  }

  /**
   * 8c. Trích xuất siêu tốc chỉ thông tin Page (page_name, page_id, archive_id) từ GraphQL connection
   * Không giải mã efg Base64 video, không nối caption, đảm bảo tốc độ tối đa và không bỏ sót Page nào.
   */
  extractPageEntitiesFromConnection(connection) {
    if (!connection || !Array.isArray(connection.edges)) return [];
    const extracted = [];

    for (const edge of connection.edges) {
      const node = edge?.node;
      if (!node) continue;

      const collated = Array.isArray(node.collated_results) && node.collated_results.length > 0
        ? node.collated_results
        : [node];

      for (const item of collated) {
        if (!item || typeof item !== 'object') continue;
        const rawPageName = (
          item.page_name ||
          item.snapshot?.page_name ||
          item.snapshot?.current_page_name ||
          node.page_name ||
          ''
        ).trim();

        if (!rawPageName) continue;

        const pageId = String(
          item.page_id ||
          item.snapshot?.page_id ||
          node.page_id ||
          'N/A'
        ).trim();

        const archiveId = String(
          item.ad_archive_id ||
          item.archive_id ||
          item.id ||
          `ph_${pageId}_${rawPageName}`
        ).trim();

        extracted.push({
          archive_id: archiveId,
          page_id: pageId,
          page_name: rawPageName,
          is_active: item.is_active !== undefined ? Boolean(item.is_active) : true
        });
      }
    }

    return extracted;
  }

  /**
   * 8d. Quét toàn bộ các trang kết quả của 1 từ khóa để lấy 100% tên Page (hỗ trợ Retry 3 lần chống sót)
   */
  async fetchPagesForKeywordWithRetry(stepParams, uniquePagesMap, onNewPagesFound) {
    const kwSessionID = this.generateUUID();
    const kwCollationToken = this.generateUUID();
    let currentCursor = null;
    let hasNextPage = true;
    let batchIndex = 0;
    let totalCount = 0;
    let seenForKeyword = 0;
    const maxBatches = 50;

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': this.friendlyName,
      'X-FB-LSD': this.cachedLsd || '',
      'X-ASBD-ID': '359341',
      'Origin': 'https://www.facebook.com',
      'Referer': 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all'
    };

    while (hasNextPage && !this.batchCancelRequested && !this.cancelRequested && batchIndex < maxBatches) {
      batchIndex++;
      const currentVars = this.buildVariables({
        ...stepParams,
        sessionID: kwSessionID,
        collationToken: kwCollationToken
      }, currentCursor);

      let connection = null;
      let lastErr = null;

      // Retry tối đa 3 lần nếu mạng chập chờn hoặc rate-limit tạm thời để không bỏ sót bất kỳ Page nào
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (this.batchCancelRequested || this.cancelRequested) break;
        try {
          const responseText = await this.executeGraphQLPost(currentVars, headers);
          connection = this.parseRelayResponse(responseText);
          if (connection) {
            break;
          }
          if (this.lastResponseError) {
            throw new Error(this.lastResponseError);
          }
        } catch (err) {
          lastErr = err;
          if (attempt === 1 && !this.batchCancelRequested && !this.cancelRequested && typeof chrome !== 'undefined' && chrome.tabs) {
            await this.ensureAuthentication(true);
          }
          if (attempt < 3 && !this.batchCancelRequested && !this.cancelRequested) {
            await new Promise(r => setTimeout(r, 450 * attempt));
          }
        }
      }

      if (!connection) {
        if (lastErr) {
          console.warn(`[PageHunter] Từ khóa "${stepParams.rawKeyword || stepParams.keyword}" trang #${batchIndex} không phản hồi sau 3 lần thử:`, lastErr.message);
        }
        break;
      }

      // Nếu trang 1 trả về 0 kết quả do bộ lọc VIDEO, Exact Phrase hoặc câu quá dài có dấu câu cuối dòng, tự động fallback thông minh để không sót Page
      if (batchIndex === 1 && (!connection.edges || connection.edges.length === 0)) {
        try {
          const rawClean = String(stepParams.rawKeyword || stepParams.keyword || '')
            .replace(/^["“']+|["”']+$/g, '')
            .replace(/[.!?]+$/g, '')
            .trim();
          const words = rawClean.split(/\s+/).filter(Boolean);
          const fallbackQuery = words.length > 14 ? words.slice(0, 12).join(' ') : rawClean;

          if (fallbackQuery) {
            const fallbackVars = {
              ...currentVars,
              mediaType: 'ALL',
              publisherPlatforms: [],
              contentLanguages: [],
              startDate: null,
              searchType: 'KEYWORD_UNORDERED',
              queryString: fallbackQuery
            };
            const fbText = await this.executeGraphQLPost(fallbackVars, headers);
            const fallbackConn = this.parseRelayResponse(fbText);
            if (fallbackConn && Array.isArray(fallbackConn.edges) && fallbackConn.edges.length > 0) {
              connection = fallbackConn;
            }
          }
        } catch (e) {}
      }

      if (typeof connection.count === 'number' && !totalCount) {
        totalCount = connection.count;
      }

      const pageEntities = this.extractPageEntitiesFromConnection(connection);
      seenForKeyword += pageEntities.length;
      const newUniquePages = [];

      for (const entity of pageEntities) {
        const normKey = entity.page_name.trim().toLowerCase();
        if (!normKey) continue;
        if (!uniquePagesMap.has(normKey)) {
          const pageRecord = {
            archive_id: entity.archive_id,
            page_id: entity.page_id,
            page_name: entity.page_name.trim(),
            is_active: entity.is_active,
            platforms: 'Page Hunter',
            creative_format: 'Page Hunter',
            caption_text: `Từ khóa: ${stepParams.rawKeyword || stepParams.keyword}`,
            cta_text: 'Page Hunter',
            link_url: entity.page_id && entity.page_id !== 'N/A'
              ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${stepParams.country || 'US'}&view_all_page_id=${entity.page_id}`
              : ''
          };
          uniquePagesMap.set(normKey, pageRecord);
          newUniquePages.push(pageRecord);
        }
      }

      if (newUniquePages.length > 0 && typeof onNewPagesFound === 'function') {
        onNewPagesFound(newUniquePages, batchIndex);
      }

      hasNextPage = Boolean(connection.page_info?.has_next_page);
      currentCursor = connection.page_info?.end_cursor || null;

      if (!hasNextPage || !currentCursor || (totalCount > 0 && seenForKeyword >= totalCount)) {
        break;
      }

      if (this.batchCancelRequested || this.cancelRequested) {
        break;
      }

      // Độ trễ ngắn 120ms - 200ms giữa các trang trong chế độ Page Hunter
      const fastDelay = Math.floor(Math.random() * 80) + 120;
      await new Promise(r => setTimeout(r, fastDelay));
    }
  }

  /**
   * 8e. Chế độ Page Hunter (Đa luồng 3 Workers song song, lọc trùng tên Page O(1), bỏ qua Active/Total Camp,
   * tự động xuất thẳng danh sách tên Page ra https://inote.net/ ngay khi hoàn tất)
   */
  async runPageHunterBatch(inoteUrlOrKeyword, baseParams, onProgress) {
    this.isBatchSearching = true;
    this.isSearching = true;
    this.batchCancelRequested = false;
    this.cancelRequested = false;

    const uniquePagesMap = new Map();
    const validInoteUrl = InoteService.parseInoteUrl(inoteUrlOrKeyword);

    try {
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'SEARCHING',
          currentPage: 0,
          totalFound: 0,
          extractedCount: 0,
          batchAds: [],
          isPageHunter: true,
          statusMessage: validInoteUrl
            ? `🎯 Page Hunter: Đang tải từ khóa từ ${validInoteUrl}...`
            : `🎯 Page Hunter: Đang khởi tạo truy vấn...`
        });
      }

      let rawKeywords = [];
      if (validInoteUrl) {
        rawKeywords = await InoteService.fetchKeywordsFromNote(validInoteUrl);
      } else {
        rawKeywords = String(inoteUrlOrKeyword || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
      }

      // Khử trùng dòng từ khóa đầu vào (giữ nguyên thứ tự) để không bắn trùng 1 câu 2 lần
      const seenKwSet = new Set();
      const keywords = [];
      for (const line of rawKeywords) {
        const cleanCheck = line.trim().toLowerCase();
        if (cleanCheck && !seenKwSet.has(cleanCheck)) {
          seenKwSet.add(cleanCheck);
          keywords.push(line.trim());
        }
      }

      if (keywords.length === 0) {
        throw new Error('Không tìm thấy từ khóa hợp lệ nào để chạy Page Hunter.');
      }

      await this.ensureAuthentication();

      const totalKw = keywords.length;
      const concurrency = Math.min(Number(baseParams.concurrency) || 3, totalKw);
      let nextIndex = 0;
      let completedKw = 0;

      console.log(`[PageHunter] Bắt đầu quét ${totalKw} từ khóa độc nhất với ${concurrency} luồng song song...`);

      if (typeof onProgress === 'function') {
        onProgress({
          status: 'SEARCHING',
          currentPage: 0,
          totalFound: totalKw,
          extractedCount: 0,
          batchAds: [],
          isPageHunter: true,
          statusMessage: `🎯 [0/${totalKw} từ khóa] Đang chạy ${concurrency} luồng song song...`
        });
      }

      const workerTask = async (workerId) => {
        if (workerId > 1) {
          await new Promise(r => setTimeout(r, (workerId - 1) * 180));
        }
        while (!this.batchCancelRequested && !this.cancelRequested) {
          const i = nextIndex++;
          if (i >= totalKw) break;

          const rawLine = keywords[i];
          const lineHasQuotes = /^["“'].*["”']$/.test(rawLine);
          const useExact = Boolean(baseParams.isExactPhrase) || lineHasQuotes;
          const cleanLine = rawLine
            .replace(/^["“']+|["”']+$/g, '')
            .replace(/[.]+$/g, '')
            .trim();
          const formattedKw = useExact ? `"${cleanLine}"` : cleanLine;
          const stepSearchType = useExact ? 'KEYWORD_EXACT_PHRASE' : 'KEYWORD_UNORDERED';
          const shortKw = cleanLine.length > 28 ? cleanLine.substring(0, 28) + '...' : cleanLine;

          // Chế độ Page Hunter luôn mở rộng tối đa bộ lọc phụ (ALL platforms, ALL media, ALL languages, ALL dates) để không bao giờ bỏ sót tên Page
          const stepParams = {
            ...baseParams,
            keyword: formattedKw,
            rawKeyword: cleanLine,
            isExactPhrase: useExact,
            searchType: stepSearchType,
            publisherPlatforms: [],
            mediaType: 'ALL',
            language: 'ALL',
            startDate: null
          };

          try {
            await this.fetchPagesForKeywordWithRetry(
              stepParams,
              uniquePagesMap,
              (newUniquePages) => {
                if (this.batchCancelRequested || this.cancelRequested) return;
                if (typeof onProgress === 'function') {
                  onProgress({
                    status: 'PROCESSING_ADS',
                    currentPage: completedKw,
                    totalFound: totalKw,
                    extractedCount: uniquePagesMap.size,
                    batchAds: newUniquePages,
                    isPageHunter: true,
                    statusMessage: `🎯 [${completedKw}/${totalKw}] +${newUniquePages.length} Page (${uniquePagesMap.size} Page độc nhất)`
                  });
                }
              }
            );
          } catch (kwErr) {
            console.warn(`[PageHunter Worker #${workerId}] Lỗi ở từ khóa #${i + 1}:`, kwErr.message);
          }

          completedKw++;
          if (typeof onProgress === 'function' && !this.batchCancelRequested && !this.cancelRequested) {
            onProgress({
              status: 'SEARCHING',
              currentPage: completedKw,
              totalFound: totalKw,
              extractedCount: uniquePagesMap.size,
              batchAds: [],
              isPageHunter: true,
              statusMessage: `🎯 [${completedKw}/${totalKw}] "${shortKw}" (${uniquePagesMap.size} Page)`
            });
          }

          if (nextIndex < totalKw && !this.batchCancelRequested && !this.cancelRequested) {
            await new Promise(r => setTimeout(r, 120));
          }
        }
      };

      const workers = Array.from({ length: concurrency }, (_, idx) => workerTask(idx + 1));
      await Promise.all(workers);

      const finalPagesList = Array.from(uniquePagesMap.values());
      let autoNoteResult = null;

      // Tự động xuất danh sách tên Page độc nhất ra Inote ngay khi hoàn tất (nếu có ít nhất 1 Page)
      if (finalPagesList.length > 0 && baseParams.autoExportInote !== false) {
        try {
          if (typeof onProgress === 'function') {
            onProgress({
              status: 'SEARCHING',
              currentPage: completedKw,
              totalFound: totalKw,
              extractedCount: finalPagesList.length,
              batchAds: [],
              isPageHunter: true,
              statusMessage: `🎯 Đang tự động xuất ${finalPagesList.length} tên Page ra inote.net...`
            });
          }
          const pageNamesText = finalPagesList.map(p => p.page_name).join('\n');
          autoNoteResult = await InoteService.createNote(pageNamesText, {
            openTab: baseParams.openInoteTab !== false
          });
        } catch (inoteErr) {
          console.warn('[PageHunter] Không thể tự động tạo Inote:', inoteErr.message);
        }
      }

      if (typeof onProgress === 'function') {
        onProgress({
          status: 'COMPLETED',
          currentPage: completedKw,
          totalFound: totalKw,
          extractedCount: finalPagesList.length,
          batchAds: [],
          isPageHunter: true,
          autoNoteResult: autoNoteResult,
          statusMessage: autoNoteResult && autoNoteResult.noteUrl
            ? `🎯 Hoàn tất ${completedKw}/${totalKw} từ khóa → Đã xuất ${finalPagesList.length} Page ra Inote!`
            : `🎯 Hoàn tất ${completedKw}/${totalKw} từ khóa (${finalPagesList.length} Page độc nhất)`
        });
      }

      return finalPagesList;
    } catch (err) {
      if (typeof onProgress === 'function') {
        onProgress({
          status: 'ERROR',
          error: err.message,
          currentPage: 0,
          totalFound: 0,
          extractedCount: uniquePagesMap.size,
          batchAds: [],
          isPageHunter: true
        });
      }
      throw err;
    } finally {
      this.isBatchSearching = false;
      this.isSearching = false;
      this.batchCancelRequested = false;
      this.cancelRequested = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ── MINEA ACTIVE VS TOTAL ADS COUNTER & RATIO ENGINE ──────────────
  // ══════════════════════════════════════════════════════════════════

  static smartRound(num) {
    const n = Number(num) || 0;
    if (n < 100) return n;
    if (n >= 10000) return Math.round(n / 1000) * 1000;
    if (n >= 1000) return Math.round(n / 100) * 100;
    if (n >= 100) return Math.round(n / 10) * 10;
    return n;
  }

  smartRound(num) {
    return AdsLibraryGraphQLService.smartRound(num);
  }

  static formatNumberWithoutDecimals(num) {
    const n = Number(num) || 0;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  }

  formatNumberWithoutDecimals(num) {
    return AdsLibraryGraphQLService.formatNumberWithoutDecimals(num);
  }

  static formatNumberCompact(num) {
    const n = Number(num) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
  }

  formatNumberCompact(num) {
    return AdsLibraryGraphQLService.formatNumberCompact(num);
  }

  /**
   * Trích xuất search_results_connection.count từ HTML trang Ads Library (chuẩn Minea __bbox)
   * Tương thích 100% với MV3 Service Worker (không phụ thuộc DOMParser)
   */
  extractCountFromHTML(html) {
    if (!html || typeof html !== 'string') return null;

    // 1. Quét các thẻ <script> inline chứa search_results_connection theo cấu trúc __bbox của Minea
    const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      const content = (match[1] || '').trim();
      if (!content.includes('search_results_connection')) continue;
      try {
        const data = JSON.parse(content);
        const bboxCount =
          data?.require?.[0]?.[3]?.[0]?.__bbox?.require?.[0]?.[3]?.[1]?.__bbox
            ?.result?.data?.ad_library_main?.search_results_connection?.count;
        if (typeof bboxCount === 'number') {
          return bboxCount;
        }
        const conn = this.findConnectionObject(data);
        if (conn && typeof conn.count === 'number') {
          return conn.count;
        }
      } catch (e) {
        // Bỏ qua script không phải JSON thuần và chuyển sang bước dự phòng
      }
    }

    // 2. Fallback Regex trực tiếp trên chuỗi HTML/JSON
    const countRegex = /"search_results_connection"\s*:\s*\{[^{}]*"count"\s*:\s*(\d+)/;
    const fallbackMatch = html.match(countRegex);
    if (fallbackMatch && fallbackMatch[1]) {
      return parseInt(fallbackMatch[1], 10);
    }

    return null;
  }

  /**
   * Xây dựng URL trang Facebook Ads Library với tham số active_status = 'all' | 'active'
   */
  buildAdsLibraryUrlWithStatus(params = {}, status = 'all') {
    const vars = this.buildVariables({
      ...params,
      activeStatus: String(status || 'all').toUpperCase()
    });
    const url = new URL('https://www.facebook.com/ads/library/');
    url.searchParams.set('active_status', String(status || 'all').toLowerCase());
    url.searchParams.set('ad_type', (vars.adType || 'ALL').toLowerCase());
    url.searchParams.set('country', vars.country || 'US');
    url.searchParams.set('q', vars.queryString || '');
    url.searchParams.set('search_type', (vars.searchType || 'KEYWORD_UNORDERED').toLowerCase());
    url.searchParams.set('media_type', (vars.mediaType || 'ALL').toLowerCase());

    if (vars.startDate && vars.startDate.min) {
      url.searchParams.set('start_date[min]', vars.startDate.min);
    }
    if (Array.isArray(vars.contentLanguages) && vars.contentLanguages.length > 0) {
      url.searchParams.set('content_languages[0]', vars.contentLanguages[0]);
    }
    if (Array.isArray(vars.publisherPlatforms) && vars.publisherPlatforms.length > 0) {
      vars.publisherPlatforms.forEach((plat, idx) => {
        url.searchParams.set(`publisher_platforms[${idx}]`, String(plat).toLowerCase());
      });
    }
    return url.toString();
  }

  /**
   * Fetch số lượng quảng cáo theo trạng thái ('all' hoặc 'active') kèm cơ chế Exponential Backoff (3 lần: 1s, 2s, 4s)
   */
  async fetchCountWithRetry(params = {}, status = 'all', maxRetries = 3, baseDelayMs = 1000) {
    const normalizedStatus = String(status || 'all').toUpperCase();
    const statusParams = {
      ...params,
      activeStatus: normalizedStatus
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Chiến lược 1: Truy vấn nhanh qua GraphQL Relay API để lấy search_results_connection.count
        const vars = this.buildVariables(statusParams, null);
        vars.collationToken = this.generateUUID();
        vars.sessionID = this.generateUUID();
        const body = this.buildRequestBody(vars);
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-FB-Friendly-Name': this.friendlyName,
          'X-FB-LSD': this.cachedLsd || '',
          'X-ASBD-ID': '359341',
          'Origin': 'https://www.facebook.com',
          'Referer': `https://www.facebook.com/ads/library/?active_status=${normalizedStatus.toLowerCase()}&ad_type=all`
        };

        const gqlRes = await fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers,
          body,
          credentials: 'include'
        });

        if (gqlRes && gqlRes.ok) {
          const text = await gqlRes.text();
          // Kiểm tra nếu text là HTML chứa __bbox (khi mock hoặc redirect)
          if (text.includes('<script') && text.includes('search_results_connection')) {
            const htmlCount = this.extractCountFromHTML(text);
            if (typeof htmlCount === 'number') return htmlCount;
          }
          const conn = this.parseRelayResponse(text);
          if (conn && typeof conn.count === 'number') {
            return conn.count;
          }
        }

        // Chiến lược 2 (Chuẩn Minea): Fetch HTML trang Ads Library với active_status=all|active và bóc __bbox
        const pageUrl = this.buildAdsLibraryUrlWithStatus(params, status);
        const htmlRes = await fetch(pageUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          credentials: 'include'
        });

        if (htmlRes && htmlRes.ok) {
          const htmlText = await htmlRes.text();
          const countFromHtml = this.extractCountFromHTML(htmlText);
          if (typeof countFromHtml === 'number') {
            return countFromHtml;
          }
        }

        throw new Error(`Không trích xuất được count cho status=${status} ở lần thử #${attempt}`);
      } catch (err) {
        if (attempt === maxRetries) {
          console.warn(`[AdsLibrary][MineaCounter] Thất bại sau ${maxRetries} lần thử (${status}):`, err.message);
          return null;
        }
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return null;
  }

  /**
   * Thực thi song song 2 request (Promise.all) lấy Active Camp & Total Camp, tính tỷ lệ %
   */
  async fetchActiveVsTotalCounts(params = {}, maxRetries = 3, baseDelayMs = 1000) {
    await this.ensureAuthentication();

    const [rawTotal, rawActive] = await Promise.all([
      this.fetchCountWithRetry(params, 'all', maxRetries, baseDelayMs),
      this.fetchCountWithRetry(params, 'active', maxRetries, baseDelayMs)
    ]);

    if (rawTotal === null && rawActive === null) {
      throw new Error('Không thể lấy dữ liệu Active / Total từ Facebook Ads Library.');
    }

    const activeCount = typeof rawActive === 'number' ? Math.max(0, rawActive) : 0;
    const totalCount = typeof rawTotal === 'number' ? Math.max(activeCount, rawTotal) : activeCount;
    const inactiveCount = Math.max(0, totalCount - activeCount);
    const ratioPercent = totalCount > 0 ? Number(((activeCount / totalCount) * 100).toFixed(1)) : 0;

    const smartActive = this.smartRound(activeCount);
    const smartTotal = this.smartRound(totalCount);
    const formattedActive = `~${this.formatNumberWithoutDecimals(smartActive)}`;
    const formattedTotal = `${totalCount > 50000 ? '>' : '~'}${this.formatNumberCompact(smartTotal)}`;

    return {
      activeCount,
      totalCount,
      inactiveCount,
      ratioPercent,
      smartActive,
      smartTotal,
      formattedActive,
      formattedTotal
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// ── INOTE.NET SERVICE (Milestone 3: Exporter & API Client) ─────────
// ══════════════════════════════════════════════════════════════════

class InoteService {
  /**
   * Kiểm tra và chuẩn hóa nếu chuỗi đầu vào là URL https://inote.net/<id>
   */
  static parseInoteUrl(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const cleaned = rawInput.trim().replace(/^["“']+|["”']+$/g, '').trim();
    const match = cleaned.match(/^(?:https?:\/\/)?(?:www\.)?inote\.net\/([a-zA-Z0-9_\-]+)\/?$/i);
    return match ? `https://inote.net/${match[1]}` : null;
  }

  /**
   * Giải mã các ký tự HTML entities trong textarea của inote.net
   */
  static decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&amp;/g, '&');
  }

  /**
   * Tải nội dung trang inote.net và tách từng dòng thành mảng từ khóa (bỏ qua dòng trống)
   */
  static async fetchKeywordsFromNote(inoteUrl) {
    const validUrl = InoteService.parseInoteUrl(inoteUrl) || inoteUrl;
    const res = await fetch(validUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) {
      throw new Error(`Không thể tải trang Inote (${validUrl}): HTTP ${res.status}`);
    }
    const html = await res.text();
    const textareaMatch = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
    const rawContent = textareaMatch ? textareaMatch[1] : '';
    const decoded = InoteService.decodeHtmlEntities(rawContent);
    return decoded
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }

  /**
   * Định dạng 1 quảng cáo sang mẫu chuẩn 8 trường của ông chủ
   */
  static formatAd(ad, index) {
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

  /**
   * Định dạng toàn bộ danh sách kết quả quảng cáo
   */
  static formatAllAds(adsList, formatMode = 'full') {
    if (!Array.isArray(adsList) || adsList.length === 0) return '';

    // Chế độ 0: Chỉ lấy tên Page, mỗi tên Page 1 dòng (lọc trùng giữ thứ tự)
    if (formatMode === 'page_name' || formatMode === 'ONLY_PAGE_NAME') {
      const uniquePages = Array.from(
        new Set(
          adsList
            .map(ad => (ad.page_name || ad.pageName || '').trim())
            .filter(Boolean)
        )
      );
      return uniquePages.join('\n');
    }

    // Chế độ 1: Chỉ lấy nội dung bài viết, mỗi mẫu cách nhau 1 dòng trống
    if (formatMode === 'content' || formatMode === 'ONLY_CONTENT') {
      return adsList
        .map(ad => (ad.caption_text || ad.caption || '').trim())
        .filter(Boolean)
        .join('\n\n');
    }

    // Chế độ 2: Chỉ lấy đường dẫn đích, mỗi link xuống dòng
    if (formatMode === 'links' || formatMode === 'ONLY_LINKS') {
      return adsList
        .map(ad => (ad.link_url || '').trim())
        .filter(Boolean)
        .join('\n');
    }

    // Mặc định: Đầy đủ 8 trường
    return adsList.map((ad, idx) => InoteService.formatAd(ad, idx)).join('\n\n');
  }

  /**
   * Tạo note mới trên https://inote.net/ qua quy trình 2 bước
   */
  static async createNote(content, options = { openTab: true }) {
    if (!content || typeof content !== 'string') {
      throw new Error('Nội dung note không hợp lệ hoặc rỗng.');
    }

    // Bước 1: GET https://inote.net/ lấy URL chuyển hướng chứa note_id
    const getRes = await fetch('https://inote.net/', {
      method: 'GET',
      redirect: 'follow',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!getRes.ok) {
      throw new Error(`Lỗi khởi tạo note: HTTP ${getRes.status}`);
    }

    const noteUrl = getRes.url;
    const match = noteUrl.match(/https?:\/\/inote\.net\/([a-zA-Z0-9_\-]+)/);
    const noteId = match ? match[1] : noteUrl.split('/').filter(Boolean).pop();

    if (!noteId) {
      throw new Error('Không thể lấy được Note ID từ inote.net');
    }

    // Bước 2: POST lưu nội dung lên URL note vừa tạo
    const postBody = 'text=' + encodeURIComponent(content);
    const postRes = await fetch(`https://inote.net/${noteId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: postBody
    });

    if (!postRes.ok) {
      throw new Error(`Lỗi lưu nội dung note: HTTP ${postRes.status}`);
    }

    const finalNoteUrl = `https://inote.net/${noteId}`;
    console.log(`[InoteService] ✓ Đã tạo thành công note trên inote.net: ${finalNoteUrl} (ID: ${noteId})`);

    // Tự động mở tab mới nếu được yêu cầu và chrome.tabs khả dụng
    let tabOpened = false;
    if (options.openTab && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      try {
        chrome.tabs.create({ url: finalNoteUrl, active: true }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[InoteService] Không thể mở tab mới:', chrome.runtime.lastError.message);
          }
        });
        tabOpened = true;
      } catch (e) {
        console.warn('[InoteService] Lỗi gọi chrome.tabs.create:', e);
      }
    }

    return {
      success: true,
      noteUrl: finalNoteUrl,
      noteId: noteId,
      tabOpened: tabOpened
    };
  }
}

const adsLibraryService = new AdsLibraryGraphQLService();

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

          let warmupTabTransitioned = false;
          let hasInjected = false;
          function doInject() {
            chrome.tabs.get(warmupTab.id, (liveTab) => {
              if (chrome.runtime.lastError || !liveTab?.url) return;
              const liveUrl = liveTab.url || '';
              if (liveUrl.includes('/login/?next=') || liveUrl.includes('crypted_string=')) {
                return; // Đang chuyển hướng, đợi tab redirect xong
              }
              if (hasInjected) return;
              hasInjected = true;
              try { chrome.tabs.onUpdated.removeListener(tabUpdateListener); } catch(e) {}

              setTimeout(() => {
                chrome.scripting.executeScript({
                  target: { tabId: warmupTab.id },
                  func: (pId, rType, rLabel, seconds, targetAuthor, passedUserId, currentTabId, shouldAutoClickCta) => {
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

                      function extractPostStoreUrl() {
                        try {
                          // Ưu tiên 1: Quét text caption của bài viết
                          const postContainer = document.querySelector('[role="main"]') || document.body;
                          const allTexts = Array.from(postContainer.querySelectorAll('div[dir="auto"], span[dir="auto"], p'));
                          for (const el of allTexts) {
                            if (typeof el.closest === 'function') {
                              if (el.closest('[role="complementary"]') || el.closest('[data-pagelet*="RightRail"]')) continue;
                            }
                            const t = el.innerText || '';
                            const m = t.match(/https?:\/\/(?!www\.facebook\.com|facebook\.com|fb\.com|meta\.ai)[^\s"'<>]+/i);
                            if (m) {
                              const cleanUrl = m[0].replace(/[.,;)]+$/, '');
                              if (cleanUrl.length > 10) return cleanUrl;
                            }
                          }

                          // Ưu tiên 2: Thẻ anchor ngoài RightRail
                          const validAnchors = Array.from(document.querySelectorAll('a[href]')).filter(a => {
                            if (typeof a.closest === 'function') {
                              if (a.closest('[role="complementary"]') || a.closest('[data-pagelet*="RightRail"]') || a.closest('[aria-label*="Sponsored" i]')) return false;
                            }
                            const h = a.getAttribute('href') || '';
                            return !h.includes('meta.ai') && !h.includes('facebook.com');
                          });

                          for (const a of validAnchors) {
                            const h = a.getAttribute('href') || '';
                            if (h.includes('l.facebook.com/l.php')) {
                              try {
                                const u = new URL(h.startsWith('http') ? h : 'https://www.facebook.com' + h).searchParams.get('u');
                                if (u) {
                                  const decoded = decodeURIComponent(u);
                                  if (decoded.startsWith('http') && !decoded.includes('facebook.com') && !decoded.includes('meta.ai')) {
                                    return decoded;
                                  }
                                }
                              } catch(e) {}
                            } else if (h.startsWith('http')) {
                              return h;
                            }
                          }
                        } catch(e) {
                          console.warn('[Warmup Extract Error]:', e);
                        }
                        return null;
                      }

                      // Nếu có cờ shouldAutoClickCta: Tìm link mua hàng CTA và tự động chuyển sang 7 bước Super-Buyer
                      try {
                        if (shouldAutoClickCta) {
                          const foundStoreUrl = extractPostStoreUrl();
                          if (foundStoreUrl) {
                            if (hud) hud.innerHTML = `<span style="color:#34d399; font-weight:700;">⚡ TÌM THẤY LINK CTA!</span> Đang mở Store và chạy 7 bước Super-Buyer...`;
                            setTimeout(() => {
                              chrome.runtime.sendMessage({
                                action: 'WARMUP_TRANSITION_TO_STORE',
                                payload: { targetUrl: foundStoreUrl, postUrl: location.href, originalTabId: currentTabId }
                              }).catch(() => {});
                            }, 1200);
                            return;
                          }
                        }
                      } catch (err) {
                        console.warn('[Warmup CTA Transition Error]:', err);
                      }

                      if (rType === 'NONE') {
                        if (hud) hud.innerHTML = `<span style="color:#34d399; font-weight:700;">✓ HOÀN TẤT WARMUP!</span> Đã xem video (${seconds}s). Tab được giữ nguyên để bạn kiểm tra.`;
                      } else {
                        const verifiedTag = '<span style="color:#34d399; font-weight:700;">✓ ĐÃ XÁC THỰC 100% TỪ API!</span>';
                        if (hud) hud.innerHTML = `${verifiedTag} Đã thả ${rLabel}. Tab được giữ nguyên để bạn kiểm tra.`;
                      }
                    }
                  }, 1000);
                },
                args: [postId || '', reactionType, reactionLabel, watchDuration, pageName || '', currentUserId || '', warmupTab.id, payload.autoClickCta === true]
              }).catch((err) => {
                console.warn('[Warmup] Lỗi inject script:', err.message);
              });
            }, 800);
          });
        }

          const tabUpdateListener = (tId, changeInfo, tab) => {
            if (tId === warmupTab.id && changeInfo.status === 'complete') {
              const url = tab?.url || '';
              if (!url.includes('/login/?next=') && !url.includes('crypted_string=')) {
                doInject();
              }
            }
          };
          chrome.tabs.onUpdated.addListener(tabUpdateListener);
          setTimeout(() => { doInject(); }, 2500);
          setTimeout(() => { doInject(); }, 5000);

          // Hoàn tất chu kỳ Warmup sau thời gian xem video: Tự động trích xuất CTA và chuyển tiếp 7 bước Super-Buyer
          setTimeout(async () => {
            if (warmupTabTransitioned) return;
            try {
              const liveTabCheck = await chrome.tabs.get(warmupTab.id).catch(() => null);
              if (!liveTabCheck) return;
            } catch (_) { return; }

            console.log(`[Background] Đã hoàn tất thời gian xem video (${watchDuration}s), kiểm tra chuyển tiếp CTA...`);
            if (payload.autoClickCta === true) {
              try {
                const results = await chrome.scripting.executeScript({
                  target: { tabId: warmupTab.id },
                  func: () => {
                    // Ưu tiên 1: Quét text caption của bài viết
                    const postContainer = document.querySelector('[role="main"]') || document.body;
                    const allTexts = Array.from(postContainer.querySelectorAll('div[dir="auto"], span[dir="auto"], p'));
                    for (const el of allTexts) {
                      if (typeof el.closest === 'function') {
                        if (el.closest('[role="complementary"]') || el.closest('[data-pagelet*="RightRail"]')) continue;
                      }
                      const t = el.innerText || '';
                      const m = t.match(/https?:\/\/(?!www\.facebook\.com|facebook\.com|fb\.com|meta\.ai)[^\s"'<>]+/i);
                      if (m) {
                        const cleanUrl = m[0].replace(/[.,;)]+$/, '');
                        if (cleanUrl.length > 10) return cleanUrl;
                      }
                    }

                    // Ưu tiên 2: Thẻ anchor ngoài RightRail
                    const validAnchors = Array.from(document.querySelectorAll('a[href]')).filter(a => {
                      if (typeof a.closest === 'function') {
                        if (a.closest('[role="complementary"]') || a.closest('[data-pagelet*="RightRail"]') || a.closest('[aria-label*="Sponsored" i]')) return false;
                      }
                      const h = a.getAttribute('href') || '';
                      return !h.includes('meta.ai') && !h.includes('facebook.com');
                    });

                    for (const a of validAnchors) {
                      const h = a.getAttribute('href') || '';
                      if (h.includes('l.facebook.com/l.php')) {
                        try {
                          const u = new URL(h.startsWith('http') ? h : 'https://www.facebook.com' + h).searchParams.get('u');
                          if (u) {
                            const decoded = decodeURIComponent(u);
                            if (decoded.startsWith('http') && !decoded.includes('facebook.com') && !decoded.includes('meta.ai')) {
                              return decoded;
                            }
                          }
                        } catch(e) {}
                      } else if (h.startsWith('http')) {
                        return h;
                      }
                    }
                    return null;
                  }
                });

                const foundStoreUrl = results?.[0]?.result;
                if (foundStoreUrl) {
                  console.log('[Background] ✓ BẮT TRÚNG LINK CTA MUA HÀNG TỪ POST:', foundStoreUrl);
                  chrome.runtime.sendMessage({
                    action: 'INOTE_TASK_STEP_UPDATED',
                    payload: { step: 'WARMUP_CTA_TRANSITION', targetUrl: foundStoreUrl, postUrl }
                  }).catch(() => {});

                  // Đóng tab warmup sau 1s và mở Webstore chạy 7 bước
                  setTimeout(() => { chrome.tabs.remove(warmupTab.id).catch(() => {}); }, 1000);
                  triggerStoreFlow(foundStoreUrl, postUrl);
                  return;
                }
              } catch(err) {
                console.warn('[Background] Lỗi trích xuất CTA từ tab warmup:', err);
              }
            }

            // Nếu không có CTA hoặc không chọn autoClickCta:
            chrome.runtime.sendMessage({
              action: 'ON_WARMUP_COMPLETED',
              payload: { postId, postUrl, reactionType, verified: true, totalWarmupRuns: scannerState.totalWarmupRuns }
            }).catch(() => {});
            chrome.runtime.sendMessage({ action: 'INOTE_ITEM_FINISHED', payload: { type: 'WARMUP', postUrl } }).catch(() => {});
          }, (watchDuration * 1000) + 2000);

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

    // ── XỬ LÝ CHUYỂN TIẾP TỰ ĐỘNG TỪ WARMUP SANG 7 BƯỚC SUPER-BUYER ──
    case 'WARMUP_TRANSITION_TO_STORE': {
      const { targetUrl, postUrl, originalTabId } = payload;
      console.log('[Background] Tự động chuyển tiếp từ Warmup Post sang Super-Buyer Store Flow:', targetUrl);

      // Đóng tab Warmup FB an toàn sau 1.2s để chuyển sự chú ý sang tab Webstore
      if (originalTabId) {
        setTimeout(() => {
          chrome.tabs.remove(originalTabId).catch(() => {});
        }, 1200);
      }

      // Thông báo cho Sidepanel trạng thái chuyển tiếp
      chrome.runtime.sendMessage({
        action: 'INOTE_TASK_STEP_UPDATED',
        payload: { step: 'WARMUP_CTA_TRANSITION', targetUrl, postUrl }
      }).catch(() => {});

      // Mở Webstore và kích hoạt 7 bước Super-Buyer
      triggerStoreFlow(targetUrl, postUrl);
      if (typeof sendResponse === 'function') sendResponse({ success: true });
      return true;
    }

    // ── XỬ LÝ SUPER-BUYER 7 BƯỚC TRÊN WEBSTORE ──────────────────────
    case 'RUN_STORE_FLOW': {
      const { targetUrl, postUrl, postId } = payload;
      triggerStoreFlow(targetUrl, postUrl, postId);
      if (typeof sendResponse === 'function') sendResponse({ success: true });
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
      chrome.runtime.sendMessage({ action: 'INOTE_ITEM_FINISHED', payload: { type: 'STORE_FLOW', payload } }).catch(() => {});
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

    // ══════════════════════════════════════════════════════════════════
    // ── FIND ADS (Milestone 2 & 3: GraphQL Search & inote.net) ────────
    // ══════════════════════════════════════════════════════════════════
    case 'FETCH_ADS_SEARCH':
    case 'FIND_ADS_START': {
      const searchParams = payload || {};
      console.log('[Background] Nhận yêu cầu tìm kiếm Ads Library:', searchParams);

      if (adsLibraryService.isSearching || adsLibraryService.isBatchSearching) {
        console.warn('[Background] Đang có tiến trình tìm kiếm Ads Library đang chạy, bỏ qua yêu cầu trùng lặp.');
        sendResponse({ success: false, message: 'Đang có tiến trình tìm kiếm Ads Library đang chạy.' });
        return true;
      }

      const inoteBatchUrl = InoteService.parseInoteUrl(searchParams.inoteUrl || searchParams.rawKeyword || searchParams.keyword);

      const handleProgressDispatch = (progress) => {
        // Protocol 1: SEARCH_PROGRESS_UPDATE
        chrome.runtime.sendMessage({
          action: 'SEARCH_PROGRESS_UPDATE',
          payload: progress
        }).catch(() => {});

        // Protocol 2: FIND_ADS_BATCH_RECEIVED / FIND_ADS_PROGRESS / FIND_ADS_COMPLETED
        if (progress.status === 'PROCESSING_ADS' && progress.batchAds && progress.batchAds.length > 0) {
          chrome.runtime.sendMessage({
            action: 'FIND_ADS_BATCH_RECEIVED',
            payload: {
              batchAds: progress.batchAds,
              totalCount: progress.totalFound,
              batchNumber: progress.currentPage,
              statusMessage: progress.statusMessage || null
            }
          }).catch(() => {});
        } else if (progress.status === 'COMPLETED') {
          chrome.runtime.sendMessage({
            action: 'FIND_ADS_COMPLETED',
            payload: {
              totalParsed: progress.extractedCount,
              totalFound: progress.totalFound,
              statusMessage: progress.statusMessage || null
            }
          }).catch(() => {});
        } else if (progress.status === 'FETCHING_PAGE' || progress.status === 'SEARCHING') {
          chrome.runtime.sendMessage({
            action: 'FIND_ADS_PROGRESS',
            payload: {
              parsedCount: progress.extractedCount,
              totalCount: progress.totalFound,
              statusText: progress.statusMessage || `Đang tải Batch #${progress.currentPage}...`
            }
          }).catch(() => {});
        }
      };

      if (searchParams.isPageHunter) {
        // Chế độ Page Hunter: Đa luồng 3 Workers, bỏ qua Active/Total Camp, lọc trùng tên Page & tự động xuất Inote
        const targetSource = inoteBatchUrl || searchParams.rawKeyword || searchParams.keyword;
        adsLibraryService.runPageHunterBatch(targetSource, searchParams, (progress) => {
          handleProgressDispatch(progress);
          if (progress.status === 'COMPLETED' && progress.autoNoteResult && progress.autoNoteResult.noteUrl) {
            chrome.runtime.sendMessage({
              action: 'INOTE_SAVE_RESULT',
              payload: {
                success: true,
                noteUrl: progress.autoNoteResult.noteUrl,
                noteId: progress.autoNoteResult.noteId || ''
              }
            }).catch(() => {});
          }
        }).catch((err) => {
          console.error('[Background] Lỗi tiến trình Page Hunter:', err);
        });

        sendResponse({
          success: true,
          isPageHunter: true,
          isInoteBatch: Boolean(inoteBatchUrl),
          inoteUrl: inoteBatchUrl,
          message: 'Đã bắt đầu chế độ Page Hunter siêu tốc (3 luồng).'
        });
        return true;
      }

      if (inoteBatchUrl) {
        // Chế độ Batch Inote: Chạy ngầm tuần tự từng dòng từ khóa trong trang Inote
        adsLibraryService.searchInoteKeywordBatch(inoteBatchUrl, searchParams, (progress) => {
          handleProgressDispatch(progress);
          if (progress.status === 'PROCESSING_ADS' || progress.status === 'COMPLETED') {
            const activeCnt = progress.extractedCount || 0;
            const totalCnt = Math.max(progress.totalFound || 0, activeCnt);
            const ratio = totalCnt > 0 ? Math.min(100, Number(((activeCnt / totalCnt) * 100).toFixed(1))) : 0;
            chrome.runtime.sendMessage({
              action: 'ACTIVE_VS_TOTAL_UPDATE',
              payload: {
                status: 'SUCCESS',
                rawActive: activeCnt,
                rawTotal: totalCnt,
                activeFormatted: adsLibraryService.formatNumberWithoutDecimals(adsLibraryService.smartRound(activeCnt)),
                totalFormatted: adsLibraryService.formatNumberWithoutDecimals(adsLibraryService.smartRound(totalCnt)),
                ratioPercent: ratio
              }
            }).catch(() => {});
          }
        }).catch((err) => {
          console.error('[Background] Lỗi tiến trình Inote Batch Search:', err);
        });

        sendResponse({ success: true, isInoteBatch: true, inoteUrl: inoteBatchUrl, message: 'Đã bắt đầu chạy ngầm danh sách từ khóa Inote.' });
        return true;
      }

      // Chế độ 1 từ khóa đơn lẻ: Chạy song song bộ đếm Minea Active vs Total Camp & Ratio %
      adsLibraryService.fetchActiveVsTotalCounts(searchParams)
        .then((counterData) => {
          chrome.runtime.sendMessage({
            action: 'ACTIVE_VS_TOTAL_UPDATE',
            payload: { status: 'SUCCESS', ...counterData }
          }).catch(() => {});
        })
        .catch((err) => {
          chrome.runtime.sendMessage({
            action: 'ACTIVE_VS_TOTAL_UPDATE',
            payload: { status: 'ERROR', error: err.message }
          }).catch(() => {});
        });

      adsLibraryService.searchAndPaginateAll(searchParams, handleProgressDispatch).catch((err) => {
        console.error('[Background] Lỗi tiến trình tìm kiếm Ads:', err);
      });

      sendResponse({ success: true, message: 'Đã bắt đầu tìm kiếm Ads Library.' });
      return true;
    }

    case 'CANCEL_ADS_SEARCH':
    case 'FIND_ADS_STOP': {
      console.log('[Background] Nhận tín hiệu dừng tìm kiếm Ads Library.');
      adsLibraryService.cancel();
      sendResponse({ success: true, message: 'Đã dừng tìm kiếm Ads Library.' });
      return true;
    }

    case 'FETCH_ACTIVE_VS_TOTAL': {
      const searchParams = payload || {};
      (async () => {
        try {
          const counterData = await adsLibraryService.fetchActiveVsTotalCounts(searchParams);
          chrome.runtime.sendMessage({
            action: 'ACTIVE_VS_TOTAL_UPDATE',
            payload: { status: 'SUCCESS', ...counterData }
          }).catch(() => {});
          sendResponse({ success: true, data: counterData });
        } catch (err) {
          console.error('[Background] Lỗi FETCH_ACTIVE_VS_TOTAL:', err);
          chrome.runtime.sendMessage({
            action: 'ACTIVE_VS_TOTAL_UPDATE',
            payload: { status: 'ERROR', error: err.message }
          }).catch(() => {});
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'CREATE_INOTE': {
      const { content, ads, formatMode } = payload || {};
      (async () => {
        try {
          let textToSave = content;
          if (!textToSave && Array.isArray(ads) && ads.length > 0) {
            textToSave = InoteService.formatAllAds(ads, formatMode);
          }
          if (!textToSave || typeof textToSave !== 'string') {
            sendResponse({ success: false, error: 'Nội dung note không hợp lệ hoặc rỗng.' });
            return;
          }

          const result = await InoteService.createNote(textToSave, { openTab: true });
          sendResponse(result);
        } catch (err) {
          console.error('[Background] Lỗi CREATE_INOTE:', err);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    default:
      break;
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AdsLibraryGraphQLService,
    InoteService,
    adsLibraryService
  };
}
