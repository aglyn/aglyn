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
import type { ActivityNames } from '@aglyn/aglyn/app-utils/activity-labels'
import { resolveUidsToPeople } from '@aglyn/tenant-data-admin'

/**
 * The few facts of an audit row's `after` a list may show (AGL-3660): what
 * an AI act made, on which site, for how many credits, and how it ended.
 * Whitelisted, never the whole object — `after` can hold a billing
 * snapshot, and a list is not the place to ship one to the browser.
 */
export interface AuditAfterSummary {
  label?: string
  resource?: string
  hostId?: string
  credits?: number
  result?: string
  status?: string
}

export function auditAfterSummary(after: unknown): AuditAfterSummary | null {
  if (!after || typeof after !== 'object') return null
  const source = after as Record<string, unknown>
  const out: AuditAfterSummary = {}
  for (const key of ['label', 'resource', 'hostId', 'result', 'status'] as const) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 200)
  }
  if (typeof source['credits'] === 'number' && Number.isFinite(source['credits'])) {
    out.credits = source['credits']
  }
  return Object.keys(out).length ? out : null
}

/** The ids an audit target path names, by collection. */
function idsIn(path: string | null | undefined, collection: string): string[] {
  const segments = String(path ?? '').split('/').filter(Boolean)
  const ids: string[] = []
  for (let at = 0; at < segments.length - 1; at += 2) {
    if (segments[at] === collection && segments[at + 1]) ids.push(segments[at + 1] as string)
  }
  return ids
}

/** Reads at most this many documents of each kind to name one page. */
const NAME_READS = 60

/**
 * The organization, site and account names a page of audit rows mentions,
 * so the list reads `Acme Bakery · Home` rather than a path. Fails soft: a
 * name that cannot be read leaves the row its generic noun.
 */
export async function resolveAuditNames(
  firestore: FirebaseFirestore.Firestore,
  rows: ReadonlyArray<{
    target?: string | null
    subjectUid?: string | null
    actorUid?: string | null
    after?: AuditAfterSummary | null
  }>,
): Promise<ActivityNames> {
  const orgIds = new Set<string>()
  const hostIds = new Set<string>()
  const uids = new Set<string>()
  for (const row of rows) {
    idsIn(row.target, 'orgs').forEach((id) => orgIds.add(id))
    idsIn(row.target, 'hosts').forEach((id) => hostIds.add(id))
    idsIn(row.target, 'users').forEach((id) => uids.add(id))
    if (row.after?.hostId) hostIds.add(row.after.hostId)
    if (row.subjectUid) uids.add(row.subjectUid)
    if (row.actorUid && !row.actorUid.includes(':')) uids.add(row.actorUid)
  }
  const read = async (collection: string, ids: Set<string>) => {
    const refs = [...ids].slice(0, NAME_READS).map((id) => firestore.collection(collection).doc(id))
    if (!refs.length) return {}
    try {
      const snapshots = await firestore.getAll(...refs)
      return Object.fromEntries(
        snapshots
          .filter((snapshot) => snapshot.exists)
          .map((snapshot) => [
            snapshot.id,
            String(snapshot.get('name') ?? snapshot.get('title') ?? snapshot.get('subdomain') ?? '') ||
              null,
          ]),
      )
    } catch (error) {
      console.error('audit names: read failed', { collection, error })
      return {}
    }
  }
  const [orgs, hosts, people] = await Promise.all([
    read('orgs', orgIds),
    read('hosts', hostIds),
    resolveUidsToPeople([...uids].slice(0, NAME_READS)).catch(() => ({})),
  ])
  const users = Object.fromEntries(
    Object.entries(people as Record<string, { email?: string | null; displayName?: string | null }>).map(
      ([uid, person]) => [uid, person.email ?? person.displayName ?? null],
    ),
  )
  return { orgs, hosts, users }
}

/**
 * Each activity entry with the name of the site or organization it was read
 * from (AGL-3660), so a Where cell reads `Acme Bakery` rather than a host
 * id. Fails soft: an unreadable name leaves the entry as it was.
 */
export async function withScopeNames<
  Entry extends { scopeType: string; scopeId: string; scopeName?: string | null },
>(firestore: FirebaseFirestore.Firestore, entries: Entry[]): Promise<Entry[]> {
  const ids = (type: string) =>
    new Set(entries.filter((entry) => entry.scopeType === type).map((entry) => entry.scopeId))
  const names = await resolveAuditNames(firestore, [
    ...[...ids('host')].map((id) => ({ target: `hosts/${id}` })),
    ...[...ids('org')].map((id) => ({ target: `orgs/${id}` })),
  ])
  return entries.map((entry) => {
    const name =
      entry.scopeType === 'host'
        ? names.hosts?.[entry.scopeId]
        : entry.scopeType === 'org'
          ? names.orgs?.[entry.scopeId]
          : null
    return name ? { ...entry, scopeName: name } : entry
  })
}
