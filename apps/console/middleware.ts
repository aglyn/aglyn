/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { NextResponse, type NextRequest } from 'next/server'

/**
 * Workspace-subdomain gate (AGL-236): on `{slug}.<workspace domain>`
 * requests, verifies the slug against the public `orgSlugs` collection
 * (Firestore REST — rules allow unauthenticated reads there) and bounces
 * unknown workspaces to the apex console. In-app org scoping stays
 * client-side (OrgScopeProvider); this only stops dead subdomains
 * from rendering a broken console.
 *
 * Inert until ops sets NEXT_PUBLIC_WORKSPACE_DOMAIN (e.g. "aglyn.io" — the console apex is app.aglyn.io)
 * on the console deployment alongside the wildcard domain — the tenant
 * sites' own subdomain space must not be claimed by accident.
 */
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY

// Reserved subdomain labels that are never org workspaces. `auth` hosts
// the Firebase OAuth helper origin (auth.aglyn.io, AGL-462) — without
// this it resolves as an unknown org slug and 307s the /__/auth/*
// handshake away to the apex, breaking Google sign-in.
const APEX_LABELS = new Set(['www', 'console', 'app', 'auth'])
const CACHE_TTL_MS = 60_000
type SlugVerdict = { known: boolean; movedTo: string | null; at: number }
const slugCache = new Map<string, SlugVerdict>()

async function resolveOrgSlug(
  slug: string,
): Promise<Omit<SlugVerdict, 'at'>> {
  const cached = slugCache.get(slug)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
        `/databases/(default)/documents/orgSlugs/${encodeURIComponent(slug)}` +
        `?key=${API_KEY}`,
    )
    // Only 200/404 are authoritative; other statuses (quota, outage)
    // fail open without poisoning the cache.
    if (response.ok) {
      const payload = await response.json().catch(() => null)
      // Renamed workspaces leave a tombstone (AGL-236) — redirect.
      const movedTo =
        payload?.fields?.movedTo?.stringValue ?? null
      const verdict = { known: true, movedTo, at: Date.now() }
      slugCache.set(slug, verdict)
      return verdict
    }
    if (response.status === 404) {
      const verdict = { known: false, movedTo: null, at: Date.now() }
      slugCache.set(slug, verdict)
      return verdict
    }
    return { known: true, movedTo: null }
  } catch {
    return { known: true, movedTo: null }
  }
}

export async function middleware(request: NextRequest) {
  // Per-request CSP nonce (AGL-518). Next reads it from the request
  // Content-Security-Policy header and stamps it on the scripts it emits;
  // `strict-dynamic` then trusts the chunks those scripts load. Shipped
  // REPORT-ONLY so the browser reports violations without blocking — flip to
  // enforcing by renaming the response header to `Content-Security-Policy`
  // (after confirming reports are clean and noncing any inline scripts, e.g.
  // the GA snippet). Layers over the enforcing object-src/base-uri/
  // frame-ancestors CSP already set in with-aglyn.nextjs.config.js.
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const pass = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set('Content-Security-Policy-Report-Only', csp)
    return res
  }

  if (!WORKSPACE_DOMAIN || !PROJECT_ID || !API_KEY) {
    return pass()
  }
  const hostname = (request.headers.get('host') ?? '').split(':')[0]
  if (hostname === WORKSPACE_DOMAIN || !hostname.endsWith(`.${WORKSPACE_DOMAIN}`)) {
    return pass()
  }
  const slug = hostname.slice(0, -(WORKSPACE_DOMAIN.length + 1))
  if (slug.includes('.') || APEX_LABELS.has(slug)) {
    return pass()
  }
  const verdict = await resolveOrgSlug(slug)
  if (verdict.movedTo) {
    const moved = request.nextUrl.clone()
    moved.hostname = `${verdict.movedTo}.${WORKSPACE_DOMAIN}`
    return NextResponse.redirect(moved, 308)
  }
  if (verdict.known) {
    return pass()
  }
  const apex = request.nextUrl.clone()
  apex.hostname = `app.${WORKSPACE_DOMAIN}`
  apex.pathname = '/'
  apex.search = `?unknown-workspace=${encodeURIComponent(slug)}`
  return NextResponse.redirect(apex)
}

export const config = {
  // Pages and data routes only — assets, API routes, and the Firebase
  // auth-helper namespace (/__/*, AGL-462) are never workspace-scoped and
  // must reach the next.config rewrite untouched on every host.
  matcher: ['/((?!api|__|_next/static|_next/image|favicon.ico|_static).*)'],
}
