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
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/tenant-apex'
import {
  findDuplicateRedirect,
  isSelfRedirect,
  normalizeRedirectDestination,
  normalizeRedirectSource,
  redirectSourceIsLivePage,
  REDIRECT_STATUS_CODES,
  validateRedirectRule,
  walkRedirectChain,
} from '../model/redirects'

/** What a save is asked to write. */
export interface RedirectSaveDraft {
  /** The rule being edited; absent for a new rule. */
  id?: string
  kind?: string
  source: string
  destination: string
  statusCode?: number
}

/** The answer: the page's refusal in its own words, or the rule as the page would store it. */
export type RedirectSaveCheck =
  | { ok: false; problem: string }
  | { ok: true; source: string; destination: string; statusCode: number; kind: string; notice: string | null }

type Rule = { $id: string; source?: string; destination?: string; kind?: string; deletedAt?: unknown }

/**
 * The Redirects page's save checks, in its order and its words
 * (`redirects-console-page.tsx` `handleSave`): the shared rule validation
 * (match mode, from-path or pattern, destination, another company's address),
 * a path redirected to itself, a duplicate rule, a chain that loops back, and
 * the published-page notice that warns without refusing. One source of truth
 * for every client that saves a rule: the native apps ask it here rather than
 * carry their own copy of the phishing screen and the pattern engine.
 */
export function checkRedirectSave(
  draft: RedirectSaveDraft,
  host: { cname?: unknown; subdomain?: unknown; screens?: unknown },
  rules: readonly Rule[],
): RedirectSaveCheck {
  const kind = draft.kind || 'exact'
  const problem = validateRedirectRule(
    { kind, source: draft.source, destination: draft.destination },
    {
      ownDomains: [
        typeof host.cname === 'string' ? host.cname : null,
        typeof host.subdomain === 'string' && host.subdomain ? `${host.subdomain}.${TENANT_APEX}` : null,
      ],
    },
  )
  if (problem) return { ok: false, problem }
  const source = kind === 'regex' ? draft.source.trim() : (normalizeRedirectSource(draft.source) as string)
  const destination = normalizeRedirectDestination(draft.destination) as string
  if (kind !== 'regex' && isSelfRedirect({ source, destination })) {
    return { ok: false, problem: 'That would redirect the path to itself' }
  }
  const live = rules.filter((rule) => !rule.deletedAt)
  if (findDuplicateRedirect(live as never, { $id: draft.id, source, kind })) {
    return { ok: false, problem: `A rule for ${source} already exists` }
  }
  if (walkRedirectChain(live as never, { $id: draft.id, source, destination }).loop) {
    return { ok: false, problem: 'That destination chains back to this rule — a redirect loop' }
  }
  const statusCode = (REDIRECT_STATUS_CODES as readonly number[]).includes(Number(draft.statusCode))
    ? Number(draft.statusCode)
    : 302
  const notice = redirectSourceIsLivePage(host.screens as never, source)
    ? `${source} is a published page — the redirect takes precedence`
    : null
  return { ok: true, source, destination, statusCode, kind, notice }
}

/** Rules a check reads, past the page's 200-rule window, so a duplicate or loop beyond it is still caught. */
const RULES_WINDOW = 500

/**
 * `POST /api/redirects/check`: runs {@link checkRedirectSave} for a member
 * who may publish on the site (the role the Firestore rules gate redirect
 * writes on). It reads and answers; it writes nothing, so the save itself
 * stays the same write the page makes, under the same rules.
 */
export const redirectCheckHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  if (!hostId || /^__.*__$/.test(hostId) || hostId.includes('/')) return res.status(400).json({ error: 'Missing hostId' })
  const draft: RedirectSaveDraft = {
    id: typeof body.id === 'string' && body.id ? body.id : undefined,
    kind: typeof body.kind === 'string' ? body.kind : undefined,
    source: String(body.source ?? '').slice(0, 2000),
    destination: String(body.destination ?? '').slice(0, 2000),
    statusCode: Number(body.statusCode),
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
    const host = await hostRef.get()
    if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
    const role = (host.get('memberRoles') ?? {})[decoded.uid]
    if (role !== 'admin' && role !== 'editor') {
      return res.status(403).json({ error: 'Changing a redirect needs a publishing role — ask an editor or admin' })
    }
    const snapshot = await hostRef.collection('redirects').limit(RULES_WINDOW).get()
    const rules = snapshot.docs.map((doc: { id: string; data: () => Record<string, unknown> }) => ({ $id: doc.id, ...doc.data() }))
    return res.status(200).json(checkRedirectSave(draft, host.data() ?? {}, rules))
  } catch (error) {
    console.error('[redirects/check]', error)
    return res.status(500).json({ error: 'The redirect could not be checked' })
  }
}
