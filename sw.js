const BUILD = "1830f753a0a6";
const INFO = {"n": 215, "data": "20260930"};
const SITE = new URL(self.registration.scope).pathname; 
const SHELL = "shell:" + SITE + BUILD, LIB = "lib-v1", GSI = "gsi-tiles-v1";
const GSI_DAYS = 30, CFG = "sw-cfg-v1";
const CFG_KEY = SITE + "__cfg", CFG_DEF = { max: 3000, keepPassed: true };
let cfg = null; 
async function getCfg() {
  if (cfg) return cfg;
  const c = await caches.open(CFG), own = { ...CFG_DEF };
  let maxAll = 0;
  for (const k of await c.keys()) {
    try {
      const v = await (await c.match(k)).json();
      if (new URL(k.url).pathname === CFG_KEY) Object.assign(own, v);
      maxAll = Math.max(maxAll, +v.max || 0);
    } catch (e) {}
  }
  return (cfg = { own, maxAll: Math.max(maxAll, own.max) });
}
const inflight = new Map(); 
self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "drop") { for (const u of m.urls || []) { const a = inflight.get(u); if (a) a.abort(); } return; }
  if (m.type !== "cfg") return;
  const v = { max: Math.max(1000, Math.min(100000, Math.round(+m.max) || CFG_DEF.max)), keepPassed: m.keepPassed !== false };
  e.waitUntil(caches.open(CFG).then((c) => c.put(CFG_KEY, new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })))
    .then(() => { cfg = null; return caches.open(GSI); }).then((c) => trim(c, true)));
});

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "lines.json", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => (k.startsWith("shell:" + SITE) || k.startsWith("shell-")) && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const isApp = /\/(index\.html)?$/.test(url.pathname);
    if (req.mode === "navigate") return e.respondWith(networkFirst(req, isApp ? "./" : url.origin + url.pathname));
    if (url.pathname.includes("/guide/")) return e.respondWith(networkFirst(req, req.url));
    if (url.pathname.endsWith("/lines.json")) return e.respondWith(networkFirst(req, "lines.json"));
    if (/\/(extra(_check|_local)?|osm_rail|osm_yard)\.json$/.test(url.pathname)) return e.respondWith(networkFirst(req, url.pathname.slice(url.pathname.lastIndexOf("/") + 1)));
    if (url.pathname.endsWith(".webmanifest") || url.pathname.includes("/icons/")) return e.respondWith(networkFirst(req, req.url));
    return;
  }
  if (url.hostname === "cdnjs.cloudflare.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com")
    return e.respondWith(cacheFirst(req));
  if (url.hostname === "cyberjapandata.gsi.go.jp" && url.pathname.startsWith("/xyz/")) return e.respondWith(gsiTile(req));
});

async function networkFirst(req, key) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req.mode === "navigate" ? req.url : req, { cache: "no-cache" });
    if (res.ok) c.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(LIB), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") c.put(req, res.clone());
  return res;
}

async function gsiTile(req) {
  const c = await caches.open(GSI), hit = await c.match(req.url);
  const fresh = hit && Date.now() - Number(hit.headers.get("x-sw-time") || 0) < GSI_DAYS * 864e5;
  if (fresh) return hit;
  try {
    const { own } = await getCfg();
    let ac = null;
    if (!own.keepPassed) {
      ac = new AbortController(); inflight.set(req.url, ac);
      if (req.signal) req.signal.addEventListener("abort", () => ac.abort()); 
    }
    const res = await fetch(req.url, { mode: "cors", credentials: "omit", signal: ac ? ac.signal : undefined })
      .finally(() => { if (ac && inflight.get(req.url) === ac) inflight.delete(req.url); });
    if (!res.ok) return hit || res;
    const body = await res.blob(), headers = new Headers(res.headers);
    headers.set("x-sw-time", String(Date.now()));
    await c.put(req.url, new Response(body, { status: 200, headers }));
    trim(c);
    return new Response(body, { status: 200, headers });
  } catch (err) {
    if (err && err.name === "AbortError") throw err; 
    if (hit) return hit; 
    try { return await fetch(req); } catch (e2) { throw err; }
  }
}

let trimming = false, puts = 0;
async function trim(c, now) {
  if (trimming || (!now && puts++ % 100)) return;
  trimming = true;
  try {
    const { maxAll } = await getCfg(), keys = await c.keys();
    for (let i = 0; i < keys.length - maxAll; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}


self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => new URL(w.url).pathname.startsWith(SITE));
    return c ? c.focus() : self.clients.openWindow(SITE);
  }));
});
