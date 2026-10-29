# Layout / routing / responsive regression checks

Run against local `python3 -m http.server 8765` or deploy preview.

## Automated
```bash
python3 tests/layout-regression-cdp.py
```

Asserts for `#CS338`:
- depth 1–3: zero basket overlaps, zero pill overlaps
- no intra-basket pill gaps > 45px
- AND labels not inside basket rects
- edge `data-to-uid` matches a real course occurrence uid (not course-code-only grouping)
- CS135 open basket (when visible) targets its `courseAncestor` occurrence
- tree canvas height tracks viewport (not stuck at 542) at 1440×900
- no `#search-history` / `.history-item`

## Manual
- Expand/collapse `+ more` at depth 2
- Prefs Balanced / Useful / Liked / Easy / Off
- Resize 1366×768, 1440×900, 1920×1080; pan/zoom; Reset
- AMATH250 + one dense course (CS338)
