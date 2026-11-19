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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { matchRedirect, normalizeRedirectSource } from '../model/redirects'

/** The answer: the path as tested, the rule's destination and status when one fires, and the page's words for it. */
export interface RedirectPathTest {
  path: string
  match: { destination: string; statusCode: number } | null
  text: string
}

type Rule = { $id?: string; source?: string; destination?: string; deletedAt?: unknown }

/**
 * The Redirects page's "Test a path" (`redirects-console-page.tsx`), in its
 * order and its words: the typed path normalized as a from-path (or kept as
 * typed when it is not one), matched by the serve path's own matcher
 * (`matchRedirect`) over the rules the page lists — soft-deleted ones
 * dropped, in the page's order by from-path — and answered as
 * `→ <destination> (<status>)` or `No rule matches`.
 */
export function testRedirectPath(rules: readonly Rule[], input: string): RedirectPathTest {
  const path = normalizeRedirectSource(input) ?? input.trim()
  const listed = rules
    .filter((rule) => !rule.deletedAt)
    .sort((a, b) => String(a.source ?? '').localeCompare(String(b.source ?? '')))
  const result = matchRedirect(listed as never, path)
  return result
    ? {
        path,
        match: { destination: result.destination, statusCode: result.statusCode },
        text: `→ ${result.destination} (${result.statusCode})`,
      }
    : { path, match: null, text: 'No rule matches' }
}

/** The rules the page lists: its own ceiling, so the tester covers what the page's covers. */
const RULES_WINDOW = 200

/**
 * `POST /api/redirects/test`: runs {@link testRedirectPath} for a member of
 * the site, who may read its rules (the rules leave a redirect's read to any
 * member, and the page offers the tester to everyone it shows). It reads and
 * answers; it writes nothing. The native apps ask it here because the
 * pattern half of the matcher is this server's engine, with no app copy.
 */
export const redirectTestHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  if (!hostId || /^__.*__$/.test(hostId) || hostId.includes('/')) return res.status(400).json({ error: 'Missing hostId' })
  const path = String(body.path ?? '').slice(0, 2000)
  if (!path.trim()) return res.status(400).json({ error: 'Missing path' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const host = await hostRef.get()
    if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
    const roles = host.get('memberRoles') as Record<string, unknown> | undefined
    if (roles?.[decoded.uid] == null) return res.status(403).json({ error: 'You are not a member of this site' })
    const snapshot = await hostRef.collection('redirects').limit(RULES_WINDOW).get()
    const rules = snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ $id: doc.id, ...doc.data() }))
    return res.status(200).json(testRedirectPath(rules, path))
  } catch (error) {
    console.error('[redirects/test]', error)
    return res.status(500).json({ error: 'The path could not be tested' })
  }
}
