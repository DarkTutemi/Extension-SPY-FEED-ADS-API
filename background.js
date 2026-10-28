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
  settings: {
    minLikes: 500,
    videoEngagementRatio: '1/2',
    customRatio: 0.5,
    autoScroll: true,
    autoRefreshMinutes: 5
  }
};

let adLogsList = [];
let autoRefreshTimer = null;

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

chrome.storage.local.get(['adHunterSettings', 'adHunterLogs'], (res) => {
  if (res.adHunterSettings) {
    scannerState.settings = { ...scannerState.settings, ...res.adHunterSettings };
  }
  if (res.adHunterLogs) {
    adLogsList = res.adHunterLogs;
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

    default:
      break;
  }
});
