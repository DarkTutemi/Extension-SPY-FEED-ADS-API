# -*- coding: utf-8 -*-
"""
Automated Verification & Live Test Suite for tool-find-ads
Tests:
1. InoteService URL parsing, fetching, 4 export modes, and note creation
2. Single Keyword Search + Minea Analytics (Active vs Total Camp)
3. Live Page Hunter Turbo Mode on https://inote.net/286X9fdKNB (38 keywords) + Auto Inote Export
"""

import os
import sys
import time
from engine import FacebookAdsHunterEngine, InoteService

sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    print("=" * 72)
    print("🧪 BẮT ĐẦU KIỂM THỬ TOOL PYTHON: F:\\Extension-SPY-FEED-ADS-API\\tool-find-ads")
    print("=" * 72)

    # 1. Test parse_inote_url & fetch_keywords_from_note
    target_inote = "https://inote.net/286X9fdKNB"
    parsed_url = InoteService.parse_inote_url(target_inote)
    assert parsed_url == "https://inote.net/286X9fdKNB", f"Lỗi parse_inote_url: {parsed_url}"
    keywords = InoteService.fetch_keywords_from_note(target_inote)
    assert len(keywords) > 0, "Không tải được dòng từ khóa nào từ Inote"
    print(f"[PASS 1/4] Tải danh sách từ khóa từ {target_inote}: {len(keywords)} dòng từ khóa.")

    # 2. Test Single Keyword + Minea Active vs Total
    engine = FacebookAdsHunterEngine()
    sample_kw = keywords[0]
    print(f"\n[*] Đang test tìm kiếm đơn & Minea Analytics với từ khóa: {sample_kw[:55]}...")
    minea = engine.fetch_active_vs_total_counts({"keyword": sample_kw, "country": "US"})
    assert minea["totalCount"] >= minea["activeCount"], f"Lỗi Minea: {minea}"
    print(
        f"[PASS 2/4] Minea Analytics: Active={minea['formattedActive']} ({minea['activeCount']}) | "
        f"Total={minea['formattedTotal']} ({minea['totalCount']}) | Ratio={minea['ratioPercent']}%"
    )

    single_ads = engine.search_and_paginate_all(
        {"keyword": sample_kw, "country": "US", "activeStatus": "ACTIVE"},
        max_batches=1,
    )
    assert len(single_ads) > 0, "Lỗi tìm kiếm đơn"
    print(f"[PASS 3/4] Tìm kiếm đơn thu thập được: {len(single_ads)} ads.")

    # Verify all 4 format modes
    for mode in ("full", "content", "links", "page_name"):
        out = InoteService.format_all_ads(single_ads, format_mode=mode)
        assert isinstance(out, str) and len(out) > 0, f"Lỗi format mode {mode}"

    # 3. Live Page Hunter Turbo on https://inote.net/286X9fdKNB
    print(f"\n[*] Đang chạy 🎯 Page Hunter Turbo (5 luồng) cho toàn bộ {len(keywords)} từ khóa từ {target_inote}...")
    t0 = time.time()

    def on_progress(p):
        done = p.get("currentPage", 0)
        tot = p.get("totalFound", 0)
        cnt = p.get("extractedCount", 0)
        if done > 0 and (done % 5 == 0 or done == tot):
            print(f"    -> Tiến độ: {done}/{tot} từ khóa | Đã gom: {cnt} Page độc nhất")

    ph_res = engine.run_page_hunter_batch(
        inote_url_or_keywords=target_inote,
        base_params={"country": "US", "activeStatus": "ACTIVE", "category": "ALL"},
        on_progress=on_progress,
        concurrency=5,
        auto_export_inote=True,
        open_inote_tab=False,
    )
    elapsed = round(time.time() - t0, 2)
    pages_list = ph_res.get("pages") or []
    auto_note = ph_res.get("autoNoteResult") or {}
    exported_url = auto_note.get("noteUrl")

    assert len(pages_list) > 0, "Không thu thập được Page nào"
    assert exported_url, "Không tự động xuất ra link Inote"

    unique_names = [p["page_name"] for p in pages_list]

    print(f"\n[PASS 4/4] 🎯 HOÀN TẤT PAGE HUNTER TRONG {elapsed} GIÂY!")
    print(f"  + Tổng từ khóa đã quét   : {ph_res['completedKeywords']}/{ph_res['totalKeywords']}")
    print(f"  + Tổng Page độc nhất     : {ph_res['uniquePageCount']} Pages")
    print(f"  + Link Inote xuất tự động: {exported_url}")
    print("  + 15 Page đầu tiên       :", ", ".join(unique_names[:15]))

    out_path = os.path.join(os.path.dirname(__file__), "page_hunter_286X9fdKNB_result.txt")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(unique_names))
    print(f"  + Đã lưu bản sao local   : {out_path}")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
