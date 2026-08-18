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

// Firestore rules matrix for the org tenancy model (AGL-235/238). Runs
// inside the emulator via `npm run test:rules` (firebase emulators:exec
// sets FIRESTORE_EMULATOR_HOST). Covers the member/non-member/wrong-org/
// viewer/editor/suspended/staff axes for orgs and hosts, plus the staff
// RBAC key-diff guards that moved here from the retired tenants rules.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))

const RULES_SOURCE = readFileSync(
  join(here, '..', 'firebase-firestore.rules'),
  'utf8',
)

/**
 * The org-admin deny list, parsed out of the rules rather than retyped
 * (AGL-1355). Retyping it would make this suite a copy of the thing it is
 * testing: both would drift together and agree the whole way down.
 *
 * Comments go first — the org block's own prose names all four keys AGL-1354
 * closed, so parsing with it in place would read the explanation as the rule.
 * Path variables become angle brackets so block depth can be counted by
 * braces alone.
 */
const ORG_ADMIN_DENIED = (() => {
  const rules = RULES_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*(?:=\*\*)?)\}/g, '<$1>')
  const header = 'match /orgs/<orgId> {'
  const at = rules.indexOf(header)
  assert.ok(at >= 0, 'no `match /orgs/{orgId}` block in the rules')
  let depth = 1
  let body = ''
  for (let index = at + header.length; index < rules.length; index += 1) {
    const character = rules[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1) body += character
  }
  assert.equal(depth, 0, 'the org rules block never closes')
  const updates = body
    .split(';')
    .filter((statement) => /\ballow\b[^:]*\bupdate\b/.test(statement))
  assert.equal(
    updates.length,
    1,
    'expected exactly one `allow … update` under match /orgs/{orgId}',
  )
  const branches = updates[0]
    .split('||')
    .filter((branch) => branch.includes('canManageOrg()'))
  assert.equal(branches.length, 1, 'expected one canManageOrg() update branch')
  const list = branches[0].match(/hasAny\(\s*\[([^\]]*)\]/)
  assert.ok(list, 'the canManageOrg() branch has no hasAny([…]) key diff')
  return [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
})()

/**
 * The host subcollections that are denied to the client OUTRIGHT — parsed
 * out of the catch-all's three exclusion lists rather than retyped (AGL-1367).
 *
 * A name has to appear in ALL THREE lists to be here, and must have no
 * dedicated `match` block of its own inside `match /hosts/{hostId}`. Both
 * halves matter, and each one is a bug this repo has already shipped:
 *
 *  - Appearing in one list is not denial. `variables` is create-excluded and
 *    freely updatable; `webhooks` is create-excluded and freely updatable
 *    (deliberately — the soft delete). A guard that read one list would call
 *    those closed.
 *  - A dedicated block RE-GRANTS. Rules OR their allows and the LOOSER one
 *    wins, so `screens`, `layouts` and `collections` sit in all three lists
 *    and are still editor-writable through the blocks above the catch-all.
 *    That is why a dedicated `allow write: if false` block would not have
 *    closed AGL-1367, and why this set is computed by subtracting them.
 */
const HOST_SERVER_ONLY_SUBCOLLECTIONS = (() => {
  const rules = RULES_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{([A-Za-z_][A-Za-z0-9_]*(?:=\*\*)?)\}/g, '<$1>')

  const hostHeader = 'match /hosts/<hostId> {'
  const hostAt = rules.indexOf(hostHeader)
  assert.ok(hostAt >= 0, 'no `match /hosts/{hostId}` block in the rules')
  let depth = 1
  let hostBlock = ''
  for (let index = hostAt + hostHeader.length; index < rules.length; index += 1) {
    const character = rules[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) break
    }
    hostBlock += character
  }
  assert.equal(depth, 0, 'the hosts rules block never closes')

  // The catch-all, by its own header. The extra `{subcollection}` segment is
  // what keeps a bare `{document=**}` off the host doc itself (AGL-235), so
  // the header is stable and unique.
  const catchAllHeader = 'match /<subcollection>/<document=**> {'
  const occurrences = hostBlock.split(catchAllHeader).length - 1
  assert.equal(
    occurrences,
    1,
    `expected exactly one \`${catchAllHeader}\` under match /hosts/{hostId}, ` +
      `found ${occurrences}. A second one would OR another set of allows onto ` +
      `every subcollection and this parse would be reading half the answer.`,
  )
  const catchAllAt = hostBlock.indexOf(catchAllHeader)
  depth = 1
  let catchAll = ''
  for (
    let index = catchAllAt + catchAllHeader.length;
    index < hostBlock.length;
    index += 1
  ) {
    const character = hostBlock[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) break
    }
    catchAll += character
  }
  assert.equal(depth, 0, 'the host catch-all block never closes')

  const exclusionList = (operation) => {
    const statement = catchAll
      .split(';')
      .find((entry) => new RegExp(`\\ballow\\b[^:]*\\b${operation}\\b`).test(entry))
    assert.ok(statement, `no \`allow … ${operation}\` in the host catch-all`)
    const list = statement.match(/subcollection\s+in\s+\[([^\]]*)\]/)
    assert.ok(
      list,
      `the host catch-all's \`allow ${operation}\` has no ` +
        `\`subcollection in […]\` exclusion list — it has been restructured, ` +
        `so re-read it before trusting this parse.`,
    )
    return [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  }

  const create = exclusionList('create')
  const update = exclusionList('update')
  const remove = exclusionList('delete')

  // Dedicated blocks, by name. `match /<subcollection>/…` and the nested
  // `match /<sub>/…` start with an angle bracket after normalization, so a
  // leading letter is exactly what distinguishes a named collection block.
  const dedicated = new Set(
    [...hostBlock.matchAll(/match\s+\/([A-Za-z][A-Za-z0-9]*)\//g)].map(
      (entry) => entry[1],
    ),
  )

  return create.filter(
    (name) =>
      update.includes(name) && remove.includes(name) && !dedicated.has(name),
  )
})()

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env

const ORG = 'org-acme'
const OTHER_ORG = 'org-other'
const SUSPENDED_ORG = 'org-suspended'
const HOST = 'host-a'
const SUSPENDED_HOST = 'host-suspended'
// A host suspended at HOST scope, inside a perfectly healthy org (AGL-1965).
// The distinction is the whole test: SUSPENDED_HOST is frozen because its ORG
// is, and every rule below has read the org's flag since AGL-238. This one is
// the scope a support person actually reaches for when one site is the problem
// and the customer's other sites are innocent.
const LOCKED_HOST = 'host-locked'
// The AGL-1981 pair. Both are suspended at HOST scope inside the healthy org,
// and differ ONLY in which side of `request.time` their `suspendedUntilMs`
// falls — which is the entire question. Held apart from LOCKED_HOST because
// that one carries no expiry at all: an indefinite suspension must keep
// freezing writes forever, and a fix that read a missing expiry as "expired"
// would lift every takedown on the platform.
const EXPIRED_HOST = 'host-expired'
const TIMED_HOST = 'host-timed'
// The org arm of the same pair. AGL-1981's bar is that both arms move
// together, so the org scope gets the identical two cases — a fix applied to
// `hostSuspended()` alone leaves `orgSuspendedById()` saying the opposite
// thing about the same field, and only these two can tell.
const EXPIRED_ORG = 'org-expired'
const EXPIRED_ORG_HOST = 'host-in-expired-org'
const TIMED_ORG = 'org-timed'
const TIMED_ORG_HOST = 'host-in-timed-org'

/** Comfortably outside any clock skew between this process and the emulator. */
const AN_HOUR = 3_600_000

const OWNER = 'uid-owner'
const EDITOR = 'uid-editor' // hostAccess: HOST=editor
const VIEWER = 'uid-viewer' // allHosts viewer
const LEGACY = 'uid-legacy' // only in the retired host admins map
const OUTSIDER = 'uid-outsider'
const STAFF = 'uid-staff'

const authed = (uid, tokens) => env.authenticatedContext(uid, tokens).firestore()
const anon = () => env.unauthenticatedContext().firestore()

/**
 * `assertFails`, but the failure NAMES the path (AGL-1367).
 *
 * These suites drive a list, so a bare `assertFails` reports only "expected
 * request to fail" and leaves whoever broke it to work out which of a dozen
 * collections it was. The per-key mutation proof this issue is held to —
 * remove one name from one exclusion list, watch the suite go red naming that
 * name — needs the name in the message.
 */
const mustDeny = async (label, operation) => {
  try {
    await assertFails(operation)
  } catch (error) {
    assert.fail(
      `${label} was NOT denied — the client SDK write went through. ` +
        `(${error?.message ?? error})`,
    )
  }
}

/** The positive-control twin: a legitimate write that must still land. */
const mustAllow = async (label, operation) => {
  try {
    await assertSucceeds(operation)
  } catch (error) {
    assert.fail(
      `${label} was denied, but it is a legitimate write. A deny that breaks ` +
        `the product is worse than the hole it closes. (${error?.message ?? error})`,
    )
  }
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-check',
    firestore: {
      rules: RULES_SOURCE,
    },
  })
})
after(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'orgs', ORG), {
      name: 'Acme', slug: 'acme', ownerUid: OWNER,
      hosts: { [HOST]: true }, plan: 'pro',
    })
    // `scopeTokens` mirrors what syncOrgAuthProjections writes (AGL-1038):
    // org-wide members get ['org']; a scoped collaborator gets 'org' plus
    // one token per granted host.
    await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), {
      role: 'owner', allHosts: true, scopeTokens: ['org'],
    })
    await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), {
      role: 'editor', allHosts: false, hostAccess: { [HOST]: 'editor' },
      scopeTokens: ['org', `host:${HOST}`],
    })
    await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER), {
      role: 'viewer', allHosts: true, scopeTokens: ['org'],
    })
    await setDoc(doc(db, 'orgs', ORG, 'invites', 'invite-1'), {
      email: 'new@acme.test', role: 'editor', acceptedAt: null,
    })
    await setDoc(doc(db, 'orgs', OTHER_ORG), {
      name: 'Other', slug: 'other', ownerUid: OUTSIDER, hosts: {},
    })
    await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER), {
      role: 'owner', allHosts: true,
    })
    await setDoc(doc(db, 'orgSlugs', 'acme'), { orgId: ORG })
    await setDoc(doc(db, 'hostIndex', HOST), { orgId: ORG })
    await setDoc(doc(db, 'users', OWNER, 'orgs', ORG), {
      role: 'owner', orgName: 'Acme', slug: 'acme',
    })
    await setDoc(doc(db, 'hosts', HOST), {
      displayName: 'Site A', orgId: ORG,
      admins: { [LEGACY]: true }, // retired map — must NOT authorize
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor', [VIEWER]: 'viewer' },
    })
    await setDoc(doc(db, 'hosts', HOST, 'screens', 'screen-1'), { name: 'Home' })
    // An EXISTING version doc, so the AGL-1369 create/update split can be told
    // apart: creating one more version is the paid `versioning` feature and is
    // API-only, while saving the canvas — a merge-set onto this doc — is an
    // UPDATE and has to keep working on every plan.
    await setDoc(doc(db, 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'), {
      screenId: 'screen-1', nodes: { root: {} },
    })
    await setDoc(doc(db, 'hosts', HOST, 'variables', 'var-1'), { name: 'v', value: '1' })
    // An existing webhook, so the AGL-1360 create/update split can be told
    // apart: create is API-only, update (the soft delete) stays client-side.
    await setDoc(doc(db, 'hosts', HOST, 'webhooks', 'wh1'), {
      name: 'Ship', direction: 'outbound', url: 'https://hook.example',
    })
    await setDoc(doc(db, 'hosts', HOST, 'templates', 'tpl-1'), {
      kind: 'page', displayName: 'Hero page',
      source: { type: 'marketplace', listingId: 'listing-1', version: 2 },
    })
    // The server-owned meters (AGL-1367), seeded the way the Admin SDK
    // leaves them. `counters/media.bytes` is the storagePerHostMb wall;
    // the month-keyed docs are the other four quota gates; `analytics/{day}
    // .total` is the page-view arm of the metered invoice. `members` is the
    // roster the seat cap counts.
    await setDoc(doc(db, 'hosts', HOST, 'counters', 'media'), {
      bytes: 249_000_000, count: 812,
    })
    await setDoc(doc(db, 'hosts', HOST, 'counters', 'formSubmissions'), {
      '2026-08': 100,
    })
    await setDoc(doc(db, 'hosts', HOST, 'counters', 'emailSends'), { '2026-08': 500 })
    await setDoc(doc(db, 'hosts', HOST, 'counters', 'workflowRuns'), { '2026-08': 1000 })
    await setDoc(doc(db, 'hosts', HOST, 'counters', 'actionRuns'), { '2026-08': 1000 })
    await setDoc(doc(db, 'hosts', HOST, 'analytics', '2026-08-01'), { total: 900_000 })
    await setDoc(doc(db, 'hosts', HOST, 'members', 'm-collab'), {
      email: 'collab@acme.test', role: 'editor', status: 'active',
      uid: 'uid-collab',
    })
    // Suspension write-block (AGL-238): host owned by a suspended org.
    await setDoc(doc(db, 'orgs', SUSPENDED_ORG), {
      name: 'Frozen', slug: 'frozen', ownerUid: OWNER,
      plan: 'pro', suspendedAt: new Date(),
    })
    await setDoc(doc(db, 'hosts', SUSPENDED_HOST), {
      displayName: 'Suspended', orgId: SUSPENDED_ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
    })
    await setDoc(doc(db, 'hosts', SUSPENDED_HOST, 'screens', 's1'), { name: 'X' })
    // Host-scope lockdown (AGL-1965), seeded exactly as /api/admin/lockdown
    // leaves it: the flags land on the HOST document and the org is untouched.
    // `suspendedMode: 'read-only'` is the harder of the two modes — the site
    // keeps serving, so nothing else in the stack is refusing anything, and
    // rules are the only thing standing between a suspended site and a fresh
    // publish.
    await setDoc(doc(db, 'hosts', LOCKED_HOST), {
      displayName: 'Locked', orgId: ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
      screens: { 's1': { versionId: 'v1', path: '/' } },
      suspendedAt: new Date(), suspendedReasonCode: 'abuse',
      suspendedMessage: 'Suspended pending review',
      suspendedMode: 'read-only',
    })
    await setDoc(doc(db, 'hosts', LOCKED_HOST, 'screens', 's1'), { name: 'Home' })
    await setDoc(doc(db, 'hosts', LOCKED_HOST, 'screens', 's1', 'versions', 'v1'), {
      screenId: 's1', nodes: { root: {} },
    })
    await setDoc(doc(db, 'hosts', LOCKED_HOST, 'variables', 'var-1'), {
      name: 'v', value: '1',
    })
    await setDoc(doc(db, 'hosts', LOCKED_HOST, 'collections', 'col-1'), {
      slug: 'posts', kind: 'blog',
    })
    await setDoc(
      doc(db, 'hosts', LOCKED_HOST, 'collections', 'col-1', 'entries', 'e1'),
      { title: 'Post' },
    )
    await setDoc(doc(db, 'hosts', LOCKED_HOST, 'templates', 'tpl-1'), {
      kind: 'page', displayName: 'Hero',
    })

    /*
     * AGL-1981 fixtures — a TIMED suspension on each side of its expiry.
     *
     * Seeded exactly as `/api/admin/lockdown` leaves a timed takedown: the
     * same `suspended*` family as LOCKED_HOST plus a numeric
     * `suspendedUntilMs`. The server-side helpers
     * (`isLockdownActive` in `libs/aglyn/.../lockdown.ts`) have honoured that
     * field since AGL-1512; rules never read it, so the site came back and the
     * editor stayed locked out of it.
     *
     * Both live in the HEALTHY org, so nothing `hostOrgSuspended()` reads is
     * set and the host arm is the only thing that can be deciding.
     */
    await setDoc(doc(db, 'hosts', EXPIRED_HOST), {
      displayName: 'Sentence served', orgId: ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
      screens: { 's1': { versionId: 'v1', path: '/' } },
      suspendedAt: new Date(Date.now() - 48 * AN_HOUR),
      suspendedReasonCode: 'abuse',
      suspendedMessage: 'Suspended pending review',
      suspendedUntilMs: Date.now() - AN_HOUR,
    })
    await setDoc(doc(db, 'hosts', EXPIRED_HOST, 'screens', 's1'), { name: 'Home' })
    await setDoc(
      doc(db, 'hosts', EXPIRED_HOST, 'screens', 's1', 'versions', 'v1'),
      { screenId: 's1', nodes: { root: {} } },
    )
    await setDoc(doc(db, 'hosts', TIMED_HOST), {
      displayName: 'Still serving it', orgId: ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
      screens: { 's1': { versionId: 'v1', path: '/' } },
      suspendedAt: new Date(),
      suspendedReasonCode: 'abuse',
      suspendedMessage: 'Suspended pending review',
      suspendedUntilMs: Date.now() + 48 * AN_HOUR,
    })
    await setDoc(doc(db, 'hosts', TIMED_HOST, 'screens', 's1'), { name: 'Home' })
    await setDoc(
      doc(db, 'hosts', TIMED_HOST, 'screens', 's1', 'versions', 'v1'),
      { screenId: 's1', nodes: { root: {} } },
    )

    // The org arm of the same pair (AGL-210/238's `orgSuspendedById`).
    await setDoc(doc(db, 'orgs', EXPIRED_ORG), {
      name: 'Thawed', slug: 'thawed', ownerUid: OWNER, plan: 'pro',
      suspendedAt: new Date(Date.now() - 48 * AN_HOUR),
      suspendedUntilMs: Date.now() - AN_HOUR,
    })
    await setDoc(doc(db, 'hosts', EXPIRED_ORG_HOST), {
      displayName: 'Thawed site', orgId: EXPIRED_ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
    })
    await setDoc(doc(db, 'hosts', EXPIRED_ORG_HOST, 'screens', 's1'), {
      name: 'Home',
    })
    await setDoc(doc(db, 'orgs', TIMED_ORG), {
      name: 'Frozen till Friday', slug: 'frozen-friday', ownerUid: OWNER,
      plan: 'pro',
      suspendedAt: new Date(),
      suspendedUntilMs: Date.now() + 48 * AN_HOUR,
    })
    await setDoc(doc(db, 'hosts', TIMED_ORG_HOST), {
      displayName: 'Frozen site', orgId: TIMED_ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
    })
    await setDoc(doc(db, 'hosts', TIMED_ORG_HOST, 'screens', 's1'), {
      name: 'Home',
    })
  })
})

describe('org docs', () => {
  it('members and staff read; outsiders and anon do not', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG)))
    await assertSucceeds(getDoc(doc(authed(STAFF, { staff: true }), 'orgs', ORG)))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG)))
    await assertFails(getDoc(doc(anon(), 'orgs', ORG)))
  })

  it('admins rename; editors cannot; billing keys are locked', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Inc' }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'orgs', ORG), { name: 'Nope' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { plan: 'business' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { slug: 'stolen' }),
    )
    await assertFails(setDoc(doc(authed(OWNER), 'orgs', 'org-new'), { name: 'X' }))
  })

  /**
   * The entitlement-bearing keys the org doc carries besides `plan` and
   * `entitlements` (AGL-1354). Each is written ONLY by an Admin-SDK route
   * that checks something first, and each was missing from the key diff
   * above — so an org admin with nothing but the Firebase client SDK could
   * set them on any plan:
   *
   *  - `brandingProfile` — the input `resolveBrandingProfile` reads behind
   *    the `whiteLabel` entitlement, and the field AGL-1099 will route the
   *    custom console domain on;
   *  - `sso` — decides which GCIP tenant signs the org in (`sso-lookup`,
   *    `sso-jit`), gated on `ssoEnabled` by /api/orgs/sso;
   *  - `discount` / `enterprise` — staff-set commercial markers that decide
   *    what the MRR and plan surfaces report.
   *
   * The console writes all four through server routes, so denying them
   * client-side costs the product nothing.
   */
  it('entitlement-bearing keys are server-only (AGL-1354)', async () => {
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), {
        brandingProfile: {
          productName: 'Acme Cloud',
          customConsoleDomain: 'app.acme.test',
        },
      }),
    )
    // A nested field path is the same top-level diff and must not slip past.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), {
        'brandingProfile.productName': 'Acme Cloud',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), {
        sso: { status: 'active', tenantId: 'tenant-attacker' },
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), {
        discount: { percentOff: 100 },
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { enterprise: true }),
    )
    // Denying the keys must not deny the branch — an admin still renames.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Cloud Inc' }),
    )
  })

  /**
   * Positive control for the legitimate path (AGL-1354): /api/orgs/settings
   * `update-branding` writes through the Admin SDK after
   * `checkEntitlement(org, 'whiteLabel')`, and the Admin SDK is not subject
   * to rules — `withSecurityRulesDisabled` is that path in the emulator. The
   * new key diff closes the client door without closing the server one, and
   * every member still READS the profile the console chrome renders from.
   */
  it('the server branding path still writes, and members read it (AGL-1354)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        brandingProfile: { productName: 'Acme Cloud' },
      })
    })
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.equal(snapshot.data().brandingProfile.productName, 'Acme Cloud')
  })

  /**
   * Every key on the org-admin deny list is ENFORCED, one emulator write per
   * key, driven off the list parsed out of the rules (AGL-1355).
   *
   * The tests above name their keys, which means they can only fail for a key
   * somebody already remembered — the exact shape of the gap AGL-1354 left
   * behind. This one cannot go stale: adding a key to the rules adds a case
   * here on the same commit, and a key that is listed but not actually denied
   * (mis-scoped branch, typo, a looser sibling rule OR'ing it back open) fails
   * by name.
   *
   * The static companion is
   * `libs/aglyn/src/lib/foundation/definitions/org-write-deny-coverage.spec.ts`,
   * which asks the other half of the question: whether the list is COMPLETE.
   * A complete list nothing enforces and an enforced list that is missing four
   * keys are the same bug, and neither test finds the other's version of it.
   */
  it('every key on the parsed deny list is actually denied (AGL-1355)', async () => {
    assert.ok(
      ORG_ADMIN_DENIED.length >= 15,
      `Parsed only ${ORG_ADMIN_DENIED.length} keys off the org-update rule; ` +
        `the parser has rotted and this test is proving nothing.`,
    )
    for (const key of ORG_ADMIN_DENIED) {
      await assertFails(
        updateDoc(doc(authed(OWNER), 'orgs', ORG), { [key]: 'agl-1355-probe' }),
      )
    }
    // The branch itself still works — a rule that denies everything would
    // pass every line above and break the product.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Renamed' }),
    )
  })

  it('suspended members cannot rename', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), 'orgs', ORG, 'members', OWNER),
        { orgSuspended: true },
      )
    })
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Still here' }),
    )
  })

  it('roster reads are org-wide; writes are API-only; invites are manager-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'members', OWNER)))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'members', OWNER)))
    await assertFails(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'members', 'uid-sneak'), {
        role: 'admin',
      }),
    )
    await assertSucceeds(getDoc(doc(authed(OWNER), 'orgs', ORG, 'invites', 'invite-1')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'invites', 'invite-1')))
  })
})

describe('resolution collections', () => {
  it('orgSlugs read publicly, never written', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'orgSlugs', 'acme')))
    await assertFails(setDoc(doc(authed(OWNER), 'orgSlugs', 'grab'), { orgId: ORG }))
  })

  it('hostIndex is signed-in read, API-write', async () => {
    await assertSucceeds(getDoc(doc(authed(OUTSIDER), 'hostIndex', HOST)))
    await assertFails(getDoc(doc(anon(), 'hostIndex', HOST)))
    await assertFails(setDoc(doc(authed(OWNER), 'hostIndex', 'h2'), { orgId: ORG }))
  })

  it('reverse index readable only by its user', async () => {
    await assertSucceeds(getDoc(doc(authed(OWNER), 'users', OWNER, 'orgs', ORG)))
    await assertFails(getDoc(doc(authed(EDITOR), 'users', OWNER, 'orgs', ORG)))
    await assertFails(
      setDoc(doc(authed(OWNER), 'users', OWNER, 'orgs', 'org-fake'), {
        role: 'owner',
      }),
    )
  })
})

describe('hosts', () => {
  it('memberRoles grant reads to every role, writes to editor+', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST)))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'screens', 'screen-1')))
    await assertFails(
      updateDoc(doc(authed(VIEWER), 'hosts', HOST, 'screens', 'screen-1'), { name: 'No' }),
    )
    // Screen/layout DOC creates are API-only (AGL-473) — even editors
    // cannot create directly; updates/deletes on existing docs still work.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-2'), { name: 'New' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'layouts', 'layout-2'), { name: 'New' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), { name: 'Yes' }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1')),
    )
    // Versions (and other screen subcollections) stay editor-writable —
    // they aren't quota-governed.
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'), { nodes: {} }),
    )
    // Quota-governed logic collections are API-create-only too (AGL-473):
    // editors cannot create, but can update/delete existing docs.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-new'), { name: 'v' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'functions', 'fn-new'), { name: 'f' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'workflows', 'wf-new'), { name: 'w' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-1'), { value: '2' }),
    )
    // Commerce/bookings/redirects/reusable-components/registers collections
    // are API-create-only too (registers gate the posRegisters cap).
    for (const coll of ['services', 'redirects', 'locations', 'products', 'components', 'registers', 'templates']) {
      await assertFails(
        setDoc(doc(authed(EDITOR), 'hosts', HOST, coll, 'new-doc'), { name: 'x' }),
      )
    }
    // Webhooks joined the API-only creates (AGL-1360). WEBHOOK_MAX_PER_HOST
    // was enforced ONLY by the console counting the rows its Firestore
    // listener held; with `persistentLocalCache` that count could be
    // arbitrarily stale and low, so the cap did not survive a stale session.
    // /api/hosts/resources counts the live webhooks with the Admin SDK.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh-new'), {
        name: 'w', direction: 'outbound', url: 'https://hook.example',
      }),
    )
    // The webhooks block above this one grants READ only, so it cannot
    // re-grant the create the catch-all just denied — but update/delete must
    // still work: delete is a soft delete (`deletedAt`), which is how a
    // capped site frees a slot.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        deletedAt: new Date(),
      }),
    )
    // Deleting a COLLECTION doc is API-only (AGL-947): it owns `entries`,
    // which Firestore won't cascade into. Single entries stay deletable —
    // the dedicated entries block re-grants what the name-based exclusion
    // in the catch-all would otherwise take with it.
    // Collection CREATE is API-only (AGL-978): the slug is the public address
    // and is claimed transactionally by /api/hosts/collections.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog2'), {
        name: 'Blog 2', slug: 'blog-2', kind: 'content',
      }),
    )
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'hosts', HOST, 'collections', 'blog'), {
        displayName: 'Blog', slug: 'blog', kind: 'content',
        // Seeded SET, so the clear below is a real diff. `deleteField()` on a
        // field the document does not have produces no affected key at all,
        // and rules would allow it — correctly, since it changes nothing, but
        // an assertion written against an absent field proves nothing either.
        listScreenId: 'screen-9',
        entryScreenId: 'screen-9',
        templateScreenId: 'screen-9',
      })
    })
    // Editors still manage the rest of the doc client-side — the category
    // taxonomy is what the Content page writes here, and it stays direct.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog'), {
        categories: [{ id: 'c1', name: 'News' }],
      }),
    )
    // ...but not the two identity keys.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog'), {
        slug: 'stolen',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog'), {
        kind: 'catalog',
      }),
    )
    // The three template pointers are a POSITIVE control again (AGL-1400).
    //
    // They were denied between AGL-1390 and AGL-1400, because they were then an
    // INPUT TO A PAID LIMIT: pointing `entryScreenId` at a live screen took it
    // off `screensPerHost`, a create spent the freed slot, and clearing it
    // handed the screen back — a loop a create-time gate cannot see. AGL-1400
    // moved the fact onto the screen (`kind: 'template'`, denied to the client
    // in the screens block above), so setting or clearing a pointer changes no
    // count at all and there is nothing left to launder. A rule kept after its
    // reason has gone is a rule nobody can reason about, so it went with it.
    //
    // The entitlement half is asserted where it now lives: `kind` on
    // `screens/{screenId}` is denied in 'the fields the screen cap counts on
    // are not the client's to write' (AGL-1383).
    for (const field of ['listScreenId', 'entryScreenId', 'templateScreenId']) {
      await assertSucceeds(
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog'), {
          [field]: 'screen-1',
        }),
      )
      await assertSucceeds(
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog'), {
          [field]: deleteField(),
        }),
      )
    }
    // Entries are a separate resource underneath and stay fully writable.
    await assertSucceeds(
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog', 'entries', 'e1'),
        { title: 'Hello' },
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog', 'entries', 'e1'),
        { title: 'Hello again' },
      ),
    )
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog')),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog', 'entries', 'e1')),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { displayName: 'Renamed' }),
    )
    // The subdomain is the site's public address, so it is server-only
    // (AGL-642) — a client write could take a reserved name or collide with
    // another org's site. Closed even to the site admin; renames go through
    // /api/hosts/rename, which claims uniqueness transactionally.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { subdomain: 'grabbed' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), { subdomain: 'grabbed' }),
    )
    // `cname` is the site's OTHER public address and was never given the same
    // protection (AGL-1272). /api/domains/attach claims it transactionally and
    // only after DNS verification; a client write skips both, which is how one
    // org could end up served on another org's domain — and now also how a
    // forged domain could redirect `{sub}.aglyn.app` at a host that serves
    // nothing, taking down the site's last working address.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        cname: 'someone-elses.example',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        cname: 'someone-elses.example',
      }),
    )
    // Denying `cname` alone was not enough (AGL-1364). `liveCustomDomain`
    // refuses the redirect on three conditions, and two of them were
    // client-writable: `cnameAttachmentPending` is set when the Vercel attach
    // never landed, so it is what stops `{sub}.aglyn.app` sending visitors to
    // a domain that serves nothing. An editor able to CLEAR it reaches the
    // same takedown the `cname` deny exists to prevent.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        cnameAttachmentPending: false,
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        cnameDetachmentPending: false,
      }),
    )
    // Theme provenance is written by the install route; a client rewrite
    // makes `isOverrideForCurrentTheme()` lie about which theme an override
    // belongs to. The Enterprise project pointers have no client writer.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        themeInstalledFrom: { listingId: 'mine', sha256: 'forged' },
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), { projectId: 'other-proj' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), { projectNumber: 42 }),
    )
    // Authoring is untouched: the fields the editor legitimately owns still
    // write, including the theme override the setup page saves wholesale.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        maintenance: true,
        themeOverride: { palette: { mode: 'dark' } },
        seo: { title: 'Site A' },
      }),
    )
    await assertFails(deleteDoc(doc(authed(EDITOR), 'hosts', HOST)))
    await assertSucceeds(deleteDoc(doc(authed(OWNER), 'hosts', HOST)))
  })

  /**
   * AGL-1050. Datasets moved to the org in AGL-237, and the ORG block has
   * enforced API-only create/delete since AGL-473/945 so the per-plan
   * `datasets` quota has somewhere to be checked. The host catch-all never
   * learned the name, so `hosts/{hostId}/datasets/*` stayed a fully
   * client-writable path for the same resource — an editor could create
   * datasets and records there all day and no quota was ever consulted.
   *
   * Production holds nothing under these paths (AGL-1061 counted 0 for
   * every host) and the client fallback that addressed them is gone, so the
   * whole subtree is denied: `records` too, since the exclusion is by name
   * and `{document=**}` spans them. Nothing re-grants underneath, which is
   * the difference between this and `collections`/`entries` (AGL-947).
   *
   * The `variables` assertions at the end are the control: they prove the
   * catch-all still GRANTS what it is supposed to, so a passing test here
   * cannot be a rules file that denies everything.
   */
  it('host datasets are denied outright — the org path is the only one (AGL-1050)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'datasets', 'ds-host'),
        { name: 'Smuggled' },
      )
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'datasets', 'ds-host', 'records', 'r1'),
        { a: 1 },
      )
      // The org-path counterpart, for the control at the end. Seeded here
      // rather than leaned on from the AGL-237 describe, whose beforeEach
      // does not run for this block — and an absent doc would make the
      // control pass for the wrong reason.
      await setDoc(
        doc(context.firestore(), 'orgs', ORG, 'datasets', 'ds1'),
        { name: 'Team', visibleTo: ['org'] },
      )
    })
    // Create: the quota bypass this issue is about.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-new'), {
        name: 'Free dataset',
      }),
    )
    await assertFails(
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-host', 'records', 'r2'),
        { a: 2 },
      ),
    )
    // Update and delete, on docs that already exist — otherwise a create
    // denial is all this proves.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-host'), {
        name: 'Renamed',
      }),
    )
    await assertFails(
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-host', 'records', 'r1'),
        { a: 3 },
      ),
    )
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-host', 'records', 'r1')),
    )
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'datasets', 'ds-host')),
    )
    // A site ADMIN is no different — this is a path question, not a role one.
    await assertFails(
      setDoc(doc(authed(OWNER), 'hosts', HOST, 'datasets', 'ds-owner'), {
        name: 'Still no',
      }),
    )
    // Control: the same editor, through the same catch-all, on a collection
    // that is only create-excluded. If these fail, the test above is
    // measuring a broken rules file rather than the exclusion.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-1'), {
        value: 'still-writable',
      }),
    )
    // And the org path — the one datasets are supposed to live on — still
    // reads for a member, so "denied" here means the host path only.
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1')),
    )
  })

  /**
   * AGL-1367. The catch-all's exclusion lists are the ONLY thing standing
   * between an editor and these documents, so this asserts the two halves
   * separately: that the parsed set still names what it must (nothing was
   * quietly dropped from a list), and that every name in it is genuinely
   * denied against a live emulator (nothing looser OR'd it back open).
   *
   * The floor is what makes the per-key mutation proof work. Without it,
   * deleting `counters` from any one exclusion list would drop it out of the
   * parsed intersection and this suite would go green testing three
   * collections instead of four — the exact shape of AGL-1354, where the test
   * could only fail for a key somebody had already remembered.
   */
  it('the host catch-all still denies every server-owned subcollection (AGL-1367)', () => {
    for (const name of ['counters', 'analytics', 'members', 'datasets']) {
      assert.ok(
        HOST_SERVER_ONLY_SUBCOLLECTIONS.includes(name),
        `\`${name}\` is no longer denied outright under hosts/{hostId}. It ` +
          `must appear in ALL THREE \`subcollection in […]\` exclusion lists ` +
          `of the host catch-all AND have no dedicated match block re-granting ` +
          `it. Removing it from one list is enough to reopen the hole: ` +
          `AGL-1367 was an editor rewriting counters/media.bytes to 0 for ` +
          `unbounded storage on a Free plan, and lowering the same documents ` +
          `to lower a live metered Stripe invoice.`,
      )
    }
  })

  it('every parsed server-only host subcollection is create/update/delete denied (AGL-1367)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      for (const name of HOST_SERVER_ONLY_SUBCOLLECTIONS) {
        await setDoc(doc(db, 'hosts', HOST, name, 'agl1367-seed'), { total: 7 })
      }
    })
    // Both roles: this is a PATH question, not a role one. A site admin has
    // the same billing incentive as an editor and no more right to the meter.
    for (const uid of [EDITOR, OWNER]) {
      for (const name of HOST_SERVER_ONLY_SUBCOLLECTIONS) {
        const at = `hosts/{hostId}/${name} as ${uid}`
        await mustDeny(
          `create ${at}`,
          setDoc(doc(authed(uid), 'hosts', HOST, name, 'agl1367-new'), {
            total: 0,
          }),
        )
        await mustDeny(
          `update ${at}`,
          updateDoc(doc(authed(uid), 'hosts', HOST, name, 'agl1367-seed'), {
            total: 0,
          }),
        )
        await mustDeny(
          `delete ${at}`,
          deleteDoc(doc(authed(uid), 'hosts', HOST, name, 'agl1367-seed')),
        )
        // `{document=**}` spans deeper paths and nothing re-grants under
        // these names, so the whole subtree goes with them.
        await mustDeny(
          `create ${at}/agl1367-seed/nested`,
          setDoc(
            doc(authed(uid), 'hosts', HOST, name, 'agl1367-seed', 'nested', 'n1'),
            { total: 0 },
          ),
        )
      }
    }
  })

  /**
   * The named exploits, spelled out. The loop above proves the property; this
   * proves the specific writes AGL-1367 reported, so a future reader can see
   * what was actually reachable rather than inferring it from a list.
   */
  it('an editor cannot move the five quota counters or the invoice inputs (AGL-1367)', async () => {
    // storagePerHostMb: `counters/media.bytes` IS the wall. Zeroing it is
    // unbounded Firebase Storage against a Free plan's 250 MB — real
    // infrastructure cost, and the storage arm of the metered invoice.
    await mustDeny(
      'zeroing counters/media.bytes',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'counters', 'media'), {
        bytes: 0,
        count: 0,
      }),
    )
    // The four month-keyed gates, all read-compare-proceed on `[YYYY-MM]`.
    for (const counter of [
      'formSubmissions',
      'emailSends',
      'workflowRuns',
      'actionRuns',
    ]) {
      await mustDeny(
        `zeroing counters/${counter}[month]`,
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'counters', counter), {
          '2026-08': 0,
        }),
      )
    }
    // Deleting the doc is the same bypass by another route — the readers all
    // default a missing counter to 0.
    await mustDeny(
      'deleting counters/media outright',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'counters', 'media')),
    )
    // The bandwidth arm of the invoice (AGL-1280 turned the metered
    // pass-through on for every paid plan, so this is money).
    await mustDeny(
      'zeroing analytics/{day}.total',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'analytics', '2026-08-01'), {
        total: 0,
      }),
    )
    await mustDeny(
      'deleting an analytics day',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'analytics', '2026-08-01')),
    )
  })

  /**
   * The seat-recycling half (AGL-1367). Deleting a roster row revokes
   * NOTHING — real access lives in `orgs/{orgId}/members/{uid}.hostAccess`,
   * which is `write: false`, projected into the frozen `memberRoles` — but
   * /api/hosts/members counts these rows for the seat cap. So the roster was
   * a free seat dispenser: delete N rows, keep N working collaborators, add N
   * more, each passing the count. `extraCollaboratorMonthlyUsd` is $1-3/seat.
   */
  it('an editor cannot recycle collaborator seats through the host roster (AGL-1367)', async () => {
    await mustDeny(
      'deleting a hosts/{hostId}/members row',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'members', 'm-collab')),
    )
    await mustDeny(
      'forging a hosts/{hostId}/members row',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'members', 'm-forged'), {
        email: 'me@acme.test', role: 'admin', status: 'active',
      }),
    )
    await mustDeny(
      'promoting a roster row to admin',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'members', 'm-collab'), {
        role: 'admin',
      }),
    )
    // The roster row is not access, and the deny does not pretend otherwise:
    // the projection it is a shadow of was already frozen.
    await mustDeny(
      'writing the real access record',
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'members', 'uid-collab'), {
        role: 'editor', hostAccess: { [HOST]: 'admin' },
      }),
    )
  })

  /**
   * Positive controls (AGL-1367). A deny that breaks quota accounting or the
   * usage rollup would be worse than the bug: the counters exist to be
   * WRITTEN by the server and READ by the console, and both still work.
   *
   * `withSecurityRulesDisabled` is the Admin SDK in the emulator — the same
   * bypass /api/billing/report-usage, /api/media/upload, the forms endpoint
   * and the analytics collector run under in production.
   */
  it('the server still writes the meters and every member still reads them (AGL-1367)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // The media/upload + upload-url accounting write.
      await updateDoc(doc(db, 'hosts', HOST, 'counters', 'media'), {
        bytes: 250_000_000, count: 813,
      })
      // The forms endpoint's per-month increment.
      await updateDoc(doc(db, 'hosts', HOST, 'counters', 'formSubmissions'), {
        '2026-08': 101,
      })
      // The analytics collector's daily rollup.
      await setDoc(doc(db, 'hosts', HOST, 'analytics', '2026-08-02'), {
        total: 12,
      })
      // The members API's roster write.
      await setDoc(doc(db, 'hosts', HOST, 'members', 'm-new'), {
        email: 'new@acme.test', role: 'viewer', status: 'invited',
      })
    })
    // report-usage reads all three back through the Admin SDK; the console
    // renders the same documents through the client SDK, for EVERY role —
    // billing-usage, billing-metered-estimate, quota-warnings-banner and the
    // media library all `getDoc` them, and denying the read would blank the
    // usage meters instead of closing anything.
    for (const uid of [OWNER, EDITOR, VIEWER]) {
      const counter = await getDoc(
        doc(authed(uid), 'hosts', HOST, 'counters', 'media'),
      )
      assert.equal(counter.data().bytes, 250_000_000)
      await mustAllow(
        `${uid} reads analytics/{day}`,
        getDoc(doc(authed(uid), 'hosts', HOST, 'analytics', '2026-08-02')),
      )
      await mustAllow(
        `${uid} reads the host roster`,
        getDoc(doc(authed(uid), 'hosts', HOST, 'members', 'm-new')),
      )
    }
    // Not to an outsider, though — the catch-all's read is still membership
    // gated, and this proves the read control is a grant and not a blanket.
    await assertFails(
      getDoc(doc(authed(OUTSIDER), 'hosts', HOST, 'counters', 'media')),
    )
    // And the editor's own authoring is untouched: the catch-all still GRANTS
    // everywhere it did before, so a passing suite above cannot be a rules
    // file that denies the whole host subtree.
    await mustAllow(
      'editor updates a variable',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-1'), {
        value: '3',
      }),
    )
    // Saving the canvas is an UPDATE of the open version (AGL-1369). Creating
    // a NEW version is the paid feature and now rides /api/hosts/versions.
    await mustAllow(
      'editor saves the open screen version',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'),
        { nodes: { root: { id: 'root' } } },
        { merge: true },
      ),
    )
    await mustAllow(
      'editor soft-deletes a webhook',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        deletedAt: new Date(),
      }),
    )
  })

  /**
   * AGL-1668. `formSubmissions` is the row the metered counter counts, and it
   * was in none of the catch-all's three exclusion lists — so an editor could
   * `add()` a submission straight into `hosts/{hostId}/formSubmissions` and
   * never touch `counters/formSubmissions[YYYY-MM]`, the document
   * /api/billing/report-usage invoices from and AGL-1655's abuse ceiling is
   * evaluated against. The counter itself was never reachable (AGL-1367 put
   * `counters` in all three lists, asserted directly above), so this is not a
   * way to LOWER a bill or reset the ceiling — it is a way to add rows that
   * were never billed at all, and to hold submissions the Free plan's 20/month
   * wall would have refused.
   *
   * CREATE ONLY, and that is the whole point. The issue guessed update and
   * delete would follow the `counters` precedent; they must not. The inbox
   * plugin marks a submission read with a client `updateDoc` and deletes one
   * with a client `deleteDoc` (`inbox-console-page.tsx:122,133,152`) — both
   * are the product working, and neither moves the counter, so denying them
   * would break the reader to close nothing. The narrowest deny is the right
   * one.
   */
  it('an editor cannot forge an unbilled form submission (AGL-1668)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'formSubmissions', 'fs-seed'),
        { formName: 'contact', fields: { email: 'a@b.test' }, read: false },
      )
    })
    // A PATH question, not a role one: a site admin has the same incentive to
    // hold submissions the meter never saw, and no more right to the row.
    for (const uid of [EDITOR, OWNER]) {
      await mustDeny(
        `create hosts/{hostId}/formSubmissions as ${uid}`,
        setDoc(doc(authed(uid), 'hosts', HOST, 'formSubmissions', `fs-${uid}`), {
          formName: 'contact', fields: { email: 'forged@b.test' },
        }),
      )
      // `{document=**}` spans deeper paths and nothing re-grants under this
      // name, so the subtree goes with it.
      await mustDeny(
        `create hosts/{hostId}/formSubmissions/fs-seed/nested as ${uid}`,
        setDoc(
          doc(authed(uid), 'hosts', HOST, 'formSubmissions', 'fs-seed', 'nested', 'n1'),
          { formName: 'contact' },
        ),
      )
    }
    // The inbox reader, unchanged. If either of these goes red the exclusion
    // was widened past what AGL-1668 asked for.
    await mustAllow(
      'editor marks a submission read',
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'formSubmissions', 'fs-seed'),
        { read: true },
      ),
    )
    await mustAllow(
      'editor deletes a submission from the inbox',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'formSubmissions', 'fs-seed')),
    )
    // And the only legitimate writer still writes. /api/forms/submit runs
    // under the Admin SDK, which these rules never see.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'formSubmissions', 'fs-route'),
        { formName: 'contact', fields: { email: 'real@b.test' }, read: false },
      )
    })
    await mustAllow(
      'editor reads the submission the route wrote',
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'formSubmissions', 'fs-route')),
    )
  })

  /**
   * AGL-679. Component versions live under a collection whose NAME is in
   * the catch-all's create-exclusion list, and `{document=**}` matches
   * nested paths — so without a dedicated block, creating
   * `components/{id}/versions/{v}` was denied along with the component doc
   * itself. The component doc must STAY API-only; only its history opens up.
   */
  it('component versions are editor-SAVEABLE; the component doc stays API-only', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'hosts', HOST, 'components', 'cmp-1'), {
        displayName: 'Hero', rootId: 'r', nodes: { r: {} },
      })
      // The version the editor is editing. Since AGL-1369 minting it is the
      // route's job, so the fixture has to stand in for the route.
      await setDoc(
        doc(db, 'hosts', HOST, 'components', 'cmp-1', 'versions', 'v1'),
        { componentId: 'cmp-1', nodes: {} },
      )
    })
    // Editors save the version they have open…
    await assertSucceeds(
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'components', 'cmp-1', 'versions', 'v1'),
        { componentId: 'cmp-1', nodes: { r: {} } },
        { merge: true },
      ),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'components', 'cmp-1'), {
        versionId: 'v1',
      }),
    )
    // …but still cannot create a component, which is quota/entitlement
    // gated through /api/hosts/resources.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'components', 'cmp-new'), {
        displayName: 'Sneak',
      }),
    )
    // Viewers read but never write. Aimed at the EXISTING version on purpose:
    // a create is denied to everyone since AGL-1369, so asserting one here
    // would pass without the role axis ever being consulted.
    await assertSucceeds(
      getDoc(doc(authed(VIEWER), 'hosts', HOST, 'components', 'cmp-1', 'versions', 'v1')),
    )
    await assertFails(
      setDoc(
        doc(authed(VIEWER), 'hosts', HOST, 'components', 'cmp-1', 'versions', 'v1'),
        { nodes: {} },
        { merge: true },
      ),
    )
    await assertFails(
      setDoc(
        doc(authed(OUTSIDER), 'hosts', HOST, 'components', 'cmp-1', 'versions', 'v1'),
        { nodes: {} },
        { merge: true },
      ),
    )
  })

  /**
   * AGL-1369. `versioning` (Pro+) used to be a UI gate: the console checked
   * the entitlement and then wrote the new version with the client SDK, so a
   * Free org got Pro version history by writing the document directly.
   *
   * The split that closes it is create-vs-update, and the whole plan rests on
   * one fact this suite has to hold down: an ordinary canvas save is a
   * merge-set onto a version doc that ALREADY EXISTS — a rules UPDATE — and
   * only "one more version than before" is a CREATE. If that were ever untrue,
   * denying create would break authoring on every plan, which is far worse
   * than the bypass. So the positive controls here matter more than the
   * negative one, and they are written in the shape the product actually
   * uses: `saveNodesGuarded` saves inside a transaction.
   */
  describe('version create is API-only; saving is not (AGL-1369)', () => {
    for (const [kind, parent, seed] of [
      ['screen', 'screens', 'screen-1'],
      ['layout', 'layouts', 'layout-1'],
      ['component', 'components', 'cmp-1'],
    ]) {
      it(`${kind}: editor saves the open version but cannot mint another`, async () => {
        await env.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore()
          await setDoc(doc(db, 'hosts', HOST, parent, seed), { name: kind })
          await setDoc(doc(db, 'hosts', HOST, parent, seed, 'versions', 'v1'), {
            nodes: { root: {} },
          })
        })
        // The paid path: one more version document than there was before.
        await mustDeny(
          `${parent}/${seed}/versions/{new} client create`,
          setDoc(
            doc(authed(EDITOR), 'hosts', HOST, parent, seed, 'versions', 'v2'),
            { nodes: {} },
          ),
        )
        // The unpaid path, which must survive: saving what is open.
        await mustAllow(
          `${parent}/${seed}/versions/v1 save (merge-set)`,
          setDoc(
            doc(authed(EDITOR), 'hosts', HOST, parent, seed, 'versions', 'v1'),
            { nodes: { root: { id: 'root' } } },
            { merge: true },
          ),
        )
        // The same save the besigner really performs (AGL-1301): a
        // transaction that reads the doc, then merge-sets it. A transaction
        // is evaluated write-by-write, so this is still an update — but it is
        // the exact call the product makes, and asserting the simpler shape
        // alone would leave the real one unproven.
        // One db handle: `authed()` mints a fresh Firestore instance per call,
        // and a transaction refuses a ref from a different one.
        const editorDb = authed(EDITOR)
        await mustAllow(
          `${parent}/${seed}/versions/v1 guarded save (transaction)`,
          runTransaction(editorDb, async (transaction) => {
            const ref = doc(
              editorDb, 'hosts', HOST, parent, seed, 'versions', 'v1',
            )
            await transaction.get(ref)
            transaction.set(ref, { nodes: { root: { id: 'r2' } } }, { merge: true })
          }),
        )
        // Deleting history stays client-side: it frees nothing the cap has
        // not already granted, and the console's delete button is not gated.
        await mustAllow(
          `${parent}/${seed}/versions/v1 delete`,
          deleteDoc(
            doc(authed(EDITOR), 'hosts', HOST, parent, seed, 'versions', 'v1'),
          ),
        )
      })
    }

    /**
     * The bypass the rules CANNOT close on their own, pinned so nobody
     * re-derives it and thinks the route is redundant.
     *
     * The tempting condition is "allow the create when the parent's
     * `versionId` already points at it" — seeds satisfy it, snapshots do not.
     * But publishing moves that pointer and is a legitimate client write, so
     * the client can point it at the id it is about to create, create, and
     * point it back. Two writes, both individually legal.
     */
    it('the parent versionId pointer is client-writable, so it cannot gate the create', async () => {
      await mustAllow(
        'editor publishes a version (moves the parent pointer)',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
          versionId: 'v1',
        }),
      )
    })
  })

  /**
   * AGL-1383. `screensPerHost` is enforced at CREATE by
   * `countBillableScreens`, which counts screens minus three exclusions. Two
   * of them — `deletedAt` and `kind: 'email'` — were ordinary fields on the
   * screen's own document, writable by the very editor the cap is enforced
   * against, so `updateDoc(screenRef, {kind: 'email'})` took a live page off
   * the plan in one write while the routing map still served it.
   *
   * The count and the runtime were fixed to agree (a routed screen counts;
   * an excluded screen is not served). These rules close the third leg, which
   * neither of those can reach: the cap is a create-time gate and nothing
   * re-counts afterwards, so flipping a field on and back off in a loop —
   * create five, exclude them, create five more, restore — mints permanent
   * slots no plan sold. Freezing the fields is what stops the laundering.
   *
   * The positive controls are the point of the exercise. `deletedAt` is
   * write-ONCE, not frozen, because soft-delete is a legitimate client write
   * on two console surfaces; and every email document is authored, saved and
   * deleted through the client SDK, so denying too much here breaks the
   * Emails page rather than the bypass.
   */
  describe('the fields the screen cap counts on are not the client\'s to write (AGL-1383)', () => {
    /** A published page and an Emails-page document, as the product leaves them. */
    const seedScreens = async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore()
        await setDoc(doc(db, 'hosts', HOST, 'screens', 'page-1'), {
          displayName: 'Pricing', slug: 'pricing', versionId: 'v1',
        })
        await setDoc(doc(db, 'hosts', HOST, 'screens', 'email-1'), {
          displayName: 'Welcome', kind: 'email', versionId: 'v1',
        })
        await setDoc(doc(db, 'hosts', HOST, 'screens', 'deleted-1'), {
          displayName: 'Old', deletedAt: new Date('2026-01-01'),
        })
      })
    }

    it('an editor cannot relabel a page as an email document', async () => {
      await seedScreens()
      // The bypass itself: one write, no route change, page stays live, and
      // the screen stops counting against `screensPerHost`.
      await mustDeny(
        'screens/page-1 { kind: "email" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          kind: 'email',
        }),
      )
      // And the return leg, which is what would turn a cheaply-minted email
      // document back into a page after the count was taken.
      await mustDeny(
        'screens/email-1 { kind: "page" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'email-1'), {
          kind: 'page',
        }),
      )
      // Removing the field answers the same question as setting it.
      await mustDeny(
        'screens/email-1 { kind: deleteField() }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'email-1'), {
          kind: deleteField(),
        }),
      )
    })

    it('an editor cannot un-delete a screen', async () => {
      await seedScreens()
      await mustDeny(
        'screens/deleted-1 { deletedAt: deleteField() }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'deleted-1'), {
          deletedAt: deleteField(),
        }),
      )
      await mustDeny(
        'screens/deleted-1 { deletedAt: null }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'deleted-1'), {
          deletedAt: null,
        }),
      )
      await mustDeny(
        'screens/deleted-1 { deletedAt: <a different time> }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'deleted-1'), {
          deletedAt: new Date('2026-02-02'),
        }),
      )
    })

    it('but deleting is still a client write, on both surfaces', async () => {
      await seedScreens()
      // The screens page: `updateDoc(screenRef, { deletedAt: Timestamp.now() })`.
      await mustAllow(
        'screens/page-1 soft delete',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          deletedAt: new Date(),
        }),
      )
      // The Emails card's Delete button, which is the same write on a
      // document whose `kind` this rule now freezes — an over-broad deny
      // would have taken it with it.
      await mustAllow(
        'screens/email-1 soft delete',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'email-1'), {
          deletedAt: new Date(),
        }),
      )
      // Renaming a screen that is ALREADY deleted still works: the rule bites
      // on touching `deletedAt`, not on the document carrying it.
      await mustAllow(
        'screens/deleted-1 rename',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'deleted-1'), {
          displayName: 'Old (archived)',
        }),
      )
      // And hard delete is untouched — /api/resources/erase aside, the rules
      // never denied it.
      await mustAllow(
        'screens/deleted-1 delete',
        deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'deleted-1')),
      )
    })

    it('leaves publishing, unpublishing and authoring alone', async () => {
      await seedScreens()
      // `publishScreenRoute`: a merge-set of slug + publishedAt. This is the
      // write that makes a screen a page, so denying it would be far worse
      // than the bypass.
      await mustAllow(
        'screens/page-1 publish (merge-set slug + publishedAt)',
        setDoc(
          doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'),
          { slug: 'plans', publishedAt: new Date() },
          { merge: true },
        ),
      )
      // `unpublishScreenRoute`: the mirror, clearing both.
      await mustAllow(
        'screens/page-1 unpublish (clear publishedAt + slug)',
        setDoc(
          doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'),
          { publishedAt: deleteField(), slug: deleteField() },
          { merge: true },
        ),
      )
      // The hierarchy drag handler, the SEO panel, and the version switcher.
      await mustAllow(
        'screens/page-1 re-parent + reorder',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          parentId: 'screen-1', order: 2, updatedAt: new Date(),
        }),
      )
      await mustAllow(
        'screens/page-1 seo + protection',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          seo: { title: 'Plans' }, protection: { passwordHash: 'abc' },
        }),
      )
      // The Emails page end to end, minus the API-owned create: an email
      // document is opened in the besigner, its canvas saved, and its name
      // edited — all client writes on a `kind: 'email'` document.
      await mustAllow(
        'screens/email-1 rename',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'email-1'), {
          displayName: 'Welcome v2', updatedAt: new Date(),
        }),
      )
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'hosts', HOST, 'screens', 'email-1', 'versions', 'v1'),
          { screenId: 'email-1', nodes: { root: {} } },
        )
      })
      await mustAllow(
        'screens/email-1/versions/v1 canvas save',
        setDoc(
          doc(authed(EDITOR), 'hosts', HOST, 'screens', 'email-1', 'versions', 'v1'),
          { nodes: { root: { id: 'root' } } },
          { merge: true },
        ),
      )
    })

    // Staff tooling and the Admin SDK routes are unaffected — the erase route
    // and any support fix would otherwise need a rules change to do their job.
    it('staff can still write both fields', async () => {
      await seedScreens()
      await mustAllow(
        'staff clears deletedAt',
        updateDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST, 'screens', 'deleted-1'), {
          deletedAt: deleteField(),
        }),
      )
      await mustAllow(
        'staff sets kind',
        updateDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST, 'screens', 'page-1'), {
          kind: 'email',
        }),
      )
    })
  })

  // AGL-655 / AGL-652. Two things this pins:
  //   1. Listings are ORG-owned, so the owner check must resolve org
  //      membership. Comparing `profileId` to a uid silently denied every
  //      publisher access to their own listing.
  //   2. Rating aggregates drive ranking and the trust signal buyers read,
  //      so they stay server-only even for the owner.
  it('listing owners are resolved via the org, and cannot write rating aggregates', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'marketplaceListings', 'listing-rated'), {
        displayName: 'Thing',
        profileId: ORG, // org-owned (AGL-652)
        artifactType: 'component',
        ratingAverage: 5,
        ratingCount: 2,
      })
      await setDoc(
        doc(db, 'marketplaceListings', 'listing-rated', 'reviews', VIEWER),
        { uid: VIEWER, rating: 5 },
      )
    })
    // An org manager may edit their own listing's metadata.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', 'listing-rated'), {
        displayName: 'Renamed',
      }),
    )
    // A non-manager member of the same org may not.
    await assertFails(
      updateDoc(doc(authed(VIEWER), 'marketplaceListings', 'listing-rated'), {
        displayName: 'Nope',
      }),
    )
    // Nor may an outsider.
    await assertFails(
      updateDoc(doc(authed(OUTSIDER), 'marketplaceListings', 'listing-rated'), {
        displayName: 'Nope',
      }),
    )
    // Even the owner cannot invent a rating. Values must DIFFER from the
    // fixture: `diff()` reports changed keys only, so re-writing the same
    // number is an empty diff and legitimately allowed — that is a quirk of
    // the test, not a hole in the rule.
    for (const [field, value] of [
      ['ratingAverage', 1],
      ['ratingCount', 99],
      ['ratingSum', 500],
      // Nor the install counters (AGL-1420). `installCount` is covered by the
      // plugin-listing block below; these are its live sibling and AGL-1419's
      // derived cache, which were denied nowhere until this pass — and the
      // cache matters most, because writing the triple consistently makes
      // `verifiedLivePins` believe it is fresh and stop re-deriving.
      ['activeInstalls', 4242],
      ['pinnedActiveInstalls', 4242],
      ['pinsVerifiedAtMs', 9999999999999],
      ['pinnedVersionInstalls', { '1.0.0': 4242 }],
    ]) {
      await assertFails(
        updateDoc(doc(authed(OWNER), 'marketplaceListings', 'listing-rated'), {
          [field]: value,
        }),
      ).catch((error) => {
        throw new Error(`owner could write ${field}: ${error.message}`)
      })
    }
    // Reviews are world-readable but never client-written — every gate
    // (verified installer, publisher self-review) lives in the API.
    await assertSucceeds(
      getDoc(doc(authed(OUTSIDER), 'marketplaceListings', 'listing-rated', 'reviews', VIEWER)),
    )
    await assertFails(
      setDoc(
        doc(authed(OUTSIDER), 'marketplaceListings', 'listing-rated', 'reviews', OUTSIDER),
        { uid: OUTSIDER, rating: 5, verifiedInstaller: true },
      ),
    )
    // Including overwriting someone else's.
    await assertFails(
      updateDoc(
        doc(authed(OWNER), 'marketplaceListings', 'listing-rated', 'reviews', VIEWER),
        { rating: 1 },
      ),
    )
  })

  // AGL-658. Takedown has to survive the person being taken down.
  it('staff takedown fields and abuse reports are out of owner reach', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'marketplaceListings', 'listing-hidden'), {
        displayName: 'Dodgy', profileId: ORG, artifactType: 'component',
        hiddenAt: new Date(), hiddenBy: STAFF, hiddenReason: 'spam',
      })
      await setDoc(doc(db, 'marketplaceReports', 'report-1'), {
        targetType: 'listing', listingId: 'listing-hidden',
        reporterUid: OUTSIDER, reason: 'spam', status: 'open',
      })
    })
    // The owner may still edit ordinary metadata...
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', 'listing-hidden'), {
        description: 'Reworded',
      }),
    )
    // ...but cannot un-hide themselves, which would make moderation a
    // suggestion.
    for (const field of ['hiddenAt', 'hiddenBy', 'hiddenReason']) {
      await assertFails(
        updateDoc(doc(authed(OWNER), 'marketplaceListings', 'listing-hidden'), {
          [field]: null,
        }),
      ).catch((error) => {
        throw new Error(`owner could clear ${field}: ${error.message}`)
      })
    }
    // Reports name their reporter, so only staff read them — otherwise a
    // publisher learns exactly who to retaliate against.
    await assertSucceeds(
      getDoc(doc(authed(STAFF, { staff: true }), 'marketplaceReports', 'report-1')),
    )
    await assertFails(getDoc(doc(authed(OWNER), 'marketplaceReports', 'report-1')))
    await assertFails(
      getDoc(doc(authed(OUTSIDER), 'marketplaceReports', 'report-1')),
    )
    // And nobody files one by writing directly — the route stamps the
    // reporter from the verified token.
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'marketplaceReports', 'forged'), {
        targetType: 'listing', listingId: 'listing-hidden',
        reporterUid: OWNER, reason: 'framed',
      }),
    )
  })

  // AGL-666. `source` says whether a template was authored here, downloaded
  // from the marketplace, or came from a starter — and the library shows that
  // as provenance. A client that can rewrite it can stamp "marketplace" on
  // its own work, so it is frozen even for the editors who own the doc.
  it('template source is frozen; the rest of the doc stays editable', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'templates', 'tpl-1'), {
        displayName: 'Renamed hero',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'templates', 'tpl-1'), {
        source: { type: 'marketplace', listingId: 'not-mine' },
      }),
    )
    // Including clearing it, which would erase provenance just as effectively.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'templates', 'tpl-1'), {
        source: { type: 'authored' },
      }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'templates', 'tpl-1')),
    )
  })

  it('the retired admins map no longer authorizes; outsiders and anon never do', async () => {
    await assertFails(getDoc(doc(authed(LEGACY), 'hosts', HOST)))
    await assertFails(
      setDoc(doc(authed(LEGACY), 'hosts', HOST, 'screens', 'legacy'), { name: 'L' }),
    )
    await assertFails(getDoc(doc(authed(OUTSIDER), 'hosts', HOST)))
    await assertFails(getDoc(doc(anon(), 'hosts', HOST, 'screens', 'screen-1')))
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'hosts', HOST, 'screens', 'attack'), { x: 1 }),
    )
  })

  it('client host creation is closed; staff reads anything', async () => {
    await assertFails(
      setDoc(doc(authed(OWNER), 'hosts', 'host-new'), {
        admins: { [OWNER]: true },
      }),
    )
    await assertSucceeds(getDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST)))
  })

  it('suspended orgs keep reads but lose writes', async () => {
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'hosts', SUSPENDED_HOST)))
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', SUSPENDED_HOST, 'screens', 's2'), { x: 1 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', SUSPENDED_HOST), { displayName: 'N' }),
    )
  })
})

describe('org-shared data (AGL-237)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // Every org resource carries a scope now (AGL-1041); the rules fail
      // closed without one, exactly as production does post-backfill.
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1'), {
        name: 'Team', visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1'), { a: 1 })
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1'), { name: 'Newsletter' })
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1', 'members', 'm1'), { email: 'x@y.z' })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'c1'), { email: 'x@y.z' })
      await setDoc(doc(db, 'orgs', ORG, 'media', 'm1'), {
        url: 'u', visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'installs', 'p1'), { version: '1' })
    })
  })

  it('members read; editors write datasets/contacts; viewers stay read-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds1')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c1')))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'datasets', 'ds1')))
    // Dataset/record CREATES are API-only (AGL-473) — the console route
    // enforces quotas server-side; even editors cannot create directly.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds2'), { name: 'New' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r2'), { a: 2 }),
    )
    // Updates and deletes stay editor-writable — they don't consume quota.
    await assertSucceeds(
      setDoc(
        doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1'),
        { a: 3 },
        { merge: true },
      ),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1')),
    )
    // Deleting the DATASET doc is API-only (AGL-945): it owns `records`,
    // and Firestore doesn't cascade, so a client delete would orphan them.
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1')),
    )
    // Same for an email LIST and its enrolled `members` (PII) — AGL-946.
    // Org-wide editors still manage the list itself and individual
    // enrollments; EDITOR is scoped to one site, so the CRM is not theirs to
    // write any more than it is theirs to read (AGL-1026).
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1'), { name: 'News' }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')),
    )
    await assertFails(deleteDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1')))
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'contacts', 'c2'), { email: 'n@y.z' }),
    )
    await assertFails(
      setDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c3'), { email: 'v@y.z' }),
    )
  })

  it('media docs and folders are editor-writable (DAM parity); installs stay API-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'media', 'm1')))
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'installs', 'p1')))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'media', 'm1')))
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'media', 'm1'), { folderId: 'f1' }, { merge: true }),
    )
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'mediaFolders', 'f1'), {
        name: 'Brand', visibleTo: ['org'],
      }),
    )
    await assertFails(
      setDoc(doc(authed(VIEWER), 'orgs', ORG, 'mediaFolders', 'f2'), {
        name: 'No', visibleTo: ['org'],
      }),
    )
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'media', 'm2'), { url: 'x' }),
    )
    await assertFails(setDoc(doc(authed(OWNER), 'orgs', ORG, 'installs', 'p2'), { version: '2' }))
  })
})

/**
 * Site collaborators are org members, and the rules used not to notice
 * (AGL-1026).
 *
 * EDITOR is the scoped shape `grantHostAccess` writes: on the roster, but
 * with `allHosts: false` and a `hostAccess` map naming one site. Before this,
 * `isOrgMember()` was a bare exists(), so that person could read the org's
 * whole CRM, the billing meters, the activity log and every colleague's email.
 */
describe('site collaborators are scoped out of the org (AGL-1026)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'c1'), { email: 'x@y.z' })
      await setDoc(doc(db, 'orgs', ORG, 'contactSegments', 's1'), { name: 'VIPs' })
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1'), { name: 'Newsletter' })
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1', 'members', 'm1'), { email: 'x@y.z' })
      await setDoc(doc(db, 'orgs', ORG, 'usage', '2026-07'), { pageviews: 1 })
      await setDoc(doc(db, 'orgs', ORG, 'apiUsage', '2026-07'), { requests: 1 })
      // Exactly what `serve-media-cdn.ts` writes on an origin serve of an
      // ORG-library asset: a day-doc whose `media` map is keyed by asset id.
      await setDoc(doc(db, 'orgs', ORG, 'analytics', '2026-07-02'), {
        media: { 'm1': { serves: 12, bytes: 3400 } },
      })
      await setDoc(doc(db, 'orgs', ORG, 'activity', 'a1'), { action: 'x' })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1'), { name: 'Team', visibleTo: ['org'] })
      await setDoc(doc(db, 'orgs', ORG, 'media', 'm1'), { url: 'u', visibleTo: ['org'] })
    })
  })

  it('cannot read the roster, but can always read their own membership', async () => {
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'members', OWNER)))
    // Their own doc stays readable — it is how the console resolves their
    // role and site access. Denying it would lock them out of their own site.
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'members', EDITOR)))
    // An org-wide viewer still sees the whole roster.
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'members', OWNER)))
  })

  it('cannot read the CRM — contacts, segments, lists or enrolled members', async () => {
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'c1')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contactSegments', 's1')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'lists', 'l1')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')))
  })

  it('cannot WRITE the CRM either — no write-only access to other people\'s customers', async () => {
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'c9'), { email: 'n@y.z' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'lists', 'l1'), { name: 'Mine' }),
    )
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')),
    )
  })

  it('cannot read billing usage or the org-wide activity log', async () => {
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'usage', '2026-07')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'apiUsage', '2026-07')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'activity', 'a1')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'usage', '2026-07')))
  })

  /**
   * AGL-1143. `orgs/{orgId}/analytics/{day}` reached NO match block at all, so
   * it was denied by default — for every role, staff included, because a path
   * that matches nothing never gets as far as evaluating `isStaff()`.
   *
   * It is not a dead path. `serve-media-cdn.ts` writes it on every origin
   * serve of an org-library asset (`orgs` when `isOrg`, `hosts` otherwise),
   * and `media-library.component.tsx` reads THIRTY day-docs each time the
   * asset drawer opens. The HOST twin has always worked, because
   * `hosts/{hostId}/{subcollection}/{document=**}` grants its read and the
   * AGL-1367 positive control above asserts it; the org block has no
   * catch-all, so only the org half was refused — which is why the common
   * path (a host's DAM) never showed it.
   *
   * Measured in production 2026-08-12 from a live console's Firestore
   * multi-tab state: 75 rejected listen targets on this path and ZERO
   * successful ones, against a `staff: true` account whose every other read
   * in the same minute succeeded. Every other denied shape in that capture
   * had successes too; this one alone never succeeded.
   *
   * Scoped like `usage/{month}` rather than like `counters`: ONE day-doc
   * carries a `media` map keyed by every asset id in the org, so a
   * collaborator entitled to three assets would otherwise read the delivery
   * figures — and the existence — of all of them. Same reasoning as AGL-1026.
   */
  it('org-wide members read the media delivery day-doc; collaborators do not (AGL-1143)', async () => {
    await mustAllow(
      'an org-wide viewer reads analytics/{day}',
      getDoc(doc(authed(VIEWER), 'orgs', ORG, 'analytics', '2026-07-02')),
    )
    await mustAllow(
      'the owner reads analytics/{day}',
      getDoc(doc(authed(OWNER), 'orgs', ORG, 'analytics', '2026-07-02')),
    )
    await mustAllow(
      'staff read analytics/{day}',
      getDoc(doc(authed(STAFF, { staff: true }), 'orgs', ORG, 'analytics', '2026-07-02')),
    )
    // The scoped collaborator and the outsider stay out — this is a grant,
    // not a blanket, and without these two the test above would pass against
    // `allow read: if true`.
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'analytics', '2026-07-02')))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'analytics', '2026-07-02')))
    // The day-doc is a metered-billing input on the org side exactly as it is
    // on the host side (AGL-1367): every writer is an Admin-SDK route, so no
    // client writes it, owner included.
    await mustDeny(
      'the owner writing analytics/{day}',
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'analytics', '2026-07-02'), {
        media: { m1: { serves: 0, bytes: 0 } },
      }),
    )
  })

  it('KEEPS what building a site needs: the org doc and ORG-WIDE data', async () => {
    // The org doc still carries the entitlements every console surface
    // gates features on. Datasets and media are readable here because they
    // are org-wide; AGL-1041/1042 below cover the restricted case, which
    // AGL-1026 could not express for lack of a per-site association.
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG)))
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1')))
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'media', 'm1')))
  })
})

describe('scoped datasets, media and folders (AGL-1041/1042)', () => {
  const OTHER_HOST = 'host-other'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-org'), {
        name: 'Shared', visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-mine'), {
        name: 'Mine', visibleTo: [`host:${HOST}`],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs'), {
        name: 'Internal', visibleTo: [`host:${OTHER_HOST}`],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-legacy'), {
        name: 'Unstamped',
      })
      for (const id of ['ds-org', 'ds-mine', 'ds-theirs']) {
        await setDoc(doc(db, 'orgs', ORG, 'datasets', id, 'records', 'r1'), {
          values: { a: '1' },
        })
      }
      // `createdAt` matters: the grid sorts by it, and a list query with
      // no MATCHING candidates is allowed vacuously — which is how an
      // earlier version of the ordered-list test below passed while the
      // real page was denied. Every fixture doc must be a candidate.
      await setDoc(doc(db, 'orgs', ORG, 'media', 'me-theirs'), {
        url: 'u', visibleTo: [`host:${OTHER_HOST}`], createdAt: new Date(),
      })
      await setDoc(doc(db, 'orgs', ORG, 'media', 'me-org'), {
        url: 'u', visibleTo: ['org'], createdAt: new Date(),
      })
      await setDoc(doc(db, 'orgs', ORG, 'mediaFolders', 'f-theirs'), {
        name: 'Internal', visibleTo: [`host:${OTHER_HOST}`],
      })
    })
  })

  it('a collaborator reads org-wide and their OWN site data, not another site\'s', async () => {
    const db = authed(EDITOR)
    await assertSucceeds(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-org')))
    await assertSucceeds(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-mine')))
    await assertFails(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs')))
  })

  it('a doc with NO visibleTo is DENIED — fail closed (AGL-1047)', async () => {
    // Reversed deliberately. Allowing unstamped docs through required an
    // `'visibleTo' in resource.data` check, and that check made the rule
    // unprovable per-document for LIST queries — Firestore then admitted an
    // UNFILTERED list of the whole collection, restricted docs included.
    // The backfill has run and every writer stamps the field, so an absent
    // `visibleTo` is a bug, and denying it is both correct and what keeps
    // the list contract below working.
    await assertFails(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds-legacy')),
    )
    // An org-wide member still reads it — they short-circuit before the
    // field is consulted, so one unstamped doc cannot lock an owner out.
    await assertSucceeds(
      getDoc(doc(authed(OWNER), 'orgs', ORG, 'datasets', 'ds-legacy')),
    )
  })

  it('an org-wide member still reads everything the org owns', async () => {
    await assertSucceeds(getDoc(doc(authed(OWNER), 'orgs', ORG, 'datasets', 'ds-theirs')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds-theirs')))
    await assertSucceeds(getDoc(doc(authed(OWNER), 'orgs', ORG, 'media', 'me-theirs')))
  })

  it('records inherit their dataset\'s scope', async () => {
    const db = authed(EDITOR)
    await assertSucceeds(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-org', 'records', 'r1')))
    await assertSucceeds(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-mine', 'records', 'r1')))
    await assertFails(getDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs', 'records', 'r1')))
  })

  it('a collaborator cannot WRITE another site\'s dataset or its records', async () => {
    const db = authed(EDITOR)
    await assertFails(
      updateDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs'), { name: 'Taken' }),
    )
    await assertFails(
      updateDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs', 'records', 'r1'), {
        values: { a: '2' },
      }),
    )
    await assertFails(
      deleteDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-theirs', 'records', 'r1')),
    )
  })

  it('a scoped member cannot CHANGE who a resource is shared with', async () => {
    const db = authed(EDITOR)
    // Widening their own site's dataset to the whole org...
    await assertFails(
      updateDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-mine'), { visibleTo: ['org'] }),
    )
    // ...or narrowing an org-wide one to just their site, taking it from
    // everyone else. Both are the org's call.
    await assertFails(
      updateDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-org'), {
        visibleTo: [`host:${HOST}`],
      }),
    )
    // Editing CONTENT on something they can see is still fine.
    await assertSucceeds(
      updateDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-mine'), { name: 'Renamed' }),
    )
  })

  it('an org-wide member CAN change the scope', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG, 'datasets', 'ds-mine'), {
        visibleTo: ['org'],
      }),
    )
  })

  it('media and folders follow the same rules', async () => {
    const db = authed(EDITOR)
    await assertFails(getDoc(doc(db, 'orgs', ORG, 'media', 'me-theirs')))
    await assertFails(getDoc(doc(db, 'orgs', ORG, 'mediaFolders', 'f-theirs')))
    await assertFails(
      updateDoc(doc(db, 'orgs', ORG, 'media', 'me-theirs'), { alt: 'x' }),
    )
    await assertFails(
      deleteDoc(doc(db, 'orgs', ORG, 'mediaFolders', 'f-theirs')),
    )
  })

  // LIST queries, which every console page issues and no test covered
  // before. Rules evaluate per DOCUMENT on a list and Firestore fails the
  // WHOLE query if any candidate would fail — so an unfiltered list does
  // not come back filtered, it comes back denied. This is the contract
  // AGL-1044/1045's client queries are written against; if it breaks, the
  // Data and Media pages error rather than showing less.
  it('a scoped list is DENIED without the filter and ALLOWED with it', async () => {
    const db = authed(EDITOR)
    const datasets = collection(db, 'orgs', ORG, 'datasets')
    await assertFails(getDocs(datasets))
    await assertSucceeds(
      getDocs(
        query(
          datasets,
          where('visibleTo', 'array-contains-any', ['org', `host:${HOST}`]),
        ),
      ),
    )
  })

  // The case nothing covered: an ORG-WIDE member listing UNFILTERED, which
  // is what the console actually sends for an owner (they get no filter by
  // design — adding one would cost a composite index and hide any doc the
  // backfill missed). AGL-1047 removed the missing-field escape hatch on
  // the strength of "an org-wide member short-circuits before `visibleTo`
  // is consulted"; this asserts that claim instead of assuming it.
  it('an OWNER lists unfiltered — datasets, media and folders', async () => {
    const db = authed(OWNER)
    await assertSucceeds(getDocs(collection(db, 'orgs', ORG, 'datasets')))
    await assertSucceeds(getDocs(collection(db, 'orgs', ORG, 'media')))
    await assertSucceeds(getDocs(collection(db, 'orgs', ORG, 'mediaFolders')))
  })

  it('an OWNER lists media the way the grid actually queries it', async () => {
    // The console sends orderBy + limit, not a bare collection read. The
    // plain case above passed while the real Media page was denied in
    // production, so the shape is asserted verbatim rather than
    // approximated.
    await assertSucceeds(
      getDocs(
        query(
          collection(authed(OWNER), 'orgs', ORG, 'media'),
          orderBy('createdAt', 'desc'),
          limit(24),
        ),
      ),
    )
  })

  it('an allHosts VIEWER lists unfiltered too', async () => {
    // `allHosts` without owner/admin is the other org-wide shape, and it
    // reaches `isOrgWideMember()` by a different branch.
    const db = authed(VIEWER)
    await assertSucceeds(getDocs(collection(db, 'orgs', ORG, 'datasets')))
    await assertSucceeds(getDocs(collection(db, 'orgs', ORG, 'media')))
  })

  it('one UNSTAMPED doc cannot lock an org-wide member out of the list', async () => {
    // `ds-legacy` carries no `visibleTo`. For a scoped member that is a
    // fail-closed miss (asserted above). For an owner it must not deny the
    // whole query — the failure mode would be an empty Data page for the
    // person who owns the org.
    await assertSucceeds(
      getDocs(collection(authed(OWNER), 'orgs', ORG, 'datasets')),
    )
  })

  it('the filtered list returns exactly what the member may see', async () => {
    const snapshot = await getDocs(
      query(
        collection(authed(EDITOR), 'orgs', ORG, 'datasets'),
        where('visibleTo', 'array-contains-any', ['org', `host:${HOST}`]),
      ),
    )
    const ids = snapshot.docs.map((entry) => entry.id).sort()
    // ds-legacy carries no `visibleTo`, so array-contains-any cannot match
    // it — the reason the AGL-1040 backfill had to run BEFORE these rules.
    assert.deepEqual(ids, ['ds-mine', 'ds-org'])
  })

  it('a member cannot widen the filter to another site', async () => {
    // Asking for a site they were never granted must not succeed just
    // because the query is well-formed.
    await assertFails(
      getDocs(
        query(
          collection(authed(EDITOR), 'orgs', ORG, 'datasets'),
          where('visibleTo', 'array-contains-any', [`host:${OTHER_HOST}`]),
        ),
      ),
    )
  })

  it('an org-wide member lists everything, unfiltered', async () => {
    const snapshot = await getDocs(collection(authed(OWNER), 'orgs', ORG, 'datasets'))
    assert.ok(snapshot.docs.length >= 4)
  })

  it('media and folder lists follow the same contract', async () => {
    const db = authed(EDITOR)
    await assertFails(getDocs(collection(db, 'orgs', ORG, 'media')))
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'orgs', ORG, 'media'),
          where('visibleTo', 'array-contains-any', ['org', `host:${HOST}`]),
        ),
      ),
    )
  })

  it('a collaborator cannot CREATE a folder scoped to a site they lack', async () => {
    const db = authed(EDITOR)
    await assertFails(
      setDoc(doc(db, 'orgs', ORG, 'mediaFolders', 'f-new'), {
        name: 'Sneaky', visibleTo: [`host:${OTHER_HOST}`],
      }),
    )
    await assertSucceeds(
      setDoc(doc(db, 'orgs', ORG, 'mediaFolders', 'f-ok'), {
        name: 'Mine', visibleTo: [`host:${HOST}`],
      }),
    )
  })
})

describe('staff RBAC on org billing keys (AGL-206/238)', () => {
  it('the billing-staff branch is alive but cannot smuggle a suspension or slug', async () => {
    const billingStaffDb = authed(STAFF, { staff: true, staffRole: 'billing' })
    // This used to write `plan` — the role's whole purpose, and the natural
    // proof that the branch exists at all. AGL-1795 denied `plan`/
    // `entitlements`/`releaseFlags` to every client once /api/admin/org-override
    // became their only writer, which empties this branch of that purpose. The
    // branch is still real, so the control moves to a key it may still write
    // rather than being dropped: a branch nobody proves is alive is a branch
    // that can be deleted by accident.
    await assertSucceeds(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { name: 'Acme Billing' }),
    )
    await mustDeny(
      'billing staff writing orgs/{orgId}.plan from the client (AGL-1795)',
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { plan: 'business' }),
    )
    await assertFails(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), {
        suspendedAt: new Date(),
      }),
    )
    await assertFails(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { slug: 'stolen' }),
    )
    // Since AGL-1517 the suspended* family is Admin-SDK-only for EVERY
    // client — the super token that used to be this test's positive control
    // is now denied too (the flag without the fan-out is the AGL-1505 bug).
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    await mustDeny(
      'super staff writing orgs/{orgId}.suspendedAt from the client',
      updateDoc(doc(superStaffDb, 'orgs', ORG), { suspendedAt: new Date() }),
    )
  })

  it('support staff reads orgs but cannot write them at all', async () => {
    const supportStaffDb = authed(STAFF, { staff: true, staffRole: 'support' })
    await assertSucceeds(getDoc(doc(supportStaffDb, 'orgs', ORG)))
    await mustDeny(
      'support staff writing orgs/{orgId}.plan',
      updateDoc(doc(supportStaffDb, 'orgs', ORG), { plan: 'business' }),
    )
    // `plan` alone stopped isolating the ROLE when AGL-1795 denied it to every
    // client: that case now passes for a support token, a billing token and a
    // super token alike. What still separates support from billing is a key
    // billing may write — so the read-only claim is made with one of those.
    await mustDeny(
      'support staff renaming the org, which billing staff may do',
      updateDoc(doc(supportStaffDb, 'orgs', ORG), { name: 'Support Rename' }),
    )
  })
})

// Pre-release hardening: field-level guards added by the security audit
// (AGL-493/494/501/502/503/508). Each proves the guard denies the abusive
// write/read while leaving the legitimate one intact.
describe('pre-release hardening guards', () => {
  const LISTING = 'listing-1'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // Publisher profile owned by OWNER (H3, M6 seed).
      await setDoc(doc(db, 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner',
      })
      // Secret-/PII-bearing host subcollections (M5).
      await setDoc(doc(db, 'hosts', HOST, 'webhooks', 'wh1'), {
        url: 'https://hook.example', secret: 'sh',
      })
      await setDoc(doc(db, 'hosts', HOST, 'orders', 'o1'), {
        total: 100, email: 'buyer@x.z',
      })
      // Host plugin install pin (M11).
      await setDoc(doc(db, 'hosts', HOST, 'installs', 'p1'), {
        version: '1.0.0', sha256: 'abc',
      })
      // Marketplace listing with server-managed fields (M6). `profileId` holds
      // the publishing ORG since AGL-652 — the fixture used to carry a uid,
      // which no publish path has produced since, so the ownership rule was
      // being exercised against a shape that no longer exists.
      await setDoc(doc(db, 'marketplaceListings', LISTING), {
        profileId: ORG, name: 'Plugin', installCount: 5, priceUsd: 10,
      })
      // Org publisher profile (AGL-652) — created server-side, so the rules
      // tests seed it rather than creating it through a client write.
      await setDoc(doc(db, 'publisherProfiles', ORG), {
        handle: 'seeded-handle', displayName: 'Acme Labs',
      })
    })
  })

  it('editors/admins cannot rewrite host identity keys; staff can (AGL-493)', async () => {
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { memberRoles: { [EDITOR]: 'admin' } }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        memberRoles: { [OWNER]: 'admin', [OUTSIDER]: 'admin' },
      }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { orgId: 'org-fake' }),
    )
    // Content updates still work; staff may still adjust the projection.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { displayName: 'Renamed' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST), {
        memberRoles: { [OWNER]: 'admin' },
      }),
    )
  })

  it('profile owner cannot set Stripe payout fields; metadata is fine (AGL-494)', async () => {
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', bio: 'hi',
      }),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripeChargesEnabled: true,
      }),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripeAccountId: 'acct_x',
      }),
    )
    // A brand-new profile likewise can't smuggle the payout fields in on create.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'profiles', EDITOR), {
        handle: 'ed-pub', displayName: 'Ed', stripeAccountId: 'acct_y',
      }),
    )
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'profiles', EDITOR), {
        handle: 'ed-pub', displayName: 'Ed',
      }),
    )
  })

  it('org admins cannot self-enable plugins; super staff can (AGL-501)', async () => {
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
    await assertFails(
      updateDoc(
        doc(authed(STAFF, { staff: true, staffRole: 'billing' }), 'orgs', ORG),
        { enabledPlugins: ['paid'] },
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(authed(STAFF, { staff: true, staffRole: 'super' }), 'orgs', ORG),
        { enabledPlugins: ['paid'] },
      ),
    )
  })

  it('webhook secrets and order PII are hidden from viewers (AGL-502)', async () => {
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh1')))
    await assertSucceeds(getDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', 'o1')))
    await assertFails(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'webhooks', 'wh1')))
    await assertFails(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'orders', 'o1')))
    // A non-secret subcollection stays viewer-readable (catch-all unchanged).
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'variables', 'var-1')))
  })

  /**
   * AGL-1467. `mediaTombstones` is the undo record for a deleted asset, and it
   * is the FIRST collection under a host that no client may read OR write.
   * Both halves matter and they fail differently:
   *
   * - **Read.** A tombstone holds the media document verbatim — alt text,
   *   description, tags, custom metadata, the `visibleTo` tokens that decided
   *   who could see the asset. Granting a read here would create, by accident,
   *   the browsable copy of deleted customer content that AGL-1443 is open on,
   *   and that the undo affordance was deliberately designed not to need.
   * - **Write.** A restore re-increments `counters/media` by the tombstone's
   *   own `sizeBytes` and writes its `media` payload back as a real document.
   *   So a writable tombstone is AGL-1367's storage meter reached one
   *   collection to the left (a negative `sizeBytes` lowers the wall and the
   *   metered invoice with it), plus a way to mint a media document carrying
   *   scope tokens the author was never granted. A DELETE is the third: it
   *   destroys the only route back to a file the author just deleted.
   *
   * Owner as well as editor, because this is a path question, not a role one.
   */
  it('media tombstones are invisible and unwritable to every client (AGL-1467)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'mediaTombstones', 'm1'),
        { media: { fileName: 'a.png', visibleTo: ['org'] }, sizeBytes: 2048 },
      )
    })
    for (const uid of [EDITOR, OWNER, VIEWER]) {
      await assertFails(
        getDoc(doc(authed(uid), 'hosts', HOST, 'mediaTombstones', 'm1')),
      )
      await assertFails(
        setDoc(doc(authed(uid), 'hosts', HOST, 'mediaTombstones', 'forged'), {
          media: { fileName: 'forged.png', visibleTo: ['org'] },
          sizeBytes: -100_000_000,
        }),
      )
      await assertFails(
        updateDoc(doc(authed(uid), 'hosts', HOST, 'mediaTombstones', 'm1'), {
          sizeBytes: -100_000_000,
        }),
      )
      await assertFails(
        deleteDoc(doc(authed(uid), 'hosts', HOST, 'mediaTombstones', 'm1')),
      )
    }
  })

  /**
   * The org library's tombstones, which are the ones that actually exist in
   * production today — the org DAM is where the 2026-08-13 pass ran. There is
   * no catch-all under `match /orgs/{orgId}`, so this is default-deny rather
   * than an exclusion list; asserting it is what stops somebody adding a
   * convenience block later without noticing what it re-grants.
   */
  it('org media tombstones are default-denied to members (AGL-1467)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'orgs', ORG, 'mediaTombstones', 'm1'),
        { media: { fileName: 'a.png', visibleTo: ['org'] }, sizeBytes: 2048 },
      )
    })
    await assertFails(
      getDoc(doc(authed(OWNER), 'orgs', ORG, 'mediaTombstones', 'm1')),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'mediaTombstones', 'forged'), {
        sizeBytes: -1,
      }),
    )
  })

  it('org publisher profiles are manager-written, payout keys server-only (AGL-652)', async () => {
    // Public read — buyers see who they install from.
    await assertSucceeds(getDoc(doc(anon(), 'publisherProfiles', ORG)))
    // Creates and handle writes are server-only: the handle must be claimed
    // transactionally, and a client read-then-write lets two orgs racing for
    // one handle both win (AGL-652).
    await assertFails(
      setDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        handle: 'acme-labs',
        displayName: 'Acme Labs',
      }),
    )
    // Editors and viewers are members but not managers.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'publisherProfiles', ORG), {
        handle: 'acme-labs',
        displayName: 'Acme Labs',
      }),
    )
    await assertFails(
      setDoc(doc(authed(VIEWER), 'publisherProfiles', ORG), {
        handle: 'acme-labs',
        displayName: 'Acme Labs',
      }),
    )
    // Another org's owner cannot publish as us.
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'publisherProfiles', ORG), {
        handle: 'stolen',
        displayName: 'Stolen',
      }),
    )
    // Payout keys decide who receives money — Connect route (Admin SDK) only.
    await assertFails(
      setDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        handle: 'acme-labs',
        displayName: 'Acme Labs',
        stripeAccountId: 'acct_attacker',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        stripeChargesEnabled: true,
      }),
    )
    // ...but a manager may still edit the cosmetic fields on an existing
    // profile, so the handle freeze doesn't lock the page entirely.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        handle: 'seeded-handle',
        displayName: 'Acme Labs Renamed',
        bio: 'We make things.',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        handle: 'stolen-handle',
      }),
    )
    // The publisher agreement is server-owned too (AGL-1077). An acceptance
    // the accepting party can write itself is not evidence of anything —
    // and this is the field `publish-plugin` refuses on, so a forgeable one
    // would make the whole gate decorative.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        publisherAgreement: {
          version: '2026-07-28.1',
          acceptedBy: OWNER,
          acceptedAt: new Date(),
        },
      }),
    )
    // Malformed handles are rejected.
    await assertFails(
      setDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        handle: 'No Spaces',
        displayName: 'Acme Labs',
      }),
    )
  })

  it('publisher handle reservations are readable but never client-written (AGL-652)', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'publisherHandles', 'acme-labs')))
    // Client-writable reservations would race — last writer would take
    // another publisher's marketplace URL.
    await assertFails(
      setDoc(doc(authed(OWNER), 'publisherHandles', 'acme-labs'), { orgId: ORG }),
    )
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'publisherHandles', 'acme-labs'), {
        orgId: OTHER_ORG,
      }),
    )
  })

  it('listing owner cannot tamper server-managed fields (AGL-503)', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), { deletedAt: new Date() }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), { installCount: 9999 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), { priceUsd: 0 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), { profileId: OUTSIDER }),
    )
    // The review verdict is staff-owned (AGL-651). It decides the trust badge
    // AND whether a plugin is publicly browsable, so an owner able to write it
    // could self-promote to 'verified' and bypass staff review entirely.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        reviewStatus: 'verified',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        reviewStatus: 'listed',
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        reviewedBy: OWNER,
        reviewedAt: new Date(),
      }),
    )
    // AGL-1364: denying `reviewStatus` was not enough, because the gate that
    // reads it only applies to PLUGINS — `isListingBrowsable` returns true
    // outright for any other artifact type. A publisher sitting at
    // 'submitted' or 'rejected' could therefore become browsable by
    // relabelling the artifact instead of the verdict. All three
    // discriminators are denied, because `listingArtifactType` falls back
    // through them in turn.
    for (const relabel of [
      { artifactType: 'component' },
      { kind: 'template' },
      { type: 'component' },
    ]) {
      await assertFails(
        updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), relabel),
      )
    }
    // The verification ask is server-owned (AGL-1217): the staff queue is
    // built by filtering `state == 'pending'`.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        verificationRequest: { state: 'pending', requestedAt: new Date() },
      }),
    )
    // `latestApprovedVersion` is the offer for plugins; `latestVersion` is
    // the offer for everything else, and only one of them was denied.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        latestVersion: 99,
      }),
    )
    // The rest of the type's "Server-managed" banner.
    for (const field of [
      { publisherOrgId: OUTSIDER },
      { sourceComponentId: 'cmp-x' },
      { sourceHostId: 'host-x' },
      { versionHistory: [{ version: 99 }] },
      { screenCount: 99 },
      { previewImageUrl: 'https://x.z/p.png' },
      { createdAt: new Date() },
      { updatedAt: new Date() },
    ]) {
      await assertFails(
        updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), field),
      )
    }
    // Publisher-authored listing CONTENT stays owner-writable — the point of
    // the deny-list is that it names what is server-owned, not everything.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'marketplaceListings', LISTING), {
        displayName: 'Plugin v2', readme: '# Docs', license: 'MIT',
      }),
    )
    // Non-owners still can't touch someone else's listing.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'marketplaceListings', LISTING), { deletedAt: new Date() }),
    )
  })

  it('host install pins are create/update API-only but client-deletable (AGL-508)', async () => {
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p2'), { version: '2.0.0' }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p1'), { version: '9.0.0' }),
    )
    // Uninstall (delete) stays a client action for editors/admins.
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p1')),
    )
  })
})

/**
 * Clickwrap acceptance records (AGL-1497/1508). `users/{uid}/legalAcceptances/
 * {version}` is live in production (ruleset 057b9db9) with owner-read and
 * `write: if false`, and until this block nothing asserted either half. The
 * collection's entire value is evidentiary: *what did this user accept, and
 * can we prove the record was not forged, back-dated, amended or deleted from
 * a client*. So the writes denied here include the OWNER — the person the
 * evidence is about is exactly who must not hold the pen — and a
 * staff-claimed token, because the only legitimate writer is the Admin SDK
 * signup path, which rules never applied to.
 */
describe('legal acceptance records are owner-read, never client-written (AGL-1508)', () => {
  const VERSION = '2026-07-28.1'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', OWNER, 'legalAcceptances', VERSION),
        { version: VERSION, acceptedAtMs: 1753731600000, source: 'signup' },
      )
    })
  })

  it('the owner and staff read the record; another user and anon cannot', async () => {
    await mustAllow(
      'the owner reading their own acceptance',
      getDoc(doc(authed(OWNER), 'users', OWNER, 'legalAcceptances', VERSION)),
    )
    // The support surface lists a user's history; a list is evaluated
    // against the query, so this proves the rule is provable for LIST too.
    await mustAllow(
      'the owner listing their acceptance history',
      getDocs(collection(authed(OWNER), 'users', OWNER, 'legalAcceptances')),
    )
    await mustAllow(
      'staff reading an acceptance',
      getDoc(
        doc(authed(STAFF, { staff: true }), 'users', OWNER, 'legalAcceptances', VERSION),
      ),
    )
    await assertFails(
      getDoc(doc(authed(EDITOR), 'users', OWNER, 'legalAcceptances', VERSION)),
    )
    await assertFails(
      getDoc(doc(anon(), 'users', OWNER, 'legalAcceptances', VERSION)),
    )
  })

  it('no client creates, amends or deletes an acceptance — owner and staff included', async () => {
    // Forging: one more acceptance the user never made.
    await mustDeny(
      'the owner creating an acceptance for themselves',
      setDoc(doc(authed(OWNER), 'users', OWNER, 'legalAcceptances', '2026-08-13.1'), {
        version: '2026-08-13.1', acceptedAtMs: Date.now(), source: 'signup',
      }),
    )
    // Back-dating: the dispute the record exists to settle.
    await mustDeny(
      'the owner amending acceptedAtMs',
      updateDoc(doc(authed(OWNER), 'users', OWNER, 'legalAcceptances', VERSION), {
        acceptedAtMs: 1,
      }),
    )
    // Repudiating: "I never agreed to that version."
    await mustDeny(
      'the owner deleting their acceptance',
      deleteDoc(doc(authed(OWNER), 'users', OWNER, 'legalAcceptances', VERSION)),
    )
    // A staff-claimed CLIENT token is still a client. The Admin SDK signup
    // path is the only writer; a staff laptop with the console open is not it.
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    await mustDeny(
      'super staff creating an acceptance',
      setDoc(doc(superStaffDb, 'users', OWNER, 'legalAcceptances', 'forged-v'), {
        version: 'forged-v', acceptedAtMs: Date.now(),
      }),
    )
    await mustDeny(
      'super staff amending an acceptance',
      updateDoc(doc(superStaffDb, 'users', OWNER, 'legalAcceptances', VERSION), {
        acceptedAtMs: 2,
      }),
    )
    await mustDeny(
      'super staff deleting an acceptance',
      deleteDoc(doc(superStaffDb, 'users', OWNER, 'legalAcceptances', VERSION)),
    )
    // The Admin SDK path still writes — the deny closes the client door only.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'users', OWNER, 'legalAcceptances', '2026-08-13.2'),
        { version: '2026-08-13.2', acceptedAtMs: Date.now(), source: 'signup' },
      )
    })
  })

  /**
   * The OR trap, asserted at the exact path. Sibling `match` blocks OR their
   * allows and the looser wins, and the loosest grant adjacent to this
   * subtree is the parent: `users/{userId}` is owner-WRITABLE (the account
   * page). This proves that grant stops at the document — the same owner
   * token writes the parent and is refused one level down, so a future
   * `match /users/{userId}/{document=**}` convenience block (or any sibling
   * re-granting the subtree) turns this red instead of shipping.
   */
  it('the parent user-doc write does not reach the acceptance (OR trap)', async () => {
    await mustAllow(
      'the owner writing their own user doc — the loosest adjacent grant',
      setDoc(doc(authed(OWNER), 'users', OWNER), { displayName: 'Z' }, { merge: true }),
    )
    await mustDeny(
      'the same owner token merge-setting the acceptance one level down',
      setDoc(
        doc(authed(OWNER), 'users', OWNER, 'legalAcceptances', VERSION),
        { acceptedAtMs: 3 },
        { merge: true },
      ),
    )
  })
})

/**
 * The AGL-1501 lockdown surface (AGL-1507), live in ruleset 0370ace4.
 *
 * `lockdowns/{id}` holds the platform and per-user panic records. Reads are
 * staff-only — a public read would let anyone enumerate which users are
 * locked; the visitor-facing notice is served sanitized by an API route.
 * Writes are closed to EVERYONE including staff clients, because a lockdown
 * write must also revoke sessions, fan out projections and revalidate cached
 * pages — /api/admin/lockdown (Admin SDK) is the only writer, and a bare
 * client write would be a lockdown that looks set and enforces nothing.
 */
/**
 * AGL-1964: the public abuse-report queue.
 *
 * The reporter is UNAUTHENTICATED — that is the point of the feature, and it
 * is what makes these rules load-bearing in a way `marketplaceReports`' are
 * not. There is no verified uid to derive a document id from, so the id is a
 * one-way hash the route computes; if a client could write here at all it
 * could choose its own id, and manufacture a groundswell of reports against a
 * competitor's site. The queue's entire value is that a human believes it.
 */
describe('the abuse-report queue is staff-read, nobody-write (AGL-1964)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'abuseReports', 'report-1'), {
        reference: 'AR-ABC1234567', status: 'open', category: 'phishing',
        url: 'https://evil.aglyn.app/signin', hostId: HOST,
        reporterEmail: 'fraud@bank.example',
        details: 'Copies a bank sign-in page.',
      })
    })
  })

  it('staff read the queue; nobody else does', async () => {
    await mustAllow(
      'staff reading an abuse report',
      getDoc(doc(authed(STAFF, { staff: true }), 'abuseReports', 'report-1')),
    )
    // Not even the org that owns the reported site. A row names its reporter
    // — by real legal name on a DMCA notice, by statute — and showing the
    // reported party who reported them invites retaliation.
    for (const uid of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
      await mustDeny(
        `${uid} reading an abuse report about their own site`,
        getDoc(doc(authed(uid), 'abuseReports', 'report-1')),
      )
    }
    await mustDeny(
      'an anonymous visitor reading the queue',
      getDoc(doc(env.unauthenticatedContext().firestore(), 'abuseReports', 'report-1')),
    )
  })

  it('nobody writes — staff clients included', async () => {
    // Forging a report is the attack the id hash exists to prevent, so the
    // create arm matters most.
    for (const [label, db] of [
      ['an anonymous visitor', env.unauthenticatedContext().firestore()],
      ['a site owner', authed(OWNER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} forging an abuse report at a chosen id`,
        setDoc(doc(db, 'abuseReports', 'forged-1'), {
          status: 'open', category: 'phishing',
          url: 'https://competitor.aglyn.app/',
        }),
      )
      await mustDeny(
        `${label} changing a report's status from the client`,
        updateDoc(doc(db, 'abuseReports', 'report-1'), { status: 'dismissed' }),
      )
      await mustDeny(
        `${label} deleting a report`,
        deleteDoc(doc(db, 'abuseReports', 'report-1')),
      )
    }
  })
})

describe('the lockdowns collection is staff-read, nobody-write (AGL-1507)', () => {
  const LOCKED_UID = OUTSIDER
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'lockdowns', 'platform'), {
        scope: 'platform', reasonCode: 'incident', message: 'Back soon',
        lockedAtMs: Date.now(),
      })
      await setDoc(doc(db, 'lockdowns', `user--${LOCKED_UID}`), {
        scope: 'user', uid: LOCKED_UID, reasonCode: 'abuse',
        lockedAtMs: Date.now(),
      })
      // Feature scope (AGL-1510): `feature--{key}` docs live in the SAME
      // collection so the same match block covers them — these cases pin
      // that the id shape gets no special treatment anywhere.
      await setDoc(doc(db, 'lockdowns', 'feature--uploads'), {
        scope: 'feature', feature: 'uploads', reason: 'security',
        atMs: Date.now(),
      })
    })
  })

  it('feature docs (AGL-1510) ride the same block: staff read, nobody-write', async () => {
    await mustAllow(
      'staff reading a feature lockdown',
      getDoc(doc(authed(STAFF, { staff: true }), 'lockdowns', 'feature--uploads')),
    )
    await assertFails(
      getDoc(doc(authed(OWNER), 'lockdowns', 'feature--uploads')),
    )
    await assertFails(getDoc(doc(anon(), 'lockdowns', 'feature--uploads')))
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    await mustDeny(
      'super staff creating a feature lockdown from the client',
      setDoc(doc(superStaffDb, 'lockdowns', 'feature--checkout'), {
        scope: 'feature', feature: 'checkout', reason: 'manual',
      }),
    )
    // Deleting IS the lift, and a bare lift skips the cache invalidation
    // and the audit row — only /api/admin/lockdown may restore a feature.
    await mustDeny(
      'super staff lifting a feature lockdown by deleting the doc',
      deleteDoc(doc(superStaffDb, 'lockdowns', 'feature--uploads')),
    )
  })

  it('staff read lockdowns; members, the locked user and anon cannot', async () => {
    await mustAllow(
      'staff reading the platform lockdown',
      getDoc(doc(authed(STAFF, { staff: true }), 'lockdowns', 'platform')),
    )
    await mustAllow(
      'staff listing lockdowns',
      getDocs(collection(authed(STAFF, { staff: true }), 'lockdowns')),
    )
    await assertFails(getDoc(doc(authed(OWNER), 'lockdowns', 'platform')))
    // The locked user learning the shape of their own lock is the
    // enumeration the staff-only read exists to prevent — the sanitized
    // notice comes from the API route, not this document.
    await assertFails(
      getDoc(doc(authed(LOCKED_UID), 'lockdowns', `user--${LOCKED_UID}`)),
    )
    await assertFails(getDoc(doc(anon(), 'lockdowns', 'platform')))
    await assertFails(getDocs(collection(authed(OWNER), 'lockdowns')))
  })

  it('no client writes a lockdown — not even the loosest staff token (OR trap)', async () => {
    // Super staff is the loosest grant in the whole file (it updates org
    // docs wholesale), so it is the token a future sibling `match` that
    // accidentally spans /lockdowns would most likely admit. Asserted at the
    // exact path, per the OR-trap rule: sibling blocks OR and the looser wins.
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    await mustDeny(
      'super staff creating a lockdown',
      setDoc(doc(superStaffDb, 'lockdowns', 'user--uid-victim'), {
        scope: 'user', uid: 'uid-victim', reasonCode: 'abuse',
      }),
    )
    await mustDeny(
      'super staff amending the platform lockdown',
      updateDoc(doc(superStaffDb, 'lockdowns', 'platform'), { message: 'edited' }),
    )
    // Deleting IS the lift — done bare, sessions stay revoked, projections
    // stay set, caches stay poisoned. Only the route may lift.
    await mustDeny(
      'super staff lifting a lockdown by deleting the doc',
      deleteDoc(doc(superStaffDb, 'lockdowns', 'platform')),
    )
    await mustDeny(
      'plain staff writing a lockdown',
      setDoc(doc(authed(STAFF, { staff: true }), 'lockdowns', 'platform'), {
        message: 'edited',
      }, { merge: true }),
    )
    await mustDeny(
      'an org owner writing a lockdown',
      setDoc(doc(authed(OWNER), 'lockdowns', 'platform'), { message: 'edited' }),
    )
    // The locked user un-locking themselves is the write that matters most.
    await mustDeny(
      'the locked user deleting their own lockdown',
      deleteDoc(doc(authed(LOCKED_UID), 'lockdowns', `user--${LOCKED_UID}`)),
    )
    // Positive control: the same super-staff token IS otherwise the loosest
    // in the file — it writes org keys denied to everyone else. So the
    // denials above are this block's `write: false`, not a broken rules
    // file. (`enabledPlugins`, not `suspendedAt`: AGL-1517 made the
    // suspended* family Admin-SDK-only for super staff too.)
    await mustAllow(
      'the same super-staff token updating an org doc',
      updateDoc(doc(superStaffDb, 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
  })
})

/**
 * The host half of AGL-1501 (AGL-1507): `suspendedAt`/`suspendedReasonCode`/
 * `suspendedMessage`/`suspendedUntilMs` on `hosts/{hostId}` are the STAFF
 * takedown — the site 503s while they are set. They ride the same update key
 * diff as `subdomain`/`cname`, and the point is the asymmetry: `maintenance`
 * is the customer's own switch and stays editor-writable, while a security
 * takedown the site's own editors could clear from the client SDK would not
 * be a takedown.
 */
describe('the staff host takedown keys are not the site\'s to write (AGL-1507)', () => {
  const TAKEDOWN_KEYS = [
    'suspendedAt', 'suspendedReasonCode', 'suspendedMessage', 'suspendedUntilMs',
  ]

  it('editors and site admins cannot set any suspended* key', async () => {
    for (const uid of [EDITOR, OWNER]) {
      for (const key of TAKEDOWN_KEYS) {
        await mustDeny(
          `hosts/{hostId} { ${key} } as ${uid}`,
          updateDoc(doc(authed(uid), 'hosts', HOST), {
            [key]: key === 'suspendedAt' ? new Date() : 'self-served',
          }),
        )
      }
    }
  })

  it('a locked-down site cannot be unlocked from the client', async () => {
    // Staff locked the host; the org itself is NOT suspended, so the
    // editor's update branch is otherwise wide open — the key diff is the
    // only thing standing between the site and a self-lift.
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'hosts', HOST), {
        suspendedAt: new Date(), suspendedReasonCode: 'abuse',
        suspendedMessage: 'Suspended pending review',
        suspendedUntilMs: Date.now() + 86_400_000,
      })
    })
    for (const uid of [EDITOR, OWNER]) {
      for (const key of TAKEDOWN_KEYS) {
        await mustDeny(
          `clearing hosts/{hostId}.${key} as ${uid}`,
          updateDoc(doc(authed(uid), 'hosts', HOST), { [key]: deleteField() }),
        )
      }
      // Shortening the sentence is the same lift by another value.
      await mustDeny(
        `lowering suspendedUntilMs as ${uid}`,
        updateDoc(doc(authed(uid), 'hosts', HOST), { suspendedUntilMs: 1 }),
      )
    }
    // Bundling a takedown key with a legitimate one must not launder it
    // through — `hasAny` bites on the whole diff.
    await mustDeny(
      'smuggling suspendedAt inside a rename',
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        displayName: 'Innocent', suspendedAt: deleteField(),
      }),
    )
    // This assertion used to read the other way round, and it was the clearest
    // statement of AGL-1965 anywhere in the repo. It said: "the customer's own
    // maintenance switch still works on a host under staff takedown, and so
    // does ORDINARY AUTHORING — the deny is four keys, not the document."
    //
    // That was true and it was the defect. Freezing four keys stops a site
    // lifting its own takedown; it does not stop the site being republished
    // through one, because `screens` is not among the four and publishing is a
    // client write. A suspended phishing site kept accepting content.
    //
    // The document is now the unit, at host scope as it has always been at org
    // scope (`hostWritesFrozen`), so the customer's own switch goes with it —
    // which is the correct reading of a takedown, and is exactly what a
    // suspended ORG's editors have got since AGL-238.
    //
    // The consequence for the loop above is worth saying out loud: while the
    // flags are SET, those denies now have two causes, so the key list alone
    // is no longer what they prove. The key list keeps an independent proof in
    // `editors and site admins cannot set any suspended* key`, which runs
    // against a HEALTHY host where the freeze is not firing.
    await mustDeny(
      'the editor flipping maintenance on a taken-down host',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { maintenance: true }),
    )
    // And staff still write the family — the lift path support actually uses.
    await mustAllow(
      'staff clearing the takedown',
      updateDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST), {
        suspendedAt: deleteField(), suspendedReasonCode: deleteField(),
        suspendedMessage: deleteField(), suspendedUntilMs: deleteField(),
      }),
    )
  })
})

/**
 * AGL-1965: a host-scope takedown that actually takes the site down.
 *
 * The block above proves an editor cannot rewrite the takedown FLAGS. This one
 * proves the takedown MEANS something — which, until `hostSuspended()` existed,
 * it did not for the client SDK. `hosts/{hostId}.suspendedAt` was read by the
 * tenant middleware and by 38 `lockdownRefusal()` sites in Admin-SDK routes,
 * and by no rule at all; publishing is a direct browser write, and `screens`
 * is deliberately not a frozen key. So the site staff had just suspended kept
 * accepting content, and could be republished through the lock.
 *
 * Both directions, because the failure mode of a fix here is worse than the
 * hole: a rule that froze every host would take publishing away from every
 * paying customer, and would pass any test that only checked the deny.
 *
 * The fixture is the sharp case on purpose — LOCKED_HOST sits in the HEALTHY
 * org, so nothing `hostOrgSuspended()` reads is set, and `suspendedMode` is
 * `read-only`, so the site is still serving and rules are the only refusal
 * left in the stack.
 */
describe('a host-scope suspension freezes the client SDK too (AGL-1965)', () => {
  const editor = () => authed(EDITOR)
  const admin = () => authed(OWNER)
  const staff = () => authed(STAFF, { staff: true })

  it('the org arm is genuinely not what is doing the work', async () => {
    // If this ever fails, every deny below could be the AGL-238 org rule
    // firing and the new host arm could be absent — the green that proves
    // nothing. Read with rules ON, as the editor: reads stay open under
    // suspension by design.
    const org = await getDoc(doc(editor(), 'orgs', ORG))
    assert.equal(
      org.data().suspendedAt ?? null, null,
      'LOCKED_HOST\'s org is suspended in the fixture — the host-scope ' +
        'assertions below would pass on the org rule alone.',
    )
    const host = await getDoc(doc(editor(), 'hosts', LOCKED_HOST))
    assert.ok(
      host.data().suspendedAt != null,
      'LOCKED_HOST is not suspended in the fixture — nothing is under test.',
    )
  })

  it('the republish path is refused end to end', async () => {
    // The two writes `screen-publishing.ts` makes, which are the whole
    // point: the screen document and the host doc\'s live `screens` map.
    await mustDeny(
      'an editor republishing a screen on a suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST, 'screens', 's1'), {
        name: 'Your bank needs you to sign in',
      }),
    )
    await mustDeny(
      'an editor moving the live `screens` pointer on a suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST), {
        screens: { s1: { versionId: 'v2', path: '/' } },
      }),
    )
    // And the canvas save underneath it — a merge-set on an existing version
    // doc, which is a rules UPDATE and stays open on every plan (AGL-1369).
    // Open on every plan is not open under suspension.
    await mustDeny(
      'an editor saving canvas nodes on a suspended site',
      setDoc(
        doc(editor(), 'hosts', LOCKED_HOST, 'screens', 's1', 'versions', 'v1'),
        { nodes: { root: { text: 'phish' } } },
        { merge: true },
      ),
    )
  })

  it('every other client write path on the site is refused as well', async () => {
    await mustDeny(
      'a catch-all subcollection update on a suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST, 'variables', 'var-1'), {
        value: '2',
      }),
    )
    // NOT `variables` for the create arm: `variables` is on the catch-all's
    // create exclusion list already (AGL-473), so a deny there would have
    // passed before this change too and proved nothing about it. `mediaFolders`
    // is on none of the three lists, so the freeze is the only thing that can
    // refuse it.
    await mustDeny(
      'a catch-all subcollection create on a suspended site',
      setDoc(doc(editor(), 'hosts', LOCKED_HOST, 'mediaFolders', 'f1'), {
        name: 'Uploads',
      }),
    )
    await mustDeny(
      'a catch-all subcollection delete on a suspended site',
      deleteDoc(doc(editor(), 'hosts', LOCKED_HOST, 'variables', 'var-1')),
    )
    // `collections/{id}` and its `entries` have dedicated blocks that re-grant
    // past the catch-all — sibling matches are OR'd and the looser one wins,
    // so a fix applied only to the catch-all would leave these two open.
    await mustDeny(
      'a collection update on a suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST, 'collections', 'col-1'), {
        categories: ['x'],
      }),
    )
    await mustDeny(
      'a collection entry create on a suspended site',
      setDoc(
        doc(editor(), 'hosts', LOCKED_HOST, 'collections', 'col-1', 'entries', 'e2'),
        { title: 'Free gift card' },
      ),
    )
    await mustDeny(
      'a template update on a suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST, 'templates', 'tpl-1'), {
        displayName: 'Renamed',
      }),
    )
    await mustDeny(
      'a screen delete on a suspended site',
      deleteDoc(doc(editor(), 'hosts', LOCKED_HOST, 'screens', 's1')),
    )
    // Deleting the site is not a way out of a takedown: it would destroy the
    // evidence staff suspended it to look at, and free the subdomain to be
    // claimed again.
    await mustDeny(
      'a site admin deleting the suspended host outright',
      deleteDoc(doc(admin(), 'hosts', LOCKED_HOST)),
    )
  })

  it('a normal site publishes exactly as before — the fix breaks nothing', async () => {
    // The negative control for the whole change. Every deny above would also
    // pass with `hostWritesFrozen()` hard-wired to true, which would take
    // publishing away from every paying customer.
    await mustAllow(
      'an editor updating a screen on a healthy site',
      updateDoc(doc(editor(), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home v2',
      }),
    )
    await mustAllow(
      'an editor moving the live `screens` pointer on a healthy site',
      updateDoc(doc(editor(), 'hosts', HOST), {
        screens: { 'screen-1': { versionId: 'v1', path: '/' } },
      }),
    )
    await mustAllow(
      'an editor saving canvas nodes on a healthy site',
      setDoc(
        doc(editor(), 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'),
        { nodes: { root: { text: 'hello' } } },
        { merge: true },
      ),
    )
    await mustAllow(
      'an editor updating a variable on a healthy site',
      updateDoc(doc(editor(), 'hosts', HOST, 'variables', 'var-1'), { value: '2' }),
    )
    // The create twin of the deny above, on the same collection, so the pair
    // isolates the freeze rather than the AGL-473 create exclusions.
    await mustAllow(
      'an editor creating a media folder on a healthy site',
      setDoc(doc(editor(), 'hosts', HOST, 'mediaFolders', 'f1'), {
        name: 'Uploads',
      }),
    )
    await mustAllow(
      'an editor creating a collection entry on a healthy site',
      setDoc(
        doc(editor(), 'hosts', HOST, 'collections', 'col-h', 'entries', 'e1'),
        { title: 'Post' },
      ),
    )
    await mustAllow(
      'a site admin deleting a screen on a healthy site',
      deleteDoc(doc(admin(), 'hosts', HOST, 'screens', 'screen-1')),
    )
  })

  it('staff still work inside the lock — the un-panic invariant', async () => {
    // Support has to be able to act on a suspended site, and to lift the
    // suspension. A freeze that caught staff would make the lock one-way.
    await mustAllow(
      'staff editing a screen on a suspended site',
      updateDoc(doc(staff(), 'hosts', LOCKED_HOST, 'screens', 's1'), {
        name: 'Removed by Aglyn',
      }),
    )
    await mustAllow(
      'staff clearing the host-scope takedown',
      updateDoc(doc(staff(), 'hosts', LOCKED_HOST), {
        suspendedAt: deleteField(), suspendedReasonCode: deleteField(),
        suspendedMessage: deleteField(), suspendedMode: deleteField(),
      }),
    )
  })

  it('the site cannot shorten or lift its own host-scope takedown', async () => {
    // Restating AGL-1507's guarantee against THIS fixture, because it is what
    // stops the freeze being a one-line bypass: an editor who could clear
    // `suspendedAt` would unfreeze everything the block above just denied.
    for (const uid of [OWNER, EDITOR]) {
      await mustDeny(
        `${uid} clearing suspendedAt on their own suspended site`,
        updateDoc(doc(authed(uid), 'hosts', LOCKED_HOST), {
          suspendedAt: deleteField(),
        }),
      )
      await mustDeny(
        `${uid} shortening their own suspension to expire immediately`,
        updateDoc(doc(authed(uid), 'hosts', LOCKED_HOST), {
          suspendedUntilMs: 1,
        }),
      )
    }
  })
})

/**
 * AGL-1981: a TIMED suspension expires in rules, at BOTH scopes.
 *
 * Until this, `orgSuspendedById()` and `hostSuspended()` both decided
 * suspension on `suspendedAt != null` alone. The server-side stack has read
 * `suspendedUntilMs` since AGL-1512 — `isLockdownActive()` treats a passed
 * expiry as inactive, the tenant middleware stops rewriting to `/api/locked`,
 * and the 38 `lockdownRefusal()` sites stop refusing. So when the clock
 * passed, the site came back and the client SDK stayed frozen forever.
 * Publishing is a client write, so that is the whole authoring experience,
 * with no error that explains it.
 *
 * Four cases, and all four are load-bearing:
 *
 *  - **expired → writes land**, at host scope and at org scope. This is the
 *    bug. Both, because a fix to one arm leaves the file saying two different
 *    things about one field, which is precisely why AGL-1965 declined to fix
 *    the host arm alone.
 *  - **live timed → writes still refused**, at both scopes. Without this pair
 *    the two above pass on `hostWritesFrozen()` hard-wired to false — the
 *    green that proves the takedown was deleted rather than made temporal.
 *
 * `LOCKED_HOST`'s indefinite suspension keeps its own block above, which is
 * the third case: a MISSING expiry must never read as an expired one, or the
 * fix lifts every open takedown on the platform.
 */
describe('a timed suspension expires in rules, at both scopes (AGL-1981)', () => {
  const editor = () => authed(EDITOR)

  it('the fixtures differ only in the expiry, and nothing else is deciding', async () => {
    // The AGL-1965 lesson restated: if the two hosts differed in some OTHER
    // way — a missing `memberRoles`, a suspended org underneath — every
    // assertion below would pass for a reason that has nothing to do with
    // `suspendedUntilMs`, and the fix could be absent.
    const staffDb = authed(STAFF, { staff: true })
    const expired = await getDoc(doc(staffDb, 'hosts', EXPIRED_HOST))
    const timed = await getDoc(doc(staffDb, 'hosts', TIMED_HOST))
    for (const [label, snapshot] of [['expired', expired], ['timed', timed]]) {
      assert.ok(
        snapshot.data().suspendedAt != null,
        `${label} host is not suspended in the fixture — nothing is under test.`,
      )
      assert.equal(
        snapshot.data().orgId, ORG,
        `${label} host is not in the healthy org — the org arm could be ` +
          'doing the work.',
      )
      assert.equal(
        snapshot.data().memberRoles?.[EDITOR], 'editor',
        `${label} host does not grant the editor a role — a deny would be ` +
          'the membership check, not the freeze.',
      )
    }
    assert.ok(
      expired.data().suspendedUntilMs < Date.now(),
      'the expired fixture has not expired.',
    )
    assert.ok(
      timed.data().suspendedUntilMs > Date.now(),
      'the timed fixture has already expired — it is a second copy of the ' +
        'expired one and proves nothing.',
    )
    // And the org arm's pair, same reasoning.
    const expiredOrg = await getDoc(doc(staffDb, 'orgs', EXPIRED_ORG))
    const timedOrg = await getDoc(doc(staffDb, 'orgs', TIMED_ORG))
    assert.ok(
      expiredOrg.data().suspendedAt != null &&
        expiredOrg.data().suspendedUntilMs < Date.now(),
      'the expired ORG fixture is not a suspension that has expired.',
    )
    assert.ok(
      timedOrg.data().suspendedAt != null &&
        timedOrg.data().suspendedUntilMs > Date.now(),
      'the timed ORG fixture is not a suspension that is still running.',
    )
  })

  it('host scope: an expired suspension no longer blocks publishing', async () => {
    // The three writes `screen-publishing.ts` makes. This is the customer
    // getting their site back and being able to work on it, which is the
    // whole point of a TIMED suspension as opposed to an open-ended one.
    await mustAllow(
      'an editor republishing a screen after the suspension expired',
      updateDoc(doc(editor(), 'hosts', EXPIRED_HOST, 'screens', 's1'), {
        name: 'Home, restored',
      }),
    )
    await mustAllow(
      'an editor moving the live `screens` pointer after expiry',
      updateDoc(doc(editor(), 'hosts', EXPIRED_HOST), {
        screens: { s1: { versionId: 'v1', path: '/' } },
      }),
    )
    await mustAllow(
      'an editor saving canvas nodes after expiry',
      setDoc(
        doc(editor(), 'hosts', EXPIRED_HOST, 'screens', 's1', 'versions', 'v1'),
        { nodes: { root: { text: 'mine again' } } },
        { merge: true },
      ),
    )
    // A catch-all path too: the freeze reaches every subcollection, so the
    // thaw has to as well, or the site comes back half-editable.
    await mustAllow(
      'an editor creating a media folder after expiry',
      setDoc(doc(editor(), 'hosts', EXPIRED_HOST, 'mediaFolders', 'f1'), {
        name: 'Uploads',
      }),
    )
  })

  it('host scope: a suspension still running blocks it', async () => {
    await mustDeny(
      'an editor republishing a screen while the clock is still running',
      updateDoc(doc(editor(), 'hosts', TIMED_HOST, 'screens', 's1'), {
        name: 'Your bank needs you to sign in',
      }),
    )
    await mustDeny(
      'an editor moving the live `screens` pointer while still suspended',
      updateDoc(doc(editor(), 'hosts', TIMED_HOST), {
        screens: { s1: { versionId: 'v2', path: '/' } },
      }),
    )
    await mustDeny(
      'an editor saving canvas nodes while still suspended',
      setDoc(
        doc(editor(), 'hosts', TIMED_HOST, 'screens', 's1', 'versions', 'v1'),
        { nodes: { root: { text: 'phish' } } },
        { merge: true },
      ),
    )
    await mustDeny(
      'an editor creating a media folder while still suspended',
      setDoc(doc(editor(), 'hosts', TIMED_HOST, 'mediaFolders', 'f1'), {
        name: 'Uploads',
      }),
    )
  })

  it('org scope: an expired suspension no longer blocks its hosts', async () => {
    await mustAllow(
      'an editor publishing on a host whose ORG suspension expired',
      updateDoc(doc(editor(), 'hosts', EXPIRED_ORG_HOST, 'screens', 's1'), {
        name: 'Home, restored',
      }),
    )
    await mustAllow(
      'an editor renaming a host whose ORG suspension expired',
      updateDoc(doc(editor(), 'hosts', EXPIRED_ORG_HOST), {
        displayName: 'Back in business',
      }),
    )
  })

  it('org scope: a suspension still running blocks its hosts', async () => {
    await mustDeny(
      'an editor publishing while the ORG clock is still running',
      updateDoc(doc(editor(), 'hosts', TIMED_ORG_HOST, 'screens', 's1'), {
        name: 'Still phishing',
      }),
    )
    await mustDeny(
      'an editor renaming a host while its ORG is still suspended',
      updateDoc(doc(editor(), 'hosts', TIMED_ORG_HOST), {
        displayName: 'Renamed under lock',
      }),
    )
  })

  it('an INDEFINITE suspension is untouched by the expiry arithmetic', async () => {
    // The negative control for the fix's own failure mode. `LOCKED_HOST` has
    // no `suspendedUntilMs` at all, and every open-ended takedown on the
    // platform looks like it. A helper that read a missing expiry as a passed
    // one — `data.get('suspendedUntilMs', 0) > now` is exactly that bug —
    // would lift the lot, and would pass all four assertions above.
    const staffDb = authed(STAFF, { staff: true })
    const locked = await getDoc(doc(staffDb, 'hosts', LOCKED_HOST))
    assert.equal(
      locked.data().suspendedUntilMs ?? null, null,
      'LOCKED_HOST has grown an expiry — it is no longer the indefinite case.',
    )
    await mustDeny(
      'an editor publishing on an indefinitely suspended site',
      updateDoc(doc(editor(), 'hosts', LOCKED_HOST, 'screens', 's1'), {
        name: 'Never expires',
      }),
    )
    // And its org twin: SUSPENDED_ORG carries no expiry either.
    await mustDeny(
      'an editor publishing under an indefinite ORG suspension',
      updateDoc(doc(editor(), 'hosts', SUSPENDED_HOST, 'screens', 's1'), {
        name: 'Never expires',
      }),
    )
  })

  it('a malformed expiry fails CLOSED', async () => {
    // `suspendedUntilMs` is Admin-SDK-only, so a non-numeric value can only
    // arrive by our own bug — but the direction of that bug matters. A string
    // where a number belongs must leave the takedown standing, never lift it.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', TIMED_HOST),
        { suspendedUntilMs: 'next tuesday' },
        { merge: true },
      )
    })
    await mustDeny(
      'an editor publishing on a site whose expiry is unreadable',
      updateDoc(doc(editor(), 'hosts', TIMED_HOST, 'screens', 's1'), {
        name: 'Slipped through',
      }),
    )
  })

  it('the site still cannot buy its own thaw', async () => {
    // The bypass this change would open if the key deny-list ever slipped:
    // once rules read `suspendedUntilMs`, writing it IS lifting the
    // suspension. AGL-1507 already froze the key; this restates it against
    // the fixture where it now has teeth, so the two can never drift apart.
    for (const uid of [OWNER, EDITOR]) {
      await mustDeny(
        `${uid} back-dating suspendedUntilMs to thaw their own site`,
        updateDoc(doc(authed(uid), 'hosts', TIMED_HOST), {
          suspendedUntilMs: Date.now() - AN_HOUR,
        }),
      )
    }
  })
})

/**
 * The org half of AGL-1501 (AGL-1507): `suspendedReasonCode`/
 * `suspendedMessage`/`suspendedUntilMs` joined `suspendedAt` on BOTH deny
 * branches of the org update rule. The manager branch is already swept by the
 * AGL-1355 parsed-list loop above, so what this adds is (a) the floor — the
 * three names must stay ON the parsed list, so deleting one from the rules
 * goes red by name here rather than silently shrinking the loop — and (b) the
 * billing-staff branch, which the parser does not read.
 */
describe('the org suspended* additions are on both deny branches (AGL-1507)', () => {
  const NEW_ORG_KEYS = ['suspendedReasonCode', 'suspendedMessage', 'suspendedUntilMs']

  it('the three new keys are on the parsed manager deny list', () => {
    for (const key of NEW_ORG_KEYS) {
      assert.ok(
        ORG_ADMIN_DENIED.includes(key),
        `\`${key}\` fell off the canManageOrg() deny list — an org admin ` +
          `with the client SDK could now ${key === 'suspendedUntilMs'
            ? 'shorten their own suspension'
            : 'rewrite their own suspension record'} (AGL-1501).`,
      )
    }
  })

  it('billing staff cannot write the new keys; neither can super staff (AGL-1517)', async () => {
    const billingStaffDb = authed(STAFF, { staff: true, staffRole: 'billing' })
    for (const key of NEW_ORG_KEYS) {
      await mustDeny(
        `orgs/{orgId} { ${key} } as billing staff`,
        updateDoc(doc(billingStaffDb, 'orgs', ORG), {
          [key]: key === 'suspendedUntilMs' ? 1 : 'laundered',
        }),
      )
    }
    // Bundled with a write billing staff legitimately makes. The carrier used
    // to be `plan`, which AGL-1795 denies to every client — so this case would
    // now pass even with `suspendedUntilMs` off the list, proving nothing about
    // the key it names. The carrier has to be a key that still LANDS on its
    // own, or the smuggling test tests the carrier.
    await mustDeny(
      'smuggling suspendedUntilMs inside an org rename',
      updateDoc(doc(billingStaffDb, 'orgs', ORG), {
        name: 'Acme Renamed', suspendedUntilMs: 1,
      }),
    )
    // Positive control: the deny is the key diff, not the branch. Same move as
    // above — `plan` was this control until AGL-1795 closed it client-side.
    await mustAllow(
      'billing staff still renaming the org',
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { name: 'Acme Billing' }),
    )
    // The super-staff mustAllow that used to sit here was AGL-1507's
    // documented positive control. AGL-1517 flipped it: with the last client
    // writer gone (AGL-1505), a super-staff client write of the family is a
    // flag without the fan-out, so the full deny matrix lives in the
    // describe below.
    await mustDeny(
      'super staff writing the suspension record from the client',
      updateDoc(doc(authed(STAFF, { staff: true, staffRole: 'super' }), 'orgs', ORG), {
        suspendedReasonCode: 'abuse', suspendedMessage: 'Suspended',
        suspendedUntilMs: Date.now() + 86_400_000,
      }),
    )
  })

  it('a manager cannot write them, alone or bundled with a legit key', async () => {
    for (const key of NEW_ORG_KEYS) {
      await mustDeny(
        `orgs/{orgId} { ${key} } as the org owner`,
        updateDoc(doc(authed(OWNER), 'orgs', ORG), {
          [key]: key === 'suspendedUntilMs' ? 1 : 'self-served',
        }),
      )
    }
    await mustDeny(
      'smuggling suspendedMessage inside a rename',
      updateDoc(doc(authed(OWNER), 'orgs', ORG), {
        name: 'Innocent', suspendedMessage: 'all clear',
      }),
    )
    // The branch itself still works.
    await mustAllow(
      'the owner still renaming the org',
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Again' }),
    )
  })
})

/**
 * AGL-1517: the org `suspended*` family is Admin-SDK-only for EVERY client —
 * super staff included. AGL-1505 removed the last legitimate client writer
 * (the legacy staff toggle now POSTs /api/admin/lockdown), so a super-staff
 * client write of these keys can only be the AGL-1505 bug reborn: the flag
 * set with none of the four effects that make it real (the `orgSuspended`
 * member projection fan-out, token revocation, tenant ISR eviction, the
 * audit row). The super branch used to bypass every key diff; it now carries
 * its own `hasAny` over the five-key family, with `erasureRequestedAt`
 * deliberately left OFF it — the erasure toggle still writes that key
 * client-side as super staff.
 */
describe('the org suspended* family is Admin-SDK-only — even for super staff (AGL-1517)', () => {
  const ORG_SUSPENSION_KEYS = [
    'suspendedAt', 'suspendedReason', 'suspendedReasonCode',
    'suspendedMessage', 'suspendedUntilMs',
  ]

  it('super staff cannot set, clear, shorten or smuggle any suspended* key', async () => {
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    for (const key of ORG_SUSPENSION_KEYS) {
      await mustDeny(
        `orgs/{orgId} { ${key} } as super staff`,
        updateDoc(doc(superStaffDb, 'orgs', ORG), {
          [key]: key === 'suspendedAt'
            ? new Date()
            : key === 'suspendedUntilMs' ? Date.now() + 86_400_000 : 'bare-flag',
        }),
      )
    }
    // Now suspend the org the real way (Admin SDK) and prove the client
    // cannot LIFT it either — clearing a key, shortening the sentence, or
    // laundering a clear inside a key the super branch does allow. `hasAny`
    // bites on the whole diff, so the bundle fails with the smuggled key.
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        suspendedAt: new Date(), suspendedReason: 'manual',
        suspendedReasonCode: 'manual', suspendedMessage: 'Suspended',
        suspendedUntilMs: Date.now() + 86_400_000,
      })
    })
    for (const key of ORG_SUSPENSION_KEYS) {
      await mustDeny(
        `clearing orgs/{orgId}.${key} as super staff`,
        updateDoc(doc(superStaffDb, 'orgs', ORG), { [key]: deleteField() }),
      )
    }
    await mustDeny(
      'super staff lowering suspendedUntilMs',
      updateDoc(doc(superStaffDb, 'orgs', ORG), { suspendedUntilMs: 1 }),
    )
    await mustDeny(
      'smuggling the lift inside an enabledPlugins write',
      updateDoc(doc(superStaffDb, 'orgs', ORG), {
        enabledPlugins: ['paid'], suspendedAt: deleteField(),
      }),
    )
  })

  it('the carve-outs hold: erasureRequestedAt, the super branch, the Admin SDK', async () => {
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    // `erasureRequestedAt` is deliberately NOT on the super deny list — the
    // erasure toggle still writes it client-side (AGL-1517's one carve-out).
    await mustAllow(
      'super staff writing erasureRequestedAt from the client',
      updateDoc(doc(superStaffDb, 'orgs', ORG), {
        erasureRequestedAt: new Date(),
      }),
    )
    // The branch itself still works — the deny is five keys, not the token.
    await mustAllow(
      'super staff still writing an org key denied to everyone else',
      updateDoc(doc(superStaffDb, 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
    // Positive control for the ONLY remaining writer: /api/admin/lockdown
    // goes through the Admin SDK, which rules never applied to —
    // `withSecurityRulesDisabled` is that path in the emulator. The family
    // lands, and a member still reads the suspension the tenant runtime
    // renders from.
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        suspendedAt: new Date(), suspendedReason: 'security',
        suspendedReasonCode: 'security', suspendedMessage: 'Locked',
        suspendedUntilMs: Date.now() + 86_400_000,
      })
    })
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.equal(snapshot.data().suspendedReasonCode, 'security')
  })
})

/**
 * AGL-1795: `plan`, `entitlements` and `releaseFlags` are Admin-SDK-only for
 * EVERY client, staff included.
 *
 * AGL-1786 moved the staff override to POST /api/admin/org-override, which
 * validates the reason with `normalizeOrgOverrideReason` and commits the org
 * document and its `adminAudit` row with the Admin SDK in one batch. That made
 * it the last client writer of these three keys — what is left on this document
 * from a browser is the org rename (`canManageOrg()`, which already excluded
 * them) and the erasure toggle's `erasureRequestedAt`.
 *
 * So this narrowing is what turns the reason gate into a boundary. It has to
 * be, because the rules cannot police the reason itself: `adminAudit` is
 * `allow read, create: if isStaff()` and validates no shape at all, so a
 * `reason` predicate on `org.override` rows would imply the other actions'
 * rows are validated when they are not (AGL-1652 declined it for exactly that,
 * and the judgement stands). Closing the WRITE is the thing rules can say
 * honestly. A staff session with the client SDK can still create a junk audit
 * row; what it can no longer do is change a fee percentage.
 *
 * THE ROLE SPLIT IS GONE FROM HERE, and that is the finding rather than an
 * oversight. It was `releaseFlags` super-only, `plan`/`entitlements` open to
 * billing staff. Once both branches deny all three there is no split left for a
 * rule to draw — it moved into the route, which re-checks the role server-side
 * because the Admin SDK bypasses rules. The distinction the route draws IS
 * expressible here (`affectedKeys()` is value-based, which the "named but
 * unchanged" case below proves, and that is precisely "the change, not the
 * payload"); it is simply vacuous once neither branch may write any of them.
 *
 * The sequencing was the whole risk and it is spent: the route reached
 * production in 72869652f before these rules narrow. A console tab still
 * serving the pre-AGL-1786 bundle is the one thing this refuses with no
 * fallback.
 */
describe('plan/entitlements/releaseFlags are Admin-SDK-only — even for staff (AGL-1795)', () => {
  const OVERRIDE_KEYS = ['plan', 'entitlements', 'releaseFlags']
  // A missing `staffRole` reads as 'super' (the AGL-206 migration path), so
  // pre-RBAC staff are a third principal and not a rounding error.
  const PRINCIPALS = [
    ['super staff', { staff: true, staffRole: 'super' }],
    ['billing staff', { staff: true, staffRole: 'billing' }],
    ['pre-RBAC staff (no staffRole claim)', { staff: true }],
  ]
  const staffDb = (tokens) => authed(STAFF, tokens)

  /** A real change for each key — the shapes the override dialog writes. */
  const changed = (key) =>
    key === 'plan'
      ? 'enterprise'
      : key === 'entitlements'
        ? { maxSeats: 500, transactionFeePhysicalPct: 0.5 }
        : { newCheckout: true }
  /** Byte-identical to what the seed below stores. */
  const unchanged = (key) =>
    key === 'plan'
      ? 'pro'
      : key === 'entitlements'
        ? { maxSeats: 10 }
        : { newCheckout: false }

  beforeEach(async () => {
    // The shared seed carries `plan` only. The other two must EXIST, or the
    // "named but unchanged" case degenerates into an ADD — which really is a
    // change, and would pass while proving the opposite of what it claims.
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        entitlements: unchanged('entitlements'),
        releaseFlags: unchanged('releaseFlags'),
      })
    })
  })

  it('refuses a staff client write of each key, in every shape, for every role', async () => {
    for (const [who, tokens] of PRINCIPALS) {
      const db = staffDb(tokens)
      for (const key of OVERRIDE_KEYS) {
        await mustDeny(
          `${who} setting orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }),
        )
        // Clearing is a change too — this is how an override is REMOVED, and
        // a deny-list that only caught additions would leave the removal open.
        await mustDeny(
          `${who} clearing orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: deleteField() }),
        )
        // The merge-set is the exact shape the pre-AGL-1786 console used, and
        // the shape a staff session would reach for from a browser console.
        await mustDeny(
          `${who} merge-setting orgs/{orgId}.${key}`,
          setDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }, { merge: true }),
        )
        // Smuggled inside a write the branch does allow. `hasAny` bites on the
        // whole diff, so the bundle has to fail with the smuggled key.
        await mustDeny(
          `${who} smuggling ${key} inside an org rename`,
          updateDoc(doc(db, 'orgs', ORG), {
            name: 'Innocent Rename', [key]: changed(key),
          }),
        )
      }
      // A nested field path is the same top-level diff and must not slip past.
      await mustDeny(
        `${who} setting orgs/{orgId}.entitlements.maxSeats by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'entitlements.maxSeats': 5000 }),
      )
      await mustDeny(
        `${who} forcing one release flag by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'releaseFlags.newCheckout': true }),
      )
      // All three at once is what the override dialog actually sent.
      await mustDeny(
        `${who} writing the whole override the dialog used to send`,
        setDoc(
          doc(db, 'orgs', ORG),
          {
            plan: changed('plan'),
            entitlements: changed('entitlements'),
            releaseFlags: changed('releaseFlags'),
          },
          { merge: true },
        ),
      )
    }
  })

  it('refuses the override even when a well-formed audit row rides with it', async () => {
    // The batch AGL-1784 built, with a reason AGL-1652 asked for. `adminAudit`
    // validates no shape, so the row is not what is being refused — and the
    // batch being atomic is what makes the refusal total. This is the case
    // that says the reason gate is now a boundary rather than a dialog: the
    // only way to write these keys is the route that mints the reason.
    const db = staffDb({ staff: true, staffRole: 'billing' })
    const batch = writeBatch(db)
    batch.set(
      doc(db, 'orgs', ORG),
      { entitlements: changed('entitlements') },
      { merge: true },
    )
    batch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.override',
      target: `orgs/${ORG}`,
      reason: 'enterprise deal',
      before: { entitlements: unchanged('entitlements') },
      after: { entitlements: changed('entitlements') },
      at: new Date(),
    })
    await mustDeny('a client override batch carrying its own reason', batch.commit())
    // And nothing landed — the atomic refusal, not just a refused first write.
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.deepEqual(snapshot.data().entitlements, unchanged('entitlements'))
  })

  it('naming a key without CHANGING it is still not a change — affectedKeys is value-based', async () => {
    // The premise AGL-1786 enforced the route's role split on: every override
    // write NAMES `releaseFlags`, and refusing billing staff for naming it
    // unchanged would take away quota overrides they can make today. That
    // reasoning is only sound if `diff().affectedKeys()` compares VALUES, not
    // the payload's key set. It does — asserted rather than assumed, because
    // if it did not, the route's gate would be refusing legitimate work.
    const db = staffDb({ staff: true, staffRole: 'billing' })
    await mustAllow(
      'billing staff renaming the org while re-sending all three keys unchanged',
      setDoc(
        doc(db, 'orgs', ORG),
        {
          name: 'Acme Renamed',
          plan: unchanged('plan'),
          entitlements: unchanged('entitlements'),
          releaseFlags: unchanged('releaseFlags'),
        },
        { merge: true },
      ),
    )
    // The twin: one value differs by one nested field and the same write is
    // refused. Without this, the case above would pass for a rule that had
    // simply stopped looking at the keys.
    await mustDeny(
      'the same write with ONE nested release flag flipped',
      setDoc(
        doc(db, 'orgs', ORG),
        {
          name: 'Acme Renamed',
          plan: unchanged('plan'),
          entitlements: unchanged('entitlements'),
          releaseFlags: { newCheckout: true },
        },
        { merge: true },
      ),
    )
  })

  it('the erasure batch — the last client writer of a staff key — still commits', async () => {
    // AGL-1786 deliberately left this a client `writeBatch`, so it is the
    // write this narrowing was most likely to break. It touches
    // `erasureRequestedAt`, which stays OFF the super branch's deny-list.
    const db = staffDb({ staff: true, staffRole: 'super' })
    const requestBatch = writeBatch(db)
    requestBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: new Date(), updatedAt: new Date() },
      { merge: true },
    )
    requestBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureRequested',
      target: `orgs/${ORG}`,
      before: { erasureRequested: false },
      after: { erasureRequested: true },
      at: new Date(),
    })
    await mustAllow(
      'the AGL-1784 erasure request batch as super staff',
      requestBatch.commit(),
    )
    // Cancelling clears the flag with deleteField(), a different diff shape.
    const cancelBatch = writeBatch(db)
    cancelBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: deleteField(), updatedAt: new Date() },
      { merge: true },
    )
    cancelBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureCanceled',
      target: `orgs/${ORG}`,
      before: { erasureRequested: true },
      after: { erasureRequested: false },
      at: new Date(),
    })
    await mustAllow(
      'the erasure batch cancelling the request',
      cancelBatch.commit(),
    )
  })

  it('both staff branches survive — the deny is three keys, not the token', async () => {
    await mustAllow(
      'super staff still writing an org key denied to everyone else',
      updateDoc(doc(staffDb({ staff: true, staffRole: 'super' }), 'orgs', ORG), {
        enabledPlugins: ['paid'],
      }),
    )
    await mustAllow(
      'billing staff still renaming the org',
      updateDoc(
        doc(staffDb({ staff: true, staffRole: 'billing' }), 'orgs', ORG),
        { name: 'Acme Billing' },
      ),
    )
    await mustAllow(
      'the org owner still renaming the org',
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Again' }),
    )
  })

  it('the route still does all of it — the Admin SDK is not subject to rules', async () => {
    // The positive control for what was refused above. A billing-staff quota
    // override and a super-staff release-flag flip did not stop being
    // possible; they stopped being possible FROM A CLIENT.
    // `withSecurityRulesDisabled` is /api/admin/org-override's path in the
    // emulator, batch and audit row and all.
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      const batch = writeBatch(db)
      batch.set(
        doc(db, 'orgs', ORG),
        {
          plan: changed('plan'),
          entitlements: changed('entitlements'),
          releaseFlags: changed('releaseFlags'),
        },
        { merge: true },
      )
      batch.set(doc(collection(db, 'adminAudit')), {
        actorUid: STAFF,
        action: 'org.override',
        target: `orgs/${ORG}`,
        reason: 'enterprise deal',
        at: new Date(),
      })
      await batch.commit()
    })
    // And a member still READS the override every console surface gates
    // features on — a narrowing that broke the read would break every site.
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.equal(snapshot.data().plan, 'enterprise')
    assert.equal(snapshot.data().entitlements.transactionFeePhysicalPct, 0.5)
    assert.equal(snapshot.data().releaseFlags.newCheckout, true)
  })
})

/**
 * AGL-1813: `discount`, `enterprise`, `brandingProfile` and `billingStatus`
 * are Admin-SDK-only for EVERY client, staff included.
 *
 * After AGL-1795 the billing-staff branch still allowed all four, and the
 * super branch allowed them too — keys an org ADMIN had been denied since
 * AGL-1354, for reasons that reach a staff browser console just as well: a
 * self-served `discount` or `enterprise` falsifies the MRR rollup, a
 * client-written `brandingProfile.customConsoleDomain` is a ROUTING input
 * (AGL-1099), and a hand-set `billingStatus` shows every member a dunning
 * state the webhook never derived. Doing any of it client-side writes no
 * `adminAudit` row.
 *
 * The AGL-1795 safety argument, re-established per key rather than assumed:
 *  - `discount` — written only by /api/admin/org-discount (apply/remove,
 *    audited) and the Stripe webhook's coupon mirror;
 *  - `enterprise` — NO in-product writer at all: the pre-AGL-1118 comped
 *    marker is only read (`isEnterpriseOrg`), and its one writer anywhere is
 *    the migrate-enterprise-plan.mjs Admin-SDK script;
 *  - `brandingProfile` — written only by /api/orgs/settings `update-branding`
 *    behind `checkEntitlement(org, 'whiteLabel')`;
 *  - `billingStatus` — stamped only by `writeOrgBilling`'s status mirror.
 * A fresh sweep for this issue confirmed the erasure batch is still the only
 * client Web SDK write to a top-level org document anywhere in the repo.
 */
describe('discount/enterprise/brandingProfile/billingStatus are Admin-SDK-only — even for staff (AGL-1813)', () => {
  const COMMERCIAL_KEYS = ['discount', 'enterprise', 'brandingProfile', 'billingStatus']
  // Same three principals as AGL-1795: a missing `staffRole` reads as super.
  const PRINCIPALS = [
    ['super staff', { staff: true, staffRole: 'super' }],
    ['billing staff', { staff: true, staffRole: 'billing' }],
    ['pre-RBAC staff (no staffRole claim)', { staff: true }],
  ]
  const staffDb = (tokens) => authed(STAFF, tokens)

  /** A real change for each key — the shapes the legitimate routes write. */
  const changed = (key) =>
    key === 'discount'
      ? { percentOff: 100, couponId: 'coupon_free' }
      : key === 'enterprise'
        ? true
        : key === 'brandingProfile'
          ? { productName: 'Acme Cloud', customConsoleDomain: 'app.acme.test' }
          : 'active'
  /** Byte-identical to what the seed below stores. */
  const unchanged = (key) =>
    key === 'discount'
      ? { percentOff: 20, couponId: 'coupon_std' }
      : key === 'enterprise'
        ? false
        : key === 'brandingProfile'
          ? { productName: 'Acme' }
          : 'past_due'

  beforeEach(async () => {
    // The shared seed carries none of the four. They must EXIST, or the
    // clearing case degenerates into a no-op diff (affectedKeys compares
    // VALUES, so deleting an absent key is not a change and would pass while
    // proving nothing).
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        discount: unchanged('discount'),
        enterprise: unchanged('enterprise'),
        brandingProfile: unchanged('brandingProfile'),
        billingStatus: unchanged('billingStatus'),
      })
    })
  })

  it('refuses a staff client write of each key, in every shape, for every role', async () => {
    for (const [who, tokens] of PRINCIPALS) {
      const db = staffDb(tokens)
      for (const key of COMMERCIAL_KEYS) {
        await mustDeny(
          `${who} setting orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }),
        )
        // Clearing is a change too — removing a discount or the comped
        // marker is exactly the write a staff session would reach for.
        await mustDeny(
          `${who} clearing orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: deleteField() }),
        )
        // The merge-set is the shape a browser console reaches for.
        await mustDeny(
          `${who} merge-setting orgs/{orgId}.${key}`,
          setDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }, { merge: true }),
        )
        // Smuggled inside a write the branch does allow — `hasAny` bites on
        // the whole diff, so the bundle must fail with the smuggled key.
        await mustDeny(
          `${who} smuggling ${key} inside an org rename`,
          updateDoc(doc(db, 'orgs', ORG), {
            name: 'Innocent Rename', [key]: changed(key),
          }),
        )
      }
      // A nested field path is the same top-level diff and must not slip
      // past — `customConsoleDomain` is the AGL-1099 routing input, and
      // `discount.percentOff` is the number the MRR rollup reads.
      await mustDeny(
        `${who} pointing brandingProfile.customConsoleDomain by field path`,
        updateDoc(doc(db, 'orgs', ORG), {
          'brandingProfile.customConsoleDomain': 'app.acme.test',
        }),
      )
      await mustDeny(
        `${who} deepening discount.percentOff by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'discount.percentOff': 100 }),
      )
    }
  })

  it('naming the four without CHANGING them is still not a change', async () => {
    // The AGL-1795 premise holds for this key family too: a client that
    // re-sends the whole org document unchanged (a naive save) is judged on
    // the DIFF, so denying the keys does not refuse it.
    const db = staffDb({ staff: true, staffRole: 'billing' })
    await mustAllow(
      'billing staff renaming the org while re-sending all four keys unchanged',
      setDoc(
        doc(db, 'orgs', ORG),
        {
          name: 'Acme Renamed',
          discount: unchanged('discount'),
          enterprise: unchanged('enterprise'),
          brandingProfile: unchanged('brandingProfile'),
          billingStatus: unchanged('billingStatus'),
        },
        { merge: true },
      ),
    )
    // The twin: one nested value differs and the same write is refused.
    await mustDeny(
      'the same write with ONE nested discount field changed',
      setDoc(
        doc(db, 'orgs', ORG),
        {
          name: 'Acme Renamed',
          discount: { percentOff: 100, couponId: 'coupon_std' },
          enterprise: unchanged('enterprise'),
          brandingProfile: unchanged('brandingProfile'),
          billingStatus: unchanged('billingStatus'),
        },
        { merge: true },
      ),
    )
  })

  it('both staff branches and the erasure batch survive the narrowing', async () => {
    // The deny is four keys, not the token: each branch keeps a write only
    // it can make (super: enabledPlugins; billing: the rename).
    await mustAllow(
      'super staff still writing an org key denied to everyone else',
      updateDoc(doc(staffDb({ staff: true, staffRole: 'super' }), 'orgs', ORG), {
        enabledPlugins: ['paid'],
      }),
    )
    await mustAllow(
      'billing staff still renaming the org',
      updateDoc(
        doc(staffDb({ staff: true, staffRole: 'billing' }), 'orgs', ORG),
        { name: 'Acme Billing' },
      ),
    )
    // The last legitimate client writer of a staff key, both directions —
    // the write every org-rule narrowing is most likely to break.
    const db = staffDb({ staff: true, staffRole: 'super' })
    const requestBatch = writeBatch(db)
    requestBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: new Date(), updatedAt: new Date() },
      { merge: true },
    )
    requestBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureRequested',
      target: `orgs/${ORG}`,
      before: { erasureRequested: false },
      after: { erasureRequested: true },
      at: new Date(),
    })
    await mustAllow(
      'the erasure request batch beside the AGL-1813 narrowing',
      requestBatch.commit(),
    )
    const cancelBatch = writeBatch(db)
    cancelBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: deleteField(), updatedAt: new Date() },
      { merge: true },
    )
    cancelBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureCanceled',
      target: `orgs/${ORG}`,
      before: { erasureRequested: true },
      after: { erasureRequested: false },
      at: new Date(),
    })
    await mustAllow(
      'the erasure batch cancelling the request',
      cancelBatch.commit(),
    )
  })

  it('the legitimate server paths still write, and members still read', async () => {
    // /api/admin/org-discount, the webhook mirror, `update-branding` and
    // `writeOrgBilling` all go through the Admin SDK, which rules never see —
    // `withSecurityRulesDisabled` is that path in the emulator.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'orgs', ORG),
        {
          discount: changed('discount'),
          brandingProfile: changed('brandingProfile'),
          billingStatus: changed('billingStatus'),
        },
        { merge: true },
      )
    })
    // A member still reads the branding the console chrome renders from and
    // the dunning banner's status string — the whole reason both live on the
    // member-readable org doc.
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.equal(snapshot.data().discount.percentOff, 100)
    assert.equal(snapshot.data().brandingProfile.productName, 'Acme Cloud')
    assert.equal(snapshot.data().billingStatus, 'active')
  })
})

/**
 * AGL-1824: the AGL-1028 vestigial billing trio (`seatAddons`,
 * `stripeCustomerId`, `subscription`) is Admin-SDK-only for EVERY client,
 * staff included — and the identity quartet (`sso`, `slug`, `ownerUid`,
 * `hosts`) is denied to the SUPER branch, the last branch allowing it.
 *
 * The trio is vestigial (the real copies live in `billing/stripe` since
 * AGL-1028) but NOT dead: `readOrgBilling` falls back to the org-doc fields
 * when the billing subdoc is missing, and `findOrgIdByStripeCustomer` falls
 * back to a `where('stripeCustomerId' == …)` query on `orgs` — so a
 * client-written `stripeCustomerId` on an org without a billing doc was an
 * input to webhook → org resolution.
 *
 * The AGL-1795 safety argument, re-established per key rather than assumed:
 *  - `seatAddons`/`stripeCustomerId`/`subscription` — written only by
 *    `writeOrgBilling` (Admin-SDK batch; `writeInline` defaults OFF and
 *    nothing passes it) and the backfill-org-billing.mjs /
 *    drop-inline-org-billing.mjs scripts. Both fallbacks are Admin-SDK
 *    READS, so the deny cannot break the healing path;
 *  - `sso` — written only by /api/orgs/sso behind the `ssoEnabled`
 *    entitlement (the AGL-1354 auth-routing analysis);
 *  - `slug` — written only by the organizations.ts create/rename
 *    transactions that keep the `orgSlugs` index true;
 *  - `ownerUid` — written only by org create and the ownership transfer in
 *    /api/orgs/settings;
 *  - `hosts` — written only by the host APIs and the erase path.
 * A fresh sweep for this issue confirmed the erasure batch is still the only
 * client Web SDK write to a top-level org document anywhere in the repo.
 */
describe('the vestigial billing trio and the identity quartet are Admin-SDK-only for staff (AGL-1824)', () => {
  const SEVEN_KEYS = [
    'seatAddons', 'stripeCustomerId', 'subscription',
    'sso', 'slug', 'ownerUid', 'hosts',
  ]
  // Same three principals as AGL-1795/1813: a missing `staffRole` reads as
  // super. The billing role was already denied the identity quartet
  // (AGL-1354) — it stays in the matrix so the four shapes below keep proving
  // that, while the trio and the super/pre-RBAC rows are the new fact.
  const PRINCIPALS = [
    ['super staff', { staff: true, staffRole: 'super' }],
    ['billing staff', { staff: true, staffRole: 'billing' }],
    ['pre-RBAC staff (no staffRole claim)', { staff: true }],
  ]
  const staffDb = (tokens) => authed(STAFF, tokens)

  /** A real change per key — the shapes the legitimate owners write. */
  const changed = (key) =>
    ({
      seatAddons: { sites: 25 },
      stripeCustomerId: 'cus_attacker',
      subscription: { status: 'active', priceId: 'price_enterprise' },
      sso: { tenantId: 'tenant-attacker', provider: 'saml.attacker' },
      slug: 'stolen',
      ownerUid: STAFF,
      hosts: { [HOST]: true, 'evil-host': true },
    })[key]
  /** Byte-identical to the seed (shared seed + the beforeEach below). */
  const unchanged = (key) =>
    ({
      seatAddons: { sites: 2 },
      stripeCustomerId: 'cus_acme',
      subscription: { status: 'past_due', priceId: 'price_pro' },
      sso: { tenantId: 'tenant-acme', provider: 'saml.acme' },
      slug: 'acme',
      ownerUid: OWNER,
      hosts: { [HOST]: true },
    })[key]

  beforeEach(async () => {
    // The shared seed carries `slug`/`ownerUid`/`hosts` but none of the trio
    // or `sso`. All seven must EXIST, or the clearing case degenerates into a
    // no-op diff (affectedKeys compares VALUES, so deleting an absent key is
    // not a change and would pass while proving nothing).
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'orgs', ORG), {
        seatAddons: unchanged('seatAddons'),
        stripeCustomerId: unchanged('stripeCustomerId'),
        subscription: unchanged('subscription'),
        sso: unchanged('sso'),
      })
    })
  })

  it('refuses a staff client write of each key, in every shape, for every role', async () => {
    for (const [who, tokens] of PRINCIPALS) {
      const db = staffDb(tokens)
      for (const key of SEVEN_KEYS) {
        await mustDeny(
          `${who} setting orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }),
        )
        // Clearing is a change too — and for `stripeCustomerId` it is the
        // write that would detach an org from its Stripe customer.
        await mustDeny(
          `${who} clearing orgs/{orgId}.${key}`,
          updateDoc(doc(db, 'orgs', ORG), { [key]: deleteField() }),
        )
        // The merge-set is the shape a browser console reaches for.
        await mustDeny(
          `${who} merge-setting orgs/{orgId}.${key}`,
          setDoc(doc(db, 'orgs', ORG), { [key]: changed(key) }, { merge: true }),
        )
        // Smuggled inside a write the branch does allow — `hasAny` bites on
        // the whole diff, so the bundle must fail with the smuggled key.
        await mustDeny(
          `${who} smuggling ${key} inside an org rename`,
          updateDoc(doc(db, 'orgs', ORG), {
            name: 'Innocent Rename', [key]: changed(key),
          }),
        )
      }
      // A nested field path is the same top-level diff and must not slip
      // past — `subscription.status` is what `orgBillingStatusFrom` derives
      // the dunning banner from, `sso.tenantId` decides which GCIP tenant
      // signs the org in, and a new `hosts.*` entry is a projection claim.
      await mustDeny(
        `${who} flipping subscription.status by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'subscription.status': 'active' }),
      )
      await mustDeny(
        `${who} pointing sso.tenantId by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'sso.tenantId': 'tenant-attacker' }),
      )
      await mustDeny(
        `${who} claiming a host by field path`,
        updateDoc(doc(db, 'orgs', ORG), { 'hosts.evil-host': true }),
      )
    }
  })

  it('naming the seven without CHANGING them is still not a change', async () => {
    // The AGL-1795 premise holds for this key family too: a client that
    // re-sends the whole org document unchanged (a naive save) is judged on
    // the DIFF, so denying the keys does not refuse it. The carrier write is
    // `enabledPlugins`, the super branch's own carve-out.
    const db = staffDb({ staff: true, staffRole: 'super' })
    const allUnchanged = Object.fromEntries(
      SEVEN_KEYS.map((key) => [key, unchanged(key)]),
    )
    await mustAllow(
      'super staff enabling a plugin while re-sending all seven keys unchanged',
      setDoc(
        doc(db, 'orgs', ORG),
        { enabledPlugins: ['paid'], ...allUnchanged },
        { merge: true },
      ),
    )
    // The twin: one nested value differs and the same write is refused.
    await mustDeny(
      'the same write with ONE nested subscription field changed',
      setDoc(
        doc(db, 'orgs', ORG),
        {
          enabledPlugins: ['paid'],
          ...allUnchanged,
          subscription: { status: 'active', priceId: 'price_pro' },
        },
        { merge: true },
      ),
    )
  })

  it('both staff branches and the erasure batch survive the narrowing', async () => {
    // The deny is seven keys, not the token: each branch keeps a write only
    // it can make (super: enabledPlugins; billing: the rename).
    await mustAllow(
      'super staff still writing an org key denied to everyone else',
      updateDoc(doc(staffDb({ staff: true, staffRole: 'super' }), 'orgs', ORG), {
        enabledPlugins: ['paid'],
      }),
    )
    await mustAllow(
      'billing staff still renaming the org',
      updateDoc(
        doc(staffDb({ staff: true, staffRole: 'billing' }), 'orgs', ORG),
        { name: 'Acme Billing' },
      ),
    )
    // The last legitimate client writer of a staff key, both directions —
    // the write every org-rule narrowing is most likely to break.
    const db = staffDb({ staff: true, staffRole: 'super' })
    const requestBatch = writeBatch(db)
    requestBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: new Date(), updatedAt: new Date() },
      { merge: true },
    )
    requestBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureRequested',
      target: `orgs/${ORG}`,
      before: { erasureRequested: false },
      after: { erasureRequested: true },
      at: new Date(),
    })
    await mustAllow(
      'the erasure request batch beside the AGL-1824 narrowing',
      requestBatch.commit(),
    )
    const cancelBatch = writeBatch(db)
    cancelBatch.set(
      doc(db, 'orgs', ORG),
      { erasureRequestedAt: deleteField(), updatedAt: new Date() },
      { merge: true },
    )
    cancelBatch.set(doc(collection(db, 'adminAudit')), {
      actorUid: STAFF,
      action: 'org.erasureCanceled',
      target: `orgs/${ORG}`,
      before: { erasureRequested: true },
      after: { erasureRequested: false },
      at: new Date(),
    })
    await mustAllow(
      'the erasure batch cancelling the request',
      cancelBatch.commit(),
    )
  })

  it('the legitimate server path still writes, and a member still reads the org', async () => {
    // `writeOrgBilling`, the org create/rename transactions and the host APIs
    // all go through the Admin SDK, which rules never see —
    // `withSecurityRulesDisabled` is that path in the emulator.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'orgs', ORG),
        {
          stripeCustomerId: 'cus_from_webhook',
          subscription: changed('subscription'),
          hosts: { [HOST]: true, 'host-b': true },
        },
        { merge: true },
      )
    })
    // The org doc stays member-readable in full — that was AGL-1028's point:
    // the confidentiality fix was MOVING the keys, not hiding this doc.
    const snapshot = await getDoc(doc(authed(VIEWER), 'orgs', ORG))
    assert.equal(snapshot.data().stripeCustomerId, 'cus_from_webhook')
    assert.equal(snapshot.data().subscription.status, 'active')
    assert.equal(snapshot.data().hosts['host-b'], true)
  })
})

/**
 * AGL-1827: an order's `status` is server-owned — no client writes it at all.
 *
 * Every status transition goes through an Admin-SDK route that re-asks
 * `ORDER_TRANSITIONS` inside the transaction that writes it: cancel
 * (AGL-1808/1818), fulfil and mark-delivered (AGL-1819), refund, the supplier
 * update and the webhook paths. A client `status` write is therefore by
 * definition a bypass of that guard — the stale-dialog hole those routes
 * closed, reopened one SDK level down.
 *
 * What legitimately stays client-side, swept repo-wide before narrowing: the
 * order-detail dialog's note (`timeline` only, pinned to exactly that key by
 * `order-fulfill-wiring.spec.tsx`) and its restock answer (`restockCheck` +
 * `timeline` via a guarded transaction, AGL-1806). Nothing else in the repo
 * writes `hosts/{hostId}/orders/*` from the Web SDK — every other reference
 * is a read. No client path CREATES an order (checkout, POS, draft and the
 * webhook are all Admin-SDK routes) and none deletes one, so both are closed
 * too: a create writes `status` free-hand, and delete-and-recreate would
 * re-mint the document with any status at all.
 */
describe('an order status is Admin-SDK-only — notes and restock answers stay client-side (AGL-1827)', () => {
  const ORDER = 'order-1827'
  const FLAGGED_AT = 1_755_000_000_000

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'hosts', HOST, 'orders', ORDER), {
        status: 'paid',
        email: 'buyer@x.z',
        totals: { totalCents: 4200 },
        timeline: [
          { type: 'status', message: 'paid', atMs: FLAGGED_AT - 1000 },
        ],
        restockCheck: { flaggedAtMs: FLAGGED_AT, quantity: 1 },
      })
    })
  })

  it('no client moves a status — admin, editor, or bundled with a note', async () => {
    // The dialog's old handleFulfill/mark-delivered shapes, exactly as they
    // wrote before AGL-1819 moved them into the route.
    await mustDeny(
      'the site ADMIN writing status: fulfilled',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        status: 'fulfilled',
        fulfillments: [{ id: 'f1', carrier: 'UPS', number: '1Z' }],
      }),
    )
    await mustDeny(
      'the EDITOR writing status: delivered',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        status: 'delivered',
      }),
    )
    // A status riding along with the write the rule permits is still a
    // status write — the exact smuggle the dialog's own spec pins against.
    await mustDeny(
      'a status smuggled in with a timeline note',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        status: 'cancelled',
        timeline: [{ type: 'note', message: 'and also cancelled', atMs: 1 }],
      }),
    )
  })

  it('no client creates or deletes an order', async () => {
    await mustDeny(
      'the EDITOR minting an order with a chosen status',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', 'minted'), {
        status: 'fulfilled',
        totals: { totalCents: 0 },
      }),
    )
    await mustDeny(
      'the site ADMIN deleting an order (the recreate laundering half)',
      deleteDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER)),
    )
  })

  it('the note and the restock answer — the two real client writers — still land', async () => {
    // handleNote: `timeline` alone, the shape order-fulfill-wiring.spec.tsx
    // pins on the dialog side.
    await mustAllow(
      "the dialog's timeline-only note",
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        timeline: [
          { type: 'status', message: 'paid', atMs: FLAGGED_AT - 1000 },
          { type: 'note', message: 'called the buyer', atMs: FLAGGED_AT + 1 },
        ],
      }),
    )
    // handleRestockAnswer: restockCheck + timeline via a TRANSACTION, as the
    // dialog does it (AGL-1806) — the emulator runs rules against
    // transactional updates too, so this is the real shape, not a stand-in.
    const ownerDb = authed(OWNER)
    await mustAllow(
      "the dialog's restock answer transaction",
      runTransaction(ownerDb, async (transaction) => {
        const reference = doc(ownerDb, 'hosts', HOST, 'orders', ORDER)
        const snapshot = await transaction.get(reference)
        const current = snapshot.data()
        transaction.update(reference, {
          restockCheck: {
            ...current.restockCheck,
            resolution: 'restocked',
            resolvedAtMs: FLAGGED_AT + 2,
            resolvedBy: OWNER,
          },
          timeline: [
            ...current.timeline,
            {
              type: 'restock-check',
              message: 'answered — restocked',
              atMs: FLAGGED_AT + 2,
            },
          ],
        })
      }),
    )
  })

  it('naming status without CHANGING it is still not a change', async () => {
    // The AGL-1795/1813/1824 property, held here too: the key-diff is on
    // VALUES, so a patch that spells out `status: 'paid'` unchanged — a
    // whole-object write shape — is not refused for naming it.
    await mustAllow(
      'a patch naming the unchanged status',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        status: 'paid',
        timeline: [
          { type: 'status', message: 'paid', atMs: FLAGGED_AT - 1000 },
          { type: 'note', message: 'no move', atMs: FLAGGED_AT + 3 },
        ],
      }),
    )
  })

  it('staff and the Admin SDK are untouched — the routes still transition', async () => {
    // Staff parity with the catch-all this replaces: `isStaff()` led every
    // one of its allows, so the dedicated block keeps it. Narrowing staff
    // would be a different decision than AGL-1827 records.
    await mustAllow(
      'a staff client status write (parity with the old catch-all)',
      updateDoc(
        doc(authed(STAFF, { staff: true }), 'hosts', HOST, 'orders', ORDER),
        { status: 'refunded' },
      ),
    )
    // The positive control: cancel/fulfill/refund/supplier/webhook all write
    // through the Admin SDK, which rules never see.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'orders', ORDER),
        { status: 'fulfilled' },
        { merge: true },
      )
    })
    const snapshot = await getDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER))
    assert.equal(snapshot.data().status, 'fulfilled')
  })
})

assert.ok(true)
