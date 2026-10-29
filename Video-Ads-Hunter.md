# Video Ads Hunter — Toàn Bộ Logic, Kiến Trúc Code & Thiết Kế UI/UX

> **Phiên bản:** 2.0.0 (Manifest V3 — Side Panel)  
> **Mục tiêu:** Tự động săn tìm, bóc tách và audit chuyên sâu các bài post **Video Ads Dropship / E-commerce** thực chiến từ Facebook Newsfeed bằng cơ chế **Dual-Engine (Hybrid GraphQL Pagination + DOM Scraping)**.  
> **Repository:** [Extension-SPY-FEED-ADS-API](https://github.com/DarkTutemi/Extension-SPY-FEED-ADS-API)

---

## MỤC LỤC
1. [Tổng Quan & Giá Trị Cốt Lõi](#1-tổng-quan--giá-trị-cốt-lõi)
2. [5 Tiêu Chí Lọc Nghiêm Ngặt (Core Audit Filter)](#2-5-tiêu-chí-lọc-nghiêm-ngặt-core-audit-filter)
3. [Kiến Trúc Dual-Engine: Hybrid GraphQL & DOM Observer](#3-kiến-trúc-dual-engine-hybrid-graphql--dom-observer)
4. [Kỹ Thuật Reverse-Engineering Facebook Comet DOM](#4-kỹ-thuật-reverse-engineering-facebook-comet-dom)
5. [Cơ Chế Điều Khiển Cuộn: Auto vs Manual Mode](#5-cơ-chế-điều-khiển-cuộn-auto-vs-manual-mode)
6. [Hệ Thống Tab & 6 Bộ Lọc Nhật Ký Quét](#6-hệ-thống-tab--6-bộ-lọc-nhật-ký-quét)
7. [Thiết Kế UI/UX: Dark-Mode Glassmorphism Design System](#7-thiết-kế-uiux-dark-mode-glassmorphism-design-system)
8. [Cấu Trúc Thư Mục & Vai Trò Từng File](#8-cấu-trúc-thư-mục--vai-trò-từng-file)
9. [Chi Tiết Kỹ Thuật Từng Module Mã Nguồn](#9-chi-tiết-kỹ-thuật-từng-module-mã-nguồn)
10. [Hướng Dẫn Cài Đặt & Quy Trình Vận Hành Thực Chiến](#10-hướng-dẫn-cài-đặt--quy-trình-vận-hành-thực-chiến)

---

## 1. Tổng Quan & Giá Trị Cốt Lõi

Khác với các công cụ spy ads thông thường (chỉ quét Ad Library tĩnh vốn chứa hàng triệu bài quảng cáo không phát sinh đơn hoặc đã chết), **Video Ads Hunter** hoạt động trực tiếp trên **Facebook Home Feed thời gian thực**:

- **Tiếp cận bài Ads đang được phân phối sống (Active Delivery):** Thuật toán phân phối của Facebook chỉ đẩy vào Newsfeed những quảng cáo đang cắn tiền mạnh, tương tác thật từ người tiêu dùng.
- **Không xâm lấn DOM Facebook:** Sử dụng chuẩn **Chrome Side Panel API** mới nhất của Manifest V3. Toàn bộ bảng điều khiển, bộ lọc, thẻ bài viết và nhật ký chạy độc lập trong sidebar bên cạnh, không chèn banner rác hay làm chậm trang Facebook.
- **Tiêu chuẩn hoá chất lượng bài Ads:** Loại bỏ hoàn toàn thương hiệu lớn (Nike, Apple, Uniqlo...) qua kiểm tra tích xanh; lọc sạch bài buff tương tác ảo bằng công thức kiểm tra tỉ lệ Comments/Shares.

---

## 2. 5 Tiêu Chí Lọc Nghiêm Ngặt (Core Audit Filter)

Mọi bài quảng cáo xuất hiện trên Feed đều được đưa qua hàm thẩm định `auditAndFilterAd()`. Chỉ bài viết thỏa mãn đồng thời **cả 5 điều kiện** mới được đưa vào danh sách **"Ads Khớp Lọc"**:

```
                              [ BÀI ADS PHÁT HIỆN TRÊN FEED ]
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
             1. Có Webstore ngoài?                         2. Đúng Video Ads?
             (URL ngoài Facebook)                         (mediaType === 'VIDEO')
                       │                                           │
                       ├─────────────────────┬─────────────────────┤
                       ▼                                           ▼
             3. Fanpage KHÔNG tích xanh?             4. Likes >= minLikes?
             (Loại bỏ Big Brand)                           (Mặc định >= 500)
                       │                                           │
                       └─────────────────────┬─────────────────────┘
                                             ▼
                                5. Engagement Ratio Chuẩn & Chống Buff:
                                   • Comments nằm trong [0.8 * T, 1.2 * T]
                                   • Shares nằm trong [0.8 * T, 1.2 * T]
                                   • Shares <= max(1, Comments) * 5 (Chống buff ảo)
                                             │
                                             ▼
                               [ KẾT QUẢ: ĐẠT CHUẨN THỰC CHIẾN ]
```

### Chi Tiết Từng Tiêu Chí:

| Tiêu Chí | Biểu Thức Logic | Ý Nghĩa Thực Chiến |
|---|---|---|
| **1. Is Ad & External Webstore** | `hasStoreUrl && !isInternalFb` | Bắt buộc bài viết có nút CTA hoặc liên kết dẫn về Website/Store ngoài (Shopify, WooCommerce, Custom Store). Loại trừ bài share chéo, nhóm hoặc bài viết thông thường. |
| **2. Media Format** | `mediaType === 'VIDEO'` | Bắt buộc định dạng là Video (hiển thị thời lượng, thumbnail video). Loại trừ 100% ảnh đơn, ảnh album, status chữ. |
| **3. Brand Exclusion** | `isVerified === false` | Loại trừ các trang có tích xanh xác minh (Meta Verified / Blue Badge). Giúp dropshipper/e-commerce spy đúng các đối thủ cùng phân khúc ngách. |
| **4. Minimum Likes** | `likes >= settings.minLikes` | Ngưỡng Like tối thiểu (mặc định 500). Loại bỏ các bài ads mới test, ngân sách thấp, chưa được thị trường đón nhận. |
| **5. Ratio & Anti-Buff** | $Target = Likes \times Ratio$<br>$0.80 \times Target \le Cmt \le 1.20 \times Target$<br>$0.80 \times Target \le Share \le 1.20 \times Target$<br>$Shares \le \max(1, Comments) \times 5$ | Đảm bảo tương tác thật, tự nhiên theo tỷ lệ cấu hình (1/2, 1/3, 1/4, 1/5). Đồng thời triệt tiêu hoàn toàn các bài chạy dịch vụ buff Share ảo. |

---

## 3. Kiến Trúc Dual-Engine: Hybrid GraphQL & DOM Observer

Để cân bằng giữa **tốc độ thu thập dữ liệu** và **tính bảo mật của tài khoản Facebook**, extension sử dụng mô hình kết hợp song song 2 động cơ:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                             MÔI TRƯỜNG TRÌNH DUYỆT                            │
├───────────────────────────────────────┬───────────────────────────────────────┤
│    MAIN WORLD (injected.js)           │    ISOLATED WORLD (content_script.js) │
│                                       │                                       │
│  [Hook window.fetch]                  │  [DOM Scanner Loop]                   │
│    │                                  │    │                                  │
│    ├── Bắt token CSRF: fb_dtsg        │    ├── Quét div[role="feed"]          │
│    ├── Bắt UID: __user                │    ├── Đọc nút CTA (CSS Scramble fix) │
│    ├── Bắt doc_id & end_cursor        │    └── Bóc tách Like, Cmt, Share live │
│    │                                  │    │                                  │
│    ▼                                  │    ▼                                  │
│  [Bắn GraphQL Comet Pagination Query] │  [Khớp Nối 2 Nguồn Dữ Liệu (Reconcile)]│
│    │ (Lấy trước feed unit dạng JSON)   │    │ (Ghép GraphQL Data + DOM Data)   │
│    │                                  │    ▼                                  │
│    └──────── window.postMessage ──────┼──► [Chạy Hàm Thẩm Định 5 Tiêu Chí]    │
│                                       │    │                                  │
│                                       │    ▼                                  │
│                                       │  [chrome.runtime.sendMessage]         │
└───────────────────────────────────────┴────────────────────┬──────────────────┘
                                                             │
                                                             ▼
                                                [BACKGROUND SERVICE WORKER]
                                                             │
                                                             ▼
                                                    [CHROME SIDE PANEL]
```

1. **Engine A — GraphQL Interceptor & Fetcher (`injected.js`):**
   - Chạy trực tiếp trong ngữ cảnh trang (`Main World`).
   - Hook `window.fetch` để tóm các gói tin `CometNewsFeedPaginationQuery` và `CometNewsFeedQuery`.
   - Trích xuất tự động `doc_id`, `fb_dtsg`, `user_id` và con trỏ phân trang `end_cursor`.
   - Khi cần tăng tốc, có thể chủ động bắn thêm request GraphQL ngầm để nhận trước payload JSON nguyên bản từ Meta.

2. **Engine B — Real DOM Crawler & Observer (`content_script.js`):**
   - Chạy trong `Isolated World` an toàn.
   - Tìm kiếm các container bài post thông qua bộ selector thích ứng:
     `div[role="feed"] > div`, `div[role="article"]`, `div[data-pagelet*="FeedUnit"]`.
   - Bóc tách các trường hiển thị trực quan: Video Player, thời lượng video, badge tích xanh, avatar Fanpage, số Like/Cmt/Share đã render.

3. **Cơ Chế Reconcile (Hợp Nhất Dữ Liệu):**
   - Dữ liệu DOM cung cấp độ chính xác tuyệt đối về trạng thái hiển thị (Text CTA thực, liên kết mở popup).
   - Dữ liệu GraphQL cung cấp metadata ẩn (ID chiến dịch quảng cáo, URL stream video HD).
   - Hệ thống dùng `adId` và `postUrl` làm khoá chính để gộp 2 luồng, đảm bảo không trùng lặp và không sót trường thông tin.

---

## 4. Kỹ Thuật Reverse-Engineering Facebook Comet DOM

### 4.1. Giải Mã Cơ Chế Xáo Trộn Ký Tự Nút CTA (`CometGHLScrambledLabel`)
Facebook áp dụng kỹ thuật xáo trộn CSS tinh vi để ngăn cản các bot bóc tách nhãn nút bấm:
- Chèn hàng loạt chữ cái rác có CSS `position: absolute; width: 0; height: 0; opacity: 0;`.
- Đảo thứ tự hiển thị của các ký tự thật thông qua thuộc tính CSS `order: <number>`.

**Giải thuật bóc tách CTA trong `content_script.js`:**
```javascript
function extractScrambledLabel(container) {
  if (!container) return '';
  const labelDiv = container.querySelector('div.x1iorvi4') || container;
  const spans = Array.from(labelDiv.querySelectorAll('span'));
  if (spans.length === 0) return container.innerText.trim();

  const charItems = [];
  spans.forEach(span => {
    const style = window.getComputedStyle(span);
    // Bỏ qua ký tự tàng hình (decoy)
    if (style.position === 'absolute' || style.display === 'none' || style.opacity === '0') {
      return;
    }
    const text = span.textContent;
    if (!text || text.length === 0) return;

    const order = parseInt(style.order, 10) || 0;
    charItems.push({ text, order });
  });

  if (charItems.length === 0) return container.innerText.trim();

  // Sắp xếp lại theo đúng thuộc tính CSS order thực tế
  charItems.sort((a, b) => a.order - b.order);
  return charItems.map(item => item.text).join('').trim();
}
```

### 4.2. Bóc Tách Chỉ Số Tương Tác (Like, Comment, Share) Chuẩn Hóa
Facebook sử dụng định dạng viết tắt linh hoạt theo ngôn ngữ (`1.2K`, `3.5M`, `450 bình luận`, `12 lượt chia sẻ`).
Hệ thống sử dụng Regex đa tầng kèm hệ số nhân:
```javascript
function parseMetric(text) {
  if (!text) return 0;
  const clean = text.replace(/,/g, '').trim().toUpperCase();
  const matchK = clean.match(/([\d.]+)\s*K/);
  if (matchK) return Math.round(parseFloat(matchK[1]) * 1000);
  const matchM = clean.match(/([\d.]+)\s*M/);
  if (matchM) return Math.round(parseFloat(matchM[1]) * 1000000);
  const num = clean.match(/(\d+)/);
  return num ? parseInt(num[1], 10) : 0;
}
```

---

## 5. Cơ Chế Điều Khiển Cuộn: Auto vs Manual Mode

Extension cung cấp công tắc **Toggle Switch** giúp chuyển đổi linh hoạt giữa 2 chế độ làm việc:

```
[Chế Độ AUTO (Tự cuộn)]  ──► Chấm xanh pulse, Track xanh lá, Thumb trượt phải
                           ├── Side Panel: Tự động trượt mượt về đỉnh khi có log mới
                           │   (Tự tạm dừng khi rê chuột / lăn chuột, đếm 5s hồi phục)
                           └── Facebook Feed: Tự động cuộn ngẫu nhiên (500-750px / 1.2-2.0s)

[Chế Độ MANUAL (Lăn tay)] ──► Chấm xám, Track xám đen, Thumb trượt trái
                           ├── Side Panel: Khóa hoàn toàn tự cuộn, cho phép lăn chuột đọc log tự do
                           └── Facebook Feed: Dừng cuộn tự động, cho phép lướt Newsfeed thủ công
```

### Chi Tiết Cấu Hình & Lưu Trữ:
- Trạng thái được đồng bộ qua `chrome.storage.local.set({ isAutoScrollEnabled })`.
- Đồng thời gửi thông điệp `UPDATE_SETTINGS` tới `background.js` và `SETTINGS_CHANGED` tới `content_script.js` để cập nhật biến `settings.autoScroll`.
- Khi người dùng muốn nghiên cứu kỹ một sản phẩm, chỉ cần bấm 1 click để chuyển sang `Manual` mà không cần tạm dừng cả máy quét.

---

## 6. Hệ Thống Tab & 6 Bộ Lọc Nhật Ký Quét

Giao diện Side Panel được phân chia thành 2 phân hệ độc lập:

### 6.1. Tab 1: 🎯 Ads Khớp Lọc
Nơi lưu trữ danh bạ các bài **Winning Video Ads** đã vượt qua toàn bộ 5 tiêu chí.
- **Header:** Hiển thị tổng số bài đạt chuẩn, nút xuất file **CSV** và **JSON**.
- **Thẻ Card:**
  - Avatar, tên Fanpage (kèm link trang).
  - Huy hiệu CTA nổi bật: `[Shop now]`, `[Order now]`, `[Learn more]`.
  - Badges số liệu: Like (vàng cam), Comment (xanh lục), Share (xanh dương).
  - Video preview: Thumbnail, thời lượng video (ví dụ `18s`), nút sao chép link Webstore trực tiếp.
  - Link vĩnh viễn tới bài viết Facebook (`FB Story Post`).

### 6.2. Tab 2: 📋 Nhật Ký Quét (Audit Logs)
Lưu lại toàn bộ các bài quảng cáo xuất hiện trên feed (kể cả bài bị loại), phục vụ công tác đối soát chi tiết.

#### Thanh Toolbar 6 Bộ Lọc Pill:
1. **`Tất cả` (All):** Xem toàn bộ các bài quảng cáo bắt được.
2. **`Chỉ Video` (Video):** Chỉ hiển thị các bài quảng cáo định dạng Video.
3. **`Chỉ hình` (Photo):** Chỉ hiển thị các bài quảng cáo dạng Ảnh đơn (`PHOTO`) hoặc Album xoay vòng (`CAROUSEL`).
4. **`Tích xanh` (Verified):** Lọc riêng các bài quảng cáo thuộc các Fanpage có tích xanh (thương hiệu lớn).
5. **`Thỏa mãn` (Matched):** Chỉ xem các bài vượt qua 5 tiêu chí.
6. **`Bị loại` (Rejected):** Xem các bài không đạt kèm danh sách lý do chi tiết.

#### Checklist Thẩm Định Trực Quan Trên Từng Log Card:
Mỗi card trong tab nhật ký đều in ra một checklist gồm 5 dòng:
- `✓ Có liên kết Webstore (Shop now)` hoặc `✗ Không có liên kết Webstore ngoài`
- `✓ Là Video Ads (15s)` hoặc `✗ Không phải Video (Định dạng: PHOTO)`
- `✓ Fanpage chưa tích xanh (Shop thực chiến)` hoặc `✗ Fanpage có tích xanh (Thương hiệu lớn)`
- `✓ Đủ Like (850 / cần >= 500)` hoặc `✗ Chưa đủ Like (42 / cần >= 500)`
- `✓ Tương tác tự nhiên & Comment/Share chuẩn tỉ lệ 1/2` hoặc `✗ Tỉ lệ lệch / Buff share ảo`

---

## 7. Thiết Kế UI/UX: Dark-Mode Glassmorphism Design System

Bảng điều khiển được thiết kế theo phong cách hiện đại với chuẩn Dark-Mode cao cấp:

```
┌────────────────────────────────────────────────────────┐
│ [▶] Video Ads Hunter   [● Sẵn sàng]   [ Bắt đầu quét ] │
├────────────────────────────────────────────────────────┤
│ [ ĐÃ DUYỆT: 142 ]   [ TỔNG ADS: 18 ]   [ KHỚP LỌC: 3 ] │
├────────────────────────────────────────────────────────┤
│ [▼] Cấu hình tiêu chí lọc (Min Likes, Ratio, F5 Time)  │
├────────────────────────────────────────────────────────┤
│  [ 🎯 Ads Khớp Lọc (3) ]     [ 📋 Nhật Ký Quét (18) ]  │
├────────────────────────────────────────────────────────┤
│ (Tất cả) (Chỉ Video) (Chỉ hình) (Tích xanh) (Thỏa mãn) │
├────────────────────────────────────────────────────────┤
│ [● Auto (Tự cuộn) [=O]]         [📥 .log] [JSON] [Xóa] │
├────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐ │
│ │ Fanpage: STEPR  [VIDEO 12s]             [X LOẠI BỎ]│ │
│ │ 🔥 34  💬 1  ↗ 1  [CTA: Shop now]                  │ │
│ │  ✓ Có liên kết Webstore (Shop now)                 │ │
│ │  ✓ Là Video Ads (12s)                              │ │
│ │  ✗ Fanpage có tích xanh (Thương hiệu lớn)          │ │
│ │  ✗ Chưa đủ Like (34 / cần >= 500)                  │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### Bảng Mã Màu Thiết Kế (Color Tokens):
- **Background chính:** `#0b0f19` (Deep Navy Midnight).
- **Background card:** `rgba(15, 23, 42, 0.8)` kết hợp `backdrop-filter: blur(12px)`.
- **Viền (Border):** `rgba(255, 255, 255, 0.08)` và `rgba(99, 102, 241, 0.25)`.
- **Accent Cyan (Số liệu & Xuất file):** `#06b6d4`.
- **Accent Green (Thỏa mãn & Auto Toggle):** `#10b981`.
- **Accent Amber (Cảnh báo tạm dừng):** `#f59e0b`.
- **Accent Rose (Bị loại & Nút Xóa):** `#f43f5e`.
- **Accent Indigo (Nút chính & Tab Active):** `#6366f1`.

---

## 8. Cấu Trúc Thư Mục & Vai Trò Từng File

```
extension-find-ads/
├── manifest.json         # Cấu hình Manifest V3: Permissions, Side Panel, Content Scripts
├── background.js         # Service Worker: Quản lý vòng đời quét, F5 tab định kỳ, đồng bộ state
├── injected.js           # Main World Script: Hook fetch, trích xuất CSRF & con trỏ GraphQL
├── content_script.js     # Isolated World: Bóc tách DOM, giải mã CTA, kiểm tra 5 tiêu chí lọc
├── sidepanel.html        # Khung HTML giao diện Side Panel
├── sidepanel.css         # Hệ thống giao diện Dark-Mode Glassmorphism & Micro-animations
├── sidepanel.js          # Controller điều khiển Side Panel, render dữ liệu, xuất CSV/JSON
├── icons/                # Icon biểu trưng các kích thước chuẩn: 16x16, 48x48, 128x128
├── README.md             # Hướng dẫn nhanh cho người dùng cuối
└── Video-Ads-Hunter.md   # Bản đặc tả kỹ thuật toàn diện (Tài liệu này)
```

---

## 9. Chi Tiết Kỹ Thuật Từng Module Mã Nguồn

### 9.1. `manifest.json`
- Sử dụng `"manifest_version": 3`.
- Khai báo quyền: `["sidePanel", "storage", "tabs", "activeTab", "scripting"]`.
- Khai báo `host_permissions`: `["*://*.facebook.com/*"]`.
- `side_panel`: Chỉ định mở `sidepanel.html` khi người dùng kích hoạt extension.
- `web_accessible_resources`: Cho phép nạp `injected.js` vào DOM trang chủ Facebook.

### 9.2. `background.js` (Service Worker)
- **Quản lý phiên Side Panel:** Mở bảng điều khiển bên phải trình duyệt qua `chrome.sidePanel.setPanelBehavior`.
- **Cơ Chế Auto-Refresh Tab Chống Rò Rỉ Bộ Nhớ (Memory Leak):**
  Facebook Feed cuộn lâu sẽ tích tụ hàng ngàn DOM Node làm nặng RAM. `background.js` tích hợp bộ đếm giờ tự động F5 tab theo chu kỳ cài đặt (mặc định 5 phút), sau khi trang tải xong sẽ tự động kết nối lại và kích hoạt máy quét tiếp tục chạy mà không làm mất dữ liệu đã bắt được.
- **Bộ Nhớ Đệm Toàn Cục:** Lưu trữ `scannerState`, trung chuyển thông điệp giữa các tab và sidepanel.

### 9.3. `injected.js` (GraphQL Hijacker)
- Ghi đè hàm gốc `window.fetch`.
- Lọc các request có header `X-FB-Friendly-Name: CometNewsFeedPaginationQuery`.
- Clone response và gửi dữ liệu thô sang cho `content_script.js` bằng `window.postMessage`.

### 9.4. `content_script.js` (Core Engine & Filter)
- Chứa hàm tính toán dung sai tỉ lệ `isApproximatelyTarget(actual, target, tolerance = 0.20)`.
- Chứa logic cuộn vật lý ngẫu nhiên `simulatePhysicalScroll()` (tạo bước cuộn ngẫu nhiên 500–750px kèm khoảng nghỉ jitter 1.2–2.0s để không bị Meta gắn cờ hành vi bot).
- Gửi thông tin về `background.js` qua các action: `AD_CAPTURED`, `AD_AUDIT_LOG`, `SCAN_STATS_UPDATE`.

### 9.5. `sidepanel.js` (Side Panel Controller)
- Quản lý trạng thái chuyển đổi tab, accordion cấu hình cài đặt.
- Lắng nghe sự kiện click các pill filter `all`, `video`, `photo`, `verified`, `matched`, `rejected`.
- Điều phối nút gạt Auto/Manual Scroll, theo dõi sự kiện chuột (`mouseenter`, `mousemove`, `mouseleave`, `wheel`, `mousedown`) để tự động dừng/chạy bộ cuộn log.
- Trình tạo file xuất bản: `exportToCSV()`, `exportToJson()`, `downloadAuditLogText()`.

---

## 10. Hướng Dẫn Cài Đặt & Quy Trình Vận Hành Thực Chiến

### Bước 1: Cài Đặt Lên Trình Duyệt
1. Mở Chrome, Brave hoặc các trình duyệt antidetect (GPM Login, AdsPower, Multilogin).
2. Truy cập thanh địa chỉ `chrome://extensions/`.
3. Bật góc phải: **Developer mode (Chế độ dành cho nhà phát triển)**.
4. Bấm **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục:
   `H:\extension-timngach\extension-find-ads`

### Bước 2: Khởi Chạy Săn Ads
1. Truy cập trang chủ Facebook: `https://www.facebook.com/`. Đăng nhập tài khoản cá nhân hoặc via.
2. Bấm vào biểu tượng **Video Ads Hunter** trên thanh tiện ích để mở Side Panel bên phải màn hình.
3. Trong bảng **Cấu hình tiêu chí lọc**, paneer có thể tùy biến:
   - *Lượng Like tối thiểu:* Ví dụ `300` hoặc `500`.
   - *Tỉ lệ thảo luận (Ratio):* Mặc định `1/2` (50% Like).
   - *Thời gian tự động F5:* Mặc định `5 phút` (giữ RAM máy luôn nhẹ).
4. Bấm nút **▶ Bắt đầu quét**.

### Bước 3: Theo Dõi & Xuất Dữ Liệu
- Khi máy quét chạy, Newsfeed sẽ tự động trượt mượt.
- **Tại Tab "Ads Khớp Lọc":** Xuất hiện ngay các bài Video Ads đạt chuẩn. Bấm **CSV** hoặc **JSON** để tải danh sách về cho đội Media / R&D sản phẩm.
- **Tại Tab "Nhật Ký Quét":** Có thể bấm gạt **Manual** để tự do kéo chuột nghiên cứu lý do các bài bị loại hoặc bấm tab **"Chỉ hình"** / **"Tích xanh"** để phân tích đối thủ cạnh tranh.
- Bấm **📥 Tải .log** để xuất báo cáo kiểm định chi tiết của toàn bộ phiên quét.

---

## 11. Hệ Thống Warmup Nuôi Tài Khoản & 7 Bước Super-Buyer Pixel

### 11.1. Chu Kỳ Tương Tác Warmup (Khi Trượt Ngưỡng Lọc)
- **Cơ chế kích hoạt:** Khi hệ thống quét liên tiếp `warmupThreshold` (mặc định 10 bài) video ads nhưng không thỏa mãn các tiêu chí lọc gắt gao (ví dụ bài không có link store ngoài, hoặc fanpage có tích xanh), hệ thống sẽ chọn bài video ad thứ 11 để thực hiện **Warmup Interaction**:
  1. Mở bài post trong tab mới hoặc tương tác trực tiếp.
  2. Bắn GraphQL mutation `CometUFIFeedbackReactMutation` (doc_id `27646120298312844`) thả reaction ngẫu nhiên (LIKE, LOVE, CARE).
  3. Giữ tab xem video trong `warmupWatchSeconds` (mặc định 15 giây) để tạo tín hiệu người dùng thật (High Watch Time).
  4. Đóng tab warmup và tiếp tục chu kỳ quét Newsfeed.

### 11.2. Quy Trình 7 Bước Giả Lập Khách Hàng VIP (Pixel Super-Buyer Flow)
Khi một bài Video Ad **thỏa mãn toàn bộ tiêu chí lọc**, hệ thống mở URL webstore ngoài và tự động kích hoạt kịch bản **Super-Buyer Pixel**:

1. **Bước 1 — Phát Hiện Nền Tảng (Store Platform Detection):**
   - Tự động nhận diện Shopify, WooCommerce, Magento, OpenCart, Wix, Funnelish thông qua `window.Shopify`, thẻ meta generator, `wp-content`, scripts đặc trưng.
2. **Bước 2 — Giả Lập Lướt Web & Chọn Biến Thể (ViewContent & Variant Picking):**
   - Cuộn tự nhiên xuống trang để kích hoạt sự kiện Facebook Pixel `ViewContent`.
   - Tìm và chọn ngẫu nhiên biến thể (Size, Color, Model) thông qua swatch, radio button, hoặc dropdown select.
3. **Bước 3 — Thêm Vào Giỏ & Tiến Hành Thanh Toán (AddToCart & InitiateCheckout):**
   - Bấm nút *Add to Cart* hoặc *Buy It Now* để kích hoạt Pixel `AddToCart`.
   - Tự động tick chấp thuận Điều khoản dịch vụ (*Terms & Conditions*) nếu có Cart Drawer.
   - Bấm nút *Checkout* hoặc điều hướng thẳng đến `/checkout` để kích hoạt Pixel `InitiateCheckout`.
4. **Bước 4 — Điền Thông Tin Khách Hàng Mỹ Hợp Chuẩn (US Shipping Data Generator):**
   - Sử dụng `UltimateDataGenerator` sinh bộ thông tin khách hàng Mỹ thực tế: Name, Email Gmail chuẩn, Phone, Address, State và ZIP code khớp chuẩn 100% (ví dụ: `CA 90210`, `IL 60614`, `TX 77002`).
   - Tự động bấm phím `Escape` sau khi điền địa chỉ để triệt tiêu gợi ý Google Places Autocomplete.
   - Nếu gặp form tùy biến lạ, DeepSeek API sẽ tự động phân tích DOM và ánh xạ trường chuẩn.
5. **Bước 5 — Giả Lập Thanh Toán Thẻ Tín Dụng (Credit Card & AddPaymentInfo):**
   - Chọn phương thức thanh toán Credit Card, điền thông tin thẻ test vào form chính hoặc các iframe bảo mật PCI (Shopify Card Fields, Stripe).
   - Bấm nút Thanh toán để kích hoạt sự kiện Pixel `AddPaymentInfo`.
   - Tích hợp 2Captcha API tự động giải checkpoint nếu phát hiện reCAPTCHA hoặc hCaptcha.
   - Đếm ngược 10 giây để Facebook Pixel ghi nhận trọn vẹn sự kiện.
6. **Bước 6 — Giả Lập Cổng Thanh Toán PayPal (High-Intent Buyer Signal):**
   - Chọn radio PayPal, kích hoạt click đáng tin cậy vào nút PayPal để mở popup đăng nhập chính thức.
   - Đợi 10 giây giả lập đăng nhập để gửi tín hiệu người mua hàng giá trị cao về pixel.
7. **Bước 7 — Hoàn Tất Quy Trình & Trở Về Facebook Feed:**
   - Đóng an toàn tab webstore và focus lại tab Facebook để tiếp tục chu kỳ săn ads tiếp theo.

---

## 12. Mắt Thần AI Vision Pool (Round-Robin 5 Keys Gemini & DeepSeek)

- **Gemini Vision 5-Key Pool:** Hệ thống tích hợp xoay vòng 5 API keys Gemini Vision tự động failover sang key kế tiếp khi gặp mã lỗi `429 Too Many Requests`.
- **DeepSeek Integration:** Chuyên trách phân tích cấu trúc DOM các trang thanh toán phức tạp để ánh xạ chính xác các ô nhập liệu họ tên, địa chỉ và mã bưu điện.
- **2Captcha Solver:** Tự động giải quyết các thử thách CAPTCHA xuất hiện tại cổng thanh toán nhằm đảm bảo quy trình nuôi pixel diễn ra liên tục 24/7.
