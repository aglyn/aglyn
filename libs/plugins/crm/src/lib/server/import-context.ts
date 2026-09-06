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

/**
 * WHAT EVERY CSV IMPORT ROUTE ASKS BEFORE IT READS A ROW (AGL-2602, shared
 * by the companies import since AGL-2621).
 *
 * Who is asking and on whose behalf, whether the request is the size a
 * chunk is allowed to be, and — when a row names an owner — which member
 * of the org that address is. The contacts route settled each answer; the
 * companies route needs the same three and must not spell them
 * differently, because two gates for one permission is how one of them
 * comes to be wider.
 *
 * ## Who may call an import
 *
 * The same two gates the rules put on every CRM collection: a site role
 * on the host the request names, AND the organization's `data.manage`
 * permission resolved through the member's custom role and overrides. The
 * Admin SDK evaluates no rules, so this is the enforcement rather than an
 * echo of it — and `data.manage` rather than the raw role because an owner
 * who unticked "Manage data" on a custom role meant it. A staff token
 * passes both gates the way it does on every console route: support
 * importing a customer's file for them is the support act this exists for.
 */

import {
  consentGroupScope,
  crmScopeTokens,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  listOrgMembers,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/** Everything an import needs about who is asking, or the refusal to send back. */
export type ImportContext =
  | {
      ok: true
      uid: string
      hostId: string
      orgId: string
      org: Record<string, unknown>
      /**
       * The stamp a record CREATED by this import carries — the org, when
       * the org widened its default, and otherwise the capturing group.
       */
      scopeTokens: string[]
      /**
       * The tokens a record must overlap to be SEEN from this site: the
       * group's own, plus `org`, because an org-wide record is visible to
       * every site in the account. The reader's set is wider than the
       * creator's stamp, exactly as it is on the collection listeners.
       */
      readTokens: string[]
    }
  | { ok: false; status: number; body: Record<string, unknown> }

export type ImportRequest = Parameters<PluginApiHandler>[0]

/** Who is asking, and on whose behalf. */
export async function resolveImportContext(req: ImportRequest): Promise<ImportContext> {
  const hostId = String(req.body?.hostId ?? '')
  if (!hostId) {
    return { ok: false, status: 400, body: { error: 'Missing hostId' } }
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return { ok: false, status: 401, body: { error: 'Unauthenticated' } }
  }
  const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  const staff = decoded['staff'] === true
  const firestore = firebaseAdmin.app().firestore()
  const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
  if (!hostSnapshot.exists) {
    return { ok: false, status: 404, body: { error: 'Unknown site' } }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
  if (!staff && memberRole !== 'admin' && memberRole !== 'editor') {
    return {
      ok: false,
      status: 403,
      body: { error: 'Not a site admin or editor' },
    }
  }
  const resolved = await getOrgForHost(hostId).catch(() => null)
  const orgId = String(resolved?.orgId ?? '')
  if (!orgId) {
    return {
      ok: false,
      status: 404,
      body: { error: 'This site has no organization, so it has no CRM.' },
    }
  }
  const org = (resolved?.org ?? {}) as Record<string, unknown>
  const membership = await resolveOrgMembership(decoded.uid, orgId).catch(
    () => null,
  )
  const member = membership?.member
  if (
    !staff &&
    (!member ||
      (member as { orgSuspended?: boolean }).orgSuspended === true ||
      !(await memberHasOrgPermission(orgId, member, 'data.manage')))
  ) {
    return {
      ok: false,
      status: 403,
      body: {
        error:
          'Your organization role does not allow managing contacts and ' +
          'companies, so it cannot import them.',
      },
    }
  }
  const group = await consentGroupForSite(hostId)
  return {
    ok: true,
    uid: decoded.uid,
    hostId,
    orgId,
    org,
    scopeTokens: crmScopeTokens(org, group),
    readTokens: [ORG_SCOPE_TOKEN, ...consentGroupScope(group)],
  }
}

/** The rows a request may carry, or the refusal to send back. */
export function readImportRows<R>(
  req: ImportRequest,
  limits: { maxBodyBytes: number; chunkSize: number },
): { rows: R[] } | { status: number; error: string } {
  if ((req.rawBody?.length ?? 0) > limits.maxBodyBytes) {
    return {
      status: 413,
      error: 'That request is too large. Import the file in smaller pieces.',
    }
  }
  const rows = req.body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: 400, error: 'No rows to import.' }
  }
  if (rows.length > limits.chunkSize) {
    return {
      status: 400,
      error: `At most ${limits.chunkSize} rows per request.`,
    }
  }
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    return { status: 400, error: 'Every row must be an object.' }
  }
  return { rows: rows as R[] }
}

/**
 * The org's members by address, read only when a row names an owner.
 *
 * A file with no owner column costs no roster read; a file with one costs
 * exactly one, however many rows it has.
 */
export async function ownerDirectory(
  orgId: string,
  rows: readonly { ownerEmail?: string }[],
): Promise<Map<string, string>> {
  const directory = new Map<string, string>()
  if (!rows.some((row) => row.ownerEmail)) return directory
  const members = await listOrgMembers(orgId)
  for (const member of members) {
    const email = String(member.email ?? '')
      .trim()
      .toLowerCase()
    if (email && member.$id) directory.set(email, String(member.$id))
  }
  return directory
}
