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
 * One row per human in the staff Users list, across EVERY loaded page
 * (AGL-2005).
 *
 * **decided:** "We still have two users list in this list with the
 * same uid but one without an email attached, this needs fixed we should only
 * see one user, even if they are sso."
 *
 * `collapseCrossPoolUidRows` in `@aglyn/tenant-data-admin` already merges the
 * twins, and `GET /api/admin/users` already calls it — but it can only merge
 * rows it is handed together, and the route hands it ONE PAGE. The staff page
 * paginates: `listUsersAcrossPools` walks the project pool 200 at a time and
 * appends the GCIP tenant users only on the LAST page, and the page itself
 * accumulates (`[...previous, ...payload.users]`).
 *
 * So the moment the project pool needs a second page, the emailless project
 * twin arrives on page 1 and the real SSO record it belongs to arrives on the
 * final page. Neither collapse call ever sees both, `markCrossPoolUidCollisions`
 * is explicitly skipped on the non-final pages ("a uid cannot collide with
 * itself inside one pool"), and the reported bug is back verbatim: two rows for
 * one human, and the twin carrying no merged chip at all — so it reads as a
 * legitimate second account rather than an artifact. The per-page collapse
 * masks this only because the project pool is currently under one page.
 *
 * The guarantee therefore has to be re-applied where the list is actually
 * assembled, which is the client. This is that pass. It is deliberately the
 * same shape of rule as the server's:
 *
 *  - **Keyed on uid, never on email.** A uid is unique WITHIN a pool, so the
 *    same uid in two pools is one person plus an artifact of a cross-pool
 *    custom-token mint. Two people who share an address have two uids and stay
 *    two rows — merging those would delete a real account from the console,
 *    which is a worse bug than the one being fixed and an invisible one.
 *  - **The identified record wins.** An emailless, providerless artifact can
 *    never be the row staff read.
 *  - **The collision is not discarded.** The survivor carries `uidAlsoInPools`
 *    naming every other pool that held the uid — including, and this is the
 *    part the per-page collapse structurally cannot do, a pool whose row
 *    arrived on a different page.
 *
 * Actions are unaffected by which twin wins: the page posts `record.uid` and
 * `/api/admin/users/manage` re-resolves through `findUserByUidAcrossPools`,
 * which ranks by identity with the same rule. What a wrong survivor would cost
 * is the DISPLAY — staff reading "no email, no provider" while the action lands
 * on the real account — so the ranking still has to match.
 */

/**
 * The fields the merge reads. Structural on purpose: the page's `AdminUser`
 * satisfies it, and this module must not import from `@aglyn/tenant-data-admin`
 * — that barrel is server-only and pulling it into a client component drags
 * `firebase-admin` into the browser bundle.
 */
export interface CollapsibleAdminUserRow {
  uid: string
  email?: string | null
  displayName?: string | null
  staff?: boolean
  providers?: string[] | null
  /** GCIP tenant id, or null/undefined for the project-level pool. */
  tenantId?: string | null
  /** Pools other than this row's own that also hold this uid. */
  uidAlsoInPools?: (string | null)[] | null
}

/**
 * How strongly a serialized row identifies its human. Ordering only.
 *
 * Mirrors `identityStrength` in `auth-pools.ts`, with the same weights so the
 * row staff read is the record the action mutates. The one term it cannot
 * carry is `phoneNumber`, which the route does not serialize — harmless,
 * because email (8) and providers (4) outweigh every tie-breaker combined
 * (2 + 1 + 1), so the identified-versus-artifact decision is identical either
 * way. Only ties BETWEEN two already-identified records could order
 * differently, and two identified records under one uid both name the same
 * human.
 *
 * As on the server, `displayName` and the staff claim are tie-breakers and
 * never enough on their own: both can be written onto any record after the
 * fact by `updateProfile` and `grantStaff`, so a twin that a staff action had
 * already landed on must not start winning because it was acted upon.
 */
export function adminUserRowIdentityStrength(
  row: CollapsibleAdminUserRow,
): number {
  if (!row) return 0
  let score = 0
  if (row.email) score += 8
  if ((row.providers?.length ?? 0) > 0) score += 4
  if (row.displayName) score += 1
  if (row.staff) score += 1
  return score
}

/**
 * Every pool a group of same-uid rows was found in, in encounter order.
 *
 * Both sources matter. A row's own `tenantId` is where IT lives; its
 * `uidAlsoInPools` is what the server saw on the page that row came from. On a
 * cross-page collision only the first is populated, which is exactly why the
 * merge cannot rely on the marker alone.
 */
function poolsForGroup(rows: CollapsibleAdminUserRow[]): (string | null)[] {
  const pools: (string | null)[] = []
  // `null` is the project pool and is a perfectly good Set member, so this
  // needs no sentinel string — and must not invent one, since any sentinel
  // is a value a GCIP tenant id could in principle take.
  const seen = new Set<string | null>()
  const add = (pool: string | null | undefined) => {
    const normalized = pool ?? null
    if (seen.has(normalized)) return
    seen.add(normalized)
    pools.push(normalized)
  }
  for (const row of rows) {
    add(row.tenantId)
    for (const pool of row.uidAlsoInPools ?? []) add(pool)
  }
  return pools
}

/**
 * Collapse rows sharing a uid to one row apiece.
 *
 * The survivor takes the FIRST occurrence's position so loading another page
 * never reshuffles the rows above it, and ties keep the earlier row so the
 * result is deterministic. Idempotent: re-running it over already-collapsed
 * output changes nothing, which matters because the route collapses each page
 * before this ever sees it.
 */
export function collapseAdminUserRows<T extends CollapsibleAdminUserRow>(
  rows: T[],
): T[] {
  if (!rows?.length) return rows ?? []
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(row.uid)
    if (group) group.push(row)
    else groups.set(row.uid, [row])
  }
  const emitted = new Set<string>()
  const collapsed: T[] = []
  for (const row of rows) {
    if (emitted.has(row.uid)) continue
    emitted.add(row.uid)
    const group = groups.get(row.uid) ?? [row]
    if (group.length < 2) {
      collapsed.push(row)
      continue
    }
    let winner = group[0]
    for (const candidate of group) {
      if (
        adminUserRowIdentityStrength(candidate) >
        adminUserRowIdentityStrength(winner)
      ) {
        winner = candidate
      }
    }
    // Everything the group was found in, minus the survivor's own pool — the
    // chip says where the records folded INTO this row came from.
    const own = winner.tenantId ?? null
    const alsoIn = poolsForGroup(group).filter((pool) => pool !== own)
    collapsed.push({
      ...winner,
      ...(alsoIn.length ? { uidAlsoInPools: alsoIn } : {}),
    })
  }
  return collapsed
}
