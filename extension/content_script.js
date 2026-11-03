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
    warmupWatchSeconds: 15,
    warmupReaction: 'RANDOM',
    warmupExcludedPages: [],
    warmupExcludedKeywords: []
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

  // Hàm kiểm tra bài viết có thuộc danh sách Fanpage hoặc Từ khóa nội dung bị loại trừ Warmup không
  function checkWarmupExclusion(pageName, contentText, headline) {
    const rawPages = Array.isArray(settings.warmupExcludedPages) 
      ? settings.warmupExcludedPages 
      : (typeof settings.warmupExcludedPages === 'string' ? settings.warmupExcludedPages.split('\n') : []);
    const rawKeywords = Array.isArray(settings.warmupExcludedKeywords)
      ? settings.warmupExcludedKeywords
      : (typeof settings.warmupExcludedKeywords === 'string' ? settings.warmupExcludedKeywords.split('\n') : []);

    const normPage = (pageName || '').trim().toLowerCase();
    const fullContent = ((contentText || '') + ' ' + (headline || '')).toLowerCase();

    for (const rawP of rawPages) {
      const p = rawP.trim().toLowerCase();
      if (p && normPage && (normPage.includes(p) || p.includes(normPage))) {
        return { isExcluded: true, reason: `Fanpage "${pageName}" khớp danh sách loại trừ "${rawP.trim()}"` };
      }
    }

    for (const rawKw of rawKeywords) {
      const kw = rawKw.trim().toLowerCase();
      if (kw && fullContent && fullContent.includes(kw)) {
        return { isExcluded: true, reason: `Nội dung bài viết chứa từ khóa loại trừ "${rawKw.trim()}"` };
      }
    }

    return { isExcluded: false };
  }

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
      // ── BỘ ĐẾM WARMUP: CHỈ TÍNH POST ADS VIDEO E-COMMERCE (CÓ LINK WEBSTORE NGOÀI) CỦA FANPAGE KHÔNG TÍCH XANH ──
      if (mediaType === 'VIDEO' && hasWebstore) {
        const threshold = settings.warmupThreshold || 10;

        // Nếu Fanpage có tích xanh: HOÀN TOÀN BỎ QUA, KHÔNG ĐẾM, KHÔNG RESET BỘ ĐẾM
        if (isVerified) {
          console.log(`[Warmup Tracker] Bỏ qua Fanpage có tích xanh ("${pageName}"). Giữ nguyên bộ đếm: ${consecutiveUnmatchedVideoCount}/${threshold}`);
        } else {
          // Kiểm tra xem Fanpage hoặc Content có nằm trong Danh sách Loại Trừ Warmup hay không
          const exclusion = checkWarmupExclusion(pageName, contentText, headline);
          if (exclusion.isExcluded) {
            console.log(`[Warmup Tracker] 🚫 LOẠI TRỪ WARMUP: ${exclusion.reason} -> Không thực hiện Warmup trên bài này, chuyển sang bài tiếp theo. Bộ đếm giữ nguyên: ${consecutiveUnmatchedVideoCount}/${threshold}`);
            auditChecks.unshift({
              pass: false,
              desc: `🚫 BỎ QUA WARMUP: ${exclusion.reason} (Chuyển sang bài tiếp theo)`
            });
          } else {
            // Chỉ đếm những bài Video Ads thực sự của Fanpage CHƯA có tích xanh VÀ KHÔNG BỊ LOẠI TRỪ
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
                  watchSeconds: settings.warmupWatchSeconds || 15,
                  reactionType: settings.warmupReaction || 'RANDOM'
                }
              }).catch(() => {});
            }
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
      const warmupDesc = (settings.warmupReaction === 'NONE')
        ? `🔥 ĐÃ THỰC HIỆN WARMUP (Tương tác bài thứ 11 sau 10 bài video ads không tích xanh trượt: Chỉ xem video ${settings.warmupWatchSeconds || 15}s, không thả Reaction)`
        : `🔥 ĐÃ THỰC HIỆN WARMUP (Tương tác bài thứ 11 sau 10 bài video ads không tích xanh trượt: Thả Reaction & Xem ${settings.warmupWatchSeconds || 15}s)`;
      auditChecks.unshift({
        pass: true,
        desc: warmupDesc
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
    const candidateHeadings = Array.from(card.querySelectorAll('h4, h3, h2, [role="heading"]'));
    const validH = candidateHeadings.find(hEl => {
      const t = (hEl.innerText || '').trim();
      return t && !/^(Feed posts|Create a post|Reels and short videos|Suggested for you|Gợi ý cho bạn|Bài viết trên Bảng feed|Tạo bài viết)$/i.test(t);
    });
    const pageLink = validH ? validH.querySelector('a') : card.querySelector('a[role="link"]:not([href*="/reel/"]):not([href*="/watch/"]):not([href*="/groups/"])');
    let pageName = 'Unknown Page';
    if (validH) {
      const line0 = (validH.innerText || '').split('\n')[0].trim();
      pageName = (pageLink ? pageLink.innerText.trim() : line0) || line0;
    } else if (pageLink) {
      pageName = pageLink.innerText.trim();
    }
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

    // 3. Media Type & Stream URL (ECC Video Detection)
    const videoEl = card.querySelector('video');
    const isVideo = Boolean(
      videoEl ||
      text.includes('0:00 /') ||
      card.querySelector('div[aria-label*="Play" i], div[aria-label*="Phát" i], div[aria-label*="video" i]') ||
      card.querySelector('div[aria-label*="Mute" i], div[aria-label*="Unmute" i], div[aria-label*="Tắt tiếng" i], div[aria-label*="Bật âm thanh" i]') ||
      /\b\d{1,2}:\d{2}\b/.test(text)
    );
    const mediaType = isVideo ? 'VIDEO' : 'PHOTO';
    const videoStreamUrl = videoEl ? (videoEl.currentSrc || videoEl.src) : null;

    // 4. Bóc tách Like, Comment, Share thời gian thực (Hỗ trợ chuẩn 30 Case Study Facebook Newsfeed)
    let likes = 0, comments = 0, shares = 0;
    const allInteractiveEls = Array.from(card.querySelectorAll('div[role="button"], a[role="button"], [role="toolbar"] *, [aria-label]'));
    for (const btn of allInteractiveEls) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const t = (btn.innerText || '').trim();

      // Likes / Cảm xúc
      if (likes === 0 && (aria.includes('like') || aria.includes('thích') || aria.includes('react with like') || aria.includes('remove like') || aria.includes('reaction'))) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) {
          likes = parseMetricNumber(t);
        } else {
          const m = aria.match(/like:\s*([\d.,]+[KkMm]?)/i) ||
                    aria.match(/([\d.,]+[KkMm]?)\s*(?:people|người)/i);
          if (m) likes = parseMetricNumber(m[1]);
        }
      }

      // Comments / Bình luận
      if (comments === 0 && (aria.includes('comment') || aria.includes('bình luận'))) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) {
          comments = parseMetricNumber(t);
        } else {
          const m = aria.match(/([\d.,]+[KkMm]?)\s*(?:comments?|bình luận)/i);
          if (m) comments = parseMetricNumber(m[1]);
        }
      }

      // Shares / Chia sẻ
      if (shares === 0 && (aria.includes('share') || aria.includes('chia sẻ'))) {
        if (/^[0-9.,]+[KkMm]?$/.test(t)) {
          shares = parseMetricNumber(t);
        } else {
          const m = aria.match(/([\d.,]+[KkMm]?)\s*(?:shares?|lượt chia sẻ)/i);
          if (m) shares = parseMetricNumber(m[1]);
        }
      }
    }

    // Dự phòng qua các dòng text nếu button không trả đủ 3 chỉ số
    if (likes === 0 || comments === 0 || shares === 0) {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        if (likes === 0) {
          const lm = l.match(/^([0-9.,]+[KkMm]?)\s*(?:likes|reactions|lượt thích|người khác)/i);
          if (lm) likes = parseMetricNumber(lm[1]);
        }
        if (comments === 0) {
          const cm = l.match(/^([0-9.,]+[KkMm]?)\s*(?:comments?|bình luận)/i);
          if (cm) comments = parseMetricNumber(cm[1]);
        }
        if (shares === 0) {
          const sm = l.match(/^([0-9.,]+[KkMm]?)\s*(?:shares?|lượt chia sẻ)/i);
          if (sm) shares = parseMetricNumber(sm[1]);
        }
      }
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

    const CTA_MATCH_PATTERN = /\b(shop\s*now|order\s*now|see\s*details|learn\s*more|sign\s*up|get\s*offer|buy\s*now|book\s*now|contact\s*us|send\s*message|install\s*now|apply\s*now|watch\s*more|donate\s*now|subscribe|get\s*quote|download|claim\s*offer|open\s*now|try\s*it|mua\s*ngay|đặt\s*ngay|tìm\s*hiểu\s*thêm|đăng\s*ký|nhận\s*ưu\s*đãi|gửi\s*tin\s*nhắn)\b/i;

    function formatCta(s) {
      const cleaned = s.replace(/\s+/g, ' ').trim().toLowerCase();
      const standardMap = {
        'shopnow': 'Shop now',
        'ordernow': 'Order now',
        'seedetails': 'See details',
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
        'subscribe': 'Subscribe',
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

    // 2b. Kiểm tra vai trò phần tử quảng cáo (data-ad-rendering-role) và nút SVG sprite
    if (!buttonText) {
      const ctaRoleEl = card.querySelector('[data-ad-rendering-role*="cta"], [data-ad-rendering-role*="button"]');
      if (ctaRoleEl) {
        const t = cleanCtaText(ctaRoleEl.innerText || ctaRoleEl.textContent || ctaRoleEl.getAttribute('aria-label') || '');
        const m = t.match(CTA_MATCH_PATTERN);
        if (m) {
          buttonText = formatCta(m[1]);
        } else if (targetUrl) {
          buttonText = 'Shop now';
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
  // Nguyên tắc: Nếu bài có bất kỳ dấu hiệu Ads nào (Ad · 🌐, Sponsored, CTA button + external link, v.v.), TUYỆT ĐỐI KHÔNG coi là bài hữu cơ.
  function isOrganicPostDom(card) {
    if (!card) return false;
    const rawText = card.innerText || '';
    const text = rawText.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u034F\u200B-\u200D]/g, ' ');

    // 1. NẾU CÓ DẤU HIỆU RÕ RÀNG LÀ ADS -> TUYỆT ĐỐI KHÔNG PHẢI BÀI HỮU CƠ
    const hasAdIndicators = Boolean(
      /(?:^|[^\p{L}\p{N}])(sponsored|được\s+tài\s+trợ)(?:[^\p{L}\p{N}]|$)/iu.test(text) ||
      /(?:^|[^\p{L}\p{N}])Ad\s*[·•🌐]|(?:^|\s)Ad(?:\s|$)/iu.test(text) ||
      card.querySelector('svg[aria-label*="Sponsored" i], svg[aria-label*="Được tài trợ" i], a[href*="/ad_preferences/"], a[href*="/about_this_ad/"], [data-ad-rendering-role*="cta"], [data-ad-rendering-role*="toolbar"], [data-ad-rendering-role*="profile_name"]') ||
      ((/shop\s*now|order\s*now|see\s*details|learn\s*more|sign\s*up|get\s*offer|buy\s*now|claim\s*offer|install\s*now|donate\s*now|subscribe|apply\s*now|mua\s*ngay|đặt\s*ngay/i.test(text)) &&
       card.querySelector('a[href*="l.facebook.com/l.php"], a[href*="fbclid="], a[target="_blank"]:not([href*="facebook.com"])'))
    );

    if (hasAdIndicators) {
      return false; // Chắc chắn là Ads thực sự của Facebook, không được bỏ qua!
    }

    // 2. Bài viết trong nhóm Facebook (Facebook Groups) mà KHÔNG có dấu hiệu Ads -> 100% Organic (P-02)
    if (card.querySelector('a[href*="/groups/"]')) {
      return true;
    }

    // 3. Nếu có nhãn "Paid partnership" hoặc "Hợp tác trả phí" mà KHÔNG có dấu hiệu Ads ở trên
    const hasPaidPartnership = /paid\s+partnership|hợp\s+tác\s+trả\s+phí/i.test(text);
    if (hasPaidPartnership) {
      return true; // Đây là bài Branded Content hữu cơ của Creator/KOL
    }

    // 4. Kiểm tra ngày giờ đăng tự nhiên của bài viết hữu cơ (Organic Post Timestamp):
    // Bài viết Ads của Facebook KHÔNG BAO GIỜ có ngày giờ đăng (như "2 hours ago", "2 days ago", "about an hour ago", "yesterday", "5 phút trước"...)
    const headerEl = card.querySelector('h2, h3, h4')?.parentElement;
    const headerText = headerEl ? (headerEl.innerText || '') : text.substring(0, 300);
    const organicDatePattern = /\b(?:\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Tháng\s+\d{1,2})|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b|\d+\s*(?:hrs?|mins?|days?|wks?|mos?|hours?|minutes?|seconds?)\s*ago|\d+\s*(?:hrs?|mins?|days?|wks?|thg|giờ|phút|ngày|tuần)\b|yesterday|hôm\s+qua|vừa\s+xong|just\s+now|about\s+an?\s+hour\s+ago|hours?\s+ago|mins?\s+ago|days?\s+ago)\b/i;

    if (organicDatePattern.test(headerText)) {
      return true;
    }

    // 5. Nếu có icon quyền riêng tư (Public/Friends) mà KHÔNG HỀ CÓ bất kỳ dấu hiệu Ads nào
    const hasPrivacyScope = Boolean(
      card.querySelector('svg[aria-label*="Public" i], svg[aria-label*="Công khai" i], svg[aria-label*="Friends" i], svg[aria-label*="Bạn bè" i], svg[aria-label*="Custom" i], svg[aria-label*="Tùy chỉnh" i]') ||
      card.querySelector('span[aria-label*="Shared with Public" i], span[aria-label*="Chia sẻ với Công khai" i], span[aria-label*="Shared with Friends" i], span[aria-label*="Chia sẻ với bạn bè" i]')
    );
    if (hasPrivacyScope) {
      return true;
    }

    return false;
  }

  // 4. Engine A: Đánh giá GraphQL Story Node (Chuẩn hóa 100% theo Find-ads.md)
  async function evaluateGraphqlStory(node) {
    if (!node || typeof node !== 'object') return;
    totalScanned++;

    const regEntry = registerFeedStoryNode(node);

    // 1. Sponsored & Ad ID Detection (Hỗ trợ cả Comet Classic lẫn Comet Modern Relay)
    let adId = null;
    let isSponsored = false;
    let ctaTracking = null;

    // A. Kiểm tra metadata trong context_layout (Comet Modern Relay)
    const metadata = node.comet_sections?.context_layout?.story?.comet_sections?.metadata || [];
    for (const m of metadata) {
      if (m.__typename === 'CometStorySponsoredLabelStrategy' ||
          m.__module_operation_CometFeedStoryMetadataSectionMatchRenderer_story?.__dr?.includes('SponsoredLabel') ||
          m.__module_component_CometFeedStoryMetadataSectionMatchRenderer_story?.__dr?.includes('SponsoredLabel')) {
        isSponsored = true;
        break;
      }
    }

    // B. Kiểm tra tracking trong call_to_action section
    const ctaSection = node.comet_sections?.call_to_action?.story;
    if (ctaSection?.tracking) {
      try {
        ctaTracking = typeof ctaSection.tracking === 'string' ? JSON.parse(ctaSection.tracking) : ctaSection.tracking;
        if (ctaTracking?.adid || ctaTracking?.is_sponsored === 1 || ctaTracking?.is_sponsored === true) {
          adId = String(ctaTracking.adid || ctaTracking.top_level_post_id);
          isSponsored = true;
        }
      } catch (e) {}
    }

    // C. Kiểm tra qrz_ctx_seg (Identity Ad Token của Meta)
    if (!adId) {
      const qrzAdId = node.qrz_ctx_seg?.lbl_adv_iden ||
                      node.qrz_ctx_seg?.ad_id ||
                      node.comet_sections?.content?.story?.comet_sections?.message?.story?.qrz_ctx_seg?.ad_id ||
                      node.comet_sections?.footer?.story?.qrz_ctx_seg?.ad_id ||
                      node.comet_sections?.feedback?.story?.story_ufi_container?.story?.qrz_ctx_seg?.ad_id;
      if (qrzAdId) {
        adId = String(qrzAdId);
        isSponsored = true;
      }
    }

    // D. Kiểm tra classic header.sponsored_data (Find-ads.md spec)
    const sponsoredData = node.comet_sections?.header?.story?.sponsored_data || node.sponsored_data;
    if (sponsoredData) {
      if (sponsoredData.is_sponsored || sponsoredData.ad_id) {
        isSponsored = true;
        adId = adId || String(sponsoredData.ad_id);
      }
    }

    // E. Kiểm tra StoryAttachmentShareAdStyleRender
    const att = node.attachments?.[0] || node.comet_sections?.content?.story?.attachments?.[0];
    if (att?.styles?.__typename === 'StoryAttachmentShareAdStyleRender' ||
        att?.styles?.__module_component_CometFeedStoryAttachmentMatchRenderer_attachment?.__dr?.includes('AdAttachmentStyle')) {
      isSponsored = true;
    }

    // NẾU KHÔNG CÓ BẤT KỲ DẤU HIỆU SPONSORED NÀO -> CHẮC CHẮN LÀ BÀI HỮU CƠ, BỎ QUA NGAY
    if (!isSponsored && !adId) return;

    // LOẠI TRỪ 100%: Bài viết trong Group (Nhóm)
    const isGroup = Boolean(
      node.comet_sections?.header?.story?.group ||
      node.group ||
      metadata.some(m => m.__typename?.includes('Group')) ||
      (regEntry?.pageUrl && regEntry.pageUrl.includes('/groups/')) ||
      (regEntry?.storyUrl && regEntry.storyUrl.includes('/groups/')) ||
      ctaTracking?.page_insights?.[node.actors?.[0]?.id]?.page_id_type === 'group'
    );
    if (isGroup) return;

    // LOẠI TRỪ 100%: Bài viết có Timestamp đăng tự nhiên mà KHÔNG có SponsoredLabelStrategy
    const hasOrganicTimestamp = metadata.some(m => m.__typename === 'CometFeedStoryLongerTimestampStrategy');
    const hasSponsoredLabel = metadata.some(m => m.__typename === 'CometStorySponsoredLabelStrategy');
    if (hasOrganicTimestamp && !hasSponsoredLabel && !ctaTracking?.is_sponsored) {
      return;
    }

    // 2. Tên Fanpage, URL, Actor ID và Tích Xanh (Verified Badge)
    const cl = node.comet_sections?.context_layout?.story?.comet_sections;
    const actor = node.actors?.[0] ||
                  cl?.title?.story?.actors?.[0] ||
                  cl?.actor_photo?.story?.actors?.[0] ||
                  node.comet_sections?.header?.story?.actors?.[0] || {};
    const pageName = actor.name || regEntry?.pageName || 'Unknown Page';
    const pageUrl = actor.url || regEntry?.pageUrl || null;
    const actorId = actor.id || regEntry?.actorId || null;
    let isVerified = Boolean(
      cl?.title?.story?.comet_sections?.badge ||
      actor.is_verified === true ||
      actor.verification_status === 'BLUE_VERIFIED' ||
      actor.verification_status === 'VERIFIED'
    );

    // 3. Phân loại định dạng Media (VIDEO vs PHOTO vs CAROUSEL)
    const media = att?.styles?.attachment?.media || att?.media || node.comet_sections?.content?.story?.attachments?.[0]?.styles?.attachment?.media;
    let mediaType = 'PHOTO';
    const isVideoStyle = Boolean(
      media?.__typename === 'Video' ||
      media?.playable_url ||
      media?.playback_video ||
      media?.videoDeliveryResponseFragment?.progressive_urls?.length > 0 ||
      ctaTracking?.ent_attachement_type === 'VideoAttachment' ||
      ctaTracking?.story_attachment_style?.includes('video') ||
      att?.styles?.__module_component_CometFeedStoryAttachmentMatchRenderer_attachment?.__dr?.includes('Video') ||
      att?.styles?.attachment?.style_infos?.some(s => s.__typename?.includes('Video'))
    );
    if (isVideoStyle) {
      mediaType = 'VIDEO';
    } else if (att?.subattachments?.length > 0 || att?.styles?.attachment?.subattachments?.length > 0) {
      mediaType = 'CAROUSEL';
    }

    let videoStreamUrl = media?.playable_url ||
                         media?.playable_url_quality_hd ||
                         media?.browser_native_hd_url ||
                         media?.videoDeliveryResponseFragment?.progressive_urls?.find(u => u.metadata?.quality === 'HD')?.progressive_url ||
                         media?.videoDeliveryResponseFragment?.progressive_urls?.[0]?.progressive_url || null;

    const videoDuration = media?.playable_duration_in_ms ? Math.round(media.playable_duration_in_ms / 1000) : null;

    // 4. Nút Call to Action (Shop now, Order now, Donate now...) & Target URL
    const linkRenderer = att?.styles?.attachment?.story_attachment_link_renderer?.attachment ||
                         att?.story_attachment_link_renderer?.attachment ||
                         node.comet_sections?.footer?.story?.attachments?.[0]?.story_attachment_link_renderer?.attachment;

    let targetUrl = linkRenderer?.web_link?.url ||
                    linkRenderer?.action_links?.[0]?.url ||
                    linkRenderer?.url ||
                    node.comet_sections?.content?.story?.ghl_mocked_encrypted_link || null;

    // Giải mã linkshim nếu là l.facebook.com/l.php
    if (targetUrl && targetUrl.includes('l.facebook.com/l.php')) {
      try {
        const u = new URL(targetUrl);
        const rawU = u.searchParams.get('u');
        if (rawU && rawU.startsWith('http')) targetUrl = decodeURIComponent(rawU);
      } catch (e) {}
    }

    let buttonText = ctaTracking?.call_to_action_type || null;
    if (buttonText) {
      buttonText = buttonText.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    } else if (targetUrl) {
      buttonText = 'Shop now';
    }

    // 5. Tương tác (Likes, Comments, Shares)
    const ufi = node.comet_sections?.feedback?.story?.story_ufi_container?.story?.feedback_context?.feedback_target_with_context?.comet_ufi_summary_and_actions_renderer?.feedback;
    const legacyFeedback = node.feedback || node.comet_sections?.feedback?.story?.feedback;

    let likes = legacyFeedback?.reaction_count?.count || 0;
    if (!likes && ufi?.top_reactions?.edges) {
      likes = ufi.top_reactions.edges.reduce((sum, e) => sum + (e.reaction_count || e.i18n_reaction_count || 0), 0);
    }
    let comments = ufi?.comment_rendering_instance?.comments?.total_count ||
                   legacyFeedback?.comment_rendering_instance?.comments?.total_count || 0;
    let shares = ufi?.share_count?.count || legacyFeedback?.share_count?.count || 0;

    const postId = node.post_id || regEntry?.postId || node.id || adId || ('ad_' + Date.now());
    const contentText = node.comet_sections?.content?.story?.message?.text ||
                        node.comet_sections?.content?.story?.comet_sections?.message?.story?.message?.text ||
                        node.message?.text || '';
    const headline = att?.styles?.attachment?.title_with_entities?.text || att?.title_with_entities?.text || '';
    const domain = att?.styles?.attachment?.source?.text || att?.source?.text || '';

    let postUrl = regEntry?.storyUrl || node.permalink_url || null;
    const validActor = actorId && /^\d{5,}$/.test(String(actorId));
    const validPost = postId && (/^\d{5,}$/.test(String(postId)) || /^pfbid\w+$/.test(String(postId)));
    if (!postUrl && validActor && validPost) {
      postUrl = `https://www.facebook.com/story.php?story_fbid=${postId}&id=${actorId}`;
    } else if (!postUrl && validPost) {
      postUrl = `https://www.facebook.com/${postId}`;
    }

    // Lưu GraphQL metadata vào pending queue để DOM engine dùng đồng bộ
    const finalAdId = adId || postId;
    const graphqlData = {
      adId: finalAdId,
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

    // KẾT HỢP DỮ LIỆU TỪ DOM NẾU CARD ĐÃ XUẤT HIỆN TRÊN MÀN HÌNH (Làm giàu dữ liệu, không chờ đợi)
    const domCard = findDomCardByPageName(pageName);
    if (domCard) {
      const domData = extractDataFromDomCard(domCard);
      if (domData.isVerified) isVerified = true;
      if (domData.likes > 0) likes = domData.likes;
      if (domData.comments > 0) comments = domData.comments;
      if (domData.shares > 0) shares = domData.shares;
      if (domData.targetUrl) targetUrl = domData.targetUrl;
      if (domData.buttonText) buttonText = domData.buttonText;
      if (domData.mediaType === 'VIDEO') mediaType = 'VIDEO';
      if (domData.videoStreamUrl) videoStreamUrl = domData.videoStreamUrl;
      if (!postUrl) {
        postUrl = extractPostUrlFromDomCard(domCard, {
          pageId: actorId,
          pageName,
          pageUrl: domData.pageUrl || pageUrl
        });
      }
    }

    // BẮT VÀ ĐÁNH GIÁ NGAY LẬP TỨC (Chuẩn hóa theo Find-ads.md: Không phụ thuộc và không bị chặn bởi DOM Virtualization)
    auditAndFilterAd({
      adId: finalAdId,
      pageName,
      pageUrl,
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

  // 5. Engine B: Quét Trực Tiếp Thẻ Ads Trong DOM (ECC - Enhanced Comet Crawler)
  async function scanDomAds() {
    try {
      // 1. Thuật toán ECC Post Discovery: Tìm các Post Card hoàn chỉnh từ Header & Toolbar
      const candidateHeaders = Array.from(document.querySelectorAll(
        '[role="main"] h4, [role="main"] h3, [role="main"] h2, [role="heading"], div.html-div.xdj266r.x14z9mp h4, div.html-div.xdj266r.x14z9mp h3, div.html-div.xdj266r.x14z9mp h2, div[role="article"] h4, div[role="article"] h3, div[role="article"] h2'
      ));

      const cards = [];
      const visited = new Set();

      for (const h of candidateHeaders) {
        let p = h.parentElement;
        let postCard = null;
        while (p && p.tagName !== 'BODY' && p.getAttribute('role') !== 'main') {
          const hasReaction = !!p.querySelector('[aria-label*="Like" i], [aria-label*="Thích" i], [role="toolbar"], div[role="button"][aria-label*="reaction" i]');
          if (hasReaction && p.children.length >= 2) {
            postCard = p;
            break;
          }
          p = p.parentElement;
        }

        if (postCard && !visited.has(postCard)) {
          visited.add(postCard);
          cards.push(postCard);
        }
      }

      // Bổ sung các bài dạng dialog nếu có (modal story/reel)
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      dialogs.forEach(d => { if (!visited.has(d)) { visited.add(d); cards.push(d); } });

      // Nếu không tìm thấy bài nào qua header (ví dụ DOM chưa hydrate đầy đủ), fallback selector
      if (cards.length === 0) {
        const fallbacks = document.querySelectorAll('div.html-div.xdj266r.x14z9mp, div[role="article"]');
        fallbacks.forEach(f => { if (!visited.has(f)) { visited.add(f); cards.push(f); } });
      }

      for (const card of cards) {
        // LOẠI TRỪ 100%: Bài viết trong Group (Nhóm)
        if (card.querySelector('a[href*="/groups/"]')) continue;

        // LOẠI TRỪ 100%: Bài viết Hữu Cơ (Organic Post), Bạn bè, Cá nhân
        if (isOrganicPostDom(card)) continue;

        const rawText = card.innerText || '';
        // Chuẩn hóa loại bỏ Zero-Width Spaces (\u200B, \u034F, \uFEFF) mà Facebook chèn vào để scramble
        const text = rawText.replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u034F\u200B-\u200D]/g, ' ');

        const hasLinkshim = Boolean(card.querySelector('a[href*="l.facebook.com/l.php"], a[href*="fbclid="], a[target="_blank"]:not([href*="facebook.com"])'));
        const hasCtaText = /shop\s*now|order\s*now|see\s*details|learn\s*more|sign\s*up|get\s*offer|buy\s*now|book\s*now|claim\s*offer|install\s*now|donate\s*now|subscribe|apply\s*now|mua\s*ngay|đặt\s*ngay/i.test(text);
        const hasDomainCard = /[a-zA-Z0-9-]+\.(?:com|co|store|shop|io|net|org)\b/i.test(text);

        // TIÊU CHUẨN XÁC ĐỊNH BÀI ADS THẬT SỰ CỦA FACEBOOK (Đa ngôn ngữ, Unicode Boundaries & Chống Scramble)
        const hasSponsored = Boolean(
          /(?:^|[^\p{L}\p{N}])(sponsored|được\s+tài\s+trợ)(?:[^\p{L}\p{N}]|$)/iu.test(text) ||
          /(?:^|[^\p{L}\p{N}])Ad\s*[·•🌐]|(?:^|\s)Ad(?:\s|$)/iu.test(text) ||
          card.querySelector('svg[aria-label*="Sponsored" i], svg[aria-label*="Được tài trợ" i], a[href*="/ad_preferences/"], a[href*="/about_this_ad/"]')
        );
        const hasAdRole = Boolean(card.querySelector('[data-ad-rendering-role*="cta"], [data-ad-rendering-role*="profile_name"]'));

        // Trích xuất dữ liệu DOM
        const domData = extractDataFromDomCard(card);
        const { pageName } = domData;
        if (!pageName || /^(Facebook|Unknown Page|Feed posts|Create a post|Reels and short videos|Tạo bài viết)$/i.test(pageName)) continue;

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
        // 2. Hoặc DOM có nhãn Sponsored / Được tài trợ / Ad VÀ KHÔNG PHẢI bài viết hữu cơ
        // 3. Hoặc có vai trò hiển thị quảng cáo (data-ad-rendering-role) VÀ KHÔNG PHẢI bài viết hữu cơ
        // 4. Hoặc có link out linkshim kèm CTA button mua hàng VÀ KHÔNG PHẢI bài viết hữu cơ
        const isAdDom = (isKnownAd || hasSponsored || hasAdRole || (hasLinkshim && (hasDomainCard || hasCtaText) && domData.buttonText)) && !isOrganicPostDom(card);
        if (!isAdDom) continue;
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
      if (payload?.resetWarmupCounter) {
        consecutiveUnmatchedVideoCount = 0;
        chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });
        console.log('[Warmup Tracker] Đã khởi tạo lại bộ đếm về 0 khi bắt đầu phiên quét mới.');
      }
      isScanning = true;
      runHybridLoop();
      sendResponse({ success: true });
    } else if (action === 'RESET_WARMUP_COUNTER') {
      consecutiveUnmatchedVideoCount = 0;
      chrome.storage.local.set({ consecutiveUnmatchedVideoCount: 0 });
      console.log('[Warmup Tracker] Đã reset bộ đếm Warmup về 0 theo lệnh.');
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
