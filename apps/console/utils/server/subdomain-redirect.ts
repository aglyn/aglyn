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

import { TENANT_APEX } from '@aglyn/aglyn/server'

/**
 * Registers `{subdomain}.aglyn.app` on the tenant project as a Vercel
 * per-domain REDIRECT to the custom domain (AGL-1273). The app-level
 * canonical redirect in `loadPageData` is baked into an ISR entry keyed on
 * pathname, so it structurally cannot carry the query string — a campaign
 * that pointed at the platform subdomain lost its `utm_*` on the hop. The
 * edge redirect preserves path AND query at zero runtime cost, and the
 * app-level redirect stays as the fallback for self-hosted deployments
 * where no Vercel API exists.
 *
 * Best-effort BY DESIGN: the custom domain is already attached by the time
 * this runs, and a redirect-registration failure must not unwind that. A
 * failure sets `subdomainRedirectPending` so the gap is visible and the
 * backfill script (`tools/scripts/backfill-subdomain-redirects.mjs`) can
 * close it.
 */
export async function upsertSubdomainRedirect(options: {
  token: string
  projectId: string
  teamId?: string
  subdomain: string
  target: string
}): Promise<boolean> {
  const { token, projectId, teamId, subdomain, target } = options
  const name = `${subdomain}.${TENANT_APEX}`
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  // Vercel's `redirect` is a BARE HOSTNAME, not a URL (`aglyn.com`, never
  // `https://aglyn.com`). A scheme-prefixed value is rejected with
  // `bad_request: Unable to redirect to "https://…", because that domain is
  // not added to the project` — a message that blames the target's absence
  // rather than the format, which is why this shipped looking correct and
  // never once succeeded (AGL-1365).
  const body = JSON.stringify({
    redirect: target,
    // Mirrors the app-level redirect's 307: revocable, method-preserving.
    redirectStatusCode: 307,
  })
  // The subdomain may or may not already exist as an explicit project
  // domain (a wildcard serving it does not count) — PATCH the existing
  // entry, and on 404 create it with the redirect in one call.
  const patch = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/domains/${encodeURIComponent(name)}${query}`,
    { method: 'PATCH', headers, body },
  )
  if (patch.ok) return true
  if (patch.status !== 404) {
    console.error(await patch.json().catch(() => undefined))
    return false
  }
  const post = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        redirect: target,
        redirectStatusCode: 307,
      }),
    },
  )
  if (!post.ok) console.error(await post.json().catch(() => undefined))
  return post.ok
}
