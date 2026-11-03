# Hướng Dẫn Kỹ Thuật & Vận Hành: Tab Manual (🛠️ Chế Độ Thực Nghiệm Thủ Công & Bóc Tách Inote)

> **Dự án:** FB Video Ads Hunter & Warmup Engine  
> **Module:** Tab Lớn `🛠️ Manual` (#view-manual)  
> **Mục tiêu:** Cung cấp môi trường kiểm thử độc lập, chạy tương tác đơn lẻ hoặc xử lý hàng đợi link từ Inote/file `.txt` mà không làm xáo trộn tiến trình quét tự động tại tab `Video Ads Hunter`.

---

## 1. Tổng Quan Kiến Trúc Tab Manual

Tab `🛠️ Manual` được thiết kế nhằm tách biệt hoàn toàn giữa hai nhu cầu cốt lõi:
1. **Săn & Lọc Tự Động (Auto Feed Scanner):** Quét Newsfeed, nhận diện bài quảng cáo video, chấm điểm AI Vision và nuôi tài khoản tự động (nằm tại tab `Video Ads Hunter`).
2. **Thực Nghiệm & Điều Phối Chủ Động (Manual Testing & Inote Dispatcher):** Nhập trực tiếp danh sách link (từ Inote, file `.txt`, hoặc dán thủ công), phân luồng thông minh, kiểm thử từng bài post FB hoặc kiểm thử luồng mua hàng Webstore độc lập (nằm tại tab `Manual`).

Giao diện tab Manual bao gồm **3 module chính**:
- **Module 1:** ⚡ Inote Smart Dispatcher (Tự Động Phân Luồng Link Hàng Loạt).
- **Module 2:** 🚀 Test Thực Nghiệm 7 Bước Super-Buyer Pixel (Webstore Độc Lập).
- **Module 3:** 🔥 Test Thực Nghiệm Warmup FB Post (Thả Tim / Like / Care & Xem Video Đơn Lẻ).

---

## 2. Chi Tiết Các Module Trong Tab Manual

### 2.1. Module 1: Inote Smart Dispatcher (Tự Động Phân Luồng Link Hàng Loạt)

Đây là tính năng mạnh mẽ nhất của tab Manual, cho phép nạp hàng loạt liên kết và tự động điều phối theo đúng bản chất của từng URL.

```
                                [ NHẬP NGUỒN LINK ]
                 (Link Inote / File .txt / Dán trực tiếp vào Textarea)
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ BỘ PHÂN LOẠI KÉP (SMART CLASSIFIER)   │
                     └───────────────────┬───────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
      ┌─────────────────────────┐                 ┌─────────────────────────┐
      │   LUỒNG 1: FB POST      │                 │ LUỒNG 2: STORE DIRECT   │
      │  (story.php, reel,...)  │                 │ (Shopify, l.facebook,..)│
      ├─────────────────────────┤                 ├─────────────────────────┤
      │ 1. Mở bài viết FB       │                 │ 1. Bỏ qua Facebook      │
      │ 2. HUD đếm ngược video  │                 │ 2. Giải mã unwrap URL   │
      │ 3. Thả Reaction đã chọn │                 │ 3. Giữ nguyên fbclid    │
      │ 4. Quét tìm CTA mua hàng│                 │ 4. Kích hoạt 7 bước     │
      │ 5. Chuyển sang Webstore │                 │    Super-Buyer Pixel    │
      └────────────┬────────────┘                 └────────────┬────────────┘
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
                     ┌───────────────────────────────────────┐
                     │ KẾT THÚC CHU TRÌNH → NGHỈ 2 GIÂY     │
                     │ TỰ ĐỘNG CHUYỂN SANG LINK TIẾP THEO    │
                     └───────────────────────────────────────┘
```

#### A. Các Thành Phần Giao Diện (UI Elements):
- **Ô nhập link Inote (`#txtInoteUrl`):** Nhập liên kết Inote dạng `https://inote.net/...`.
- **Nút "📥 Tải Link" (`#btnFetchInote`):** Tự động fetch nội dung text từ `textarea#content.lined` của Inote, phân tách từng dòng và đổ dữ liệu vào ô Textarea.
- **Nút "📂 File .txt" (`#btnUploadTxtFile`):** Mở hộp thoại chọn tệp `.txt` từ máy tính để tải danh sách link.
- **Khung Textarea danh sách (`#txtInoteLinkList`):** Hiển thị danh sách URL (mỗi dòng một link). Có thể chỉnh sửa, thêm/bớt trực tiếp. Nút `Xóa trắng` cho phép dọn sạch nội dung nhanh chóng.
- **Hệ thống Live Badges (Phân loại thời gian thực):**
  - `📊 Tổng: X link`: Tổng số liên kết hợp lệ trong danh sách.
  - `🔵 FB Post (Warmup + Click CTA): Y`: Số link nhận diện là bài viết Facebook.
  - `🟢 Mua Hàng Trực Tiếp (7 Bước): Z`: Số link nhận diện là Webstore e-commerce hoặc link chuyển hướng `l.facebook.com`.
- **Cấu hình thực thi hàng đợi:**
  - **Reaction FB Post (`#selectInoteReaction`):** Chọn loại cảm xúc (`🎲 Random`, `👁️ Chỉ xem video`, `❤️ Love`, `👍 Like`, `🥰 Care`, `😆 Haha`, `😮 Wow`).
  - **Xem video FB (`#inputInoteWatchSeconds`):** Cài đặt số giây xem video (mặc định 15s).
  - **Checkbox Tự động click link CTA (`#chkAutoClickCta`):** Nếu bật, sau khi xem video xong sẽ tự động bóc tách link sản phẩm và chuyển tiếp sang chạy 7 bước Super-Buyer trên Webstore.
- **Cụm nút điều khiển & Monitor:**
  - **Nút "🚀 Bắt Đầu Tự Động Phân Luồng" (`#btnRunInoteQueue`):** Kích hoạt hàng đợi tuần tự.
  - **Nút "⏹ Dừng Lại" (`#btnStopInoteQueue`):** Hủy hàng đợi đang chạy.
  - **Khung Monitor (`#inoteQueueMonitor`):** Hiển thị trạng thái tiến trình `[Link X/N]`, URL đang xử lý, và thông báo kết thúc `🎉 ĐÃ HOÀN TẤT TOÀN BỘ DANH SÁCH`.

---

### 2.2. Module 2: Test Thực Nghiệm 7 Bước Super-Buyer Pixel

Dành cho việc kiểm thử độc lập quy trình nuôi Pixel e-commerce trên bất kỳ đường link sản phẩm nào (Shopify, WooCommerce, v.v.) mà không cần mở Facebook.

#### A. Các Bước Thực Thi Tự Động (7 Bước):
1. **Bước 1 - Nhận Diện Nền Tảng:** Quét DOM nhận diện Shopify, WooCommerce, Wix, Magento, v.v.
2. **Bước 2 - Lướt Xem & Chọn Biến Thể:** Cuộn trang mô phỏng mắt đọc tự nhiên (ViewContent), tự động click chọn biến thể (size, màu sắc) nếu sản phẩm có options.
3. **Bước 3 - Thêm Vào Giỏ & Sang Checkout:** Click `Add to Cart`, phát hiện drawer giỏ hàng hoặc chuyển hướng sang trang thanh toán (`InitiateCheckout`).
4. **Bước 4 - Điền Thông Tin Giao Hàng US Chuẩn:** Tự động điền họ tên (`Emily Davis`), email, địa chỉ Mỹ, khớp bang và ZIP code với 0 lỗi đỏ xác thực trên React 18/19.
5. **Bước 5 - Giả Lập Nhập Thẻ PCI:** Quét xuyên thấu qua các Iframe thẻ thanh toán (Shopify PCI / Stripe), điền thông tin thẻ giả lập, nhấn `Pay Now` và đếm ngược 10 giây để kích hoạt triệt để event `AddPaymentInfo`.
6. **Bước 6 - Mở Cổng Ví PayPal:** Chuyển radio sang PayPal, phát hiện vị trí Iframe ví và phát lệnh Trusted Hardware Click (CDP) mở popup PayPal thật, giữ trang 10 giây để ghi nhận ý định mua hàng cao nhất.
7. **Bước 7 - Hoàn Tất & Đóng Tab:** Bắn tín hiệu `STORE_FLOW_COMPLETED` về extension và tự động đóng tab store an toàn.

#### B. Các Thành Phần Giao Diện:
- **Ô nhập link sản phẩm (`#txtDemoStoreUrl`):** Nhập URL sản phẩm hoặc trang checkout.
- **Nút "⚡ Kích Hoạt 7 Bước Super-Buyer Ngay" (`#btnRunDemoStoreFlow`):** Mở tab và chạy quy trình ngay lập tức.
- **Dòng thông báo trạng thái:** Báo cáo realtime từng bước từ 1/7 đến 7/7.

---

### 2.3. Module 3: Test Thực Nghiệm Warmup FB Post Đơn Lẻ

Dành cho việc kiểm tra chất lượng tương tác (thả tim, like, care, xem video) trên một bài viết Facebook cụ thể.

#### A. Các Thành Phần Giao Diện:
- **Ô nhập link bài viết (`#txtDemoWarmupUrl`):** Hỗ trợ link `story.php`, `reel`, bài viết chia sẻ, v.v.
- **Dropdown chọn link mẫu từ Inote (`#selectSampleWarmupUrl`):** Cung cấp sẵn các bài post mẫu thực chiến (Chilipad, Navage, Gravity Gliders, v.v.) để test nhanh 1-click.
- **Dropdown chọn cảm xúc (`#selectTestReaction`):** Chọn loại cảm xúc mong muốn.
- **Ô thời gian xem (`#inputTestWarmupSeconds`):** Tùy chỉnh số giây xem video (3–60 giây).
- **Nút "🔥 Kích Hoạt Test Warmup Thả Tim Ngay" (`#btnRunTestWarmup`):** Mở tab bài viết, đính kèm Banner HUD đếm ngược và thực thi thả reaction kép (Trusted Hardware Click + GraphQL Mutation).
- **Kết quả:** Hiển thị dòng trạng thái xác thực `✓ Backend Facebook đã xác nhận 100% tương tác!`. Tab được giữ nguyên để người dùng trực tiếp quan sát.

---

## 3. Quy Trình Vận Hành Mẫu Cho Người Dùng (Step-by-Step Guide)

### Kịch bản: Nuôi Pixel hàng loạt từ link Inote
1. Mở Side Panel extension trên trình duyệt Facebook.
2. Bấm chuyển sang tab **`Manual`** trên thanh điều hướng đầu trang.
3. Dán link Inote vào ô **`Nguồn file Inote`** (ví dụ: `https://inote.net/OYWsQSTfM2`).
4. Bấm nút **`📥 Tải Link`**: Danh sách liên kết sẽ lập tức được bóc tách và phân loại thành 2 màu badge (Xanh dương: FB Post, Xanh lục: Mua hàng trực tiếp).
5. Thiết lập Reaction mong muốn (khuyên dùng `🎲 Random` để đạt độ tự nhiên cao nhất) và số giây xem video (ví dụ: `15` giây).
6. Tích chọn **`Tự động click link CTA trong bài FB để tiếp tục 7 bước Super-Buyer`**.
7. Bấm nút **`🚀 Bắt Đầu Tự Động Phân Luồng`**.
8. Hệ thống sẽ tự động duyệt từng bài, xem video, thả cảm xúc, bắt link webstore, kích hoạt 7 bước mua hàng và chuyển tiếp tuần tự cho đến khi hoàn tất 100%.

---

## 4. Đặc Tả Kỹ Thuật & Tương Thích

- **Môi trường:** Tương thích hoàn toàn với Chrome Extensions Manifest V3, Side Panel API, CDP (Chrome DevTools Protocol).
- **Trình duyệt hỗ trợ:** Google Chrome, GPM Login Browser, Undetectable, AdsPower, Multilogin.
- **Cơ chế chống nghẽn:** Sử dụng `activeStoreTabId` kết hợp `storeTabUpdateListener` độc lập, tự động hủy bỏ listener và dọn dẹp bộ nhớ sau khi đóng tab, tuyệt đối không gây xung đột với tab quét tự động `Video Ads Hunter`.
