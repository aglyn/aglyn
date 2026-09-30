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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { seoAudit } from '@aglyn/aglyn/app-utils/seo-audit'
import { SEO_KEYWORD_LINES_MAX_CHARS } from '@aglyn/aglyn/app-utils/seo-keywords'
import {
  scanSeoSite,
  seoAuditSiteOf,
  type SeoSiteHost,
} from '@aglyn/aglyn/app-utils/seo-site-scan'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { getTemplateScreenIds } from '@aglyn/tenant-runtime/template-screens'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The site's SEO check: every page the sitemap lists, held to what a search
 * result and a crawler need (`@aglyn/aglyn/app-utils/seo-audit`), and the
 * site held to what a search engine and an agent read about it.
 *
 * A platform read, for every site owner: no plan, add-on or plugin gates it,
 * because being told a title is too long or a page has no main heading is
 * part of publishing a site, not an extra. Anything that proposes FIXES for
 * these findings is a plugin's widget beside the section that draws them.
 *
 * It writes nothing and generates nothing. The findings are computed on
 * demand from the published pages — a person presses the button, and the
 * scan reads at most the checked pages' published versions and the shared
 * layouts (`seo-site-scan.ts` states the bound) — so nothing stored can go
 * stale behind an edit.
 *
 * GET `?hostId=…&keywords=…` — `keywords` is optional, one page a line
 * (`/pricing: plans, pricing`). Auth: Firebase ID token; a member of the
 * site, or of the workspace that owns it.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const hostId = String(query?.['hostId'] ?? '')
  if (!hostId) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }
  const keywords = String(query?.['keywords'] ?? '').slice(0, SEO_KEYWORD_LINES_MAX_CHARS)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }

    // Whoever may read the site's settings may read what is wrong with them:
    // a member of the site, or of the workspace that owns it.
    let allowed = Boolean((hostSnapshot.get('memberRoles') ?? {})[decoded.uid])
    if (!allowed) {
      const orgId = await resolveOrgIdForHost(hostId)
      if (orgId) {
        const orgMember = await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('members')
          .doc(decoded.uid)
          .get()
        allowed = orgMember.exists
      }
    }
    if (!allowed) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Lockdown verdict (AGL-1506): a GET, so a read-only lock lets it
    // through. The org doc is fetched because an org lock never stamps host
    // docs; staff bypass is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: decoded['staff'] === true,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const host = (hostSnapshot.data() ?? {}) as SeoSiteHost
    const scan = await scanSeoSite(firestore, hostId, host, {
      keywords,
      templateScreenIds: await getTemplateScreenIds({ hostId }),
    })
    const report = seoAudit(scan.pages, seoAuditSiteOf(host), {
      skipped: scan.skipped,
      notes: scan.notes,
    })
    return Response.json({ report }, { status: 200 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The SEO check could not run' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
