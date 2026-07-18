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
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { promises as dns } from 'dns'

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i

/**
 * DNS verification for the connect-a-domain wizard (Custom Domain
 * Self-Service): resolves the domain's CNAME chain and reports whether it
 * points at the tenant edge (`AGLYN_TENANT_HOST_CNAME`). With the env unset
 * (local/dev) it reports the found records and treats any CNAME as a soft
 * pass so the flow remains testable.
 */
async function handler(request: Request): Promise<Response> {
  // Require an authenticated console user (AGL-513): this backs the
  // connect-a-domain wizard, not a public DNS lookup service.
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
  } catch {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  const { query } = await pluginRequestFromWeb(request)
  const domain = String(query['domain'] ?? '')
    .trim()
    .toLowerCase()
  if (!DOMAIN_PATTERN.test(domain)) {
    return Response.json({ error: 'Invalid domain' }, { status: 400 })
  }
  const expected = (process.env.AGLYN_TENANT_HOST_CNAME ?? '').toLowerCase()

  let records: string[] = []
  try {
    records = (await dns.resolveCname(domain)).map((record) =>
      record.toLowerCase().replace(/\.$/, ''),
    )
  } catch {
    // NXDOMAIN / no CNAME — reported as unverified below.
  }
  const verified = expected
    ? records.includes(expected)
    : records.length > 0
  return Response.json({
    domain,
    records,
    expected: expected || null,
    verified,
  }, { status: 200 })
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
