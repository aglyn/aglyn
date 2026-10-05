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

import { checkEntitlement, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { resolveSiteBundleSections } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import {
  selectSitePackage,
  siteBundleItems,
} from '@aglyn/aglyn/data-transfer/site-package'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
} from '@aglyn/tenant-data-admin'
import { encodeBundleTimestamps } from '../../_lib/bundle-timestamps'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  consoleSitePackageKinds,
  readSiteBundle,
  sectionPackageHooks,
  sitePackageContract,
  sitePackageOf,
} from '../../_lib/site-package-read'

/** The most item keys one export names; a selection past it is "everything". */
const MAX_SELECTED_ITEMS = 5000

/**
 * Site package export (AGL-163, AGL-3533): everything designable on a site
 * as one `aglyn-package` v2 file — a manifest listing each item (kind, id,
 * slug or name, content hash, the items it depends on) and each item's
 * content. Settings and theme, pages and email designs with their PUBLISHED
 * versions, the site's emails, layouts, reusable components, authors,
 * content collections and their entries, the theme library, a media
 * manifest (metadata and URLs; bytes stay in storage), every host collection
 * a plugin declares for the backup (a site's forms, redirects, events,
 * experiments, bars and popups, variables, functions, workflows,
 * interactions and booking services) and every section a plugin answers for
 * itself (a site's datasets, with their records). Never admins, tenant
 * linkage, domain, submissions, bookings or leads (personal data), or
 * secrets. Pro+ (`siteExport` flag).
 *
 * The whole-site backup is the everything preset: no `items`. A selection
 * names item keys (`<kind>/<id>`); with `dependencies` it carries what they
 * need too. `list` answers the manifest alone, for the picker. GET takes the
 * same as query parameters (`items` comma-separated, `dependencies=1`,
 * `list=1`); POST as a JSON body, for a selection too long for a URL.
 *
 * The file is written as v2 only. The import still reads a v1
 * `aglyn-site-export` bundle, converting it in memory, so every backup ever
 * downloaded restores.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const input: Record<string, unknown> = method === 'POST' ? (body ?? {}) : (query ?? {})
  const hostId = String(input['hostId'] ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const selected = Array.isArray(input['items'])
    ? input['items'].map(String)
    : typeof input['items'] === 'string' && input['items']
      ? input['items'].split(',')
      : null
  if (selected && selected.length > MAX_SELECTED_ITEMS) {
    return Response.json({ error: `Choose at most ${MAX_SELECTED_ITEMS} items, or export everything` }, { status: 400 })
  }
  const flag = (value: unknown) => value === true || value === '1' || value === 'true'
  const includeDependencies = flag(input['dependencies'])
  const listOnly = flag(input['list'])

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    // Plan gate rides the owning org's doc (AGL-238). The org id is kept —
    // media and a plugin's organization data are read from the org, not the
    // host (AGL-1046).
    const owningOrg = await getOrgForHost(hostId)
    const orgId = owningOrg?.orgId

    // Lockdown verdict (AGL-1506): platform/org/host/user scopes with the
    // docs already in hand; distinct 423 body; staff bypass is the
    // un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: owningOrg?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    if (!checkEntitlement(owningOrg?.org as any, 'siteExport')) {
      return Response.json({ error: 'Site export requires a Pro plan' }, { status: 403 })
    }

    const hostData = hostSnapshot.data() ?? {}
    /**
     * The sections plugins answer for themselves. Resolved before anything
     * is read: a section declared and not registered THROWS here, and the
     * export fails out loud rather than shipping a backup without it.
     */
    const sections = await resolveSiteBundleSections()
    const kinds = consoleSitePackageKinds()
    /**
     * Dates leave as a TAGGED wire form, not as the Admin SDK's private
     * `{_seconds, _nanoseconds}` (AGL-1392): every date in every bundle used to
     * restore as a plain MAP, and `publishSchedule.publishAt <= now` is a range
     * query a map cannot satisfy — restored sites silently stopped publishing.
     * Encoded before hashing, so the hash is of what the file holds.
     */
    const bundle = encodeBundleTimestamps(
      await readSiteBundle({ firestore, hostRef, hostId, orgId, hostData, sections }),
    )
    const everything = await sitePackageOf(siteBundleItems(bundle, sitePackageContract(), [...kinds.values()]), {
      kinds,
      sections: sectionPackageHooks(sections),
      createdAt: Date.now(),
      source: String(hostData['displayName'] ?? hostData['subdomain'] ?? hostId),
    })
    if (listOnly) {
      return Response.json({
        manifest: everything.manifest,
        kinds: [...kinds.values()].map((one) => ({ kind: one.kind, label: one.label })),
      })
    }
    const pkg = selected ? selectSitePackage(everything, selected, includeDependencies) : everything
    return new Response(JSON.stringify(pkg), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition':
          `attachment; filename="aglyn-${hostData['subdomain'] ?? hostId}-` +
          `${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
