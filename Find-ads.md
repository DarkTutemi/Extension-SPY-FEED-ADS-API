# Hướng Dẫn Kỹ Thuật: Bắt Ads Tự Nhiên Từ Newsfeed Bằng Hybrid API Pagination & Cuộn Vật Lý

Tài liệu này đặc tả kiến trúc kết hợp (Hybrid Approach) giữa:
1. **Gọi trực tiếp API GraphQL pagination với cursor:** Giúp kéo trước hàng loạt Feed Unit dạng JSON với tốc độ cao, trích xuất tức thì toàn bộ bài Ads (Video/Ảnh, Page, Tích xanh, CTA, Likes/Comments/Shares, Content).
2. **Cuộn chuột vật lý (Physical Scroll Simulation):** Giữ cho phiên duyệt Facebook hoàn toàn tự nhiên, đánh lừa hệ thống giám sát hành vi của Meta, đồng thời kích hoạt trình tải tài nguyên (hình ảnh/video thumbnail) trong DOM thực.

---

## 1. Cơ Chế Hoạt Động Của Hệ Thống Hybrid

```
[Newsfeed Load Lần Đầu]
         │
         ▼
[1. Bắt `fb_dtsg`, User ID & Con trỏ Cursor đầu tiên từ Response]
         │
         ├───► [Luồng A - API Fetch (Nền)]:
         │       Bắn GraphQL `CometNewsFeedPaginationQuery` liên tục với `cursor`
         │       Parse JSON -> Bóc tách ngay toàn bộ bài Ads -> Lưu vào Database/State.
         │
         └───► [Luồng B - Cuộn Chuột Vật Lý (Foreground)]:
                 Mô phỏng cuộn mượt (Smooth Scroll) có gia tốc ngẫu nhiên,
                 Dừng nghỉ (Jitter/Delay), kích hoạt lazy-load DOM và giữ an toàn trust-score tài khoản.
```

---

## 2. Thông Số Cần Thiết Để Gọi API GraphQL Pagination

Khi một tài khoản đăng nhập vào Facebook, để gọi được API `/api/graphql/`, extension cần 4 tham số cốt lõi:

| Tham số | Ý nghĩa | Cách lấy tự động |
|---|---|---|
| `fb_dtsg` | Token CSRF của phiên tài khoản | Trích xuất từ `DTSGInitialData.token` hoặc trong biến `window.require('DTSGInitialData')` |
| `__user` (hoặc `av`) | Facebook UID của profile đang chạy | Trích xuất từ `CurrentUserInitialData.USER_ID` hoặc cookie `c_user` |
| `doc_id` | Mã hash của compiled query trên server Meta | Bắt từ request GraphQL đầu tiên khi trang vừa load (thường cố định theo từng bản build của Facebook) |
| `cursor` | Con trỏ phân trang của Newsfeed | Nằm tại `viewer.news_feed.page_info.end_cursor` trong response GraphQL trước đó |

---

## 3. Cấu Trúc Payload Request GraphQL Phân Trang

Khi gọi thủ công qua `fetch()` nội bộ trong trang:

- **Endpoint:** `https://www.facebook.com/api/graphql/`
- **Method:** `POST`
- **Headers:**
  ```http
  Content-Type: application/x-www-form-urlencoded
  X-FB-Friendly-Name: CometNewsFeedPaginationQuery
  ```
- **Body parameters:**
  ```
  av=1000...
  __user=1000...
  fb_dtsg=NAc...
  fb_api_req_friendly_name=CometNewsFeedPaginationQuery
  doc_id=<DOC_ID_BAT_DUOC>
  variables={"count":5,"cursor":"<END_CURSOR_TRUOC_DO>","feedbackSource":1,"feedLocation":"NEWSFEED","renderLocation":"homepage_stream","scale":1,"useDefaultActor":false}
  ```

---

## 4. Kiến Trúc Code Hoàn Chỉnh: Hybrid Scanner Script

Dưới đây là module hoàn chỉnh có thể nhúng thẳng vào `content_fb.js` hoặc chạy qua Chrome Extension / CDP:

```javascript
/**
 * facebook_hybrid_ad_scanner.js
 * =========================================================================
 * Bắt Ads tự nhiên từ Newsfeed kết hợp API Pagination và Cuộn vật lý
 */

class FacebookHybridAdScanner {
  constructor(options = {}) {
    this.targetAdsCount = options.targetAdsCount || 20; // Số bài ads cần bắt
    this.capturedAds = new Map(); // Lưu bài ads theo ad_id tránh trùng lặp
    this.currentCursor = null;
    this.docId = options.docId || null;
    this.isRunning = false;

    // Lấy context định danh tài khoản từ môi trường Facebook Comet
    this.userId = this.getUserId();
    this.dtsgToken = this.getDtsgToken();
  }

  /**
   * 1. Trích xuất User ID và CSRF Token từ môi trường window
   */
  getUserId() {
    try {
      if (window.CurrentUserInitialData?.USER_ID) return window.CurrentUserInitialData.USER_ID;
      const match = document.cookie.match(/c_user=(\d+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  getDtsgToken() {
    try {
      if (window.DTSGInitialData?.token) return window.DTSGInitialData.token;
      if (window.require) {
        const dtsg = window.require('DTSGInitialData');
        if (dtsg?.token) return dtsg.token;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 2. Hook Network để tự động bắt `doc_id` và `cursor` đầu tiên
   */
  setupNetworkSniffer() {
    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      if (url && url.includes('/api/graphql/')) {
        const bodyStr = args[1]?.body ? String(args[1].body) : '';
        const params = new URLSearchParams(bodyStr);

        // Bắt doc_id của CometNewsFeedPaginationQuery
        if (params.get('fb_api_req_friendly_name') === 'CometNewsFeedPaginationQuery') {
          if (!self.docId && params.get('doc_id')) {
            self.docId = params.get('doc_id');
            console.log('[HYBRID] Đã bắt được doc_id:', self.docId);
          }
        }

        // Tự động phân tích response trả về từ feed tự nhiên
        response.clone().text().then(text => {
          self.processGraphqlResponse(text);
        }).catch(() => {});
      }

      return response;
    };
  }

  /**
   * 3. Xử lý và bóc tách dữ liệu từ GraphQL Payload
   */
  processGraphqlResponse(rawText) {
    const lines = rawText.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        const newsFeed = json?.data?.viewer?.news_feed;
        if (!newsFeed) continue;

        // Cập nhật con trỏ phân trang tiếp theo
        if (newsFeed.page_info?.end_cursor) {
          this.currentCursor = newsFeed.page_info.end_cursor;
        }

        // Duyệt qua từng post
        const edges = newsFeed.edges || [];
        for (const edge of edges) {
          const ad = this.parseAdStory(edge.node);
          if (ad && !this.capturedAds.has(ad.adId)) {
            this.capturedAds.set(ad.adId, ad);
            console.log(`[🎯 AD CAPTURED #${this.capturedAds.size}]`, ad.page.name, `[${ad.post.mediaType}]`);
            window.dispatchEvent(new CustomEvent('HYBRID_AD_FOUND', { detail: ad }));
          }
        }
      } catch (e) {}
    }
  }

  /**
   * 4. Hàm trích xuất chi tiết các đặc tính bài Ads
   */
  parseAdStory(node) {
    if (!node || node.__typename !== 'Story') return null;

    const header = node.comet_sections?.header?.story;
    const content = node.comet_sections?.content?.story;
    const feedback = node.comet_sections?.feedback?.story?.feedback;

    // Bắt buộc phải có sponsored_data
    const sponsoredData = header?.sponsored_data;
    if (!sponsoredData || !sponsoredData.is_sponsored) return null;

    // Tên Fanpage & Tích xanh
    const actor = header?.actors?.[0] || {};
    const isVerified = Boolean(
      actor.is_verified === true || 
      actor.verification_status === 'BLUE_VERIFIED'
    );

    // Nội dung bài viết (Content)
    const contentText = content?.message?.text || '';

    // Phân loại Media (Video vs Ảnh)
    const attachment = content?.attachments?.[0]?.styles?.attachment;
    const media = attachment?.media;
    let mediaType = 'unknown';
    let mediaUrl = null;

    if (media?.__typename === 'Video') {
      mediaType = 'video';
      mediaUrl = media.playable_url || media.browser_native_hd_url;
    } else if (media?.__typename === 'Photo') {
      mediaType = 'photo';
      mediaUrl = media.image?.uri;
    } else if (attachment?.subattachments?.length > 0) {
      mediaType = 'carousel';
    }

    // Nút Call to Action (Shop now, Order now, Learn more...)
    const cta = attachment?.call_to_action;
    const ctaTitle = cta?.action_link?.title || null;
    const targetUrl = cta?.action_link?.url || null;

    // Số lượng tương tác
    const likes = feedback?.reaction_count?.count || 0;
    const comments = feedback?.comment_rendering_instance?.comments?.total_count || 0;
    const shares = feedback?.share_count?.count || 0;

    const postId = node.post_id || node.id;

    return {
      adId: sponsoredData.ad_id,
      page: {
        id: actor.id,
        name: actor.name,
        url: actor.url,
        isVerified: isVerified
      },
      post: {
        id: postId,
        url: actor.id && postId ? `https://www.facebook.com/${actor.id}/posts/${postId}` : null,
        content: contentText,
        mediaType: mediaType,
        mediaUrl: mediaUrl
      },
      cta: {
        buttonText: ctaTitle,
        type: cta?.type || null,
        targetUrl: targetUrl,
        headline: attachment?.title_with_entities?.text || '',
        domain: attachment?.source?.text || ''
      },
      metrics: {
        likes,
        comments,
        shares
      }
    };
  }

  /**
   * 5. Luồng A: Gọi chủ động API GraphQL để kéo trước dữ liệu (Fast Ahead Fetch)
   */
  async fetchNextPage() {
    if (!this.dtsgToken || !this.userId || !this.docId || !this.currentCursor) {
      return false;
    }

    const variables = JSON.stringify({
      count: 5,
      cursor: this.currentCursor,
      feedbackSource: 1,
      feedLocation: "NEWSFEED",
      renderLocation: "homepage_stream",
      scale: 1,
      useDefaultActor: false
    });

    const body = new URLSearchParams({
      av: this.userId,
      __user: this.userId,
      fb_dtsg: this.dtsgToken,
      fb_api_req_friendly_name: 'CometNewsFeedPaginationQuery',
      doc_id: this.docId,
      variables: variables
    });

    try {
      const res = await fetch('https://www.facebook.com/api/graphql/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-FB-Friendly-Name': 'CometNewsFeedPaginationQuery'
        },
        body: body.toString()
      });

      const text = await res.text();
      this.processGraphqlResponse(text);
      return true;
    } catch (err) {
      console.warn('[HYBRID] Lỗi gọi GraphQL trực tiếp:', err);
      return false;
    }
  }

  /**
   * 6. Luồng B: Mô phỏng cuộn chuột vật lý ngẫu nhiên (Smooth Physical Scroll)
   */
  async simulatePhysicalScroll() {
    // Khoảng cách cuộn ngẫu nhiên từ 350px đến 700px
    const distance = Math.floor(Math.random() * 350) + 350;
    const steps = 12;
    const stepDistance = distance / steps;

    for (let i = 0; i < steps; i++) {
      window.scrollBy({
        top: stepDistance,
        behavior: 'smooth'
      });
      // Delay ngẫu nhiên giữa các nhịp cuộn nhỏ
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 30) + 20));
    }

    // Nghỉ ngẫu nhiên giữa các lần cuộn (giống người thật dừng lại đọc bài)
    const pauseMs = Math.floor(Math.random() * 1500) + 1200;
    await new Promise(r => setTimeout(r, pauseMs));
  }

  /**
   * 7. Vòng lặp điều phối chính (Hybrid Loop)
   */
  async start() {
    this.isRunning = true;
    this.setupNetworkSniffer();
    console.log('[HYBRID] Đã kích hoạt Hybrid Scanner...');

    // Đợi 2 giây ban đầu để lấy doc_id & cursor từ lượt tải đầu của trang
    await new Promise(r => setTimeout(r, 2000));

    while (this.isRunning && this.capturedAds.size < this.targetAdsCount) {
      // Nhịp 1: Kéo trước 1 batch qua API pagination nếu đã có cursor
      if (this.currentCursor && this.docId) {
        await this.fetchNextPage();
      }

      // Nhịp 2: Cuộn vật lý nhịp nhàng để DOM render và duy trì trust-score
      await this.simulatePhysicalScroll();

      // Kiểm tra điều kiện hoàn thành
      if (this.capturedAds.size >= this.targetAdsCount) {
        console.log(`[🎉 HOÀN THÀNH] Đã bắt đủ ${this.capturedAds.size} bài Ads.`);
        break;
      }
    }
  }

  stop() {
    this.isRunning = false;
    console.log('[HYBRID] Đã dừng scanner.');
  }
}
```

---

## 5. Vì Sao Phải Kết Hợp Cả Hai (Hybrid) Thay Vì Chỉ Dùng Một Thứ?

| Đặc tính | Chỉ Cuộn Vật Lý Đơn Thuần | Chỉ Gọi API Không Cuộn | **Kết Hợp Hybrid (Khuyên Dùng)** |
|---|---|---|---|
| **Tốc độ thu thập** | Chậm (phụ thuộc tốc độ cuộn và render DOM) | Rất nhanh | **Cực nhanh** (API kéo trước, cuộn đi theo sau) |
| **Độ an toàn / Checkpoint** | Cao (giống người dùng thật) | Rủi ro cao nếu spam request liên tục | **An toàn tuyệt đối** (Hành vi cuộn che chắn cho luồng fetch) |
| **Lấy đầy đủ Media** | Có (ảnh/video tải trên DOM) | Chỉ có link stream/CDN, không render DOM | **Đầy đủ** (Vừa có link gốc CDN vừa trigger view thực tế) |
| **Tỉ lệ sót bài** | Dễ sót nếu cuộn quá nhanh vượt tầm quét observer | Không sót bài nào trong pagination | **Không bao giờ sót** vì bắt ngay từ tầng dữ liệu JSON |

---

## 6. Cơ Chế Phân Giải Link Bài Post Facebook Chuẩn Dạng `story.php`

Khi quét bài Ads trên Newsfeed, liên kết bài viết thường bị Meta che giấu dưới dạng liên kết Reel (`/reel/<id>`), mã hóa Base64 (`pfbid...`), hoặc chỉ hiển thị nút CTA trỏ về Webstore ngoài.

Để xem trực tiếp bài post trên Facebook và tra cứu Ads Library, hệ thống phân giải về URL vĩnh cửu chuẩn:
```
https://www.facebook.com/story.php?story_fbid=<POST_ID>&id=<PAGE_ID>
```

### Thuật toán phân giải 3 tầng:

1. **Tầng 1 - Giải mã trực tiếp từ Relay Base64 (0ms):**
   Trong GraphQL, `node.id` thường là chuỗi Base64 bắt đầu bằng `UzpfST...`. Khi giải mã qua `atob()`, chuỗi có cấu trúc `S:_I<PAGE_ID>:<POST_ID>`.
   - `parts[1].slice(2)` chính là `PAGE_ID` (ID của Fanpage).
   - `parts[2]` (hoặc số tiếp theo) chính là `POST_ID` (`story_fbid`).

2. **Tầng 2 - Ghép cặp từ Actor ID & Post ID:**
   Nếu node GraphQL hoặc React Fiber đã có sẵn `actor.id` (Page ID) và `post_id` (hoặc `legacy_fbid`), tự động tạo URL dạng:
   `https://www.facebook.com/story.php?story_fbid=${postId}&id=${actorId}`.

3. **Tầng 3 - Tự động Fetch HTML ngầm với phiên Cookie Facebook:**
   Nếu bài viết xuất phát từ DOM card chỉ có link `/reel/<id>` hoặc `/posts/pfbid...`:
   - Gửi `fetch(url, { credentials: 'include' })` trong cùng phiên đăng nhập.
   - Quét regex trong mã nguồn HTML trả về:
     - `storyID`: `"storyID":"([A-Za-z0-9+/=]+)"` -> giải mã `atob` tìm `S:_I<page>:<post>`.
     - `top_level_post_id` & `content_owner_id_new`:
       `\"top_level_post_id\":\"(\d+)\",\"content_owner_id_new\":\"?(\d+)`.
   - Thu được chính xác `post` và `page` để sinh link `story.php?story_fbid=${post}&id=${page}`.

