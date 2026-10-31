# Tài Liệu Kỹ Thuật: Cơ Chế Thả Reaction (Like / Love) Bằng GraphQL Mutation & DOM Sync

> **Dự án:** FB Video Ads Hunter & Warmup Engine  
> **Cơ chế trọng tâm:** `CometUFIFeedbackReactMutation` (Relay Modern GraphQL) kết hợp Synthetic DOM Event  
> **Mục tiêu:** Đảm bảo 100% tỷ lệ ăn Reaction khi Warmup tài khoản nuôi, vượt qua các hạn chế của giao diện Comet ảo và sự sai lệch giữa `post_id` URL với `feedback_id` backend.

---

## 1. Vấn Đề Thực Tế Trên Facebook Comet Mới

Khi thực hiện tự động hóa tương tác (Warmup) trên Facebook thông qua Extension thông thường, thường gặp phải 2 lỗi cốt tử khiến bài viết **không thực sự được thả cảm xúc**:

1. **Lệch định danh giữa URL và Thực thể Feedback:**
   - Trên thanh địa chỉ URL: `https://www.facebook.com/story.php?story_fbid=1555925316532664&id=100063456315604`
   - Chuỗi `story_fbid` (`1555925316532664`) là ID của bài chia sẻ / story, nhưng thực thể lưu trữ lượt Reaction (`feedback_id`) của video ad lại là một định danh khác (`1508047194653810`).
   - Nếu mã hóa base64 theo kiểu thông thường `btoa("feedback:" + story_fbid)` thì gửi GraphQL lên server sẽ trả về lỗi không tìm thấy feedback target.
2. **React Synthetic Event nuốt click DOM:**
   - Facebook Comet sử dụng React 19 với hệ thống event delegation ngầm.
   - Thao tác `element.click()` thuần của JavaScript thông thường đôi khi chỉ làm kích hoạt hiệu ứng ripple mà không đẩy request mạng lên server, hoặc bị chặn bởi các lớp modal overlay / dialog ảo.
   - Trạng thái `aria-label` của các nút xung quanh có thể chứa từ khóa `"Remove"` làm script hiểu nhầm bài viết đã được like sẵn.

---

## 2. Giải Pháp: Kiến Trúc Kép (Dual-Execution)

Hệ thống kết hợp đồng thời cả 2 tầng:

```
                          [ KHỞI CHẠY WARMUP TAB ]
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
 ┌──────────────────────────────────┐        ┌──────────────────────────────────┐
 │     TẦNG 1: GRAPHQL MUTATION     │        │        TẦNG 2: DOM UI SYNC       │
 │  (Bắn thẳng vào API Facebook)    │        │    (Kích hoạt giao diện người)   │
 ├──────────────────────────────────┤        ├──────────────────────────────────┤
 │ • Quét regex tìm feedback_id thật│        │ • Tìm đúng nút Like trong Dialog │
 │ • Trích xuất token DTSG & LSD    │        │ • Hover mở Dock nếu chọn LOVE    │
 │ • Gửi CometUFIFeedbackReact      │        │ • Click chọn Love hoặc Like      │
 │ • Nhận HTTP 200 từ Server        │        │ • Icon sáng màu xanh/đỏ trên tab │
 └──────────────────────────────────┘        └──────────────────────────────────┘
           │                                                   │
           └─────────────────────────┬─────────────────────────┘
                                     ▼
                    [ BÀI VIẾT ĐÃ THẢ REACTION 100% ]
```

---

## 3. Chi Tiết Kỹ Thuật GraphQL Mutation

### 3.1. Reverse-Engineering Payload cURL Thực Tế

Request gửi tới Facebook Gateway:
- **Endpoint:** `POST https://www.facebook.com/api/graphql/`
- **Header:**
  - `Content-Type: application/x-www-form-urlencoded`
  - `X-FB-Friendly-Name: CometUFIFeedbackReactMutation`
- **Tài liệu tham chiếu (doc_id):** `27646120298312844`

### 3.2. Bảng Mã Định Danh Cảm Xúc (Reaction IDs)

Facebook Comet phân bổ mã ID riêng biệt cho từng loại cảm xúc:

| Reaction | Tên Hiển Thị | Mã Định Danh (`feedback_reaction_id`) |
| :--- | :--- | :--- |
| **UNLIKE** | Gỡ cảm xúc | `'0'` |
| **LIKE** | Thích (👍) | `'1635855486666999'` |
| **LOVE** | Yêu thích (❤️) | `'1678524932434102'` |
| **CARE** | Thương thương (🥰) | `'613557422527858'` |
| **HAHA** | Haha (😆) | `'115940658764963'` |
| **WOW** | Wow (😮) | `'478547315650144'` |
| **SAD** | Buồn (😢) | `'908563459236466'` |
| **ANGRY** | Phẫn nộ (😡) | `'444813342392137'` |

---

## 4. Thuật Toán Trích Xuất Dữ Liệu Tự Động Trong DOM

Khi tab bài viết (`story.php` hoặc `permalink.php`) được mở, script tự động quét các thẻ `<script>` nhúng sẵn trong HTML tĩnh để lấy đủ bộ 4 tham số xác thực:

### 4.1. Trích xuất `feedback_id` chuẩn xác

```javascript
function extractFeedbackId(pId) {
  const scripts = Array.from(document.querySelectorAll('script'));
  
  // Ưu tiên 1: Lấy target subscription ID của video post thực tế
  for (const s of scripts) {
    const text = s.textContent || '';
    const match = text.match(/"subscription_target_id"\s*:\s*"(\d+)"/);
    if (match) {
      return btoa('feedback:' + match[1]);
    }
  }

  // Ưu tiên 2: Quét chuỗi base64 feedback token cấp bài viết (loại trừ comment)
  for (const s of scripts) {
    const text = s.textContent || '';
    const matches = text.matchAll(/"(ZmVlZGJhY2s[A-Za-z0-9+/=]+)"/g);
    for (const m of matches) {
      try {
        const decoded = atob(m[1]);
        if (decoded.startsWith('feedback:') && !decoded.includes('_')) {
          return m[1];
        }
      } catch (e) {}
    }
  }

  // Fallback: Dùng clean postId
  return pId ? btoa('feedback:' + String(pId).replace(/[^\d]/g, '')) : null;
}
```

### 4.2. Trích xuất `DTSG` và `LSD` Security Token

```javascript
function extractSecurityTokens() {
  const scripts = Array.from(document.querySelectorAll('script'));
  
  // 1. Token DTSG (Chống CSRF)
  let dtsg = window.DTSGInitialData?.token;
  if (!dtsg) {
    for (const s of scripts) {
      const text = s.textContent || '';
      const m = text.match(/"DTSGInitialData"[^}]*"token":"([^"]+)"/) || text.match(/"token":"(NA[^"]+)"/);
      if (m) { dtsg = m[1]; break; }
    }
  }
  if (!dtsg) {
    dtsg = document.querySelector('input[name="fb_dtsg"]')?.value;
  }

  // 2. Token LSD
  let lsd = null;
  for (const s of scripts) {
    const text = s.textContent || '';
    const m = text.match(/"LSD"[^}]*"token":"([^"]+)"/);
    if (m) { lsd = m[1]; break; }
  }

  // 3. User ID đang đăng nhập
  const user = (document.cookie.match(/c_user=(\d+)/) || [])[1];

  return { dtsg, lsd, user };
}
```

---

## 5. Cấu Trúc Payload & Thực Thi Mutation

```javascript
async function sendGraphQLReaction(feedbackId, reactionId, tokens) {
  const { dtsg, lsd, user } = tokens;
  
  const variables = JSON.stringify({
    input: {
      attribution_id_v2: `CometSinglePostDialogRoot.react,comet.post.single_dialog,via_cold_start,${Date.now()},432281,,,`,
      feedback_id: feedbackId,
      feedback_reaction_id: reactionId,
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

  const response = await fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': 'CometUFIFeedbackReactMutation'
    },
    body: body.toString()
  });

  const result = await response.json();
  return result?.data?.feedback_react?.feedback?.viewer_feedback_reaction_info;
}
```

---

## 6. Đồng Bộ Giao Diện Người Dùng (DOM Click Sync)

Bên cạnh việc bắn API ngầm, extension tiến hành kích hoạt sự kiện chuột để icon giao diện đổi màu (phục vụ mắt người kiểm tra trực quan):

1. **Tìm kiếm nút Reaction trong phạm vi bài viết:**
   - Ưu tiên container `[role="dialog"]` hoặc phần tử chứa thẻ `<video>` chính để không click nhầm vào các bài viết trôi ngầm phía dưới Newsfeed.
   - Lọc bỏ hoàn toàn các nút trong phần bình luận (`[aria-label*="Comment"]`, `ul li`).
2. **Kích hoạt cảm xúc LOVE (Yêu thích):**
   - Bắn chuỗi sự kiện `pointerover` -> `mouseover` -> `mouseenter` vào nút Like để kích hoạt thanh Dock Reaction của Facebook.
   - Khi thanh Dock xuất hiện, tự động query và click phần tử `div[aria-label="Love"], div[aria-label="Yêu thích"]`.
   - Nếu không hiện dock sau 500ms: Fallback tự động click nút Like chính.
3. **Kích hoạt cảm xúc LIKE (Thích):**
   - Bắn trực tiếp `postBtn.click()` kết hợp PointerEvent sequence.

---

## 7. Hiển Thị Trạng Thái Trực Quan Trên Banner HUD

Trong suốt chu kỳ Warmup, Banner HUD nổi trên đỉnh tab (`#fb-hunter-warmup-hud`) hiển thị tiến trình theo thời gian thực:

- `Đang thả Yêu thích (❤️ Love) & xem video (15s)...`
- Khi GraphQL trả về thành công: chuyển ngay thành `Đã thả thành công Yêu thích (❤️ Love)! Đang xem video (12s)...`
- Sau khi kết thúc thời gian xem: Banner đổi viền xanh lá `#10b981` với thông báo:  
  `✓ Hoàn tất Warmup! Đã thả Yêu thích (❤️ Love). Tab được giữ nguyên để bạn kiểm tra.`
