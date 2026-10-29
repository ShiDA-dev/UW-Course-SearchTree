#!/usr/bin/env python3
"""CS338 layout/routing/responsive regression via CDP. Exit 0 = pass."""
import base64
import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from shutil import which

import websocket

BASE = os.environ.get("UW_TREE_BASE", "http://127.0.0.1:8765")
MEDIA = "/cursor/stores/self/media"
os.makedirs(MEDIA, exist_ok=True)

chrome = which("google-chrome")
profile = f"/tmp/layout-reg-{os.getpid()}"
os.makedirs(profile, exist_ok=True)
port = 9255
proc = subprocess.Popen(
    [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}",
        "--window-size=1440,900",
        "about:blank",
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)


def wait_port(p, t=25):
    end = time.time() + t
    while time.time() < end:
        try:
            s = socket.create_connection(("127.0.0.1", p), 0.2)
            s.close()
            return
        except OSError:
            time.sleep(0.15)
    raise RuntimeError("cdp port")


wait_port(port)
time.sleep(0.4)
tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=15)
incoming = queue.Queue()


def reader():
    while True:
        try:
            incoming.put(json.loads(ws.recv()))
        except Exception as e:
            incoming.put({"_err": str(e)})
            break


threading.Thread(target=reader, daemon=True).start()
msg_id = 0
pending = {}


def pump(timeout=0.25):
    try:
        data = incoming.get(timeout=timeout)
    except queue.Empty:
        return
    if "_err" in data:
        raise RuntimeError(data["_err"])
    if "id" in data:
        pending[data["id"]] = data


def cdp(method, params=None, timeout=60):
    global msg_id
    msg_id += 1
    mid = msg_id
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    end = time.time() + timeout
    while time.time() < end:
        pump(0.3)
        if mid in pending:
            data = pending.pop(mid)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data.get("result", {})
    raise TimeoutError(method)


def wait_event(method, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            data = incoming.get(timeout=0.25)
        except queue.Empty:
            continue
        if "_err" in data:
            raise RuntimeError(data["_err"])
        if "id" in data:
            pending[data["id"]] = data
        if data.get("method") == method:
            return
    raise TimeoutError(method)


cdp("Page.enable")
cdp("Runtime.enable")

MEASURE = r"""
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    if (window.AppState && AppState.staticDataLoaded) break;
    await sleep(100);
  }
  if (!AppState.staticDataLoaded) return { error: 'no data' };
  AppState.currentCourseId = 'CS338';
  AppState.shouldAutoZoomPrereq = true;
  AppState.prereqDepthSelect.value = String(DEPTH);
  AppState.performSearch();
  await sleep(1100);
  if (EXPAND) {
    document.querySelectorAll('#prereq-tree .or-foot').forEach(el =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await sleep(700);
  }

  const root = AppState.lastPrereqRoot;
  const parent = new Map();
  (function w(n, p) { parent.set(n, p); (n.children || []).forEach(c => w(c, n)); })(root, null);
  function courseAnc(n) {
    let p = parent.get(n);
    while (p) {
      if (!p.isGroup && !(p.id || '').startsWith('and-') && !(p.id || '').startsWith('or-')) return p;
      p = parent.get(p);
    }
    return null;
  }

  const labels = [...document.querySelectorAll('#prereq-tree .node-label')].map(t => ({
    t: t.textContent.trim(), x: +t.getAttribute('x'), y: +t.getAttribute('y')
  }));
  const baskets = [...document.querySelectorAll('#prereq-tree rect.or-basket-bg')].map(r => {
    const x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width'), h = +r.getAttribute('height');
    return { x, y, w, h, maxX: x + w, maxY: y + h };
  });
  let basketOverlaps = 0;
  for (let i = 0; i < baskets.length; i++) for (let j = i + 1; j < baskets.length; j++) {
    const a = baskets[i], b = baskets[j];
    if (a.x < b.maxX && a.maxX > b.x && a.y < b.maxY && a.maxY > b.y) basketOverlaps++;
  }
  const rects = [...document.querySelectorAll('#prereq-tree rect.node, #prereq-tree rect.highlight-node, #prereq-tree rect.node-target')].map(r => ({
    x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width'), h: +r.getAttribute('height')
  }));
  let pillOverlaps = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) pillOverlaps++;
  }
  const intraBig = [];
  for (const b of baskets) {
    const inside = labels.filter(l => l.x >= b.x - 2 && l.x <= b.maxX + 2 && l.y >= b.y && l.y <= b.maxY).sort((a, c) => a.y - c.y);
    for (let i = 0; i < inside.length - 1; i++) {
      const dy = +(inside[i + 1].y - inside[i].y).toFixed(1);
      if (dy > 45) intraBig.push({ a: inside[i].t, b: inside[i + 1].t, dy });
    }
  }
  const ands = [...document.querySelectorAll('#prereq-tree text.and-label')].map(t => ({
    x: +t.getAttribute('x'), y: +t.getAttribute('y'),
    andUid: t.getAttribute('data-and-uid'),
    joins: t.getAttribute('data-joins'),
  }));
  const andInside = [];
  for (const a of ands) {
    for (const b of baskets) {
      if (a.x >= b.x && a.x <= b.maxX && a.y >= b.y && a.y <= b.maxY) andInside.push(a);
    }
  }

  // Visible OR baskets only (rendered groupNodes ≈ basket rect count)
  const edgeTos = [...document.querySelectorAll('#prereq-tree path.edge[data-to-uid]')].map(p => p.getAttribute('data-to-uid'));
  const uids = new Set();
  (function collect(n) {
    if (n.uid != null) uids.add(String(n.uid));
    (n.children || []).forEach(collect);
  })(root);
  const badEdgeUid = edgeTos.filter(u => u && !uids.has(u));

  // CS135 visible basket → ancestor course id
  let cs135Target = null;
  (function walk(n) {
    if (n.isGroup) {
      const pills = OrBasket.visibleChildren(n);
      if (pills.some(p => p.id === 'CS135')) {
        const tgt = courseAnc(n);
        // only record if this basket is actually drawn (has positioned pills in DOM roughly)
        cs135Target = tgt && { id: tgt.id, uid: tgt.uid };
      }
    }
    (n.children || []).forEach(walk);
  })(root);

  const tree = document.getElementById('prereq-tree');
  const cssH = parseFloat(getComputedStyle(tree).height) || 0;
  const horiz = [];
  for (const p of document.querySelectorAll('#prereq-tree path.edge')) {
    const d = p.getAttribute('d') || '';
    const m = d.match(/^M\s*([\d.-]+)\s+([\d.-]+)\s+H\s*([\d.-]+)/i);
    if (m) horiz.push(+Math.abs(+m[3] - +m[1]).toFixed(1));
  }
  horiz.sort((a, b) => b - a);

  return {
    depth: DEPTH,
    expand: !!EXPAND,
    nLabels: labels.length,
    nBaskets: baskets.length,
    basketOverlaps,
    pillOverlaps,
    intraBig,
    andInside: andInside.length,
    ands: ands.length,
    badEdgeUid: badEdgeUid.slice(0, 5),
    cs135Target,
    treeCssH: cssH,
    treeRectH: tree.getBoundingClientRect().height,
    winH: innerHeight,
    edgeMax: horiz[0] || 0,
    historyItems: document.querySelectorAll('.history-item, #search-history, .search-history').length,
    minY: labels.length ? Math.min(...labels.map(l => l.y)) : 0,
  };
})()
"""


def measure(depth, expand=False):
    url = f"{BASE}/index.html#CS338"
    cdp("Page.navigate", {"url": url})
    try:
        wait_event("Page.loadEventFired", 12)
    except TimeoutError:
        pass
    time.sleep(0.4)
    expr = MEASURE.replace("DEPTH", str(depth)).replace("EXPAND", "true" if expand else "false")
    r = cdp(
        "Runtime.evaluate",
        {"expression": expr, "awaitPromise": True, "returnByValue": True},
        timeout=60,
    )
    return r.get("result", {}).get("value")


def screenshot(name):
    r = cdp("Page.captureScreenshot", {"format": "png"})
    path = os.path.join(MEDIA, name)
    with open(path, "wb") as f:
        f.write(base64.b64decode(r["data"]))
    return path


failures = []
results = []
for depth in (1, 2, 3):
    try:
        m = measure(depth, False)
        results.append(m)
        if not m or m.get("error"):
            failures.append(f"d{depth}: {m}")
            continue
        if m["basketOverlaps"] or m["pillOverlaps"]:
            failures.append(f"d{depth}: overlaps baskets={m['basketOverlaps']} pills={m['pillOverlaps']}")
        if m["intraBig"]:
            failures.append(f"d{depth}: intra gaps {m['intraBig'][:3]}")
        if m["andInside"]:
            failures.append(f"d{depth}: AND inside basket ({m['andInside']})")
        if m["badEdgeUid"]:
            failures.append(f"d{depth}: edge uid miss {m['badEdgeUid']}")
        if m["historyItems"]:
            failures.append(f"d{depth}: history still present")
        if depth == 2 and m["treeCssH"] <= 542.5 and m["winH"] >= 800:
            # flex canvas should exceed legacy 542 on a ~900px window
            failures.append(f"d{depth}: tree height stuck ~542 ({m['treeCssH']}) win={m['winH']}")
        if m["edgeMax"] > 120:
            failures.append(f"d{depth}: edge too long {m['edgeMax']}")
    except Exception as e:
        failures.append(f"d{depth}: EXC {e}")

try:
    m = measure(2, True)
    results.append(m)
    if m and (m.get("basketOverlaps") or m.get("pillOverlaps") or m.get("intraBig")):
        failures.append(f"d2expand: overlaps/gaps {m}")
except Exception as e:
    failures.append(f"d2expand: EXC {e}")

# AMATH250 smoke
try:
    cdp("Page.navigate", {"url": f"{BASE}/index.html#AMATH250"})
    try:
        wait_event("Page.loadEventFired", 12)
    except TimeoutError:
        pass
    time.sleep(0.3)
    expr = MEASURE.replace("DEPTH", "2").replace("EXPAND", "false").replace("'CS338'", "'AMATH250'")
    # quick inline
    r = cdp(
        "Runtime.evaluate",
        {
            "expression": """
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i=0;i<40;i++){ if (AppState?.staticDataLoaded) break; await sleep(100); }
  AppState.currentCourseId='AMATH250'; AppState.prereqDepthSelect.value='2';
  AppState.shouldAutoZoomPrereq=true; AppState.performSearch(); await sleep(900);
  const labels=[...document.querySelectorAll('#prereq-tree .node-label')].map(t=>({t:t.textContent.trim(),y:+t.getAttribute('y'),x:+t.getAttribute('x')}));
  const cols={}; for (const l of labels){ const k=Math.round(l.x/20)*20; (cols[k]||=[]).push(l); }
  let pair=null;
  for (const arr of Object.values(cols)){ arr.sort((a,b)=>a.y-b.y);
    for (let i=0;i<arr.length-1;i++){
      const A=arr[i].t.replace(/\\s/g,''), B=arr[i+1].t.replace(/\\s/g,'');
      if ((A.includes('MATH146')&&B.includes('MATH115'))||(A.includes('MATH115')&&B.includes('MATH146')))
        pair=+(arr[i+1].y-arr[i].y).toFixed(1);
    }
  }
  let bo=0; const baskets=[...document.querySelectorAll('#prereq-tree rect.or-basket-bg')].map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),w:+r.getAttribute('width'),h:+r.getAttribute('height')}));
  for (let i=0;i<baskets.length;i++) for (let j=i+1;j<baskets.length;j++){ const a=baskets[i],b=baskets[j]; if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y) bo++; }
  return { pair146_115: pair, basketOverlaps: bo, history: document.querySelectorAll('.history-item,#search-history').length };
})()
""",
            "awaitPromise": True,
            "returnByValue": True,
        },
        timeout=40,
    )
    am = r.get("result", {}).get("value")
    results.append({"amath": am})
    if am and (am.get("basketOverlaps") or am.get("history") or (am.get("pair146_115") not in (None, 39))):
        if am.get("pair146_115") not in (39,):
            failures.append(f"AMATH250 gap {am.get('pair146_115')}")
        if am.get("basketOverlaps"):
            failures.append(f"AMATH250 overlaps {am}")
        if am.get("history"):
            failures.append("AMATH250 history")
except Exception as e:
    failures.append(f"AMATH: EXC {e}")

print(json.dumps({"results": results, "failures": failures}, indent=2))

if failures:
    try:
        shot = screenshot("layout-regression-failure.png")
        print("screenshot", shot)
    except Exception as e:
        print("screenshot failed", e)
    ws.close()
    proc.terminate()
    sys.exit(1)

# success evidence shots
cdp("Page.navigate", {"url": f"{BASE}/index.html#CS338"})
try:
    wait_event("Page.loadEventFired", 12)
except TimeoutError:
    pass
time.sleep(0.5)
cdp(
    "Runtime.evaluate",
    {
        "expression": """
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i=0;i<40;i++){ if (AppState?.staticDataLoaded) break; await sleep(100); }
  AppState.currentCourseId='CS338'; AppState.prereqDepthSelect.value='2';
  AppState.shouldAutoZoomPrereq=true; AppState.performSearch(); await sleep(1000);
  return true;
})()
""",
        "awaitPromise": True,
        "returnByValue": True,
    },
)
screenshot("layout-cs338-depth2-ok.png")
print("ok screenshot", os.path.join(MEDIA, "layout-cs338-depth2-ok.png"))

ws.close()
proc.terminate()
sys.exit(0)
