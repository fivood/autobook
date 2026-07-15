/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `app-${version}`;
const APP_SHELL = [...build, ...files];

// Web Share Target stash. Android share sheet POSTs the file to
// SHARE_TARGET_PATH; we hold the blob in PENDING_CACHE under
// PENDING_SHARE_URL, 303-redirect to /?shared=1, and the app fetches +
// deletes it on mount. Kept in its own cache so it never mixes with the
// version-busted app shell.
const SHARE_TARGET_PATH = '/share-target';
const PENDING_SHARE_URL = '/__pending_share__';
const PENDING_CACHE = 'pending-share';

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // Keep CACHE (app shell) and PENDING_CACHE (a share in flight) — drop
      // everything else (old versioned shells).
      await Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== PENDING_CACHE)
          .map((k) => caches.delete(k))
      );
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // Web Share Target inbound: stash the shared file, redirect to the app.
  if (event.request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  // App pickup: serve the stashed blob (the app deletes it after reading).
  if (event.request.method === 'GET' && url.pathname === PENDING_SHARE_URL) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PENDING_CACHE);
        const cached = await cache.match(PENDING_SHARE_URL);
        return cached ?? new Response('', { status: 404 });
      })()
    );
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const resp = await fetch(event.request);
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      } catch {
        const fallback = await cache.match('/');
        if (fallback) return fallback;
        throw new Error('offline');
      }
    })()
  );
});

async function handleShareTarget(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (file instanceof File) {
      const cache = await caches.open(PENDING_CACHE);
      await cache.put(
        PENDING_SHARE_URL,
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-filename': file.name || 'shared'
          }
        })
      );
    }
  } catch {
    // best-effort — the redirect still lands the user in the app
  }
  // 303 → GET /?shared=1 (Web Share Target spec requires the redirect).
  return Response.redirect(self.location.origin + '/?shared=1', 303);
}
