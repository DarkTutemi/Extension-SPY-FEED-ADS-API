/**
 * ai_helper.js
 * =========================================================================
 * Module Quản Lý AI & Giải Mã Tự Động:
 * 1. Gemini Vision Pool (5 Keys Round-Robin & Tự Động Chuyển Khi Gặp 429)
 * 2. DeepSeek Chat (Ánh Xạ Form Checkout Kỳ Dị & Phân Tích Cấu Trúc DOM)
 * 3. 2Captcha Client (Tự Động Giải hCaptcha / reCAPTCHA / Turnstile)
 */

class AIHelper {
  constructor(options = {}) {
    this.geminiKeys = options.geminiKeys || [];
    this.currentGeminiKeyIndex = 0;
    this.deepseekKey = options.deepseekKey || '';
    this.twoCaptchaKey = options.twoCaptchaKey || '';
  }

  // Cập nhật cấu hình keys từ Storage
  updateConfig(config = {}) {
    if (config.geminiKeys && Array.isArray(config.geminiKeys) && config.geminiKeys.length > 0) {
      this.geminiKeys = config.geminiKeys;
    }
    if (config.deepseekKey) this.deepseekKey = config.deepseekKey;
    if (config.twoCaptchaKey) this.twoCaptchaKey = config.twoCaptchaKey;
  }

  // ── 1. GEMINI VISION POOL (Round-Robin & Auto-Failover) ───────────
  getNextGeminiKey() {
    if (!this.geminiKeys || this.geminiKeys.length === 0) return null;
    const key = this.geminiKeys[this.currentGeminiKeyIndex];
    this.currentGeminiKeyIndex = (this.currentGeminiKeyIndex + 1) % this.geminiKeys.length;
    return key;
  }

  async analyzeImageWithGemini(base64Image, promptText) {
    if (!this.geminiKeys || this.geminiKeys.length === 0) {
      throw new Error('Chưa cấu hình API Key nào cho Gemini Vision Pool.');
    }

    let lastError = null;
    const maxRetries = Math.min(this.geminiKeys.length, 5);

    for (let i = 0; i < maxRetries; i++) {
      const activeKey = this.getNextGeminiKey();
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(activeKey)}`;
        const body = {
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Image.replace(/^data:image\/\w+;base64,/, '')
                  }
                }
              ]
            }
          ]
        };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (res.status === 429) {
          console.warn(`[Gemini Pool] Key kết thúc bằng ...${activeKey.slice(-6)} bị giới hạn 429. Đang chuyển sang key tiếp theo...`);
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gemini API Error ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return candidate || '';
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini Pool] Lỗi khi gọi key ...${activeKey.slice(-6)}:`, err.message);
      }
    }

    throw new Error(`Toàn bộ key trong Gemini Pool đều không khả dụng: ${lastError?.message}`);
  }

  // ── 2. DEEPSEEK CHAT API (Ánh Xạ Form Checkout Lạ & Phân Tích DOM) ──
  async mapCheckoutFieldsWithDeepSeek(htmlSnippet) {
    if (!this.deepseekKey) {
      throw new Error('Chưa cấu hình DeepSeek API Key.');
    }

    const systemPrompt = `Bạn là chuyên gia tự động hóa DOM e-commerce. Hãy phân tích đoạn HTML form thanh toán dưới đây và ánh xạ chính xác CSS Selector của các trường dữ liệu cần điền.
Trả về DUY NHẤT một chuỗi JSON hợp lệ không có markdown backtick, dạng:
{
  "email": "CSS_SELECTOR",
  "first_name": "CSS_SELECTOR",
  "last_name": "CSS_SELECTOR",
  "address": "CSS_SELECTOR",
  "city": "CSS_SELECTOR",
  "state": "CSS_SELECTOR",
  "zip": "CSS_SELECTOR",
  "phone": "CSS_SELECTOR",
  "submit_button": "CSS_SELECTOR"
}`;

    const endpoint = 'https://api.deepseek.com/v1/chat/completions';
    const body = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Đoạn HTML Form Checkout:\n${htmlSnippet.slice(0, 10000)}` }
      ],
      temperature: 0.1
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deepseekKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DeepSeek API Error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    try {
      const cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (e) {
      console.warn('[DeepSeek] Phản hồi không phải JSON chuẩn:', rawContent);
      return {};
    }
  }

  // ── 3. 2CAPTCHA API (Giải Tự Động Checkpoint hCaptcha / reCAPTCHA) ──
  async solveCaptcha({ type = 'hcaptcha', sitekey, pageurl }) {
    if (!this.twoCaptchaKey) {
      throw new Error('Chưa cấu hình 2Captcha API Key.');
    }

    console.log(`[2Captcha] Đang gửi yêu cầu giải ${type} cho trang ${pageurl}...`);
    
    // Gửi task
    const method = type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha';
    const inUrl = `https://2captcha.com/in.php?key=${encodeURIComponent(this.twoCaptchaKey)}&method=${method}&sitekey=${encodeURIComponent(sitekey)}&pageurl=${encodeURIComponent(pageurl)}&json=1`;
    
    const inRes = await fetch(inUrl);
    const inData = await inRes.json();
    if (inData.status !== 1) {
      throw new Error(`2Captcha Submit Error: ${inData.request}`);
    }

    const requestId = inData.request;
    console.log(`[2Captcha] Task đã tạo với ID: ${requestId}. Đang chờ kết quả...`);

    // Poll kết quả mỗi 5s (tối đa 90s)
    for (let attempts = 0; attempts < 18; attempts++) {
      await new Promise(r => setTimeout(r, 5000));
      const resUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(this.twoCaptchaKey)}&action=get&id=${requestId}&json=1`;
      const resRes = await fetch(resUrl);
      const resData = await resRes.json();

      if (resData.status === 1) {
        console.log('[2Captcha] Giải Captcha thành công!');
        return resData.request; // Token giải mã
      }

      if (resData.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha Solve Failed: ${resData.request}`);
      }
    }

    throw new Error('2Captcha Timeout sau 90 giây.');
  }
}

// Xuất global cho Extension background và content scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AIHelper;
} else if (typeof window !== 'undefined') {
  window.AIHelper = AIHelper;
}
