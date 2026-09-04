/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * What MAINTAINS the denormalized permission map, and what bounds its
 * staleness.
 *
 * The rules now decide dataset writes from `resolvedPermissions` on the member
 * document. A denormalized authorization field is only as good as its writer:
 * stale one way it refuses someone who is entitled, stale the other it grants
 * someone who is not, and neither shows up anywhere until it matters.
 *
 * Two things maintain it and this file pins both.
 *
 * 1. `syncOrgAuthProjections` — already called by every membership mutation
 *    (add, role change, host grant/revoke, removal, ownership transfer, host
 *    registration), now writing the resolved map alongside `scopeTokens`.
 * 2. `/api/orgs/roles` — the one authorization change in the console that
 *    touches NO membership. Editing a custom role's permission map changes
 *    what every carrier may do while leaving every member document untouched,
 *    so it reached none of the six callers above. Without a sync there, a
 *    revoked key stays granted in the rules indefinitely while every server
 *    route refuses it.
 *
 * ⚠️ Anti-vacuity: the expected maps are computed with the REAL
 * `resolveOrgPermissions` — the same function the API resolves with — so this
 * cannot pass by agreeing with a restatement of itself. And the fixture
 * carries a member whose custom role REVOKES and one whose custom role
 * GRANTS, because a projection that ignored the role document entirely would
 * satisfy a fixture built from role defaults alone.
 */

import { resolveOrgPermissions } from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ORG = 'org-1'

interface StoredDoc {
  [key: string]: unknown
}

/** Every `roles/{id}` read the projection performs. */
let roleReads: string[]
let members: Record<string, StoredDoc>
let roles: Record<string, StoredDoc>
/** What the batched writes left on each member document. */
let written: Record<string, StoredDoc>

/**
 * A small in-memory Admin SDK, covering exactly the shape
 * `syncOrgAuthProjections` uses: the org doc, its `members` listing, its
 * `roles` documents, and batched merge writes.
 */
const makeFirestore = () => {
  const memberDoc = (id: string) => ({
    id,
    _path: `members/${id}`,
  })
  const roleDoc = (id: string) => ({
    id,
    _path: `roles/${id}`,
    get: async () => {
      roleReads.push(id)
      const data = roles[id]
      return { exists: data !== undefined, data: () => data }
    },
  })
  const orgDoc = {
    get: async () => ({ data: () => ({ hosts: {} }) }),
    collection: (name: string) => {
      if (name === 'members') {
        return {
          doc: memberDoc,
          get: async () => ({
            docs: Object.entries(members).map(([id, data]) => ({
              id,
              data: () => data,
            })),
          }),
        }
      }
      if (name === 'roles') return { doc: roleDoc }
      throw new Error(`unexpected subcollection ${name}`)
    },
  }
  return {
    collection: (name: string) => {
      if (name === 'orgs') return { doc: () => orgDoc }
      // `hosts` — the org under test owns none, so nothing addresses this.
      if (name === 'hosts') return { doc: (id: string) => ({ id, _path: `hosts/${id}` }) }
      throw new Error(`unexpected collection ${name}`)
    },
    batch: () => {
      const ops: Array<[{ _path: string }, StoredDoc]> = []
      return {
        set: (ref: { _path: string }, data: StoredDoc) => {
          ops.push([ref, data])
        },
        commit: async () => {
          for (const [ref, data] of ops) {
            if (!ref._path.startsWith('members/')) continue
            const id = ref._path.slice('members/'.length)
            written[id] = { ...(written[id] ?? {}), ...data }
          }
        },
      }
    },
  }
}

jest.mock(
  '../../../libs/tenant/data/admin/src/lib/server/firebase-admin',
  () => ({
    __esModule: true,
    default: { app: () => ({ firestore: () => makeFirestore() }) },
  }),
)

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'ts', delete: () => 'deleted' },
}))

import { syncOrgAuthProjections } from '@aglyn/tenant-data-admin'

beforeEach(() => {
  roleReads = []
  written = {}
  roles = {
    // Revokes the key an editor holds by default.
    'role-limited': { name: 'Limited', permissions: { 'data.manage': false } },
    // Grants a key a viewer does not hold. The resolver applies it; the
    // ROLE gate downstream is what still refuses the write.
    'role-granting': { name: 'Granting', permissions: { 'data.manage': true } },
  }
  members = {
    'uid-owner': { role: 'owner', allHosts: true },
    'uid-editor': { role: 'editor', allHosts: true },
    'uid-editor-revoked': {
      role: 'editor',
      allHosts: true,
      roleId: 'role-limited',
    },
    'uid-editor-restored': {
      role: 'editor',
      allHosts: true,
      roleId: 'role-limited',
      permissions: { 'data.manage': true },
    },
    'uid-viewer-granted': {
      role: 'viewer',
      allHosts: true,
      roleId: 'role-granting',
    },
    // A dangling reference: the role was deleted and the cleanup has not
    // landed, or landed partially.
    'uid-editor-dangling': {
      role: 'editor',
      allHosts: true,
      roleId: 'role-deleted',
    },
  }
})

describe('syncOrgAuthProjections writes the resolved permission map', () => {
  it('stamps every member with the resolver’s own verdict', async () => {
    await syncOrgAuthProjections(ORG)

    for (const [uid, member] of Object.entries(members)) {
      const roleId = member['roleId'] as string | undefined
      const customRole = roleId
        ? ((roles[roleId] ?? null) as never)
        : null
      expect(written[uid]?.['resolvedPermissions']).toEqual(
        resolveOrgPermissions(member as never, customRole),
      )
    }
  })

  it('THE POINT: a revoking custom role reaches the stamped map', async () => {
    await syncOrgAuthProjections(ORG)
    const revoked = written['uid-editor-revoked']?.[
      'resolvedPermissions'
    ] as Record<string, boolean>
    expect(revoked['data.manage']).toBe(false)
    // The CONTROL that stops a projection which simply writes all-false, or
    // which ignores the role document and writes role defaults, from passing.
    const plain = written['uid-editor']?.['resolvedPermissions'] as Record<
      string,
      boolean
    >
    expect(plain['data.manage']).toBe(true)
    // Editor defaults are not all-true either, so the map is a real verdict.
    expect(plain['billing.manage']).toBe(false)
  })

  it('a per-member override still beats the custom role', async () => {
    await syncOrgAuthProjections(ORG)
    const restored = written['uid-editor-restored']?.[
      'resolvedPermissions'
    ] as Record<string, boolean>
    expect(restored['data.manage']).toBe(true)
  })

  it('a DANGLING roleId falls back to the role defaults, never to deny', async () => {
    // A deleted role must not lock a member out of what their base role
    // allows — the same fallback `resolveMemberOrgPermissions` applies
    // server-side with the identical dangling id.
    await syncOrgAuthProjections(ORG)
    const dangling = written['uid-editor-dangling']?.[
      'resolvedPermissions'
    ] as Record<string, boolean>
    expect(dangling['data.manage']).toBe(true)
    expect(dangling).toEqual(
      resolveOrgPermissions({ role: 'editor', allHosts: true } as never, null),
    )
  })

  it('reads each DISTINCT role document once, not once per member', async () => {
    // Two members carry `role-limited`. A resolver called per member would
    // read it twice, and a roster of hundreds sharing a handful of roles is
    // the normal shape — this is the difference between a bounded cost and
    // one that scales with the member count.
    await syncOrgAuthProjections(ORG)
    expect(roleReads.sort()).toEqual([
      'role-deleted',
      'role-granting',
      'role-limited',
    ])
  })

  it('still writes scopeTokens — the projection it shares a writer with', async () => {
    // The control against a change that swapped one projection for the other.
    await syncOrgAuthProjections(ORG)
    expect(written['uid-owner']?.['scopeTokens']).toEqual(['org'])
  })
})

describe('the custom-role editor re-projects the roster', () => {
  const route = readFileSync(
    join(__dirname, '../app/api/orgs/roles/route.ts'),
    'utf8',
  )

  it('SAVING a role calls the projection sync', () => {
    /*
     * A source assertion, because this is the one authorization change with
     * no membership write to hang a behavioral test on — and because its
     * absence is silent: every server route keeps refusing correctly while
     * the rules go on granting. The two occurrences are the save and the
     * delete branches.
     */
    expect(route).toContain('await syncOrgAuthProjections(orgId)')
    expect(route.split('await syncOrgAuthProjections(orgId)').length - 1).toBe(2)
  })

  it('AWAITS it, so a narrowing is in force before the 200', () => {
    // Fired and forgotten, the response would tell the console the change is
    // live while the rules still grant.
    expect(route).not.toMatch(/void syncOrgAuthProjections/)
    expect(route).not.toMatch(/syncOrgAuthProjections\(orgId\)\.catch/)
  })

  it('CONTROL: the sync is imported from the admin lib, not shadowed', () => {
    expect(route).toContain('syncOrgAuthProjections,')
    expect(route).toContain("} from '@aglyn/tenant-data-admin'")
  })
})
