#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_facebook_ads_automation.py
Complete Facebook Ads Library automation & GraphQL interception script using Playwright over CDP with GPM Login profile.

Key Architecture:
1. Dynamic remote debugging port resolution via GPM Login Local API.
2. Connection to active Chromium browser profile over Chrome DevTools Protocol (CDP).
3. Navigation to Facebook Ads Library target URL.
4. Country selection / confirmation: United States (US).
5. Keyword search: "DallasWind US" (with typeahead and recent searches handling).
6. Filter dialog modal interaction:
   - Platform: 3 options selected (Facebook, Instagram, Audience Network)
   - Active status: "Active ads"
   - Impressions by date: "11/03/2026" (On or after Nov 3, 2026)
   - Language: "English"
7. Verification that button dynamically displays "Apply 4 filters" and click submission.
8. Real-time interception and persistence of:
   - F:\\Extension-SPY-FEED-ADS-API\\captured_graphql_request.json
   - F:\\Extension-SPY-FEED-ADS-API\\captured_graphql_response.json
"""

import sys
import os
import json
import time
import re
import requests
from urllib.parse import parse_qs
from playwright.sync_api import sync_playwright

# Ensure stdout handles UTF-8 cleanly on Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Configuration Constants
GPM_API_BASE = "http://127.0.0.1:9495"
PROFILE_ID = "a5374bbd-46ed-457d-9790-935ffa826471"
TARGET_URL = (
    "https://www.facebook.com/ads/library/?"
    "active_status=all&ad_type=all&country=US&is_targeted_country=false&"
    "media_type=all&search_type=page&sort_data[mode]=total_impressions&"
    "sort_data[direction]=desc&source=page-transparency-widget&view_all_page_id=1"
)

WORKSPACE_ROOT = os.path.abspath(os.path.dirname(__file__))
OUTPUT_REQUEST_PATH = os.path.join(WORKSPACE_ROOT, "captured_graphql_request.json")
OUTPUT_RESPONSE_PATH = os.path.join(WORKSPACE_ROOT, "captured_graphql_response.json")


def get_gpm_remote_debugging_port(profile_id: str) -> int:
    """
    Queries GPM Login Local API to launch/query profile and obtain the active remote debugging port.
    """
    url = f"{GPM_API_BASE}/api/v1/profiles/start/{profile_id}?skip_proxy_check=true"
    print(f"[*] Querying GPM Login API: {url}")
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get("success") and "data" in data:
            port = data["data"].get("remote_debugging_port")
            if port:
                print(f"[+] Successfully resolved GPM remote debugging port: {port}")
                return int(port)
        raise RuntimeError(f"Unexpected response from GPM API: {data}")
    except Exception as e:
        print(f"[!] Warning: GPM API query error: {e}. Falling back to port 64646.")
        return 64646


def parse_relay_deferred_response(raw_text: str):
    """
    Parses Meta's GraphQL multi-line chunked response (Relay Incremental Delivery @defer).
    Strips anti-XSSI 'for (;;);' header and decodes JSON lines.
    """
    cleaned = raw_text.strip()
    if cleaned.startswith("for (;;);"):
        cleaned = cleaned[len("for (;;);"):].strip()

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    parsed_chunks = []
    search_connection = None

    for line in lines:
        try:
            chunk = json.loads(line)
            parsed_chunks.append(chunk)

            # Check root data
            if "data" in chunk and isinstance(chunk["data"], dict):
                main = chunk["data"].get("ad_library_main", {})
                if "search_results_connection" in main:
                    search_connection = main["search_results_connection"]

            # Check deferred fragment payload
            if "data" in chunk and isinstance(chunk["data"], dict):
                if "search_results_connection" in chunk["data"]:
                    search_connection = chunk["data"]["search_results_connection"]

                for k, v in chunk["data"].items():
                    if isinstance(v, dict) and "search_results_connection" in v:
                        search_connection = v["search_results_connection"]
        except Exception:
            continue

    return parsed_chunks, search_connection


def main():
    print("=" * 75)
    print(" Facebook Ads Library Automation & GraphQL Interceptor ")
    print("=" * 75)

    # 1. Resolve Remote Debugging Port
    port = get_gpm_remote_debugging_port(PROFILE_ID)
    cdp_url = f"http://127.0.0.1:{port}"

    captured_requests = []
    captured_responses = []

    with sync_playwright() as p:
        print(f"[*] Connecting Playwright over CDP to: {cdp_url}")
        browser = p.chromium.connect_over_cdp(cdp_url)
        context = browser.contexts[0]

        # Verify Facebook session cookies
        cookies = context.cookies()
        fb_cookies = [c['name'] for c in cookies if 'facebook.com' in c.get('domain', '')]
        is_authenticated = 'c_user' in fb_cookies and 'xs' in fb_cookies
        print(f"[+] Facebook Authentication Status: {'AUTHENTICATED (c_user present)' if is_authenticated else 'UNAUTHENTICATED'}")

        # Locate active page or open target
        pages = context.pages
        page = pages[0] if pages else context.new_page()

        # Attach Network Interception Listeners
        def on_request(req):
            if "/api/graphql/" in req.url:
                post_data = req.post_data or ""
                parsed = parse_qs(post_data)
                friendly_name = (
                    req.headers.get("x-fb-friendly-name") or
                    parsed.get("fb_api_req_friendly_name", [""])[0]
                )
                doc_id = parsed.get("doc_id", [""])[0]
                fb_dtsg = parsed.get("fb_dtsg", [""])[0]
                user_id = parsed.get("__user", [""])[0]
                rev = parsed.get("__rev", [""])[0]
                lsd = parsed.get("lsd", [""])[0]
                jazoest = parsed.get("jazoest", [""])[0]
                variables_raw = parsed.get("variables", ["{}"])[0]

                try:
                    variables = json.loads(variables_raw)
                except Exception:
                    variables = variables_raw

                record = {
                    "timestamp": time.time(),
                    "url": req.url,
                    "method": req.method,
                    "headers": dict(req.headers),
                    "friendly_name": friendly_name,
                    "doc_id": doc_id,
                    "fb_dtsg": fb_dtsg,
                    "__user": user_id,
                    "__rev": rev,
                    "lsd": lsd,
                    "jazoest": jazoest,
                    "variables": variables,
                    "raw_post_data": post_data
                }
                captured_requests.append(record)

        def on_response(res):
            if "/api/graphql/" in res.url:
                try:
                    body = res.text()
                except Exception:
                    body = ""
                captured_responses.append({
                    "timestamp": time.time(),
                    "url": res.url,
                    "status": res.status,
                    "headers": dict(res.headers),
                    "length": len(body),
                    "body": body
                })

        page.on("request", on_request)
        page.on("response", on_response)

        # 2. Navigate to Target URL
        print(f"\n[*] Navigating to Facebook Ads Library:\n    {TARGET_URL}")
        page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60000)
        print("[*] Waiting 5 seconds for Comet React hydration...")
        page.wait_for_timeout(5000)
        print(f"[+] Loaded Page Title: '{page.title()}'")
        print(f"[+] Current Page URL: {page.url}")

        # 3. Country Selection / Confirmation (United States - US)
        print("\n--- STEP 1: Country Combobox Inspection ---")
        combos = page.locator('div[role="combobox"]').all()
        country_combo = None
        for c in combos:
            txt = c.inner_text().strip()
            if "United States" in txt or "Country" in txt:
                country_combo = c
                break

        if country_combo:
            c_text = country_combo.inner_text().strip().replace('\n', ' ')
            print(f"[+] Country Combobox found: '{c_text}'")
            if "United States" not in c_text:
                print("[*] Switching Country to United States...")
                country_combo.click()
                page.wait_for_timeout(1000)
                c_search = page.locator('input[placeholder="Search for country"]')
                if c_search.is_visible():
                    c_search.fill("United States")
                    page.wait_for_timeout(500)
                us_opt = page.locator('div[role="option"]').filter(has_text=re.compile(r"^United States$", re.I))
                if us_opt.is_visible():
                    us_opt.click()
                    page.wait_for_timeout(1000)
            else:
                print("[+] Confirmed: Target country is already 'United States' (US).")
        else:
            print("[!] Note: Country combobox locator not explicitly matched, continuing with current page state.")

        # 4. Search Input: Enter "DallasWind US" (Handle Recent Searches / Typeahead)
        print("\n--- STEP 2: Keyword Search: 'DallasWind US' ---")
        search_input = page.locator('input[type="search"][placeholder*="Search by keyword"]').first
        if not search_input.is_visible():
            search_input = page.locator('input[type="search"]').first

        print(f"[+] Search Input found (visible: {search_input.is_visible()})")
        search_input.click(force=True)
        page.wait_for_timeout(800)

        # Clear existing text and fill "DallasWind US"
        search_input.fill("")
        page.wait_for_timeout(300)
        search_input.fill("DallasWind US")
        print("[*] Typed 'DallasWind US' into search input.")
        page.wait_for_timeout(1000)

        # Press Enter to execute search
        print("[*] Pressing 'Enter' to execute keyword search...")
        search_input.press("Enter")

        print("[*] Waiting 5 seconds for keyword search results to load...")
        page.wait_for_timeout(5000)

        # 5. Open Filter Dialog Modal
        print("\n--- STEP 3: Open Filter Dialog Modal ---")
        filter_btn = page.locator('div[role="button"]').filter(has_text=re.compile(r"^Filters\b", re.I)).first
        print(f"[*] Clicking Filters button (current text: '{filter_btn.inner_text().strip()}')...")
        filter_btn.click(force=True)
        page.wait_for_timeout(2000)

        # Locate the open Filter Dialog modal
        dlgs = page.locator('div[role="dialog"]').all()
        print(f"[+] Detected {len(dlgs)} dialog elements in DOM.")

        target_dlg = None
        for d in dlgs:
            txt = d.inner_text()
            if "Filters" in txt and ("Language" in txt or "Platform" in txt or "Reset" in txt):
                target_dlg = d
                break

        if not target_dlg:
            target_dlg = dlgs[1] if len(dlgs) > 1 else dlgs[0]

        print(f"[+] Target Filter Dialog selected: visible={target_dlg.is_visible()}")

        # 6. Apply the 4 Filters
        print("\n--- STEP 4: Selecting the 4 Filters ---")
        combos_in_dlg = target_dlg.locator('div[role="combobox"]').all()

        if len(combos_in_dlg) >= 4:
            print(f"[+] Detected {len(combos_in_dlg)} comboboxes in Filter Dialog (Combobox Mode).")
            # 6.1 Platform
            platform_box = combos_in_dlg[2]
            plat_text = platform_box.inner_text().strip().replace('\n', ' ')
            print(f"[*] (1/4) Platform Combobox: '{plat_text}'")
            if "3 options selected" not in plat_text and "3 platforms" not in plat_text:
                platform_box.click()
                page.wait_for_timeout(800)
                for p_name in ["Facebook", "Instagram", "Audience Network"]:
                    opt = page.locator('div[role="option"], div[role="menuitem"], label').filter(has_text=re.compile(f"^{p_name}$", re.I)).first
                    if opt.is_visible():
                        opt.click()
                        print(f"    -> Selected platform: '{p_name}'")
                        page.wait_for_timeout(400)
                platform_box.click()
                page.wait_for_timeout(600)
                print(f"[+] (1/4) Platform Combobox updated: '{platform_box.inner_text().strip().replace(chr(10), ' ')}'")
            else:
                print("[+] (1/4) Platform already has 3 options selected.")

            # 6.2 Active Status
            active_box = combos_in_dlg[4]
            act_text = active_box.inner_text().strip().replace('\n', ' ')
            print(f"[*] (2/4) Active Status: '{act_text}'")
            if "Active ads" not in act_text:
                active_box.click()
                page.wait_for_timeout(800)
                act_opt = page.locator('div[role="option"], div[role="menuitem"], label').filter(has_text=re.compile(r"^Active ads$", re.I)).first
                if act_opt.is_visible():
                    act_opt.click()
                    print("    -> Selected: 'Active ads'")
                    page.wait_for_timeout(600)
            else:
                print("[+] (2/4) Active ads already selected.")

            # 6.3 Date: From = 11/03/2026
            date_inp = target_dlg.locator('input[placeholder="mm/dd/yyyy"]').first
            date_inp.click()
            page.wait_for_timeout(300)
            date_inp.fill("11/03/2026")
            date_inp.press("Enter")
            page.wait_for_timeout(600)
            print(f"[+] (3/4) Impressions by date set to: {date_inp.input_value()} (On or after Nov 3, 2026)")

            # 6.4 Language: English
            lang_box = combos_in_dlg[0]
            lang_text = lang_box.inner_text().strip().replace('\n', ' ')
            print(f"[*] (4/4) Language Combobox: '{lang_text}'")
            if "English" not in lang_text:
                lang_box.click()
                page.wait_for_timeout(800)
                lang_opt = page.locator('div[role="menuitem"], div[role="option"], div, span').filter(has_text=re.compile(r"^English$", re.I)).first
                if lang_opt.is_visible():
                    lang_opt.click()
                    print("    -> Selected Language: 'English'")
                    page.wait_for_timeout(600)
            else:
                print("[+] (4/4) Language already set to English.")
        else:
            print("[+] Using direct semantic interaction mode for filters.")
            # 6.1 Platform
            print("[*] (1/4) Selecting Platforms: Facebook, Instagram, Audience Network...")
            for name in ["Facebook", "Instagram", "Audience Network"]:
                page.evaluate(f"""() => {{
                    const labels = Array.from(document.querySelectorAll('label'));
                    const lbl = labels.find(l => l.innerText.trim() === '{name}');
                    if (lbl) {{
                        const inp = lbl.querySelector('input') || lbl.parentElement.querySelector('input');
                        if (inp && !inp.checked) lbl.click();
                    }}
                }}""")
                page.wait_for_timeout(300)

            # 6.2 Active Status
            print("[*] (2/4) Selecting Active ads...")
            page.evaluate("""() => {
                const labels = Array.from(document.querySelectorAll('label'));
                const lbl = labels.find(l => l.innerText.includes('Active ads'));
                if (lbl) {
                    const inp = lbl.querySelector('input') || lbl.parentElement.querySelector('input');
                    if (inp && !inp.checked) lbl.click();
                }
            }""")
            page.wait_for_timeout(300)

            # 6.3 Date
            print("[*] (3/4) Setting Impressions by date (From: 11/03/2026)...")
            page.evaluate("""() => {
                const inp = document.querySelector('input[placeholder="mm/dd/yyyy"]');
                if (inp) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    setter.call(inp, "11/03/2026");
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }""")
            page.wait_for_timeout(300)

            # 6.4 Language
            print("[*] (4/4) Selecting Language (English)...")
            page.evaluate("""() => {
                const inp = document.querySelector('input[placeholder="Find a language"]');
                if (inp) {
                    inp.value = "English";
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }
                const item = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="option"], label, div')).find(el => el.innerText && el.innerText.trim() === 'English');
                if (item) item.click();
            }""")
            page.wait_for_timeout(600)

        # 7. Verify & Click "Apply 4 filters" Button
        print("\n--- STEP 5: Apply Filters Verification & Submission ---")
        page.wait_for_timeout(1000)

        apply_btn = target_dlg.locator('div[role="button"]').filter(has_text=re.compile(r"Apply \d+ filter", re.I)).first
        if not apply_btn.is_visible():
            apply_btn = target_dlg.locator('div[role="button"]').filter(has_text=re.compile(r"^Apply", re.I)).first

        btn_label = apply_btn.inner_text().strip()
        print(f"[+] Dynamic Apply Button Label: '{btn_label}'")
        if "4" in btn_label:
            print("[+] VERIFIED: Button accurately reflects all 4 configured filters: 'Apply 4 filters'")
        else:
            print(f"[+] Button label: '{btn_label}', proceeding to click.")

        # Track requests before click to isolate the refetch query
        req_start_index = len(captured_requests)
        res_start_index = len(captured_responses)

        print("[*] Clicking Apply button...")
        apply_btn.click(force=True)

        print("[*] Waiting 8 seconds for GraphQL request transmission and response delivery...")
        page.wait_for_timeout(8000)

        # 8. Post-Apply Verification & Analysis
        print("\n--- STEP 6: Network Interception Analysis ---")
        new_requests = captured_requests[req_start_index:]
        new_responses = captured_responses[res_start_index:]
        print(f"[+] Total GraphQL requests captured during run: {len(captured_requests)} (New after click: {len(new_requests)})")
        print(f"[+] Total GraphQL responses captured during run: {len(captured_responses)} (New after click: {len(new_responses)})")

        # Locate the targeted search refetch query
        target_req = None
        for r in reversed(captured_requests):
            vars_dict = r.get("variables", {})
            if isinstance(vars_dict, dict):
                query_str = vars_dict.get("queryString", "")
                if "DallasWind" in query_str or r.get("doc_id") == "26617181747964058":
                    target_req = r
                    break

        if not target_req and captured_requests:
            target_req = captured_requests[-1]

        if target_req:
            print("\n[+] TARGET GRAPHQL REQUEST IDENTIFIED:")
            print(f"    Friendly Name : {target_req['friendly_name']}")
            print(f"    Meta doc_id   : {target_req['doc_id']}")
            print(f"    fb_dtsg token : {target_req['fb_dtsg'][:25]}... (length: {len(target_req['fb_dtsg'])})")
            print(f"    __user (UID)  : {target_req['__user']}")
            print(f"    __rev (Build) : {target_req['__rev']}")
            print(f"    Variables     :\n{json.dumps(target_req['variables'], indent=2, ensure_ascii=False)}")

            # Save structured request artifact
            with open(OUTPUT_REQUEST_PATH, "w", encoding="utf-8") as f:
                json.dump(target_req, f, indent=2, ensure_ascii=False)
            print(f"[+] Successfully saved request artifact to: {OUTPUT_REQUEST_PATH}")
        else:
            print("[!] Error: Target GraphQL request could not be identified!")

        # Locate target response payload
        target_res = None
        for res in reversed(captured_responses):
            body = res.get("body", "")
            if len(body) > 2000 and ("search_results" in body or "ad_archive_id" in body or "collated_results" in body or "ad_library_main" in body):
                target_res = res
                break

        if not target_res and captured_responses:
            target_res = max(captured_responses, key=lambda x: x.get("length", 0))

        if target_res:
            raw_body = target_res["body"]
            print(f"\n[+] TARGET GRAPHQL RESPONSE IDENTIFIED:")
            print(f"    HTTP Status   : {target_res['status']}")
            print(f"    Payload Size  : {target_res['length']} bytes")

            # Save raw response artifact
            with open(OUTPUT_RESPONSE_PATH, "w", encoding="utf-8") as f:
                f.write(raw_body)
            print(f"[+] Successfully saved response artifact to: {OUTPUT_RESPONSE_PATH}")

            # Parse deferred @defer chunks
            parsed_chunks, search_conn = parse_relay_deferred_response(raw_body)
            print(f"[+] Successfully parsed {len(parsed_chunks)} JSON response chunk(s).")
            if search_conn:
                edges = search_conn.get("edges", [])
                total_count = search_conn.get("count", len(edges))
                page_info = search_conn.get("page_info", {})
                print(f"[+] Search Results Connection Extracted:")
                print(f"    Batch Edge Count : {len(edges)}")
                print(f"    Reported Count   : {total_count}")
                print(f"    Has Next Page    : {page_info.get('has_next_page')}")
                if page_info.get('end_cursor'):
                    print(f"    End Cursor       : {page_info.get('end_cursor')[:30]}...")

                if edges:
                    first_node = edges[0].get("node", {})
                    collated = first_node.get("collated_results", [])
                    if collated:
                        sample_ad = collated[0]
                        print("\n[+] Sample Ad Detail (First Result):")
                        print(f"    Archive ID   : {sample_ad.get('ad_archive_id')}")
                        print(f"    Page Name    : {sample_ad.get('page_name')}")
                        print(f"    Is Active    : {sample_ad.get('is_active')}")
                        print(f"    Platforms    : {sample_ad.get('publisher_platform')}")
                        print(f"    Start Date   : {sample_ad.get('start_date')}")
                        snapshot = sample_ad.get("snapshot", {})
                        print(f"    Ad Title     : {snapshot.get('title')}")
                        print(f"    CTA Text     : {snapshot.get('cta_text')}")
                        print(f"    Link URL     : {snapshot.get('link_url')}")
            else:
                print("[!] Note: Direct search_results_connection tree not found in top chunk keys, check raw JSON.")
        else:
            print("[!] Error: Target GraphQL response could not be identified!")

        # 9. Read Live Page Results Badge
        results_badge = page.evaluate("""() => {
            const els = Array.from(document.querySelectorAll('div, span, strong')).map(e => e.innerText.trim());
            return els.find(t => /~?\\d+\\s+results/i.test(t));
        }""")
        print(f"\n[+] Live DOM Results Badge: '{results_badge}'")
        print(f"[+] Final Page URL: {page.url}")

        print("\n" + "=" * 75)
        print(" AUTOMATION & INTERCEPTION COMPLETED SUCCESSFULLY ")
        print("=" * 75)


if __name__ == "__main__":
    main()
