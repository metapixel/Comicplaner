/*!
 * Comic-Planer – Service Worker
 * Copyright (C) 2026 Kai Kranz
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Quellcode: https://github.com/metapixel/Comicplaner
 */
/* Comic-Planer Service Worker
 * Netz zuerst, Zwischenspeicher nur als Rückfall (offline).
 * Gespeichert werden die App-Seite und die statischen Dateien – nie die API-Daten
 * (die legt die App selbst im Gerät ab). */
const CACHE = "comicplaner-2.2.0";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && !k.endsWith("-covers")).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function isAppPage(url) { return /\/(index\.php)?$/.test(url.pathname); }
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (e.request.mode === "navigate" && isAppPage(url)) {
    e.respondWith(
      fetch(e.request, {cache: "no-store"}).then(res => {
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("app-page", copy)); }
        return res;
      }).catch(() => caches.match("app-page").then(r => r || Response.error()))
    );
    return;
  }
  if (url.pathname.endsWith("/cover.php")) {   // Cover: URL enthält die Version → aus dem Speicher, sonst laden (auch offline verfügbar)
    e.respondWith(caches.open(CACHE + "-covers").then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (!url.pathname.includes("/assets/") && !url.pathname.endsWith("manifest.webmanifest")) return;
  e.respondWith(
    fetch(e.request, {cache: "no-cache"})
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}))
  );
});
