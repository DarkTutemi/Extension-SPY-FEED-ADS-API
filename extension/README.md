# FB Video Ads Hunter - Chrome Extension (Side Panel)

Extension Chrome chuẩn Manifest V3 dạng **Side Panel** chuyên dụng tự động phát hiện, bóc tách và lọc các bài post **Video Ads** thực chiến (dropship/e-commerce) từ Newsfeed người dùng Facebook bằng giao thức **Hybrid GraphQL Pagination & Cuộn vật lý**.

---

## 1. 5 Tiêu Chí Lọc Nghiêm Ngặt

1. **`isAd === true`:** Bắt buộc là bài quảng cáo thực sự có gắn liên kết chuyển hướng tới Webstore bán hàng ngoài (loại trừ các bài share/rác nội bộ Facebook).
2. **`media_type === 'VIDEO'`:** Định dạng bắt buộc 100% phải là Video (loại trừ bài ảnh đơn, ảnh album, status text).
3. **`verification_status === 'NOT_VERIFIED'`:** Fanpage chưa có tích xanh (loại trừ các thương hiệu lớn như Nike, Apple, Gibson...; chỉ nhắm vào các shop e-commerce/dropship thực chiến).
4. **`like_count >= minLikes`:** Đạt ngưỡng tương tác tối thiểu (mặc định 500 likes, tùy chỉnh linh hoạt).
5. **`Engagement Ratio theo Setting & Chống Buff Ảo`:**
   - **Tỉ lệ sấp sỉ:** Cả 2 chỉ số Comment và Share độc lập đều phải đạt sấp sỉ mốc mục tiêu $Target = Likes \times Ratio$ với **dung sai cho phép từ -20% đến +20%** (`[0.80 * Target, 1.20 * Target]`):
     - `1/2`: 600 Like cần 240–360 Cmt và 240–360 Share; 500 Like cần 200–300 Cmt và 200–300 Share.
     - `1/3`: 500 Like cần 133–200 Cmt và 133–200 Share.
     - `1/4`: 600 Like cần 120–180 Cmt và 120–180 Share.
     - `1/5`: 500 Like cần 80–120 Cmt và 80–120 Share.
   - **Chống buff tương tác ảo:** Bắt buộc `Shares <= Math.max(1, Comments) * 5` (loại trừ 100% các bài bị buff share ảo vượt quá 5 lần comment).

---

## 2. Cấu Trúc Thư Mục Extension

```
H:\extension-timngach\extension-find-ads\
├── manifest.json       # Khai báo Side Panel MV3, quyền & content script
├── background.js       # Service worker mở Side Panel, điều phối trạng thái scanner
├── injected.js         # Hook fetch trong main world, lấy dtsg & gọi GraphQL trực tiếp
├── content_script.js   # Bộ lọc 5 tiêu chí & điều phối cuộn vật lý mượt
├── sidepanel.html      # Giao diện Side Panel chuẩn hiện đại
├── sidepanel.css       # Giao diện Dark-mode Glassmorphism cao cấp
├── sidepanel.js        # Controller điều khiển tương tác, xuất CSV/JSON
├── icons/              # Icon extension (16x16, 48x48, 128x128)
└── README.md
```

---

## 3. Cách Cài Đặt Vào Trình Duyệt (Chrome / Brave / GPM Login)

1. Mở trình duyệt, truy cập `chrome://extensions/`.
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục: `H:\extension-timngach\extension-find-ads`.
5. Truy cập `https://www.facebook.com/` (Home Feed).
6. Bấm vào icon tiện ích trên thanh công cụ để mở **Side Panel**.
7. Bấm **Bắt đầu quét** để hệ thống tự động bóc tách Video Ads thực chiến.
