# Facebook Ads Library Automation & GraphQL API Reverse Engineering Specification

Tài liệu đặc tả toàn diện về kiến trúc DOM, quy trình tự động hóa trình duyệt qua CDP (Chrome DevTools Protocol), và cơ chế bóc tách - khai thác luồng mạng GraphQL API của **Facebook Ads Library** (Thư viện quảng cáo Meta).

---

## 1. Tổng quan Kiến trúc & Môi trường Thực thi

### 1.1 Sơ đồ Kiến trúc Hệ thống
```
+-----------------------------------------------------------------------------------+
|                            GPM LOGIN LOCAL API                                    |
|                      http://127.0.0.1:9495/api/v1/profiles                        |
|   Profile ID: a5374bbd-46ed-457d-9790-935ffa826471 (Tên: 61577091256835)         |
+-----------------------------------------+-----------------------------------------+
                                          | Khởi động & trả về Remote Debugging Port
                                          v
+-----------------------------------------------------------------------------------+
|                         CHROMIUM CORE (Port: Dynamic, e.g. 64646)                 |
|   Chrome DevTools Protocol (CDP) | Session cookies: c_user, xs, datr, fr          |
+-----------------------------------------+-----------------------------------------+
                                          | connect_over_cdp()
                                          v
+-----------------------------------------------------------------------------------+
|                   PYTHON 3.14 + PLAYWRIGHT AUTOMATION ENGINE                      |
|                  (run_facebook_ads_automation.py)                                 |
|                                                                                   |
|  [Network Interceptor]                       [DOM Semantic Locators]             |
|  - page.on('request')                        - Country Combobox (Role: combobox)  |
|  - page.on('response')                       - Search Input (Type: search)        |
|  - Request Body / Query Decoders             - Filter Dialog Modal (Role: dialog) |
|  - Relay @defer Stream Parser                - Sort By Dropdown (Role: combobox)  |
+-----------------------------------------+-----------------------------------------+
                                          |
                        +-----------------+-----------------+
                        |                                   |
                        v                                   v
+----------------------------------+ +----------------------------------------------+
|   captured_graphql_request.json  | |       captured_graphql_response.json         |
|   - doc_id: 26617181747964058    | |       - Status: 200 OK (165,761 bytes)       |
|   - Token: fb_dtsg (69 chars)    | |       - 2 chunks (Root shell + @defer chunk) |
|   - Variables: 4 filters applied | |       - 193 ads found, 30 edges in batch 1   |
+----------------------------------+ +----------------------------------------------+
```

### 1.2 Thông số Môi trường Thực thi
- **Hệ điều hành**: Windows 11 Pro 64-bit.
- **Trình điều khiển Antidetect**: GPM Login Global v5.1.3-stable (Local API lắng nghe tại port `9495`).
- **Profile ID mục tiêu**: `a5374bbd-46ed-457d-9790-935ffa826471` (User UID: `61577091256835`).
- **Lõi trình duyệt**: `ChromiumCore_v154` (User-Agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36`).
- **Trạng thái xác thực**: Profile đã đăng nhập tài khoản Facebook trước đó với đầy đủ cookie bảo mật (`c_user`, `xs`, `fr`, `datr`).
- **Kênh tự động hóa**: Python 3.14 + Playwright 1.64.1 kết nối qua giao thức `connect_over_cdp('http://127.0.0.1:<port>')`.

---

## 2. Đặc tả DOM Selectors của 4 Thành phần Giao diện

Meta Comet frontend sử dụng CSS module với class name băm ngẫu nhiên (ví dụ: `.x1i10hfl .xjbqb8w`). Để đảm bảo tự động hóa bền vững (resilient) qua các đợt cập nhật của Meta, toàn bộ selector bên dưới được xây dựng dựa trên các chuẩn **WAI-ARIA roles**, accessibility attributes (`aria-label`, `placeholder`, `aria-selected`), và bộ lọc text ngữ nghĩa.

### 2.1 Thành phần 1: Dropdown Chọn Quốc gia (Country Selector)
Dropdown nằm ở thanh công cụ tìm kiếm trên cùng của trang Facebook Ads Library.

| Thuộc tính | Giá trị DOM Thực tế |
|---|---|
| **HTML Tag** | `<div role="combobox">` |
| **ARIA Attributes** | `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded="false"`, `aria-labelledby="js_..."` |
| **Nhãn hiển thị** | `United States` (hoặc tên quốc gia đang chọn) |
| **Resilient Selector** | `page.locator('div[role="combobox"]').filter(has_text=re.compile(r"United States|Country", re.I)).first` |
| **Ô tìm kiếm bên trong popup** | `input[placeholder="Search for country"]` |
| **Danh sách quốc gia** | `div[role="listbox"] div[role="option"]` hoặc `div[role="row"]` |
| **Tùy chọn United States** | `page.locator('div[role="option"]').filter(has_text=re.compile(r"^United States$", re.I))` |
| **Cơ chế hoạt động** | Khi click vào combobox, `aria-expanded` chuyển thành `true` và mở popup chứa danh sách hơn 250 quốc gia. Gõ tên quốc gia vào ô search để lọc, sau đó click dòng `United States`. Trình duyệt sẽ cập nhật query param `country=US` và Relay query variable `country: "US"`. |

### 2.2 Thành phần 2: Ô Nhập Từ Khóa Tìm Kiếm & Recent Searches (Search Input)
Thanh tìm kiếm quảng cáo theo từ khóa hoặc tên trang đối thủ.

| Thuộc tính | Giá trị DOM Thực tế |
|---|---|
| **HTML Tag** | `<input type="search">` |
| **HTML Attributes** | `type="search"`, `placeholder="Search by keyword or advertiser"`, `autocomplete="off"` |
| **Resilient Selector** | `page.locator('input[type="search"][placeholder*="Search by keyword"]').first` |
| **Popup tìm kiếm gần đây (Recent searches)** | `<div role="listbox" aria-label="... suggested searches">` hoặc `div[role="presentation"]` |
| **Item gợi ý từ khóa gần đây** | `div[role="option"]:has-text("DallasWind US")` |
| **Tùy chọn tìm kiếm chính xác (Exact phrase)** | `div[role="option"]:has-text('"DallasWind US" Search this exact phrase')` |
| **Hành vi luồng mạng khi gõ** | Khi gõ ký tự, Meta phát mutation `AdLibraryAddRecentSearchMutation` (doc_id `30487961417469833`) để lưu lịch sử và gọi `SearchTypeaheadQuery` để gợi ý danh sách Page / từ khóa tương ứng. |
| **Kích hoạt tìm kiếm** | Nhập `"DallasWind US"` và gửi phím `Enter` (hoặc click trực tiếp vào suggestion item). |

### 2.3 Thành phần 3: Hộp Thoại Bộ Lọc (Filter Dialog Modal)
Modal nâng cao cho phép lọc chi tiết các thuộc tính của chiến dịch quảng cáo.

#### A. Nút mở Filter Modal
- **HTML Tag & Role**: `<div role="button">`
- **Text hiển thị**: `Filters` (khi chưa lọc) hoặc `Filters (N)` (khi đang áp dụng N bộ lọc)
- **Resilient Selector**: `page.locator('div[role="button"]').filter(has_text=re.compile(r"^Filters\b", re.I)).first`

#### B. Khung chứa Modal (Dialog Container)
- **HTML Tag & Role**: `<div role="dialog">`
- **Resilient Selector**: `page.locator('div[role="dialog"]').filter(has_text=re.compile(r"Filters|Language|Platform", re.I)).first`

#### C. Chi tiết 4 Bộ lọc bên trong Modal

##### 1. Bộ lọc Nền tảng (Platform Filter)
- **Vị trí Combobox**: Combobox thứ 3 bên trong Modal (`combos[2]`).
- **Text ban đầu**: `All platforms`
- **Selector combobox**: `dlg.locator('div[role="combobox"]').nth(2)` hoặc combobox chứa nhãn `Platform` / `platform`.
- **Danh sách tùy chọn nền tảng**:
  - Facebook (`div[role="option"]:has-text("Facebook")`)
  - Instagram (`div[role="option"]:has-text("Instagram")`)
  - Audience Network (`div[role="option"]:has-text("Audience Network")`)
  - Messenger, WhatsApp, Threads.
- **Hành vi sau khi chọn 3 mục**: Text combobox cập nhật thành `3 options selected` (hoặc `3 platforms`).
- **Lưu ý kỹ thuật quan trọng**: Sau khi click chọn xong 3 nền tảng, **phải click lại vào combobox Platform** để đóng lớp popup phủ (overlay), tránh việc overlay che khuất ô nhập ngày tháng bên dưới.

##### 2. Bộ lọc Trạng thái Hoạt động (Active Status Filter)
- **Vị trí Combobox**: Combobox thứ 5 bên trong Modal (`combos[4]`).
- **Text ban đầu**: `Active and inactive`
- **Selector combobox**: `dlg.locator('div[role="combobox"]').nth(4)` hoặc combobox chứa nhãn `Active`.
- **Tùy chọn mục tiêu**: `div[role="option"]:has-text("Active ads")`
- **Hành vi sau khi chọn**: Combobox chuyển text thành `Active ads`, cập nhật query variable `activeStatus: "ACTIVE"`.

##### 3. Bộ lọc Lượt Hiển Thị Theo Ngày (Impressions by Date)
- **Loại thẻ**: `<input>` date picker định dạng `mm/dd/yyyy`.
- **Selector ô Từ ngày (From date)**: `dlg.locator('input[placeholder="mm/dd/yyyy"]').first`
- **Giá trị nhập**: `11/03/2026`
- **Thao tác**: Click vào ô, điền `11/03/2026` và ấn phím `Enter`.
- **Hành vi sau khi nhập**: Nhãn hiển thị xác nhận `On or after Nov 3, 2026`, gán query variable `startDate: {"min": "2026-11-03", "max": null}`.

##### 4. Bộ lọc Ngôn ngữ (Language Filter)
- **Vị trí Combobox**: Combobox đầu tiên bên trong Modal (`combos[0]`).
- **Text ban đầu**: `All languages`
- **Selector combobox**: `dlg.locator('div[role="combobox"]').first`
- **Tùy chọn mục tiêu**: `div[role="menuitem"], div[role="option"]` chứa text `English`.
- **Hành vi sau khi chọn**: Combobox hiển thị `English`, gán query variable `contentLanguages: ["en"]`.

#### D. Nút Áp dụng Bộ lọc (Dynamic Apply Button)
- **HTML Tag & Role**: `<div role="button">`
- **Hành vi động**: Nhãn nút tự động đếm số lượng filter đang thay đổi:
  - `Apply 1 filter` -> `Apply 2 filters` -> `Apply 3 filters` -> `Apply 4 filters`
- **Resilient Selector**: `dlg.locator('div[role="button"]').filter(has_text=re.compile(r"Apply \d+ filter", re.I)).first`
- **Thao tác click**: `apply_btn.click(force=True)` kích hoạt việc đóng modal và gửi request GraphQL refetch kết quả.

### 2.4 Thành phần 4: Dropdown Sắp Xếp Kết Quả (Sort By Dropdown)
Nằm tại thanh công cụ phía trên danh sách kết quả quảng cáo.

| Thuộc tính | Giá trị DOM Thực tế |
|---|---|
| **HTML Tag** | `<div role="combobox">` hoặc `<div role="button">` |
| **ARIA Attributes** | `aria-haspopup="listbox"`, `aria-label="Sort by"` |
| **Nhãn mặc định** | `Sort by` (Mặc định: Impressions: high to low) |
| **Resilient Selector** | `page.locator('div[role="combobox"], div[role="button"]').filter(has_text=re.compile(r"^Sort by", re.I)).first` |
| **Các tùy chọn sắp xếp** | 1. `Impressions: high to low` (`sortData: {"mode": "SORT_BY_TOTAL_IMPRESSIONS", "direction": "DESCENDING"}`)<br>2. `Most recent` (`sortData: {"mode": "SORT_BY_RELEVANCY_MONTHLY_GROUPED", "direction": "DESCENDING"}`) |

---

## 3. Đặc tả GraphQL API của Facebook Ads Library

Facebook Ads Library không sử dụng REST API truyền thống mà sử dụng **Relay Modern** giao tiếp qua cổng GraphQL trung tâm của Facebook.

### 3.1 Thông số Giao thức & Endpoint
- **URL Endpoint**: `POST https://www.facebook.com/api/graphql/`
- **Giao thức**: HTTP/2 over TLS 1.3
- **Content-Type**: `application/x-www-form-urlencoded`
- **Mã hóa phản hồi**: `Relay Incremental Delivery` (chunked `@defer` stream)

### 3.2 Danh mục Truy vấn Chính (Meta Query Document IDs)

| Friendly Name | Meta `doc_id` | Mục đích sử dụng |
|---|---|---|
| **`AdLibraryMobileFocusedStateProviderRefetchQuery`** | **`26617181747964058`** | **Truy vấn chính**: Tìm kiếm quảng cáo theo từ khóa ("DallasWind US") và áp dụng bộ lọc 4 tiêu chí. Trả về metadata và đợt quảng cáo đầu tiên (30 ads). |
| `AdLibrarySearchPaginationQuery` | `24922295957467452` | **Phân trang**: Tải các trang quảng cáo tiếp theo qua con trỏ (`cursor: end_cursor`). |
| `AdLibraryAddRecentSearchMutation` | `30487961417469833` | Lưu từ khóa vừa tìm vào danh sách lịch sử của người dùng. |
| `AdLibraryFilterContextProviderQuery` | `29650582277919185` | Lấy danh mục bộ lọc khả dụng và thống kê ngữ cảnh. |
| `SearchTypeaheadQuery` | Hash động | Autocomplete từ khóa và trang đối thủ theo thời gian thực. |

### 3.3 Danh sách Request Headers
Các header chuẩn được trình duyệt gửi kèm trong mỗi request GraphQL:

```http
POST /api/graphql/ HTTP/2
Host: www.facebook.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36
Content-Type: application/x-www-form-urlencoded
X-FB-Friendly-Name: AdLibraryMobileFocusedStateProviderRefetchQuery
X-FB-LSD: gwpccHZWELSQDorkmmN4t6
X-ASBD-ID: 359341
Sec-Ch-Ua: "Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"
Sec-Ch-Ua-Mobile: ?0
Sec-Ch-Ua-Platform: "Windows"
Sec-Ch-Ua-Full-Version-List: "Chromium";v="154.0.8037.98", "Google Chrome";v="154.0.8037.98"
Origin: https://www.facebook.com
Referer: https://www.facebook.com/ads/library/?...
```

### 3.4 Bóc tách Token Bảo mật & Form Body Parameters

Khi gửi POST form-urlencoded tới `/api/graphql/`, body bao gồm các trường bắt buộc sau:

1. **`doc_id`**: Định danh hash truy vấn biên dịch trên máy chủ Meta: `26617181747964058`.
2. **`fb_dtsg`**: Token chống CSRF gắn liền với phiên đăng nhập của người dùng (lấy từ `window.DTSGInitialData.token`), có độ dài 69 ký tự (ví dụ: `NAfy_b3Ciau5go5qHYhLrh1IZ...`).
3. **`__user`**: UID Facebook của tài khoản hiện tại (ví dụ: `61577091256835`).
4. **`__rev`**: Mã phiên bản build của Facebook Comet (ví dụ: `1052834804`).
5. **`lsd`**: Token định danh Light-weight Security Data (ví dụ: `gwpccHZWELSQDorkmmN4t6`).
6. **`jazoest`**: Mã checksum số học sinh ra từ chuỗi `fb_dtsg` (ví dụ: `25653`).
7. **`fb_api_caller_class`**: Chuỗi cố định `"RelayModern"`.
8. **`fb_api_req_friendly_name`**: Chuỗi định danh thân thiện `"AdLibraryMobileFocusedStateProviderRefetchQuery"`.
9. **`variables`**: Chuỗi JSON mã hóa URL chứa toàn bộ điều kiện tìm kiếm và bộ lọc.

---

## 4. Schema Chi tiết Payload Request (`variables` JSON Schema)

Dưới đây là cấu trúc JSON đầy đủ của trường `variables` khi thực thi kịch bản tìm kiếm "DallasWind US" với 4 bộ lọc:

```json
{
  "activeStatus": "ACTIVE",
  "adType": "ALL",
  "audienceTimeframe": "LAST_7_DAYS",
  "bylines": [],
  "collationToken": "3465f64f-0154-4254-bf15-a9510d2040be",
  "contentLanguages": [
    "en"
  ],
  "countries": [
    "US"
  ],
  "country": "US",
  "deeplinkAdID": null,
  "excludedIDs": [],
  "fetchPageInfo": false,
  "fetchSharedDisclaimers": false,
  "hasDeeplinkAdID": false,
  "isAboutTab": false,
  "isAudienceTab": false,
  "isLandingPage": false,
  "isTargetedCountry": false,
  "location": null,
  "mediaType": "ALL",
  "multiCountryFilterMode": null,
  "pageIDs": [],
  "potentialReachInput": [],
  "publisherPlatforms": [
    "FACEBOOK",
    "INSTAGRAM",
    "AUDIENCE_NETWORK"
  ],
  "queryString": "DallasWind US",
  "regions": [],
  "searchType": "KEYWORD_UNORDERED",
  "sessionID": "8f3b9f49-5027-4ff7-88a9-6d0fae4dea3e",
  "sortData": {
    "mode": "SORT_BY_TOTAL_IMPRESSIONS",
    "direction": "DESCENDING"
  },
  "source": "PAGE_TRANSPARENCY_WIDGET",
  "startDate": {
    "min": "2026-11-03",
    "max": null
  },
  "v": "63cade",
  "viewAllPageID": "0"
}
```

### Bảng Giải Thích Ý Nghĩa Từng Trường trong `variables`

| Trường | Kiểu dữ liệu | Giá trị thực tế | Ý nghĩa chức năng |
|---|---|---|---|
| `activeStatus` | String | `"ACTIVE"` | Lọc quảng cáo đang hoạt động (`ACTIVE`, `INACTIVE`, `ALL`). |
| `adType` | String | `"ALL"` | Danh mục quảng cáo (`ALL`, `POLITICAL_AND_ISSUE_ADS`, `HOUSING`,...). |
| `country` | String (ISO-2) | `"US"` | Quốc gia mục tiêu hiển thị quảng cáo. |
| `countries` | Array[String] | `["US"]` | Danh sách các quốc gia được chọn. |
| `queryString` | String | `"DallasWind US"` | Chuỗi từ khóa tìm kiếm. |
| `searchType` | String | `"KEYWORD_UNORDERED"` | Chế độ tìm kiếm từ khóa không phân biệt thứ tự từ. |
| `publisherPlatforms`| Array[String] | `["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"]` | 3 nền tảng được chọn trong bộ lọc. |
| `contentLanguages` | Array[String] | `["en"]` | Ngôn ngữ nội dung quảng cáo (Tiếng Anh). |
| `startDate` | Object | `{"min": "2026-11-03", "max": null}` | Giới hạn ngày hiển thị: từ ngày 03/11/2026 trở đi. |
| `sortData` | Object | `{"mode": "SORT_BY_TOTAL_IMPRESSIONS", "direction": "DESCENDING"}` | Sắp xếp theo tổng lượt hiển thị giảm dần. |
| `sessionID` | UUID String | `"8f3b9f49-..."` | Phiên làm việc của giao diện Ad Library. |
| `collationToken` | UUID String | `"3465f64f-..."` | Token gộp các nhóm quảng cáo trùng nội dung (creative collation). |

---

## 5. Cấu trúc Response & Schema Dữ liệu Quảng Cáo

### 5.1 Cơ chế Relay Incremental Delivery (`@defer`)
Phản hồi từ `/api/graphql/` của Meta trả về dưới dạng dòng JSON phân tách bằng ký tự xuống dòng (`\n`), có thể đi kèm tiền tố chống tấn công XSSI `for (;;);`:
- **Line 1 (Root Shell)**: Chứa thông tin người dùng (`viewer`), trạng thái hệ thống (`ad_library_system_status`), và cấu hình quốc gia (`country_details`).
- **Line 2 (Deferred Fragment Chunk)**: Chứa label `@defer` mang dữ liệu chính:
  `"label": "AdLibraryMobileFocusedStateProvider_fragment$defer$AdLibraryV2SearchResultsContainer_..."`
  chứa đối tượng `data.ad_library_main.search_results_connection`.

### 5.2 Schema của `search_results_connection`
```json
{
  "count": 193,
  "page_info": {
    "has_next_page": true,
    "end_cursor": "AQHTjekhD5YNecrJh0ttN3AKHLoAw1..."
  },
  "edges": [
    {
      "node": {
        "__typename": "CollatedSearchResults",
        "collated_results": [
          {
            "ad_archive_id": "1793151018506639",
            "page_id": "104568602496853",
            "page_name": "DallasWind US",
            "is_active": true,
            "publisher_platform": [
              "FACEBOOK",
              "INSTAGRAM",
              "AUDIENCE_NETWORK",
              "WHATSAPP",
              "THREADS"
            ],
            "start_date": 1788937200,
            "end_date": 1793692800,
            "snapshot": {
              "title": null,
              "body": {
                "text": "🚗 Car Rear-Seat Memory Foam Travel Mattress helps turn back seats into a cozy sleep space..."
              },
              "caption": "dallaswind.com",
              "cta_text": "Shop now",
              "cta_type": "SHOP_NOW",
              "link_url": "https://dallaswind.com/products/car-rear-seat-cushion-for-pet",
              "display_format": "VIDEO",
              "videos": [
                {
                  "video_hd_url": "https://video-ord5-1.xx.fbcdn.net/...",
                  "video_sd_url": "https://video-ord5-1.xx.fbcdn.net/...",
                  "video_preview_image_url": "https://scontent-ord5-2.xx.fbcdn.net/..."
                }
              ],
              "images": [],
              "page_like_count": 314
            }
          }
        ]
      },
      "cursor": null
    }
  ]
}
```

---

## 6. Dữ liệu Kết quả Kiểm Thử Thực Tế (Live Execution Data)

Dữ liệu được ghi nhận trực tiếp từ phiên chạy tự động hóa thành công của kịch bản `run_facebook_ads_automation.py`:

- **Thời điểm thực thi**: `2026-11-03T09:33:54Z` (Giờ UTC).
- **Document ID đã bắt**: `26617181747964058`.
- **Friendly Name**: `AdLibraryMobileFocusedStateProviderRefetchQuery`.
- **Token `fb_dtsg` bắt được**: `NAfy_b3Ciau5go5qHYhLrh1IZ...` (Độ dài: 69 ký tự).
- **Facebook User UID**: `61577091256835`.
- **Build Revision (`__rev`)**: `1052834804`.
- **Kích thước gói tin Response**: `165,761 bytes` (~166 KB).
- **Tổng số lượng kết quả quảng cáo tìm thấy**: **`193 ads`** (báo cáo trong `search_results_connection.count`), trong đó đợt đầu tiên trả về 30 card nodes; huy hiệu hiển thị trực tiếp trên giao diện DOM là `~190 results`.
- **Trạng thái phân trang**: `has_next_page: true`, `end_cursor: AQHTjekhD5YNecrJh0ttN3AKHLoAw1...`.

### Mẫu Dữ liệu Chi tiết 3 Quảng Cáo Tiêu Biểu Bắt Được:

#### Mẫu 1: Đệm Ô Tô Giảm Áp Lực (Memory Foam Mattress)
- **Archive ID**: `1793151018506639`
- **Page ID**: `104568602496853` (DallasWind US)
- **Trạng thái**: Đang chạy (`is_active: true`)
- **Nền tảng**: Facebook, Instagram, Audience Network, WhatsApp, Threads
- **Định dạng creative**: Video HD (`167 giây`)
- **Nội dung bài viết**: *"🚗 Car Rear-Seat Memory Foam Travel Mattress helps turn back seats into a cozy sleep space for road trips, camping, airport waits, and toddler naps..."*
- **Kêu gọi hành động (CTA)**: `Shop now`
- **Đường dẫn đích**: `https://dallaswind.com/products/car-rear-seat-cushion-for-pet`

#### Mẫu 2: Máy Cạo Râu Du Lịch Thông Minh (Smart Shaver)
- **Archive ID**: `3070101149852765`
- **Page ID**: `104568602496853` (DallasWind US)
- **Trạng thái**: Đang chạy (`is_active: true`)
- **Định dạng creative**: Video HD (`49 giây`)
- **Nội dung bài viết**: *"🪒 Smart shave. Small size. Big performance. Toss it in your gym bag. 🧳 🧠 AI intelligent beard sensing — auto-adjusts power and speed based on beard density..."*
- **Kêu gọi hành động (CTA)**: `Shop now`
- **Đường dẫn đích**: `https://dallaswind.com/products/elecsv-faf`

#### Mẫu 3: Hộp Bẫy Mối & Kiến Tái Sử Dụng (Ant & Termite Bait Station)
- **Archive ID**: `4368111596770518`
- **Page ID**: `104568602496853` (DallasWind US)
- **Trạng thái**: Đang chạy (`is_active: true`)
- **Định dạng creative**: Video HD (`35 giây`)
- **Nội dung bài viết**: *"🐜 50% OFF! Reusable Outdoor Ant & Termite Bait Station. Tired of ants marching & termites lurking?..."*
- **Kêu gọi hành động (CTA)**: `Shop now`
- **Đường dẫn đích**: `https://dallaswind.com/products/reusable-outdoor-ant-termite-bait-station`

---

## 7. Các Cạm Bẫy Kỹ Thuật (DOM Traps) & Biện Pháp Khắc Phục

Trong quá trình thực tế tự động hóa Facebook Comet UI, các thách thức đặc thù sau đã được nhận diện và xử lý triệt để:

### 1. Bẫy Lớp Phủ Dropdown (Pointer Interception Overlay)
- **Hiện tượng**: Khi mở combobox nhiều lựa chọn như *Platform*, Meta chèn một popup nổi (`uiContextualLayerParent`). Sau khi chọn xong 3 nền tảng, nếu không đóng combobox này lại, popup sẽ phủ lên ô nhập ngày tháng bên dưới, dẫn đến lỗi:
  `TimeoutError: <div class="..."> intercepts pointer events`.
- **Biện pháp**: Luôn thực hiện toggle đóng combobox (`platform_box.click()`) ngay sau khi tick xong các tùy chọn để loại bỏ lớp phủ khỏi DOM hit-test.

### 2. Bẫy Đóng Modal Khi Nhấn Phím `Escape`
- **Hiện tượng**: Nếu dùng `page.keyboard.press("Escape")` với mục đích đóng một dropdown con, phím Escape sẽ nổi bọt (bubble) lên cấp cao nhất và đóng luôn toàn bộ hộp thoại `div[role="dialog"]`, khiến các phần tử lọc bị detach khỏi DOM.
- **Biện pháp**: Tuyệt đối không dùng phím `Escape` bên trong modal dialog. Chỉ thu gọn dropdown bằng cách click lại vào chính phần tử combobox cha.

### 3. Đột Biến Nhãn Text của Combobox (Dynamic Text Mutation)
- **Hiện tượng**: Khi chọn xong các giá trị, text bên trong combobox thay đổi:
  - Platform: `All platforms` -> `3 options selected`
  - Active status: `Active and inactive` -> `Active ads`
  - Language: `All languages` -> `English`
- **Biện pháp**: Không sử dụng chuỗi text tĩnh để xác định combobox; thay vào đó sử dụng thứ tự index cố định trong modal (`combos[0]`: Language, `combos[2]`: Platform, `combos[4]`: Active status) hoặc regex pattern bao gồm cả trạng thái chưa chọn và đã chọn.

### 4. Thuộc Tính Role của Tùy Chọn Ngôn Ngữ
- **Hiện tượng**: Tùy chọn `English` trong popup ngôn ngữ không mang `role="option"` mà mang `role="menuitem"`. Việc chỉ tìm `div[role="option"]` sẽ không tìm thấy mục tiếng Anh.
- **Biện pháp**: Sử dụng selector đa vai trò:
  `page.locator('div[role="menuitem"], div[role="option"], div, span').filter(has_text=re.compile(r"^English$", re.I))`

### 5. Khác Biệt Responsive Viewport Desktop
- **Hiện tượng**: Nếu kích thước màn hình quá hẹp hoặc cực rộng không có viewport cố định, Meta có thể render dạng trang con tách rời thay vì modal chuẩn 5 combobox.
- **Biện pháp**: Script tự động hóa triển khai cơ chế **Dual-Mode**: tự động phát hiện layout dạng combobox (`len(combos) >= 4`) hoặc layout tương tác semantic nhãn trực tiếp (`label` + `input`), đảm bảo tương thích 100% trên mọi độ phân giải.

---

## 8. Hướng Dẫn Tái Hiện & Thực Thi Kịch Bản Tự Động Hóa

### 8.1 Yêu cầu Tiên Quyết
1. Khởi động ứng dụng GPM Login trên máy chủ `127.0.0.1:9495`.
2. Đảm bảo profile `a5374bbd-46ed-457d-9790-935ffa826471` sẵn sàng (có sẵn cookie Facebook).
3. Môi trường Python 3.10+ đã cài đặt `playwright` và `requests`:
   ```powershell
   pip install playwright requests
   ```

### 8.2 Lệnh Khởi Chạy
Tại thư mục gốc dự án:
```powershell
python F:\Extension-SPY-FEED-ADS-API\run_facebook_ads_automation.py
```

### 8.3 Kết Quả Đầu Ra Sinh Ra
Sau khi kịch bản chạy xong (khoảng 30-40 giây):
1. `F:\Extension-SPY-FEED-ADS-API\captured_graphql_request.json`: Chứa chi tiết request gửi đi (`doc_id`, `fb_dtsg`, headers, `variables`).
2. `F:\Extension-SPY-FEED-ADS-API\captured_graphql_response.json`: Chứa toàn bộ phản hồi JSON từ Meta API với danh sách quảng cáo của DallasWind US.
