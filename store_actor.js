/**
 * store_actor.js
 * =========================================================================
 * Siêu Tự Động Hóa 7 Bước Webstore Săn Ads & Pixel Super-Buyer Nurturing:
 * B1: Nhận diện Nền Tảng (Shopify, WooCommerce, Magento, Wix, v.v.)
 * B2: Lướt Xem Tự Nhiên (ViewContent) & Chọn Biến Thể (Variant)
 * B3: Thêm Vào Giỏ Hàng (AddToCart) & Sang Checkout (InitiateCheckout)
 * B4: Điền Thông Tin Giao Hàng Chuẩn US (UltimateDataGenerator + Match State/ZIP)
 * B5: Giả Lập Thanh Toán Thẻ PCI & Chờ 10s (AddPaymentInfo + 2Captcha Solver)
 * B6: Chuyển Sang Cổng PayPal & Mở Popup Thật (Chờ 10s High-Intent Buyer)
 * B7: Hoàn Tất & Gửi STORE_FLOW_COMPLETED Để Đóng Tab An Toàn
 */

(function () {
  if (window.__STORE_ACTOR_INITIALIZED__) return;
  window.__STORE_ACTOR_INITIALIZED__ = true;

  console.log('[Store Actor] Khởi động động cơ Pixel Super-Buyer trên trang:', location.href);

  // ── KHO DỮ LIỆU ĐỊA CHỈ US CHUẨN XÁC (KHỚP HOÀN TOÀN STATE - ZIP) ──
  const US_LOCATIONS = [
    { city: 'Chicago', state: 'IL', stateName: 'Illinois', zip: '60614', street: '2450 N Lincoln Ave' },
    { city: 'Los Angeles', state: 'CA', stateName: 'California', zip: '90210', street: '450 N Rodeo Dr' },
    { city: 'Houston', state: 'TX', stateName: 'Texas', zip: '77002', street: '1111 Louisiana St' },
    { city: 'Miami', state: 'FL', stateName: 'Florida', zip: '33139', street: '1020 Ocean Dr' },
    { city: 'New York', state: 'NY', stateName: 'New York', zip: '10001', street: '350 5th Ave' },
    { city: 'Seattle', state: 'WA', stateName: 'Washington', zip: '98101', street: '400 Pine St' }
  ];

  const FIRST_NAMES = ['David', 'James', 'Michael', 'Robert', 'William', 'Emily', 'Sarah', 'Jessica', 'Ashley', 'Emma'];
  const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor'];

  // Sinh thông tin khách hàng US hợp lệ
  function generateUSCustomerProfile() {
    const loc = US_LOCATIONS[Math.floor(Math.random() * US_LOCATIONS.length)];
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const randomNum = Math.floor(Math.random() * 899) + 100;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomNum}@gmail.com`;
    const phone = `312555${Math.floor(Math.random() * 8999) + 1000}`;

    return {
      email,
      firstName,
      lastName,
      address: loc.street,
      apartment: `Apt ${Math.floor(Math.random() * 20) + 1}`,
      city: loc.city,
      state: loc.state,
      stateName: loc.stateName,
      zip: loc.zip,
      phone
    };
  }

  // Tiện ích gửi log tiến trình về Background & Side Panel
  function reportProgress(stepIndex, title, details = {}) {
    console.log(`[Store Actor - Bước ${stepIndex}] ${title}`, details);
    try {
      chrome.runtime.sendMessage({
        action: 'STORE_FLOW_STEP_UPDATE',
        payload: {
          stepIndex,
          title,
          url: location.href,
          timestamp: Date.now(),
          details
        }
      });
    } catch (e) {}
  }

  // Giả lập gõ phím chân thực vào input
  async function typeHumanInput(inputEl, text) {
    if (!inputEl) return;
    inputEl.focus();
    inputEl.value = '';
    
    // Kích hoạt chuỗi sự kiện DOM hoàn chỉnh
    for (const char of text) {
      inputEl.value += char;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 25) + 15));
    }
    inputEl.blur();
  }

  // ── BƯỚC 1: NHẬN DIỆN NỀN TẢNG CỬA HÀNG ─────────────────────────
  function detectStorePlatform() {
    const html = document.documentElement.innerHTML.toLowerCase();
    let platform = 'Unknown Webstore';

    if (window.Shopify || html.includes('cdn.shopify.com') || html.includes('shopify-checkout')) {
      platform = 'Shopify';
    } else if (document.body.classList.contains('woocommerce') || html.includes('wp-content/plugins/woocommerce')) {
      platform = 'WooCommerce';
    } else if (html.includes('magento') || html.includes('mage/')) {
      platform = 'Magento';
    } else if (html.includes('opencart')) {
      platform = 'OpenCart';
    } else if (html.includes('wix.com') || html.includes('wix-warmup-data')) {
      platform = 'Wix eCommerce';
    } else if (html.includes('funnelish')) {
      platform = 'Funnelish';
    }

    reportProgress(1, `Nhận diện nền tảng: ${platform}`, { platform });
    return platform;
  }

  // ── BƯỚC 2: CUỘN XEM TỰ NHIÊN (VIEWCONTENT) & CHỌN BIẾN THỂ ───────
  async function simulateBrowseAndPickVariant() {
    reportProgress(2, 'Lướt xem tự nhiên kích hoạt Pixel ViewContent & Chọn biến thể');

    // 1. Cuộn mượt trang sản phẩm để Pixel Facebook ghi nhận ViewContent
    const totalScrollSteps = 4;
    for (let i = 0; i < totalScrollSteps; i++) {
      window.scrollBy({ top: 350, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 600));
    }
    await new Promise(r => setTimeout(r, 800));

    // Cuộn ngược nhẹ lại vùng thông tin sản phẩm
    window.scrollTo({ top: 250, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 500));

    // 2. Tìm và click ngẫu nhiên một biến thể (Variant swatch, radio hoặc select)
    const variantSelectors = [
      '.swatch-element:not(.soldout) label',
      '.product-form__input input[type="radio"]:not([disabled]) + label',
      '.variant-input-wrap label:not([disabled])',
      'input[type="radio"][name*="Size"]:not([disabled]) + label',
      'input[type="radio"][name*="Color"]:not([disabled]) + label',
      'button[data-variant-id]',
      'select[name="id"] option:not([disabled])'
    ];

    for (const sel of variantSelectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      if (elements.length > 0) {
        // Chọn ngẫu nhiên 1 option
        const target = elements[Math.floor(Math.random() * elements.length)];
        if (target.tagName.toLowerCase() === 'option') {
          target.parentElement.value = target.value;
          target.parentElement.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          target.click();
        }
        reportProgress(2, 'Đã chọn biến thể sản phẩm thành công', { variant: target.textContent?.trim() });
        await new Promise(r => setTimeout(r, 600));
        break;
      }
    }
  }

  // ── BƯỚC 3: THÊM VÀO GIỎ HÀNG (ADDTOCART) & SANG CHECKOUT ─────────
  async function addToCartAndInitiateCheckout() {
    reportProgress(3, 'Tìm kiếm nút Add to Cart & Tiến hành Checkout (InitiateCheckout)');

    const atcSelectors = [
      'button[name="add"]',
      'button[type="submit"][class*="add-to-cart" i]',
      'button[class*="btn--add-to-cart" i]',
      'button[id*="AddToCart" i]',
      'button:has-text("Add to Cart")',
      'input[type="submit"][name="add"]',
      'button[data-action="add-to-cart"]'
    ];

    let atcBtn = null;
    for (const sel of atcSelectors) {
      try {
        const found = document.querySelector(sel);
        if (found && found.offsetParent !== null) {
          atcBtn = found;
          break;
        }
      } catch (e) {}
    }

    // Fallback: Tìm nút có nội dung Add to Cart
    if (!atcBtn) {
      const allButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
      atcBtn = allButtons.find(b => {
        const t = (b.innerText || b.value || '').toLowerCase();
        return t.includes('add to cart') || t.includes('buy it now') || t.includes('thêm vào giỏ');
      });
    }

    if (atcBtn) {
      atcBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 400));
      atcBtn.click();
      reportProgress(3, 'Đã bấm nút Add to Cart thành công');
      await new Promise(r => setTimeout(r, 1800));
    } else {
      console.warn('[Store Actor] Không tìm thấy nút ATC tiêu chuẩn, tự động chuyển hướng /checkout');
    }

    // Xử lý Checkbox Điều Khoản trong Cart Drawer nếu có
    const termsCheckboxes = document.querySelectorAll('input[type="checkbox"][name*="agree" i], input[type="checkbox"][name*="terms" i]');
    termsCheckboxes.forEach(cb => {
      if (!cb.checked) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Bấm nút Checkout hoặc điều hướng sang trang Checkout
    const checkoutSelectors = [
      'button[name="checkout"]',
      'a[href*="/checkout"]',
      '.cart__checkout',
      'button[id*="checkout" i]',
      'a[class*="checkout" i]'
    ];

    let checkoutBtn = null;
    for (const sel of checkoutSelectors) {
      const found = document.querySelector(sel);
      if (found && found.offsetParent !== null) {
        checkoutBtn = found;
        break;
      }
    }

    if (checkoutBtn) {
      checkoutBtn.click();
      reportProgress(3, 'Đã kích hoạt Checkout từ giỏ hàng');
    } else if (!location.pathname.includes('/checkout')) {
      reportProgress(3, 'Chủ động điều hướng sang /checkout');
      location.href = '/checkout';
    }
  }

  // ── BƯỚC 4: ĐIỀN THÔNG TIN GIAO HÀNG CHUẨN US (SHIPPING INFO) ──────
  async function fillUSCustomerShippingInfo() {
    // Nếu chưa ở trang checkout, đợi trang tải
    if (!location.pathname.includes('/checkout') && !document.querySelector('form[action*="checkout"], #checkout-main')) {
      await new Promise(r => setTimeout(r, 2000));
    }

    reportProgress(4, 'Bắt đầu điền thông tin khách hàng US chuẩn ZIP & State');
    const customer = generateUSCustomerProfile();

    // 1. Email Contact
    const emailInput = document.querySelector('input[type="email"], input[name*="email" i], #email, #checkout_email');
    if (emailInput) await typeHumanInput(emailInput, customer.email);

    // 2. Họ và Tên
    const firstNameInput = document.querySelector('input[name*="first_name" i], input[name*="firstname" i], #checkout_shipping_address_first_name');
    if (firstNameInput) await typeHumanInput(firstNameInput, customer.firstName);

    const lastNameInput = document.querySelector('input[name*="last_name" i], input[name*="lastname" i], #checkout_shipping_address_last_name');
    if (lastNameInput) await typeHumanInput(lastNameInput, customer.lastName);

    // 3. Địa Chỉ Đường & Số Nhà
    const addressInput = document.querySelector('input[name*="address1" i], input[id*="address1" i], input[name*="street" i]');
    if (addressInput) {
      await typeHumanInput(addressInput, customer.address);
      // Gửi phím Escape để đóng dropdown Google Places Autocomplete
      addressInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      addressInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    }

    const aptInput = document.querySelector('input[name*="address2" i], input[id*="address2" i]');
    if (aptInput) await typeHumanInput(aptInput, customer.apartment);

    // 4. City, State & ZIP Code (Khớp tuyệt đối)
    const cityInput = document.querySelector('input[name*="city" i], input[id*="city" i]');
    if (cityInput) await typeHumanInput(cityInput, customer.city);

    const zipInput = document.querySelector('input[name*="zip" i], input[name*="postal" i], input[id*="zip" i], input[id*="postal" i]');
    if (zipInput) await typeHumanInput(zipInput, customer.zip);

    // Chọn State Dropdown nếu có
    const stateSelect = document.querySelector('select[name*="zone" i], select[name*="province" i], select[id*="province" i]');
    if (stateSelect) {
      Array.from(stateSelect.options).forEach(opt => {
        if (opt.value === customer.state || opt.textContent.includes(customer.stateName)) {
          stateSelect.value = opt.value;
          stateSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    // 5. Số điện thoại US
    const phoneInput = document.querySelector('input[type="tel"], input[name*="phone" i], input[id*="phone" i]');
    if (phoneInput) await typeHumanInput(phoneInput, customer.phone);

    reportProgress(4, 'Đã điền hoàn tất thông tin US thành công', {
      name: `${customer.firstName} ${customer.lastName}`,
      city: customer.city,
      state: customer.state,
      zip: customer.zip
    });

    await new Promise(r => setTimeout(r, 1000));

    // Bấm nút tiếp tục nếu là checkout nhiều bước
    const continueBtn = document.querySelector('button[type="submit"], #continue_button, button[id*="continue" i]');
    if (continueBtn && (continueBtn.innerText || '').toLowerCase().includes('continue')) {
      continueBtn.click();
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // ── BƯỚC 5: THANH TOÁN THẺ TÍN DỤNG & KÍCH HOẠT ADD PAYMENT INFO ───
  async function simulateCreditCardPaymentAndCount10s() {
    reportProgress(5, 'Chọn radio Credit Card, bơm thông tin thẻ test & kích hoạt AddPaymentInfo');

    // 1. Tích chọn radio Credit Card
    const ccRadio = document.querySelector('input[type="radio"][value*="credit" i], input[type="radio"][value*="card" i], input[id*="basic-creditCards" i]');
    if (ccRadio && !ccRadio.checked) {
      ccRadio.click();
      ccRadio.checked = true;
      ccRadio.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
    }

    // 2. Điền thông tin thẻ test vào form trực tiếp nếu có
    const directCardNumber = document.querySelector('input[name*="number" i], input[id*="card-number" i]');
    if (directCardNumber) {
      await typeHumanInput(directCardNumber, '4242424242424242');
    }

    // 3. Thông báo Service Worker tìm và bơm dữ liệu vào các PCI Card IFrames (Shopify/Stripe)
    try {
      chrome.runtime.sendMessage({
        action: 'FILL_PCI_CARD_FRAMES',
        payload: {
          number: '4242424242424242',
          name: 'JOHN SMITH',
          expiry: '12/28',
          cvv: '123'
        }
      });
    } catch (e) {}

    await new Promise(r => setTimeout(r, 1000));

    // Bấm nút Pay Now / Complete Purchase để kích hoạt AddPaymentInfo của Meta Pixel
    const payBtn = document.querySelector('button[id*="checkout-pay-button" i], #continue_button, button[type="submit"]');
    if (payBtn) {
      console.log('[Store Actor] Kích hoạt sự kiện submit thanh toán thẻ...');
      payBtn.click();
    }

    // Đếm ngược dừng đúng 10 giây để Facebook Pixel ghi nhận
    reportProgress(5, 'Đang dừng 10 giây để Facebook Pixel ghi nhận sự kiện AddPaymentInfo thẻ...');
    for (let c = 10; c > 0; c--) {
      console.log(`[Store Actor] Đếm ngược thanh toán thẻ: ${c}s...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // ── BƯỚC 6: CHUYỂN SANG CỔNG PAYPAL & MỞ POPUP THẬT (CHỜ 10S) ──────
  async function simulatePayPalGatewayAndCount10s() {
    reportProgress(6, 'Chuyển sang cổng PayPal & Kích hoạt Trusted Click mở Popup');

    // 1. Tích chọn radio PayPal
    const paypalRadio = document.querySelector('input[type="radio"][value*="paypal" i], input[id*="paypal" i]');
    if (paypalRadio && !paypalRadio.checked) {
      paypalRadio.click();
      paypalRadio.checked = true;
      paypalRadio.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
    }

    // 2. Định vị nút bấm ví PayPal thật
    const paypalButton = document.querySelector('.paypal-buttons, div[data-funding-source="paypal"], iframe[id*="PAY_WITH_PAYPAL" i]');
    if (paypalButton) {
      paypalButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 500));

      // Yêu cầu Background gửi Trusted Click qua Chrome DevTools Protocol
      try {
        chrome.runtime.sendMessage({
          action: 'CDP_TRUSTED_CLICK_PAYPAL',
          payload: {
            rect: paypalButton.getBoundingClientRect()
          }
        });
      } catch (e) {
        // Fallback DOM Click
        paypalButton.click();
      }
    }

    // Đếm ngược dừng đúng 10 giây khi Popup PayPal đang mở
    reportProgress(6, 'Đang dừng 10 giây ghi nhận đối tượng khách hàng tiềm năng cao nhất (High-Intent Buyer)...');
    for (let c = 10; c > 0; c--) {
      console.log(`[Store Actor] Đếm ngược xác thực PayPal: ${c}s...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // ── BƯỚC 7: HOÀN TẤT & ĐÓNG TAB AN TOÀN ───────────────────────────
  function finalizeAndCloseStoreTab() {
    reportProgress(7, 'Hoàn tất chu trình Super-Buyer 7 bước, chuẩn bị đóng tab Webstore an toàn.');
    try {
      chrome.runtime.sendMessage({
        action: 'STORE_FLOW_COMPLETED',
        payload: {
          url: location.href,
          completedAt: Date.now()
        }
      });
    } catch (e) {}
  }

  // ── ĐIỀU PHỐI TOÀN BỘ CHU TRÌNH 7 BƯỚC TUẦN TỰ ────────────────────
  async function runMasterStoreFlow() {
    try {
      // B1: Nhận diện Platform
      detectStorePlatform();
      await new Promise(r => setTimeout(r, 800));

      // Nếu đang ở trang sản phẩm: chạy B2 & B3
      if (!location.pathname.includes('/checkout')) {
        await simulateBrowseAndPickVariant();
        await addToCartAndInitiateCheckout();
        await new Promise(r => setTimeout(r, 2000));
      }

      // B4: Điền thông tin giao hàng US
      await fillUSCustomerShippingInfo();
      await new Promise(r => setTimeout(r, 1500));

      // B5: Thanh toán thẻ test & chờ 10s
      await simulateCreditCardPaymentAndCount10s();
      await new Promise(r => setTimeout(r, 1000));

      // B6: Chuyển sang PayPal & chờ 10s
      await simulatePayPalGatewayAndCount10s();
      await new Promise(r => setTimeout(r, 1000));

      // B7: Hoàn tất & đóng tab
      finalizeAndCloseStoreTab();
    } catch (err) {
      console.error('[Store Actor] Lỗi trong chu trình 7 bước:', err);
      reportProgress(7, `Gặp sự cố: ${err.message}. Tự động dọn dẹp và đóng tab.`);
      finalizeAndCloseStoreTab();
    }
  }

  // Khởi động chu trình tự động sau khi trang tải ổn định 1.5s
  setTimeout(() => {
    runMasterStoreFlow();
  }, 1500);

})();
