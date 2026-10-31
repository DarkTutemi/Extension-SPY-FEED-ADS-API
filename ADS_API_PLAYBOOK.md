# Sổ Tay Thực Chiến: Phân Tích & Chuẩn Hóa API Ads Facebook (Live Capture Log)

> Tài liệu ghi chép toàn bộ phương pháp kỹ thuật bắt gói tin, trích xuất cấu trúc AST GraphQL, dấu vết DOM bí mật của Meta, và nhật ký các trường hợp thực tế khi phân tích trực tiếp trên Newsfeed Facebook.

---

## 0. Ma Trận Phân Loại Toàn Diện (Post Taxonomy Matrix for ECC)

Để extension không bao giờ nhận nhầm hoặc bỏ sót, mọi bài viết xuất hiện trên Newsfeed được chuẩn hóa vào 7 nhóm định danh độc lập:

| Mã Loại | Tên Loại Bài Viết | Dấu Hiệu Đặc Trưng (DOM & GraphQL) | Hành Động Xử Lý Trong Extension |
|---|---|---|---|
| **P-01** | **Bài Cá Nhân / Bạn Bè (Organic User)** | Có timestamp ("2 hours ago", "vừa xong"), icon quyền riêng tư (Public/Friends), không có `data-ad-rendering-role`, không có `VIDEO_DR_STYLE`. | ⛔ **BỎ QUA 100%** |
| **P-02** | **Bài Group / Nhóm (Organic Group)** | Chứa link `a[href*="/groups/"]`, attribution group, không có sponsored. | ⛔ **BỎ QUA 100%** |
| **P-03** | **Bài Page Thường Hữu Cơ (Organic Page)** | Bài đăng thông thường của Fanpage (không chạy Ads), có timestamp ngày đăng, không có CTA external link. | ⛔ **BỎ QUA 100%** |
| **P-04** | **Bài Page Tích Xanh Hữu Cơ (Organic Verified Page)** | Có huy hiệu tích xanh xác minh + timestamp ngày đăng, không có sponsored. | ⛔ **BỎ QUA 100%** |
| **P-05** | **Video Ads Chuẩn (Target Video Ad)** | Có `data-ad-rendering-role`, `VIDEO_DR_STYLE`, `<video>`, nút CTA (Shop now, Subscribe, See details...), **chưa có tích xanh**. | 🎯 **MỤC TIÊU CỐT LÕI (Thu thập & Tính Warmup)** |
| **P-06** | **Video Ads Tích Xanh (Verified Video Ad)** | Là Video Ads thật nhưng Fanpage **có tích xanh** (nhãn hàng lớn / brand). | ⚠️ **THU THẬP ADS NHƯNG KHÔNG TÍNH WARMUP** |
| **P-07** | **Hình Ảnh Ads (Photo Ad)** | Có `data-ad-rendering-role`, `PHOTO`, link CTA, không có video. | 📸 **THU THẬP ADS NHƯNG KHÔNG TÍNH VÀO VIDEO WARMUP** |
| **P-08** | **Ad Cá Nhân / Dịch Vụ Không CTA / Không Store Ngoại (Boosted Post No Store)** | Có nhãn `Ad` hoặc `Sponsored` nhưng **KHÔNG có nút CTA**, **KHÔNG có link ra Website/Store sản phẩm ngoài** (chỉ kêu gọi comment "WAITLIST", "INBOX", tương tác trong Facebook). | ⛔ **BỎ QUA 100% (KHÔNG PHẢI E-COM/DROPSHIP AD & KHÔNG TÍNH WARMUP)** |

---

## 1. Phương Pháp Kỹ Thuật Bắt Gói Tin API (Reverse Engineering Method)

### 1.1. Tầng Mạng (Network / GraphQL Level)
Facebook Comet không dùng các API RESTful thông thường mà truyền toàn bộ dữ liệu qua các endpoint `/api/graphql/` với phương thức POST, phản hồi trả về dưới dạng JSON Lines (mỗi dòng là một payload chunk) hoặc được nạp sẵn trong các thẻ `<script>` Server-Side Rendering (Relay Store Hydration).

* **Công cụ can thiệp:**
  - Chrome DevTools Protocol (CDP) kết nối trực tiếp vào Remote Debugging Port của GPM Browser (`port 8137`).
  - Lắng nghe sự kiện `Network.responseReceived` và lấy dữ liệu thô bằng lệnh `Network.getResponseBody`.
  - Quét bộ nhớ Relay Store nhúng trong DOM:
    ```javascript
    Array.from(document.querySelectorAll('script')).find(s => s.innerText.includes('tên_fanpage'));
    ```

* **Dấu hiệu nhận diện bài Ads trong GraphQL AST:**
  1. `action_links`: Chứa `link_style: "VIDEO_DR_STYLE"` (Video Direct Response Style - dấu hiệu bài Video Ads Reels/Newsfeed).
  2. `cta_screen_renderer`: Chứa thông tin link đích thực tế (`action_link.url`), tên miền hiển thị (`link_display`), tiêu đề CTA (`title`).
  3. `comet_sections.context_layout.story.comet_sections.metadata`: Chứa `CometStorySponsoredLabelStrategy` hoặc `CometGHLScrambledLabel`.
  4. `comet_sections.call_to_action.story.tracking`: Chuỗi JSON mã hóa chứa `"adid"`, `"is_sponsored": 1`.
  5. `qrz_ctx_seg`: Chứa mã định danh `lbl_adv_iden` hoặc `ad_id`.
  6. `attachments[0].media.__typename === "Video"` kèm `attachment.url` dạng `https://www.facebook.com/reel/{video_id}/`.

---

### 1.2. Tầng Giao Diện (DOM / Obfuscation Bypass Level)
Meta áp dụng nhiều kỹ thuật chống cào dữ liệu (Anti-Scraping):
1. **Làm mờ chữ Ad/Sponsored:**
   - Thay chữ thô bằng SVG Sprite: `<svg><use xlink:href="#SvgId"></use></svg>`.
   - Chèn ký tự Zero-Width Space vô hình: `\u200B`, `\u034F`, `\uFEFF`.
2. **Dấu vết bí mật không thể giấu (DOM Fingerprint):**
   - Meta bắt buộc phải gắn các thuộc tính kỹ thuật nội bộ để hệ thống quảng cáo của họ tracking và render:
     - `[data-ad-rendering-role="title"]` : Tiêu đề quảng cáo (Headline)
     - `[data-ad-rendering-role="profile_name"]` : Tên Fanpage nhà quảng cáo
     - `[data-ad-rendering-role="meta"]` : Tên miền store bên ngoài
     - `[data-ad-rendering-role="story_message"]` : Nội dung bài viết (Caption)
     - `[data-ad-rendering-role="like_button"]` : Nút tương tác cảm xúc
     - `[data-ad-rendering-role="share_button"]` : Nút chia sẻ

---

## 2. Nhật Ký Chi Tiết Từng Trường Hợp Thực Chiến (Case Studies)

### Trường Hợp 1: `Bible with Frankie` (Mã Loại: P-05 - Video Ad Reel / Nút Subscribe)
* **Thời gian bắt:** 2026-10-31 14:31
* **Hình thức quảng cáo:** Video Reel ngắn, định dạng dọc (720x1280), phát tự động có nút overlay "Resume reel".

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "Bible with Frankie",
  "pageId": "61590397810344",
  "postId": "122151232473346593",
  "mediaType": "VIDEO",
  "videoId": "2126338768089956",
  "reelUrl": "https://www.facebook.com/reel/2126338768089956/",
  "videoDuration": "134.6s",
  "headline": "The Bible Study You've Been Missing",
  "ctaTitle": "Subscribe",
  "ctaDisplayDomain": "biblewithfrankie.com",
  "ctaRedirectUrl": "https://l.facebook.com/l.php?u=AUDdBmJ2ZewLo1Af0f4_ZCTjMvN4EgXDb0SRG9LJYc52GfbS5P9xLlQUlcSWtYsZKyno...",
  "metrics": {
    "likes": "111",
    "comments": "0",
    "shares": "13"
  },
  "hasBlueBadge": false
}
```

#### B. Cấu Trúc Trích Xuất Trực Tiếp Từ Gói GraphQL API
```json
{
  "owning_profile": {
    "__typename": "User",
    "name": "Bible with Frankie",
    "id": "61590397810344"
  },
  "post_id": "122151232473346593",
  "attachments": [
    {
      "media": {
        "__typename": "Video",
        "id": "2126338768089956"
      },
      "styles": {
        "__typename": "StoryAttachmentVideoStyleRenderer"
      },
      "attachment": {
        "url": "https://www.facebook.com/reel/2126338768089956/",
        "action_links": [
          {
            "__typename": "LinkOpenActionLink",
            "link_style": "VIDEO_DR_STYLE"
          }
        ],
        "cta_screen_renderer": {
          "action_link": {
            "link_display": "biblewithfrankie.com",
            "title": "Subscribe",
            "url": "https://l.facebook.com/l.php?u=..."
          }
        }
      }
    }
  ],
  "__module_component_CometFeedStoryVideoCTAScreenCallToAction_attachment": {
    "__dr": "CometFeedStoryVideoCTAScreenLinkOpenCallToAction.react"
  }
}
```

#### C. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Chữ Ad bị ẩn dưới thẻ SVG use -->
<a href="?__cft__[0]=...#?kej" role="link" target="_blank">
  <span>
    <svg><use xlink:href="#SvgWml1"></use></svg>
  </span>
</a>

<!-- Thuộc tính nhận diện nội bộ của Meta -->
<span data-ad-rendering-role="profile_name">Bible with Frankie</span>
<span data-ad-rendering-role="title">The Bible Study You've Been Missing</span>
<div data-ad-rendering-role="meta">BIBLEWITHFRANKIE.COM</div>
<div data-ad-rendering-role="like_button">111</div>
<div data-ad-rendering-role="share_button">13</div>
```

#### D. Kinh Nghiệm Rút Ra Cho Extension
1. **GraphQL:** Luôn kiểm tra `link_style === 'VIDEO_DR_STYLE'` và `cta_screen_renderer` để bắt Video Ads kể cả khi trường `sponsored_data` bị thiếu.
2. **DOM:** Bổ sung selector `[data-ad-rendering-role]` vào logic phát hiện bài Ads. Bất kỳ phần tử nào có thuộc tính này đều là Ads 100%.
3. **CTA Keywords:** Thêm nút `Subscribe`, `Book now`, `Apply now` vào danh sách từ khóa CTA hợp lệ.

---

### Trường Hợp 2: `Finding Love After 50/60 & How to Date` (Mã Loại: P-02 - Bài Viết Nhóm / Group)
* **Thời gian bắt:** 2026-10-31 14:59
* **Hình thức bài viết:** Bài đăng chia sẻ cá nhân của thành viên trong nhóm công khai kèm ảnh chân dung.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "groupName": "Finding Love After 50/60 & How to Date",
  "groupId": "7625452284140198",
  "authorName": "Iyanna L. Colly",
  "authorId": "1684309769",
  "postId": "29560362846889160",
  "classification": "GROUP_POST (P-02)",
  "isAd": false,
  "isGroup": true,
  "mediaType": "PHOTO (Ảnh chân dung, không có thẻ video)",
  "contentCaption": "Hiya!!! Hopefully this is the group where I’ll find my sweet heart 😂 — at New Orleans.",
  "groupUrl": "https://www.facebook.com/groups/7625452284140198/",
  "hasSponsored": false,
  "hasAdRenderingRole": false
}
```

#### B. Cấu Trúc Trích Xuất Trực Tiếp Từ Gói GraphQL API
```json
{
  "to": {
    "__typename": "Group",
    "id": "7625452284140198",
    "name": "Finding Love After 50/60 & How to Date"
  },
  "feedback": {
    "associated_group": {
      "context_actor_hovercard": "GROUP",
      "id": "7625452284140198"
    },
    "owning_profile": {
      "__typename": "User",
      "name": "Iyanna L. Colly",
      "id": "1684309769"
    }
  },
  "__module_component_CometFeedStoryActorLink_story": {
    "__dr": "CometFeedStoryTitleGroupMemberActor.react"
  },
  "creation_time": 1793151958,
  "attachments": [
    {
      "media": {
        "__typename": "Photo",
        "id": "10229041236410629"
      },
      "styles": {
        "__typename": "StoryAttachmentPhotoStyleRenderer"
      }
    }
  ]
}
```

#### C. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Có liên kết trỏ thẳng vào đường dẫn Group -->
<a href="https://www.facebook.com/groups/7625452284140198/..." role="link">
  Finding Love After 50/60 & How to Date
</a>

<!-- Chứa tên tác giả + timestamp tự nhiên "3 days ago" -->
<span>Iyanna L. Colly · 3 days ago · New Orleans, LA · 🌐</span>

<!-- TUYỆT ĐỐI KHÔNG có data-ad-rendering-role hay nút CTA external link nào -->
```

#### D. Kinh Nghiệm Rút Ra Cho Extension (Quy Tắc Loại Trừ P-02)
1. **GraphQL:** Nếu node chứa `to.__typename === "Group"` hoặc `feedback.associated_group` hoặc component `CometFeedStoryTitleGroupMemberActor`, lập tức bỏ qua 100%, không gửi vào pipeline đánh giá Ads.
2. **DOM:** Chỉ cần card chứa `a[href*="/groups/"]` và không có `[data-ad-rendering-role]`, lập tức `continue;` bỏ qua ngay từ bước duyệt thẻ đầu tiên.

---

### Trường Hợp 3: `Singles Over 50 · Join` (Mã Loại: P-02B - Bài Viết Nhóm Gợi Ý Kèm Nút "Join")
* **Thời gian bắt:** 2026-10-31 15:02
* **Hình thức bài viết:** Bài gợi ý tham gia nhóm công khai (Suggested Group Post) xuất hiện giữa Newsfeed, tiêu đề có nút `Join` (Tham gia) và bài viết của thành viên `Michelle Lee`.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "groupName": "Singles Over 50",
  "groupId": "8715334395240771",
  "authorName": "Michelle Lee",
  "heading": "Singles Over 50 · Join",
  "hasJoinAction": true,
  "postId": "122102645817346593",
  "classification": "SUGGESTED_GROUP_POST (P-02B)",
  "isAd": false,
  "isGroup": true,
  "mediaType": "PHOTO",
  "contentCaption": "What's good fellow singles! Where are you all from? Indianapolis, Indiana here! I'm ready for a change of state and scenery. Anyone else feeling this way?",
  "groupUrl": "https://www.facebook.com/groups/8715334395240771/",
  "hasSponsored": false
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Header bài viết mang cấu trúc Nhóm + Nút Join nội bộ Facebook -->
<h4>
  <a href="https://www.facebook.com/groups/8715334395240771/">Singles Over 50</a>
  <span> · </span>
  <div role="button" tabindex="0">Join</div>
</h4>

<!-- Tên tác giả + Ngày giờ đăng tự nhiên -->
<div>
  <span>Michelle Lee</span>
  <span> · 5 hours ago · </span>
  <svg aria-label="Shared with Public"></svg>
</div>

<!-- Nút Join dẫn về action nội bộ của Facebook (KHÔNG PHẢI External Webstore Link) -->
```

#### C. Bẫy Nguy Hiểm & Kinh Nghiệm Cho ECC Extension
1. **Bẫy nhầm lẫn CTA:**
   * Nút `Join` có thể bị các bộ regex CTA lỏng lẻo nhận nhầm thành nút Call-To-Action quảng cáo.
   * *Giải pháp:* Nút `Join` chỉ là hành động tham gia nhóm của Facebook. Tuyệt đối **KHÔNG** đưa từ khóa `join` vào danh sách CTA của Ads.
2. **Loại trừ Suggested Group:**
   * Dù bài này nằm ngoài luồng cá nhân (được thuật toán Facebook gợi ý lên Newsfeed), URL đích vẫn chứa `/groups/`.
   * Quy tắc vàng: Bất kỳ card nào chứa `a[href*="/groups/"]` và không có nhãn Sponsored/Ad đều là bài Group (loại `P-02` / `P-02B`) và phải bị loại bỏ 100%.

---

### Trường Hợp 4: `Smile Train` (Mã Loại: P-06 / P-07 - Quảng Cáo Tích Xanh & Định Dạng Photo)
* **Thời gian bắt:** 2026-10-31 15:05
* **Hình thức bài viết:** Bài quảng cáo kêu gọi quyên góp từ tổ chức phi lợi nhuận có tích xanh chính thức, định dạng 1 hình ảnh minh họa khổ vuông/dọc kèm link domain tổ chức.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "Smile Train",
  "isVerified": true,
  "verifiedBadgeType": "Blue Checkmark (Tích xanh chính thức)",
  "classification": "VERIFIED_PHOTO_AD (P-06 & P-07)",
  "isAd": true,
  "mediaType": "PHOTO (Định dạng ảnh tĩnh, không có Video)",
  "adLabelText": "Ad · 🌐",
  "contentCaption": "🎉 Experience an instant mood boost! Often the fastest way to feel happier is by making someone else smile. Even a small donation to Smile Train helps give a child a brig... See more",
  "creativeTextOverlay": "THE BEST SOLUTIONS COME FROM WITHIN COMMUNITIES.",
  "cardHeadline": "😄Joy Spread Here!",
  "cardSubtitle": "Nonprofit organization",
  "ctaTitle": "Donate now",
  "ctaDomain": "SMILETRAIN.ORG",
  "warmupEligible": false,
  "warmupReason": "BỊ LOẠI KHỎI WARMUP DO: (1) Fanpage có tích xanh; (2) Không phải định dạng Video"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tên Page + Huy hiệu tích xanh (Blue Verified Badge) -->
<h4>
  <a href="https://www.facebook.com/SmileTrain">Smile Train</a>
  <!-- SVG Tích xanh của Meta -->
  <svg aria-label="Verified" role="img" class="verified-badge">
    <path d="..."></path>
  </svg>
</h4>

<!-- Dòng nhãn quảng cáo chuẩn -->
<div>
  <span>Ad</span>
  <span> · </span>
  <svg aria-label="Shared with Public"></svg>
</div>

<!-- Card chân trang dẫn về Webstore/Tổ chức bên ngoài -->
<div data-ad-rendering-role="meta">SMILETRAIN.ORG</div>
<div data-ad-rendering-role="title">😄Joy Spread Here!</div>
<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fsmingletrain.org..." role="button">
  <span>Donate now</span>
</a>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:**
   * Có `Ad · 🌐` + CTA `Donate now` + tên miền `SMILETRAIN.ORG` ➔ **100% Là Bài Ads Hợp Lệ Của Facebook**.
   * Hành động: **Phải ghi nhận vào Tổng Số Ads Quét Được (`totalAds++`) và hiển thị thẻ trong Tab Nhật Ký Quét**.
2. **Kiểm tra Tích Xanh (Blue Badge Gate):**
   * Có `svg[aria-label*="Verified"]` ➔ `isVerified = true`.
   * Tiêu chí `Fanpage chưa tích xanh`: **✗ THẤT BẠI (Thương hiệu lớn / Tổ chức chính thức)**.
3. **Kiểm tra Định Dạng (Media Format Gate):**
   * Không có thẻ `<video>`, không có `VIDEO_DR_STYLE` ➔ `mediaType = 'PHOTO'`.
   * Tiêu chí `Là Video Ads`: **✗ THẤT BẠI (Định dạng: PHOTO)**.
4. **Quy Tắc Warmup:**
   * Dù bài này bị đánh rớt tiêu chí (trạng thái `✗ LOẠI BỎ`), nhưng vì **CÓ TÍCH XANH** và **KHÔNG PHẢI VIDEO**, nên:
   * **TUYỆT ĐỐI KHÔNG TĂNG BỘ ĐẾM WARMUP (GIỮ NGUYÊN BỘ ĐẾM).**

---

### Trường Hợp 5: `KSBW TV Action News 8` (Mã Loại: P-04 - Bài Viết Fanpage Tích Xanh Hữu Cơ)
* **Thời gian bắt:** 2026-10-31 15:10
* **Hình thức bài viết:** Bài đăng tin tức thời sự thông thường của đài truyền hình có tích xanh xác minh, có nút `Follow`, thời gian đăng `7 hours ago`.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "KSBW TV Action News 8",
  "isVerified": true,
  "verifiedBadgeType": "Blue Checkmark (title='Verified account')",
  "classification": "ORGANIC_PAGE_VERIFIED (P-04)",
  "isAd": false,
  "hasFollowButton": true,
  "timeText": "7 hours ago",
  "contentCaption": "Immigration policies, labor challenges, and transportation costs are driving up food prices, with growers and retailers feeling the strain. FULL STORY⬇️",
  "metrics": {
    "likes": "457",
    "comments": "440",
    "shares": "104"
  },
  "hasSponsored": false,
  "hasAdRenderingRole": false
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage + Huy hiệu tích xanh dạng title='Verified account' -->
<h4>
  <a href="https://www.facebook.com/ksbw8">KSBW TV Action News 8</a>
  <!-- SVG Tích xanh: Chú ý Meta dùng title="Verified account" chứ KHÔNG DÙNG aria-label -->
  <svg viewBox="0 0 12 12" role="img" title="Verified account">
    <title>Verified account</title>
    <path d="..."></path>
  </svg>
  <span> · </span>
  <div role="button">Follow</div>
</h4>

<!-- Thời gian đăng bài tự nhiên -->
<div>
  <span>7 hours ago</span>
  <span> · </span>
  <!-- Icon cài đặt bánh răng quyền riêng tư của Page -->
  <svg></svg>
</div>

<!-- Nút tương tác tự nhiên -->
<div aria-label="React with Like to KSBW TV Action News 8's post">457</div>
<div aria-label="Comment on KSBW TV Action News 8's post, 440 comments">440</div>
<div aria-label="Share, send this to friends or post it on your profile.">104</div>
```

#### C. Phát Hiện Kỹ Thuật Đột Phá & Kinh Nghiệm ECC
1. **Phát hiện selector tích xanh mới:**
   * Bổ sung selector `svg[title*="Verified" i], svg:has(title), [title*="Verified account" i]` vào hàm `isVerifiedPage()` của extension.
2. **Quy tắc phân biệt P-04 với Video/Photo Ads:**
   * Có nút `Follow` (Theo dõi) bên cạnh tên Page.
   * Có thời gian đăng bài `7 hours ago`.
   * Hoàn toàn không có thuộc tính `[data-ad-rendering-role]` hay nhãn Sponsored.
   * **Hành động của extension:** Loại trừ ngay lập tức (`continue;`), tuyệt đối không đưa vào bộ đếm Ads và không đưa vào Warmup.

---

### Trường Hợp 6: `Mariah Lukashewich and Windmill Air` (Mã Loại: P-05 - Target Video Ad Hợp Tác Thương Hiệu / Nút "See details")
* **Thời gian bắt:** 2026-10-31 15:26
* **Hình thức bài viết:** Video Ad dạng Reel (Reel Video Direct Response) hợp tác giữa nhà sáng tạo nội dung (`Mariah Lukashewich`) và nhãn hàng máy lọc không khí (`Windmill Air`). Nút kêu gọi hành động là `See details`, dẫn trực tiếp về webstore `shop.windmillair.com`.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "Mariah Lukashewich and Windmill Air",
  "creatorName": "Mariah Lukashewich",
  "creatorId": "100076224307685",
  "brandName": "Windmill Air",
  "postId": "1157755050108628",
  "mediaType": "VIDEO (Reel Direct Response)",
  "videoId": "1577879863600696",
  "reelUrl": "https://www.facebook.com/reel/1577879863600696/",
  "videoDuration": "88.9s (1 phút 29s, tỷ lệ 720x900)",
  "classification": "TARGET_VIDEO_AD (P-05 - Mục tiêu cốt lõi của Warmup)",
  "isAd": true,
  "isVerified": false,
  "headline": "Wellness Starts with Air",
  "description": "30 Day Risk-Free Trial and Lifetime Warranty",
  "ctaTitle": "See details",
  "ctaDisplayDomain": "SHOP.WINDMILLAIR.COM",
  "ctaRedirectUrl": "https://l.facebook.com/l.php?u=AUB5FgibqLy4...",
  "metrics": {
    "likes": "9",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": true,
  "warmupEvaluation": "✓ Là Video Ads | ✓ Chưa tích xanh | ✓ Có liên kết Webstore ngoài sàn (shop.windmillair.com) | ✗ Chưa đủ 200 Like (9/200) => LOẠI BỎ KHỎI DANH SÁCH THẮNG => TĂNG TIẾN ĐỘ WARMUP (Lũy tiến)"
}
```

#### B. Cấu Trúc Trích Xuất Trực Tiếp Từ Gói GraphQL API
```json
{
  "owning_profile": {
    "__typename": "User",
    "name": "Mariah Lukashewich",
    "id": "100076224307685"
  },
  "post_id": "1157755050108628",
  "attachments": [
    {
      "media": {
        "__typename": "Video",
        "id": "1577879863600696"
      },
      "styles": {
        "__typename": "StoryAttachmentVideoStyleRenderer"
      },
      "attachment": {
        "url": "https://www.facebook.com/reel/1577879863600696/",
        "action_links": [
          {
            "__typename": "LinkOpenActionLink",
            "link_style": "VIDEO_DR_STYLE"
          }
        ],
        "cta_screen_renderer": {
          "action_link": {
            "link_display": "shop.windmillair.com",
            "title": "See details",
            "url": "https://l.facebook.com/l.php?u=..."
          }
        }
      }
    }
  ]
}
```

#### C. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tên đồng thương hiệu Creator and Brand -->
<h4>
  <a href="...">Mariah Lukashewich</a> and <a href="...">Windmill Air</a>
</h4>

<!-- Dòng nhãn quảng cáo dạng Ad · 🌐 -->
<span>Ad · 🌐</span>

<!-- Các vai trò quảng cáo nội bộ của Meta -->
<div data-ad-rendering-role="meta">SHOP.WINDMILLAIR.COM</div>
<div data-ad-rendering-role="title">Wellness Starts with Air</div>
<div data-ad-rendering-role="description">30 Day Risk-Free Trial and Lifetime Warranty</div>
<a data-ad-rendering-role="cta-" href="https://l.facebook.com/l.php?u=...">
  <span>See details</span>
</a>
```

#### D. Phát Hiện Kỹ Thuật Trọng Yếu & Kinh Nghiệm Cho ECC
1. **Phát hiện từ khóa CTA mới: "See details"**:
   * Bắt buộc bổ sung `see details` vào danh sách regex CTA trong `content_script.js`.
2. **Quảng cáo Hợp tác Người sáng tạo & Nhãn hàng (Co-Branded Ads):**
   * Dù có tên creator, nhưng nếu có `VIDEO_DR_STYLE`, có CTA external link và có `[data-ad-rendering-role]`, thì đây **100% LÀ TARGET VIDEO AD** của nhãn hàng.
3. **Thẩm định Warmup chính xác:**
   * Đây là Video Ad chuẩn của shop thực chiến (chưa có tích xanh).
   * Likes: 9 (chưa đủ 200) ➔ Rớt tiêu chí chiến thắng ➔ **Đủ điều kiện kích hoạt Warmup và tăng bộ đếm Warmup lũy tiến**!

---

### Trường Hợp 7: `JillAnn Marsh` trong Nhóm `Finding Love After 50/60 & How to Date` (Mã Loại: P-02 - Bài Viết Nhóm Thành Viên Đăng Ảnh)
* **Thời gian bắt:** 2026-10-31 15:28
* **Hình thức bài viết:** Bài đăng chia sẻ tìm bạn đời của thành viên cá nhân trong nhóm công khai kèm ảnh selfie chân dung, thời gian đăng `a day ago`.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "groupName": "Finding Love After 50/60 & How to Date",
  "groupId": "7625452284140198",
  "authorName": "JillAnn Marsh",
  "authorId": "100030064962860",
  "postId": "29584760874449357",
  "classification": "GROUP_POST (P-02)",
  "isAd": false,
  "isGroup": true,
  "mediaType": "PHOTO (Ảnh chân dung tĩnh, không có Video)",
  "photoId": "2018920442453435",
  "timeText": "a day ago (Unix: 1793291432)",
  "contentCaption": "Hi all! 59 years young. Divorced a long time. Northern Indiana transplant. Michigan blood.",
  "groupUrl": "https://www.facebook.com/groups/7625452284140198/",
  "metrics": {
    "likes": "Nhiều tương tác thành viên trong nhóm",
    "comments": "Thảo luận nội bộ nhóm",
    "shares": "Chia sẻ nội bộ"
  },
  "hasSponsored": false,
  "hasAdRenderingRole": false
}
```

#### B. Cấu Trúc Trích Xuất Trực Tiếp Từ Gói GraphQL API
```json
{
  "post_id": "29584760874449357",
  "feedback": {
    "associated_group": {
      "context_actor_hovercard": "GROUP",
      "id": "7625452284140198"
    },
    "owning_profile": {
      "__typename": "User",
      "name": "JillAnn Marsh",
      "id": "100030064962860"
    }
  },
  "creation_time": 1793291432,
  "attachments": [
    {
      "media": {
        "__typename": "Photo",
        "id": "2018920442453435"
      },
      "styles": {
        "__typename": "StoryAttachmentPhotoStyleRenderer"
      }
    }
  ]
}
```

#### C. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề chứa link tới nhóm -->
<h4>
  <a href="https://www.facebook.com/groups/7625452284140198/...">Finding Love After 50/60 & How to Date</a>
</h4>

<!-- Tên tác giả + Ngày giờ đăng tự nhiên 'a day ago' -->
<div>
  <a href="/user/100030064962860">JillAnn Marsh</a>
  <span> · a day ago · </span>
  <svg aria-label="Shared with Public"></svg>
</div>

<!-- KHÔNG CÓ data-ad-rendering-role, KHÔNG CÓ nút CTA hay webstore link -->
```

#### D. Kinh Nghiệm Rút Ra Cho Extension (Quy Tắc Lọc P-02)
1. **Dấu hiệu thời gian tự nhiên "a day ago":**
   * Các bài viết của thành viên trong nhóm luôn mang mốc thời gian đăng tự nhiên (`a day ago`, `3 days ago`, `5 hours ago`...).
   * **Quy tắc:** Bài Ads thật của Meta **KHÔNG BAO GIỜ** có mốc thời gian kiểu này.
2. **Loại trừ tuyệt đối ở 2 tầng:**
   * Tầng GraphQL: Kiểm tra `feedback.associated_group` ➔ Bỏ qua ngay.
   * Tầng DOM: Kiểm tra `a[href*="/groups/"]` ➔ Bỏ qua ngay từ vòng duyệt đầu tiên.

---

### Trường Hợp 8: `The Family Institute at Northwestern University` (Mã Loại: P-07 - Quảng Cáo Hình Ảnh Chưa Tích Xanh / Bỏ Qua Khỏi Video Warmup)
* **Thời gian bắt:** 2026-10-31 15:33
* **Hình thức bài viết:** Bài quảng cáo dịch vụ trị liệu tâm lý, định dạng 1 hình ảnh tĩnh chụp chân dung kèm banner thông tin bảo hiểm y tế (`UnitedHealthcare • BCBS • Medicare • Self-Pay`).

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "The Family Institute at Northwestern University",
  "isVerified": false,
  "classification": "PHOTO_AD (P-07 - Quảng Cáo Ảnh Shop/Viện Thực Chiến)",
  "isAd": true,
  "mediaType": "PHOTO (Định dạng ảnh tĩnh, không có thẻ Video)",
  "adLabelText": "Ad · 🌐",
  "contentCaption": "Taking care of your mental health is one of the most important things you can do. Connect with a therapist who understands your needs and helps you build real, lasting change.",
  "creativeBannerText": "FOCUS ON YOU. FEEL LIKE YOURSELF AGAIN. UnitedHealthcare • BCBS • Medicare • Self-Pay",
  "cardHeadline": "Support for You, Every Step Forward.",
  "cardDescription": "Connect with experienced therapists who understand what you’re going through and are here to help.",
  "ctaDomain": "FAMILY-INSTITUTE.ORG",
  "ctaRedirectUrl": "https://l.facebook.com/l.php?u=AUDqeSSRHZHv...",
  "metrics": {
    "likes": "16",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupReason": "BỎ QUA KHỎI WARMUP: Định dạng là PHOTO (Ảnh tĩnh). Tiêu chuẩn kích hoạt Warmup bắt buộc phải là bài VIDEO Ads để đào tạo thuật toán xem video cho tài khoản."
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage chưa có tích xanh -->
<h4>
  <a href="...">The Family Institute at Northwestern University</a>
</h4>

<!-- Nhãn Ad có icon quả địa cầu -->
<span>Ad · 🌐</span>

<!-- Chân trang quảng cáo dẫn về website chính thức của viện -->
<div data-ad-rendering-role="meta">FAMILY-INSTITUTE.ORG</div>
<div data-ad-rendering-role="title">Support for You, Every Step Forward.</div>
<div data-ad-rendering-role="description">Connect with experienced therapists who understand what you’re going through and are here to help.</div>
<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Ffamily-institute.org..."></a>

<!-- Toolbar chỉ số tương tác -->
<div>16 reactions</div>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:**
   * Có `Ad · 🌐` + link ngoài sàn `FAMILY-INSTITUTE.ORG` ➔ **Là Bài Ads Thật 100%**.
   * Hành động: **Phải ghi nhận vào Tổng Số Ads Quét Được (`totalAds++`) và hiển thị thẻ trong Tab Nhật Ký Quét**.
2. **Kiểm tra Định Dạng (Media Format Gate):**
   * Không có `<video>`, không có `VIDEO_DR_STYLE` ➔ `mediaType = 'PHOTO'`.
   * Tiêu chí `Là Video Ads`: **✗ THẤT BẠI (Định dạng: PHOTO)**.
3. **Quy Tắc Warmup:**
   * Dù bài này chưa có tích xanh và bị đánh rớt tiêu chí (trạng thái `✗ LOẠI BỎ`), nhưng vì **ĐÂY LÀ BÀI ẢNH (PHOTO)**:
   * **TUYỆT ĐỐI KHÔNG TĂNG BỘ ĐẾM WARMUP (GIỮ NGUYÊN BỘ ĐẾM).**
   * Cơ chế Warmup chỉ kích hoạt tương tác khi gặp bài **VIDEO ADS** để giữ đúng tệp hành vi người dùng xem video thương mại điện tử.

---


### Trường Hợp 9: `Daily Record` (Mã Loại: P-04 - Bài Báo Fanpage Tích Xanh Đề Xuất Kèm Nút "Follow")
* **Thời gian bắt:** 2026-10-31 15:35
* **Hình thức bài viết:** Bài đăng tin tức thời sự của tòa soạn báo lớn (`Daily Record`), có dấu tích xanh chính thức, có nút `Follow` (Theo dõi), mốc thời gian tự nhiên `a day ago`.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "Daily Record",
  "isVerified": true,
  "verifiedBadgeType": "Blue Checkmark (title='Verified account')",
  "classification": "ORGANIC_PAGE_VERIFIED (P-04)",
  "isAd": false,
  "hasFollowButton": true,
  "timeText": "a day ago · 🌐",
  "contentCaption": "🚨 Police Scotland is probing the activities of Jeffrey Epstein and Ghislaine Maxwell at Balmoral Castle.... See more",
  "mediaType": "PHOTO (Ảnh chụp hiện trường tin tức, không có Video)",
  "metrics": {
    "likes": "Hàng trăm reactions tương tác đọc báo",
    "comments": "Thảo luận tin tức chính trị/xã hội",
    "shares": "Chia sẻ bản tin"
  },
  "hasSponsored": false,
  "hasAdRenderingRole": false
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nút Follow -->
<h4>
  <a href="https://www.facebook.com/TheDailyRecord">Daily Record</a>
  <!-- SVG Tích xanh chính thức của Meta -->
  <svg viewBox="0 0 12 12" role="img" title="Verified account">
    <title>Verified account</title>
    <path d="..."></path>
  </svg>
  <span> · </span>
  <div role="button">Follow</div>
</h4>

<!-- Mốc thời gian đăng bài tự nhiên -->
<div>
  <span>a day ago</span>
  <span> · </span>
  <svg aria-label="Shared with Public"></svg>
</div>

<!-- KHÔNG CÓ nhãn Ad/Sponsored, KHÔNG CÓ data-ad-rendering-role, KHÔNG CÓ link Webstore -->
```

#### C. Quy Tắc Loại Trừ Chuẩn Xác Cho ECC Extension
1. **Dấu hiệu đặc thù của bài viết đề xuất (Suggested Page Post):**
   * Bài viết không do tài khoản kết bạn hay theo dõi từ trước, mà do Facebook đề xuất lên Newsfeed.
   * Dấu hiệu phân biệt: Có nút `Follow` (Theo dõi) đặt ngay cạnh tên Page trên tiêu đề `h4`.
2. **Quy tắc vàng phân biệt với Ads:**
   * Dù là bài viết từ một Fanpage lạ xuất hiện trên Newsfeed, nhưng có thời gian đăng tự nhiên (`a day ago`), nút `Follow` và hoàn toàn **KHÔNG CÓ NHÃN ADS** (`Sponsored`, `Ad · 🌐`) hay `[data-ad-rendering-role]`.
   * **Hành động của extension:** Loại trừ ngay lập tức 100% (`continue;`), không ghi nhận vào tổng Ads quét được, không can thiệp vào tiến trình Warmup.

---


### Trường Hợp 10: `Centered Physical Therapy & Wellness LLC` (Mã Loại: P-08 - Ad Cá Nhân / Dịch Vụ Địa Phương Không Nút CTA & Không Có Link Webstore Ngoài)
* **Thời gian bắt:** 2026-10-31 15:38
* **Hình thức bài viết:** Video Ad dạng Reel/Dọc (tỷ lệ 720x1280, thời lượng 57.36s) chuyên gia cầm mô hình xương sườn giảng giải về hệ tiêu hóa.
* **Đặc điểm mấu chốt:** Bài viết chạy quảng cáo (`Ad · 🌐`) nhưng là dạng **Boost Post tương tác cá nhân/dịch vụ địa phương**, nội dung kêu gọi: *"Comment WAITLIST and I'll send you the details"*. Hoàn toàn **KHÔNG có nút CTA (Shop now / Learn more...)** và **KHÔNG có liên kết dẫn ra Website/Store sản phẩm ngoài**.

#### A. Dữ Liệu Bóc Tách Được
```json
{
  "pageName": "Centered Physical Therapy & Wellness LLC",
  "isVerified": false,
  "classification": "BOOSTED_POST_NO_STORE (P-08 - Chạy Ad Cá Nhân / Dịch Vụ Không CTA Không Store Ngoài)",
  "isAd": true,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "mediaType": "VIDEO (Thẻ video dọc 720x1280, thời lượng: 57.36s)",
  "adLabelText": "Ad · 🌐",
  "contentCaption": "What if the missing piece in your digestion isn't another food or supplement?... Ready to connect the dots? Comment WAITLIST and I'll send you the details. #HappyGutBlueprint #GutHealthForMoms #Digestion #NervousSystem #WomensWellness",
  "videoControls": ["Play video", "Play", "Unmute", "Settings", "Enter fullscreen"],
  "pageUrl": "https://www.facebook.com/CenteredPhysicalTherapy",
  "metrics": {
    "likes": "63",
    "comments": "0",
    "shares": "2"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ KHÔNG CÓ NÚT CTA | ✗ KHÔNG CÓ LINK WEBSTORE NGOÀI (Chỉ là bài Boost cá nhân kêu gọi Comment WAITLIST) => BỎ QUA 100%, KHÔNG PHẢI E-COMMERCE / DROPSHIP AD VÀ TUYỆT ĐỐI KHÔNG TÍNH VÀO TIẾN ĐỘ WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Page cá nhân / phòng khám không có tích xanh -->
<h4>
  <a href="https://www.facebook.com/CenteredPhysicalTherapy">Centered Physical Therapy & Wellness LLC</a>
</h4>

<!-- Nhãn Ad có icon quả địa cầu -->
<span>Ad · 🌐</span>

<!-- Nội dung bài kêu gọi comment trong Facebook, không có link webstore -->
<div>Comment WAITLIST and I'll send you the details.</div>

<!-- Thẻ Video thật đang chạy -->
<video src="..." style="width: 720px; height: 1280px;"></video>
<div role="button" aria-label="Play video"></div>
<div role="button" aria-label="Unmute"></div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Centered Physical Therapy & Wellness LLC's post">63</div>
<div aria-label="Comment on Centered Physical Therapy & Wellness LLC's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">2</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài & Nút CTA:**
   * Bài viết **KHÔNG có nút CTA**, **KHÔNG có link ra Website/Store sản phẩm bên ngoài** (URL đích = `null`, chỉ giữ chân tương tác trong comment).
   * ➔ **KẾT QUẢ: ✗ FAIL NGAY TỪ TIÊU CHÍ 1 (Không phải E-commerce Ads)**.
2. **Quy Tắc Warmup:**
   * Warmup là quá trình rèn luyện thuật toán Meta Pixel nhận diện tài khoản là **"Super-Buyer E-commerce"** (thường xuyên click link store ngoài, xem giỏ hàng, đặt hàng sản phẩm).
   * Các bài chạy Ads dịch vụ cá nhân / phòng khám / tương tác comment không có store ngoài **hoàn toàn vô nghĩa với hành vi nuôi Pixel mua hàng**.
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TĂNG BỘ ĐẾM WARMUP.**

---


### 2.11. Nghiên Cứu Trường Hợp 11: Nestig (P-05 - Winning Target Video Ad E-com >= 200 Likes)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Nestig",
  "isVerified": false,
  "classification": "TARGET_VIDEO_AD (P-05 - BÀI QUẢNG CÁO VIDEO THẮNG CUỘC / WINNING AD)",
  "isAd": true,
  "mediaType": "VIDEO (Thẻ video dọc/vuông, thời lượng: 42s)",
  "adLabelText": "Sponsored · [SVG Obfuscated]",
  "contentCaption": "We stopped comparing cribs the day we found this one. The 4-in-1 Briar Crib converts easily, kits included, built to last",
  "ctaTitle": "Stop Comparing Cribs",
  "ctaDescription": "Built to last, made to grow",
  "ctaDomain": "NESTIG.COM",
  "ctaButton": "Shop now (SVG Sprite #SvgWml353)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...NESTIG.COM...",
  "metrics": {
    "likes": "771 (741 likes + 30 cảm xúc)",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads | ✓ Fanpage chưa tích xanh | ✓ ĐỦ ĐIỀU KIỆN BÀI THẮNG (771 >= 200 Like) => LƯU DATABASE BÀI ADS CHIẾN THẮNG (KHÔNG TÍNH WARMUP VÌ ĐÃ LÀ SẢN PHẨM WIN)"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage chưa có tích xanh -->
<div data-ad-rendering-role="profile_name">Nestig</div>

<!-- Nội dung bài viết -->
<div data-ad-rendering-role="story_message">
  We stopped comparing cribs the day we found this one. The 4-in-1 Briar Crib converts easily, kits included, built to last
</div>

<!-- Trình phát Video thời lượng 42s -->
<div aria-label="Video player">0:00 / 0:42</div>
<div role="button" aria-label="Play video"></div>
<div role="button" aria-label="Unmute"></div>

<!-- Khung Call-To-Action dẫn sang shop e-commerce ngoài -->
<div data-ad-rendering-role="meta">NESTIG.COM</div>
<div data-ad-rendering-role="title">Stop Comparing Cribs</div>
<div data-ad-rendering-role="description">Built to last, made to grow</div>
<div data-ad-rendering-role="cta-">
  <a href="https://l.facebook.com/l.php?u=...NESTIG.COM..." target="_blank">
    <svg><use xlink:href="#SvgWml353"></use></svg>
  </a>
</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Nestig's post">771</div>
<div aria-label="Like: 741 people"></div>
<div aria-label="Comment on Nestig's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads & Video:**
   * Có `[data-ad-rendering-role="cta-"]` + `NESTIG.COM` + thẻ Video 42s ➔ **100% Là Video Ads E-commerce Chuyên Nghiệp**.
2. **Kiểm tra Tích Xanh (Blue Badge Gate):**
   * Không có huy hiệu verified ➔ `isVerified = false` ➔ Tiêu chí `Fanpage chưa tích xanh`: **✓ ĐẠT (Shop thực chiến, không phải tập đoàn lớn bảo trợ)**.
3. **Kiểm tra Ngưỡng Like:**
   * Số like thực tế: **771 Likes** (Vượt xa mốc chuẩn >= 200 Likes).
   * ➔ **Trạng thái: 🎯 ĐẠT CHUẨN BÀI THẮNG (WINNING PRODUCT AD)**.
4. **Quy Tắc Warmup & Thu Thập:**
   * **Hành động: LƯU VÀO DATABASE BÀI THẮNG (WINNING ADS VAULT)** để user nghiên cứu sản phẩm / video / content scale triệu view.
   * **Không tăng bộ đếm Warmup** vì bài viết này đã là bài thắng cần thu thập, chỉ những bài Video Ads dưới 200 like mới tính vào tiến độ lướt mồi Warmup.

---

### 2.12. Nghiên Cứu Trường Hợp 12: Ali Siddiq (P-04 - Organic Verified Page Post with Video)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Ali Siddiq",
  "isVerified": true,
  "classification": "ORGANIC_VERIFIED_PAGE (P-04 - Bài Fanpage Tích Xanh Hữu Cơ)",
  "isAd": false,
  "mediaType": "VIDEO (Reel/Video hài kịch)",
  "adLabelText": null,
  "hasFollowButton": true,
  "metrics": {
    "likes": "605 (419 Thích, 174 Haha, 12 Tim)",
    "comments": "14",
    "shares": "9"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Ads (Bài đăng tự nhiên) | ✗ Page có tích xanh | BỎ QUA 100% KHÔNG TÍNH WARMUP KHÔNG THU THẬP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nút Follow -->
<h4>
  <a href="https://www.facebook.com/AliSiddiq">Ali Siddiq</a>
  <svg title="Verified account"><path ...></svg>
  <span>Follow</span>
</h4>

<!-- Video player hữu cơ -->
<video src="..."></video>

<!-- Tương tác hữu cơ -->
<div aria-label="React with Like to Ali Siddiq's post">605</div>
<div aria-label="Comment on Ali Siddiq's post, 14 comments">14</div>
<div aria-label="Share, send this to friends or post it on your profile.">9</div>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:** Không có `data-ad-rendering-role="cta-"`, không có nhãn Sponsored/Ad ➔ Bài viết thường (Organic).
2. **Kiểm tra Tích Xanh:** Có `svg[title="Verified account"]` ➔ `isVerified = true`.
3. **Quy Tắc Xử Lý:** **BỎ QUA 100%**, không tốn tài nguyên cào dữ liệu, không tăng Warmup.

---

### 2.13. Nghiên Cứu Trường Hợp 13: Washington Wizards (P-04 - Organic Verified Sports Page)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Washington Wizards",
  "isVerified": true,
  "classification": "ORGANIC_VERIFIED_PAGE (P-04 - Bài Fanpage Đội Thể Thao Tích Xanh)",
  "isAd": false,
  "mediaType": "PHOTO (Ảnh thể thao NBA)",
  "adLabelText": null,
  "hasFollowButton": true,
  "metrics": {
    "likes": "275 (203 Thích, 69 Tim, 3 Haha)",
    "comments": "9",
    "shares": "21"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Ads | ✗ Page có tích xanh | ✗ Không phải Video | BỎ QUA 100%"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<h4>
  <a href="https://www.facebook.com/Wizards">Washington Wizards</a>
  <svg title="Verified account"><path ...></svg>
  <span>Follow</span>
</h4>

<!-- Ảnh bài viết -->
<img src="https://scontent...fbcdn.net/..." />

<!-- Tương tác -->
<div aria-label="React with Like to Washington Wizards's post">275</div>
<div aria-label="Comment on Washington Wizards's post, 9 comments">9</div>
<div aria-label="Share, send this to friends or post it on your profile.">21</div>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
* **Quy Tắc Xử Lý:** **BỎ QUA 100%**.

---

### 2.14. Nghiên Cứu Trường Hợp 14: Lucilo Paniza (P-01 - Organic Personal User Post)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Lucilo Paniza",
  "isVerified": false,
  "classification": "ORGANIC_USER_POST (P-01 - Bài Cá Nhân Bạn Bè)",
  "isAd": false,
  "mediaType": "VIDEO (Reel cá nhân người dùng)",
  "adLabelText": null,
  "metrics": {
    "likes": "1",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Bài cá nhân người dùng thường | Không có CTA | BỎ QUA 100%"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<h4>
  <a href="https://www.facebook.com/lucilo.paniza">Lucilo Paniza</a>
</h4>

<!-- Video cá nhân -->
<video src="..."></video>

<!-- Tương tác -->
<div aria-label="React with Like to Lucilo Paniza's post">1</div>
<div aria-label="Comment on Lucilo Paniza's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 7 Tiêu Chí & Quy Tắc Xử Lý ECC
* **Quy Tắc Xử Lý:** **BỎ QUA 100%**.


---

### 2.15. Nghiên Cứu Trường Hợp 15: Our Lady of Mercy Life Center (P-08 / P-07 - Boosted Photo Album Post / Không Phải Video / Không Store Ngoại)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Our Lady of Mercy Life Center",
  "isVerified": false,
  "classification": "BOOSTED_PHOTO_ALBUM (P-08 / P-07 - Bài Quảng Cáo Album Ảnh / Không CTA / Không Store Ngoài)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "PHOTO_ALBUM (Collage lưới nhiều ảnh: 4 ảnh hiển thị + ô mở rộng '+11')",
  "contentCaption": "\"Mary, Mary, quite contrary. How does your garden grow?\" So goes the famous nursery rhyme. Here at Our Lady of Mercy, veggies, herbs, and flowers are growing thanks to ... See more",
  "hasVideo": false,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "warmupEligible": false,
  "warmupEvaluation": "✗ Định dạng Album Ảnh (mediaType === 'PHOTO', không phải Video) | ✗ Không có nút CTA | ✗ Không có link Store ngoài e-commerce => BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH WARMUP VÀ KHÔNG THU THẬP VÀO VIDEO ADS"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/OurLadyOfMercyLifeCenter">Our Lady of Mercy Life Center</a>
</h4>
<span>Ad · 🌐</span>

<!-- Nội dung bài viết -->
<div>"Mary, Mary, quite contrary. How does your garden grow?"...</div>

<!-- Lưới Album Ảnh (4 ảnh + 11 ảnh ẩn) -->
<div class="photo-grid-collage">
  <img src="https://scontent...fbcdn.net/photo_1.jpg" />
  <img src="https://scontent...fbcdn.net/photo_2.jpg" />
  <img src="https://scontent...fbcdn.net/photo_3.jpg" />
  <div class="overlay-more-photos">+11</div>
</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài & Nút CTA:**
   * ✗ **FAIL**: Không có nút CTA mua sắm (`Shop now`, `Learn more`), không có domain webstore ngoài.
2. **Tiêu chí 2: Định dạng Video:**
   * ✗ **FAIL**: Đây là **Album Ảnh (Multi-photo collage +11)**, hoàn toàn không có thẻ `<video>` hay thời lượng phát.
3. **Quy Tắc Xử Lý Extension & Warmup:**
   * Bài viết trượt đồng thời cả Tiêu chí 1 (Store) và Tiêu chí 2 (Video).
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH VÀO WARMUP VÀ KHÔNG THU THẬP VÀO DANH SÁCH VIDEO ADS.**


---

### 2.16. Nghiên Cứu Trường Hợp 16: Peppermove (P-06 - Video Ads Tích Xanh / Verified Video Ad)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Peppermove",
  "isVerified": true,
  "classification": "VERIFIED_VIDEO_AD (P-06 - Video Ads Của Fanpage Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc tập thể dục hít đất với bộ đồ PEPPER EMS Suit)",
  "contentCaption": "Ditch long workout hours with the PEPPER EMS Suit! • Fast & effective workouts... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "HTTPS://PEPPERMOVE.COM/US/",
  "adTitle": "Starter Bundle: PEPPER EMS Suit + Power Box + App - PEPPER",
  "destinationUrl": "https://l.facebook.com/l.php?u=...peppermove.com/us/...",
  "metrics": {
    "likes": "10",
    "comments": "0",
    "shares": "2"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có link Webstore ngoài (PEPPERMOVE.COM) | ✗ Fanpage CÓ TÍCH XANH (Thương hiệu lớn / Big Brand) => THU THẬP VÀO DANH SÁCH QUẢNG CÁO NHƯNG TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/peppermove">Peppermove</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · 🌐</span>

<!-- Thẻ Video thật đang chạy -->
<video src="..."></video>
<div role="button" aria-label="Play video"></div>

<!-- Khung Call-To-Action dẫn sang Webstore ngoài -->
<div data-ad-rendering-role="meta">HTTPS://PEPPERMOVE.COM/US/</div>
<div data-ad-rendering-role="title">Starter Bundle: PEPPER EMS Suit + Power Box + App - PEPPER</div>
<div data-ad-rendering-role="cta-">
  <a href="https://l.facebook.com/l.php?u=...peppermove.com/us/..." target="_blank">
    <svg><use xlink:href="#SvgWml353"></use></svg>
  </a>
</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Peppermove's post">10</div>
<div aria-label="Comment on Peppermove's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">2</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có link Webstore `PEPPERMOVE.COM/US/` và nút CTA mua gói sản phẩm `Starter Bundle: PEPPER EMS Suit`.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Là Video người mẫu hít đất với trang phục EMS.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ `svg[title="Verified account"]` ➔ `isVerified === true`.
4. **Quy Tắc Warmup:**
   * Do vi phạm Tiêu chí 3 (Thương hiệu lớn có tích xanh), hệ thống **TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP LŨY TIẾN**. Bộ đếm Warmup giữ nguyên giá trị trước đó.


---

### 2.17. Nghiên Cứu Trường Hợp 17: Ryan Maher (P-04 - Organic Verified Page Post / Bài Viết Hữu Cơ Tích Xanh)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Ryan Maher",
  "isVerified": true,
  "classification": "ORGANIC_VERIFIED_PAGE (P-04 - Bài Viết Hữu Cơ Tự Nhiên Của Page Tích Xanh)",
  "isAd": false,
  "adLabelText": null,
  "hasFollowButton": true,
  "timestamp": "a day ago · 🌐",
  "mediaType": "PHOTO (Ảnh nền đen chữ trắng trích dẫn lời khuyên tâm linh / Quotes)",
  "contentCaption": "\"You are the one whom Jesus loves. So deeply, that He would give His very own life to save yours.\"",
  "hasVideo": false,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "metrics": {
    "likes": "8.7K (8,700 Likes/Reactions)",
    "comments": "1.3K (1,273 Comments)",
    "shares": "1.9K (1,900 Shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Ads (Bài đăng hữu cơ có timestamp 'a day ago') | ✗ Page có tích xanh | ✗ Không phải Video | BỎ QUA 100%, KHÔNG THU THẬP VÀ KHÔNG TÍNH WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh, nút Follow và Timestamp ngày đăng -->
<h4>
  <a href="https://www.facebook.com/ryanmaherofficial">Ryan Maher</a>
  <svg title="Verified account"><path ...></svg>
  <span>· Follow</span>
</h4>
<span>a day ago · 🌐</span>

<!-- Ảnh trích dẫn tâm sự -->
<img src="https://scontent...fbcdn.net/quotes_image.jpg" />

<!-- Nút tương tác cảm xúc hữu cơ khủng -->
<div aria-label="React with Like to Ryan Maher's post">8.7K</div>
<div aria-label="Comment on Ryan Maher's post, 1,273 comments">1.3K</div>
<div aria-label="Share, send this to friends or post it on your profile.">1.9K</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:** Hoàn toàn không có nhãn `Ad` hay `Sponsored`, có dấu thời gian đăng tự nhiên (`a day ago`) ➔ **Bài viết tự nhiên (Organic)**.
2. **Kiểm tra Tích Xanh:** Có `svg[title="Verified account"]` ➔ `isVerified === true`.
3. **Quy Tắc Xử Lý:** **BỎ QUA 100% (DISQUALIFIED)**, không tiêu tốn tài nguyên cào dữ liệu, không ảnh hưởng bộ đếm Warmup.


---

### 2.18. Nghiên Cứu Trường Hợp 18: Mark Twain Medical Center (P-08 - Video Ad Giáo Dục Sức Khỏe Cộng Đồng / Không Nút CTA / Không Store Ngoài)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Mark Twain Medical Center (San Andreas, CA)",
  "isVerified": false,
  "classification": "COMMUNITY_HEALTH_VIDEO_AD (P-08 - Video Ad Tuyên Truyền Y Tế Không CTA Không Webstore Bán Hàng)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video 49 giây: Bác sĩ sản phụ khoa Anjali Rao giải đáp về nguy cơ ung thư vú)",
  "contentCaption": "You asked: \"Is soy likely to increase or reduce your risk of breast cancer?\" Dignity Health Medical Group's Dr. Anjali Rao, OB/GYN, is here to answer in our final #Brea... See more",
  "hasVideo": true,
  "videoDuration": "0:49",
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "metrics": {
    "likes": "186 (React with Like)",
    "comments": "4 (4 comments)",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ad | ✓ Fanpage chưa tích xanh | ✗ KHÔNG CÓ NÚT CTA | ✗ KHÔNG CÓ LINK WEBSTORE BÁN HÀNG NGOÀI (Chỉ là video hỏi đáp bác sĩ giáo dục cộng đồng) => BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH WARMUP VÀ KHÔNG THU THẬP VÀO VIDEO ADS HUNTER"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage bệnh viện kèm nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/MarkTwainMedicalCenter">Mark Twain Medical Center (San Andreas, CA)</a>
</h4>
<span>Ad · 🌐</span>

<!-- Nội dung video hỏi đáp y tế -->
<div>You asked: "Is soy likely to increase or reduce your risk of breast cancer?"...</div>

<!-- Trình phát video 49s -->
<div aria-label="Video player">0:00 / 0:49</div>
<video src="..."></video>

<!-- Tương tác -->
<div aria-label="React with Like to Mark Twain Medical Center (San Andreas, CA)'s post">186</div>
<div aria-label="Comment on Mark Twain Medical Center (San Andreas, CA)'s post, 4 comments">4</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài & Nút CTA:**
   * ✗ **FAIL**: Không có nút CTA mua sắm (`Shop now`, `Learn more`), không có link webstore thương mại điện tử ngoài (chỉ là video Q&A của tổ chức y tế phi lợi nhuận Dignity Health).
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Có video thời lượng 49s (`0:49`).
3. **Tiêu chí 4: Lượng Like Tối Thiểu:**
   * 186 Likes (Chưa đạt ngưỡng >= 200 Likes).
4. **Quy Tắc Xử Lý Extension & Warmup:**
   * Do trượt Tiêu chí 1 (không có Webstore ngoài), bài viết này **KHÔNG PHẢI E-COMMERCE / DROPSHIP AD**.
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH VÀO TIẾN ĐỘ WARMUP.**


---

### 2.19. Nghiên Cứu Trường Hợp 19: Southpaw Furniture Co (P-05 - Target Video Ad E-com / Đủ Điều Kiện Warmup Lũy Tiến)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Southpaw Furniture Co",
  "isVerified": false,
  "classification": "TARGET_VIDEO_AD (P-05 - Mục Tiêu Cốt Lõi Của Video Ads Hunter & Warmup)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel 17 giây quay bàn ăn gỗ sồi thủ công trong phòng khách)",
  "videoDuration": "0:17",
  "contentCaption": "Solid hardwood dining tables from $2,600, handcrafted in Wisconsin with free delivery nationwide. Holiday orders are filling up, so order now to have yours home in time.",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "SOUTHPAWFURNITURE.COM",
  "adTitle": "Solid Hardwood Dining Tables From $2,600",
  "adDesc": "Free delivery nationwide. Order today.",
  "destinationUrl": "https://l.facebook.com/l.php?u=...southpawfurniture.com...",
  "metrics": {
    "likes": "9 (React with Like to Southpaw Furniture Co's post)",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": true,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore ngoài E-com (SOUTHPAWFURNITURE.COM) | ✓ Fanpage chưa tích xanh (Shop thực chiến) | ✗ Chưa đủ 200 Like (9/200) => LOẠI KHỎI BÀI THẮNG => ĐỦ 100% ĐIỀU KIỆN TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (NUÔI PIXEL MUA HÀNG)"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage shop nội thất chưa có tích xanh -->
<h4>
  <a href="https://www.facebook.com/southpawfurniture">Southpaw Furniture Co</a>
</h4>
<span>Ad · 🌐</span>

<!-- Trình phát video nội thất 17s -->
<div aria-label="Video player">0:00 / 0:17</div>
<video src="..."></video>
<div role="button" aria-label="Play video"></div>

<!-- Khung Call-To-Action dẫn về Website bán hàng ngoài -->
<div data-ad-rendering-role="meta">SOUTHPAWFURNITURE.COM</div>
<div data-ad-rendering-role="title">Solid Hardwood Dining Tables From $2,600</div>
<div data-ad-rendering-role="description">Free delivery nationwide. Order today.</div>
<div data-ad-rendering-role="cta-">
  <a href="https://l.facebook.com/l.php?u=...southpawfurniture.com..." target="_blank">
    <svg><use xlink:href="#SvgWml353"></use></svg>
  </a>
</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Southpaw Furniture Co's post">9</div>
<div aria-label="Comment on Southpaw Furniture Co's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có link Store `SOUTHPAWFURNITURE.COM` và nút CTA mua sắm bàn ăn gỗ thật.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video thời lượng 17 giây (`0:17`).
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✓ **PASS**: Shop chưa có tích xanh (`isVerified === false`), đúng chuẩn Shop thực chiến ngách E-com.
4. **Tiêu chí 4: Lượng Like Tối Thiểu:**
   * 9 Likes ➔ Chưa đạt ngưỡng >= 200 Like ➔ **Loại khỏi danh mục bài thắng**.
5. **Quy Tắc Warmup:**
   * Thỏa mãn đồng thời cả 4 điều kiện: (1) Là Ads trả phí; (2) Có Webstore E-com ngoài; (3) Đúng Video; (4) Shop chưa tích xanh.
   * ➔ **HÀNH ĐỘNG: TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (`X/10` ➔ `X+1/10`) VÀ KÍCH HOẠT TƯƠNG TÁC MỒI NẾU ĐẠT TIẾN ĐỘ.**


---

### 2.20. Nghiên Cứu Trường Hợp 20: YourGreenhouses (P-06 - Video Ads Tích Xanh / Verified Video Ad E-com)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "YourGreenhouses",
  "isVerified": true,
  "classification": "VERIFIED_VIDEO_AD (P-06 - Video Ads E-com Của Fanpage Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · ⚙️",
  "mediaType": "VIDEO (Video Reel dọc: Gustavs Gotauts giới thiệu nhà kính sân vườn)",
  "contentCaption": "What if your greenhouse became your favorite place in the backyard?... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "YOURGREENHOUSES.COM",
  "adTitle": "A whole new reason to enjoy your backyard",
  "ctaButton": "Order now yourgreenhouses.com",
  "destinationUrl": "https://l.facebook.com/l.php?u=...yourgreenhouses.com...",
  "metrics": {
    "likes": "18 (React with Like to YourGreenhouses's post)",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có link Webstore E-com ngoài (YOURGREENHOUSES.COM) | ✗ Fanpage CÓ TÍCH XANH (Meta Verified) => THU THẬP VÀO DANH SÁCH ADS NHƯNG TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/YourGreenhouses">YourGreenhouses</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · ⚙️</span>

<!-- Trình phát Video Reel với nút Overlay Resume & Order Now -->
<video src="..."></video>
<div role="button">Resume reel</div>
<a href="https://l.facebook.com/l.php?u=...yourgreenhouses.com..." target="_blank">
  Order now yourgreenhouses.com
</a>

<!-- Khung Call-To-Action dẫn sang Webstore ngoài -->
<div data-ad-rendering-role="meta">YOURGREENHOUSES.COM</div>
<div data-ad-rendering-role="title">A whole new reason to enjoy your backyard</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to YourGreenhouses's post">18</div>
<div aria-label="Comment on YourGreenhouses's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có link Webstore `YOURGREENHOUSES.COM` và nút CTA `Order now`.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Là Video Reel quay thực tế người sáng lập và nhà kính.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ `svg[title="Verified account"]` ➔ `isVerified === true`.
4. **Quy Tắc Warmup:**
   * Do vi phạm Tiêu chí 3 (Trang có tích xanh), hệ thống **TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP LŨY TIẾN**. Bộ đếm Warmup giữ nguyên giá trị.


---

### 2.21. Nghiên Cứu Trường Hợp 21: Gnara (P-05 - Winning Video Ad E-com Siêu Chuẩn 994 Likes / 243 Comments / 139 Shares)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Gnara",
  "isVerified": false,
  "classification": "TARGET_VIDEO_AD (P-05 - BÀI QUẢNG CÁO VIDEO CHIẾN THẮNG ĐẠT CHUẨN 5/5 TIÊU CHÍ)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc giới thiệu chiếc quần dã ngoại Go There Pants với khóa GoFly® zipper độc quyền)",
  "contentCaption": "Go There Pants",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "GNARA.COM",
  "adTitle": "By Women, For Women",
  "adDesc": "Our GoFly® zipper changes everything — finally, gear that lets you go freely.",
  "ctaButton": "Shop now (gnara.com)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...gnara.com...",
  "metrics": {
    "likes": "994 (792 Likes, 98 Haha, 79 Love)",
    "comments": "243 (243 comments)",
    "shares": "139 (139 shares)"
  },
  "engagementRatio": {
    "cmtRatio": "24.4% (~1/4 Likes)",
    "shareRatio": "14.0% (~1/7 Likes)",
    "antiBuffCheck": "Shares (139) <= 5x Cmt (1,215) => TƯƠNG TÁC TỰ NHIÊN 100%, KHÔNG BUFF ẢO"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore E-com ngoài (GNARA.COM) | ✓ Fanpage chưa tích xanh (Shop thực chiến) | ✓ VƯỢT XA NGƯỠNG LIKE (994 >= 200 / 500) | ✓ CHUẨN TỈ LỆ THẢO LUẬN 1/4 => ĐẠT TOÀN DIỆN 5 TIÊU CHÍ BÀI THẮNG => LƯU DATABASE BÀI ADS CHIẾN THẮNG ĐỈNH CAO"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage shop thời trang outdoor nữ chưa có tích xanh -->
<h4>
  <a href="https://www.facebook.com/gnaragear">Gnara</a>
</h4>
<span>Ad · 🌐</span>

<!-- Caption ngắn gọn -->
<div>Go There Pants</div>

<!-- Trình phát Video Reel với nút Overlay Shop Now -->
<div aria-label="Video player">
  <video src="..."></video>
  <div role="button">Resume reel</div>
  <a role="button" aria-label="Shop now" href="https://l.facebook.com/l.php?u=...gnara.com...">
    Shop now gnara.com
  </a>
</div>

<!-- Khung Call-To-Action dẫn sang Shopify Webstore -->
<div data-ad-rendering-role="meta">GNARA.COM</div>
<div data-ad-rendering-role="title">By Women, For Women</div>
<div data-ad-rendering-role="description">Our GoFly® zipper changes everything — finally, gear that lets you go freely.</div>

<!-- Nút tương tác cảm xúc chuẩn mực -->
<div aria-label="Remove Like from Gnara's post">994</div>
<div aria-label="Like: 792 people"></div>
<div aria-label="Comment on Gnara's post, 243 comments">243</div>
<div aria-label="Share, send this to friends or post it on your profile.">139</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Store `GNARA.COM` chuyên dòng sản phẩm phụ nữ ngoài trời độc quyền.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video Reel review tính năng khóa quần GoFly® zipper.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✓ **PASS**: Shop chưa có tích xanh xác minh (`isVerified === false`), đúng chuẩn Brand thời trang ngách triệu view tự thân.
4. **Tiêu chí 4: Lượng Like Tối Thiểu:**
   * ✓ **PASS**: **994 Likes** (Vượt cả 200 Like lẫn cấu hình 500 Like).
5. **Tiêu chí 5: Tỉ Lệ Tương Tác & Chống Buff Ảo:**
   * ✓ **PASS**: Comments: 243, Shares: 139. Số lượng share nhỏ hơn 5 lần comment (139 < 1,215). Không có dấu hiệu dịch vụ kéo share ảo.
6. **Hành Động Của Extension:**
   * 🎯 **ĐẠT CHUẨN BÀI ADS CHIẾN THẮNG HOÀN HẢO (SUPER WINNING PRODUCT AD)**:
     * Lưu ngay vào Database bài thắng của extension.
     * Tự động kích hoạt luồng kiểm toán sâu Webstore (`RUN_STORE_FLOW`) tại `gnara.com`.


---

### 2.22. Nghiên Cứu Trường Hợp 22: Mumu and Macaroons & Chilipad by Sleepme (P-05 - Co-Branded Target Video Ad E-com / Đủ Điều Kiện Warmup Lũy Tiến)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Mumu and Macaroons and Chilipad by Sleepme",
  "isVerified": false,
  "classification": "TARGET_VIDEO_AD (P-05 - Co-Branded Video Ad Hợp Tác Thương Hiệu Chưa Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc: Creator review trải nghiệm đệm làm mát Chilipad 2.0 sau khi khỏi bệnh ung thư vú)",
  "contentCaption": "Three years ago, breast cancer completely changed the way I think about taking care of my body. Now, sleep + recovery are things I prioritize more than ever. ... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "SLEEP.ME",
  "adTitle": "Chilipad 2.0 Bed Cooling System",
  "ctaButton": "Shop now (sleep.me)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...sleep.me...",
  "metrics": {
    "likes": "29 (27 Likes, 2 Love)",
    "comments": "2 (2 comments)",
    "shares": "5 (5 shares)"
  },
  "warmupEligible": true,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore E-com ngoài (SLEEP.ME) | ✓ Fanpage chưa tích xanh (Shop thực chiến) | ✗ Chưa đủ 200 Like (29/200) => LOẠI KHỎI BÀI THẮNG => ĐỦ 100% ĐIỀU KIỆN TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (NUÔI PIXEL MUA HÀNG)"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Co-Branded Ad giữa Creator và Thương hiệu đệm -->
<h4>
  <a href="https://www.facebook.com/mumuandmacaroons">Mumu and Macaroons</a> and <a href="https://www.facebook.com/chilipad">Chilipad by Sleepme</a>
</h4>
<span>Ad · 🌐</span>

<!-- Trình phát Video Reel với nút Overlay Shop Now -->
<div aria-label="Video player">
  <video src="..."></video>
  <div role="button">Resume reel</div>
  <a role="button" aria-label="Shop now" href="https://l.facebook.com/l.php?u=...sleep.me...">
    Shop now sleep.me
  </a>
</div>

<!-- Khung Call-To-Action dẫn về Website bán hàng ngoài -->
<div data-ad-rendering-role="meta">SLEEP.ME</div>
<div data-ad-rendering-role="title">Chilipad 2.0 Bed Cooling System</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Mumu and Macaroons's post">29</div>
<div aria-label="Comment on Mumu and Macaroons's post, 2 comments">2</div>
<div aria-label="Share, send this to friends or post it on your profile.">5</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Store `SLEEP.ME` chuyên bán hệ thống đệm làm mát giường ngủ Chilipad 2.0.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video Reel dạng UGC (User Generated Content) review sản phẩm thực tế.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✓ **PASS**: Cả Creator lẫn Page sản phẩm đều chưa có tích xanh xác minh (`isVerified === false`).
4. **Tiêu chí 4: Lượng Like Tối Thiểu:**
   * 29 Likes ➔ Chưa đạt ngưỡng >= 200 Like ➔ **Loại khỏi danh mục bài thắng**.
5. **Quy Tắc Warmup:**
   * Thỏa mãn đồng thời cả 4 điều kiện: (1) Ad trả phí thật; (2) Có Webstore E-com ngoài; (3) Đúng Video; (4) Shop chưa tích xanh.
   * ➔ **HÀNH ĐỘNG: TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (`X/10` ➔ `X+1/10`) VÀ KÍCH HOẠT TƯƠNG TÁC MỒI NẾU ĐẠT TIẾN ĐỘ.**


---

### 2.23. Nghiên Cứu Trường Hợp 23: Jenn Palfreyman & Windmill Air (P-05 - Co-Branded Target Video Ad E-com / Đủ Điều Kiện Warmup Lũy Tiến)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Jenn Palfreyman and Windmill Air",
  "isVerified": false,
  "classification": "TARGET_VIDEO_AD (P-05 - Co-Branded Video Ad Hợp Tác Thương Hiệu Chưa Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc: Mẹ bỉm sữa review máy lọc không khí Windmill Air Purifier Max bảo vệ gia đình)",
  "contentCaption": "Elevate your space and well-being with the beautifully designed Windmill Air Purifier Max.... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "SHOP.WINDMILLAIR.COM",
  "adTitle": "Wellness Starts with Air",
  "adDesc": "30 Day Risk-Free Trial and Lifetime Warranty",
  "ctaButton": "See details (shop.windmillair.com)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...shop.windmillair.com...",
  "metrics": {
    "likes": "1 (Like: 1 person)",
    "comments": "0",
    "shares": "0"
  },
  "warmupEligible": true,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore E-com ngoài (SHOP.WINDMILLAIR.COM) | ✓ Fanpage chưa tích xanh (Shop thực chiến) | ✗ Chưa đủ 200 Like (1/200) => LOẠI KHỎI BÀI THẮNG => ĐỦ 100% ĐIỀU KIỆN TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (NUÔI PIXEL MUA HÀNG)"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Co-Branded Ad giữa Creator và Thương hiệu máy lọc khí -->
<h4>
  <a href="https://www.facebook.com/jennpalfreyman">Jenn Palfreyman</a> and <a href="https://www.facebook.com/windmillair">Windmill Air</a>
</h4>
<span>Ad · 🌐</span>

<!-- Trình phát Video Reel với nút Overlay See details -->
<div aria-label="Video player">
  <video src="..."></video>
  <div role="button">Resume reel</div>
  <a role="button" aria-label="See details" href="https://l.facebook.com/l.php?u=...shop.windmillair.com...">
    See details shop.windmillair.com
  </a>
</div>

<!-- Khung Call-To-Action dẫn về Website bán hàng ngoài -->
<div data-ad-rendering-role="meta">SHOP.WINDMILLAIR.COM</div>
<div data-ad-rendering-role="title">Wellness Starts with Air</div>
<div data-ad-rendering-role="description">30 Day Risk-Free Trial and Lifetime Warranty</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Jenn Palfreyman's post">1</div>
<div aria-label="Comment on Jenn Palfreyman's post">0</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Store `SHOP.WINDMILLAIR.COM` bán máy lọc không khí cao cấp Windmill Air Purifier Max.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video Reel UGC review chân thực trong nhà bếp.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✓ **PASS**: Cả Creator lẫn Page thương hiệu đều chưa có tích xanh xác minh (`isVerified === false`).
4. **Tiêu chí 4: Lượng Like Tối Thiểu:**
   * 1 Like ➔ Chưa đạt ngưỡng >= 200 Like ➔ **Loại khỏi danh mục bài thắng**.
5. **Quy Tắc Warmup:**
   * Thỏa mãn đồng thời cả 4 điều kiện: (1) Ad trả phí thật; (2) Có Webstore E-com ngoài; (3) Đúng Video; (4) Shop chưa tích xanh.
   * ➔ **HÀNH ĐỘNG: TĂNG BỘ ĐẾM WARMUP LŨY TIẾN (`X/10` ➔ `X+1/10`) VÀ KÍCH HOẠT TƯƠNG TÁC MỒI NẾU ĐẠT TIẾN ĐỘ.**


---

### 2.24. Nghiên Cứu Trường Hợp 24: Stanford Medicine Children's Health (P-06 / P-07 - Ad Album Ảnh Của Tổ Chức Y Tế Tích Xanh)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Stanford Medicine Children's Health",
  "isVerified": true,
  "classification": "VERIFIED_PHOTO_ALBUM_AD (P-06 / P-07 - Ad Album Ảnh Tổ Chức Y Tế Tích Xanh Không Webstore)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "PHOTO_ALBUM (Collage 5 ảnh các bé sơ sinh phòng chăm sóc đặc biệt NICU hóa trang Halloween)",
  "contentCaption": "NICU babies report for duty! 🎃... See more",
  "hasVideo": false,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "metrics": {
    "likes": "2.5K (1.2K Thích, 760 Care, 527 Tim)",
    "comments": "58 (58 comments)",
    "shares": "27 (27 shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Fanpage CÓ TÍCH XANH (Stanford Medicine) | ✗ Không phải Video (Album ảnh NICU) | ✗ Không có Webstore E-com ngoài => BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH WARMUP VÀ KHÔNG THU THẬP VÀO VIDEO ADS"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage bệnh viện kèm tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/StanfordChildrens">Stanford Medicine Children's Health</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · 🌐</span>

<!-- Lưới 5 ảnh bé sơ sinh NICU -->
<div class="photo-album-grid">
  <img src="https://scontent...fbcdn.net/nicu_baby_1.jpg" />
  <img src="https://scontent...fbcdn.net/nicu_baby_2.jpg" />
  <img src="https://scontent...fbcdn.net/nicu_baby_3.jpg" />
  <img src="https://scontent...fbcdn.net/nicu_baby_4.jpg" />
  <img src="https://scontent...fbcdn.net/nicu_baby_5.jpg" />
</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Stanford Medicine Children's Health's post">2.5K</div>
<div aria-label="Comment on Stanford Medicine Children's Health's post, 58 comments">58</div>
<div aria-label="Share, send this to friends or post it on your profile.">27</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài & CTA:**
   * ✗ **FAIL**: Không có nút CTA mua hàng, không có webstore e-commerce.
2. **Tiêu chí 2: Định dạng Video:**
   * ✗ **FAIL**: Là Album Ảnh (5 ảnh NICU), hoàn toàn không có video.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ của hệ thống y tế Stanford Medicine (`isVerified === true`).
4. **Quy Tắc Warmup & Thu Thập:**
   * Vi phạm cả 3 tiêu chí tiên quyết.
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100% (DISQUALIFIED), TUYỆT ĐỐI KHÔNG TÍNH WARMUP.**


---

### 2.25. Nghiên Cứu Trường Hợp 25: Sereniby (P-06 - Video Ads E-com Tích Xanh / 727 Likes)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Sereniby: The Air Purifier Your Baby Deserves",
  "isVerified": true,
  "classification": "VERIFIED_VIDEO_AD (P-06 - Video Ads E-com Của Fanpage Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc giới thiệu máy lọc không khí chuyên dụng cho phòng em bé Sereniby)",
  "contentCaption": "The only air purifier with safe sleep technology designed for the baby nursery. Sereniby purifies and circulates the air in your baby’s nursery with patented SafeFlow t... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "SERENIBY.COM",
  "adTitle": "Built for Safe Sleep & Developing Lungs",
  "ctaButton": "Order now (sereniby.com)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...sereniby.com...",
  "metrics": {
    "likes": "727 (669 Likes, 52 Love)",
    "comments": "5 (5 comments)",
    "shares": "104 (104 shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore E-com ngoài (SERENIBY.COM) | ✗ Fanpage CÓ TÍCH XANH (Meta Verified) => THU THẬP VÀO DANH SÁCH ADS NHƯNG TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/sereniby">Sereniby: The Air Purifier Your Baby Deserves</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · 🌐</span>

<!-- Trình phát Video Reel với nút Overlay Order Now -->
<div aria-label="Video player">
  <video src="..."></video>
  <div role="button">Resume reel</div>
  <a role="button" aria-label="Order now" href="https://l.facebook.com/l.php?u=...sereniby.com...">
    Order now sereniby.com
  </a>
</div>

<!-- Khung Call-To-Action dẫn sang Webstore ngoài -->
<div data-ad-rendering-role="meta">SERENIBY.COM</div>
<div data-ad-rendering-role="title">Built for Safe Sleep & Developing Lungs</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="Remove Like from Sereniby: The Air Purifier Your Baby Deserves's post">727</div>
<div aria-label="Comment on Sereniby: The Air Purifier Your Baby Deserves's post, 5 comments">5</div>
<div aria-label="Share, send this to friends or post it on your profile.">104</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Store `SERENIBY.COM` bán máy lọc không khí chuyên dụng cho trẻ nhỏ.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video Reel trực quan về tính năng hiển thị nhiệt độ và công nghệ SafeFlow.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ `svg[title="Verified account"]` ➔ `isVerified === true`.
4. **Quy Tắc Warmup:**
   * Do vi phạm Tiêu chí 3 (Trang có tích xanh), hệ thống **TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP LŨY TIẾN**. Bộ đếm Warmup giữ nguyên giá trị.


---

### 2.26. Nghiên Cứu Trường Hợp 26: Pawskinz (P-06 - Video Ads E-com Tích Xanh / 368 Likes)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Pawskinz",
  "isVerified": true,
  "classification": "VERIFIED_VIDEO_AD (P-06 - Video Ads E-com Của Fanpage Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Reel dọc: Bọc ủng silicon bảo vệ chân chó Pawskinz Paw Protection you can see)",
  "contentCaption": "Pawskinz helps protect your dog's paws from hot pavement, rough terrain, sharp debris, and everyday outdoor surfaces—without the bulk of traditional dog shoes.... See more",
  "hasVideo": true,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "PAWSKINZ.COM",
  "adTitle": "All Product Collection - Pawskinz",
  "ctaButton": "See details (pawskinz.com)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...pawskinz.com...",
  "metrics": {
    "likes": "368 (329 Likes, 28 Love)",
    "comments": "65 (65 comments)",
    "shares": "70 (70 shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ads thật | ✓ Có Webstore E-com ngoài (PAWSKINZ.COM) | ✗ Fanpage CÓ TÍCH XANH (Meta Verified) => THU THẬP VÀO DANH SÁCH ADS NHƯNG TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/pawskinz">Pawskinz</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · 🌐</span>

<!-- Trình phát Video Reel với nút Overlay See details -->
<div aria-label="Video player">
  <video src="..."></video>
  <div role="button">Resume reel</div>
  <a role="button" aria-label="See details" href="https://l.facebook.com/l.php?u=...pawskinz.com...">
    See details pawskinz.com
  </a>
</div>

<!-- Khung Call-To-Action dẫn sang Webstore ngoài -->
<div data-ad-rendering-role="meta">PAWSKINZ.COM</div>
<div data-ad-rendering-role="title">All Product Collection - Pawskinz</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="Remove Like from Pawskinz's post">368</div>
<div aria-label="Comment on Pawskinz's post, 65 comments">65</div>
<div aria-label="Share, send this to friends or post it on your profile.">70</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Store `PAWSKINZ.COM` chuyên dòng ủng bảo vệ đệm chân thú cưng.
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Video Reel trực quan mang ủng cho chó.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ `svg[title="Verified account"]` ➔ `isVerified === true`.
4. **Quy Tắc Warmup:**
   * Do vi phạm Tiêu chí 3 (Trang có tích xanh), hệ thống **TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP LŨY TIẾN**. Bộ đếm Warmup giữ nguyên giá trị.


---

### 2.27. Nghiên Cứu Trường Hợp 27: Joey Pearce in Divorced and Singles (P-02 - Bài Nhóm / Group Tự Nhiên)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "groupName": "Divorced and Singles",
  "authorName": "Joey Pearce",
  "isVerified": false,
  "classification": "ORGANIC_GROUP_POST (P-02 - Bài Đăng Thành Viên Trong Nhóm)",
  "isAd": false,
  "adLabelText": null,
  "timestamp": "10 hours ago · 🌐",
  "mediaType": "PHOTO (Ảnh selfie cá nhân của thành viên đội mũ đeo kính trên xe ô tô)",
  "contentCaption": "Hi im joey im single im from pittsburg kansas looking for a fishing buddy someone to chill with and see where it goes pm",
  "hasVideo": false,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Ads (Bài chia sẻ tìm bạn trong nhóm) | ✗ Chứa liên kết group (a[href*='/groups/']) | ✗ Có timestamp '10 hours ago' => BỎ QUA 100%, KHÔNG THU THẬP VÀ KHÔNG TÍNH WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Group kèm tên tác giả thành viên và Timestamp -->
<h4>
  <a href="https://www.facebook.com/groups/divorcedandsingles/">Divorced and Singles</a>
  <a href="https://www.facebook.com/user/joey.pearce">Joey Pearce</a>
</h4>
<span>10 hours ago · 🌐</span>

<!-- Ảnh selfie cá nhân -->
<img src="https://scontent...fbcdn.net/joey_selfie.jpg" />

<!-- Nội dung giao lưu cá nhân -->
<div>Hi im joey im single im from pittsburg kansas looking for a fishing buddy...</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:** Hoàn toàn không có nhãn `Ad` hay `Sponsored`, chứa đường dẫn Group `a[href*="/groups/"]` và mốc thời gian tự nhiên `10 hours ago`.
2. **Quy Tắc Xử Lý Extension:**
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100% (DISQUALIFIED)**. Loại bỏ ngay từ hàm `isOrganicPostDom()`, không cào dữ liệu, không ảnh hưởng bộ đếm Warmup.


---

### 2.28. Nghiên Cứu Trường Hợp 28: Bible and Culture in Focus (P-08 - Video Ad Tôn Giáo / Tuyên Truyền Không Nút CTA / Không Webstore Bán Hàng)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Bible and Culture in Focus",
  "isVerified": false,
  "classification": "RELIGIOUS_VIDEO_AD (P-08 - Video Ad Tôn Giáo / Tuyên Truyền Không CTA Không Webstore Bán Hàng)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "VIDEO (Video Cinematic 33 giây: Tái hiện hình ảnh Chúa Jesus bước đi trên bậc thang đá Jerusalem hoàng hôn)",
  "contentCaption": "THE LIGHT | Psalm 119:105... See more",
  "hasVideo": true,
  "videoDuration": "0:33",
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "metrics": {
    "likes": "3.2K (2.6K Thích, 600 cảm xúc khác)",
    "comments": "33 (33 comments)",
    "shares": "39 (39 shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✓ Là Video Ad | ✓ Fanpage chưa tích xanh | ✗ KHÔNG CÓ NÚT CTA | ✗ KHÔNG CÓ LINK WEBSTORE BÁN HÀNG NGOÀI (Chỉ là video tuyên truyền tôn giáo tâm linh) => BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH WARMUP VÀ KHÔNG THU THẬP VÀO VIDEO ADS HUNTER"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/bibleandculture">Bible and Culture in Focus</a>
</h4>
<span>Ad · 🌐</span>

<!-- Nội dung video tâm linh -->
<div>THE LIGHT | Psalm 119:105...</div>

<!-- Trình phát video 33s -->
<div aria-label="Video player">0:08 / 0:33</div>
<video src="..."></video>
<div role="button" aria-label="Play video"></div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Bible and Culture in Focus's post">3.2K</div>
<div aria-label="Comment on Bible and Culture in Focus's post, 33 comments">33</div>
<div aria-label="Share, send this to friends or post it on your profile.">39</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài & Nút CTA:**
   * ✗ **FAIL**: Không có nút CTA mua sắm (`Shop now`, `Learn more`), không có link webstore thương mại điện tử ngoài (chỉ là video tuyên truyền tôn giáo giữ chân tương tác).
2. **Tiêu chí 2: Định dạng Video:**
   * ✓ **PASS**: Có video thời lượng 33s (`0:33`).
3. **Tiêu chí 3: Chưa có tích xanh:**
   * ✓ **PASS**: `isVerified === false`.
4. **Quy Tắc Xử Lý Extension & Warmup:**
   * Do trượt Tiêu chí 1 (không có Webstore ngoài), bài viết này **KHÔNG PHẢI E-COMMERCE / DROPSHIP AD**.
   * ➔ **HÀNH ĐỘNG: BỎ QUA 100%, TUYỆT ĐỐI KHÔNG TÍNH VÀO TIẾN ĐỘ WARMUP.**


---

### 2.29. Nghiên Cứu Trường Hợp 29: Kleer Blue Water (P-07 / P-06 - Hình Ảnh Ads E-com Của Page Tích Xanh)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Kleer Blue Water",
  "isVerified": true,
  "classification": "VERIFIED_PHOTO_AD (P-07 / P-06 - Quảng Cáo Hình Ảnh E-com Của Fanpage Tích Xanh)",
  "isAd": true,
  "adLabelText": "Ad · 🌐",
  "mediaType": "PHOTO (Ảnh tĩnh: Tay cầm cốc nước thủy tinh dưới vòi nước kèm banner thông điệp 'Your water, understood. SHOP KITS')",
  "contentCaption": "You use it every day, but do you actually know what's in your water? Kleer Blue Water is a premium at-home testing kit that turns professional lab analysis into a clear... See more",
  "hasVideo": false,
  "hasCtaButton": true,
  "hasExternalStoreUrl": true,
  "storeDomain": "KLEERBLUEWATER.COM",
  "adTitle": "Know exactly what’s in your water.",
  "adDesc": "Know what's really in your water. Kleer Blue Water mail-in kits test city and well water for lead, bacteria, hardness and more, with professional lab analysis.",
  "ctaButton": "Shop now (kleerbluewater.com)",
  "destinationUrl": "https://l.facebook.com/l.php?u=...kleerbluewater.com...",
  "metrics": {
    "likes": "9 (8 Likes, 1 Love)",
    "comments": "1 (1 comment)",
    "shares": "0"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Video (mediaType === 'PHOTO') | ✗ Fanpage CÓ TÍCH XANH (Meta Verified) => CHỈ THU THẬP NẾU BẬT LỌC ẢNH, TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM VIDEO WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh và nhãn Ad -->
<h4>
  <a href="https://www.facebook.com/kleerbluewater">Kleer Blue Water</a>
  <svg title="Verified account"><path ...></svg>
</h4>
<span>Ad · 🌐</span>

<!-- Ảnh tĩnh quảng cáo bộ kit test nước -->
<img src="https://scontent...fbcdn.net/water_test_kit.jpg" />

<!-- Khung Call-To-Action dẫn sang Webstore ngoài -->
<div data-ad-rendering-role="meta">KLEERBLUEWATER.COM</div>
<div data-ad-rendering-role="title">Know exactly what’s in your water.</div>
<div data-ad-rendering-role="description">Know what's really in your water. Kleer Blue Water mail-in kits test city and well water...</div>

<!-- Nút tương tác cảm xúc -->
<div aria-label="React with Like to Kleer Blue Water's post">9</div>
<div aria-label="Comment on Kleer Blue Water's post, 1 comment">1</div>
<div aria-label="Share, send this to friends or post it on your profile.">0</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Tiêu chí 1: Link Webstore Ngoài:**
   * ✓ **PASS**: Có Webstore `KLEERBLUEWATER.COM` bán bộ xét nghiệm nước sinh hoạt tại nhà.
2. **Tiêu chí 2: Định dạng Video:**
   * ✗ **FAIL**: Đây là **Ảnh Tĩnh (Photo)**, hoàn toàn không có thẻ `<video>`.
3. **Tiêu chí 3: Chưa có tích xanh (Blue Badge Gate):**
   * ✗ **FAIL**: Fanpage có tích xanh chính chủ `svg[title="Verified account"]` ➔ `isVerified === true`.
4. **Quy Tắc Warmup & Thu Thập:**
   * Do trượt Tiêu chí 2 (không phải Video) và Tiêu chí 3 (có tích xanh), bài viết này **TUYỆT ĐỐI KHÔNG TÍNH VÀO BỘ ĐẾM WARMUP LŨY TIẾN**. Bộ đếm Warmup giữ nguyên giá trị.


---

### 2.30. Nghiên Cứu Trường Hợp 30: Brin (P-04 - Bài Báo Chí Tin Tức Hữu Cơ Của Page Tích Xanh)

#### A. Thuộc Tính Định Danh Trích Xuất
```json
{
  "pageName": "Brin",
  "isVerified": true,
  "classification": "ORGANIC_VERIFIED_NEWS_PAGE (P-04 - Bài Viết Tin Tức Báo Chí Hữu Cơ Của Page Tích Xanh)",
  "isAd": false,
  "adLabelText": null,
  "hasFollowButton": true,
  "timestamp": "2 days ago · 🌐",
  "mediaType": "PHOTO (Ảnh tin tức báo chí: Người phụ nữ vô gia cư ngủ trong xe hơi tại California kèm ảnh Thống đốc Gavin Newsom)",
  "contentCaption": "Roughly 34,000 unhoused Californians are estimated to sleep in cars, vans, RVs and other vehicles on any given night, highlighting how the state’s housing crisis extend... See more",
  "hasVideo": false,
  "hasCtaButton": false,
  "hasExternalStoreUrl": false,
  "metrics": {
    "likes": "857 (355 Thích, 305 Buồn, 84 Wow, 113 cảm xúc khác)",
    "comments": "587 (587 comments)",
    "shares": "445 (445 shares)"
  },
  "warmupEligible": false,
  "warmupEvaluation": "✗ Không phải Ads (Bài tin tức hữu cơ có timestamp '2 days ago') | ✗ Page có tích xanh | ✗ Không phải Video | BỎ QUA 100%, KHÔNG THU THẬP VÀ KHÔNG TÍNH WARMUP"
}
```

#### B. Dấu Vết Trích Xuất Từ DOM Thật
```html
<!-- Tiêu đề Fanpage kèm huy hiệu tích xanh xác minh, nút Follow và Timestamp ngày đăng -->
<h4>
  <a href="https://www.facebook.com/brinmedia">Brin</a>
  <svg title="Verified account"><path ...></svg>
  <span>· Follow</span>
</h4>
<span>2 days ago · 🌐</span>

<!-- Ảnh tin tức thời sự -->
<img src="https://scontent...fbcdn.net/california_homeless_news.jpg" />

<!-- Nút tương tác cảm xúc hữu cơ -->
<div aria-label="React with Like to Brin's post">857</div>
<div aria-label="Comment on Brin's post, 587 comments">587</div>
<div aria-label="Share, send this to friends or post it on your profile.">445</div>
```

#### C. Thẩm Định 5 Tiêu Chí & Quy Tắc Xử Lý ECC
1. **Kiểm tra Ads:** Hoàn toàn không có nhãn `Ad` hay `Sponsored`, có dấu thời gian đăng tự nhiên (`2 days ago`) ➔ **Bài viết tự nhiên (Organic)**.
2. **Kiểm tra Tích Xanh:** Có `svg[title="Verified account"]` ➔ `isVerified === true`.
3. **Quy Tắc Xử Lý:** **BỎ QUA 100% (DISQUALIFIED)**, không tiêu tốn tài nguyên cào dữ liệu, không ảnh hưởng bộ đếm Warmup.
