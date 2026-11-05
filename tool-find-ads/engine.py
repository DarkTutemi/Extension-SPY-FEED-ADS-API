#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
engine.py - Core Facebook Ads Library & Inote.net Engine for tool-find-ads.

Implements 100% of the features from the Extension's "Find Ads" tab:
1. Full Ad Search & Cursor Pagination (SSR HTML AST + GraphQL Refetch Query).
2. Automatic Facebook /__rd_verify challenge solver (works even without cookies/login!).
3. Optional Facebook Cookie (c_user/xs) or GPM Login Profile integration for deep GraphQL pagination.
4. Minea Analytics Counter (Active Camp vs Total Camp & Ratio %).
5. Inote.net Batch Keyword Queue (sequential full-ad harvesting from inote.net links).
6. Page Hunter Turbo Mode (multi-threaded worker pool, zero-miss retry & smart fallback,
   O(1) page_name deduplication, and automatic export to a new inote.net link).
7. All 4 Inote & Copy export formats: Full 8 fields, Only Content, Only Links, Only Page Name.
"""

import base64
import concurrent.futures
import datetime
import html as html_lib
import json
import math
import random
import re
import threading
import time
import urllib.parse
import uuid
import webbrowser
import sys
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ============================================================================
# 1. INOTE.NET SERVICE
# ============================================================================

class InoteService:
    """Handles parsing, fetching keyword lists, formatting ads, and creating notes on https://inote.net/."""

    INOTE_REGEX = re.compile(r"^(?:https?://)?(?:www\.)?inote\.net/([a-zA-Z0-9_\-]+)/?$", re.IGNORECASE)

    @staticmethod
    def parse_inote_url(raw_input: Optional[str]) -> Optional[str]:
        if not raw_input or not isinstance(raw_input, str):
            return None
        cleaned = re.sub(r'^["“\']+|["”\']+$', "", raw_input.strip()).strip()
        match = InoteService.INOTE_REGEX.match(cleaned)
        if match:
            return f"https://inote.net/{match.group(1)}"
        return None

    @staticmethod
    def fetch_keywords_from_note(inote_url: str, timeout: int = 20) -> List[str]:
        valid_url = InoteService.parse_inote_url(inote_url)
        if not valid_url:
            raise ValueError(f"URL inote.net không hợp lệ: {inote_url}")

        resp = requests.get(
            valid_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Cache-Control": "no-cache",
            },
            timeout=timeout,
        )
        resp.raise_for_status()

        textarea_match = re.search(r"<textarea[^>]*>([\s\S]*?)</textarea>", resp.text, re.IGNORECASE)
        raw_content = textarea_match.group(1) if textarea_match else ""
        decoded = html_lib.unescape(raw_content)

        keywords = [line.strip() for line in decoded.splitlines() if line.strip()]
        return keywords

    @staticmethod
    def format_ad(ad: Dict[str, Any], index: int = 0) -> str:
        idx = index + 1
        title = ad.get("page_name") or "Quảng cáo"
        archive_id = ad.get("archive_id") or "N/A"
        page_id = ad.get("page_id") or "N/A"
        page_name = ad.get("page_name") or "N/A"
        is_active = bool(ad.get("is_active", True))
        is_active_text = "Đang chạy (is_active: true)" if is_active else "Đã dừng (is_active: false)"
        platforms = ad.get("platforms") or "Facebook"
        creative_format = ad.get("creative_format") or "Hình ảnh"
        caption_text = str(ad.get("caption_text") or "").replace("\r\n", "\n").strip()
        cta_text = ad.get("cta_text") or "Shop now"
        link_url = ad.get("link_url") or ""

        return (
            f"Mẫu {idx}: {title}\n"
            f"Archive ID: {archive_id}\n"
            f"Page ID: {page_id} ({page_name})\n"
            f"Trạng thái: {is_active_text}\n"
            f"Nền tảng: {platforms}\n"
            f"Định dạng creative: {creative_format}\n"
            f'Nội dung bài viết: "{caption_text}"\n'
            f"Kêu gọi hành động (CTA): {cta_text}\n"
            f"Đường dẫn đích: {link_url}"
        )

    @staticmethod
    def format_all_ads(ads_list: List[Dict[str, Any]], format_mode: str = "full") -> str:
        if not ads_list:
            return ""

        if format_mode in ("page_name", "ONLY_PAGE_NAME"):
            seen = set()
            unique_pages = []
            for ad in ads_list:
                name = str(ad.get("page_name") or ad.get("pageName") or "").strip()
                key = name.lower()
                if name and key not in seen:
                    seen.add(key)
                    unique_pages.append(name)
            return "\n".join(unique_pages)

        if format_mode in ("content", "ONLY_CONTENT"):
            captions = [
                str(ad.get("caption_text") or ad.get("caption") or "").strip()
                for ad in ads_list
            ]
            return "\n\n".join([c for c in captions if c])

        if format_mode in ("links", "ONLY_LINKS"):
            links = [str(ad.get("link_url") or "").strip() for ad in ads_list]
            return "\n".join([l for l in links if l])

        return "\n\n".join(InoteService.format_ad(ad, idx) for idx, ad in enumerate(ads_list))

    @staticmethod
    def create_note(text_content: str, open_browser: bool = False, timeout: int = 25) -> Dict[str, Any]:
        if not text_content or not text_content.strip():
            raise ValueError("Nội dung lưu lên inote.net đang trống.")

        session = requests.Session()
        session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                )
            }
        )

        # Step 1: Allocate new note URL via redirect
        get_resp = session.get("https://inote.net/", allow_redirects=True, timeout=timeout)
        final_url = get_resp.url or ""
        note_id = None

        m = re.search(r"inote\.net/([a-zA-Z0-9_\-]+)", final_url)
        if m:
            note_id = m.group(1)
        else:
            html_m = (
                re.search(r'action="/([a-zA-Z0-9_\-]+)"', get_resp.text)
                or re.search(r'window\.location\.href\s*=\s*["\']/([a-zA-Z0-9_\-]+)["\']', get_resp.text)
                or re.search(r"inote\.net/([a-zA-Z0-9_\-]{6,20})", get_resp.text)
            )
            if html_m:
                note_id = html_m.group(1)

        if not note_id:
            raise RuntimeError("Không thể cấp phát ID note mới từ https://inote.net/.")

        note_url = f"https://inote.net/{note_id}"

        # Step 2: Persist content to note_url
        post_resp = session.post(
            note_url,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Origin": "https://inote.net",
                "Referer": note_url,
            },
            data={"text": text_content},
            timeout=timeout,
        )
        post_resp.raise_for_status()

        if open_browser:
            try:
                webbrowser.open(note_url)
            except Exception:
                pass

        return {"success": True, "noteId": note_id, "noteUrl": note_url}


# ============================================================================
# 2. FACEBOOK ADS LIBRARY ENGINE (SSR + GraphQL + Page Hunter)
# ============================================================================

class FacebookAdsHunterEngine:
    """
    Standalone Python engine implementing:
    - SSR HTML AST Search + Automatic /__rd_verify Challenge Bypass (works with 0 login/cookies!)
    - Authenticated GraphQL Cursor Pagination (when Facebook Cookie or GPM Login is provided)
    - Minea Active vs Total Camp & Ratio % Counter
    - Inote Batch Keyword Queue
    - Multi-threaded Page Hunter Turbo Mode (zero-miss, O(1) dedup, auto-export to Inote)
    """

    DOC_ID_REFETCH = "26617181747964058"
    FRIENDLY_NAME_REFETCH = "AdLibraryMobileFocusedStateProviderRefetchQuery"
    DOC_ID_PAGINATION = "25464068859919530"
    FRIENDLY_NAME_PAGINATION = "AdLibrarySearchPaginationQuery"

    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )

    def __init__(
        self,
        cookie_string: str = "",
        log_callback: Optional[Callable[[str, str], None]] = None,
    ):
        self.cookie_string = cookie_string.strip()
        self.log_callback = log_callback
        self.cancel_requested = False
        self.is_running = False
        self._lock = threading.Lock()
        self.cached_dtsg = ""
        self.cached_lsd = ""
        self.cached_user_id = "0"
        self.cached_rev = "1052866173"
        self.session = self._create_worker_session()

    def log(self, message: str, level: str = "INFO") -> None:
        """Emits a log message with level to callback and stdout."""
        if self.log_callback:
            try:
                self.log_callback(message, level)
            except Exception:
                pass
        else:
            now_str = datetime.datetime.now().strftime("%H:%M:%S")
            print(f"[{now_str}] [{level.upper()}] {message}")

    def _create_worker_session(self) -> requests.Session:
        s = requests.Session()
        s.headers.update(
            {
                "User-Agent": self.USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
            }
        )
        if self.cookie_string:
            self._apply_cookie_string_to_session(s, self.cookie_string)
        return s

    def set_cookie_string(self, cookie_string: str) -> None:
        self.cookie_string = (cookie_string or "").strip()
        self.session = self._create_worker_session()
        self.cached_dtsg = ""
        self.cached_lsd = ""

    def _apply_cookie_string_to_session(self, session: requests.Session, raw_cookie: str) -> None:
        for part in raw_cookie.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k:
                    session.cookies.set(k, v, domain=".facebook.com")
                    if k == "c_user" and v != "0":
                        self.cached_user_id = v

    def cancel(self) -> None:
        self.cancel_requested = True
        self.is_running = False

    # ── Number Formatting & Minea Smart Rounding ─────────────────────

    @staticmethod
    def smart_round(num: int) -> int:
        n = int(num or 0)
        if n < 100:
            return n
        if n >= 10000:
            return int(round(n / 1000.0) * 1000)
        if n >= 1000:
            return int(round(n / 100.0) * 100)
        return int(round(n / 10.0) * 10)

    @staticmethod
    def format_number_no_decimals(num: int) -> str:
        return f"{int(num or 0):,}"

    @staticmethod
    def format_number_compact(num: int) -> str:
        n = float(num or 0)
        if n >= 1e6:
            return f"{n / 1e6:.1f}".rstrip("0").rstrip(".") + "M"
        if n >= 1e3:
            return f"{n / 1e3:.1f}".rstrip("0").rstrip(".") + "k"
        return str(int(n))

    # ── URL & GraphQL Variables Builders ─────────────────────────────

    @staticmethod
    def resolve_start_date(start_date_param: Optional[str]) -> Optional[str]:
        if not start_date_param:
            return None
        val = str(start_date_param).strip()
        if not val or val.upper() in ("ALL", "NULL", "NONE"):
            return None
        if val.isdigit() and int(val) <= 60:
            months = int(val)
            today = datetime.date.today()
            year = today.year
            month = today.month - months
            while month <= 0:
                month += 12
                year -= 1
            day = min(today.day, 28)
            return f"{year:04d}-{month:02d}-{day:02d}"
        return val

    def build_ads_library_search_url(self, params: Dict[str, Any], override_active_status: Optional[str] = None) -> str:
        raw_kw = str(params.get("keyword") or params.get("rawKeyword") or "").strip()
        has_quotes = bool(re.match(r'^["“\'].*["”\']$', raw_kw))
        is_exact = bool(params.get("isExactPhrase")) or has_quotes
        clean_kw = re.sub(r'^["“\']+|["”\']+$', "", raw_kw).strip()

        if is_exact:
            query_q = f'"{clean_kw}"'
            search_type = "keyword_exact_phrase"
        else:
            query_q = clean_kw
            search_type = "keyword_unordered"

        country = str(params.get("country") or "US").upper()
        active_status = str(override_active_status or params.get("activeStatus") or "ACTIVE").lower()
        media_type = str(params.get("mediaType") or "ALL").lower()
        ad_type = str(params.get("category") or "ALL").lower()
        view_all_page_id = str(params.get("viewAllPageId") or "").strip()

        if view_all_page_id and view_all_page_id.isdigit():
            query_dict: List[Tuple[str, str]] = [
                ("active_status", active_status),
                ("ad_type", ad_type),
                ("country", country),
                ("is_targeted_country", "false"),
                ("media_type", media_type),
                ("search_type", "page"),
                ("view_all_page_id", view_all_page_id),
            ]
        else:
            query_dict = [
                ("active_status", active_status),
                ("ad_type", ad_type),
                ("country", country),
                ("is_targeted_country", "false"),
                ("media_type", media_type),
                ("q", query_q),
                ("search_type", search_type),
            ]

        # Sort mode
        sort_mode = str(params.get("sortMode") or params.get("sortBy") or "TOTAL_IMPRESSIONS_DESC").upper()
        if "RELEVANCY" not in sort_mode:
            query_dict.append(("sort_data[mode]", "total_impressions"))
            query_dict.append(("sort_data[direction]", "desc"))

        # Start date
        resolved_date = self.resolve_start_date(params.get("startDate"))
        if resolved_date:
            query_dict.append(("start_date[min]", resolved_date))
            query_dict.append(("start_date[max]", ""))

        # Content language
        lang = str(params.get("language") or "ALL").strip()
        if lang and lang.upper() != "ALL":
            query_dict.append(("content_languages[0]", lang.lower()))

        # Publisher platforms
        platforms = params.get("publisherPlatforms")
        if isinstance(platforms, list) and 0 < len(platforms) < 6:
            for idx, p_name in enumerate(platforms):
                query_dict.append((f"publisher_platforms[{idx}]", str(p_name).lower()))

        qs = urllib.parse.urlencode(query_dict)
        return f"https://www.facebook.com/ads/library/?{qs}"

    def build_graphql_variables(self, params: Dict[str, Any], cursor: Optional[str] = None) -> Dict[str, Any]:
        raw_kw = str(params.get("keyword") or params.get("rawKeyword") or "").strip()
        has_quotes = bool(re.match(r'^["“\'].*["”\']$', raw_kw))
        is_exact = bool(params.get("isExactPhrase")) or has_quotes
        clean_kw = re.sub(r'^["“\']+|["”\']+$', "", raw_kw).strip()

        if is_exact:
            query_str = f'"{clean_kw}"'
            search_type = "KEYWORD_EXACT_PHRASE"
        else:
            query_str = clean_kw
            search_type = "KEYWORD_UNORDERED"

        country = str(params.get("country") or "US").upper()
        media_type = str(params.get("mediaType") or "ALL").upper()
        active_status = str(params.get("activeStatus") or "ACTIVE").upper()
        lang = str(params.get("language") or "ALL").strip()
        content_languages = [] if not lang or lang.upper() == "ALL" else [lang.lower()]

        platforms = params.get("publisherPlatforms")
        if not isinstance(platforms, list) or len(platforms) == 6:
            publisher_platforms: List[str] = []
        else:
            publisher_platforms = [str(p).upper() for p in platforms]

        sort_mode = str(params.get("sortMode") or params.get("sortBy") or "TOTAL_IMPRESSIONS_DESC").upper()
        if "RELEVANCY" in sort_mode:
            sort_data = {"mode": "SORT_BY_RELEVANCY_MONTHLY_GROUPED", "direction": "DESCENDING"}
        else:
            sort_data = {"mode": "SORT_BY_TOTAL_IMPRESSIONS", "direction": "DESCENDING"}

        resolved_date = self.resolve_start_date(params.get("startDate"))
        start_date_obj = {"min": resolved_date, "max": None} if resolved_date else None

        variables: Dict[str, Any] = {
            "activeStatus": active_status,
            "adType": str(params.get("category") or "ALL").upper(),
            "audienceTimeframe": "LAST_7_DAYS",
            "bylines": [],
            "collationToken": params.get("collationToken") or str(uuid.uuid4()),
            "contentLanguages": content_languages,
            "countries": [country],
            "country": country,
            "deeplinkAdID": None,
            "excludedIDs": [],
            "fetchPageInfo": False,
            "fetchSharedDisclaimers": False,
            "hasDeeplinkAdID": False,
            "isAboutTab": False,
            "isAudienceTab": False,
            "isLandingPage": False,
            "isTargetedCountry": False,
            "location": None,
            "mediaType": media_type,
            "multiCountryFilterMode": None,
            "pageIDs": [],
            "potentialReachInput": [],
            "publisherPlatforms": publisher_platforms,
            "queryString": query_str,
            "regions": [],
            "searchType": search_type,
            "sessionID": params.get("sessionID") or str(uuid.uuid4()),
            "sortData": sort_data,
            "source": "PAGE_TRANSPARENCY_WIDGET",
            "startDate": start_date_obj,
            "v": "63cade",
            "viewAllPageID": "0",
        }

        if cursor:
            variables["cursor"] = cursor
            variables["forward_cursor"] = cursor

        return variables

    # ── SSR HTML Fetch with Automatic /__rd_verify Bypass ────────────

    def fetch_html_with_challenge_bypass(
        self, url: str, session: Optional[requests.Session] = None, timeout: int = 25
    ) -> str:
        sess = session or self.session
        resp = sess.get(url, timeout=timeout)

        # Check for Facebook's lightweight JS challenge (/ __rd_verify_...)
        if resp.status_code == 403 or "__rd_verify_" in resp.text:
            m = re.search(r"fetch\(['\"](/__rd_verify_[^'\"]+)['\"]", resp.text)
            if m:
                verify_url = "https://www.facebook.com" + m.group(1)
                sess.post(
                    verify_url,
                    headers={
                        "Origin": "https://www.facebook.com",
                        "Referer": url,
                        "User-Agent": self.USER_AGENT,
                    },
                    timeout=timeout,
                )
                resp = sess.get(url, timeout=timeout)

        # Harvest tokens if present in HTML
        html_text = resp.text or ""
        dtsg_m = (
            re.search(r'"DTSGInitialData",\[\],\{"token":"([^"]+)"\}', html_text)
            or re.search(r'\["DTSGInitData",\[\],\{"token":"([^"]+)"\}', html_text)
            or re.search(r'"token":"([A-Za-z0-9_-]+:\d+:\d+)"', html_text)
        )
        if dtsg_m:
            self.cached_dtsg = dtsg_m.group(1)

        lsd_m = (
            re.search(r'"LSD",\[\],\{"token":"([^"]+)"\}', html_text)
            or re.search(r'name="lsd"\s+value="([^"]+)"', html_text)
        )
        if lsd_m:
            self.cached_lsd = lsd_m.group(1)

        rev_m = re.search(r'"__spin_r":(\d+)', html_text)
        if rev_m:
            self.cached_rev = rev_m.group(1)

        return html_text

    # ── AST & Relay Response Parsers ─────────────────────────────────

    @staticmethod
    def _find_search_connection_in_obj(obj: Any) -> Optional[Dict[str, Any]]:
        if isinstance(obj, dict):
            if "search_results_connection" in obj and isinstance(obj["search_results_connection"], dict):
                conn = obj["search_results_connection"]
                if "edges" in conn or "count" in conn:
                    return conn
            for v in obj.values():
                res = FacebookAdsHunterEngine._find_search_connection_in_obj(v)
                if res is not None:
                    return res
        elif isinstance(obj, list):
            for item in obj:
                res = FacebookAdsHunterEngine._find_search_connection_in_obj(item)
                if res is not None:
                    return res
        return None

    def extract_connection_from_ssr_html(self, html_text: str) -> Optional[Dict[str, Any]]:
        if not html_text:
            return None

        script_blocks = re.findall(
            r'<script[^>]*type="application/json"[^>]*>(.*?)</script>',
            html_text,
            re.DOTALL | re.IGNORECASE,
        )
        best_conn = None
        for block in script_blocks:
            if "search_results_connection" not in block:
                continue
            try:
                parsed = json.loads(block)
                conn = self._find_search_connection_in_obj(parsed)
                if conn:
                    if conn.get("edges"):
                        return conn
                    best_conn = conn
            except Exception:
                continue

        return best_conn

    def parse_relay_graphql_response(self, raw_text: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        if not raw_text:
            return None, "Empty response"

        cleaned = raw_text.strip()
        if cleaned.startswith("for (;;);"):
            cleaned = cleaned[9:].strip()

        error_msg = None
        for line in cleaned.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                chunk = json.loads(line)
                if chunk.get("error") or chunk.get("errorSummary") or chunk.get("errorDescription"):
                    error_msg = (
                        chunk.get("errorSummary")
                        or chunk.get("errorDescription")
                        or f"Facebook Error {chunk.get('error')}"
                    )
                if isinstance(chunk.get("errors"), list) and chunk["errors"]:
                    error_msg = "; ".join(str(e.get("message", "")) for e in chunk["errors"])

                conn = self._find_search_connection_in_obj(chunk.get("data"))
                if conn:
                    return conn, None
            except Exception:
                continue

        return None, error_msg

    # ── Ad Normalization (8 Mandatory Fields + efg Video Duration) ───

    @staticmethod
    def extract_video_duration(video_url: Optional[str]) -> Optional[int]:
        if not video_url or not isinstance(video_url, str):
            return None
        try:
            m = re.search(r"efg=([^&]+)", video_url)
            if not m:
                return None
            b64_str = urllib.parse.unquote(m.group(1))
            # Pad base64 if needed
            padding = len(b64_str) % 4
            if padding:
                b64_str += "=" * (4 - padding)
            decoded = base64.b64decode(b64_str).decode("utf-8", errors="ignore")
            parsed = json.loads(decoded)
            dur = parsed.get("duration_s")
            return int(dur) if isinstance(dur, (int, float)) else None
        except Exception:
            return None

    @staticmethod
    def extract_full_caption(snapshot: Dict[str, Any]) -> str:
        if not isinstance(snapshot, dict):
            return ""
        body = snapshot.get("body")
        if isinstance(body, dict) and isinstance(body.get("text"), str) and body["text"].strip():
            return body["text"].strip()

        cards = snapshot.get("cards")
        if isinstance(cards, list) and cards:
            card_texts = []
            for idx, card in enumerate(cards):
                if not isinstance(card, dict):
                    continue
                c_body = card.get("body")
                txt = (c_body.get("text") if isinstance(c_body, dict) else None) or card.get("title") or ""
                if txt:
                    card_texts.append(f"[Thẻ {idx + 1}] {txt}")
            if card_texts:
                return "\n".join(card_texts)

        extra = snapshot.get("extra_texts")
        if isinstance(extra, list) and extra:
            texts = [
                (item.get("text") if isinstance(item, dict) else str(item)).strip()
                for item in extra
                if item
            ]
            texts = [t for t in texts if t]
            if texts:
                return "\n".join(texts)

        if isinstance(snapshot.get("title"), str):
            return snapshot["title"].strip()

        return ""

    def normalize_ad_node(self, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None
        snap = item.get("snapshot") if isinstance(item.get("snapshot"), dict) else {}

        creative_format = "Hình ảnh"
        duration_seconds = None
        video_preview_url = None
        image_url = None
        video_hd_url = None

        videos = snap.get("videos") if isinstance(snap.get("videos"), list) else []
        cards = snap.get("cards") if isinstance(snap.get("cards"), list) else []
        images = snap.get("images") if isinstance(snap.get("images"), list) else []

        is_video = snap.get("display_format") == "VIDEO" or len(videos) > 0
        if is_video:
            vid = videos[0] if videos and isinstance(videos[0], dict) else {}
            video_hd_url = vid.get("video_hd_url") or vid.get("video_sd_url")
            video_preview_url = vid.get("video_preview_image_url")
            image_url = video_preview_url
            duration_seconds = self.extract_video_duration(video_hd_url)
            creative_format = f"Video ({duration_seconds} giây)" if duration_seconds else "Video HD"
        elif cards:
            creative_format = f"Carousel ({len(cards)} thẻ)"
            first_card = cards[0] if isinstance(cards[0], dict) else {}
            image_url = (
                first_card.get("original_image_url")
                or first_card.get("resized_image_url")
                or first_card.get("video_preview_image_url")
            )
        elif images:
            creative_format = "Hình ảnh"
            first_img = images[0] if isinstance(images[0], dict) else {}
            image_url = first_img.get("resized_image_url") or first_img.get("original_image_url")

        caption_text = self.extract_full_caption(snap)

        platform_map = {
            "FACEBOOK": "Facebook",
            "INSTAGRAM": "Instagram",
            "AUDIENCE_NETWORK": "Audience Network",
            "MESSENGER": "Messenger",
            "WHATSAPP": "WhatsApp",
            "THREADS": "Threads",
        }
        raw_platforms = item.get("publisher_platform") or ["FACEBOOK"]
        if isinstance(raw_platforms, list):
            platforms_str = ", ".join(platform_map.get(str(p).upper(), str(p)) for p in raw_platforms)
        else:
            platforms_str = str(raw_platforms)

        archive_id = str(item.get("ad_archive_id") or item.get("archive_id") or "").strip()
        page_id = str(item.get("page_id") or snap.get("page_id") or "").strip()
        page_name = str(item.get("page_name") or snap.get("page_name") or "Fanpage").strip()

        if not archive_id:
            archive_id = f"ad_{page_id}_{ abs(hash(page_name + caption_text[:30])) }"

        return {
            "archive_id": archive_id,
            "page_id": page_id,
            "page_name": page_name,
            "is_active": bool(item.get("is_active", True)),
            "platforms": platforms_str or "Facebook",
            "creative_format": creative_format,
            "duration_seconds": duration_seconds,
            "caption_text": caption_text,
            "cta_text": snap.get("cta_text") or "Shop now",
            "link_url": snap.get("link_url") or "",
            "image_url": image_url,
            "video_url": video_hd_url,
            "display_domain": snap.get("caption") or "",
            "start_date": item.get("start_date"),
        }

    @staticmethod
    def extract_page_entities_from_connection(
        connection: Optional[Dict[str, Any]], html_fallback: str = ""
    ) -> List[Dict[str, Any]]:
        extracted: List[Dict[str, Any]] = []
        if isinstance(connection, dict) and isinstance(connection.get("edges"), list):
            for edge in connection["edges"]:
                node = edge.get("node") if isinstance(edge, dict) else None
                if not isinstance(node, dict):
                    continue
                collated = node.get("collated_results")
                items = collated if isinstance(collated, list) and collated else [node]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    snap = item.get("snapshot") if isinstance(item.get("snapshot"), dict) else {}
                    raw_page_name = str(
                        item.get("page_name")
                        or snap.get("page_name")
                        or snap.get("current_page_name")
                        or node.get("page_name")
                        or ""
                    ).strip()
                    if not raw_page_name:
                        continue
                    page_id = str(
                        item.get("page_id") or snap.get("page_id") or node.get("page_id") or "N/A"
                    ).strip()
                    archive_id = str(
                        item.get("ad_archive_id")
                        or item.get("archive_id")
                        or f"ph_{page_id}_{raw_page_name}"
                    ).strip()
                    extracted.append(
                        {
                            "archive_id": archive_id,
                            "page_id": page_id,
                            "page_name": raw_page_name,
                            "is_active": bool(item.get("is_active", True)),
                        }
                    )

        # Fallback regex scan if SSR structure varied
        if not extracted and html_fallback and '"page_name":"' in html_fallback:
            matches = re.findall(
                r'"ad_archive_id":"(\d+)".*?"page_id":"(\d+)".*?"page_name":"([^"]+)"',
                html_fallback,
            )
            if matches:
                for arch_id, p_id, p_name_raw in matches:
                    try:
                        p_name = json.loads(f'"{p_name_raw}"').strip()
                    except Exception:
                        p_name = p_name_raw.strip()
                    if p_name:
                        extracted.append(
                            {
                                "archive_id": arch_id,
                                "page_id": p_id,
                                "page_name": p_name,
                                "is_active": True,
                            }
                        )
            else:
                raw_names = re.findall(r'"page_name":"([^"]+)"', html_fallback)
                for p_name_raw in raw_names:
                    try:
                        p_name = json.loads(f'"{p_name_raw}"').strip()
                    except Exception:
                        p_name = p_name_raw.strip()
                    if p_name:
                        extracted.append(
                            {
                                "archive_id": f"ph_{p_name.lower()}",
                                "page_id": "N/A",
                                "page_name": p_name,
                                "is_active": True,
                            }
                        )

        return extracted

    # ── Minea Analytics Counter (Active vs Total Camp & Ratio %) ─────

    def fetch_single_count_from_ssr(
        self, params: Dict[str, Any], status_override: str, session: Optional[requests.Session] = None
    ) -> int:
        sess = session or self._create_worker_session()
        url = self.build_ads_library_search_url(params, override_active_status=status_override)
        html_text = self.fetch_html_with_challenge_bypass(url, session=sess)
        conn = self.extract_connection_from_ssr_html(html_text)
        if conn and isinstance(conn.get("count"), int):
            return conn["count"]

        m = re.search(r'"search_results_connection":\{"count":(\d+)', html_text) or re.search(
            r"~?([\d,]+)\s+results", html_text, re.IGNORECASE
        )
        if m:
            return int(m.group(1).replace(",", ""))
        return 0

    def fetch_active_vs_total_counts(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            fut_active = pool.submit(self.fetch_single_count_from_ssr, params, "active")
            fut_total = pool.submit(self.fetch_single_count_from_ssr, params, "all")
            raw_active = fut_active.result()
            raw_total = max(raw_active, fut_total.result())

        smart_active = self.smart_round(raw_active)
        smart_total = self.smart_round(raw_total)
        ratio_percent = round((raw_active / raw_total) * 100.0, 1) if raw_total > 0 else 0.0

        return {
            "activeCount": raw_active,
            "totalCount": raw_total,
            "smartActive": smart_active,
            "smartTotal": smart_total,
            "formattedActive": f"~{self.format_number_no_decimals(smart_active)}",
            "formattedTotal": (
                f">{self.format_number_compact(smart_total)}"
                if raw_total > 50000
                else f"~{self.format_number_no_decimals(smart_total)}"
            ),
            "ratioPercent": min(100.0, ratio_percent),
        }

    # ── Single Keyword Search & Pagination (SSR Page 1 + GraphQL Next Pages) ──

    def _post_graphql_page(
        self,
        variables: Dict[str, Any],
        referer_url: str,
        session: requests.Session,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        user_id = self.cached_user_id or "0"
        data = {
            "av": user_id,
            "__user": user_id,
            "__a": "1",
            "__req": "f",
            "__hs": "20760.HYP:comet_plat_default_pkg.2.1...0",
            "dpr": "1",
            "__ccg": "GOOD",
            "__rev": self.cached_rev or "1052866173",
            "fb_api_caller_class": "RelayModern",
            "fb_api_req_friendly_name": self.FRIENDLY_NAME_REFETCH,
            "server_timestamps": "true",
            "doc_id": self.DOC_ID_REFETCH,
            "variables": json.dumps(variables),
        }
        if self.cached_dtsg:
            data["fb_dtsg"] = self.cached_dtsg
        if self.cached_lsd:
            data["lsd"] = self.cached_lsd

        resp = session.post(
            "https://www.facebook.com/api/graphql/",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "X-FB-Friendly-Name": self.FRIENDLY_NAME_REFETCH,
                "X-FB-LSD": self.cached_lsd or "",
                "X-ASBD-ID": "359341",
                "Origin": "https://www.facebook.com",
                "Referer": referer_url,
            },
            data=data,
            timeout=25,
        )
        if not resp.ok:
            return None, f"HTTP {resp.status_code}"
        return self.parse_relay_graphql_response(resp.text)

    def search_and_paginate_all(
        self,
        params: Dict[str, Any],
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
        max_batches: int = 25,
    ) -> List[Dict[str, Any]]:
        self.is_running = True
        self.cancel_requested = False

        ads_map: Dict[str, Dict[str, Any]] = {}
        session = self._create_worker_session()
        session_id = str(uuid.uuid4())
        collation_token = str(uuid.uuid4())

        search_url = self.build_ads_library_search_url(params)
        total_count = 0
        batch_index = 1

        if on_progress:
            on_progress(
                {
                    "status": "FETCHING_PAGE",
                    "currentPage": 1,
                    "totalFound": 0,
                    "extractedCount": 0,
                    "batchAds": [],
                    "statusMessage": "Đang tải trang kết quả đầu tiên từ Facebook Ads Library...",
                }
            )

        # Batch #1 via SSR HTML (100% immune to anonymous GraphQL rate-limit 1675004)
        html_text = self.fetch_html_with_challenge_bypass(search_url, session=session)
        connection = self.extract_connection_from_ssr_html(html_text)

        # Fallback if VIDEO filter returned 0 edges on SSR
        if (
            (not connection or not connection.get("edges"))
            and str(params.get("mediaType") or "ALL").upper() == "VIDEO"
        ):
            fallback_params = {**params, "mediaType": "ALL"}
            fallback_url = self.build_ads_library_search_url(fallback_params)
            html_text = self.fetch_html_with_challenge_bypass(fallback_url, session=session)
            connection = self.extract_connection_from_ssr_html(html_text)

        if not connection:
            if on_progress:
                on_progress(
                    {
                        "status": "COMPLETED",
                        "currentPage": 1,
                        "totalFound": 0,
                        "extractedCount": 0,
                        "batchAds": [],
                        "statusMessage": "Không tìm thấy kết quả phù hợp.",
                    }
                )
            return []

        if isinstance(connection.get("count"), int):
            total_count = connection["count"]

        def process_connection_edges(conn_obj: Dict[str, Any]) -> List[Dict[str, Any]]:
            new_ads: List[Dict[str, Any]] = []
            for edge in conn_obj.get("edges") or []:
                node = edge.get("node") if isinstance(edge, dict) else None
                if not isinstance(node, dict):
                    continue
                for item in node.get("collated_results") or []:
                    norm = self.normalize_ad_node(item)
                    if not norm:
                        continue
                    arch_id = norm["archive_id"]
                    if arch_id in ads_map:
                        continue
                    req_media = str(params.get("mediaType") or "ALL").upper()
                    if req_media == "VIDEO" and "video" not in norm["creative_format"].lower():
                        continue
                    if req_media == "IMAGE" and "hình ảnh" not in norm["creative_format"].lower():
                        continue
                    ads_map[arch_id] = norm
                    new_ads.append(norm)
            return new_ads

        first_batch = process_connection_edges(connection)
        if on_progress:
            on_progress(
                {
                    "status": "PROCESSING_ADS",
                    "currentPage": 1,
                    "totalFound": max(total_count, len(ads_map)),
                    "extractedCount": len(ads_map),
                    "batchAds": first_batch,
                    "statusMessage": f"Đã thu thập {len(ads_map)}/{max(total_count, len(ads_map))} ads (Batch #1)",
                }
            )

        page_info = connection.get("page_info") if isinstance(connection.get("page_info"), dict) else {}
        has_next_page = bool(page_info.get("has_next_page"))
        current_cursor = page_info.get("end_cursor")

        # Subsequent batches via GraphQL (works when authenticated cookie is set or when Meta allows pagination)
        while (
            has_next_page
            and current_cursor
            and not self.cancel_requested
            and batch_index < max_batches
            and (total_count == 0 or len(ads_map) < total_count)
        ):
            batch_index += 1
            time.sleep(random.uniform(0.35, 0.65))
            if self.cancel_requested:
                break

            vars_dict = self.build_graphql_variables(
                {**params, "sessionID": session_id, "collationToken": collation_token},
                cursor=current_cursor,
            )
            next_conn, err_msg = self._post_graphql_page(vars_dict, search_url, session)
            if not next_conn:
                # If unauthenticated GraphQL hits 1675004 rate limit, stop pagination gracefully with Page 1 results
                break

            batch_ads = process_connection_edges(next_conn)
            if on_progress:
                on_progress(
                    {
                        "status": "PROCESSING_ADS",
                        "currentPage": batch_index,
                        "totalFound": max(total_count, len(ads_map)),
                        "extractedCount": len(ads_map),
                        "batchAds": batch_ads,
                        "statusMessage": f"Đã thu thập {len(ads_map)}/{max(total_count, len(ads_map))} ads (Batch #{batch_index})",
                    }
                )

            p_info = next_conn.get("page_info") if isinstance(next_conn.get("page_info"), dict) else {}
            has_next_page = bool(p_info.get("has_next_page"))
            current_cursor = p_info.get("end_cursor")

        if on_progress:
            on_progress(
                {
                    "status": "COMPLETED",
                    "currentPage": batch_index,
                    "totalFound": max(total_count, len(ads_map)),
                    "extractedCount": len(ads_map),
                    "batchAds": [],
                    "statusMessage": f"Hoàn tất thu thập {len(ads_map)} quảng cáo.",
                }
            )

        self.is_running = False
        return list(ads_map.values())

    # ── Inote Batch Keyword Queue (Sequential Full Ads Search) ───────

    def search_inote_keyword_batch(
        self,
        inote_url: str,
        base_params: Dict[str, Any],
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> List[Dict[str, Any]]:
        self.is_running = True
        self.cancel_requested = False

        keywords = InoteService.fetch_keywords_from_note(inote_url)
        if not keywords:
            raise ValueError("Trang Inote không có dòng từ khóa nào hợp lệ.")

        global_ads_map: Dict[str, Dict[str, Any]] = {}
        accumulated_total = 0
        total_kw = len(keywords)

        for idx, raw_line in enumerate(keywords):
            if self.cancel_requested:
                break
            line_has_quotes = bool(re.match(r'^["“\'].*["”\']$', raw_line))
            use_exact = bool(base_params.get("isExactPhrase")) or line_has_quotes
            clean_line = re.sub(r'^["“\']+|["”\']+$', "", raw_line).strip()
            short_kw = clean_line[:32] + ("..." if len(clean_line) > 32 else "")

            step_params = {
                **base_params,
                "keyword": f'"{clean_line}"' if use_exact else clean_line,
                "rawKeyword": clean_line,
                "isExactPhrase": use_exact,
            }

            if on_progress:
                on_progress(
                    {
                        "status": "SEARCHING",
                        "currentPage": idx + 1,
                        "totalFound": max(accumulated_total, len(global_ads_map)),
                        "extractedCount": len(global_ads_map),
                        "batchAds": [],
                        "statusMessage": f'[Từ khóa {idx + 1}/{total_kw}] "{short_kw}" ({len(global_ads_map)} ads)',
                    }
                )

            try:
                step_ads = self.search_and_paginate_all(step_params, on_progress=None, max_batches=10)
                new_batch = []
                for ad in step_ads:
                    if ad["archive_id"] not in global_ads_map:
                        global_ads_map[ad["archive_id"]] = ad
                        new_batch.append(ad)
                accumulated_total += len(step_ads)

                if on_progress and new_batch:
                    on_progress(
                        {
                            "status": "PROCESSING_ADS",
                            "currentPage": idx + 1,
                            "totalFound": max(accumulated_total, len(global_ads_map)),
                            "extractedCount": len(global_ads_map),
                            "batchAds": new_batch,
                            "statusMessage": f'[Từ khóa {idx + 1}/{total_kw}] "{short_kw}" (+{len(new_batch)} -> {len(global_ads_map)} ads)',
                        }
                    )
            except Exception as e:
                print(f"[InoteBatch] Bỏ qua lỗi ở từ khóa #{idx + 1}: {e}")

            if idx < total_kw - 1 and not self.cancel_requested:
                time.sleep(0.25)

        if on_progress:
            on_progress(
                {
                    "status": "COMPLETED",
                    "currentPage": total_kw,
                    "totalFound": max(accumulated_total, len(global_ads_map)),
                    "extractedCount": len(global_ads_map),
                    "batchAds": [],
                    "statusMessage": f"Hoàn tất {total_kw}/{total_kw} từ khóa Inote ({len(global_ads_map)} ads)",
                }
            )

        self.is_running = False
        return list(global_ads_map.values())

    # ── Page Hunter Turbo Mode (Multi-threaded, Zero-Miss, Auto-Inote) ──

    def _harvest_pages_for_single_keyword(
        self,
        raw_keyword: str,
        base_params: Dict[str, Any],
        worker_session: requests.Session,
        inote_keyword_mode: str = "exact",
    ) -> List[Dict[str, Any]]:
        """
        Fetches 100% of matching Page entities for a single keyword line with:
        - Up to 3 automatic retries if network hiccups
        - Smart fallback (strips trailing punctuation & falls back to first 12 core words if long line returns 0)
        - STRICTLY binds and respects all user-configured filters (Country, Media Type, Platforms, Language, Date, Sort)
        - inote_keyword_mode: 'exact' (forces exact phrase "..."), 'unordered' (broad search), or 'inherit'
        """
        line_has_quotes = bool(re.match(r'^["“\'].*["”\']$', raw_keyword))
        clean_line = re.sub(r'^["“\']+|["”\']+$', "", raw_keyword).strip()
        clean_line_no_dot = re.sub(r"[.!?]+$", "", clean_line).strip()

        if inote_keyword_mode == "exact":
            use_exact = True
        elif inote_keyword_mode == "unordered":
            use_exact = line_has_quotes
        else:
            use_exact = bool(base_params.get("isExactPhrase")) or line_has_quotes

        # STRICTLY inherit all user filters from base_params (Country, Media Type, Platforms, Language, StartDate, Sort, Category)
        step_params = {
            **base_params,
            "keyword": f'"{clean_line_no_dot}"' if use_exact else clean_line_no_dot,
            "rawKeyword": clean_line_no_dot,
            "isExactPhrase": use_exact,
        }

        url = self.build_ads_library_search_url(step_params)
        entities: List[Dict[str, Any]] = []

        for attempt in range(1, 4):
            if self.cancel_requested:
                return []
            try:
                html_text = self.fetch_html_with_challenge_bypass(url, session=worker_session)
                conn = self.extract_connection_from_ssr_html(html_text)
                entities = self.extract_page_entities_from_connection(conn, html_fallback=html_text)
                if conn is not None or entities:
                    break
            except Exception:
                if attempt < 3:
                    time.sleep(0.4 * attempt)

        # Smart fallback: if 0 pages found and either Exact Phrase was used or sentence is very long (>14 words)
        if not entities and not self.cancel_requested:
            words = clean_line_no_dot.split()
            fallback_kw = " ".join(words[:12]) if len(words) > 14 else clean_line_no_dot
            if fallback_kw and (use_exact or fallback_kw != clean_line_no_dot):
                fb_params = {
                    **step_params,
                    "keyword": fallback_kw,
                    "rawKeyword": fallback_kw,
                    "isExactPhrase": False,
                }
                fb_url = self.build_ads_library_search_url(fb_params)
                try:
                    fb_html = self.fetch_html_with_challenge_bypass(fb_url, session=worker_session)
                    fb_conn = self.extract_connection_from_ssr_html(fb_html)
                    entities = self.extract_page_entities_from_connection(fb_conn, html_fallback=fb_html)
                except Exception:
                    pass

        return entities

    def _check_minea_for_page_record(
        self,
        page_rec: Dict[str, Any],
        base_params: Dict[str, Any],
        worker_session: requests.Session,
        lookup_mode: str = "exact_name",
    ) -> Dict[str, Any]:
        """
        Checks Active Camp vs Total Camp for a single harvested Page record.
        By default (lookup_mode == 'exact_name'), measures using Page name enclosed in quotes: `q="<page_name>"` with `isExactPhrase=True` (search_type=keyword_exact_phrase).
        Strictly inherits all user filters (Country, Media Type, Platforms, Language, Date) from base_params.
        Includes early-exit optimization: if Active Camp == 0, skips fetching Total Camp (ratio = 0.0%).
        """
        p_name = str(page_rec.get("page_name") or "").strip()
        clean_name = re.sub(r'^["“\']+|["”\']+$', "", p_name).strip()

        check_params = {
            **base_params,
            "keyword": f'"{clean_name}"',
            "rawKeyword": clean_name,
            "isExactPhrase": True,
        }
        check_params.pop("viewAllPageId", None)

        if lookup_mode == "page_id":
            p_id = str(page_rec.get("page_id") or "").strip()
            if p_id.isdigit():
                check_params["viewAllPageId"] = p_id
                check_params["keyword"] = clean_name
                check_params["isExactPhrase"] = False
        elif lookup_mode == "keyword":
            check_params["keyword"] = clean_name
            check_params["isExactPhrase"] = False
            check_params.pop("viewAllPageId", None)

        raw_active = 0
        raw_total = 0
        for attempt in range(1, 3):
            if self.cancel_requested:
                break
            try:
                raw_active = self.fetch_single_count_from_ssr(
                    check_params, "active", session=worker_session
                )
                break
            except Exception:
                if attempt < 2:
                    time.sleep(0.3)

        if raw_active > 0 and not self.cancel_requested:
            for attempt in range(1, 3):
                try:
                    raw_total = max(
                        raw_active,
                        self.fetch_single_count_from_ssr(
                            check_params, "all", session=worker_session
                        ),
                    )
                    break
                except Exception:
                    if attempt < 2:
                        time.sleep(0.3)

        ratio_pct = round((raw_active / raw_total) * 100.0, 1) if raw_total > 0 else 0.0
        smart_act = self.smart_round(raw_active)
        smart_tot = self.smart_round(raw_total)
        return {
            "activeCount": raw_active,
            "totalCount": raw_total,
            "formattedActive": f"~{self.format_number_no_decimals(smart_act)}",
            "formattedTotal": f"~{self.format_number_no_decimals(smart_tot)}",
            "ratioPercent": min(100.0, ratio_pct),
        }

    def run_page_hunter_batch(
        self,
        inote_url_or_keywords: str,
        base_params: Dict[str, Any],
        on_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
        concurrency: int = 5,
        auto_export_inote: bool = True,
        open_inote_tab: bool = True,
        filter_by_minea: bool = True,
        min_minea_ratio: float = 50.0,
        min_total_camp: int = 100,
        min_active_camp: int = 0,
        minea_lookup_mode: str = "exact_name",
        inote_keyword_mode: str = "exact",
    ) -> Dict[str, Any]:
        """
        Runs 2-Stage Page Hunter across all lines from an inote.net link (or multi-line input):
        - Stage 1: Harvests & deduplicates all unique Page names (O(1) case-insensitive) across all keywords.
        - Stage 2 (when filter_by_minea=True): Checks Active vs Total Camp (Minea Analytics) for each unique Page
          and keeps ONLY Pages where Ratio > min_minea_ratio (default > 50%).
        - Stage 3: Automatically exports the qualified Page names to a new https://inote.net/... link.
        """
        self.is_running = True
        self.cancel_requested = False

        valid_inote = InoteService.parse_inote_url(inote_url_or_keywords)
        if valid_inote:
            self.log(f"Đang tải danh sách từ khóa từ {valid_inote}...", "STAGE1")
            if on_progress:
                on_progress(
                    {
                        "status": "SEARCHING",
                        "currentPage": 0,
                        "totalFound": 0,
                        "extractedCount": 0,
                        "batchAds": [],
                        "isPageHunter": True,
                        "statusMessage": f"🎯 GĐ1: Đang tải danh sách từ khóa từ {valid_inote}...",
                    }
                )
            raw_lines = InoteService.fetch_keywords_from_note(valid_inote)
        else:
            raw_lines = [
                line.strip()
                for line in str(inote_url_or_keywords or "").splitlines()
                if line.strip()
            ]

        # Deduplicate input keyword lines preserving order
        seen_kw = set()
        keywords: List[str] = []
        for line in raw_lines:
            k = line.strip().lower()
            if k and k not in seen_kw:
                seen_kw.add(k)
                keywords.append(line.strip())

        if not keywords:
            self.log("Không tìm thấy dòng từ khóa hợp lệ nào để chạy Page Hunter.", "ERROR")
            raise ValueError("Không tìm thấy dòng từ khóa hợp lệ nào để chạy Page Hunter.")

        total_kw = len(keywords)
        self.log(f"Đã tải {len(raw_lines)} dòng, sau khi lọc trùng còn {total_kw} từ khóa hợp lệ.", "STAGE1")
        f_country = base_params.get("country") or "US"
        f_media = base_params.get("mediaType") or "ALL"
        f_lang = base_params.get("language") or "ALL"
        f_platforms = base_params.get("publisherPlatforms") or "ALL"
        f_date = base_params.get("startDate") or "ALL"
        self.log(
            f"🎯 [PAGE_HUNTER] RÀNG BUỘC BỘ LỌC: Quốc gia={f_country} | Media={f_media} | Ngôn ngữ={f_lang} | Nền tảng={f_platforms} | Từ ngày={f_date}",
            "STAGE1",
        )
        num_workers = max(1, min(int(concurrency or 5), total_kw, 8))
        kw_mode_lbl = "CỤM TỪ CHÍNH XÁC (\"...\")" if inote_keyword_mode == "exact" else "MỞ RỘNG (Unordered)"
        self.log(f"Bắt đầu GĐ1: Gom tên Page với {num_workers} luồng song song (Chế độ từ khóa: {kw_mode_lbl})...", "STAGE1")
        unique_pages_map: Dict[str, Dict[str, Any]] = {}
        next_idx = 0
        completed_kw = 0

        if on_progress:
            on_progress(
                {
                    "status": "SEARCHING",
                    "currentPage": 0,
                    "totalFound": total_kw,
                    "extractedCount": 0,
                    "batchAds": [],
                    "isPageHunter": True,
                    "statusMessage": f"🎯 GĐ1 [0/{total_kw} từ khóa]: Đang gom tên Page ({num_workers} luồng)...",
                }
            )

        def worker_loop(worker_id: int) -> None:
            nonlocal next_idx, completed_kw
            if worker_id > 1:
                time.sleep((worker_id - 1) * 0.15)

            worker_session = self._create_worker_session()

            while not self.cancel_requested:
                with self._lock:
                    if next_idx >= total_kw:
                        break
                    curr_i = next_idx
                    next_idx += 1

                kw_line = keywords[curr_i]
                short_kw = kw_line[:30] + ("..." if len(kw_line) > 30 else "")

                entities = self._harvest_pages_for_single_keyword(
                    kw_line, base_params, worker_session, inote_keyword_mode=inote_keyword_mode
                )

                new_unique_records: List[Dict[str, Any]] = []
                with self._lock:
                    completed_kw += 1
                    for ent in entities:
                        p_name = ent["page_name"].strip()
                        norm_key = p_name.lower()
                        if norm_key and norm_key not in unique_pages_map:
                            p_id = ent.get("page_id") or "N/A"
                            rec = {
                                "archive_id": ent.get("archive_id") or f"ph_{len(unique_pages_map) + 1}",
                                "page_id": p_id,
                                "page_name": p_name,
                                "is_active": ent.get("is_active", True),
                                "platforms": "Page Hunter",
                                "creative_format": "Page Hunter",
                                "caption_text": f"Từ khóa #{curr_i + 1}: {kw_line}",
                                "cta_text": "Page Hunter",
                                "link_url": (
                                    f"https://www.facebook.com/ads/library/?active_status=active&ad_type=all"
                                    f"&country={base_params.get('country') or 'US'}&view_all_page_id={p_id}"
                                    if p_id != "N/A"
                                    else ""
                                ),
                            }
                            unique_pages_map[norm_key] = rec
                            if not filter_by_minea:
                                new_unique_records.append(rec)

                    curr_done = completed_kw
                    curr_unique_total = len(unique_pages_map)

                if new_unique_records:
                    self.log(
                        f"[{curr_done}/{total_kw}] '{short_kw}' -> +{len(new_unique_records)} Page mới "
                        f"({', '.join(r['page_name'] for r in new_unique_records[:2])}) | Tổng: {curr_unique_total} Page",
                        "STAGE1",
                    )
                else:
                    self.log(
                        f"[{curr_done}/{total_kw}] '{short_kw}' -> Không có Page mới | Tổng: {curr_unique_total} Page",
                        "STAGE1",
                    )

                if on_progress and not self.cancel_requested:
                    on_progress(
                        {
                            "status": "PROCESSING_ADS" if new_unique_records else "SEARCHING",
                            "currentPage": curr_done,
                            "totalFound": total_kw,
                            "extractedCount": curr_unique_total if not filter_by_minea else 0,
                            "batchAds": new_unique_records,
                            "isPageHunter": True,
                            "phase": "stage1_harvest",
                            "rawUniqueCount": curr_unique_total,
                            "statusMessage": (
                                f'🎯 GĐ1 [{curr_done}/{total_kw}] "{short_kw}" '
                                f"-> Đã gom {curr_unique_total} Page độc nhất"
                            ),
                        }
                    )

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_workers) as executor:
            futures = [executor.submit(worker_loop, w_id + 1) for w_id in range(num_workers)]
            concurrent.futures.wait(futures)

        raw_unique_pages = list(unique_pages_map.values())
        final_pages: List[Dict[str, Any]] = []
        self.log(
            f"Hoàn tất GĐ1: Thu thập được tổng cộng {len(raw_unique_pages)} Page độc nhất từ {total_kw} từ khóa.",
            "STAGE1_DONE",
        )

        # ── STAGE 2: Filter unique pages by Minea Active vs Total Camp Ratio > min_minea_ratio & Total Camp >= min_total_camp ──
        if filter_by_minea and raw_unique_pages and not self.cancel_requested:
            total_candidates = len(raw_unique_pages)
            minea_workers = max(1, min(int(concurrency or 5), total_candidates, 8))
            minea_next_idx = 0
            minea_done_cnt = 0
            self.log(
                f"Bắt đầu GĐ2: Đo Minea bằng Tên '...' cho {total_candidates} Page với {minea_workers} luồng "
                f"(Điều kiện: Tỷ lệ > {min_minea_ratio:g}% & Total Camp >= {min_total_camp}, Chế độ: {minea_lookup_mode.upper()})...",
                "STAGE2_START",
            )

            if on_progress:
                on_progress(
                    {
                        "status": "SEARCHING",
                        "currentPage": 0,
                        "totalFound": total_candidates,
                        "extractedCount": 0,
                        "batchAds": [],
                        "isPageHunter": True,
                        "phase": "stage2_minea",
                        "rawUniqueCount": total_candidates,
                        "statusMessage": (
                            f"🔥 GĐ2 [0/{total_candidates} Page]: Đang lọc Minea Active/Total > {min_minea_ratio:g}% & Total >= {min_total_camp} ({minea_workers} luồng)..."
                        ),
                    }
                )

            def minea_worker_loop(w_id: int) -> None:
                nonlocal minea_next_idx, minea_done_cnt
                if w_id > 1:
                    time.sleep((w_id - 1) * 0.12)
                w_sess = self._create_worker_session()

                while not self.cancel_requested:
                    with self._lock:
                        if minea_next_idx >= total_candidates:
                            break
                        c_idx = minea_next_idx
                        minea_next_idx += 1

                    cand = raw_unique_pages[c_idx]
                    m_stats = self._check_minea_for_page_record(
                        cand, base_params, w_sess, lookup_mode=minea_lookup_mode
                    )
                    act_c = m_stats["activeCount"]
                    tot_c = m_stats["totalCount"]
                    rat_p = m_stats["ratioPercent"]

                    # Filter condition: Ratio > min_minea_ratio, Total Camp >= min_total_camp, Active Camp >= min_active_camp
                    passed_ratio = (rat_p > float(min_minea_ratio)) if min_minea_ratio > 0 else True
                    passed_total = (tot_c >= int(min_total_camp)) if min_total_camp > 0 else True
                    passed_active = (act_c >= int(min_active_camp)) if min_active_camp > 0 else (act_c > 0)
                    passed = passed_ratio and passed_total and passed_active

                    enriched = {
                        **cand,
                        "active_camp": act_c,
                        "total_camp": tot_c,
                        "minea_ratio": rat_p,
                        "creative_format": f"Active: {act_c}/{tot_c} ({rat_p}%)",
                        "caption_text": (
                            f"🔥 Minea: {act_c}/{tot_c} camp ({rat_p}% > {min_minea_ratio:g}% & Total >={min_total_camp}) | "
                            f"{cand.get('caption_text', '')}"
                        ),
                    }

                    newly_passed: List[Dict[str, Any]] = []
                    with self._lock:
                        minea_done_cnt += 1
                        if passed:
                            final_pages.append(enriched)
                            newly_passed.append(enriched)
                        done_now = minea_done_cnt
                        passed_now = len(final_pages)

                    p_name_log = cand["page_name"]
                    p_id_log = cand.get("page_id", "N/A")
                    if passed:
                        self.log(
                            f"[{done_now}/{total_candidates}] [ĐẠT CHUẨN] '{p_name_log}' (ID: {p_id_log}) "
                            f"-> Active: {act_c} / Total: {tot_c} | Tỷ lệ: {rat_p}% > {min_minea_ratio:g}% & Total >= {min_total_camp} => GIỮ LẠI (Đạt: {passed_now})",
                            "PASS",
                        )
                    elif act_c == 0:
                        self.log(
                            f"[{done_now}/{total_candidates}] [LOẠI - 0 ACTIVE] '{p_name_log}' (ID: {p_id_log}) "
                            f"-> Không có ad nào đang chạy (0/{tot_c}) => BỎ QUA",
                            "REJECT",
                        )
                    elif not passed_total:
                        self.log(
                            f"[{done_now}/{total_candidates}] [LOẠI - TOTAL THẤP] '{p_name_log}' (ID: {p_id_log}) "
                            f"-> Total: {tot_c} camp < {min_total_camp} camp tối thiểu => BỎ QUA",
                            "REJECT",
                        )
                    else:
                        self.log(
                            f"[{done_now}/{total_candidates}] [LOẠI - TỶ LỆ THẤP] '{p_name_log}' (ID: {p_id_log}) "
                            f"-> Active: {act_c} / Total: {tot_c} | Tỷ lệ: {rat_p}% <= {min_minea_ratio:g}% => BỎ QUA",
                            "REJECT",
                        )

                    if on_progress and not self.cancel_requested:
                        p_short = cand["page_name"][:24]
                        on_progress(
                            {
                                "status": "PROCESSING_ADS" if newly_passed else "SEARCHING",
                                "currentPage": done_now,
                                "totalFound": total_candidates,
                                "extractedCount": passed_now,
                                "batchAds": newly_passed,
                                "isPageHunter": True,
                                "phase": "stage2_minea",
                                "rawUniqueCount": total_candidates,
                                "statusMessage": (
                                    f'🔥 GĐ2 [{done_now}/{total_candidates} Page] "{p_short}" ({act_c}/{tot_c} = {rat_p}%) '
                                    f"-> Đạt >{min_minea_ratio:g}%: {passed_now} Page"
                                ),
                            }
                        )

            with concurrent.futures.ThreadPoolExecutor(max_workers=minea_workers) as pool:
                futs = [pool.submit(minea_worker_loop, i + 1) for i in range(minea_workers)]
                concurrent.futures.wait(futs)
            self.log(
                f"Hoàn tất GĐ2: Giữ lại {len(final_pages)}/{len(raw_unique_pages)} Page đạt tỷ lệ Active/Total > {min_minea_ratio:g}%.",
                "STAGE2_DONE",
            )
        else:
            final_pages = raw_unique_pages

        auto_note_result = None

        if final_pages and auto_export_inote:
            try:
                self.log(f"Bắt đầu xuất {len(final_pages)} tên Page đạt chuẩn lên https://inote.net/...", "EXPORT")
                if on_progress:
                    on_progress(
                        {
                            "status": "SEARCHING",
                            "currentPage": len(raw_unique_pages) if filter_by_minea else completed_kw,
                            "totalFound": len(raw_unique_pages) if filter_by_minea else total_kw,
                            "extractedCount": len(final_pages),
                            "batchAds": [],
                            "isPageHunter": True,
                            "statusMessage": f"🎯 Đang tự động xuất {len(final_pages)} tên Page đạt chuẩn ra inote.net...",
                        }
                    )
                page_names_text = "\n".join(p["page_name"] for p in final_pages)
                auto_note_result = InoteService.create_note(
                    page_names_text, open_browser=open_inote_tab
                )
                if auto_note_result and auto_note_result.get("noteUrl"):
                    self.log(f"Xuất Inote thành công! Link kết quả: {auto_note_result['noteUrl']}", "SUCCESS")
            except Exception as e:
                self.log(f"Lỗi tự động xuất Inote: {e}", "ERROR")
                print(f"[PageHunter] Lỗi tự động xuất Inote: {e}")

        if on_progress:
            summary_prefix = (
                f"🎯 Hoàn tất: Gom {len(raw_unique_pages)} Page → Lọc Minea >{min_minea_ratio:g}% còn {len(final_pages)} Page"
                if filter_by_minea
                else f"🎯 Hoàn tất {completed_kw}/{total_kw} từ khóa ({len(final_pages)} Page độc nhất)"
            )
            on_progress(
                {
                    "status": "COMPLETED",
                    "currentPage": len(raw_unique_pages) if filter_by_minea else completed_kw,
                    "totalFound": len(raw_unique_pages) if filter_by_minea else total_kw,
                    "extractedCount": len(final_pages),
                    "batchAds": [],
                    "isPageHunter": True,
                    "autoNoteResult": auto_note_result,
                    "statusMessage": (
                        f"{summary_prefix} → Đã xuất {auto_note_result['noteUrl']}"
                        if auto_note_result and auto_note_result.get("noteUrl")
                        else summary_prefix
                    ),
                }
            )

        self.is_running = False
        return {
            "pages": final_pages,
            "rawUniqueCount": len(raw_unique_pages),
            "totalKeywords": total_kw,
            "completedKeywords": completed_kw,
            "uniquePageCount": len(final_pages),
            "filterByMinea": filter_by_minea,
            "minMineaRatio": min_minea_ratio,
            "autoNoteResult": auto_note_result,
        }
