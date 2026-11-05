# -*- coding: utf-8 -*-
"""
FB Ads Library Hunter - Standalone Python Tool (Web UI + CLI)
Replaces the Chrome Extension 'Find Ads' tab with a 100% standalone Python application.
"""

import argparse
import collections
import datetime
import json
import os
import socket
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

from engine import FacebookAdsHunterEngine, InoteService

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class AppLogger:
    """Thread-safe persistent logger that writes to both hunter.log and memory buffer."""

    def __init__(self, log_path: Optional[str] = None, max_entries: int = 2000):
        if not log_path:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            self.log_path = os.path.join(base_dir, "hunter.log")
        else:
            self.log_path = log_path
        self.lock = threading.Lock()
        self.entries = collections.deque(maxlen=max_entries)
        try:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(f"\n--- [PHIÊN KHỞI ĐỘNG] {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        except Exception:
            pass

    def log(self, message: str, level: str = "INFO") -> None:
        now_str = datetime.datetime.now().strftime("%H:%M:%S")
        entry = {
            "time": now_str,
            "level": level.upper(),
            "message": str(message),
            "timestamp": time.time(),
        }
        with self.lock:
            self.entries.append(entry)
            try:
                with open(self.log_path, "a", encoding="utf-8") as f:
                    f.write(f"[{now_str}] [{level.upper()}] {message}\n")
            except Exception:
                pass
        try:
            print(f"[{now_str}] [{level.upper()}] {message}")
        except Exception:
            pass

    def get_logs(self, since_ts: float = 0.0) -> List[Dict[str, Any]]:
        with self.lock:
            if since_ts <= 0:
                return list(self.entries)
            return [e for e in self.entries if e["timestamp"] > since_ts]

    def clear(self) -> None:
        with self.lock:
            self.entries.clear()
            try:
                with open(self.log_path, "w", encoding="utf-8") as f:
                    f.write(f"--- [ĐÃ XÓA NHẬT KÝ] {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---\n")
            except Exception:
                pass


LOGGER = AppLogger()


class AppState:
    """Thread-safe state manager for the standalone Find Ads Python tool."""

    def __init__(self):
        self.lock = threading.Lock()
        self.engine = FacebookAdsHunterEngine(log_callback=LOGGER.log)
        self.is_running: bool = False
        self.mode: str = "idle"  # 'single', 'inote_batch', 'page_hunter'
        self.status_text: str = "Sẵn sàng (Không cần đăng nhập FB)"
        self.batch_status_text: str = "Chờ lệnh"
        self.total_count: int = 0
        self.collected_count: int = 0
        self.progress_pct: float = 0.0
        self.ads: List[Dict[str, Any]] = []
        self.unique_pages: List[str] = []
        self.minea: Dict[str, Any] = {
            "status": "idle",
            "activeCount": 0,
            "totalCount": 0,
            "activeFormatted": "0",
            "totalFormatted": "0",
            "ratio": "0.0",
            "error": None,
        }
        self.last_inote_url: Optional[str] = None
        self.last_inote_label: str = ""
        self.error: Optional[str] = None
        self.worker_thread: Optional[threading.Thread] = None

    def to_dict(self, include_ads: bool = True) -> Dict[str, Any]:
        with self.lock:
            data = {
                "isRunning": self.is_running,
                "mode": self.mode,
                "statusText": self.status_text,
                "batchStatusText": self.batch_status_text,
                "totalCount": self.total_count,
                "collectedCount": self.collected_count,
                "progressPct": self.progress_pct,
                "uniquePagesCount": len(self.unique_pages),
                "adsCount": len(self.ads),
                "minea": dict(self.minea),
                "lastInoteUrl": self.last_inote_url,
                "lastInoteLabel": self.last_inote_label,
                "error": self.error,
                "hasCookie": bool(self.engine.cookie_string),
            }
            if include_ads:
                data["ads"] = list(self.ads)
                data["uniquePages"] = list(self.unique_pages)
            return data

    def reset_for_run(self, mode: str) -> None:
        with self.lock:
            self.engine.cancel_requested = False
            self.is_running = True
            self.mode = mode
            self.status_text = "Đang khởi tạo..."
            self.batch_status_text = "Đang kết nối..."
            self.total_count = 0
            self.collected_count = 0
            self.progress_pct = 5.0
            self.ads = []
            self.unique_pages = []
            self.last_inote_url = None
            self.last_inote_label = ""
            self.error = None


STATE = AppState()


def normalize_ui_filters(raw_filters: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize UI filter keys to engine parameter keys."""
    langs = raw_filters.get("contentLanguages") or []
    lang = langs[0] if isinstance(langs, list) and langs else (raw_filters.get("language") or "ALL")
    return {
        "keyword": (raw_filters.get("query") or raw_filters.get("keyword") or "").strip(),
        "rawKeyword": (raw_filters.get("query") or raw_filters.get("keyword") or "").strip(),
        "isExactPhrase": bool(raw_filters.get("exactPhrase") or raw_filters.get("isExactPhrase")),
        "country": raw_filters.get("country") or "US",
        "category": raw_filters.get("adType") or raw_filters.get("category") or "ALL",
        "publisherPlatforms": raw_filters.get("publisherPlatforms") or [],
        "mediaType": raw_filters.get("mediaType") or "ALL",
        "activeStatus": raw_filters.get("activeStatus") or "ACTIVE",
        "startDate": raw_filters.get("startDateMin") or raw_filters.get("startDate") or None,
        "language": lang,
        "sortBy": raw_filters.get("sortBy") or "SORT_BY_TOTAL_IMPRESSIONS",
    }


def start_search_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Launch a background search job (Single Keyword, Inote Batch, or Page Hunter Turbo)."""
    if STATE.is_running:
        STATE.engine.cancel()
        time.sleep(0.2)

    raw_filters = payload.get("filters") or {}
    params = normalize_ui_filters(raw_filters)
    raw_query = params["keyword"]
    page_hunter_mode = bool(payload.get("pageHunterMode", False))
    max_workers = int(payload.get("maxWorkers", 5) or 5)
    max_batches = int(payload.get("maxPages", 15) or 15)
    min_minea_ratio = float(payload.get("minMineaRatio", 50.0) or 50.0)
    filter_by_minea = bool(payload.get("filterByMinea", True)) and (min_minea_ratio > 0)
    minea_lookup_mode = str(payload.get("mineaLookupMode") or "exact_name").strip()

    inote_url = InoteService.parse_inote_url(raw_query)

    # Nếu dán link Inote và đang bật Page Hunter thì tự động chuyển sang chế độ Page Hunter
    if page_hunter_mode and (inote_url or "\n" in raw_query or raw_query):
        job_mode = "page_hunter"
    elif inote_url:
        job_mode = "inote_batch"
    else:
        job_mode = "single"

    STATE.reset_for_run(job_mode)
    LOGGER.log(
        f"Khởi động tác vụ mới: '{raw_query[:50]}' | Mode: {job_mode.upper()} | "
        f"Luồng: {max_workers} | Lọc Minea: {filter_by_minea} (>{min_minea_ratio:g}%, Chế độ: {minea_lookup_mode.upper()})",
        "INFO",
    )

    def _worker() -> None:
        try:
            if job_mode == "page_hunter":
                def on_ph_progress(prog: Dict[str, Any]) -> None:
                    with STATE.lock:
                        total_kw = prog.get("totalFound", 0)
                        done_kw = prog.get("currentPage", 0)
                        unique_cnt = prog.get("extractedCount", 0)
                        batch_ads = prog.get("batchAds") or []
                        if batch_ads:
                            STATE.ads.extend(batch_ads)
                            for b in batch_ads:
                                p_name = (b.get("page_name") or "").strip()
                                if p_name and p_name not in STATE.unique_pages:
                                    STATE.unique_pages.append(p_name)
                        STATE.total_count = total_kw
                        STATE.collected_count = unique_cnt
                        if total_kw > 0:
                            STATE.progress_pct = min(98.0, round((done_kw / total_kw) * 100.0, 1))
                        msg = prog.get("statusMessage") or "Đang chạy Page Hunter..."
                        STATE.status_text = f"Page Hunter ({done_kw}/{total_kw}) • {unique_cnt} Page đạt chuẩn"
                        STATE.batch_status_text = msg

                res = STATE.engine.run_page_hunter_batch(
                    inote_url_or_keywords=inote_url or raw_query,
                    base_params=params,
                    on_progress=on_ph_progress,
                    concurrency=max_workers,
                    auto_export_inote=True,
                    open_inote_tab=False,
                    filter_by_minea=filter_by_minea,
                    min_minea_ratio=min_minea_ratio,
                    minea_lookup_mode=minea_lookup_mode,
                )
                pages_records = res.get("pages") or []
                raw_unique_cnt = res.get("rawUniqueCount", len(pages_records))
                auto_note = res.get("autoNoteResult") or {}
                with STATE.lock:
                    STATE.ads = pages_records
                    STATE.unique_pages = [p.get("page_name", "") for p in pages_records if p.get("page_name")]
                    STATE.total_count = raw_unique_cnt if filter_by_minea else res.get("totalKeywords", 0)
                    STATE.collected_count = res.get("uniquePageCount", len(STATE.unique_pages))
                    STATE.progress_pct = 100.0
                    if auto_note.get("noteUrl"):
                        STATE.last_inote_url = auto_note["noteUrl"]
                        STATE.last_inote_label = (
                            f"{STATE.collected_count}/{raw_unique_cnt} Page đạt Minea >{min_minea_ratio:g}%"
                            if filter_by_minea
                            else f"{STATE.collected_count} Page độc nhất"
                        )
                    STATE.status_text = (
                        f"Hoàn tất: {STATE.collected_count}/{raw_unique_cnt} Page (>{min_minea_ratio:g}%)"
                        if filter_by_minea
                        else f"Hoàn tất: {STATE.collected_count} Page độc nhất"
                    )
                    STATE.batch_status_text = (
                        f"🎯 Gom {raw_unique_cnt} Page → Lọc Minea >{min_minea_ratio:g}% đạt {STATE.collected_count} Page"
                        if filter_by_minea
                        else f"🎯 Hoàn tất {res.get('completedKeywords', STATE.total_count)}/{STATE.total_count} từ khóa ({STATE.collected_count} Page)"
                    )

            elif job_mode == "inote_batch":
                def on_batch_progress(prog: Dict[str, Any]) -> None:
                    with STATE.lock:
                        idx = prog.get("currentPage", 0)
                        tot = prog.get("totalFound", 0)
                        cnt = prog.get("extractedCount", 0)
                        batch_ads = prog.get("batchAds") or []
                        if batch_ads:
                            STATE.ads.extend(batch_ads)
                        STATE.collected_count = cnt
                        STATE.total_count = max(tot, cnt)
                        STATE.batch_status_text = prog.get("statusMessage") or f"Đã thu thập {cnt} ads"
                        STATE.status_text = f"Inote Batch: {cnt} ads"
                        STATE.progress_pct = min(95.0, float(idx * 5))

                ads_list = STATE.engine.search_inote_keyword_batch(
                    inote_url=inote_url,
                    base_params=params,
                    on_progress=on_batch_progress,
                )
                with STATE.lock:
                    STATE.ads = ads_list
                    STATE.collected_count = len(ads_list)
                    STATE.total_count = max(STATE.total_count, len(ads_list))
                    STATE.progress_pct = 100.0
                    STATE.status_text = f"Hoàn tất: {len(ads_list)} ads"
                    STATE.batch_status_text = f"Hoàn tất Inote Batch ({len(ads_list)} ads)"

            else:
                # Single keyword search + concurrent Minea Active vs Total check
                with STATE.lock:
                    STATE.minea = {
                        "status": "loading",
                        "activeCount": 0,
                        "totalCount": 0,
                        "activeFormatted": "...",
                        "totalFormatted": "...",
                        "ratio": "...",
                        "error": None,
                    }

                def _run_minea() -> None:
                    try:
                        m_res = STATE.engine.fetch_active_vs_total_counts(params)
                        with STATE.lock:
                            STATE.minea = {
                                "status": "done",
                                "activeCount": m_res["activeCount"],
                                "totalCount": m_res["totalCount"],
                                "activeFormatted": m_res["formattedActive"],
                                "totalFormatted": m_res["formattedTotal"],
                                "ratio": str(m_res["ratioPercent"]),
                                "error": None,
                            }
                    except Exception as e:
                        with STATE.lock:
                            STATE.minea["status"] = "error"
                            STATE.minea["error"] = str(e)

                threading.Thread(target=_run_minea, daemon=True).start()

                def on_single_progress(prog: Dict[str, Any]) -> None:
                    with STATE.lock:
                        tot = prog.get("totalFound", 0)
                        cnt = prog.get("extractedCount", 0)
                        batch_ads = prog.get("batchAds") or []
                        if batch_ads:
                            STATE.ads.extend(batch_ads)
                        STATE.total_count = max(tot, cnt)
                        STATE.collected_count = cnt
                        STATE.status_text = f"Đang tải: {cnt} ads"
                        STATE.batch_status_text = prog.get("statusMessage") or f"Đã thu thập {cnt} ads"
                        if STATE.total_count > 0:
                            STATE.progress_pct = min(95.0, round((cnt / STATE.total_count) * 100.0, 1))

                ads_list = STATE.engine.search_and_paginate_all(
                    params=params,
                    on_progress=on_single_progress,
                    max_batches=max_batches,
                )
                with STATE.lock:
                    STATE.ads = ads_list
                    STATE.collected_count = len(ads_list)
                    STATE.total_count = max(STATE.total_count, len(ads_list))
                    STATE.progress_pct = 100.0
                    STATE.status_text = f"Hoàn tất: {len(ads_list)} ads"
                    STATE.batch_status_text = "Thu thập hoàn tất 100%"

        except Exception as exc:
            with STATE.lock:
                STATE.error = str(exc)
                STATE.status_text = "Lỗi tìm kiếm"
                STATE.batch_status_text = str(exc)
        finally:
            with STATE.lock:
                STATE.is_running = False

    t = threading.Thread(target=_worker, daemon=True)
    STATE.worker_thread = t
    t.start()
    return {"success": True, "mode": job_mode}


HTML_DASHBOARD = r"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FB Ads Library Hunter - Python Standalone Tool</title>
  <style>
    :root {
      --bg-main: #090d16;
      --bg-card: #111827;
      --bg-card-2: #172033;
      --border: #1e293b;
      --border-accent: #10b981;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --emerald: #10b981;
      --cyan: #06b6d4;
      --orange: #f97316;
      --danger: #ef4444;
      --indigo: #6366f1;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: var(--bg-main);
      color: var(--text);
      min-height: 100vh;
      padding: 18px;
      line-height: 1.45;
    }
    .app-container {
      max-width: 980px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .top-bar {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    }
    .brand-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: 700;
      color: #04131a;
      box-shadow: 0 0 14px rgba(16,185,129,0.4);
    }
    .brand-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .py-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 99px;
      background: rgba(16,185,129,0.15);
      border: 1px solid rgba(16,185,129,0.4);
      color: #34d399;
      font-weight: 600;
    }
    .status-line {
      font-size: 12px;
      color: var(--emerald);
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      display: inline-block;
    }
    .status-dot.running {
      background: #f59e0b;
      box-shadow: 0 0 8px #f59e0b;
      animation: pulse 1s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      border: none;
      outline: none;
      cursor: pointer;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      padding: 9px 15px;
      transition: all 0.18s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #fff;
    }
    .btn-primary {
      background: linear-gradient(135deg, #10b981, #059669);
      box-shadow: 0 0 15px rgba(16,185,129,0.35);
    }
    .btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-stop {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      box-shadow: 0 0 14px rgba(239,68,68,0.4);
    }
    .btn-cookie {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      font-size: 12px;
      padding: 8px 12px;
    }
    .btn-cookie:hover { border-color: #64748b; color: #fff; }
    .panel-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .field-label-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .field-hint {
      color: #38bdf8;
      font-size: 11.5px;
    }
    .search-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-input {
      width: 100%;
      background: #0b1120;
      border: 1px solid #26334d;
      border-radius: 8px;
      color: #fff;
      font-size: 13.5px;
      padding: 10px 34px 10px 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus {
      border-color: var(--emerald);
      box-shadow: 0 0 0 2px rgba(16,185,129,0.15);
    }
    .clear-input-btn {
      position: absolute;
      right: 10px;
      background: none;
      border: none;
      color: #64748b;
      font-size: 16px;
      cursor: pointer;
    }
    .clear-input-btn:hover { color: #e2e8f0; }
    .phrase-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 9px;
      gap: 8px;
    }
    .chk-label {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 12.5px;
      color: #cbd5e1;
      cursor: pointer;
      user-select: none;
    }
    .chk-label input {
      width: 15px;
      height: 15px;
      accent-color: var(--emerald);
      cursor: pointer;
    }
    .search-type-badge {
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 6px;
      background: rgba(99,102,241,0.14);
      border: 1px solid rgba(99,102,241,0.4);
      color: #818cf8;
      letter-spacing: 0.3px;
    }
    .page-hunter-box {
      margin-top: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .page-hunter-box .chk-label {
      color: #34d399;
      font-weight: 600;
    }
    .workers-select {
      background: #0b1120;
      color: #34d399;
      border: 1px solid rgba(16,185,129,0.4);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11.5px;
      font-weight: 600;
      outline: none;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .select-ctrl, .date-ctrl {
      width: 100%;
      background: #0b1120;
      border: 1px solid #26334d;
      border-radius: 8px;
      color: #f1f5f9;
      font-size: 12.5px;
      padding: 8px 10px;
      outline: none;
    }
    .select-ctrl:focus, .date-ctrl:focus {
      border-color: var(--emerald);
    }
    .adv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      padding: 4px 0;
      color: #38bdf8;
      font-size: 12.5px;
      font-weight: 600;
      user-select: none;
    }
    .adv-body {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .platform-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 6px;
      margin-bottom: 10px;
    }
    .minea-card {
      background: linear-gradient(180deg, rgba(249,115,22,0.06), rgba(17,24,39,0.95));
      border: 1px solid rgba(249,115,22,0.35);
      border-radius: 12px;
      padding: 12px 15px;
    }
    .minea-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .minea-title {
      font-size: 13px;
      font-weight: 700;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .btn-minea {
      background: linear-gradient(135deg, #f97316, #ea580c);
      font-size: 11.5px;
      padding: 5px 11px;
      border-radius: 6px;
    }
    .minea-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .minea-metric {
      background: rgba(11,17,32,0.85);
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 9px 11px;
    }
    .minea-metric.active-box { border-color: rgba(16,185,129,0.35); }
    .minea-metric.total-box { border-color: rgba(56,189,248,0.35); }
    .minea-metric.ratio-box { border-color: rgba(249,115,22,0.35); }
    .minea-label { font-size: 11px; color: var(--text-muted); }
    .minea-val { font-size: 19px; font-weight: 800; margin: 3px 0; }
    .minea-sub { font-size: 11px; color: #94a3b8; }
    .minea-bar-bg {
      height: 5px;
      background: #1e293b;
      border-radius: 99px;
      overflow: hidden;
      margin-top: 10px;
    }
    .minea-bar-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #10b981, #f59e0b);
      transition: width 0.3s ease;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 13px;
    }
    .stat-card.highlight {
      border-color: rgba(16,185,129,0.45);
    }
    .stat-label {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
    }
    .stat-val {
      font-size: 19px;
      font-weight: 800;
      margin-top: 3px;
      color: #38bdf8;
    }
    .stat-card.highlight .stat-val { color: var(--emerald); }
    .stat-status {
      font-size: 12.5px;
      font-weight: 600;
      margin-top: 5px;
      color: #e2e8f0;
    }
    .progress-track {
      height: 4px;
      background: #1e293b;
      border-radius: 99px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #10b981, #06b6d4);
      transition: width 0.25s ease;
    }
    .export-options-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
    }
    .export-checks {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .btn-inote-main {
      width: 100%;
      padding: 12px;
      font-size: 14px;
      font-weight: 700;
      border-radius: 10px;
      background: linear-gradient(90deg, #10b981, #0284c7);
      box-shadow: 0 4px 16px rgba(6,182,212,0.28);
    }
    .btn-inote-main:hover { filter: brightness(1.08); }
    .inote-banner {
      margin-top: 8px;
      padding: 10px 13px;
      border-radius: 8px;
      background: rgba(16,185,129,0.12);
      border: 1px solid rgba(16,185,129,0.45);
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12.5px;
    }
    .inote-banner a {
      color: #34d399;
      font-weight: 700;
      text-decoration: underline;
      word-break: break-all;
    }
    .secondary-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .btn-sec {
      background: #172033;
      border: 1px solid #28354f;
      color: #e2e8f0;
      padding: 8px 13px;
      font-size: 12px;
    }
    .btn-sec:hover { background: #1e293b; border-color: #475569; }
    .btn-sec.grow { flex: 1; }
    .btn-danger-outline {
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.4);
      color: #f87171;
    }
    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 12px;
    }
    .pager-btns {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-page {
      background: #172033;
      border: 1px solid #28354f;
      color: #cbd5e1;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-page:disabled { opacity: 0.4; cursor: not-allowed; }
    .results-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(430px, 1fr));
      gap: 12px;
    }
    .ad-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 13px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ad-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .ad-page-name {
      font-weight: 700;
      font-size: 14px;
      color: #34d399;
      cursor: pointer;
    }
    .ad-badge {
      font-size: 10.5px;
      padding: 2px 7px;
      border-radius: 99px;
      background: rgba(16,185,129,0.15);
      color: #34d399;
      border: 1px solid rgba(16,185,129,0.35);
    }
    .ad-meta {
      font-size: 11.5px;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .ad-body {
      font-size: 12.5px;
      color: #e2e8f0;
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 7px;
      padding: 9px;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .ad-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: auto;
      padding-top: 4px;
    }
    .compact-row {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 12.5px;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
      padding: 16px;
    }
    .modal-box {
      background: var(--bg-card);
      border: 1px solid #334155;
      border-radius: 12px;
      max-width: 560px;
      width: 100%;
      padding: 18px;
    }
    .modal-textarea {
      width: 100%;
      height: 110px;
      background: #0b1120;
      border: 1px solid #26334d;
      border-radius: 8px;
      color: #f1f5f9;
      padding: 10px;
      font-size: 12px;
      margin: 10px 0;
      outline: none;
    }
    /* Tabs & Logfile Terminal */
    .btn-tab {
      background: #111827;
      border: 1px solid #1e293b;
      color: #94a3b8;
      padding: 8px 15px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      transition: all 0.18s ease;
    }
    .btn-tab:hover {
      background: #172033;
      color: #f1f5f9;
    }
    .btn-tab.active {
      background: #172033;
      border-color: #38bdf8;
      color: #38bdf8;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
    }
    .log-terminal {
      background: #040711;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      line-height: 1.6;
      height: 540px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #cbd5e1;
      box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
    }
    .log-line {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 2.5px 0;
      border-bottom: 1px solid rgba(30, 41, 59, 0.3);
    }
    .log-line:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .log-time {
      color: #64748b;
      font-size: 11px;
      flex-shrink: 0;
      user-select: none;
    }
    .log-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      letter-spacing: 0.3px;
    }
    .log-badge-STAGE1 { background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.4); }
    .log-badge-STAGE2 { background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.4); }
    .log-badge-PASS { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.5); }
    .log-badge-REJECT { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.4); }
    .log-badge-SUCCESS { background: rgba(16,185,129,0.25); color: #10b981; border: 1px solid #10b981; }
    .log-badge-ERROR { background: rgba(239,68,68,0.25); color: #ef4444; border: 1px solid #ef4444; }
    .log-badge-INFO { background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid #334155; }
    @media (max-width: 720px) {
      .grid-2, .minea-grid, .stats-grid, .results-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="app-container">
    <!-- Top Header -->
    <div class="top-bar">
      <div class="brand-left">
        <div class="brand-icon">🔍</div>
        <div>
          <div class="brand-title">
            Facebook Ads Library Hunter
            <span class="py-badge">PYTHON STANDALONE</span>
          </div>
          <div class="status-line">
            <span id="status-dot" class="status-dot"></span>
            <span id="status-text">Sẵn sàng (Không cần đăng nhập FB)</span>
          </div>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn btn-cookie" id="btn-open-cookie" title="Cấu hình Cookie Facebook (Tùy chọn khi muốn phân trang sâu)">
          🍪 Cookie FB <span id="cookie-indicator">(Mặc định: SSR Không Cookie)</span>
        </button>
        <button class="btn btn-primary" id="btn-start-search">
          🚀 Bắt đầu tìm kiếm
        </button>
      </div>
    </div>

    <!-- Search & Primary Filters -->
    <div class="panel-card">
      <div class="field-label-row">
        <span>Từ khóa tìm kiếm / Advertiser / Link Inote:</span>
        <span class="field-hint">Từ khóa, Tên Page hoặc dán link https://inote.net/...</span>
      </div>
      <div class="search-input-wrap">
        <input
          type="text"
          id="input-query"
          class="search-input"
          placeholder="Nhập từ khóa, tên Page hoặc dán link https://inote.net/..."
        />
        <button class="clear-input-btn" id="btn-clear-query" title="Xóa">×</button>
      </div>

      <div class="phrase-row">
        <label class="chk-label">
          <input type="checkbox" id="chk-exact-phrase" />
          <span>Tìm kiếm cụm từ chính xác (Exact phrase: "...")</span>
        </label>
        <span class="search-type-badge" id="badge-search-type">KEYWORD_UNORDERED</span>
      </div>

      <!-- Chế độ Page Hunter Thống Nhất (Gom Page & Lọc Minea theo Tên "..." & Tự Xuất Inote) -->
      <div class="page-hunter-box" style="flex-direction:column; align-items:stretch; gap:9px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.4); border-radius:10px; padding:11px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <label class="chk-label" style="color:#34d399; font-weight:700; font-size:13px;">
            <input type="checkbox" id="chk-page-hunter" checked />
            <span>🎯 Chế độ Page Hunter (Gom Page &amp; Lọc Minea theo Tên "..." &amp; Tự xuất Inote)</span>
          </label>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-size:12px; color:#fb923c; font-weight:600;">Lọc Minea: Tỷ lệ &gt;</span>
            <input type="number" id="input-ph-min-ratio" value="50" min="0" max="100" step="1" class="workers-select" style="width:58px; text-align:center; color:#fb923c; font-weight:700; border-color:rgba(249,115,22,0.5);" title="Nhập 0% nếu muốn lấy tất cả Page không lọc tỷ lệ" />
            <span style="font-size:12px; font-weight:700; color:#fb923c;">%</span>
            <span style="font-size:11.5px; color:#94a3b8; margin-left:4px;">Số luồng:</span>
            <select id="select-workers" class="workers-select">
              <option value="5" selected>5 luồng (Turbo)</option>
              <option value="8">8 luồng (Max Speed)</option>
              <option value="3">3 luồng (Chuẩn)</option>
              <option value="1">1 luồng (Tuần tự)</option>
            </select>
            <span style="font-size:11px; font-weight:600; padding:3px 8px; border-radius:4px; background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.4); color:#38bdf8;" title="Đo Minea chính xác bằng tên Page đặt trong dấu ngoặc kép: q=&quot;...&quot; &amp; search_type=keyword_exact_phrase">
              Đo: "[Tên Page]" (Chính xác)
            </span>
          </div>
        </div>
        <div style="font-size:11.5px; color:#94a3b8; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding-top:6px; border-top:1px dashed rgba(16,185,129,0.22);">
          <span>⚡ <b>Quy trình 1 bước:</b></span>
          <span style="color:#38bdf8;">[Pha 1] Quét Inote gom Page (áp dụng đúng Bộ lọc bên dưới)</span>
          <span style="color:#64748b;">➔</span>
          <span style="color:#fb923c;">[Pha 2] Đo Minea theo Tên "..." &amp; Lọc tỷ lệ &gt; <b id="hint-ph-ratio">50</b>%</span>
          <span style="color:#64748b;">➔</span>
          <span style="color:#34d399;">[Pha 3] Tự xuất link Inote mới</span>
        </div>
      </div>

      <!-- Country & Category -->
      <div class="grid-2">
        <div>
          <div class="field-label-row"><span>Quốc gia (Country):</span></div>
          <select id="select-country" class="select-ctrl">
            <option value="US" selected>🇺🇸 United States (Mặc định)</option>
            <option value="ALL">🌍 Tất cả quốc gia (ALL)</option>
            <option value="VN">🇻🇳 Việt Nam (VN)</option>
            <option value="GB">🇬🇧 United Kingdom (GB)</option>
            <option value="CA">🇨🇦 Canada (CA)</option>
            <option value="AU">🇦🇺 Australia (AU)</option>
            <option value="DE">🇩🇪 Germany (DE)</option>
            <option value="FR">🇫🇷 France (FR)</option>
            <option value="JP">🇯🇵 Japan (JP)</option>
            <option value="KR">🇰🇷 South Korea (KR)</option>
            <option value="SG">🇸🇬 Singapore (SG)</option>
            <option value="TH">🇹🇭 Thailand (TH)</option>
            <option value="ID">🇮🇩 Indonesia (ID)</option>
            <option value="PH">🇵🇭 Philippines (PH)</option>
            <option value="MY">🇲🇾 Malaysia (MY)</option>
            <option value="BR">🇧🇷 Brazil (BR)</option>
            <option value="MX">🇲🇽 Mexico (MX)</option>
            <option value="IN">🇮🇳 India (IN)</option>
          </select>
        </div>
        <div>
          <div class="field-label-row"><span>Danh mục (Category):</span></div>
          <select id="select-ad-type" class="select-ctrl">
            <option value="ALL" selected>Tất cả quảng cáo (All ads)</option>
            <option value="POLITICAL_AND_ISSUE_ADS">Chính trị & Vấn đề xã hội</option>
            <option value="HOUSING_ADS">Bất động sản (Housing)</option>
            <option value="EMPLOYMENT_ADS">Việc làm (Employment)</option>
            <option value="CREDIT_ADS">Tín dụng & Tài chính (Credit)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Advanced Filters -->
    <div class="panel-card">
      <div class="adv-header" id="adv-toggle">
        <span>🌪️ Bộ lọc nâng cao (Platform, Media, Status, Date, Lang, Sort)</span>
        <span id="adv-arrow">▲</span>
      </div>
      <div class="adv-body" id="adv-body">
        <div class="field-label-row"><span>Nền tảng hiển thị (Publisher Platforms):</span></div>
        <div class="platform-grid">
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="FACEBOOK" checked /> Facebook</label>
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="INSTAGRAM" checked /> Instagram</label>
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="AUDIENCE_NETWORK" checked /> Audience Net</label>
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="MESSENGER" checked /> Messenger</label>
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="WHATSAPP" checked /> WhatsApp</label>
          <label class="chk-label"><input type="checkbox" class="chk-platform" value="THREADS" checked /> Threads</label>
        </div>

        <div class="grid-2">
          <div>
            <div class="field-label-row"><span>Định dạng Media:</span></div>
            <select id="select-media-type" class="select-ctrl">
              <option value="ALL" selected>Tất cả định dạng (ALL)</option>
              <option value="VIDEO">Chỉ Video (Video)</option>
              <option value="IMAGE">Chỉ Hình ảnh (Image)</option>
              <option value="MEME">Images & Memes</option>
              <option value="NONE">Không chứa Media (No image/video)</option>
            </select>
          </div>
          <div>
            <div class="field-label-row"><span>Trạng thái Ads:</span></div>
            <select id="select-active-status" class="select-ctrl">
              <option value="ACTIVE" selected>Đang chạy (Active ads)</option>
              <option value="ALL">Tất cả trạng thái (Active & Inactive)</option>
              <option value="INACTIVE">Đã ngừng chạy (Inactive ads)</option>
            </select>
          </div>
        </div>

        <div class="grid-2">
          <div>
            <div class="field-label-row"><span>Từ ngày (On or after):</span></div>
            <div style="display:flex; gap:6px;">
              <select id="select-date-preset" class="select-ctrl">
                <option value="ALL" selected>Tất cả thời gian (Mặc định)</option>
                <option value="7d">7 ngày gần nhất</option>
                <option value="30d">30 ngày gần nhất</option>
                <option value="3m">3 tháng gần nhất</option>
                <option value="6m">6 tháng gần nhất</option>
                <option value="1y">1 năm gần nhất</option>
                <option value="custom">Tùy chọn ngày...</option>
              </select>
              <input type="date" id="input-date-custom" class="date-ctrl" style="display:none;" />
            </div>
          </div>
          <div>
            <div class="field-label-row"><span>Ngôn ngữ bài viết:</span></div>
            <select id="select-lang" class="select-ctrl">
              <option value="ALL" selected>Tất cả ngôn ngữ (ALL - Khuyên dùng)</option>
              <option value="en">English (en)</option>
              <option value="vi">Tiếng Việt (vi)</option>
              <option value="zh">Chinese (zh)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ko">Korean (ko)</option>
              <option value="th">Thai (th)</option>
              <option value="id">Indonesian (id)</option>
            </select>
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="field-label-row"><span>Sắp xếp kết quả (Sort By):</span></div>
          <select id="select-sort-by" class="select-ctrl">
            <option value="SORT_BY_TOTAL_IMPRESSIONS" selected>Lượt hiển thị cao nhất (Impressions: high to low)</option>
            <option value="SORT_BY_RELEVANCY_MONTHLY_GROUPED">Mức độ liên quan (Relevancy)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Minea Analytics Panel -->
    <div class="minea-card" id="minea-panel">
      <div class="minea-header">
        <div class="minea-title">📊 Active vs Total Camp (Minea Analytics)</div>
        <button class="btn btn-minea" id="btn-check-minea">⚡ Check nhanh</button>
      </div>
      <div class="minea-grid">
        <div class="minea-metric active-box">
          <div class="minea-label">● Active Camp</div>
          <div class="minea-val" style="color:#10b981;" id="minea-active-val">0</div>
          <div class="minea-sub" id="minea-active-sub">Chính xác: 0 camp</div>
        </div>
        <div class="minea-metric total-box">
          <div class="minea-label">● Total Camp</div>
          <div class="minea-val" style="color:#38bdf8;" id="minea-total-val">0</div>
          <div class="minea-sub" id="minea-total-sub">Tổng: 0 camp</div>
        </div>
        <div class="minea-metric ratio-box">
          <div class="minea-label">Tỷ lệ Active / Total</div>
          <div class="minea-val" style="color:#fb923c;" id="minea-ratio-val">0%</div>
          <div class="minea-sub" id="minea-ratio-sub">Chưa kiểm tra</div>
        </div>
      </div>
      <div class="minea-bar-bg">
        <div class="minea-bar-fill" id="minea-bar-fill"></div>
      </div>
    </div>

    <!-- 3 Metric Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label" id="label-stat-total">TỔNG TÌM THẤY</div>
        <div class="stat-val" id="val-stat-total">0</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-label" id="label-stat-collected">ĐÃ THU THẬP</div>
        <div class="stat-val" id="val-stat-collected">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">ĐANG XỬ LÝ / BATCH</div>
        <div class="stat-status" id="val-stat-batch">Chờ lệnh</div>
      </div>
    </div>
    <div class="progress-track">
      <div class="progress-fill" id="progress-bar-fill"></div>
    </div>

    <!-- Export Options & Action Buttons -->
    <div class="panel-card">
      <div class="export-options-bar">
        <span style="font-size:12px; color:#94a3b8; font-weight:600;">Tùy chọn xuất inote & Copy:</span>
        <span class="search-type-badge" id="badge-export-mode">Đầy đủ 8 trường</span>
      </div>
      <div class="export-checks">
        <label class="chk-label">
          <input type="checkbox" id="chk-only-content" />
          <span>Chỉ lấy nội dung bài viết</span>
        </label>
        <label class="chk-label">
          <input type="checkbox" id="chk-only-links" />
          <span>Chỉ lấy đường dẫn đích (Link)</span>
        </label>
        <label class="chk-label">
          <input type="checkbox" id="chk-only-page-name" />
          <span>Chỉ lấy tên Page</span>
        </label>
      </div>

      <div style="margin-top:12px;">
        <button class="btn btn-inote-main" id="btn-save-inote">
          📝 Lưu Vào inote.net <span id="inote-btn-count">0 ads</span>
        </button>
      </div>

      <!-- Inote Link Result Banner -->
      <div class="inote-banner" id="inote-banner">
        <div>
          ✅ Đã xuất Inote (<span id="inote-banner-label"></span>):
          <a href="#" target="_blank" id="inote-banner-link">https://inote.net/...</a>
        </div>
        <button class="btn btn-sec" id="btn-copy-inote-link" style="padding:4px 10px; font-size:11.5px;">
          📋 Copy Link
        </button>
      </div>

      <div class="secondary-actions">
        <button class="btn btn-sec grow" id="btn-copy-all">📋 Copy Tất Cả</button>
        <button class="btn btn-sec" id="btn-export-json">JSON</button>
        <button class="btn btn-sec" id="btn-export-csv">CSV</button>
        <button class="btn btn-sec btn-danger-outline" id="btn-clear-results">🗑️ Xóa</button>
      </div>
    </div>

    <!-- Main View Tabs Navigation -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:4px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="btn-tab active" id="tab-btn-results">
          📊 Danh Sách Kết Quả (<span id="tab-count-results">0</span>)
        </button>
        <button class="btn-tab" id="tab-btn-logs">
          📜 Live Logfile Chi Tiết (<span id="tab-count-logs">0 dòng</span>)
        </button>
      </div>
      <div id="log-quick-tools" style="display:none; align-items:center; gap:8px; flex-wrap:wrap;">
        <input type="text" id="input-log-search" placeholder="🔎 Tìm trong log (PASS, LOẠI, Tên Page...)" class="search-input" style="padding:5px 9px; font-size:12px; width:220px;" />
        <label class="chk-label" style="font-size:11.5px;">
          <input type="checkbox" id="chk-log-autoscroll" checked />
          <span>Tự cuộn</span>
        </label>
        <a href="/api/logs/download" target="_blank" class="btn btn-sec" style="text-decoration:none; font-size:11.5px; padding:6px 11px;">
          📥 Tải File Log (.txt)
        </a>
        <button class="btn btn-sec btn-danger-outline" id="btn-clear-logs" style="font-size:11.5px; padding:6px 11px;">
          🗑️ Xóa Log
        </button>
      </div>
    </div>

    <!-- TAB 1: RESULTS VIEW -->
    <div id="view-results" style="display:flex; flex-direction:column; gap:12px;">
      <!-- Display Mode & Virtual Pagination -->
      <div class="pagination-bar">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:12px; color:#94a3b8;">Hiển thị:</span>
          <select id="select-view-mode" class="select-ctrl" style="width:auto; padding:5px 10px;">
            <option value="cards">🃏 Thẻ đầy đủ (20/trang)</option>
            <option value="compact" selected>📋 Danh sách thu gọn (50/trang)</option>
            <option value="zero">⚡ Chỉ thu thập (0 DOM - Siêu nhẹ)</option>
          </select>
        </div>
        <div class="pager-btns">
          <button class="btn-page" id="btn-prev-page">«</button>
          <span style="font-size:12px; color:#38bdf8; font-weight:600;" id="label-page-info">Trang 1/1 (0)</span>
          <button class="btn-page" id="btn-next-page">»</button>
        </div>
      </div>

      <!-- Results Feed -->
      <div id="results-container" class="results-grid"></div>
    </div>

    <!-- TAB 2: LIVE LOGFILE VIEW -->
    <div id="view-logs" style="display:none; flex-direction:column; gap:8px;">
      <div class="log-terminal" id="log-console">
        <div style="color:#64748b; font-style:italic;">[Sẵn sàng] Đang chờ tác vụ tìm kiếm... Toàn bộ tiến trình Giai đoạn 1 & Giai đoạn 2 Minea sẽ hiển thị tại đây theo thời gian thực.</div>
      </div>
    </div>
  </div>

  <!-- Cookie Modal -->
  <div class="modal-backdrop" id="cookie-modal">
    <div class="modal-box">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="font-size:15px;">🍪 Cấu hình Cookie Facebook (Tùy chọn)</h3>
        <button class="clear-input-btn" id="btn-close-cookie" style="position:static;">×</button>
      </div>
      <p style="font-size:12px; color:#94a3b8; margin-top:6px;">
        Mặc định tool sử dụng <b>SSR AST Bypass</b> (chạy trực tiếp không cần Cookie, không bao giờ dính lỗi Rate Limit 1675004).
        Nếu ông chủ muốn phân trang GraphQL sâu hơn 30 kết quả/từ khóa, có thể dán chuỗi Cookie Facebook (chứa <code>c_user=...; xs=...;</code>) vào dưới đây:
      </p>
      <textarea id="textarea-cookie" class="modal-textarea" placeholder="c_user=1000...; xs=...; datr=...;"></textarea>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn btn-sec" id="btn-clear-cookie">Xóa Cookie</button>
        <button class="btn btn-primary" id="btn-save-cookie">Lưu Cookie</button>
      </div>
    </div>
  </div>

  <script>
    let allAds = [];
    let uniquePages = [];
    let currentPage = 1;
    let isRunning = false;
    let currentMode = 'idle';
    let pollTimer = null;
    let logPollTimer = null;
    let allLogs = [];
    let lastLogTimestamp = 0;
    let activeTab = 'results';

    const el = (id) => document.getElementById(id);

    function switchTab(tab) {
      activeTab = tab;
      if (tab === 'results') {
        el('tab-btn-results').className = 'btn-tab active';
        el('tab-btn-logs').className = 'btn-tab';
        el('view-results').style.display = 'flex';
        el('view-logs').style.display = 'none';
        el('log-quick-tools').style.display = 'none';
      } else {
        el('tab-btn-results').className = 'btn-tab';
        el('tab-btn-logs').className = 'btn-tab active';
        el('view-results').style.display = 'none';
        el('view-logs').style.display = 'flex';
        el('log-quick-tools').style.display = 'flex';
        fetchLogs(true);
      }
    }

    async function fetchLogs(forceScroll = false) {
      try {
        const res = await fetch(`/api/logs?since=${lastLogTimestamp}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.logs) && data.logs.length > 0) {
          for (const item of data.logs) {
            allLogs.push(item);
            if (item.timestamp > lastLogTimestamp) {
              lastLogTimestamp = item.timestamp;
            }
          }
          if (allLogs.length > 2000) {
            allLogs = allLogs.slice(allLogs.length - 2000);
          }
          renderLogs(forceScroll);
        } else if (allLogs.length === 0) {
          renderLogs(false);
        }
      } catch (err) {
        console.error('Fetch logs error:', err);
      }
    }

    function renderLogs(forceScroll = false) {
      const term = el('log-console');
      const filter = (el('input-log-search').value || '').trim().toLowerCase();
      const filtered = filter
        ? allLogs.filter(l => l.message.toLowerCase().includes(filter) || l.level.toLowerCase().includes(filter))
        : allLogs;

      el('tab-count-logs').textContent = `${allLogs.length} dòng`;

      if (filtered.length === 0) {
        term.innerHTML = `<div style="color:#64748b; font-style:italic; padding:10px;">
          ${allLogs.length === 0 ? '[Sẵn sàng] Đang chờ tác vụ tìm kiếm... Toàn bộ tiến trình Giai đoạn 1 & Giai đoạn 2 Minea sẽ hiển thị tại đây theo thời gian thực.' : 'Không tìm thấy dòng log nào khớp với từ khóa "' + escapeHtml(filter) + '".'}
        </div>`;
        return;
      }

      term.innerHTML = filtered.map(l => {
        const badgeClass = `log-badge log-badge-${escapeHtml(l.level)}`;
        return `<div class="log-line">
          <span class="log-time">${escapeHtml(l.time)}</span>
          <span class="${badgeClass}">[${escapeHtml(l.level)}]</span>
          <span style="flex:1;">${escapeHtml(l.message)}</span>
        </div>`;
      }).join('');

      if (forceScroll || el('chk-log-autoscroll').checked) {
        term.scrollTop = term.scrollHeight;
      }
    }

    function parseInoteUrl(str) {
      const m = String(str || '').trim().match(/^https?:\/\/(?:www\.)?inote\.net\/([A-Za-z0-9_-]+)/i);
      return m ? m[0] : null;
    }

    function getExportMode() {
      if (el('chk-only-page-name').checked) return 'page_name';
      if (el('chk-only-content').checked) return 'content';
      if (el('chk-only-links').checked) return 'links';
      return 'full';
    }

    function syncExportBadge() {
      const mode = getExportMode();
      const badge = el('badge-export-mode');
      const countSpan = el('inote-btn-count');
      if (mode === 'page_name') {
        badge.textContent = 'Chỉ lấy tên Page';
        const cnt = uniquePages.length || new Set(allAds.map(a => (a.page_name || '').trim()).filter(Boolean)).size;
        countSpan.textContent = `${cnt} pages`;
      } else if (mode === 'content') {
        badge.textContent = 'Chỉ lấy nội dung';
        countSpan.textContent = `${allAds.length} ads`;
      } else if (mode === 'links') {
        badge.textContent = 'Chỉ lấy Link';
        countSpan.textContent = `${allAds.length} ads`;
      } else {
        badge.textContent = 'Đầy đủ 8 trường';
        countSpan.textContent = `${allAds.length} ads`;
      }
      if (el('tab-count-results')) {
        el('tab-count-results').textContent = allAds.length || uniquePages.length || 0;
      }
    }

    function syncSearchTypeBadge() {
      const q = el('input-query').value.trim();
      const isInote = !!parseInoteUrl(q);
      const isPageHunter = el('chk-page-hunter').checked;
      const isExact = el('chk-exact-phrase').checked;
      const badge = el('badge-search-type');
      const ratioRaw = el('input-ph-min-ratio') ? parseFloat(el('input-ph-min-ratio').value) : 50;
      const ratioVal = isNaN(ratioRaw) ? 50 : ratioRaw;
      if (el('hint-ph-ratio')) {
        el('hint-ph-ratio').textContent = ratioVal > 0 ? ratioVal : '0 (Lấy tất cả)';
      }

      if (isPageHunter) {
        badge.textContent = ratioVal > 0 ? `🎯 PAGE_HUNTER_EXACT_${ratioVal}%` : '🎯 PAGE_HUNTER_ALL';
        badge.style.color = '#34d399';
        badge.style.borderColor = 'rgba(16,185,129,0.5)';
      } else if (isInote) {
        badge.textContent = '📑 INOTE_BATCH_QUEUE';
        badge.style.color = '#38bdf8';
        badge.style.borderColor = 'rgba(56,189,248,0.5)';
      } else if (isExact) {
        badge.textContent = 'KEYWORD_EXACT_PHRASE';
        badge.style.color = '#f59e0b';
        badge.style.borderColor = 'rgba(245,158,11,0.5)';
      } else {
        badge.textContent = 'KEYWORD_UNORDERED';
        badge.style.color = '#818cf8';
        badge.style.borderColor = 'rgba(99,102,241,0.4)';
      }

      if (isPageHunter) {
        el('minea-panel').style.display = 'none';
        el('label-stat-total').textContent = 'TỔNG TỪ KHÓA';
        el('label-stat-collected').textContent = ratioVal > 0 ? 'PAGE ĐẠT CHUẨN' : 'PAGE ĐỘC NHẤT';
        el('chk-only-page-name').checked = true;
        el('chk-only-content').checked = false;
        el('chk-only-links').checked = false;
      } else {
        el('minea-panel').style.display = 'block';
        el('label-stat-total').textContent = 'TỔNG TÌM THẤY';
        el('label-stat-collected').textContent = 'ĐÃ THU THẬP';
      }
      syncExportBadge();
    }

    function collectFilters() {
      const platforms = Array.from(document.querySelectorAll('.chk-platform:checked')).map(c => c.value);
      const preset = el('select-date-preset').value;
      let startDate = '';
      if (preset === 'custom') {
        startDate = el('input-date-custom').value || '';
      } else if (preset !== 'ALL') {
        const now = new Date();
        const daysMap = { '7d': 7, '30d': 30, '3m': 90, '6m': 180, '1y': 365 };
        const d = new Date(now.getTime() - (daysMap[preset] || 0) * 86400000);
        startDate = d.toISOString().split('T')[0];
      }
      return {
        query: el('input-query').value.trim(),
        exactPhrase: el('chk-exact-phrase').checked,
        country: el('select-country').value,
        adType: el('select-ad-type').value,
        publisherPlatforms: platforms,
        mediaType: el('select-media-type').value,
        activeStatus: el('select-active-status').value,
        startDateMin: startDate,
        contentLanguages: el('select-lang').value === 'ALL' ? [] : [el('select-lang').value],
        sortBy: el('select-sort-by').value,
      };
    }

    function renderResults() {
      const container = el('results-container');
      const viewMode = el('select-view-mode').value;
      if (viewMode === 'zero') {
        container.innerHTML = `<div class="panel-card" style="grid-column:1/-1; text-align:center; color:#94a3b8;">
          ⚡ Chế độ 0 DOM đang bật. Đã thu thập <b>${allAds.length}</b> bản ghi trong bộ nhớ (Sẵn sàng xuất Inote / Copy / JSON / CSV).
        </div>`;
        el('label-page-info').textContent = `0 DOM (${allAds.length})`;
        return;
      }

      const pageSize = viewMode === 'compact' ? 50 : 20;
      const totalItems = allAds.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      if (currentPage > totalPages) currentPage = totalPages;
      const startIdx = (currentPage - 1) * pageSize;
      const slice = allAds.slice(startIdx, startIdx + pageSize);

      el('label-page-info').textContent = `Trang ${currentPage}/${totalPages} (${totalItems})`;
      el('btn-prev-page').disabled = currentPage <= 1;
      el('btn-next-page').disabled = currentPage >= totalPages;

      if (slice.length === 0) {
        container.innerHTML = '';
        return;
      }

      if (viewMode === 'compact') {
        container.style.gridTemplateColumns = '1fr';
        container.innerHTML = slice.map((ad, idx) => {
          const num = startIdx + idx + 1;
          const pName = escapeHtml(ad.page_name || 'Unknown Page');
          const archId = escapeHtml(ad.archive_id || ad.ad_archive_id || '');
          const mineaBadge = (ad.minea_ratio !== undefined)
            ? `<span style="font-size:11px; font-weight:700; padding:2px 7px; border-radius:99px; background:rgba(249,115,22,0.16); color:#fb923c; border:1px solid rgba(249,115,22,0.4);">🔥 ${ad.active_camp}/${ad.total_camp} (${ad.minea_ratio}%)</span>`
            : '';
          const caption = escapeHtml((ad.caption_text || ad.body_text || '').slice(0, 60));
          return `<div class="compact-row">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
              <span style="color:#64748b; font-weight:700;">#${num}</span>
              <span class="ad-page-name" onclick="copyText('${escapeJs(ad.page_name || '')}')">${pName}</span>
              ${mineaBadge}
              <span style="color:#64748b; font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${caption}</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              ${ad.link_url ? `<a href="${escapeHtml(ad.link_url)}" target="_blank" class="btn-page" style="text-decoration:none; color:#38bdf8;">🌐 Page Ads</a>` : ''}
              ${archId && !archId.startsWith('ph_') ? `<a href="https://www.facebook.com/ads/library/?id=${archId}" target="_blank" class="btn-page" style="text-decoration:none;">🔗 Ads</a>` : ''}
              <button class="btn-page" onclick="copyText('${escapeJs(ad.page_name || '')}')">📋 Copy Tên Page</button>
            </div>
          </div>`;
        }).join('');
      } else {
        container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(430px, 1fr))';
        container.innerHTML = slice.map((ad, idx) => {
          const num = startIdx + idx + 1;
          const pName = escapeHtml(ad.page_name || 'Unknown Page');
          const pId = escapeHtml(ad.page_id || 'N/A');
          const archId = escapeHtml(ad.archive_id || ad.ad_archive_id || 'N/A');
          const body = escapeHtml(ad.caption_text || ad.body_text || '(Không có nội dung văn bản)');
          const link = ad.link_url || ad.caption_url || '';
          const fmt = escapeHtml(ad.creative_format || ad.media_type || 'ALL');
          return `<div class="ad-card">
            <div class="ad-card-top">
              <span class="ad-page-name" onclick="copyText('${escapeJs(ad.page_name || '')}')" title="Click để copy tên Page">#${num} ${pName}</span>
              <span class="ad-badge">${ad.is_active !== false ? '● Active' : 'Inactive'} • ${fmt}</span>
            </div>
            <div class="ad-meta">
              <span>Archive ID: <b>${archId}</b></span>
              <span>Page ID: <b>${pId}</b></span>
            </div>
            <div class="ad-body">${body}</div>
            <div class="ad-footer">
              <div style="display:flex; gap:6px;">
                <button class="btn-page" onclick="copyText('${escapeJs(ad.page_name || '')}')">📋 Tên Page</button>
                <button class="btn-page" onclick="copyText('${escapeJs(ad.caption_text || ad.body_text || '')}')">📋 Nội dung</button>
              </div>
              <div style="display:flex; gap:6px;">
                ${link ? `<a href="${escapeHtml(link)}" target="_blank" class="btn-page" style="text-decoration:none; color:#38bdf8;">🌐 Link Đích</a>` : ''}
                ${archId && !archId.startsWith('ph_') ? `<a href="https://www.facebook.com/ads/library/?id=${archId}" target="_blank" class="btn-page" style="text-decoration:none; color:#34d399;">🔗 Mở Ad</a>` : ''}
              </div>
            </div>
          </div>`;
        }).join('');
      }
    }

    function escapeHtml(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escapeJs(s) {
      return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    }

    function updateMineaUI(m) {
      if (!m) return;
      el('minea-active-val').textContent = m.activeFormatted || '0';
      el('minea-active-sub').textContent = `Chính xác: ${(m.activeCount || 0).toLocaleString()} camp`;
      el('minea-total-val').textContent = m.totalFormatted || '0';
      el('minea-total-sub').textContent = `Tổng: ${(m.totalCount || 0).toLocaleString()} camp`;
      el('minea-ratio-val').textContent = `${m.ratio || '0.0'}%`;
      const r = parseFloat(m.ratio || '0');
      el('minea-bar-fill').style.width = `${Math.min(100, Math.max(0, r))}%`;
      if (m.status === 'loading') {
        el('minea-ratio-sub').textContent = '⏳ Đang phân tích...';
      } else if (m.status === 'done') {
        el('minea-ratio-sub').textContent = r >= 60 ? `🔥 Đang vít mạnh (${m.activeFormatted}/${m.totalFormatted})` : `⚡ Duy trì đều (${m.activeFormatted}/${m.totalFormatted})`;
      } else if (m.status === 'error') {
        el('minea-ratio-sub').textContent = m.error || 'Lỗi kiểm tra';
      }
    }

    async function pollState() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        isRunning = data.isRunning;
        currentMode = data.mode;

        el('status-text').textContent = data.statusText || 'Sẵn sàng';
        el('status-dot').className = isRunning ? 'status-dot running' : 'status-dot';

        const startBtn = el('btn-start-search');
        if (isRunning) {
          startBtn.textContent = '⏹ Dừng tìm kiếm';
          startBtn.className = 'btn btn-stop';
        } else {
          startBtn.textContent = '🚀 Bắt đầu tìm kiếm';
          startBtn.className = 'btn btn-primary';
        }

        el('val-stat-total').textContent = data.totalCount || 0;
        el('val-stat-collected').textContent = data.collectedCount || 0;
        el('val-stat-batch').textContent = data.batchStatusText || 'Chờ lệnh';
        el('progress-bar-fill').style.width = `${data.progressPct || 0}%`;

        el('cookie-indicator').textContent = data.hasCookie ? '(Đã gắn Cookie)' : '(Mặc định: SSR Không Cookie)';

        if (data.minea && !el('chk-page-hunter').checked) {
          updateMineaUI(data.minea);
        }

        if (Array.isArray(data.ads) && data.ads.length !== allAds.length) {
          allAds = data.ads;
          uniquePages = data.uniquePages || [];
          syncExportBadge();
          renderResults();
        } else if (!isRunning && Array.isArray(data.ads)) {
          allAds = data.ads;
          uniquePages = data.uniquePages || [];
          syncExportBadge();
          renderResults();
        }

        if (data.lastInoteUrl) {
          el('inote-banner').style.display = 'flex';
          el('inote-banner-link').href = data.lastInoteUrl;
          el('inote-banner-link').textContent = data.lastInoteUrl;
          el('inote-banner-label').textContent = data.lastInoteLabel || `${allAds.length} mục`;
        }

        // Luôn cập nhật live log
        fetchLogs();

        if (!isRunning && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }

    // Event bindings
    el('input-query').addEventListener('input', syncSearchTypeBadge);
    el('chk-exact-phrase').addEventListener('change', syncSearchTypeBadge);
    
    el('chk-page-hunter').addEventListener('change', syncSearchTypeBadge);
    if (el('input-ph-min-ratio')) {
      el('input-ph-min-ratio').addEventListener('input', syncSearchTypeBadge);
    }

    el('btn-clear-query').addEventListener('click', () => {
      el('input-query').value = '';
      syncSearchTypeBadge();
    });

    el('adv-toggle').addEventListener('click', () => {
      const body = el('adv-body');
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      el('adv-arrow').textContent = hidden ? '▲' : '▼';
    });

    el('select-date-preset').addEventListener('change', () => {
      el('input-date-custom').style.display = el('select-date-preset').value === 'custom' ? 'block' : 'none';
    });

    ['chk-only-content', 'chk-only-links', 'chk-only-page-name'].forEach(id => {
      el(id).addEventListener('change', (e) => {
        if (e.target.checked) {
          ['chk-only-content', 'chk-only-links', 'chk-only-page-name'].forEach(other => {
            if (other !== id) el(other).checked = false;
          });
        }
        syncExportBadge();
      });
    });

    el('select-view-mode').addEventListener('change', () => {
      currentPage = 1;
      renderResults();
    });
    el('btn-prev-page').addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; renderResults(); }
    });
    el('btn-next-page').addEventListener('click', () => {
      currentPage++;
      renderResults();
    });

    el('btn-start-search').addEventListener('click', async () => {
      if (isRunning) {
        await fetch('/api/cancel', { method: 'POST' });
        await pollState();
        return;
      }
      const filters = collectFilters();
      if (!filters.query) {
        alert('Vui lòng nhập từ khóa, tên Page hoặc dán link https://inote.net/...!');
        return;
      }
      el('inote-banner').style.display = 'none';
      allAds = [];
      uniquePages = [];
      currentPage = 1;
      renderResults();

      const ratioRaw = el('input-ph-min-ratio') ? parseFloat(el('input-ph-min-ratio').value) : 50;
      const minRatio = isNaN(ratioRaw) ? 50 : ratioRaw;
      await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          pageHunterMode: el('chk-page-hunter').checked,
          maxWorkers: parseInt(el('select-workers').value || '5', 10),
          filterByMinea: (minRatio > 0),
          minMineaRatio: minRatio,
          mineaLookupMode: 'exact_name',
        }),
      });
      if (!pollTimer) {
        pollTimer = setInterval(pollState, 900);
      }
      await pollState();
    });

    el('btn-check-minea').addEventListener('click', async () => {
      const filters = collectFilters();
      if (!filters.query) {
        alert('Vui lòng nhập từ khóa hoặc tên Page trước khi Check nhanh!');
        return;
      }
      updateMineaUI({ status: 'loading', activeFormatted: '...', totalFormatted: '...', ratio: '...' });
      const res = await fetch('/api/minea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      const data = await res.json();
      updateMineaUI(data);
    });

    el('btn-save-inote').addEventListener('click', async () => {
      if (allAds.length === 0 && uniquePages.length === 0) {
        alert('Chưa có dữ liệu để xuất Inote!');
        return;
      }
      const btn = el('btn-save-inote');
      const oldHtml = btn.innerHTML;
      btn.innerHTML = '⏳ Đang tạo link inote.net...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/export-inote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: getExportMode() }),
        });
        const data = await res.json();
        if (data.success && data.url) {
          el('inote-banner').style.display = 'flex';
          el('inote-banner-link').href = data.url;
          el('inote-banner-link').textContent = data.url;
          el('inote-banner-label').textContent = data.label || '';
          await copyText(data.url);
        } else {
          alert('Lỗi xuất Inote: ' + (data.error || 'Không xác định'));
        }
      } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        syncExportBadge();
      }
    });

    el('btn-copy-inote-link').addEventListener('click', async () => {
      const url = el('inote-banner-link').textContent;
      await copyText(url);
      el('btn-copy-inote-link').textContent = '✅ Đã Copy!';
      setTimeout(() => { el('btn-copy-inote-link').textContent = '📋 Copy Link'; }, 1500);
    });

    el('btn-copy-all').addEventListener('click', async () => {
      if (allAds.length === 0) return;
      const res = await fetch('/api/format-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: getExportMode() }),
      });
      const data = await res.json();
      if (data.text) {
        await copyText(data.text);
        el('btn-copy-all').textContent = '✅ Đã Copy vào Clipboard!';
        setTimeout(() => { el('btn-copy-all').textContent = '📋 Copy Tất Cả'; }, 1600);
      }
    });

    el('btn-export-json').addEventListener('click', () => {
      if (allAds.length === 0) return;
      const blob = new Blob([JSON.stringify(allAds, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fb_ads_${Date.now()}.json`;
      a.click();
    });

    el('btn-export-csv').addEventListener('click', () => {
      if (allAds.length === 0) return;
      const headers = ['archive_id', 'page_id', 'page_name', 'is_active', 'creative_format', 'link_url', 'caption_text'];
      const rows = [headers.join(',')];
      for (const ad of allAds) {
        rows.push(headers.map(h => `"${String(ad[h] ?? '').replace(/"/g, '""')}"`).join(','));
      }
      const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fb_ads_${Date.now()}.csv`;
      a.click();
    });

    el('btn-clear-results').addEventListener('click', async () => {
      await fetch('/api/clear', { method: 'POST' });
      allAds = [];
      uniquePages = [];
      el('inote-banner').style.display = 'none';
      syncExportBadge();
      renderResults();
      await pollState();
    });

    // Main Tabs Switcher Events
    el('tab-btn-results').addEventListener('click', () => switchTab('results'));
    el('tab-btn-logs').addEventListener('click', () => switchTab('logs'));

    // Log Tools Events
    el('input-log-search').addEventListener('input', () => renderLogs(false));
    el('btn-clear-logs').addEventListener('click', async () => {
      if (confirm('Ông chủ có chắc muốn xóa sạch toàn bộ log không?')) {
        await fetch('/api/logs/clear', { method: 'POST' });
        allLogs = [];
        lastLogTimestamp = 0;
        renderLogs(false);
      }
    });

    // Cookie modal
    el('btn-open-cookie').addEventListener('click', () => {
      el('cookie-modal').style.display = 'flex';
    });
    el('btn-close-cookie').addEventListener('click', () => {
      el('cookie-modal').style.display = 'none';
    });
    el('btn-save-cookie').addEventListener('click', async () => {
      const cookie = el('textarea-cookie').value.trim();
      await fetch('/api/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie }),
      });
      el('cookie-modal').style.display = 'none';
      await pollState();
    });
    el('btn-clear-cookie').addEventListener('click', async () => {
      el('textarea-cookie').value = '';
      await fetch('/api/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: '' }),
      });
      el('cookie-modal').style.display = 'none';
      await pollState();
    });

    syncSearchTypeBadge();
    pollState();
    fetchLogs(true);
    setInterval(() => {
      if (isRunning || activeTab === 'logs') {
        fetchLogs(false);
      }
    }, 1000);
  </script>
</body>
</html>
"""


class FindAdsRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler serving the standalone Find Ads Web UI and REST API."""

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            raw = HTML_DASHBOARD.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return

        if parsed.path == "/api/status":
            qs = parse_qs(parsed.query)
            include_ads = qs.get("include_ads", ["1"])[0] != "0"
            self._send_json(STATE.to_dict(include_ads=include_ads))
            return

        if parsed.path == "/api/logs":
            qs = parse_qs(parsed.query)
            since_ts = float(qs.get("since", ["0"])[0] or "0")
            self._send_json({"success": True, "logs": LOGGER.get_logs(since_ts)})
            return

        if parsed.path == "/api/logs/download":
            try:
                with open(LOGGER.log_path, "rb") as f:
                    content = f.read()
            except Exception:
                content = b""
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="hunter_{int(time.time())}.log"')
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        body = self._read_json_body()

        if parsed.path == "/api/logs/clear":
            LOGGER.clear()
            self._send_json({"success": True})
            return

        if parsed.path == "/api/search":
            res = start_search_job(body)
            self._send_json(res)
            return

        if parsed.path == "/api/cancel":
            STATE.engine.cancel()
            with STATE.lock:
                STATE.is_running = False
                STATE.status_text = f"Đã dừng ({len(STATE.ads)} kết quả)"
                STATE.batch_status_text = "Đã dừng bởi người dùng"
            self._send_json({"success": True})
            return

        if parsed.path == "/api/clear":
            STATE.engine.cancel()
            with STATE.lock:
                STATE.is_running = False
                STATE.ads = []
                STATE.unique_pages = []
                STATE.total_count = 0
                STATE.collected_count = 0
                STATE.progress_pct = 0.0
                STATE.last_inote_url = None
                STATE.status_text = "Đã xóa kết quả"
                STATE.batch_status_text = "Chờ lệnh"
            self._send_json({"success": True})
            return

        if parsed.path == "/api/cookie":
            cookie_str = (body.get("cookie") or "").strip()
            STATE.engine.set_cookie_string(cookie_str)
            self._send_json({"success": True, "hasCookie": bool(cookie_str)})
            return

        if parsed.path == "/api/minea":
            raw_filters = body.get("filters") or {}
            params = normalize_ui_filters(raw_filters)
            try:
                m_res = STATE.engine.fetch_active_vs_total_counts(params)
                out = {
                    "status": "done",
                    "activeCount": m_res["activeCount"],
                    "totalCount": m_res["totalCount"],
                    "activeFormatted": m_res["formattedActive"],
                    "totalFormatted": m_res["formattedTotal"],
                    "ratio": str(m_res["ratioPercent"]),
                }
            except Exception as e:
                out = {
                    "status": "error",
                    "activeCount": 0,
                    "totalCount": 0,
                    "activeFormatted": "0",
                    "totalFormatted": "0",
                    "ratio": "0.0",
                    "error": str(e),
                }
            with STATE.lock:
                STATE.minea = out
            self._send_json(out)
            return

        if parsed.path == "/api/format-text":
            mode = body.get("mode") or "full"
            with STATE.lock:
                ads_copy = list(STATE.ads)
            text = InoteService.format_all_ads(ads_copy, format_mode=mode)
            self._send_json({"success": True, "text": text})
            return

        if parsed.path == "/api/export-inote":
            mode = body.get("mode") or "full"
            with STATE.lock:
                ads_copy = list(STATE.ads)
                pages_copy = list(STATE.unique_pages)

            if mode == "page_name" and pages_copy:
                text = "\n".join(pages_copy)
                label = f"{len(pages_copy)} Page độc nhất"
            else:
                text = InoteService.format_all_ads(ads_copy, format_mode=mode)
                label = f"{len(ads_copy)} kết quả"

            if not text.strip():
                self._send_json({"success": False, "error": "Không có dữ liệu hợp lệ để xuất Inote."})
                return

            try:
                note_res = InoteService.create_note(text, open_browser=False)
                note_url = note_res.get("noteUrl")
                if note_res.get("success") and note_url:
                    with STATE.lock:
                        STATE.last_inote_url = note_url
                        STATE.last_inote_label = label
                    self._send_json({"success": True, "url": note_url, "label": label})
                else:
                    self._send_json({"success": False, "error": "Không lấy được URL Inote."})
            except Exception as e:
                self._send_json({"success": False, "error": str(e)})
            return

        self._send_json({"error": "Not found"}, status=404)


def find_free_port(preferred: int = 8765) -> int:
    for port in range(preferred, preferred + 25):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return preferred


def run_cli(args: argparse.Namespace) -> int:
    """Run Find Ads or Page Hunter directly in CLI mode."""
    engine = FacebookAdsHunterEngine(cookie_string=args.cookie or "")
    params = {
        "keyword": args.inote or args.keyword or "",
        "rawKeyword": args.inote or args.keyword or "",
        "isExactPhrase": args.exact,
        "country": args.country,
        "category": "ALL",
        "activeStatus": args.status,
        "mediaType": args.media,
        "publisherPlatforms": [],
        "language": args.lang or "ALL",
        "startDate": args.start_date or None,
        "sortBy": "SORT_BY_TOTAL_IMPRESSIONS",
    }

    if args.inote and args.page_hunter:
        print(f"[*] Bắt đầu chế độ 🎯 Page Hunter Turbo ({args.workers} luồng) cho: {args.inote}")

        def _cb(p: Dict[str, Any]) -> None:
            if p.get("currentPage", 0) > 0:
                print(f"  -> {p.get('statusMessage')}")

        res = engine.run_page_hunter_batch(
            inote_url_or_keywords=args.inote,
            base_params=params,
            on_progress=_cb,
            concurrency=args.workers,
            auto_export_inote=True,
            open_inote_tab=False,
            filter_by_minea=not args.no_minea_filter,
            min_minea_ratio=args.min_ratio,
            minea_lookup_mode=args.minea_mode,
        )
        auto_note = res.get("autoNoteResult") or {}
        print("\n================ KẾT QUẢ PAGE HUNTER ================")
        print(f"- Tổng số từ khóa                : {res.get('totalKeywords')}")
        print(f"- Tổng Page độc nhất (Giai đoạn 1): {res.get('rawUniqueCount')}")
        if not args.no_minea_filter:
            print(f"- Số Page đạt Minea > {args.min_ratio:g}% (GĐ2) : {res.get('uniquePageCount')}")
        print(f"- Link Inote xuất ra             : {auto_note.get('noteUrl')}")
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write("\n".join(p["page_name"] for p in res.get("pages", [])))
            print(f"- Đã lưu file local    : {args.output}")
        return 0

    elif args.inote:
        print(f"[*] Bắt đầu quét hàng loạt từ khóa Inote: {args.inote}")
        ads = engine.search_inote_keyword_batch(inote_url=args.inote, base_params=params)
        print(f"[+] Thu thập hoàn tất: {len(ads)} ads.")
        formatted = InoteService.format_all_ads(ads, format_mode=args.export_mode)
        if formatted:
            note_res = InoteService.create_note(formatted, open_browser=False)
            print(f"[+] Link Inote kết quả: {note_res.get('noteUrl')}")
        return 0

    else:
        print(f"[*] Đang tìm kiếm từ khóa: {params['keyword']} (Country={params['country']})")
        minea = engine.fetch_active_vs_total_counts(params)
        print(
            f"[+] Minea Analytics: Active={minea.get('formattedActive')} ({minea.get('activeCount')}) | "
            f"Total={minea.get('formattedTotal')} ({minea.get('totalCount')}) | Ratio={minea.get('ratioPercent')}%"
        )
        ads = engine.search_and_paginate_all(params=params)
        print(f"[+] Đã thu thập: {len(ads)} ads.")
        if ads:
            formatted = InoteService.format_all_ads(ads, format_mode=args.export_mode)
            note_res = InoteService.create_note(formatted, open_browser=False)
            print(f"[+] Link Inote kết quả: {note_res.get('noteUrl')}")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="FB Ads Library Hunter - Standalone Python Tool")
    parser.add_argument("--inote", type=str, help="Link https://inote.net/... chứa danh sách từ khóa")
    parser.add_argument("--keyword", type=str, help="Từ khóa hoặc tên Page cần tìm kiếm")
    parser.add_argument("--page-hunter", action="store_true", help="Bật chế độ Page Hunter Turbo đa luồng")
    parser.add_argument("--exact", action="store_true", help="Tìm kiếm cụm từ chính xác (Exact phrase)")
    parser.add_argument("--country", type=str, default="US", help="Mã quốc gia (Mặc định: US)")
    parser.add_argument("--status", type=str, default="ACTIVE", help="ACTIVE, ALL, INACTIVE")
    parser.add_argument("--media", type=str, default="ALL", help="ALL, VIDEO, IMAGE, MEME, NONE")
    parser.add_argument("--lang", type=str, default="ALL", help="Mã ngôn ngữ (en, vi, ALL)")
    parser.add_argument("--start-date", type=str, default="", help="Từ ngày YYYY-MM-DD")
    parser.add_argument("--workers", type=int, default=5, help="Số luồng Page Hunter (Mặc định: 5)")
    parser.add_argument("--min-ratio", type=float, default=50.0, help="Ngưỡng tỷ lệ Active/Total Minea tối thiểu (Mặc định: > 50%%)")
    parser.add_argument("--no-minea-filter", action="store_true", help="Tắt lọc Minea Active/Total ở Bước 2 của Page Hunter")
    parser.add_argument("--minea-mode", type=str, default="page_id", choices=["page_id", "exact_name", "keyword"], help="Chế độ đo Active/Total của Page")
    parser.add_argument("--export-mode", type=str, default="full", choices=["full", "content", "links", "page_name"])
    parser.add_argument("--cookie", type=str, default="", help="Chuỗi Cookie Facebook (Tùy chọn)")
    parser.add_argument("--output", type=str, default="", help="Đường dẫn file xuất kết quả local")
    parser.add_argument("--port", type=int, default=8765, help="Cổng chạy giao diện Web UI (Mặc định: 8765)")
    parser.add_argument("--no-browser", action="store_true", help="Không tự động mở trình duyệt khi khởi động server")

    args = parser.parse_args()

    if args.inote or args.keyword:
        sys.exit(run_cli(args))

    port = find_free_port(args.port)
    server = ThreadingHTTPServer(("127.0.0.1", port), FindAdsRequestHandler)
    url = f"http://127.0.0.1:{port}"
    print("=" * 68)
    print(" 🚀 FB ADS LIBRARY HUNTER - PYTHON STANDALONE TOOL")
    print(f" 🌐 Giao diện Web UI đang chạy tại: {url}")
    print(" ⚡ Cơ chế: SSR AST Bypass (Không cần đăng nhập FB, Không bị Rate Limit)")
    print(" 🛑 Nhấn Ctrl+C để đóng ứng dụng.")
    print("=" * 68)

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Đang đóng server...")
        server.server_close()


if __name__ == "__main__":
    main()
