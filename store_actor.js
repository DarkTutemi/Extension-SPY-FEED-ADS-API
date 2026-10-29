/**
 * store_actor.js
 * =========================================================================
 * Siêu Tự Động Hóa 7 Bước Webstore Săn Ads & Pixel Super-Buyer Nurturing:
 * B1: Nhận diện Nền Tảng (Shopify, WooCommerce, Magento, Wix, v.v.)
 * B2: Lướt Xem Tự Nhiên (ViewContent) & Chọn Biến Thể (Variant)
 * B3: Thêm Vào Giỏ Hàng (AddToCart) & Sang Checkout (InitiateCheckout)
 * B4: Điền Thông Tin Giao Hàng Chuẩn US (setNativeValue React 18, Khớp State/ZIP 0 Lỗi, Esc Google Autocomplete)
 * B5: Giả Lập Thanh Toán Thẻ PCI (Bơm Top & Iframes, Pay Now, Bắt Captcha 2Captcha, Chờ 10s Pixel AddPaymentInfo)
 * B6: Chuyển Sang Cổng PayPal (Đổi Radio, Định Vị Iframe Ví, Bắn Trusted Click CDP Mở Popup Thật, Chờ 10s)
 * B7: Bắn STORE_FLOW_COMPLETED & Đóng Tab Webstore An Toàn
 */

(function () {
  'use strict';
  const isTopFrame = (window.self === window.top);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/[\s\u00a0\u200b]+/g, ' ').trim().toLowerCase();

  const DEFAULT_CARD = {
    number: '5355221483083376',
    numberFormatted: '5355 2214 8308 3376',
    expMonth: '01',
    expYear: '29',
    expFullYear: '2029',
    expString: '01 / 29',
    expCombined: '01/29',
    expRaw: '0129',
    cvv: '088',
    holderName: 'Emily Davis'
  };

  const isTrapInput = el => {
    if (!el) return true;
    if (el.hasAttribute('data-honeypot-field') || el.classList.contains('visually-hidden')) return true;
    const id = (el.id || '').toLowerCase();
    if (id.startsWith('autofill_')) return true;
    if (el.getAttribute('aria-hidden') === 'true' || el.tabIndex === -1) {
      if (el.hasAttribute('data-honeypot-field') || id.startsWith('autofill_')) return true;
    }
    return false;
  };

  const isVisible = el => {
    if (!el || isTrapInput(el)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // Gửi tin nhắn an toàn về background
  function safeSendMessage(msg) {
    try {
      if (typeof chrome === 'undefined' || !chrome?.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  // Bấm phần tử an toàn, chống CSP JavaScript URL Violation
  function safeElementClick(el) {
    if (!el) return false;
    let originalHref = null;
    let anchorEl = null;

    if (el.tagName === 'A') anchorEl = el;
    else if (typeof el.closest === 'function') anchorEl = el.closest('a');

    const rawHref = anchorEl ? (anchorEl.getAttribute('href') || '') : '';
    const isJsUrl = rawHref.trim().toLowerCase().startsWith('javascript:');

    if (isJsUrl && anchorEl) {
      originalHref = rawHref;
      anchorEl.removeAttribute('href');
    }

    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      if (typeof el.click === 'function' && !isJsUrl) el.click();
      return true;
    } catch (e) {
      try {
        if (typeof el.click === 'function' && !isJsUrl) el.click();
      } catch (_) {}
      return false;
    } finally {
      if (isJsUrl && anchorEl && originalHref !== null) anchorEl.setAttribute('href', originalHref);
    }
  }

  // Gán giá trị tương thích tuyệt đối React 18 (_valueTracker) & Shopify Checkout Extensibility
  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null || isTrapInput(element)) return;
    const strVal = String(value);
    try {
      element.focus();
      const prevVal = element.value;
      const proto = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const ownSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;

      if (protoSetter && ownSetter !== protoSetter) {
        protoSetter.call(element, strVal);
      } else if (ownSetter) {
        ownSetter.call(element, strVal);
      } else {
        element.value = strVal;
      }
      if (element._valueTracker) {
        element._valueTracker.setValue(prevVal);
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: strVal.slice(-1) || 'a' }));
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: strVal.slice(-1) || 'a' }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    } catch (e) {
      element.value = strVal;
    }
  }

  // Gán giá trị chuyên biệt cho các ô Thẻ Tín Dụng
  function setCreditCardInputValue(input, value) {
    if (!input || value === undefined || value === null || isTrapInput(input)) return;
    const strVal = String(value);
    try {
      input.focus();
      input.click();
      const prevVal = input.value;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(input, strVal);
      } else {
        input.value = strVal;
      }
      if (input._valueTracker) {
        input._valueTracker.setValue(prevVal);
      }
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: strVal.slice(-1) || '0' }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: strVal.slice(-1) || '0' }));
      input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    } catch (e) {}
  }

  // =========================================================================
  // XỬ LÝ TRONG CHILD IFRAME (ĐIỀN THẺ PCI & BẤM NÚT VÍ PAYPAL TRONG FRAME)
  // =========================================================================
  if (!isTopFrame) {
    window.addEventListener('message', e => {
      if (e.data && e.data.action === 'ULTIMATE_FILL_CARD' && e.data.card) {
        const c = e.data.card;
        const num = document.querySelector('input[data-current-field="number"], input#number, input[name="number"]');
        if (num) setCreditCardInputValue(num, c.numberFormatted || c.number);
        const exp = document.querySelector('input[data-current-field="expiry"], input#expiry, input[name="expiry"]');
        if (exp) setCreditCardInputValue(exp, c.expString || c.expCombined);
        const cvv = document.querySelector('input[data-current-field="verification_value"], input#verification_value, input[name="verification_value"]');
        if (cvv) setCreditCardInputValue(cvv, c.cvv);
      }
      if (e.data && e.data.action === 'ULTIMATE_CLICK_PAYPAL_WALLET') {
        const walletBtn = document.querySelector('#paypal-button-container button, button#standard-wallet-button, .paypal-button, button');
        if (walletBtn) safeElementClick(walletBtn);
      }
    });
    return;
  }

  // =========================================================================
  // XỬ LÝ TRÊN TOP FRAME (TOÀN BỘ 7 BƯỚC STORE & CHECKOUT)
  // =========================================================================
  if (window.__STORE_ACTOR_TOP_INITIALIZED__) return;
  window.__STORE_ACTOR_TOP_INITIALIZED__ = true;

  console.log('[Store Actor] Khởi động động cơ Pixel Super-Buyer trên trang:', location.href);

  // Tiện ích gửi log tiến trình về Background & Side Panel
  function reportProgress(stepIndex, title, details = {}) {
    const detailStr = typeof details === 'string' ? details : (details.platform || details.message || '');
    console.log(`[Store Actor - Bước ${stepIndex}/7] ${title}`, details);
    safeSendMessage({
      action: 'STORE_FLOW_STEP_UPDATE',
      payload: {
        step: stepIndex,
        stepIndex,
        totalSteps: 7,
        name: title,
        title,
        detail: detailStr,
        url: location.href,
        timestamp: Date.now(),
        details
      }
    });

    safeSendMessage({
      action: 'NEW_AD_LOG_ENTRY',
      payload: {
        adId: `PIXEL_STEP_${stepIndex}_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        pageName: `🛒 WEBSTORE [Bước ${stepIndex}/7]: ${title}`,
        pageUrl: location.href,
        isVerified: false,
        mediaType: 'STORE_PIXEL',
        likes: 0,
        comments: 0,
        shares: 0,
        buttonText: `Bước ${stepIndex}`,
        targetUrl: location.href,
        isMatched: true,
        auditChecks: [
          { pass: true, desc: title },
          { pass: true, desc: detailStr || location.hostname }
        ]
      }
    });
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
      await sleep(600);
    }
    await sleep(800);

    // Cuộn ngược nhẹ lại vùng thông tin sản phẩm
    window.scrollTo({ top: 250, behavior: 'smooth' });
    await sleep(500);

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
        const target = elements[Math.floor(Math.random() * elements.length)];
        if (target.tagName.toLowerCase() === 'option') {
          target.parentElement.value = target.value;
          target.parentElement.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          safeElementClick(target);
        }
        reportProgress(2, 'Đã chọn biến thể sản phẩm thành công', { variant: target.textContent?.trim() });
        await sleep(600);
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
      'input[type="submit"][name="add"]',
      'button[data-action="add-to-cart"]'
    ];

    let atcBtn = null;
    for (const sel of atcSelectors) {
      try {
        const found = document.querySelector(sel);
        if (found && isVisible(found)) {
          atcBtn = found;
          break;
        }
      } catch (e) {}
    }

    if (!atcBtn) {
      const allButtons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
      atcBtn = allButtons.find(b => {
        const t = (b.innerText || b.value || '').toLowerCase();
        return t.includes('add to cart') || t.includes('buy it now') || t.includes('thêm vào giỏ');
      });
    }

    if (atcBtn) {
      atcBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(400);
      safeElementClick(atcBtn);
      reportProgress(3, 'Đã bấm nút Add to Cart thành công');
      await sleep(1800);
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
      if (found && isVisible(found)) {
        checkoutBtn = found;
        break;
      }
    }

    if (checkoutBtn) {
      safeElementClick(checkoutBtn);
      reportProgress(3, 'Đã kích hoạt Checkout từ giỏ hàng');
    } else if (!location.pathname.includes('/checkout')) {
      reportProgress(3, 'Chủ động điều hướng sang /checkout');
      location.href = '/checkout';
    }
  }

  // ── BƯỚC 4: ĐIỀN THÔNG TIN GIAO HÀNG CHUẨN US (SHIPPING & CONTACT) ─
  async function fillUSCustomerShippingInfo() {
    reportProgress(4, 'Đang đợi form Checkout render xong & bắt đầu điền thông tin...');

    // Chờ tối đa 6 giây để các ô input của Shopify Checkout Extensibility render xong
    for (let waitIdx = 0; waitIdx < 12; waitIdx++) {
      const readyEl = document.querySelector(
        'input[name="email"], input#email, input[type="email"], input[name="address1"], input[id*="shipping-address1"], button#checkout-pay-button'
      );
      if (readyEl) break;
      await sleep(500);
    }
    await sleep(800);

    // Profile chuẩn US (Chicago, IL 60614)
    const profile = {
      fullName: 'Emily Davis',
      firstName: 'Emily',
      lastName: 'Davis',
      email: 'emily.davis92@gmail.com',
      phone: '3125550198',
      address: '1428 Elm Street',
      apartment: 'Apt 4B',
      city: 'Chicago',
      state: 'Illinois',
      stateCode: 'IL',
      zipCode: '60614',
      countryCode: 'US'
    };

    const fillFirstVisible = async (selectors, val, delayMs = 150) => {
      for (const s of selectors) {
        const els = document.querySelectorAll(s);
        for (const el of els) {
          if (isVisible(el) && !isTrapInput(el)) {
            setNativeValue(el, val);
            await sleep(delayMs);
            return el;
          }
        }
      }
      return null;
    };

    // 1. Email Contact
    await fillFirstVisible([
      'input[name="email"]', 'input#email', 'input[type="email"]',
      'input[autocomplete="email"]', 'input[name="checkout[email]"]',
      'input[id*="email" i]', 'input[placeholder*="Email" i]'
    ], profile.email, 200);

    // 2. Country / Region (United States)
    const countrySelects = document.querySelectorAll('select[name="countryCode"], select[autocomplete*="country"], select[name="checkout[shipping_address][country]"], select[id*="country" i]');
    for (const sel of countrySelects) {
      if (isVisible(sel) && !isTrapInput(sel)) {
        const want = ['us', 'united states', 'usa'];
        const opt = Array.from(sel.options || []).find(o => want.includes(norm(o.value)) || want.includes(norm(o.text)));
        if (opt && sel.value !== opt.value) {
          setNativeValue(sel, opt.value);
          await sleep(400);
        }
        break;
      }
    }

    // 3. First Name & Last Name
    await fillFirstVisible([
      'input[name="firstName"]', 'input[autocomplete*="given-name"]',
      'input[name="checkout[shipping_address][first_name]"]',
      'input[id*="first_name" i]', 'input[placeholder*="First name" i]', 'input[id*="TextField0"]'
    ], profile.firstName, 150);

    await fillFirstVisible([
      'input[name="lastName"]', 'input[autocomplete*="family-name"]',
      'input[name="checkout[shipping_address][last_name]"]',
      'input[id*="last_name" i]', 'input[placeholder*="Last name" i]', 'input[id*="TextField1"]'
    ], profile.lastName, 150);

    // 4. Address 1 (kèm phím Escape đóng Google Autocomplete tránh che trường bên dưới)
    const addr1El = await fillFirstVisible([
      'input[name="address1"]', 'input[autocomplete*="address-line1"]',
      'input[name="checkout[shipping_address][address1]"]',
      'input[id*="shipping-address1"]', 'input[id*="address1" i]', 'input[placeholder*="Address" i]'
    ], profile.address, 200);
    if (addr1El) {
      addr1El.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }

    // 5. Apartment / Suite
    await fillFirstVisible([
      'input[name="address2"]', 'input[autocomplete*="address-line2"]',
      'input[name="checkout[shipping_address][address2]"]',
      'input[placeholder*="Apartment" i]', 'input[placeholder*="Suite" i]'
    ], profile.apartment || 'Apt 4B', 120);

    // 6. City
    await fillFirstVisible([
      'input[name="city"]', 'input[autocomplete*="address-level2"]',
      'input[name="checkout[shipping_address][city]"]',
      'input[id*="city" i]', 'input[placeholder*="City" i]'
    ], profile.city, 150);

    // 7. State / Province (ưu tiên khớp chính xác mã Bang stateCode trước để khớp 100% với ZIP Code)
    const stateSelects = document.querySelectorAll('select[name="zone"], select[autocomplete*="address-level1"], select[name="checkout[shipping_address][province]"], select[id*="zone" i], select[name*="state" i]');
    for (const sel of stateSelects) {
      if (isVisible(sel) && !isTrapInput(sel)) {
        const wantCode = norm(profile.stateCode);
        const wantName = norm(profile.state);
        const options = Array.from(sel.options || []);
        const exactOpt =
          options.find(o => norm(o.value) === wantCode || norm(o.text) === wantName) ||
          options.find(o => norm(o.text).includes(wantName) || norm(o.value).endsWith(`-${wantCode}`));
        if (exactOpt) {
          setNativeValue(sel, exactOpt.value);
          await sleep(300);
        }
        break;
      }
    }

    // 8. ZIP / Postal Code (khớp trực tiếp với State vừa chọn)
    const zipEl = await fillFirstVisible([
      'input[name="postalCode"]', 'input[autocomplete*="postal-code"]',
      'input[name="checkout[shipping_address][zip]"]',
      'input[id*="postal_code" i]', 'input[placeholder*="ZIP" i]', 'input[placeholder*="Postal" i]'
    ], profile.zipCode, 200);

    // Xác thực lại State & ZIP lần nữa sau khi React 18 re-render để đảm bảo 0 lỗi đỏ
    await sleep(250);
    for (const sel of stateSelects) {
      if (isVisible(sel) && !isTrapInput(sel)) {
        const wantCode = norm(profile.stateCode);
        const wantName = norm(profile.state);
        if (norm(sel.value) !== wantCode && !norm(sel.options[sel.selectedIndex]?.text || '').includes(wantName)) {
          const exactOpt = Array.from(sel.options || []).find(o => norm(o.value) === wantCode || norm(o.text) === wantName);
          if (exactOpt) setNativeValue(sel, exactOpt.value);
        }
        break;
      }
    }
    if (zipEl && zipEl.value !== profile.zipCode) {
      setNativeValue(zipEl, profile.zipCode);
    }

    // 9. Phone
    await fillFirstVisible([
      'input[name="phone"]', 'input[autocomplete*="tel"]',
      'input[name="checkout[shipping_address][phone]"]',
      'input[type="tel"]', 'input[placeholder*="Phone" i]'
    ], profile.phone, 150);

    reportProgress(4, 'Đã điền hoàn tất thông tin US thành công (0 lỗi đỏ)', {
      name: profile.fullName,
      address: profile.address,
      state: profile.stateCode,
      zip: profile.zipCode
    });

    await sleep(1000);

    // Bấm nút chuyển bước nếu là Checkout nhiều trang
    const continueStepBtn = document.querySelector('button#continue_button');
    const hasPaymentSection = !!document.querySelector(
      'input[type="radio"][value*="credit_card" i], input[type="radio"][id*="credit" i], input[type="radio"][id*="basic-creditCards" i], input[type="radio"][value*="paypal" i], iframe[src*="card-fields"]'
    );
    if (continueStepBtn && isVisible(continueStepBtn) && !hasPaymentSection) {
      const btnTxt = norm(continueStepBtn.innerText || continueStepBtn.value || '');
      if (btnTxt.includes('continue to shipping') || btnTxt.includes('continue to payment')) {
        reportProgress(4, '👉 Đang bấm chuyển sang bước Thanh Toán...');
        safeElementClick(continueStepBtn);
        await sleep(3000);
      }
    }
  }

  // Điền thông tin thẻ tín dụng trên Top Document hoặc Same-Origin Iframe (loại trừ honeypot)
  function fillCreditCardFieldsOnTopAndSameOrigin(card, holderName) {
    const numFormatted = card.numberFormatted || String(card.number || DEFAULT_CARD.number).replace(/\s+/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    const expStr = card.expString || DEFAULT_CARD.expString;
    const cvvStr = String(card.cvv || DEFAULT_CARD.cvv);
    const nameStr = holderName || card.holderName || DEFAULT_CARD.holderName;
    const notTrap = ':not([data-honeypot-field]):not(.visually-hidden)';

    // 1. Điền Tên trên thẻ
    const nameInputs = document.querySelectorAll(`input[placeholder*="Name on card" i]${notTrap}, input[id*="name-on-card" i]${notTrap}, input[name*="name_on_card" i]${notTrap}, input[autocomplete="cc-name"]${notTrap}`);
    for (const inp of nameInputs) {
      if (isVisible(inp) && (!inp.value || inp.value.trim().length === 0)) {
        setCreditCardInputValue(inp, nameStr);
        break;
      }
    }

    // 2. Điền số thẻ, ngày hết hạn, CVV nếu nằm trực tiếp trên top document
    const numInputs = document.querySelectorAll(`input#number${notTrap}, input[name="number"]${notTrap}, input[autocomplete="cc-number"]${notTrap}, input[placeholder*="Card number" i]${notTrap}`);
    for (const inp of numInputs) {
      if (isVisible(inp)) setCreditCardInputValue(inp, numFormatted);
    }

    const expInputs = document.querySelectorAll(`input#expiry${notTrap}, input[name="expiry"]${notTrap}, input[autocomplete="cc-exp"]${notTrap}, input[placeholder*="Expiration" i]${notTrap}, input[placeholder*="MM" i]${notTrap}`);
    for (const inp of expInputs) {
      if (isVisible(inp)) setCreditCardInputValue(inp, expStr);
    }

    const cvvInputs = document.querySelectorAll(`input#verification_value${notTrap}, input[name="verification_value"]${notTrap}, input[autocomplete="cc-csc"]${notTrap}, input[placeholder*="Security code" i]${notTrap}, input[placeholder*="CVV" i]${notTrap}`);
    for (const inp of cvvInputs) {
      if (isVisible(inp)) setCreditCardInputValue(inp, cvvStr);
    }

    // 3. Quét các iframes (gửi postMessage)
    const iframes = document.querySelectorAll('iframe');
    for (const f of iframes) {
      try {
        f.contentWindow?.postMessage({ action: 'ULTIMATE_FILL_CARD', card: { ...card, holderName: nameStr } }, '*');
      } catch (e) {}
    }
  }

  // ── BƯỚC 5: THANH TOÁN THẺ TÍN DỤNG (BƯỚC 1/2) — CHỜ 10 GIÂY ───────
  async function simulateCreditCardPaymentAndCount10s() {
    const card = { ...DEFAULT_CARD };
    reportProgress(5, `💳 Bước 1/2: Đang điền thẻ (${card.numberFormatted} | ${card.expCombined} | ${card.cvv})...`);

    // 1. Chọn radio Credit Card nếu chưa được chọn
    const creditCardRadios = document.querySelectorAll(
      'input[type="radio"][value*="credit_card" i], input[type="radio"][id*="credit" i], input[type="radio"][id*="basic-creditCards" i]'
    );
    for (const r of creditCardRadios) {
      if (!r.checked) {
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        safeElementClick(r);
        await sleep(500);
        break;
      }
    }

    // 2. Điền thẻ đợt 1 + đợt 2 (kết hợp Background allFrames Scripting + postMessage)
    fillCreditCardFieldsOnTopAndSameOrigin(card, card.holderName);
    await safeSendMessage({
      action: 'FILL_PCI_CARD_FRAMES',
      card: { ...card },
      payload: { card: { ...card } }
    });
    await sleep(900);

    fillCreditCardFieldsOnTopAndSameOrigin(card, card.holderName);
    await safeSendMessage({
      action: 'FILL_PCI_CARD_FRAMES',
      card: { ...card },
      payload: { card: { ...card } }
    });
    await sleep(1100);

    // 3. Chờ spinner tính phí vận chuyển Shopify kết thúc
    for (let waitShip = 0; waitShip < 8; waitShip++) {
      const isCalculating = !!document.querySelector('.loading-spinner, [data-shipping-methods-loading], button#checkout-pay-button[disabled], [aria-busy="true"]');
      if (!isCalculating) break;
      await sleep(500);
    }

    // 4. Tìm và bấm nút thanh toán ("Pay now" / "Complete Purchase")
    let payBtn = document.querySelector('button#checkout-pay-button, form[action*="/checkouts"] button[type="submit"], button[type="submit"]');
    if (!payBtn) {
      const allBtns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      payBtn = allBtns.find(b => {
        const t = norm(b.innerText || b.value || '');
        return t.includes('pay now') || t.includes('complete purchase') || t.includes('place order') || t.includes('hoàn tất');
      });
    }

    if (payBtn && isVisible(payBtn)) {
      payBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(600);
      reportProgress(5, '⚡ Đang bấm "Pay now / Complete Purchase" bằng Thẻ (kích hoạt Pixel AddPaymentInfo)...');
      safeElementClick(payBtn);
    }

    // 5. Chờ 2.2 giây kiểm tra xem có phát sinh Captcha không (nếu có thì 2Captcha sẽ giải)
    await sleep(2200);

    // 6. BẮT BUỘC ĐẾM NGƯỢC ĐÚNG 10 GIÂY SAU KHI BẤM THANH TOÁN THẺ
    for (let s = 10; s >= 1; s--) {
      reportProgress(5, `⏳ Đã bấm thanh toán Thẻ! Chờ Pixel đọc sự kiện (${s}s)...`, { countdown: s });
      await sleep(1000);
    }
  }

  // ── BƯỚC 6: CHUYỂN SANG CỔNG PAYPAL (BƯỚC 2/2) — CHỜ 10 GIÂY ───────
  async function simulatePayPalGatewayAndCount10s() {
    reportProgress(6, '👉 Bước 2/2: Đang chuyển sang cổng PayPal & bật Popup PayPal...');
    await sleep(600);

    let paypalSelected = false;

    // A. Tìm radio option PayPal trong danh sách phương thức thanh toán
    const paypalRadios = document.querySelectorAll('input#basic-PAYPAL_EXPRESS, input[type="radio"][value*="paypal" i], input[type="radio"][id*="paypal" i]');
    for (const r of paypalRadios) {
      if (isVisible(r) || isVisible(r.parentElement)) {
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);
        safeElementClick(r);
        paypalSelected = true;
        break;
      }
    }

    // B. Quét tất cả radio nếu tên PayPal nằm trong label bọc ngoài (loại trừ Shop Pay)
    if (!paypalSelected) {
      const allRadios = document.querySelectorAll('input[type="radio"]');
      for (const r of allRadios) {
        const container = r.closest('label') || r.parentElement?.parentElement;
        const txt = norm((container?.innerText || '') + ' ' + (r.value || '') + ' ' + (r.id || ''));
        if (txt.includes('paypal') && !txt.includes('shop pay')) {
          r.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(400);
          safeElementClick(r);
          paypalSelected = true;
          break;
        }
      }
    }

    // C. Tìm label hoặc khối chọn PayPal
    if (!paypalSelected) {
      const labels = document.querySelectorAll('label, div[role="radio"], div[role="button"]');
      for (const l of labels) {
        if (!isVisible(l)) continue;
        const txt = norm(l.innerText || l.getAttribute('aria-label') || '');
        if (txt.includes('paypal') && !txt.includes('shop pay')) {
          l.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(400);
          safeElementClick(l);
          paypalSelected = true;
          break;
        }
      }
    }

    // Chờ 1.8 giây để Iframe nút ví PayPal tải hoàn tất
    await sleep(1800);

    // Tìm Iframe chứa nút ví PayPal (iframe#PAY_WITH_PAYPAL-iframe)
    const paypalWalletIframe =
      document.querySelector('iframe#PAY_WITH_PAYPAL-iframe, iframe[id*="PAY_WITH_PAYPAL" i], iframe[src*="wallet=PAY_WITH_PAYPAL" i]') ||
      document.querySelector('iframe#PAYPAL_EXPRESS-iframe, iframe[id*="PAYPAL" i], iframe[src*="paypal" i], iframe[title*="PayPal" i]');

    if (paypalWalletIframe && isVisible(paypalWalletIframe)) {
      document.documentElement.style.scrollBehavior = 'auto';
      document.body.style.scrollBehavior = 'auto';
      paypalWalletIframe.scrollIntoView({ behavior: 'instant', block: 'center' });
      await sleep(700);

      let rect = paypalWalletIframe.getBoundingClientRect();
      if (rect.top < 20 || rect.bottom > window.innerHeight - 20) {
        window.scrollBy(0, rect.top - Math.round(window.innerHeight / 2));
        await sleep(300);
        rect = paypalWalletIframe.getBoundingClientRect();
      }

      // Gửi tín hiệu postMessage vào trong Iframe
      try {
        paypalWalletIframe.contentWindow?.postMessage({ action: 'ULTIMATE_CLICK_PAYPAL_WALLET' }, '*');
      } catch (e) {}

      // Tính tọa độ tâm Iframe và gọi Background thực thi Trusted Click (chrome.debugger userGesture: true) để mở popup PayPal thật!
      const clickX = Math.round(rect.left + rect.width / 2);
      const clickY = Math.round(rect.top + rect.height / 2);

      reportProgress(6, `🪟 Đang bấm nút Pay with PayPal (Trusted Click tại ${clickX}, ${clickY} mở popup)...`);
      await safeSendMessage({
        action: 'TRIGGER_TRUSTED_PAYPAL_CLICK',
        payload: {
          x: clickX,
          y: clickY
        }
      });
    } else {
      // Trường hợp nút checkout redirect thông thường
      const subPaypalBtns = document.querySelectorAll('button#checkout-pay-button, button[id*="paypal" i], button.paypal-button, button[type="submit"]');
      for (const b of subPaypalBtns) {
        if (!isVisible(b)) continue;
        const t = norm(b.innerText || b.textContent || b.getAttribute('aria-label') || '');
        if (t.includes('paypal') || t.includes('complete') || t.includes('pay now') || b.id === 'checkout-pay-button') {
          b.scrollIntoView({ behavior: 'instant', block: 'center' });
          await sleep(400);
          safeElementClick(b);
          const rect = b.getBoundingClientRect();
          await safeSendMessage({
            action: 'TRIGGER_TRUSTED_PAYPAL_CLICK',
            payload: {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2)
            }
          });
          break;
        }
      }
    }

    // BẮT BUỘC ĐẾM NGƯỢC 10 GIÂY SAU KHI BẬT POPUP PAYPAL (Không giải Captcha của PayPal)
    for (let s = 10; s >= 1; s--) {
      reportProgress(6, `👉 Đã bật cửa sổ PayPal! Giữ trang ${s}s ghi nhận ý định mua hàng cao nhất...`, { countdown: s });
      await sleep(1000);
    }
  }

  // ── BƯỚC 7: HOÀN TẤT & ĐÓNG TAB AN TOÀN ───────────────────────────
  function finalizeAndCloseStoreTab() {
    reportProgress(7, 'Hoàn tất trọn vẹn chu trình Thẻ (10s) & PayPal (10s)! Đang đóng tab an toàn...');
    safeSendMessage({
      action: 'STORE_FLOW_COMPLETED',
      payload: {
        url: location.href,
        completedAt: Date.now()
      }
    });
  }

  // ── ĐIỀU PHỐI TOÀN BỘ CHU TRÌNH 7 BƯỚC TUẦN TỰ ────────────────────
  async function runMasterStoreFlow() {
    try {
      // B1: Nhận diện Platform
      detectStorePlatform();
      await sleep(800);

      // Nếu đang ở trang sản phẩm: chạy B2 & B3 rồi đợi chuyển trang
      if (!location.pathname.includes('/checkout')) {
        await simulateBrowseAndPickVariant();
        await addToCartAndInitiateCheckout();
        return; // Đợi trang điều hướng sang /checkout
      }

      // Nếu đang ở trang Checkout: chạy B4, B5, B6, B7
      await fillUSCustomerShippingInfo();
      await sleep(1200);

      await simulateCreditCardPaymentAndCount10s();
      await sleep(1000);

      await simulatePayPalGatewayAndCount10s();
      await sleep(1000);

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
