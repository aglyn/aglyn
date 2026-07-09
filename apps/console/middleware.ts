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
 * client-side (OrgWorkspaceProvider); this only stops dead subdomains
 * from rendering a broken console.
 *
 * Inert until ops sets NEXT_PUBLIC_WORKSPACE_DOMAIN (e.g. "aglyn.com")
 * on the console deployment alongside the wildcard domain — the tenant
 * sites' own subdomain space must not be claimed by accident.
 */
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY

const APEX_LABELS = new Set(['www', 'console'])
const CACHE_TTL_MS = 60_000
const slugCache = new Map<string, { known: boolean; at: number }>()

async function isKnownOrgSlug(slug: string): Promise<boolean> {
  const cached = slugCache.get(slug)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.known
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
        `/databases/(default)/documents/orgSlugs/${encodeURIComponent(slug)}` +
        `?key=${API_KEY}`,
    )
    const known = response.ok
    // Only 200/404 are authoritative; other statuses (quota, outage)
    // fail open without poisoning the cache.
    if (response.ok || response.status === 404) {
      slugCache.set(slug, { known, at: Date.now() })
      return known
    }
    return true
  } catch {
    return true
  }
}

export async function middleware(request: NextRequest) {
  if (!WORKSPACE_DOMAIN || !PROJECT_ID || !API_KEY) {
    return NextResponse.next()
  }
  const hostname = (request.headers.get('host') ?? '').split(':')[0]
  if (hostname === WORKSPACE_DOMAIN || !hostname.endsWith(`.${WORKSPACE_DOMAIN}`)) {
    return NextResponse.next()
  }
  const slug = hostname.slice(0, -(WORKSPACE_DOMAIN.length + 1))
  if (slug.includes('.') || APEX_LABELS.has(slug)) {
    return NextResponse.next()
  }
  if (await isKnownOrgSlug(slug)) {
    return NextResponse.next()
  }
  const apex = request.nextUrl.clone()
  apex.hostname = `console.${WORKSPACE_DOMAIN}`
  apex.pathname = '/'
  apex.search = `?unknown-workspace=${encodeURIComponent(slug)}`
  return NextResponse.redirect(apex)
}

export const config = {
  // Pages and data routes only — assets and API routes are never
  // workspace-scoped.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|_static).*)'],
}
