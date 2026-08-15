/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * `revokeHostAccess` must not RE-CREATE the membership it is removing from
 * (AGL-1766).
 *
 * The write had no read at all — the only site on AGL-1763's list with none —
 * and a merge-set whose whole payload is a delete sentinel still creates the
 * document. What it created is not a stray row: `isOrgWideMember` reads "no
 * role, no `allHosts`, empty `hostAccess`" as the pre-`allHosts` LEGACY member
 * shape and answers TRUE, so the conjured doc is a full org-wide membership
 * for someone who was removed from the org.
 *
 * Two things this spec is careful about, because both were measured wrong
 * elsewhere first:
 *
 *  - the fake's `set({ merge: true })` merges maps RECURSIVELY and honours
 *    delete sentinels at ANY depth. A shallow spread invents reds — it drops
 *    sentinels on the floor and replaces whole maps, so tests fail for a
 *    reason the subject never had.
 *  - the fake's `update()` reproduces BOTH halves of the real contract: it
 *    rejects a missing document with the real gRPC `NOT_FOUND`, and it rejects
 *    a delete sentinel below the patch root with `INVALID_ARGUMENT`
 *    (`allowDeletes: 'root'`). Without the second half, a revert to the nested
 *    map would sail through here and 500 in production instead.
 *
 * The predicates are the REAL ones from `@aglyn/aglyn/server`, not re-typed
 * copies (AGL-1715) — the whole severity claim is a claim about them.
 */

import {
  isOrgWideMember,
  projectMemberScopeTokens,
} from '@aglyn/aglyn/server'
import { updateExisting } from './update-existing'

/** gRPC `Status.NOT_FOUND` — Firestore's "no entity to update". */
const GRPC_NOT_FOUND = 5
/** gRPC `Status.INVALID_ARGUMENT` — what a non-root delete sentinel earns. */
const GRPC_INVALID_ARGUMENT = 3

const DELETE_SENTINEL = { __sentinel: 'delete' }
const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' }

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    delete: () => DELETE_SENTINEL,
    serverTimestamp: () => SERVER_TIMESTAMP,
  },
}))

/** Every document, keyed by its full path. */
let docs = new Map<string, Record<string, unknown>>()

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => makeFirestore() }) },
}))

// Not the subject, and each needs a fake surface of its own. The projection
// that IS the subject's blast radius — `syncOrgAuthProjections` — lives in
// `organizations.ts` itself and runs for real.
jest.mock('./host-memberships', () => ({
  __esModule: true,
  deleteMemberHostProjections: jest.fn(async () => undefined),
  syncHostProjectionForMembers: jest.fn(async () => undefined),
  syncMemberHostProjections: jest.fn(async () => undefined),
}))
jest.mock('./auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: jest.fn(async () => null),
}))
jest.mock('./workspace-domains', () => ({
  __esModule: true,
  attachWorkspaceDomain: jest.fn(async () => undefined),
}))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value !== DELETE_SENTINEL &&
    value !== SERVER_TIMESTAMP
  )
}

/**
 * What `set(…, { merge: true })` actually does: deep-merge, and a delete
 * sentinel removes its key wherever it appears.
 */
function mergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE_SENTINEL) {
      delete next[key]
    } else if (isPlainObject(value)) {
      next[key] = mergeInto(
        isPlainObject(next[key]) ? (next[key] as Record<string, unknown>) : {},
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

/** Does a value carry a delete sentinel anywhere below its own root? */
function hasNestedDelete(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  return Object.values(value).some(
    (nested) => nested === DELETE_SENTINEL || hasNestedDelete(nested),
  )
}

/** Applies one `update()` field PATH (dot-separated, as the SDK splits it). */
function writeFieldPath(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown,
): void {
  const [head, ...rest] = segments
  if (!rest.length) {
    if (value === DELETE_SENTINEL) delete target[head]
    else target[head] = value
    return
  }
  if (!isPlainObject(target[head])) target[head] = {}
  writeFieldPath(target[head] as Record<string, unknown>, rest, value)
}

function grpcError(code: number, message: string): Error & { code: number } {
  const error = new Error(message) as Error & { code: number }
  error.code = code
  return error
}

function makeDoc(path: string) {
  return {
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => ({
      exists: docs.has(path),
      id: path.split('/').pop(),
      data: () => docs.get(path),
      get: (field: string) => (docs.get(path) ?? {})[field],
    }),
    set: async (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => {
      docs.set(
        path,
        options?.merge
          ? mergeInto(docs.get(path) ?? {}, data)
          : mergeInto({}, data),
      )
      return undefined
    },
    /**
     * Faithful in the two ways everything below rests on: reject-on-missing,
     * and reject a sentinel below the root.
     */
    update: async (data: Record<string, unknown>) => {
      for (const value of Object.values(data)) {
        if (hasNestedDelete(value)) {
          throw grpcError(
            GRPC_INVALID_ARGUMENT,
            '3 INVALID_ARGUMENT: FieldValue.delete() must appear at the ' +
              `top level of the update data (${path})`,
          )
        }
      }
      if (!docs.has(path)) {
        throw grpcError(
          GRPC_NOT_FOUND,
          `5 NOT_FOUND: no entity to update: ${path}`,
        )
      }
      const next = { ...docs.get(path) }
      for (const [key, value] of Object.entries(data)) {
        writeFieldPath(next, key.split('.'), value)
      }
      docs.set(path, next)
      return undefined
    },
  }
}

function makeCollection(prefix: string) {
  return {
    doc: (id: string) => makeDoc(`${prefix}/${id}`),
    get: async () => {
      const matched = [...docs.entries()].filter(
        ([path]) =>
          path.startsWith(`${prefix}/`) &&
          !path.slice(prefix.length + 1).includes('/'),
      )
      return {
        empty: matched.length === 0,
        size: matched.length,
        docs: matched.map(([path, data]) => ({
          id: path.split('/').pop(),
          ref: makeDoc(path),
          data: () => data,
          get: (field: string) => data[field],
        })),
      }
    },
  }
}

function makeFirestore() {
  return {
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const queued: Array<() => Promise<void>> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(async () => {
            await makeDoc(ref.path).set(data, options)
          })
          return batch
        },
        delete: (ref: { path: string }) => {
          queued.push(async () => {
            docs.delete(ref.path)
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) await write()
        },
      }
      return batch
    },
  }
}

const { revokeHostAccess } = require('./organizations') as {
  revokeHostAccess: (
    orgId: string,
    uid: string,
    hostId: string,
  ) => Promise<void>
}

const ORG = 'org-7'
const HOST = 'hostAAAAAA'
const OTHER_HOST = 'hostBBBBBB'

/** An org with two sites and one real, still-present collaborator. */
function seed(): void {
  docs.set(`orgs/${ORG}`, {
    name: 'Seven',
    hosts: { [HOST]: true, [OTHER_HOST]: true },
  })
  docs.set(`hosts/${HOST}`, { orgId: ORG, displayName: 'Site A' })
  docs.set(`hosts/${OTHER_HOST}`, { orgId: ORG, displayName: 'Site B' })
  docs.set(`orgs/${ORG}/members/uid-real`, {
    role: 'viewer',
    allHosts: false,
    email: 'real@example.com',
    hostAccess: { [HOST]: 'editor', [OTHER_HOST]: 'admin' },
    joinedAt: SERVER_TIMESTAMP,
  })
}

beforeEach(() => {
  docs = new Map()
  seed()
})

describe('revokeHostAccess refuses to resurrect a membership (AGL-1766)', () => {
  it('mints NOTHING for a uid that is no longer an org member', async () => {
    // The reachable sequence, in order: `removeOrgMember` took the org member
    // doc but left the `hosts/{hostId}/members` roster row it never touches;
    // deleting that leftover row is what calls this.
    expect(docs.has(`orgs/${ORG}/members/uid-gone`)).toBe(false)

    await revokeHostAccess(ORG, 'uid-gone', HOST)

    expect(docs.has(`orgs/${ORG}/members/uid-gone`)).toBe(false)
    // And the projection pass on the next line found nothing to stamp — the
    // half of the damage that lands somewhere other than where it is caused.
    expect(docs.get(`orgs/${ORG}/members/uid-gone`)?.['scopeTokens']).toBe(
      undefined,
    )
  })

  it('leaves the roster at its real size, so no seat is billed', async () => {
    // `countManagerSeats` counts entries `isOrgWideMember` accepts, and the
    // phantom is one of those — an extra manager seat charged to the org for
    // a person who is not in it.
    await revokeHostAccess(ORG, 'uid-gone', HOST)

    const roster = [...docs.keys()].filter((path) =>
      path.startsWith(`orgs/${ORG}/members/`),
    )
    expect(roster).toEqual([`orgs/${ORG}/members/uid-real`])
  })

  it('does not disturb the members who ARE there, field by field', async () => {
    await revokeHostAccess(ORG, 'uid-gone', HOST)

    const member = docs.get(`orgs/${ORG}/members/uid-real`) as Record<
      string,
      unknown
    >
    expect(member['role']).toBe('viewer')
    expect(member['allHosts']).toBe(false)
    expect(member['email']).toBe('real@example.com')
    expect(member['hostAccess']).toEqual({
      [HOST]: 'editor',
      [OTHER_HOST]: 'admin',
    })
  })

  it('BEHAVIOUR PIN: a real revoke still clears exactly one grant', async () => {
    // What the dotted path had to preserve. A rewrite that replaced the
    // `hostAccess` map — the obvious way to get a sentinel to the root —
    // would silently revoke the member's OTHER site here.
    await revokeHostAccess(ORG, 'uid-real', HOST)

    const member = docs.get(`orgs/${ORG}/members/uid-real`) as Record<
      string,
      unknown
    >
    expect(member['hostAccess']).toEqual({ [OTHER_HOST]: 'admin' })
    expect(member['role']).toBe('viewer')
    expect(member['allHosts']).toBe(false)
    expect(member['email']).toBe('real@example.com')
    expect(member['joinedAt']).toBe(SERVER_TIMESTAMP)
    // The rules projection re-derived from the map that is actually stored.
    expect(member['scopeTokens']).toEqual(['org', `host:${OTHER_HOST}`])
  })

  it('BEHAVIOUR PIN: revoking the LAST grant does not widen the member', async () => {
    // Empty `hostAccess` is only read as org-wide when `allHosts` is absent
    // too. A genuine collaborator always carries `allHosts: false`, which is
    // exactly why the conjured document — carrying neither — is the dangerous
    // one and this one is not.
    docs.set(`orgs/${ORG}/members/uid-solo`, {
      role: 'viewer',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
    })

    await revokeHostAccess(ORG, 'uid-solo', HOST)

    const member = docs.get(`orgs/${ORG}/members/uid-solo`) as Record<
      string,
      unknown
    >
    expect(member['hostAccess']).toEqual({})
    expect(member['allHosts']).toBe(false)
    expect(isOrgWideMember(member)).toBe(false)
    expect(member['scopeTokens']).toEqual(['org'])
  })

  it('WHY IT MATTERS: the conjured shape reads as an ORG-WIDE member', () => {
    // Not an assertion about the fix — an assertion about the predicates the
    // phantom would have been fed to, using the real ones. This is the whole
    // severity claim, and it is why "an empty members doc" understates it.
    expect(isOrgWideMember({})).toBe(true)
    expect(isOrgWideMember({ hostAccess: {} })).toBe(true)
    expect(projectMemberScopeTokens({})).toEqual(['org'])
    // The control: a real collaborator with the same empty map is NOT.
    expect(
      isOrgWideMember({ role: 'viewer', allHosts: false, hostAccess: {} }),
    ).toBe(false)
  })

  it('WHY DOTTED: the nested map would be rejected, not silently accepted', async () => {
    // `set({ merge: true })` takes a sentinel at any depth; `update()` takes
    // one only at the patch root. A mechanical switch to `update()` that kept
    // `{ hostAccess: { [hostId]: delete } }` trades a phantom for a 500.
    const ref = makeDoc(`orgs/${ORG}/members/uid-real`)
    await expect(
      updateExisting(ref, { hostAccess: { [HOST]: DELETE_SENTINEL } }),
    ).rejects.toThrow(/INVALID_ARGUMENT/)
    // The form actually shipped is accepted, and reports that it landed.
    await expect(
      updateExisting(ref, { [`hostAccess.${HOST}`]: DELETE_SENTINEL }),
    ).resolves.toBe(true)
    // …and reports absence rather than creating, for a uid with no doc.
    await expect(
      updateExisting(makeDoc(`orgs/${ORG}/members/uid-gone`), {
        [`hostAccess.${HOST}`]: DELETE_SENTINEL,
      }),
    ).resolves.toBe(false)
  })
})
