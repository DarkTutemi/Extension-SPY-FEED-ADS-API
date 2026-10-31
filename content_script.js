/**
 * content_script.js - FB Video Ads Hunter
 * Dual-Engine Scanner: GraphQL Interception + Realtime DOM Ad Inspection
 */

(function () {
  if (window.__FB_AD_HUNTER_CONTENT_LOADED__) return;
  window.__FB_AD_HUNTER_CONTENT_LOADED__ = true;

  // 1. Tiêm injected.js vào trang Facebook
  function injectMainWorldScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error('[ContentScript] Lỗi tiêm injected.js:', e);
    }
  }

  injectMainWorldScript();

  // 2. Trạng thái và Cài đặt
  let isScanning = false;
  let settings = {
    minLikes: 500,
    videoEngagementRatio: '1/2',
    customRatio: 0.5,
    autoScroll: true,
    warmupEnabled: true,
    warmupThreshold: 10,
    warmupWatchSeconds: 15
  };

  let consecutiveUnmatchedVideoCount = 0;
  chrome.storage.local.get(['consecutiveUnmatchedVideoCount'], (res) => {
    if (typeof res?.consecutiveUnmatchedVideoCount === 'number') {
      consecutiveUnmatchedVideoCount = res.consecutiveUnmatchedVideoCount;
      console.log('[Warmup Tracker] Khôi phục bộ đếm từ storage:', consecutiveUnmatchedVideoCount);
    }
  });

  let totalScanned = 0;
  let totalAdsFound = 0;
  let totalMatchedAds = 0;
  let latestCursor = null;
  let capturedDocId = null;
  const processedPostIds = new Set();
  const processedAdKeys = new Set();

  chrome.runtime.sendMessage({ action: 'GET_SCANNER_STATE' }, (res) => {
    if (res?.data?.settings) {
      settings = { ...settings, ...res.data.settings };
    }
  });

  // ── FEED POSTS REGISTRY (Đảm bảo liên kết FB Story Post 100% không bao giờ mất) ───────────
  function cleanName(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u034F\u200B-\u200D]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeRelayId(relayId) {
    if (!relayId || typeof relayId !== 'string') return null;
    try {
      const bin = atob(relayId);
      if (bin.startsWith('S:_I')) {
        const parts = bin.split(':');
        const pageRaw = parts[1]?.slice(2);
        const pageId = /^\d{5,}$/.test(pageRaw) ? pageRaw : null;
        const postId = parts.slice(2).find(x => /^\d{5,}$/.test(x) || /^pfbid\w+$/.test(x));
        if (pageId && postId) {
          return { pageId, postId, url: `https://www.facebook.com/story.php?story_fbid=${postId}&id=${pageId}` };
        }
      }
    } catch (e) {}
    return null;
  }

  const feedPostsRegistry = {
    byPageName: new Map(), // key: cleanName(pageName) -> entry
    byActorId: new Map(),  // key: String(actorId) -> entry
    byPostId: new Map(),   // key: String(postId) -> entry
    byNodeId: new Map()    // key: String(nodeId) -> entry
  };

  function registerFeedStoryNode(node) {
    if (!node) return null;
    const header = node.comet_sections?.header?.story;
    const actor = header?.actors?.[0] || (Array.isArray(node.actors) ? node.actors[0] : {});
    const pageName = actor.name || null;
    const pageUrl = actor.url || null;
    let actorId = actor.id || null;

    let postId = node.post_id || node.legacy_fbid || null;
    let storyUrl = null;

    if (node.id) {
      const decoded = decodeRelayId(node.id);
      if (decoded) {
        if (!actorId) actorId = decoded.pageId;
        if (!postId) postId = decoded.postId;
        storyUrl = decoded.url;
      }
    }

    const validActor = actorId && /^\d{5,}$/.test(String(actorId));
    const validPost = postId && (/^\d{5,}$/.test(String(postId)) || /^pfbid\w+$/.test(String(postId)));

    if (!storyUrl && validActor && validPost) {
      storyUrl = `https://www.facebook.com/story.php?story_fbid=${postId}&id=${actorId}`;
    } else if (!storyUrl && validPost) {
      storyUrl = `https://www.facebook.com/${postId}`;
    }

    if (!storyUrl && node.permalink_url) {
      storyUrl = node.permalink_url;
    }

    const entry = {
      postId,
      actorId,
      pageName,
      pageUrl,
      storyUrl,
      permalinkUrl: node.permalink_url || null,
      nodeId: node.id || null
    };

    if (pageName) feedPostsRegistry.byPageName.set(cleanName(pageName), entry);
    if (actorId) feedPostsRegistry.byActorId.set(String(actorId), entry);
    if (postId) feedPostsRegistry.byPostId.set(String(postId), entry);
    if (node.id) feedPostsRegistry.byNodeId.set(String(node.id), entry);

    return entry;
  }

  const pendingGraphqlAds = new Map(); // key: cleanName(pageName) & actorId -> graphqlData
  const pendingGraphqlAdsById = new Map(); // key: postId -> graphqlData

  // 3. Logic Đánh Giá Bộ Lọc 5 Tiêu Chí & Sinh Log
  function auditAndFilterAd({ adId, pageName, pageUrl, isVerified, mediaType, videoDuration, videoStreamUrl, likes, comments, shares, buttonText, targetUrl, contentText, headline, domain, postUrl }) {
    if (!adId || processedAdKeys.has(String(adId))) return null;

    // Kiểm tra an toàn kép: Tuyệt đối không cho bài viết Hữu cơ (Organic Post / Paid Partnership) lọt vào bộ đếm Ads và Warmup
    const hasPaidPartnership = /paid\s+partnership|hợp\s+tác\s+trả\s+phí/i.test(contentText || '') || /paid\s+partnership|hợp\s+tác\s+trả\s+phí/i.test(headline || '');
    if (hasPaidPartnership && !buttonText && !targetUrl) {
      console.warn(`[ContentScript] Loại trừ bài Creator Paid partnership hữu cơ không phải Ads: "${pageName}"`);
      return null;
    }

    processedAdKeys.add(String(adId));

    totalAdsFound++;
    const minLikesThreshold = parseInt(settings.minLikes, 10) || 500;
    const hasWebstore = Boolean(targetUrl && !targetUrl.includes('facebook.com/sharer') && targetUrl !== '#');

    const auditChecks = [];

    // Tiêu chí 1: Link Webstore ngoài
    if (!hasWebstore) {
      auditChecks.push({ pass: false, desc: 'Không có liên kết Webstore ngoài' });
    } else {
      auditChecks.push({ pass: true, desc: `Có liên kết Webstore (${buttonText || 'Shop now'})` });
    }

    // Tiêu chí 2: Định dạng Video
    if (mediaType !== 'VIDEO') {
      auditChecks.push({ pass: false, desc: `Không phải Video (Định dạng: ${mediaType})` });
    } else {
      auditChecks.push({ pass: true, desc: `Là Video Ads (${videoDuration ? videoDuration + 's' : 'chuẩn'})` });
    }

    // Tiêu chí 3: Chưa có tích xanh (loại bỏ thương hiệu lớn, giữ shop thực chiến)
    if (isVerified) {
      auditChecks.push({ pass: false, desc: 'Fanpage có tích xanh (Thương hiệu lớn)' });
    } else {
      auditChecks.push({ pass: true, desc: 'Fanpage chưa tích xanh (Shop thực chiến)' });
    }

    // Tiêu chí 4: Lượng Like tối thiểu
    if (likes < minLikesThreshold) {
      auditChecks.push({ pass: false, desc: `Chưa đủ Like (${likes.toLocaleString()} / cần >= ${minLikesThreshold.toLocaleString()})` });
    } else {
      auditChecks.push({ pass: true, desc: `Đạt ngưỡng Like (${likes.toLocaleString()} >= ${minLikesThreshold.toLocaleString()})` });
    }

    // Tiêu chí 5: Chống Buff ảo & Tỉ lệ thảo luận
    const maxAllowedShares = Math.max(1, comments) * 5;
    if (shares > maxAllowedShares) {
      auditChecks.push({ pass: false, desc: `Phát hiện buff share ảo (Share: ${shares.toLocaleString()} > 5x Cmt: ${(comments * 5).toLocaleString()})` });
    } else {
      auditChecks.push({ pass: true, desc: `Tương tác tự nhiên (Share: ${shares.toLocaleString()} <= 5x Cmt)` });
    }

    if (settings.videoEngagementRatio && settings.videoEngagementRatio !== 'none') {
      let targetRatio = 0.5;
      if (settings.videoEngagementRatio === '1/2') targetRatio = 0.5;
      else if (settings.videoEngagementRatio === '1/3') targetRatio = 1 / 3;
      else if (settings.videoEngagementRatio === '1/4') targetRatio = 0.25;
      else if (settings.videoEngagementRatio === '1/5') targetRatio = 0.2;

      const targetVal = likes * targetRatio;
      const minAllowed = Math.round(targetVal * 0.80);
      const maxAllowed = Math.round(targetVal * 1.20);

      const isCmtOk = comments >= minAllowed && comments <= maxAllowed;
      const isShareOk = shares >= minAllowed && shares <= maxAllowed;

      if (!isCmtOk) {
        auditChecks.push({
          pass: false,
          desc: `Comment lệch tỉ lệ ${settings.videoEngagementRatio} (Có: ${comments.toLocaleString()} / Cần: ${minAllowed.toLocaleString()}–${maxAllowed.toLocaleString()})`
        });
      } else {
        auditChecks.push({
          pass: true,
          desc: `Comment chuẩn tỉ lệ ${settings.videoEngagementRatio} (${comments.toLocaleString()} nằm trong [${minAllowed.toLocaleString()}–${maxAllowed.toLocaleString()}])`
        });
      }

      if (!isShareOk) {
        auditChecks.push({
          pass: false,
          desc: `Share lệch tỉ lệ ${settings.videoEngagementRatio} (Có: ${shares.toLocaleString()} / Cần: ${minAllowed.toLocaleString()}–${maxAllowed.toLocaleString()})`
        });
      } else {
        auditChecks.push({
          pass: true,
          desc: `Share chuẩn tỉ lệ ${settings.videoEngagementRatio} (${shares.toLocaleString()} nằm trong [${minAllowed.toLocaleString()}–${maxAllowed.toLocaleString()}])`
        });
      }
    }

    const isMatched = auditChecks.every(c => c.pass);
    const timestamp = new Date().toLocaleTimeString('vi-VN');

    let isWarmup = false;

    if (!isMatched) {
      // ── BỘ ĐẾM WARMUP: CHỈ CÓ TÁC DỤNG VÀ CHỈ ĐẾM POST ADS VIDEO CỦA FANPAGE KHÔNG CÓ TÍCH XANH ──
      if (mediaType === 'VIDEO') {
        const threshold = settings.warmupThreshold || 10;

        // Nếu Fanpage có tích xanh: HOÀN TOÀN BỎ QUA, KHÔNG ĐẾM, KHÔNG RESET BỘ ĐẾM
        if (isVerified) {
          console.log(`[Warmup Tracker] Bỏ qua Fanpage có tích xanh ("${pageName}"). Giữ nguyên bộ đếm: ${consecutiveUnmatchedVideoCount}/${threshold}`);
        } else {
          // Chỉ đếm những bài Video Ads thực sự của Fanpage CHƯA có tích xanh
          if (consecutiveUnmatchedVideoCount < threshold) {
            consecutiveUnmatchedVideoCount++;
            console.log(`[Warmup Tracker] Video Ads không tích xanh trượt tiêu chí: ${consecutiveUnmatchedVideoCount}/${threshold} | Fanpage: "${pageName}"`);
            chrome.storage.local.set({ consecutiveUnmatchedVideoCount });
            chrome.runtime.sendMessage({
              action: 'ON_WARMUP_PROGRESS',
              payload: { current: consecutiveUnmatchedVideoCount, threshold }
            }).catch(() => {});
          } else {
            // ĐÃ CÓ ĐỦ 10 BÀI TRƯỢT TRƯỚC ĐÓ -> ĐÂY CHÍNH LÀ BÀI THỨ 11!
            isWarmup = true;
            console.log(`[Warmup Tracker] 🔥 ĐÃ CÓ ĐỦ ${threshold} BÀI TRƯỢT TRƯỚC ĐÓ! Kích hoạt Warmup Cycle trên bài thứ ${threshold + 1} (Fanpage: "${pageName}")...`);
            consecutiveUnmatchedVideoCount = 0; // Reset lại bộ đếm sau khi đã kích hoạt
            chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });
            chrome.runtime.sendMessage({
              action: 'ON_WARMUP_PROGRESS',
              payload: { current: 0, threshold }
            }).catch(() => {});
            chrome.runtime.sendMessage({
              action: 'RUN_WARMUP_FLOW',
              payload: {
                postUrl: postUrl || location.href,
                postId: adId,
                pageName,
                watchSeconds: settings.warmupWatchSeconds || 15
              }
            }).catch(() => {});
          }
        }
      }
    } else if (mediaType === 'VIDEO' && !isVerified) {
      // Chỉ khi gặp bài Video Ads của Fanpage không tích xanh THỎA MÃN thì mới reset
      consecutiveUnmatchedVideoCount = 0;
      chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });
      chrome.runtime.sendMessage({
        action: 'ON_WARMUP_PROGRESS',
        payload: { current: 0, threshold: settings.warmupThreshold || 10 }
      }).catch(() => {});
    }

    if (isWarmup) {
      auditChecks.unshift({
        pass: true,
        desc: `🔥 ĐÃ THỰC HIỆN WARMUP (Tương tác bài thứ 11 sau 10 bài video ads không tích xanh trượt: Thả Reaction & Xem ${settings.warmupWatchSeconds || 15}s)`
      });
    }

    // Bắn log về background & side panel
    const logEntry = {
      adId,
      pageName,
      pageUrl,
      postUrl,
      mediaType,
      isVerified,
      likes,
      comments,
      shares,
      buttonText,
      targetUrl,
      isMatched,
      isWarmup,
      warmupInfo: isWarmup ? {
        watchSeconds: settings.warmupWatchSeconds || 15,
        executedAt: timestamp
      } : null,
      auditChecks,
      timestamp
    };

    chrome.runtime.sendMessage({
      action: 'NEW_AD_LOG_ENTRY',
      payload: logEntry
    }).catch(() => {});

    if (!isMatched) {
      return null;
    }

    // Nếu bài thỏa mãn (isMatched === true):
    if (mediaType === 'VIDEO' && !isVerified) {
      consecutiveUnmatchedVideoCount = 0;
      chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });
    }
    totalMatchedAds++;
    const matchedAd = {
      adId,
      page: {
        id: null,
        name: pageName,
        url: pageUrl,
        isVerified: false
      },
      post: {
        id: adId,
        url: postUrl,
        content: contentText,
        mediaType: 'VIDEO',
        videoDuration,
        videoStreamUrl
      },
      cta: {
        buttonText: buttonText || 'Shop now',
        targetUrl,
        headline,
        domain
      },
      metrics: {
        likes,
        comments,
        shares,
        cmtRatio: likes > 0 ? (comments / likes).toFixed(2) : '0',
        shareRatio: likes > 0 ? (shares / likes).toFixed(2) : '0'
      },
      capturedAt: timestamp
    };

    chrome.runtime.sendMessage({
      action: 'AD_MATCHED',
      payload: matchedAd
    }).catch(() => {});

    // Kích hoạt Super-Buyer Store Flow nếu có link webstore ngoài
    if (targetUrl) {
      console.log('[ContentScript] Bài thỏa mãn! Đang kích hoạt Super-Buyer Store Flow tới:', targetUrl);
      chrome.runtime.sendMessage({
        action: 'RUN_STORE_FLOW',
        payload: {
          targetUrl,
          postUrl,
          postId: adId
        }
      }).catch(() => {});
    }

    return matchedAd;
  }

  // 3b. Phân giải link bài post Facebook chuẩn dạng story.php?story_fbid=...&id=...
  async function resolveFbStoryUrl({ candidateUrl, nodeId, actorId, postId }) {
    // 1. Giải mã trực tiếp từ Relay Base64 (nodeId bắt đầu bằng 'UzpfST' tương đương 'S:_I<pageId>:<postId>')
    if (nodeId && typeof nodeId === 'string') {
      const decoded = decodeRelayId(nodeId);
      if (decoded?.url) return decoded.url;
    }

    // 2. Nếu đã có actorId (Page ID) và postId (hoặc pfbid)
    const validActor = actorId && /^\d{5,}$/.test(String(actorId));
    const validPost = postId && (/^\d{5,}$/.test(String(postId)) || /^pfbid\w+$/.test(String(postId)));
    if (validActor && validPost) {
      return `https://www.facebook.com/story.php?story_fbid=${postId}&id=${actorId}`;
    }
    if (!validActor && validPost) {
      return `https://www.facebook.com/${postId}`;
    }

    // 3. Phân giải từ URL bài viết / Reel
    if (candidateUrl && typeof candidateUrl === 'string') {
      try {
        const q = new URL(candidateUrl, location.href);
        if (/(^|\.)facebook\.com$/.test(q.hostname)) {
          const existingPost = q.searchParams.get('story_fbid');
          const existingPage = q.searchParams.get('id');
          if (existingPost && existingPage && /^\d+$/.test(existingPage) && /^(\d+|pfbid\w+)$/.test(existingPost)) {
            return `https://www.facebook.com/story.php?story_fbid=${existingPost}&id=${existingPage}`;
          }

          if (q.pathname.includes('/posts/') || q.pathname.includes('/reel/')) {
            return q.origin + q.pathname;
          }
          if (q.pathname.includes('/watch') && q.searchParams.has('v')) {
            return `https://www.facebook.com/watch/?v=${q.searchParams.get('v')}`;
          }
          if (q.pathname.includes('/photo') && q.searchParams.has('fbid')) {
            return `https://www.facebook.com/photo/?fbid=${q.searchParams.get('fbid')}`;
          }

          return candidateUrl;
        }
      } catch (err) {}
    }

    return null;
  }

  // 3c. Trích xuất Post URL từ DOM Card (Không phụ thuộc vào GraphQL hay React Fiber)
  function extractPostUrlFromDomCard(card, { pageId, pageName, pageUrl }) {
    if (!card) return null;
    const anchors = Array.from(card.querySelectorAll('a'));
    const hrefs = anchors.map(a => a.href).filter(Boolean);

    // 1. Quét các liên kết trực tiếp bài viết / Reel / Watch / Photo / Permalink
    for (const h of hrefs) {
      if (/story_fbid=|\/posts\/|\/permalink\.php|\/reel\/\d|\/watch\/?\?v=|\/photo\/?\?fbid=|video\.php\?v=/.test(h)) {
        try {
          const u = new URL(h, location.href);
          if (u.pathname.includes('/posts/') || u.pathname.includes('/reel/')) {
            return u.origin + u.pathname;
          }
          if (u.searchParams.has('story_fbid') && u.searchParams.has('id')) {
            return `https://www.facebook.com/story.php?story_fbid=${u.searchParams.get('story_fbid')}&id=${u.searchParams.get('id')}`;
          }
          if (u.pathname.includes('/watch') && u.searchParams.has('v')) {
            return `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`;
          }
          if (u.pathname.includes('/photo') && u.searchParams.has('fbid')) {
            return `https://www.facebook.com/photo/?fbid=${u.searchParams.get('fbid')}`;
          }
          return u.origin + u.pathname;
        } catch(e) {
          return h;
        }
      }
    }

    // 2. Trích xuất từ Comment Anchors (chứa /reel/ hoặc comment_id Base64 mã hóa postId)
    for (const h of hrefs) {
      const reelMatch = h.match(/\/reel\/(\d+)/);
      if (reelMatch && reelMatch[1]) {
        return `https://www.facebook.com/reel/${reelMatch[1]}`;
      }

      if (h.includes('comment_id=')) {
        try {
          const u = new URL(h, location.href);
          const rawCid = u.searchParams.get('comment_id');
          if (rawCid) {
            let decoded = '';
            try { decoded = atob(rawCid); } catch(e) {}
            const m = decoded.match(/comment:(\d+)_/);
            if (m && m[1]) {
              const extractedPostId = m[1];
              if (pageId) {
                return `https://www.facebook.com/story.php?story_fbid=${extractedPostId}&id=${pageId}`;
              }
              if (pageUrl && !pageUrl.includes('profile.php')) {
                const slug = pageUrl.split('facebook.com/')[1]?.split('?')[0]?.replace(/\//g, '');
                if (slug) return `https://www.facebook.com/${slug}/posts/${extractedPostId}`;
              }
              return `https://www.facebook.com/${extractedPostId}`;
            }
          }
        } catch(e) {}
      }
    }

    // 3. Trích xuất Video ID từ thuộc tính data-video-id của thẻ video
    const videoEl = card.querySelector('video') || card.querySelector('[data-video-id]');
    const videoId = videoEl?.getAttribute('data-video-id') || null;
    if (videoId && /^\d+$/.test(videoId)) {
      if (pageId) {
        return `https://www.facebook.com/story.php?story_fbid=${videoId}&id=${pageId}`;
      }
      return `https://www.facebook.com/watch/?v=${videoId}`;
    }

    // 4. Tìm bất kỳ ID số dài nào (>12 số) trong các liên kết trên card
    if (pageId) {
      for (const h of hrefs) {
        const numMatch = h.match(/[?&](?:fbid|story_fbid|v|id)=(\d{10,})/);
        if (numMatch && numMatch[1] && numMatch[1] !== pageId) {
          return `https://www.facebook.com/story.php?story_fbid=${numMatch[1]}&id=${pageId}`;
        }
      }
    }

    // 5. Dự phòng an toàn: Sử dụng URL Fanpage kèm anchor bài viết
    if (pageUrl) {
      return pageUrl;
    }

    return null;
  }

  // 3c. Trích xuất chính xác toàn bộ dữ liệu thẻ Ads từ DOM Card
  function extractDataFromDomCard(card) {
    const text = card.innerText || '';

    // 1. Tên Fanpage
    const h = card.querySelector('h4, h3, h2');
    const pageLink = h ? h.querySelector('a') : card.querySelector('a[role="link"]');
    let pageName = pageLink ? pageLink.innerText.trim() : (h ? h.innerText.split('\n')[0].trim() : 'Unknown Page');
    if (pageName.includes('\n')) pageName = pageName.split('\n')[0].trim();
    const pageUrl = pageLink ? pageLink.href : null;

    // 2. Kiểm tra Tích Xanh (Verified Badge)
    const isVerified = Boolean(
      card.querySelector('svg[title="Verified account"]') ||
      card.querySelector('svg[title="Tài khoản đã xác minh"]') ||
      card.querySelector('svg[aria-label*="Verified"]') ||
      card.querySelector('svg[aria-label*="xác minh"]') ||
      Array.from(card.querySelectorAll('svg title')).some(t => /verified|xác minh/i.test(t.textContent || '')) ||
      /title="Verified account"|title="Tài khoản đã xác minh"|aria-label="[^"]*Verified/i.test(card.innerHTML)
    );

    // 3. Media Type & Stream URL
    const videoEl = card.querySelector('video');
    const isVideo = Boolean(videoEl || text.includes('0:00 /') || card.querySelector('div[aria-label="Play video"]'));
    const mediaType = isVideo ? 'VIDEO' : 'PHOTO';
    const videoStreamUrl = videoEl ? (videoEl.currentSrc || videoEl.src) : null;

    // 4. Bóc tách Like, Comment, Share thời gian thực
    let likes = 0, comments = 0, shares = 0;
    const buttons = Array.from(card.querySelectorAll('div[role="button"], a[role="button"], span[role="toolbar"] *'));
    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const t = (btn.innerText || '').trim();

      if (aria === 'like' || aria.includes('thích') || aria.startsWith('like:')) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) likes = parseMetricNumber(t);
        else if (likes === 0 && aria.includes(':')) {
          const m = aria.match(/like:\s*([\d.,]+[KkMm]?)/i);
          if (m) likes = parseMetricNumber(m[1]);
        }
      } else if (aria.includes('comment') || aria.includes('bình luận')) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) comments = parseMetricNumber(t);
      } else if (aria.includes('share') || aria.includes('chia sẻ')) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) shares = parseMetricNumber(t);
      }
    }

    // Dự phòng qua các dòng text nếu button không trả đủ 3 chỉ số
    if (likes === 0 || comments === 0 || shares === 0) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const metricLines = lines.filter(l => /^[0-9.,]+[KkMm]?$/.test(l) && !l.includes(':'));
      if (likes === 0 && metricLines[0]) likes = parseMetricNumber(metricLines[0]);
      if (comments === 0 && metricLines[1]) comments = parseMetricNumber(metricLines[1]);
      if (shares === 0 && metricLines[2]) shares = parseMetricNumber(metricLines[2]);
    }

    // 5. Liên kết Webstore ngoài & CTA Text
    const linkshim = card.querySelector('a[href*="l.facebook.com/l.php"], a[href*="fbclid="], a[target="_blank"]:not([href*="facebook.com"])');
    let targetUrl = null;
    if (linkshim) {
      try {
        if (linkshim.href.includes('l.facebook.com/l.php')) {
          const u = new URL(linkshim.href);
          const rawParam = u.searchParams.get('u');
          if (rawParam && rawParam.startsWith('http')) {
            targetUrl = decodeURIComponent(rawParam);
          } else {
            targetUrl = linkshim.href;
          }
        } else if (!linkshim.href.includes('facebook.com/')) {
          targetUrl = linkshim.href;
        }
      } catch (e) {
        targetUrl = linkshim.href;
      }
    }

    const domainMatch = text.match(/([a-zA-Z0-9-]+\.(?:com|co|store|shop|io|net|org))\b/i);
    const domain = domainMatch ? domainMatch[1].toLowerCase() : '';
    if ((!targetUrl || targetUrl.includes('facebook.com')) && domain) {
      targetUrl = 'https://' + domain;
    }

    // Chuẩn hóa khoảng trắng & ký tự Unicode không ngắt dòng (non-breaking space \u00A0)
    function cleanChar(c) {
      if (!c) return '';
      return c.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, ' ')
              .replace(/[\u034F\u200B-\u200D]/g, '');
    }

    function cleanCtaText(s) {
      if (!s) return '';
      return cleanChar(s).replace(/\s+/g, ' ').trim();
    }

    // Giải mã nhãn CTA bị xáo trộn bởi CometGHLScrambledLabel (CSS order / position absolute decoy)
    function unscrambleGhlText(container) {
      if (!container) return '';
      const leaves = Array.from(container.querySelectorAll('*')).filter(el => el.children.length === 0 && el.textContent);
      if (leaves.length === 0) return cleanCtaText(container.innerText || container.textContent || '');

      const visibleParts = [];
      for (const leaf of leaves) {
        const style = window.getComputedStyle(leaf);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'absolute') {
          continue;
        }
        const raw = cleanChar(leaf.textContent);
        if (!raw) continue;
        const order = parseInt(style.order, 10) || 0;
        visibleParts.push({ text: raw, order });
      }

      if (visibleParts.length > 0) {
        visibleParts.sort((a, b) => a.order - b.order);
        return visibleParts.map(p => p.text).join('').replace(/\s+/g, ' ').trim();
      }
      return cleanCtaText(container.innerText || container.textContent || '');
    }

    const CTA_MATCH_PATTERN = /\b(shop\s*now|order\s*now|learn\s*more|sign\s*up|get\s*offer|buy\s*now|book\s*now|contact\s*us|send\s*message|install\s*now|apply\s*now|watch\s*more|donate\s*now|subscribe|get\s*quote|download|claim\s*offer|open\s*now|try\s*it|mua\s*ngay|đặt\s*ngay|tìm\s*hiểu\s*thêm|đăng\s*ký|nhận\s*ưu\s*đãi|gửi\s*tin\s*nhắn)\b/i;

    function formatCta(s) {
      const cleaned = s.replace(/\s+/g, ' ').trim().toLowerCase();
      const standardMap = {
        'shopnow': 'Shop now',
        'ordernow': 'Order now',
        'learnmore': 'Learn more',
        'signup': 'Sign up',
        'getoffer': 'Get offer',
        'buynow': 'Buy now',
        'booknow': 'Book now',
        'contactus': 'Contact us',
        'sendmessage': 'Send message',
        'installnow': 'Install now',
        'applynow': 'Apply now',
        'watchmore': 'Watch more',
        'donatenow': 'Donate now',
        'getquote': 'Get quote',
        'claimoffer': 'Claim offer',
        'opennow': 'Open now',
        'tryit': 'Try it',
        'muangay': 'Mua ngay',
        'đặtngay': 'Đặt ngay'
      };
      const noSpace = cleaned.replace(/\s+/g, '');
      if (standardMap[noSpace]) return standardMap[noSpace];
      return cleaned.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    let buttonText = null;

    // 1. Quét các phần tử chứa link ngoài hoặc nút bấm (hỗ trợ giải mã nhãn GHL Scrambled)
    const candidateEls = Array.from(card.querySelectorAll('a[href*="l.facebook.com"], a[role="link"], a[role="button"], div[role="button"], button, a'));
    for (const el of candidateEls) {
      // Ưu tiên giải mã chống scramble của Facebook
      const unscrambled = unscrambleGhlText(el);
      const m1 = unscrambled.match(CTA_MATCH_PATTERN);
      if (m1) {
        buttonText = formatCta(m1[1]);
        break;
      }

      // Quét text tiêu chuẩn
      const t = cleanCtaText(el.innerText || el.textContent);
      const m2 = t.match(CTA_MATCH_PATTERN);
      if (m2) {
        buttonText = formatCta(m2[1]);
        break;
      }

      // Quét aria-label
      const aria = cleanCtaText(el.getAttribute('aria-label') || '');
      const m3 = aria.match(CTA_MATCH_PATTERN);
      if (m3) {
        buttonText = formatCta(m3[1]);
        break;
      }
    }

    // 2. Nếu chưa thấy, quét các thẻ div / span con
    if (!buttonText) {
      const subEls = Array.from(card.querySelectorAll('span, div'));
      for (const el of subEls) {
        const unscrambled = unscrambleGhlText(el);
        const m = unscrambled.match(CTA_MATCH_PATTERN);
        if (m) {
          buttonText = formatCta(m[1]);
          break;
        }
      }
    }

    // 6. Nội dung & Headline
    const contentText = text.substring(0, 300);
    const headline = domain ? text.split(domain.toUpperCase())[1]?.split('\n')[0]?.trim() || '' : '';

    return {
      pageName,
      pageUrl,
      isVerified,
      mediaType,
      videoStreamUrl,
      likes,
      comments,
      shares,
      buttonText,
      targetUrl,
      domain,
      contentText,
      headline
    };
  }

  // Helper tìm DOM card theo tên page
  function findDomCardByPageName(pageName) {
    if (!pageName || pageName === 'Unknown Page') return null;
    const cards = Array.from(document.querySelectorAll(
      'div.x1a2a7pz, div[role="article"], div[data-pagelet*="FeedUnit"], div.x1yztbdb, div[role="feed"] > div, div[role="dialog"]'
    ));
    return cards.find(c => {
      const t = c.innerText || '';
      return t.includes(pageName);
    });
  }

  // 3d. Nhận diện bài viết Hữu Cơ (Organic Post): Bạn bè, Nhóm, Cá nhân, hoặc Creator Paid Partnership
  // Nguyên tắc: Bài Ads THẬT sự của Facebook KHÔNG BAO GIỜ có ngày giờ đăng tự nhiên hoặc icon quyền riêng tư (Public/Friends)
  function isOrganicPostDom(card) {
    if (!card) return false;
    const text = card.innerText || '';

    // 1. Nếu có nhãn "Paid partnership" hoặc "Hợp tác trả phí" mà KHÔNG CÓ chữ "Sponsored" / "Được tài trợ"
    const hasPaidPartnership = /paid\s+partnership|hợp\s+tác\s+trả\s+phí/i.test(text);
    const hasSponsoredWord = /\b(sponsored|được\s+tài\s+trợ)\b/i.test(text);
    if (hasPaidPartnership && !hasSponsoredWord) {
      return true; // Đây là bài Branded Content hữu cơ của Creator/KOL, không phải Facebook Ads trả tiền
    }

    // 2. Kiểm tra Icon quyền riêng tư (Privacy Scope Icon) - Chỉ có trên bài Organic, Ads không bao giờ có
    const hasPrivacyScope = Boolean(
      card.querySelector('svg[aria-label*="Public" i], svg[aria-label*="Công khai" i], svg[aria-label*="Friends" i], svg[aria-label*="Bạn bè" i], svg[aria-label*="Custom" i], svg[aria-label*="Tùy chỉnh" i]') ||
      card.querySelector('span[aria-label*="Shared with Public" i], span[aria-label*="Chia sẻ với Công khai" i], span[aria-label*="Shared with Friends" i], span[aria-label*="Chia sẻ với bạn bè" i]')
    );
    if (hasPrivacyScope && !hasSponsoredWord) {
      return true; // Có biểu tượng quả địa cầu hoặc bạn bè -> Bài Organic 100%
    }

    // 3. Kiểm tra ngày giờ đăng tự nhiên (Organic Post Timestamp):
    // Facebook Ads KHÔNG BAO GIỜ hiển thị ngày giờ đăng (như October 22, 2 hrs, 1 d, Hôm qua...)
    // Dòng thời gian đó của bài Ads bị thay thế 100% bằng chữ "Sponsored" / "Được tài trợ"
    const headerEl = card.querySelector('h2, h3, h4')?.parentElement;
    const headerText = headerEl ? (headerEl.innerText || '') : text.substring(0, 300);
    const organicDatePattern = /\b(?:\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Tháng\s+\d{1,2})|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\d+\s*(?:hrs?|mins?|days?|wks?|thg|giờ|phút|ngày|tuần)\b|yesterday|hôm\s+qua|vừa\s+xong|just\s+now)/i;

    if (organicDatePattern.test(headerText) && !hasSponsoredWord) {
      return true;
    }

    return false;
  }

  // 4. Engine A: Đánh giá GraphQL Story Node
  async function evaluateGraphqlStory(node) {
    if (!node) return;
    totalScanned++;

    const regEntry = registerFeedStoryNode(node);

    // LOẠI TRỪ 100%: Bài viết trong Group (Nhóm) hoặc cá nhân không phải Fanpage Ads
    const isGroupPost = Boolean(
      node.comet_sections?.header?.story?.group ||
      node.group ||
      (regEntry?.pageUrl && regEntry.pageUrl.includes('/groups/')) ||
      (regEntry?.storyUrl && regEntry.storyUrl.includes('/groups/'))
    );
    if (isGroupPost) return;

    const header = node.comet_sections?.header?.story;
    const content = node.comet_sections?.content?.story;
    const feedback = node.comet_sections?.feedback?.story?.feedback;
    const attachment = content?.attachments?.[0]?.styles?.attachment || (Array.isArray(node.attachments) ? node.attachments[0] : null);

    // LOẠI TRỪ 100%: Bài viết Hữu Cơ (Organic Post) có quyền riêng tư (Public/Friends)
    // Quảng cáo Facebook Ads KHÔNG BAO GIỜ có privacy_scope
    if (header?.privacy_scope || node.privacy_scope) return;

    // LOẠI TRỪ 100%: Bài Creator Paid Partnership tự nhiên (Không chạy Ads trả tiền)
    const hasBrandedContent = Boolean(
      header?.has_branded_content ||
      node.has_branded_content ||
      header?.branded_content_sponsor_page ||
      node.branded_content_sponsor_page
    );
    const sponsoredData = header?.sponsored_data || node.sponsored_data;
    const hasRealAdId = Boolean(sponsoredData?.ad_id && /^\d{6,}$/.test(String(sponsoredData.ad_id)));

    if (hasBrandedContent && !hasRealAdId) {
      return; // Bài Paid Partnership của Creator, không phải Ads chạy trả tiền
    }

    // TIÊU CHUẨN XÁC ĐỊNH BÀI ADS TRONG GRAPHQL:
    // Phải có sponsored_data thật của Facebook với is_sponsored === true hoặc ad_id thật
    const isSponsored = Boolean(
      (sponsoredData?.is_sponsored === true && (hasRealAdId || sponsoredData.client_token)) ||
      hasRealAdId
    );
    if (!isSponsored) return;

    const actor = header?.actors?.[0] || (Array.isArray(node.actors) ? node.actors[0] : {});
    const pageName = actor.name || regEntry?.pageName || 'Unknown Page';
    const pageUrl = actor.url || regEntry?.pageUrl || null;
    const actorId = actor.id || regEntry?.actorId || null;

    let isVerified = Boolean(
      actor.is_verified === true ||
      actor.verification_status === 'BLUE_VERIFIED' ||
      actor.verification_status === 'VERIFIED'
    );

    const media = attachment?.media;
    let mediaType = 'PHOTO';
    if (media?.__typename === 'Video' || media?.playable_url || media?.playable_duration_in_ms) {
      mediaType = 'VIDEO';
    } else if (attachment?.subattachments?.length > 0) {
      mediaType = 'CAROUSEL';
    }

    const videoDuration = media?.playable_duration_in_ms ? Math.round(media.playable_duration_in_ms / 1000) : null;
    const videoStreamUrl = media?.playable_url || media?.browser_native_hd_url || null;

    const cta = attachment?.call_to_action;
    let targetUrl = cta?.action_link?.url || null;
    let buttonText = cta?.action_link?.title;
    if (!buttonText && cta?.type) {
      buttonText = cta.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    let likes = feedback?.reaction_count?.count || (node.feedback?.reaction_count?.count || 0);
    let comments = feedback?.comment_rendering_instance?.comments?.total_count || 0;
    let shares = feedback?.share_count?.count || 0;

    const postId = node.post_id || regEntry?.postId || (sponsoredData && sponsoredData.ad_id) || `ad_${Date.now()}`;
    const contentText = content?.message?.text || node.message?.text || '';
    const headline = attachment?.title_with_entities?.text || '';
    const domain = attachment?.source?.text || '';

    let postUrl = regEntry?.storyUrl || node.permalink_url || null;
    const validActor = actorId && /^\d{5,}$/.test(String(actorId));
    const validPost = postId && (/^\d{5,}$/.test(String(postId)) || /^pfbid\w+$/.test(String(postId)));
    if (!postUrl && validActor && validPost) {
      postUrl = `https://www.facebook.com/story.php?story_fbid=${postId}&id=${actorId}`;
    } else if (!postUrl && validPost) {
      postUrl = `https://www.facebook.com/${postId}`;
    }

    // Lưu GraphQL metadata vào pending queue để DOM engine dùng
    const graphqlData = {
      adId: (sponsoredData && sponsoredData.ad_id) || postId,
      postId,
      nodeId: node.id,
      actorId,
      pageName,
      pageUrl,
      postUrl,
      isVerified,
      mediaType,
      videoDuration,
      videoStreamUrl,
      buttonText,
      targetUrl,
      contentText,
      headline,
      domain
    };

    pendingGraphqlAds.set(cleanName(pageName), graphqlData);
    if (actorId) pendingGraphqlAds.set(String(actorId), graphqlData);
    if (postId) pendingGraphqlAdsById.set(String(postId), graphqlData);
    if (node.id) pendingGraphqlAdsById.set(String(node.id), graphqlData);

    // Kiểm tra xem thẻ DOM của bài ads này đã render trên màn hình chưa
    const domCard = findDomCardByPageName(pageName);
    if (!domCard) {
      // Nếu chưa render trong DOM: Đã lưu vào pendingGraphqlAds, chờ scanDomAds quét khi bài xuất hiện trên màn hình
      return;
    }

    const domData = extractDataFromDomCard(domCard);
    // Kết hợp dữ liệu chuẩn xác từ DOM
    isVerified = domData.isVerified;
    likes = domData.likes || likes;
    comments = domData.comments || comments;
    shares = domData.shares || shares;
    if (domData.targetUrl) targetUrl = domData.targetUrl;
    if (domData.buttonText) buttonText = domData.buttonText;
    if (domData.mediaType === 'VIDEO') mediaType = 'VIDEO';

    if (!postUrl) {
      postUrl = extractPostUrlFromDomCard(domCard, {
        pageId: actorId,
        pageName,
        pageUrl: domData.pageUrl || pageUrl
      });
    }

    auditAndFilterAd({
      adId: graphqlData.adId,
      pageName,
      pageUrl: domData.pageUrl || pageUrl,
      isVerified,
      mediaType,
      videoDuration,
      videoStreamUrl,
      likes,
      comments,
      shares,
      buttonText,
      targetUrl,
      contentText,
      headline,
      domain,
      postUrl
    });
  }

  // 5. Engine B: Quét Trực Tiếp Thẻ Ads Trong DOM (DOM Fallback Scanner)
  async function scanDomAds() {
    try {
      const cards = Array.from(document.querySelectorAll(
        'div.x1a2a7pz, div[role="article"], div[data-pagelet*="FeedUnit"], div.x1yztbdb, div[role="feed"] > div, div[role="dialog"]'
      ));

      for (const card of cards) {
        // LOẠI TRỪ 100%: Bài viết trong Group (Nhóm)
        if (card.querySelector('a[href*="/groups/"]')) continue;

        // LOẠI TRỪ 100%: Bài viết Hữu Cơ (Organic Post), Bạn bè, Cá nhân, hoặc Creator Paid Partnership
        if (isOrganicPostDom(card)) continue;

        const text = card.innerText || '';
        const hasLinkshim = Boolean(card.querySelector('a[href*="l.facebook.com/l.php"], a[href*="fbclid="], a[target="_blank"]:not([href*="facebook.com"])'));
        const hasCtaText = /shop\s*now|order\s*now|learn\s*more|sign\s*up|get\s*offer|buy\s*now|claim\s*offer|install\s*now|mua\s*ngay|đặt\s*ngay/i.test(text);
        const hasDomainCard = /[a-zA-Z0-9-]+\.(?:com|co|store|shop|io|net|org)\b/i.test(text);

        // CHỈ CHẤP NHẬN BÀI ADS THẬT:
        // Phải có chữ "Sponsored" hoặc "Được tài trợ" (TUYỆT ĐỐI KHÔNG dùng "Ad\n" hay "#ad" vì sẽ bị dính hashtag)
        const hasSponsored = Boolean(
          /\b(sponsored|được\s+tài\s+trợ)\b/i.test(text) ||
          card.querySelector('svg[aria-label="Sponsored" i], svg[aria-label="Được tài trợ" i], a[href*="/ad_preferences/"]')
        );

        // Trích xuất dữ liệu DOM
        const domData = extractDataFromDomCard(card);
        const { pageName } = domData;
        if (!pageName || pageName === 'Facebook' || pageName === 'Unknown Page') continue;

        // Bỏ qua nếu pageUrl là group
        if (domData.pageUrl && domData.pageUrl.includes('/groups/')) continue;

        // Trích xuất pageId từ pageUrl hoặc profile.php?id=...
        let pageId = null;
        if (domData.pageUrl) {
          try {
            const u = new URL(domData.pageUrl, location.href);
            pageId = u.searchParams.get('id');
          } catch(e) {}
        }
        if (!pageId) {
          const pl = card.querySelector('a[href*="profile.php?id="]');
          if (pl) {
            try { pageId = new URL(pl.href, location.href).searchParams.get('id'); } catch(e) {}
          }
        }

        // Nếu bài post chưa tải xong vùng tương tác (reaction bar chưa render):
        const hasReactionToolbar = Boolean(
          card.querySelector('div[role="button"][aria-label*="Like" i], div[role="button"][aria-label*="Thích" i], div[role="toolbar"], div[aria-label*="reaction" i], span[role="toolbar"]')
        );
        if (!hasReactionToolbar && domData.likes === 0) {
          // Chờ reaction toolbar render xong ở lần cuộn tới
          continue;
        }

        const cName = cleanName(pageName);
        const graphqlInfo = pendingGraphqlAds.get(cName) || 
                            (pageId ? pendingGraphqlAds.get(String(pageId)) : null) || 
                            {};
        const regInfo = feedPostsRegistry.byPageName.get(cName) || 
                        (pageId ? feedPostsRegistry.byActorId.get(String(pageId)) : null) || 
                        {};

        const isKnownAd = Boolean(graphqlInfo.adId);
        // TIÊU CHUẨN XÁC ĐỊNH ADS NGHIÊM NGẶT:
        // 1. Được xác nhận là Ad từ GraphQL (sponsored_data)
        // 2. Hoặc DOM có nhãn Sponsored / Được tài trợ VÀ KHÔNG PHẢI bài viết hữu cơ
        // 3. Hoặc có link out linkshim kèm CTA button mua hàng VÀ KHÔNG PHẢI bài viết hữu cơ
        const isAdDom = (isKnownAd || hasSponsored || (hasLinkshim && (hasDomainCard || hasCtaText) && domData.buttonText)) && !isOrganicPostDom(card);
        if (!isAdDom) continue;

        const adKey = String(graphqlInfo.adId || `dom_${pageName}_${domData.targetUrl || text.substring(0, 30).replace(/\s+/g, '_')}`);
        if (processedAdKeys.has(adKey)) continue;

        // Phân giải link bài post Facebook chuẩn xác
        let postUrl = graphqlInfo.postUrl || regInfo.storyUrl || regInfo.permalinkUrl || null;
        if (!postUrl) {
          postUrl = extractPostUrlFromDomCard(card, {
            pageId: pageId || graphqlInfo.actorId || regInfo.actorId,
            pageName,
            pageUrl: domData.pageUrl || graphqlInfo.pageUrl || regInfo.pageUrl
          });
        }

        // Dự phòng an toàn tuyệt đối: Không bao giờ để postUrl bị null
        if (!postUrl) {
          postUrl = domData.pageUrl || graphqlInfo.pageUrl || regInfo.pageUrl || null;
        }

        auditAndFilterAd({
          adId: adKey,
          pageName: domData.pageName,
          pageUrl: domData.pageUrl || graphqlInfo.pageUrl || regInfo.pageUrl,
          isVerified: domData.isVerified,
          mediaType: domData.mediaType === 'VIDEO' ? 'VIDEO' : (graphqlInfo.mediaType || domData.mediaType),
          videoDuration: graphqlInfo.videoDuration || null,
          videoStreamUrl: domData.videoStreamUrl || graphqlInfo.videoStreamUrl || null,
          likes: domData.likes,
          comments: domData.comments,
          shares: domData.shares,
          buttonText: domData.buttonText || graphqlInfo.buttonText || (domData.targetUrl ? 'Shop now' : null),
          targetUrl: domData.targetUrl || graphqlInfo.targetUrl,
          contentText: domData.contentText || graphqlInfo.contentText,
          headline: domData.headline || graphqlInfo.headline,
          domain: domData.domain || graphqlInfo.domain,
          postUrl
        });
      }

      chrome.runtime.sendMessage({
        action: 'SCAN_STATS_UPDATE',
        payload: { totalScanned, totalAdsFound, totalMatchedAds }
      }).catch(() => {});
    } catch (e) {
      console.warn('[ContentScript] Lỗi scanDomAds:', e);
    }
  }

  function parseMetricNumber(str) {
    if (!str) return 0;
    const clean = str.replace(/,/g, '');
    if (clean.endsWith('K') || clean.endsWith('k')) {
      return Math.round(parseFloat(clean) * 1000);
    }
    if (clean.endsWith('M') || clean.endsWith('m')) {
      return Math.round(parseFloat(clean) * 1000000);
    }
    return parseInt(clean, 10) || 0;
  }

  // 6. Nhận sự kiện từ injected.js (main world)
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'FB_DOC_ID_CAPTURED') {
      capturedDocId = event.data.docId;
    }

    if (event.data.type === 'FB_GRAPHQL_FEED_CHUNK') {
      const edges = event.data.edges || [];
      latestCursor = event.data.cursor || latestCursor;

      for (const edge of edges) {
        const postNode = edge.node;
        if (!postNode) continue;
        const postId = postNode.post_id || postNode.id;
        if (postId && processedPostIds.has(postId)) continue;
        if (postId) processedPostIds.add(postId);

        evaluateGraphqlStory(postNode).catch(() => {});
      }

      chrome.runtime.sendMessage({
        action: 'SCAN_STATS_UPDATE',
        payload: { totalScanned, totalAdsFound, totalMatchedAds }
      }).catch(() => {});
    }
  });

  // 7. Cuộn Chuột Vật Lý Đảm Bảo Không Bị Chrome Hủy Animation
  async function simulatePhysicalScroll() {
    const distance = Math.floor(Math.random() * 250) + 500; // 500px - 750px
    window.scrollBy(0, distance);
    const pauseTime = Math.floor(Math.random() * 800) + 1200; // 1.2s - 2.0s
    await new Promise(r => setTimeout(r, pauseTime));
  }

  // 8. Vòng lặp Hybrid Scanner
  async function runHybridLoop() {
    while (isScanning) {
      await scanDomAds();

      if (latestCursor && capturedDocId) {
        window.postMessage({
          type: 'TRIGGER_DIRECT_GRAPHQL_PAGE',
          docId: capturedDocId,
          cursor: latestCursor
        }, '*');
      }

      if (settings.autoScroll) {
        await simulatePhysicalScroll();
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // 9. Lắng nghe các lệnh điều khiển
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    if (action === 'CMD_START_SCANNER') {
      if (payload) settings = { ...settings, ...payload };
      isScanning = true;
      runHybridLoop();
      sendResponse({ success: true });
    } else if (action === 'CMD_STOP_SCANNER') {
      isScanning = false;
      sendResponse({ success: true });
    } else if (action === 'SETTINGS_CHANGED') {
      settings = { ...settings, ...payload };
      sendResponse({ success: true });
    }
    return true;
  });

  console.log('[FB Video Ads Hunter] Content Script Dual-Engine ready.');
})();
