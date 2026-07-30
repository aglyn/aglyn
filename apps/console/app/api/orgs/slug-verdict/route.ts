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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

export const dynamic = 'force-dynamic'

/**
 * Does this workspace slug exist? — for the host gate in `middleware.ts`.
 *
 * The gate used to read `orgSlugs/{slug}` straight from Firestore's REST API
 * with the public web key. That cannot work on this project: App Check is
 * enforced, so an unauthenticated read from the edge returns
 * `403 PERMISSION_DENIED` for EVERY slug — measured against production for
 * `aglyn-org` and `zgover`, both of which exist. The gate treated any
 * non-200/404 as "known", so the lookup did not merely fail, it failed in the
 * direction that served the console to every hostname.
 *
 * Reading through the Admin SDK instead sidesteps both rules and App Check.
 *
 * Deliberately unauthenticated: the Firestore rules publish this exact
 * collection (`match /orgSlugs/{slug} { allow read: if true }`) because slug
 * resolution has to happen before sign-in. This route exposes strictly less
 * than that rule intends — a boolean and a rename target, never the `orgId`.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug')?.trim()
  if (!slug || slug.length > 64 || !/^[a-z0-9-]+$/.test(slug)) {
    return Response.json({ error: 'invalid-slug' }, { status: 400 })
  }
  try {
    const snapshot = await firebaseAdmin
      .firestore()
      .doc(`orgSlugs/${slug}`)
      .get()
    if (!snapshot.exists) {
      return Response.json({ known: false, movedTo: null })
    }
    // A renamed workspace leaves a tombstone (AGL-236) so its old subdomain
    // keeps resolving — to a redirect, not to the console.
    const movedTo = (snapshot.data()?.['movedTo'] as string | undefined) ?? null
    return Response.json({ known: true, movedTo })
  } catch {
    // Fail OPEN, and say so out loud. This route is defence in depth behind
    // the Vercel domain allowlist, which is the boundary that actually stops
    // an unregistered host; a Firestore outage must not take every real
    // workspace subdomain offline with it.
    return Response.json({ known: true, movedTo: null, degraded: true })
  }
}
