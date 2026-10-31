/**
 * injected.js - Chạy trực tiếp trong main world của Facebook page
 * Can thiệp cả XMLHttpRequest lẫn fetch tại gateway /api/graphql/
 * Hỗ trợ chuẩn xác Relay Incremental Delivery (@stream / @defer)
 */

(function () {
  if (window.__FB_AD_HUNTER_INJECTED__) return;
  window.__FB_AD_HUNTER_INJECTED__ = true;

  let docId = null;
  let currentCursor = null;

  function getDtsgToken() {
    try {
      if (window.DTSGInitialData?.token) return window.DTSGInitialData.token;
      if (typeof window.require === 'function') {
        const dtsg = window.require('DTSGInitialData');
        if (dtsg?.token) return dtsg.token;
      }
    } catch (e) {}
    return null;
  }

  function getUserId() {
    try {
      if (window.CurrentUserInitialData?.USER_ID) return window.CurrentUserInitialData.USER_ID;
      const m = document.cookie.match(/c_user=(\d+)/);
      return m ? m[1] : null;
    } catch (e) {}
    return null;
  }

  function handleIncomingGraphQLText(text) {
    if (!text || typeof text !== 'string') return;
    const lines = text.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);

        // 1. Dạng Relay Incremental Delivery (@stream / @defer)
        if (parsed.data && parsed.data.node) {
          if (parsed.data.cursor) currentCursor = parsed.data.cursor;
          const streamNode = parsed.data.node;
          streamNode.__streamMeta = {
            isAdAction: Boolean(parsed.data.sposnsor_new_distac_action),
            cursor: currentCursor
          };
          window.postMessage({
            type: 'FB_GRAPHQL_FEED_CHUNK',
            edges: [{ node: streamNode }],
            cursor: currentCursor
          }, '*');
        }

        // 2. Dạng Connection chuẩn (news_feed.edges)
        const newsFeed = parsed?.data?.viewer?.news_feed;
        if (newsFeed) {
          if (newsFeed.page_info?.end_cursor) currentCursor = newsFeed.page_info.end_cursor;
          if (Array.isArray(newsFeed.edges) && newsFeed.edges.length > 0) {
            window.postMessage({
              type: 'FB_GRAPHQL_FEED_CHUNK',
              edges: newsFeed.edges,
              cursor: currentCursor
            }, '*');
          }
        }

        // 3. Cập nhật cursor từ page_info stream
        if (parsed?.data?.page_info?.end_cursor) {
          currentCursor = parsed.data.page_info.end_cursor;
        }
      } catch (e) {}
    }
  }

  // 1. HOOK XMLHttpRequest (Facebook Comet chủ yếu sử dụng XHR)
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    this._method = method;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._url && String(this._url).includes('/api/graphql/')) {
      const bodyStr = body ? String(body) : '';
      const params = new URLSearchParams(bodyStr);

      if (params.get('fb_api_req_friendly_name') === 'CometNewsFeedPaginationQuery') {
        const capturedDocId = params.get('doc_id');
        if (capturedDocId && !docId) {
          docId = capturedDocId;
          window.postMessage({ type: 'FB_DOC_ID_CAPTURED', docId }, '*');
        }
      }

      this.addEventListener('load', function () {
        try {
          handleIncomingGraphQLText(this.responseText);
        } catch (e) {}
      });
    }
    return originalSend.apply(this, [body]);
  };

  // 2. HOOK window.fetch (Dự phòng cho fetch calls)
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

    if (url && url.includes('/api/graphql/')) {
      const body = args[1]?.body ? String(args[1].body) : '';
      const params = new URLSearchParams(body);

      if (params.get('fb_api_req_friendly_name') === 'CometNewsFeedPaginationQuery') {
        const capturedDocId = params.get('doc_id');
        if (capturedDocId && !docId) {
          docId = capturedDocId;
          window.postMessage({ type: 'FB_DOC_ID_CAPTURED', docId }, '*');
        }
      }

      try {
        const clone = response.clone();
        clone.text().then((text) => {
          handleIncomingGraphQLText(text);
        }).catch(() => {});
      } catch (e) {}
    }

    return response;
  };

  // 3. Lắng nghe yêu cầu Fast-Ahead API fetch từ content_script
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'TRIGGER_DIRECT_GRAPHQL_PAGE') {
      const dtsg = getDtsgToken();
      const userId = getUserId();
      const targetDocId = docId || event.data.docId;
      const targetCursor = currentCursor || event.data.cursor;

      if (!dtsg || !userId || !targetDocId || !targetCursor) return;

      try {
        const variables = JSON.stringify({
          count: 5,
          cursor: targetCursor,
          feedbackSource: 1,
          feedLocation: 'NEWSFEED',
          renderLocation: 'homepage_stream',
          scale: 1,
          useDefaultActor: false
        });

        const body = new URLSearchParams({
          av: userId,
          __user: userId,
          fb_dtsg: dtsg,
          fb_api_req_friendly_name: 'CometNewsFeedPaginationQuery',
          doc_id: targetDocId,
          variables: variables
        });

        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://www.facebook.com/api/graphql/');
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.setRequestHeader('X-FB-Friendly-Name', 'CometNewsFeedPaginationQuery');
        xhr.onload = function () {
          handleIncomingGraphQLText(this.responseText);
        };
        xhr.send(body.toString());
      } catch (err) {
        console.warn('[Injected] Lỗi XHR Fast-Ahead:', err);
      }
    } else if (event.data && event.data.type === 'TRIGGER_POST_REACTION') {
      const { postId, reactionType = 'LIKE' } = event.data;
      const dtsg = getDtsgToken();
      const userId = getUserId();
      if (!dtsg || !userId || !postId) return;

      const reactionMap = {
        LIKE: '1635855486666999',
        LOVE: '1678524932434102',
        CARE: '613557422527858',
        HAHA: '115940658764963',
        WOW: '478547315650144',
        SAD: '908563459236466',
        ANGRY: '444813342392137'
      };

      const reactionId = reactionMap[reactionType] || reactionMap.LIKE;
      // Trích xuất id bài post nếu là dạng url hoặc chuỗi
      const cleanPostId = String(postId).replace(/[^\d]/g, '');
      const feedbackId = btoa(`feedback:${cleanPostId}`);

      const variables = JSON.stringify({
        input: {
          attribution_id_v2: "CometSinglePostDialogRoot.react,comet.post.single_dialog,via_cold_start," + Date.now() + ",410822,,,",
          feedback_id: feedbackId,
          feedback_reaction_id: reactionId,
          feedback_source: "OBJECT",
          is_tracking_encrypted: true,
          tracking: [],
          session_id: "62dad94b-206d-4ddf-9ff7-6d6fbddd6c10",
          actor_id: userId,
          client_mutation_id: "1"
        },
        scale: 1,
        useDefaultActor: false
      });

      const body = new URLSearchParams({
        av: userId,
        __user: userId,
        fb_dtsg: dtsg,
        fb_api_req_friendly_name: 'CometUFIFeedbackReactMutation',
        doc_id: '27646120298312844',
        variables: variables
      });

      fetch('https://www.facebook.com/api/graphql/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-FB-Friendly-Name': 'CometUFIFeedbackReactMutation'
        },
        body: body.toString()
      }).then(r => r.json()).then(res => {
        console.log('[Injected] Đã gửi CometUFIFeedbackReactMutation thành công:', reactionType, res);
      }).catch(err => {
        console.warn('[Injected] Lỗi gửi reaction:', err);
      });
    }
  });

  console.log('[FB Video Ads Hunter] Injected Relay Stream handler ready.');
})();
