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
  addDoc,
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
 * Strip comments with ONE left-to-right scan, so whichever delimiter appears
 * first wins (AGL-2004, and its second instance AGL-2002).
 *
 * The two-regex form this replaces — block comments removed first, then line
 * comments — is the bug `fcb8dbd45` fixed in
 * `libs/aglyn/src/lib/foundation/definitions/write-deny-coverage.util.ts`.
 * That fix did not reach here, and this file had the identical defect: the
 * rules carry a LINE comment that quotes a wildcard path,
 *
 *   // the name, so `hosts/{hostId}/datasets/*` stayed a client-writable
 *
 * whose `/*` opened a phantom block comment that ran 551 lines to the next
 * closing delimiter, deleting real rule text on the way. The host catch-all's
 * three exclusion lists were inside the swallowed region, so
 * `hostServerOnlySubcollections()` threw at module load and took every one
 * of this file's 124 assertions with it — a suite that had never run in any
 * workflow, so nothing reported the red.
 *
 * Scanning once fixes it in both directions: `/*` inside a line comment is
 * just text, and `//` inside a block comment cannot eat the terminator.
 * Kept as a local copy rather than an import because `cloud/` is not an nx
 * project and this is plain ESM run by `node --test`; it cannot reach the
 * TypeScript source of the canonical helper. `RULES_PARSE_SELF_TEST` below
 * pins the two implementations to the same behaviour.
 */
const stripComments = (source) => {
  let out = ''
  let index = 0
  while (index < source.length) {
    const pair = source.slice(index, index + 2)
    if (pair === '/*') {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      continue
    }
    if (pair === '//') {
      const end = source.indexOf('\n', index + 2)
      if (end < 0) break
      // Keep the newline: line numbers and statement separation survive.
      out += '\n'
      index = end + 1
      continue
    }
    out += source[index]
    index += 1
  }
  return out
}

/** Comments out, path variables to angle brackets so braces alone give depth. */
const normalizeRules = (source) =>
  stripComments(source).replace(
    /\{([A-Za-z_][A-Za-z0-9_]*(?:=\*\*)?)\}/g,
    '<$1>',
  )

/**
 * Run once, cache, and — the point — run LAZILY, inside a test (AGL-2002).
 *
 * These parsers used to run at module scope. When AGL-2004's phantom comment
 * made one of them throw, the throw happened during import: node:test reported
 * one anonymous failing "test at …test.mjs:1:1" and not one of the real
 * assertions below ever ran. A suite that covers ~124 cases went to zero and
 * said so only as a stack trace.
 *
 * Deferring the parse to first use puts any future parse failure inside a
 * NAMED test, next to the parser guards below that explain what a parse
 * failure means — while the rest of the file still runs and still reports.
 */
const memoize = (compute) => {
  let cached
  return () => {
    if (!cached) cached = { value: compute() }
    return cached.value
  }
}

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
const orgAdminDenied = memoize(() => {
  const rules = normalizeRules(RULES_SOURCE)
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
})

/**
 * The host subcollections that are denied to the client OUTRIGHT — parsed
 * out of the catch-all's three exclusion lists rather than retyped (AGL-1367).
 *
 * A name has to appear in ALL THREE lists to be here, and must have no
 * dedicated `match` block of its own inside `match /hosts/{hostId}`. Both
 * halves matter, and each one is a bug this repo has already shipped:
 *
 *  - Appearing in one list is not denial. `variables` is create-excluded and
 *    freely updatable. A guard that read one list would call it closed.
 *    `webhooks` was the same shape and was NOT deliberate: AGL-1881 found an
 *    `author` repointing a webhook it was refused a read on, and moved the
 *    name into all three lists with a dedicated block re-granting
 *    update/delete to admin/editor — the second bullet's pattern, used on
 *    purpose.
 *  - A dedicated block RE-GRANTS. Rules OR their allows and the LOOSER one
 *    wins, so `screens`, `layouts` and `collections` sit in all three lists
 *    and are still editor-writable through the blocks above the catch-all.
 *    That is why a dedicated `allow write: if false` block would not have
 *    closed AGL-1367, and why this set is computed by subtracting them.
 */
const hostCatchAllRules = memoize(() => {
  const rules = normalizeRules(RULES_SOURCE)

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

  return { create, update, delete: remove, dedicated: [...dedicated] }
})

/**
 * The three lists as they are WRITTEN, before the subtraction above.
 *
 * `hostServerOnlySubcollections()` answers "denied outright", which is the
 * right question for a collection nothing client-side may touch and the wrong
 * one for a collection that is excluded so a dedicated block can narrow it —
 * `media` (AGL-1881), `collections` (AGL-978), `templates` (AGL-666). Those
 * names are absent from the outright set BY DESIGN, so a test that only ever
 * asked the subtracted question could not tell "excluded, and re-granted with
 * a freeze" from "never excluded at all", which are the fix and the bug.
 */
const hostSubcollectionExclusions = () => hostCatchAllRules()

const hostServerOnlySubcollections = memoize(() => {
  const { create, update, delete: remove, dedicated } = hostCatchAllRules()
  return create.filter(
    (name) =>
      update.includes(name) &&
      remove.includes(name) &&
      !dedicated.includes(name),
  )
})

/**
 * The parser's own guard (AGL-2002).
 *
 * Everything above reads the rules file, and the two failures that matter are
 * both about the READ, not the rules:
 *
 *  - The strip eats too much. That is AGL-2004: a line comment quoting `/*`
 *    swallowed 551 lines here and the host catch-all's exclusion lists went
 *    with it. It happened to throw, but truncation does not have to — a
 *    shorter bite leaves the lists parseable and merely SMALLER, and every
 *    `for (const name of …)` below then loops over a set with the interesting
 *    names missing. Green, testing less.
 *  - The strip eats too little, and prose gets read as rules.
 *
 * These run without the emulator, before any of it, so a parse regression
 * reads as a parse regression rather than as a rules failure.
 */
describe('the rules parser reads the whole file (AGL-2002)', () => {
  it('strips a line comment that quotes a wildcard path, without eating the file', () => {
    // The literal line that caused AGL-2004, still in the rules today.
    //
    // The trailing block comment is load-bearing, not scenery: the phantom
    // comment a block-first strip opens at `datasets/*` runs to the NEXT
    // closing delimiter, so without one downstream the buggy strip finds no
    // match, removes nothing, and this test passes under the very defect it
    // exists to catch. Checked by injecting that defect — with the block
    // comment present it fails, without it it does not.
    const source = [
      'match /a/<id> {',
      '  // the name, so `hosts/{hostId}/datasets/*` stayed a client-writable',
      "  allow read: if keep in ['sentinel'];",
      '  /* an ordinary block comment, further down the file */',
      '}',
    ].join('\n')
    const stripped = stripComments(source)
    assert.ok(
      stripped.includes('sentinel'),
      'a line comment quoting `/*` opened a phantom block comment and ate ' +
        'the rule under it — this is AGL-2004 returning.',
    )
    assert.ok(
      !stripped.includes('client-writable'),
      'the line comment survived the strip',
    )
  })

  it('does not let a `//` inside a block comment eat the block terminator', () => {
    const source = ['/* prose with // inside */', "allow read: if x in ['kept'];"].join(
      '\n',
    )
    const stripped = stripComments(source)
    assert.ok(stripped.includes('kept'), 'the block comment swallowed the rule')
    assert.ok(!stripped.includes('prose'), 'the block comment survived the strip')
  })

  it('reads the real rules file whole, not a truncated prefix', () => {
    // A cheap, order-of-magnitude floor. The AGL-2004 strip returned 1045
    // lines where the correct one returns 1596, so anything near the true
    // size proves the phantom-comment bite is not happening. Deliberately
    // NOT derived from the file's own length after stripping — that would be
    // the tautology this issue is about.
    const lines = stripComments(RULES_SOURCE).split('\n').length
    assert.ok(
      lines > 1400,
      `the comment strip returned ${lines} lines of rules; the file has ` +
        `${RULES_SOURCE.split('\n').length}. Something is eating the source, ` +
        `and every list parsed off it above is reading a truncated file.`,
    )
  })

  it('strips to a brace-balanced document (AGL-1983)', () => {
    // Came in on `c14fc5c38` as a module-scope block. Kept, but moved INSIDE a
    // test: at module scope a throw here dies at import and takes all ~124
    // assertions with it, which is the exact failure AGL-2002 exists to stop.
    //
    // The parse is only trustworthy if what it parsed is balanced. A stray
    // delimiter that ate half the file leaves braces uneven, so this is the
    // cheap check that the two extractions above read the real document.
    const stripped = stripComments(RULES_SOURCE)
    const opens = (stripped.match(/\{/g) ?? []).length
    const closes = (stripped.match(/\}/g) ?? []).length
    assert.equal(
      opens,
      closes,
      `the rules source does not have balanced braces after comment stripping ` +
        `(${opens} open, ${closes} close). Something is eating real rules — the ` +
        `block-depth parsers above are reading a corrupted document and every ` +
        `guard built on them is meaningless until this is fixed.`,
    )
  })

  it('parses non-empty lists off the rules (the vacuous-pass floor)', () => {
    // Without this, a strip that truncated JUST enough to leave the lists
    // syntactically valid but empty would make every loop below iterate
    // nothing and the suite would pass having asserted on no collection at
    // all. The per-name floors further down catch a specific name going
    // missing; this catches the whole set going missing.
    assert.ok(
      hostServerOnlySubcollections().length > 0,
      'no server-only host subcollections parsed — every `for (const name ' +
        'of hostServerOnlySubcollections())` below is a no-op',
    )
    assert.ok(
      orgAdminDenied().length > 0,
      'no org-admin denied keys parsed — the org key-diff loops are no-ops',
    )
  })
})

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
// The AGL-2334 role: hostAccess HOST=author — edits content, never publishes.
// Seeded with the org role `viewer` and `allHosts: false` because that is
// exactly what `grantHostAccess` writes for a site collaborator; an author
// can only ever arrive through an explicit `hostAccess` entry, since
// `hostRoleFor` maps an `allHosts` member to their ORG role and there is no
// org-level author.
const AUTHOR = 'uid-author'
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
    await setDoc(doc(db, 'orgs', ORG, 'members', AUTHOR), {
      role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'author' },
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
      memberRoles: {
        [OWNER]: 'admin', [EDITOR]: 'editor', [AUTHOR]: 'author',
        [VIEWER]: 'viewer',
      },
      // The routing map, with one page already live. AGL-2334's sharpest
      // assertion is about THIS key: registering a path here is what makes a
      // page reachable, so an author must not be able to add, change or
      // remove an entry — while an editor still must.
      screens: { 'screen-1': '/home' },
    })
    // `publishedAt` and `publishSchedule` are seeded SET, deliberately: a
    // `deleteField()` on a field that was never there affects NO keys, so
    // `diff().affectedKeys().hasAny([...])` is empty and the write is allowed
    // for reasons that have nothing to do with the rule. Both "the author
    // clears it" assertions below passed against an unseeded screen and were
    // asserting nothing at all — found by running this against the emulator.
    await setDoc(doc(db, 'hosts', HOST, 'screens', 'screen-1'), {
      name: 'Home', slug: 'home', versionId: 'v1',
      publishedAt: new Date(),
      publishSchedule: {
        action: 'publish', versionId: 'v1',
        publishAt: new Date(Date.now() + 24 * AN_HOUR),
        status: 'pending', createdAt: new Date(),
      },
    })
    // The other four publish shapes (AGL-2334), seeded so both halves of the
    // author role can be asserted against real documents: a layout and a
    // component each carry a live `versionId` pointer, and a collection has
    // one published entry and one draft.
    await setDoc(doc(db, 'hosts', HOST, 'layouts', 'layout-1'), {
      name: 'Main', versionId: 'lv1',
    })
    await setDoc(
      doc(db, 'hosts', HOST, 'layouts', 'layout-1', 'versions', 'lv1'),
      { nodes: { root: {} } },
    )
    await setDoc(doc(db, 'hosts', HOST, 'components', 'comp-1'), {
      name: 'Hero', versionId: 'cv1',
    })
    await setDoc(
      doc(db, 'hosts', HOST, 'components', 'comp-1', 'versions', 'cv1'),
      { nodes: { root: {} } },
    )
    await setDoc(doc(db, 'hosts', HOST, 'collections', 'col-1'), {
      slug: 'posts', kind: 'blog',
    })
    await setDoc(
      doc(db, 'hosts', HOST, 'collections', 'col-1', 'entries', 'entry-live'),
      { title: 'Live post', status: 'published', body: 'x' },
    )
    await setDoc(
      doc(db, 'hosts', HOST, 'collections', 'col-1', 'entries', 'entry-draft'),
      { title: 'Draft post', status: 'draft', body: 'x' },
    )
    // One order, so the PII read gate has a document to refuse rather than
    // proving only that a missing document is unreadable.
    await setDoc(doc(db, 'hosts', HOST, 'orders', 'order-1'), {
      status: 'paid', totals: { grandTotal: 1000 },
      shipping: { address1: '1 Main St' },
    })
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
      orgAdminDenied().length >= 15,
      `Parsed only ${orgAdminDenied().length} keys off the org-update rule; ` +
        `the parser has rotted and this test is proving nothing.`,
    )
    for (const key of orgAdminDenied()) {
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
    // Entries are a separate resource underneath. CREATE became API-only in
    // AGL-2266 — it was the last client-direct document class with no cap on
    // any plan — while update and delete stay client-side, which is what keeps
    // the entry editor working: its save is a merge-set, so only the FIRST
    // save of a new entry is a create.
    await mustDeny(
      'creating a collection entry client-direct',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'collections', 'blog', 'entries', 'e1'),
        { title: 'Hello' },
      ),
    )
    // Seeded through the admin context, as /api/hosts/resources would.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'collections', 'blog', 'entries', 'e1'),
        { title: 'Hello', status: 'draft' },
      )
    })
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
   * AGL-553. `authScreens` designates the screen rendered at `/signin`,
   * `/signup` and `/recover`. It was persisted, written by the console and
   * read by the tenant loader while appearing in NO deny-list and on NO
   * TypeScript interface, so it fell through every tier: any site member who
   * could write content could repoint the address a site's members type
   * their password into.
   *
   * It is the sharper twin of `enabledPlugins`, which sits in this same
   * admin tier for deciding whether those three addresses exist at all. And
   * unlike every other live-content surface it does not go through the
   * `screens` routing map — the loader resolves the slot straight to a
   * screen document — so freezing that map for an `author` in AGL-2334 never
   * reached it.
   *
   * THE DOTTED PATH IS THE TEST. The console writes
   * `authScreens.signinScreenId`, not a whole `authScreens` map, and a rule
   * naming the top-level key only bites here because `affectedKeys()` reports
   * the top-level key for a dotted merge. Asserting against a whole-map write
   * would prove the rule fires on a shape the product never sends.
   */
  it('only a site admin may designate the sign-in screen (AGL-553)', async () => {
    // The fixture reaches the tier under test only if these are the roles the
    // projection really writes. A deny proved against an invented role name
    // proves the rule rejects nonsense and nothing more.
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      const roles = (await getDoc(doc(db, 'hosts', HOST))).data().memberRoles
      assert.equal(
        roles[AUTHOR], 'author',
        'the AUTHOR principal is no longer projected as `author` on the ' +
          'host, so this test can no longer reproduce the hole it covers.',
      )
      assert.equal(
        roles[EDITOR], 'editor',
        'the EDITOR principal is no longer projected as `editor`, so the ' +
          'middle tier this test exists to pin is no longer being exercised.',
      )
      assert.equal(
        roles[OWNER], 'admin',
        'the OWNER principal is no longer projected as `admin`, so the ' +
          'positive control below would pass for the wrong reason.',
      )
    })

    // ── The hole itself ────────────────────────────────────────────────────
    await mustDeny(
      'an AUTHOR repointing /signin — the role sold as "edit content but ' +
        'not publish", putting a screen on the site\'s sign-in address',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), {
        'authScreens.signinScreenId': 'screen-forged',
      }),
    )
    await mustDeny(
      'an EDITOR repointing /signin — an editor may publish pages, but ' +
        '/signin is the address visitors trust with a password, and the ' +
        'switch that opens it is admin-only one tier down',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        'authScreens.signinScreenId': 'screen-forged',
      }),
    )
    await mustDeny(
      'an EDITOR repointing /recover, the slot that mails a reset link',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        'authScreens.recoveryScreenId': 'screen-forged',
      }),
    )
    // A whole-map overwrite is the other spelling of the same act, and it
    // must not be the way around the dotted-path deny.
    await mustDeny(
      'an EDITOR replacing the whole authScreens map at once',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        authScreens: { signinScreenId: 'screen-forged' },
      }),
    )

    // ── The controls ───────────────────────────────────────────────────────
    // A deny that also refuses the admin is not a tier, it is an outage: the
    // console card writes this key from Admin -> Plugins and has to keep
    // working.
    await mustAllow(
      'a site ADMIN designating the sign-in screen, which is what the ' +
        'Sign-in & sign-up pages card does',
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        'authScreens.signinScreenId': 'screen-designed',
      }),
    )
    // The sibling slot stays authoring, so this deny must not have widened
    // into `errorScreens`: that one binds screens the editor already owns and
    // serves only their own visitors.
    await mustAllow(
      'an EDITOR designating a 404 screen — errorScreens is authoring and ' +
        'is deliberately NOT in the admin tier',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        'errorScreens.notFound': 'screen-404',
      }),
    )
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
    // `registers` and `mediaTombstones` joined this floor in AGL-2002, and
    // `registers` is the reason. The floor named four collections while the
    // parse yields six, so the two it omitted could be dropped from an
    // exclusion list and this suite would not notice: the parsed intersection
    // simply gets shorter and every loop below covers one collection less,
    // green the whole way. Proven by making the exact edit the rules file's
    // own comment says has already happened TWICE from stale worktrees —
    // deleting `registers` from the `allow update` list — and watching all
    // nine AGL-1367 tests pass. They now fail.
    //
    // `registers` is the POS add-on pool the org is billed for;
    // `mediaTombstones` is what makes a DAM delete restorable.
    for (const name of [
      'counters',
      'analytics',
      'members',
      'datasets',
      'registers',
      'mediaTombstones',
      // AGL-2038. `screenAnalytics` is the same beacon as `analytics` one
      // document finer, and was in NONE of the three lists — not because
      // anyone decided it, but because the catch-all grants by default and
      // nobody typed the name when AGL-151 created the collection.
      'screenAnalytics',
      // AGL-2042. Six collections with no client-SDK writer at all, closed
      // together. They belong on the floor for the `registers` reason above:
      // the loops below derive their set from the rules, so dropping one of
      // these from an exclusion list would shorten the parse and leave the
      // suite green having tested one collection fewer. Named here, that edit
      // fails instead.
      'carts',
      'checkouts',
      'giftCards',
      'stripeTaxRates',
      'restockAlerts',
      'inventoryReconciliation',
      // AGL-2356. The release index for the stock a live checkout has
      // reserved. Server-only, like the six above, and on the money path: an
      // editor who could delete one would strand a merchant's units until the
      // hold's TTL lapsed, and one who could forge one would have the webhook
      // release reservations it does not own.
      'stockHolds',
      // AGL-1302. The previous theme, kept verbatim so "Go back to the
      // previous theme" can restore it. Written only by `install-theme.ts` on
      // the Admin SDK, and read by nothing on the tenant render path — which
      // is why it moves out of the host document at all. A client that could
      // forge one would be choosing the CSS a publisher's revert restores:
      // arbitrary styling pushed onto a live site from the narrowest role we
      // sell, arriving disguised as the site's own history.
      'themeHistory',
      // One document per email SEND. Every field is server-written — the send
      // route stamps the audience and the consent and suppression
      // populations, the Resend webhook and the unsubscribe handler increment
      // `stats` — so an editor who could write one would author the campaign
      // report and the compliance record of who the send was allowed to
      // reach. Named here for the `registers` reason above: the loops derive
      // their set from the rules, so dropping the name from one exclusion
      // list would shorten the parse and leave the suite green having tested
      // one collection fewer.
      'campaigns',
      // One document per ORDER, recording which campaign the sale was
      // credited to and how much of it has since come back. Written only by
      // `email-revenue-attribution.ts` on the Admin SDK, and every operation
      // is load-bearing: the CREATE is what makes crediting an order
      // idempotent, so a client that could `set` one would credit a campaign
      // twice for one sale, and one that could DELETE one would leave a
      // refund with nothing to reverse — a revenue figure that can only ever
      // go up. Named here for the `registers` reason above.
      'emailAttributions',
      // One document per CONVERSION — a form submission, a lead, a contact or
      // a booking — naming the campaign the visitor came from and carrying
      // `personKey`, the address hash an erasure joins on. Written only by
      // `campaign-conversion-attribution.ts` on the Admin SDK. A client that
      // could create one would credit a campaign for a conversion that never
      // happened and forge a claim about where somebody else came from; one
      // that could delete one would remove the record an erasure is meant to
      // be the only remover of. Named here for the `registers` reason above.
      'campaignAttributions',
    ]) {
      assert.ok(
        hostServerOnlySubcollections().includes(name),
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
      for (const name of hostServerOnlySubcollections()) {
        await setDoc(doc(db, 'hosts', HOST, name, 'agl1367-seed'), { total: 7 })
      }
    })
    // Both roles: this is a PATH question, not a role one. A site admin has
    // the same billing incentive as an editor and no more right to the meter.
    for (const uid of [EDITOR, OWNER]) {
      for (const name of hostServerOnlySubcollections()) {
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
   * AGL-2038, spelled out the same way. The loop above already covers
   * `screenAnalytics` because it derives its set from the rules — which is the
   * point of deriving it — but the named writes are what a future reader needs
   * in order to see what was actually reachable.
   *
   * Not the same severity as the counters above, and the comment should not
   * pretend otherwise: nothing invoices off `screenAnalytics`.
   * /api/billing/report-usage computes `pageViews` from `analytics` alone, so
   * falsifying these rows lowers no bill. What it corrupts is the per-screen
   * history behind the Pro+ panel — a record the customer consumes rather than
   * authors, whose only writer is /api/analytics/collect through the Admin SDK.
   *
   * The reason it was reachable at all is the finding: the catch-all grants
   * every host subcollection to editors unless a name appears in three lists,
   * so a collection added later is open until somebody remembers it. The
   * commit-time half of that is `host-subcollection-write-deny-coverage`.
   */
  it('an editor cannot falsify the per-screen traffic history (AGL-2038)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'screenAnalytics', 'screen-1:2026-08-01'),
        { screenId: 'screen-1', day: '2026-08-01', total: 4_120 },
      )
    })
    await mustDeny(
      'inflating screenAnalytics/{screenId}:{day}.total',
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screenAnalytics', 'screen-1:2026-08-01'),
        { total: 9_999_999 },
      ),
    )
    await mustDeny(
      'forging a screenAnalytics day for a screen that never ran',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screenAnalytics', 'screen-9:2026-08-02'),
        { screenId: 'screen-9', day: '2026-08-02', total: 1 },
      ),
    )
    await mustDeny(
      'deleting a screenAnalytics day',
      deleteDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screenAnalytics', 'screen-1:2026-08-01'),
      ),
    )
    // The read is the product and survives: the Pro+ panel and the screens
    // table both read this collection with the client SDK, and the entitlement
    // — not the rules — is what gates the display.
    await assertSucceeds(
      getDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screenAnalytics', 'screen-1:2026-08-01'),
      ),
    )
  })

  /**
   * AGL-2042 — the six with no client writer, each named.
   *
   * The parametrized loop above already denies all six, because it derives its
   * set from the rules. This block exists for the reason the AGL-2038 one
   * gives: a derived loop proves the rule, and a named write proves what was
   * actually reachable. Somebody deciding later whether to reopen one of these
   * needs to see the write, not a collection name in an array.
   *
   * The severities differ and the assertions say so rather than treating six
   * collections as one fact. `giftCards` is stored value; the rest are
   * integrity or PII.
   *
   * Every one of these was reachable for the same structural reason, which is
   * the actual finding and not a per-collection oversight: the host catch-all
   * grants create/update/delete to any editor unless the name appears in three
   * separate lists, so every collection added since is open until somebody
   * types it. The commit-time half is host-subcollection-write-deny-coverage,
   * whose SERVER_WRITTEN_NOT_YET_DENIED list is empty as of this change.
   */
  it('an editor cannot mint gift-card balance (AGL-2042)', async () => {
    // The one with money in it. Issued and redeemed by cart-checkout.ts and
    // the commerce billing webhook, both Admin SDK.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'giftCards', 'GC-REAL-1'),
        { code: 'GC-REAL-1', balanceCents: 500, currency: 'usd' },
      )
    })
    await mustDeny(
      'topping up an existing gift card',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'giftCards', 'GC-REAL-1'), {
        balanceCents: 5_000_000,
      }),
    )
    await mustDeny(
      'issuing a gift card that nobody paid for',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'giftCards', 'GC-FORGED'), {
        code: 'GC-FORGED',
        balanceCents: 100_000,
        currency: 'usd',
      }),
    )
    await mustDeny(
      'destroying the record of a redeemed card',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'giftCards', 'GC-REAL-1')),
    )
    // An OWNER too: this is a path question, not a role one — a site admin
    // has the same incentive and no more right to mint balance.
    await mustDeny(
      'topping up as a site owner',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'giftCards', 'GC-REAL-1'), {
        balanceCents: 5_000_000,
      }),
    )
    // The READ is the product and survives: gift-cards-card.component.tsx
    // queries this collection with the client SDK to render the console panel.
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'giftCards', 'GC-REAL-1')),
    )
  })

  it('an editor cannot rewrite the stock-reconciliation marker (AGL-2042)', async () => {
    // `inventoryReconciliation/{orderId}` is what stops one order's stock
    // decrement being applied twice (AGL-2358), written only by
    // reconcile-stock.ts. Deleting a marker replays a decrement; forging one
    // makes a decrement that never happened look done, so stock the store
    // does not have stays sellable.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(
          context.firestore(),
          'hosts',
          HOST,
          'inventoryReconciliation',
          'order-1',
        ),
        { orderId: 'order-1', appliedAt: 1, units: 3 },
      )
    })
    await mustDeny(
      'forging a reconciliation marker for an unreconciled order',
      setDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'inventoryReconciliation',
          'order-99',
        ),
        { orderId: 'order-99', appliedAt: 1, units: 0 },
      ),
    )
    await mustDeny(
      'rewriting an existing marker',
      updateDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'inventoryReconciliation',
          'order-1',
        ),
        { units: 0 },
      ),
    )
    await mustDeny(
      'deleting a marker to replay the decrement',
      deleteDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'inventoryReconciliation',
          'order-1',
        ),
      ),
    )
  })

  it('an editor cannot write shopper PII captured anonymously (AGL-2042)', async () => {
    // `restockAlerts` holds email addresses typed by shoppers into an
    // UNAUTHENTICATED storefront endpoint (notify-restock.ts, Admin SDK).
    // Third-party contact data a site editor has no reason to author.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'restockAlerts', 'alert-1'),
        { email: 'shopper@example.com', productId: 'p-1' },
      )
    })
    await mustDeny(
      'planting an address on the restock list',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'restockAlerts', 'alert-2'), {
        email: 'someone-else@example.com',
        productId: 'p-1',
      }),
    )
    await mustDeny(
      'rewriting a shopper address',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'restockAlerts', 'alert-1'), {
        email: 'attacker@example.com',
      }),
    )
    await mustDeny(
      'deleting a restock alert',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'restockAlerts', 'alert-1')),
    )
    // recovery-queue-card.component.tsx queries this client-side.
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'restockAlerts', 'alert-1')),
    )
  })

  it('an editor cannot author pre-purchase state or the tax cache (AGL-2042)', async () => {
    // `carts` and `checkouts` are read back by cart-checkout.ts to decide what
    // was bought and for how much; `stripeTaxRates` caches Stripe rate ids, so
    // a forged id is a wrong tax rate applied to a real order. All three are
    // written exclusively by commerce server routes.
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'hosts', HOST, 'carts', 'cart-1'), { total: 4200 })
      await setDoc(doc(db, 'hosts', HOST, 'checkouts', 'cs_1'), {
        amountTotal: 4200,
      })
      await setDoc(doc(db, 'hosts', HOST, 'stripeTaxRates', 'us-ca'), {
        rateId: 'txr_real',
      })
    })
    await mustDeny(
      'rewriting a cart total',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'carts', 'cart-1'), {
        total: 1,
      }),
    )
    await mustDeny(
      'rewriting a checkout amount',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'checkouts', 'cs_1'), {
        amountTotal: 1,
      }),
    )
    await mustDeny(
      'pointing the tax cache at another rate id',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'stripeTaxRates', 'us-ca'), {
        rateId: 'txr_forged',
      }),
    )
    await mustDeny(
      'deleting an abandoned checkout out of the recovery queue',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'checkouts', 'cs_1')),
    )
    // The recovery-queue panel reads `checkouts` client-side and keeps working.
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'checkouts', 'cs_1')),
    )
  })

  it('an editor cannot forge or drop a stock reservation (AGL-2356)', async () => {
    // `stockHolds/{holdKey}` names the products a live Checkout Session has
    // reserved units on. `billing-webhook.ts` reads it by id on
    // `checkout.session.expired` and at settlement and releases exactly what it
    // names, so a forged entry releases another shopper's reservation and a
    // deleted one strands a merchant's units until the TTL lapses. Written
    // exclusively by `stock-hold.ts`, in the same transaction as the holds.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'stockHolds', 'hold-1'),
        { productIds: ['product-1'], expiresAtMs: 1, createdAtMs: 0 },
      )
    })
    await mustDeny(
      'pointing a reservation at another product',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'stockHolds', 'hold-1'), {
        productIds: ['product-2'],
      }),
    )
    await mustDeny(
      'forging a reservation index',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'stockHolds', 'hold-forged'), {
        productIds: ['product-1'],
      }),
    )
    await mustDeny(
      'dropping a reservation so its units are never released',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'stockHolds', 'hold-1')),
    )
  })

  /**
   * `campaigns` — one document per email SEND, and every field on it is
   * server-written.
   *
   * `campaign-send.ts` creates the document on the Admin SDK and stamps the
   * audience, the send-time consent population and the suppression population
   * onto it; `email-events.ts` increments the `stats` map from the Resend
   * webhook as mail is delivered, opened, clicked, bounced or complained
   * about; the unsubscribe handler in the email plugin's server module
   * increments it too. No client-SDK writer exists anywhere in `apps` or
   * `libs` — every reference is a `collection(...)`/`doc(...)` listen.
   *
   * The collection was in NONE of the three exclusion lists, so the catch-all
   * granted an editor create, update and delete on `canWriteHostContent` —
   * the `screenAnalytics` shape, a subcollection open because nobody typed
   * the name. What that bought is not a vanity metric: `stats` is the
   * campaign report the customer reads, and the consent and suppression
   * populations are the evidence of who a marketing send was allowed to
   * reach. Both are exactly the documents that must not be author-writable.
   *
   * `{document=**}` spans the nested `reports/links` rollup as well, so the
   * per-link click breakdown was reachable by the same grant and is asserted
   * separately below — a name-based exclusion that stopped at the top level
   * would leave the deeper document open and this suite green.
   */
  it("an editor cannot forge a campaign's delivery record", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'hosts', HOST, 'campaigns', 'send-1'), {
        subject: 'A real send',
        stats: { delivered: 10, opened: 2, clicked: 1, bounced: 0 },
        consentedRecipients: 10,
        suppressedRecipients: 3,
      })
      await setDoc(
        doc(db, 'hosts', HOST, 'campaigns', 'send-1', 'reports', 'links'),
        { links: { 'https://example.com': 1 } },
      )
    })
    await mustDeny(
      'inflating the open and click counts on a real send',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'campaigns', 'send-1'), {
        stats: { delivered: 10, opened: 10, clicked: 10, bounced: 0 },
      }),
    )
    await mustDeny(
      'rewriting the send-time consent and suppression populations',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'campaigns', 'send-1'), {
        consentedRecipients: 5000,
        suppressedRecipients: 0,
      }),
    )
    await mustDeny(
      'forging a send that never happened',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'campaigns', 'send-forged'), {
        subject: 'Never sent',
        stats: { delivered: 5000, opened: 4000, clicked: 3000, bounced: 0 },
      }),
    )
    await mustDeny(
      'destroying the record of a send that did happen',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'campaigns', 'send-1')),
    )
    // An OWNER too: this is a path question rather than a role one. A site
    // admin has the same incentive to improve their own report and no more
    // right to write the counters the webhook owns.
    await mustDeny(
      'inflating the counts as a site owner',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'campaigns', 'send-1'), {
        stats: { delivered: 10, opened: 10, clicked: 10, bounced: 0 },
      }),
    )

    // THE NESTED ROLLUP. `{document=**}` spans it, so it was granted by the
    // same catch-all and is denied by the same exclusion — asserted by write
    // because "the name is in the list" says nothing about a deeper path.
    await mustDeny(
      'rewriting the per-link click rollup',
      updateDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'campaigns',
          'send-1',
          'reports',
          'links',
        ),
        { links: { 'https://example.com': 9999 } },
      ),
    )
    await mustDeny(
      'forging a click rollup for a campaign with none',
      setDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'campaigns',
          'send-forged',
          'reports',
          'links',
        ),
        { links: { 'https://example.com': 9999 } },
      ),
    )
    await mustDeny(
      'deleting the per-link click rollup',
      deleteDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'campaigns',
          'send-1',
          'reports',
          'links',
        ),
      ),
    )

    // THE READ IS THE PRODUCT and survives, at both depths. The report screen
    // (`campaign-report-card.tsx`) listens to the campaign document and to
    // `reports/links` beside it with the client SDK, and `email-detail.tsx`
    // does the same — a fix that denied these would blank the report screen,
    // which is worse than the hole it closed.
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'campaigns', 'send-1')),
    )
    await assertSucceeds(
      getDoc(
        doc(
          authed(EDITOR),
          'hosts',
          HOST,
          'campaigns',
          'send-1',
          'reports',
          'links',
        ),
      ),
    )
    // A VIEWER too — the narrowest host member the console renders for. Read
    // is `isHostMember`, and `campaigns` is not in the read exclusion list
    // that `webhooks`/`orders`/`mediaTombstones` share.
    await assertSucceeds(
      getDoc(doc(authed(VIEWER), 'hosts', HOST, 'campaigns', 'send-1')),
    )
    await assertSucceeds(
      getDoc(
        doc(
          authed(VIEWER),
          'hosts',
          HOST,
          'campaigns',
          'send-1',
          'reports',
          'links',
        ),
      ),
    )
  })

  /**
   * The control that proves the right collection was closed.
   *
   * `emailCampaigns` is the campaign CONTAINER — a name, a date window and
   * the lists it is aimed at — and the campaigns card's create drawer writes
   * one with a plain client `setDoc`. It is a different collection from
   * `campaigns` despite the name, holds no counter and no entitlement input,
   * and must stay editor-writable or campaign creation stops for every
   * customer. Denying `campaigns` while leaving this open is the entire
   * distinction the change rests on, so it is asserted rather than assumed.
   */
  it('an editor can still create a campaign container', async () => {
    await mustAllow(
      'creating a campaign container from the create drawer',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'emailCampaigns', 'container-1'),
        { name: 'Spring launch', listIds: ['list-1'] },
      ),
    )
    await mustAllow(
      'renaming a campaign container',
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'emailCampaigns', 'container-1'),
        { name: 'Spring launch, renamed' },
      ),
    )
    await mustAllow(
      'deleting a campaign container',
      deleteDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'emailCampaigns', 'container-1'),
      ),
    )
  })

  /**
   * The negative control for the fix itself (AGL-2038), and the reason the
   * rules were NOT flipped to deny-by-default.
   *
   * Inverting the host catch-all — deny everything, allow-list what editors
   * may write — was considered and rejected because ~51 subcollections hang
   * off `hosts/{hostId}` and roughly twenty of them are plugin content
   * authored client-side. A name missing from that allow-list would not fail a
   * build; it would fail a customer's save, in a plugin surface no test drives.
   *
   * So this is the assertion that would have caught such a flip. Every name
   * below is absent from all three exclusion lists, i.e. governed by the
   * catch-all and nothing else, and is written client-side by a real console
   * or plugin surface. Ordinary authoring has to keep working — screens,
   * layouts, collections and datasets are covered by the `hosts` suite above;
   * this is the long tail that a narrowing change would silently take out.
   */
  it('ordinary authoring still works for every catch-all collection (AGL-2038)', async () => {
    // `actions` LEFT this list in AGL-2266, for the `inventoryAdjustments`
    // reason one operation over: its CREATE is now API-only, so it fails the
    // create leg below by design, while update and delete stay client-side
    // (the actions card toggles `enabled`; both surfaces retire one by
    // stamping `deletedAt`). The three legs are asserted separately in
    // `an editor cannot create an action client-direct (AGL-2266)`.
    const AUTHORING = [
      'overlays', 'experiments', 'emailCampaigns', 'emailTemplates',
      'coupons', 'discounts', 'reviews', 'siteMembers',
      'subscriptions', 'suppliers', 'events', 'bookings', 'activity',
      'settings', 'media', 'mediaFolders', 'leads',
      'licenseKeys', 'reservations', 'resources', 'productCategories',
      // `suppressions` JOINS this list in AGL-2042 rather than being denied
      // with the other six. AGL-2042's description names it as server-written,
      // and that stopped being true on AGL-2410: the Emails console page's
      // Suppressions tab removes an entry with a plain client `deleteDoc`,
      // which is the only way to undo a suppression a link prescanner caused
      // (AGL-2408). Denying it would have broken a shipped surface, and this
      // is the assertion that would catch the next attempt.
      'suppressions',
    ]
    // `emailCampaigns` stands here and `campaigns` does not, and the pair is
    // the whole point: `emailCampaigns` is the campaign CONTAINER the
    // campaigns card's create drawer writes client-side, while `campaigns` is
    // one document per SEND, carrying the delivery counters and the send-time
    // consent record, and is denied outright. Swapping the two names breaks
    // campaign creation for every customer while reopening the counters —
    // which is why the denial is asserted separately, by write, in
    // `an editor cannot forge a campaign's delivery record`.
    //
    // `memberPosts` LEFT this list in AGL-2372: create and update are now
    // denied outright and delete is decided by a dedicated block, so it fails
    // the create leg below by design. All three of its legs are asserted in
    // `an author cannot create or delete a member post (AGL-2372)` and its
    // two siblings, beside the regression guard that keeps the console
    // card's Delete button working.
    //
    // `inventoryAdjustments` LEFT this list in AGL-2269 and is not an
    // oversight: it is now append-only, so it fails the update/delete legs
    // below by design. Its create leg — the products hub's manual adjustment
    // row, the one client write it really has — is asserted in the dedicated
    // describe above, beside the denials that are the point of the change.
    for (const name of AUTHORING) {
      // Absent from every exclusion list, so the catch-all is the only thing
      // granting these. If a future narrowing takes one out, this names it.
      assert.ok(
        !hostServerOnlySubcollections().includes(name),
        `\`${name}\` is now denied outright under hosts/{hostId}, but it is ` +
          `authored CLIENT-SIDE by a console or plugin surface. Denying it ` +
          `breaks that surface for every customer with no build failure to ` +
          `warn anyone — which is exactly why AGL-2038 closed the ` +
          `permissive-by-default hole at COMMIT time (the ` +
          `host-subcollection-write-deny-coverage spec) rather than by ` +
          `flipping these rules to deny-by-default.`,
      )
      await assertSucceeds(
        setDoc(doc(authed(EDITOR), 'hosts', HOST, name, 'agl2038-new'), {
          name: 'authored',
        }),
      )
      await assertSucceeds(
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, name, 'agl2038-new'), {
          name: 'edited',
        }),
      )
      await assertSucceeds(
        deleteDoc(doc(authed(EDITOR), 'hosts', HOST, name, 'agl2038-new')),
      )
    }
  })

  /**
   * `actions`, the split AGL-2266 made (create denied, update/delete open).
   *
   * The collection was in NONE of the three exclusion lists, so the catch-all
   * granted an editor unbounded client creates on any plan — the AGL-1360
   * shape, uncapped infrastructure behind a $0 subscription — and the import
   * route's own table had already written down that nothing counted them.
   * /api/hosts/resources now owns the create and holds `ACTIONS_MAX_PER_HOST`.
   *
   * Both halves, because one list is not denial and denial of all three would
   * have broken every surface that edits one: the actions card toggles
   * `enabled`, and both it and the besigner's interactions provider retire an
   * action by stamping `deletedAt`, which is an UPDATE. The cap counts live
   * rows, so that soft delete frees a slot — which is what makes leaving
   * update open safe rather than merely convenient.
   */
  it('an editor cannot create an action client-direct (AGL-2266)', async () => {
    await mustDeny(
      'creating a hosts/{hostId}/actions document',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'actions', 'agl2266-new'), {
        name: 'Minted from the browser',
      }),
    )
    // The server path — /api/hosts/resources uses the Admin SDK — still lands.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'actions', 'agl2266-new'),
        { name: 'Created by the route' },
      )
    })
    // And the two operations the console really makes stay client-side.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'actions', 'agl2266-new'), {
        enabled: false,
      }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'actions', 'agl2266-new')),
    )
  })

  /**
   * `authors` — the same split, one collection over (AGL-2486).
   *
   * Custom content authors are a NEW host subcollection, and a new
   * subcollection the browser can create is the AGL-1360 / AGL-2266 hole
   * freshly dug: unbounded Firestore documents against a $0 subscription.
   * /api/hosts/resources owns the create and counts live rows against
   * `AUTHORS_MAX_PER_HOST`.
   *
   * Update and delete stay open, and that is the decision rather than an
   * omission: the Authors tab edits a record in place and removes one
   * outright, neither operation creates a document, and the delete frees a
   * slot under the cap. A deleted author does not orphan its posts —
   * `resolveEntryAuthor` falls through a dangling `authorId` to the entry's
   * own `authorName` and then to the site's publisher entity.
   */
  it('an editor cannot create an author client-direct (AGL-2486)', async () => {
    await mustDeny(
      'creating a hosts/{hostId}/authors document',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'authors', 'agl2486-new'), {
        name: 'Minted from the browser',
      }),
    )
    // The server path — /api/hosts/resources uses the Admin SDK — still lands.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'authors', 'agl2486-new'),
        { name: 'Created by the route' },
      )
    })
    // And the two operations the Authors tab really makes stay client-side.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'authors', 'agl2486-new'), {
        jobTitle: 'Staff writer',
      }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'authors', 'agl2486-new')),
    )
  })

  /**
   * `memberPosts` — the DATABASE half of the AGL-2372 route fix (f78705249).
   *
   * That commit made `member-post.ts` refuse an `author`, swapping the
   * `!role || role === 'viewer'` denylist for the `admin | editor` allowlist
   * the route always meant. It closed the front door only. `memberPosts`
   * appeared in NONE of the three exclusion lists above, so the catch-all
   * granted it on `canWriteHostContent`, which since AGL-2334 includes
   * `author` — the refused role could `addDoc` the post straight from the
   * browser and land the same document the route had just denied it. The
   * post is what paying subscribers read; only the subscriber email is lost,
   * because that lives on the route.
   *
   * The split is written from the call sites, and the call sites are
   * unanimous: the ONLY client-SDK write to this collection anywhere in
   * `apps` or `libs` is `deleteDoc` at `member-posts-card.component.tsx:166`.
   *
   *  - CREATE is denied. /api/commerce/member-post owns it on the Admin SDK
   *    and is now the single door, so the route's allowlist is the whole
   *    policy rather than half of it.
   *  - UPDATE is denied. No client updates one — there is no edit control on
   *    the card — so denying it costs nothing and closes the variant where an
   *    author rewrites a live post's title and body in place.
   *  - DELETE is excluded and RE-GRANTED by the dedicated block, on
   *    `canPublishHostContent` rather than `canWriteHostContent`. Excluding
   *    it wholesale would break the card's Delete button for the admins and
   *    editors who are entitled to it; leaving it in the catch-all would let
   *    an author destroy content paying subscribers read. AGL-2334 already
   *    decided this exact question for `components`: taking live content down
   *    is the same act as publishing in the other direction.
   *
   * ⚠️ The exclusion is the MECHANISM for the delete leg, not an extra.
   * Sibling matches are OR'd and the LOOSER one wins, so the dedicated
   * block's narrower delete decides nothing while the catch-all still grants
   * the same operation — the shape that left `components` author-publishable
   * for as long as it did. Drop `memberPosts` from the delete list and the
   * author-delete row below goes green while the rule reads correct.
   */
  it('an author cannot create or delete a member post (AGL-2372)', async () => {
    // The fixture the naive fix passes by accident: `author` is a role the
    // projection really writes (`memberRoles[AUTHOR] === 'author'`, seeded
    // above from what `grantHostAccess` produces), not a string invented for
    // a test. A gate proved only against `'manager'`/`'contributor'` proves
    // it rejects nonsense and nothing more — the M9 survivor on this issue.
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      assert.equal(
        (await getDoc(doc(db, 'hosts', HOST))).data().memberRoles[AUTHOR],
        'author',
        'the AUTHOR principal is no longer projected as `author` on the ' +
          'host, so this test can no longer reproduce the hole it exists ' +
          'to cover.',
      )
      // A post that already exists, so the delete legs refuse a real
      // document rather than proving only that a missing one is undeletable.
      await setDoc(doc(db, 'hosts', HOST, 'memberPosts', 'agl2372-existing'), {
        title: 'Published by the route',
        body: 'Subscribers-only',
        createdAtMs: Date.now(),
      })
    })

    // ── The hole itself ────────────────────────────────────────────────────
    await mustDeny(
      'an AUTHOR creating a hosts/{hostId}/memberPosts document, which is ' +
        'the write member-post.ts refuses at the route (f78705249)',
      setDoc(doc(authed(AUTHOR), 'hosts', HOST, 'memberPosts', 'agl2372-new'), {
        title: 'Published from the browser',
        body: 'The route said no',
        createdAtMs: Date.now(),
      }),
    )
    await mustDeny(
      'an AUTHOR rewriting a live member post in place',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'memberPosts', 'agl2372-existing'),
        { body: 'Replaced without the route' },
      ),
    )
    await mustDeny(
      'an AUTHOR deleting a member post — taking live content down is the ' +
        'AGL-2334 `components` act in the other direction',
      deleteDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'memberPosts', 'agl2372-existing'),
      ),
    )

    // ── An unrelated principal ─────────────────────────────────────────────
    await mustDeny(
      'an OUTSIDER creating a member post on a host in another org',
      setDoc(
        doc(authed(OUTSIDER), 'hosts', HOST, 'memberPosts', 'agl2372-outside'),
        { title: 'Not my site' },
      ),
    )
    await mustDeny(
      'an OUTSIDER deleting a member post',
      deleteDoc(
        doc(authed(OUTSIDER), 'hosts', HOST, 'memberPosts', 'agl2372-existing'),
      ),
    )

    // ── An ABSENT role ─────────────────────────────────────────────────────
    // `hostMemberRole` returns `null` for a uid with no `memberRoles` entry,
    // and rules have their own null semantics — `null in [...]` is false, so
    // an absent role must refuse by the rule's own shape. LEGACY is the
    // sharpest version of the case available: it is a signed-in principal
    // present in the RETIRED `admins` uid-map and absent from `memberRoles`,
    // so a rule that fell back to the old map, or read a missing role as
    // permissive, would admit it here.
    await mustDeny(
      'a signed-in principal with NO memberRoles entry creating a member post',
      setDoc(
        doc(authed(LEGACY), 'hosts', HOST, 'memberPosts', 'agl2372-legacy'),
        { title: 'No role at all' },
      ),
    )
    await mustDeny(
      'a signed-in principal with NO memberRoles entry deleting a member post',
      deleteDoc(
        doc(authed(LEGACY), 'hosts', HOST, 'memberPosts', 'agl2372-existing'),
      ),
    )
    // A VIEWER is the role that already existed and must stay refused, so the
    // change cannot be read as having merely renamed the bottom of the scale.
    await mustDeny(
      'a VIEWER deleting a member post',
      deleteDoc(
        doc(authed(VIEWER), 'hosts', HOST, 'memberPosts', 'agl2372-existing'),
      ),
    )
  })

  /**
   * The regression guard, and the half that makes the deny above worth
   * having. A deny that breaks the product is worse than the hole it closes,
   * and the previous pass on AGL-2372 stopped precisely here: excluding this
   * collection wholesale breaks the console card's Delete button.
   */
  it('the member posts card still publishes and deletes (AGL-2372)', async () => {
    // The route. /api/commerce/member-post runs on the Admin SDK, which these
    // rules do not govern — the same bypass `withSecurityRulesDisabled` is.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'memberPosts', 'agl2372-card'),
        { title: 'Published by the route', createdAtMs: Date.now() },
      )
    })
    // The card lists posts client-side; the deny must not touch the read.
    await mustAllow(
      'an EDITOR listing member posts, which is what the card renders',
      getDocs(
        query(collection(authed(EDITOR), 'hosts', HOST, 'memberPosts'), limit(50)),
      ),
    )
    await mustAllow(
      'an AUTHOR listing member posts — the card is not role-gated and a ' +
        'read refusal would render it as an empty list with no error',
      getDocs(
        query(collection(authed(AUTHOR), 'hosts', HOST, 'memberPosts'), limit(50)),
      ),
    )
    // The Delete button, `deleteDoc` at member-posts-card.component.tsx:166,
    // for both roles the route's own allowlist admits.
    await mustAllow(
      'an EDITOR deleting a member post from the card',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'memberPosts', 'agl2372-card')),
    )
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'memberPosts', 'agl2372-card2'),
        { title: 'Published by the route', createdAtMs: Date.now() },
      )
    })
    await mustAllow(
      'a host ADMIN deleting a member post from the card',
      deleteDoc(doc(authed(OWNER), 'hosts', HOST, 'memberPosts', 'agl2372-card2')),
    )
  })

  /**
   * The structural half, stated by NAME beside the behavioural proof.
   *
   * A dedicated block that narrows an operation the catch-all still grants is
   * dead text, because Firestore ORs its allows and the looser branch wins.
   * That failure is invisible in a diff and invisible in a green behavioural
   * run of the ALLOW legs, so the lists are asserted directly.
   */
  it('`memberPosts` is denied create and update, with delete re-granted (AGL-2372)', () => {
    const lists = hostSubcollectionExclusions()
    assert.ok(
      lists.create.includes('memberPosts'),
      '`memberPosts` has fallen out of the host catch-all CREATE exclusion ' +
        'list, so an `author` refused by member-post.ts can addDoc the post ' +
        'straight from the browser — the f78705249 route fix is half a fix ' +
        'again.',
    )
    assert.ok(
      lists.update.includes('memberPosts'),
      '`memberPosts` has fallen out of the host catch-all UPDATE exclusion ' +
        'list. No client updates one, so this costs the product nothing and ' +
        'closes the in-place rewrite of a live post.',
    )
    assert.ok(
      lists.delete.includes('memberPosts'),
      '`memberPosts` has fallen out of the host catch-all DELETE exclusion ' +
        'list, so the dedicated block s `canPublishHostContent` delete gate ' +
        'no longer decides anything — sibling matches are OR d and the ' +
        'looser one wins. The AGL-2334 `components` shape.',
    )
    assert.ok(
      lists.dedicated.includes('memberPosts'),
      'the dedicated `match /memberPosts/{postId}` block is gone, so the ' +
        'delete exclusion above is now an outright denial and the console ' +
        'card s Delete button is broken for every customer.',
    )
    assert.ok(
      !hostServerOnlySubcollections().includes('memberPosts'),
      '`memberPosts` now reads as denied OUTRIGHT, which it is not — the ' +
        'dedicated block re-grants delete. If this fires, the block has been ' +
        'removed rather than the lists changed.',
    )
  })

  /**
   * URL redirects (AGL-1881) — the highest-ranked finding of the pre-launch
   * review, reported 2026-08-20.
   *
   * `redirects` was on the CREATE exclusion list and on neither of the other
   * two, and had no dedicated block. For this collection that ordering is
   * backwards: the console's create rides /api/hosts/resources, so the one
   * operation the exclusion covered was the one no client performs, while the
   * two that decide what a rule DOES — the editor's `setDoc(..., {merge})`
   * and the Delete button's `deletedAt` stamp — resolved on the catch-all's
   * `canWriteHostContent`, which has admitted `author` since AGL-2334.
   *
   * A redirect is evaluated before route resolution on every path of every
   * render; a regex rule's `source` can match every path at once, and its
   * `destination` may be an absolute URL. So one update to one document by
   * the narrowest role we sell decided what an entire site served, with no
   * publish step and no version pointer in the way.
   *
   * ⚠️ The exclusions are the MECHANISM. Drop `redirects` from either list and
   * the dedicated block below stops deciding anything at all, because sibling
   * matches are OR'd and the looser one wins — the `components` shape again.
   */
  it('an author cannot write a site-wide redirect (AGL-1881)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      assert.equal(
        (await getDoc(doc(db, 'hosts', HOST))).data().memberRoles[AUTHOR],
        'author',
        'the AUTHOR principal is no longer projected as `author` on the ' +
          'host, so this test can no longer reproduce the hole it exists ' +
          'to cover.',
      )
      // A rule a publisher created, which is what the update leg re-points.
      await setDoc(doc(db, 'hosts', HOST, 'redirects', 'agl1881-existing'), {
        source: '/old-page', destination: '/new-page',
        statusCode: 301, kind: 'exact', enabled: true,
      })
    })

    // ── The reported hole ──────────────────────────────────────────────────
    // Re-pointing an existing rule at an off-platform destination, widened to
    // every path. This is the whole finding, in one write.
    await mustDeny(
      'an AUTHOR re-pointing a redirect at an external destination — the ' +
        'traffic-hijack write AGL-1881 reported',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { source: '/(.*)', kind: 'regex', destination: 'https://elsewhere.example/$1' },
      ),
    )
    // The same write as a `setDoc(..., {merge: true})`, which is the shape the
    // console's editor actually sends — a deny proved only against
    // `updateDoc` would leave the real call site open.
    await mustDeny(
      'an AUTHOR merge-writing the same hijack, the console editor s shape',
      setDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: 'https://elsewhere.example' },
        { merge: true },
      ),
    )
    // An INTERNAL destination is refused too. The gate is the role, not the
    // destination: a rule that sends every path to `/` is the same routing
    // decision, and an author owning it would still be publishing.
    await mustDeny(
      'an AUTHOR re-pointing a redirect at an internal path',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: '/somewhere-else' },
      ),
    )
    await mustDeny(
      'an AUTHOR toggling a redirect on, which is the row switch',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { enabled: false },
      ),
    )
    await mustDeny(
      'an AUTHOR soft-deleting a publisher s redirect, the Delete button s write',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { deletedAt: new Date(), enabled: false },
      ),
    )
    await mustDeny(
      'an AUTHOR hard-deleting a redirect',
      deleteDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
      ),
    )
    await mustDeny(
      'an AUTHOR creating a redirect client-direct, bypassing the quota route',
      setDoc(doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-new'), {
        source: '/(.*)', destination: 'https://elsewhere.example/$1',
        statusCode: 302, kind: 'regex', enabled: true,
      }),
    )
    // Stamping its own approval is the same refusal, and worth its own row:
    // the serve path trusts that field, so a role that could write it could
    // launder an external destination past `matchRedirect`.
    await mustDeny(
      'an AUTHOR stamping externalDestinationApprovedBy on a redirect',
      updateDoc(
        doc(authed(AUTHOR), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { externalDestinationApprovedBy: AUTHOR },
      ),
    )

    // ── Every other principal that must stay out ───────────────────────────
    await mustDeny(
      'a VIEWER re-pointing a redirect',
      updateDoc(
        doc(authed(VIEWER), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: 'https://elsewhere.example' },
      ),
    )
    // LEGACY is signed in, is in the RETIRED `admins` uid-map, and has NO
    // `memberRoles` entry — so `hostMemberRole` returns null. `null in [...]`
    // is false in rules, which is the direction this must fail in with
    // `strictNullChecks` off everywhere else in the stack.
    await mustDeny(
      'a signed-in principal with NO memberRoles entry re-pointing a redirect',
      updateDoc(
        doc(authed(LEGACY), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: 'https://elsewhere.example' },
      ),
    )
    await mustDeny(
      'an OUTSIDER re-pointing a redirect on a host in another org',
      updateDoc(
        doc(authed(OUTSIDER), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: 'https://elsewhere.example' },
      ),
    )
    await mustDeny(
      'an ANONYMOUS caller re-pointing a redirect',
      updateDoc(
        doc(anon(), 'hosts', HOST, 'redirects', 'agl1881-existing'),
        { destination: 'https://elsewhere.example' },
      ),
    )
  })

  /**
   * The half that makes the deny above worth having. Redirects are a paid
   * feature with a console page; a fix that breaks it for the roles entitled
   * to use it is worse than the hole.
   */
  it('a publisher still manages redirects, external ones included (AGL-1881)', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      for (const id of ['agl1881-a', 'agl1881-b', 'agl1881-c', 'agl1881-d']) {
        await setDoc(doc(db, 'hosts', HOST, 'redirects', id), {
          source: `/${id}`, destination: '/new', statusCode: 301,
          kind: 'exact', enabled: true,
        })
      }
    })
    // The card is entitlement-gated, not role-gated, and READ is deliberately
    // left to the catch-all — a read deny would render an empty list rather
    // than a refusal anyone can see.
    await mustAllow(
      'an AUTHOR listing redirects, which is what the card renders',
      getDocs(
        query(collection(authed(AUTHOR), 'hosts', HOST, 'redirects'), limit(50)),
      ),
    )
    await mustAllow(
      'an EDITOR editing a redirect — the console s setDoc(merge) save',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'redirects', 'agl1881-a'),
        { source: '/old', destination: '/new', statusCode: 301, kind: 'exact', enabled: true },
        { merge: true },
      ),
    )
    // The documented external feature — "point old addresses at new pages or
    // outside URLs" — with the serve path's provenance stamp on it. If this
    // row ever goes red the fix has become "no external destinations", which
    // is not what was decided.
    await mustAllow(
      'an EDITOR pointing a redirect at an external URL and stamping it',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'redirects', 'agl1881-b'),
        {
          destination: 'https://campaign.example/launch',
          externalDestinationApprovedBy: EDITOR,
        },
        { merge: true },
      ),
    )
    await mustAllow(
      'an EDITOR soft-deleting a redirect, which is the Delete button',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'redirects', 'agl1881-c'), {
        deletedAt: new Date(), enabled: false,
      }),
    )
    await mustAllow(
      'a host ADMIN hard-deleting a redirect',
      deleteDoc(doc(authed(OWNER), 'hosts', HOST, 'redirects', 'agl1881-d')),
    )
    // Suspension still wins over the publish role — `hostWritesFrozen` is
    // inside the dedicated block, not only in the catch-all it replaced.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', LOCKED_HOST, 'redirects', 'agl1881-locked'),
        { source: '/x', destination: '/y', statusCode: 302, kind: 'exact' },
      )
    })
    await mustDeny(
      'an ADMIN editing a redirect on a host suspended at HOST scope',
      updateDoc(
        doc(authed(OWNER), 'hosts', LOCKED_HOST, 'redirects', 'agl1881-locked'),
        { destination: '/z' },
      ),
    )
  })

  /**
   * The structural half, stated by NAME beside the behavioural proof — the
   * `memberPosts` pattern above, and for the same reason: a dedicated block
   * under a looser sibling is dead text that no ALLOW leg can detect.
   */
  it('`redirects` is denied on all three catch-all lists (AGL-1881)', () => {
    const lists = hostSubcollectionExclusions()
    assert.ok(
      lists.create.includes('redirects'),
      '`redirects` has fallen out of the host catch-all CREATE exclusion ' +
        'list, so a redirect can be created client-direct — past the quota ' +
        'and past the publish-role check on /api/hosts/resources.',
    )
    assert.ok(
      lists.update.includes('redirects'),
      '`redirects` has fallen out of the host catch-all UPDATE exclusion ' +
        'list. This is the AGL-1881 hole itself: the console s editor is a ' +
        'client `setDoc(merge)`, so the catch-all s `canWriteHostContent` ' +
        'hands an `author` the destination of every rule on the site.',
    )
    assert.ok(
      lists.delete.includes('redirects'),
      '`redirects` has fallen out of the host catch-all DELETE exclusion ' +
        'list, so the dedicated block s publish gate no longer decides ' +
        'deletion — sibling matches are OR d and the looser one wins.',
    )
    assert.ok(
      lists.dedicated.includes('redirects'),
      'the dedicated `match /redirects/{redirectId}` block is gone, so the ' +
        'three exclusions above are now an outright denial and the redirects ' +
        'console page is broken for every paying customer.',
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

    /**
     * AGL-2092 added a THIRD billing-excluding `kind` — `'error'`, a screen
     * assigned to one of the host's four error slots — and it is exempt on the
     * same terms: the value is stamped only by /api/hosts/screens, as part of
     * binding a slot, bounded at four by the slot count.
     *
     * The freeze above is written on the FIELD, not on its values, so this
     * value arrived covered. That is the reason to assert it rather than assume
     * it: "the rule already covers the new case" is a claim about a rule
     * nobody re-read, and this repo has ~12 documented green checks that only
     * ever proved what they read.
     */
    it('an editor cannot declare a screen an error screen either', async () => {
      await seedScreens()
      // The bypass this would be: one write, no route call, the screen stops
      // counting against `screensPerHost` and — because `getScreen` serves
      // error screens — carries on rendering at its own address for free.
      await mustDeny(
        'screens/page-1 { kind: "error" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          kind: 'error',
        }),
      )
      // The return leg: promoting a cheaply-stamped error screen back to a page
      // without passing the cap gate /api/hosts/screens applies.
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'hosts', HOST, 'screens', 'error-1'),
          { displayName: 'Not found', kind: 'error', versionId: 'v1' },
        )
      })
      await mustDeny(
        'screens/error-1 { kind: "page" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'error-1'), {
          kind: 'page',
        }),
      )
      await mustDeny(
        'screens/error-1 { kind: deleteField() }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'error-1'), {
          kind: deleteField(),
        }),
      )
      // The positive control the deny must not have taken with it: an error
      // screen is an ordinary besigner document otherwise, and the console
      // renames, re-parents and soft-deletes it from the client SDK.
      await mustAllow(
        'screens/error-1 rename',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'error-1'), {
          displayName: 'Not found (v2)', updatedAt: new Date(),
        }),
      )
      await mustAllow(
        'screens/error-1 soft delete',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'error-1'), {
          deletedAt: new Date(),
        }),
      )
    })

    /**
     * AGL-1400 added the FOURTH billing-excluding `kind` — `'template'`, a
     * collection ENTRY template — and it is the one value this block never
     * named. The freeze is written on the FIELD, so the value arrived covered,
     * and the AGL-1400 comment in the `collections` block points here for its
     * entitlement half. But "the rule already covers the new case" is a claim
     * about a rule nobody re-read, and the coverage this file had was three
     * writes of `'email'` and three of `'error'` — never once the value whose
     * whole point is that it is not the client's to write.
     *
     * It matters more here than for the other two, because `kind: 'template'`
     * is the one exclusion `billableScreenIds` honours even for a ROUTED
     * screen. For `'email'` and `'error'` the routing map outranks the
     * document, so a client that could write them would still be paying for
     * anything it left published. A template opts out of that override — a
     * template is routed on purpose, so the map cannot arbitrate — which means
     * one `updateDoc` here would take a live, routed, serving page off
     * `screensPerHost` permanently and give the count nothing to notice.
     */
    it('an editor cannot declare a screen a collection entry template (AGL-1400)', async () => {
      await seedScreens()
      // The bypass: `page-1` is ROUTED (it carries a slug), and a template is
      // the one kind that keeps its exclusion while routed. So this single
      // write is a live page off the plan, permanently, with nothing to undo.
      await mustDeny(
        'screens/page-1 { kind: "template" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'page-1'), {
          kind: 'template',
        }),
      )
      // The return leg: promotion is checked exactly like a create by
      // /api/hosts/screens, and this is the door that would skip that gate.
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'hosts', HOST, 'screens', 'tmpl-1'),
          { displayName: 'Post', kind: 'template', versionId: 'v1' },
        )
      })
      await mustDeny(
        'screens/tmpl-1 { kind: "page" }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'tmpl-1'), {
          kind: 'page',
        }),
      )
      // Clearing the field promotes it just as surely, so it is denied too.
      await mustDeny(
        'screens/tmpl-1 { kind: deleteField() }',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'tmpl-1'), {
          kind: deleteField(),
        }),
      )
      // The ORG OWNER is refused as well, and the pair below is what makes
      // that assertion mean something. The cap is enforced against the org and
      // the owner is inside it, so a deny that only stopped editors would leave
      // the bypass open to the role that actually owns the billing page — but a
      // deny also passes for a principal who could not write the document at
      // all, so the allow proves this one can.
      await mustAllow(
        'screens/page-1 rename as owner',
        updateDoc(doc(authed(OWNER), 'hosts', HOST, 'screens', 'page-1'), {
          displayName: 'Pricing (v2)', updatedAt: new Date(),
        }),
      )
      await mustDeny(
        'screens/page-1 { kind: "template" } as owner',
        updateDoc(doc(authed(OWNER), 'hosts', HOST, 'screens', 'page-1'), {
          kind: 'template',
        }),
      )
      // The positive control the deny must not have taken with it: a template
      // is an ordinary besigner document otherwise, and AGL-1400's whole
      // settlement is that the collection POINTER at it is a free client write.
      await mustAllow(
        'screens/tmpl-1 rename',
        updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'tmpl-1'), {
          displayName: 'Post template (v2)', updatedAt: new Date(),
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
    // Datasets are content and the CRM is people, so the viewer's read stops
    // at the collection above. Owner reads the same contact two lines down,
    // which is what keeps this a statement about the role.
    await assertFails(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c1')))
    await assertSucceeds(getDoc(doc(authed(OWNER), 'orgs', ORG, 'contacts', 'c1')))
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

  /**
   * Enrolling is API-only; removing is not.
   *
   * A member document carries the consent basis that says why this person may
   * be mailed. A browser that can write one can write `marketingConsent: true`
   * beside an address nothing has checked — no stored opt-in consulted, no
   * suppression list consulted, and nothing afterwards to tell it apart from a
   * basis somebody actually gave. So the CREATE and the UPDATE belong to the
   * route that runs the shared enrollment policy, and only the DELETE is the
   * client's: taking somebody off a list needs no basis.
   *
   * Asserted from the OWNER, who holds every org-wide write there is. A denial
   * proved only against a viewer or a scoped collaborator would be a denial of
   * their role rather than of the operation.
   */
  it('list membership: create/update are API-only, delete is not (AGL-254)', async () => {
    // THE CONTROL. The same account, on the same collection, doing the thing
    // that IS allowed — without it every assertion below passes for an owner
    // who simply cannot reach this path at all.
    await assertSucceeds(
      getDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')),
    )

    // A membership minted in the browser, consent field and all.
    await assertFails(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm2'), {
        email: 'new@y.z',
        marketingConsent: true,
        marketingConsentBasis: 'contact-opt-in',
      }),
    )
    // The same act against a row that already exists: an UPDATE is the other
    // half of the same hole, and a rule that closed only the create would let
    // a client add the consent field to any enrollment it can name.
    await assertFails(
      updateDoc(
        doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm1'),
        { marketingConsent: true },
      ),
    )
    await assertFails(
      setDoc(
        doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm1'),
        { marketingConsent: true },
        { merge: true },
      ),
    )

    // Removal stays the client's. Console list management is what needs it,
    // and it is not suppression: nothing here writes the list that stops mail.
    await assertSucceeds(
      deleteDoc(doc(authed(OWNER), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')),
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
 * A LIST IS METADATA; ITS `members` ARE PEOPLE, and the two reads differ for
 * exactly that reason.
 *
 * An enrollment document carries an address, a name and the consent record
 * that says why this person may be mailed — the basis, the moment it was
 * given, and the console account that attested to it. `isOrgWideMember()` is
 * the ROSTER question and has no role in it, so a rule that asks only that
 * hands every audience the workspace has, and everybody on it, to an org
 * VIEWER — the role whose whole definition is reading and changing nothing.
 * The Emails console admits nobody to that page without `data.manage`, and
 * the rule underneath asks the same thing, which is what makes the page gate
 * defense in depth instead of the only door.
 *
 * The list DOCUMENT keeps the roster-only read on purpose, and the tests below
 * assert the split rather than assuming it: the document holds a name, a kind
 * and a selection rule, it names no human, and four surfaces outside the
 * Emails console read it so a campaign row, a workflow step and the
 * reference-health card can print a name instead of an id.
 */
describe('audience membership is people data; the list document is not', () => {
  // The org-wide shapes the fixtures did not have. EDITOR is `allHosts: false`
  // — a site collaborator — so a denial proved against them proves AGL-1026
  // and says nothing about the ROLE, which is the axis under test here.
  const ORG_ADMIN = 'uid-org-admin'
  const ORG_EDITOR = 'uid-org-editor'
  // Org-wide editors that differ from ORG_EDITOR only in the permission maps
  // `memberResolves` reads: the resolved projection a custom role produces,
  // the raw per-member override it falls back to, a map that never mentions
  // the key, and the pair that proves which of the two leads.
  const CUSTOM_ROLE_EDITOR = 'uid-org-editor-role-revokes-data-manage'
  const REVOKED_EDITOR = 'uid-org-editor-data-manage-revoked'
  const UNRELATED_OVERRIDES_EDITOR = 'uid-org-editor-other-overrides'
  const REGRANTED_EDITOR = 'uid-org-editor-resolved-regrants'

  const enrollment = (uid) =>
    doc(authed(uid), 'orgs', ORG, 'lists', 'l1', 'members', 'm1')
  const enrollments = (uid) =>
    collection(authed(uid), 'orgs', ORG, 'lists', 'l1', 'members')
  const listDoc = (uid) => doc(authed(uid), 'orgs', ORG, 'lists', 'l1')

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'members', ORG_ADMIN), {
        role: 'admin', allHosts: true, scopeTokens: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'members', ORG_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
      })
      // A CUSTOM ROLE's revocation, as `syncOrgAuthProjections` stamps it:
      // the resolver's own output, all three layers already applied.
      await setDoc(doc(db, 'orgs', ORG, 'members', CUSTOM_ROLE_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        roleId: 'role-read-only-data',
        resolvedPermissions: { 'data.manage': false, 'plugins.install': true },
      })
      // The per-member override layer, on a member the projection has not
      // reached — the fallback `memberResolves` reads second.
      await setDoc(doc(db, 'orgs', ORG, 'members', REVOKED_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        permissions: { 'data.manage': false },
      })
      await setDoc(doc(db, 'orgs', ORG, 'members', UNRELATED_OVERRIDES_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        permissions: { 'billing.view': false, 'plugins.install': false },
      })
      // The two maps disagreeing. `resolvedPermissions` is the resolver's
      // ANSWER and has already applied the per-member layer, so it leads —
      // reading the raw override on a member that carries both would report a
      // revocation the resolver did not make.
      await setDoc(doc(db, 'orgs', ORG, 'members', REGRANTED_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        permissions: { 'data.manage': false },
        resolvedPermissions: { 'data.manage': true },
      })
      // A dynamic list: a name and a rule, and not one person's details on it.
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1'), {
        name: 'Lapsed customers', kind: 'dynamic',
        rule: { sources: ['contacts'], behavior: { noPurchaseForDays: 180 } },
      })
      // An enrollment with the fields the denial is actually about: the
      // address, and an ATTESTATION naming the account answerable for it.
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1', 'members', 'm1'), {
        email: 'buyer@example.test', name: 'A Buyer',
        marketingConsent: true,
        consent: {
          basis: 'operator-attested', atMs: 1,
          byUid: OWNER, reason: 'badge scanned at a trade show',
        },
      })
      // A second row so the collection query has something to page over and
      // cannot pass by being empty.
      await setDoc(doc(db, 'orgs', ORG, 'lists', 'l1', 'members', 'm2'), {
        email: 'other@example.test',
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'c1'), {
        email: 'buyer@example.test', visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1'), {
        name: 'Team', visibleTo: ['org'],
      })
    })
  })

  /**
   * The gap this closes, and the controls that stop it reading as a vacuous
   * pass. The viewer is a full org-wide member: they read the org's contacts,
   * its datasets and the list document itself in the same test, so the denial
   * is about THIS collection and not about an account that cannot reach the
   * org at all.
   */
  it('an org-wide VIEWER is refused an enrollment, and still reads the rest', async () => {
    await mustDeny(
      'an org-wide viewer reading one enrollment',
      getDoc(enrollment(VIEWER)),
    )
    // The shape the console actually uses: the members panel subscribes to
    // the collection and the audiences card counts it. A rule that denied
    // only the document read would leave both working.
    await mustDeny(
      'an org-wide viewer listing a list\'s enrollments',
      getDocs(enrollments(VIEWER)),
    )

    // THE CONTROLS. Same account, same org, two reads that must survive.
    await mustAllow(
      'the same viewer reading the LIST document (the name a campaign row shows)',
      getDoc(listDoc(VIEWER)),
    )
    await mustAllow(
      'the same viewer reading an org dataset',
      getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds1')),
    )
    // The CRM answers to the same permission this enrollment does, so the
    // viewer is refused there too. Asserted here rather than dropped: the
    // enrollment denial's argument is that a list's PEOPLE are not its name,
    // and a contact sitting readable beside a refused enrollment would have
    // undercut it.
    await mustDeny(
      'the same viewer reading an org contact',
      getDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c1')),
    )
  })

  /**
   * The other half of the same rule: everybody the product needs here keeps
   * working. A narrowing that broke the audiences page would be worse than
   * the hole it closed.
   */
  it('owner, admin and an ORG-WIDE editor read and manage enrollments', async () => {
    for (const [label, uid] of [
      ['the owner', OWNER],
      ['an org-wide admin', ORG_ADMIN],
      ['an org-wide editor', ORG_EDITOR],
      ['an org-wide editor whose overrides never mention data.manage',
        UNRELATED_OVERRIDES_EDITOR],
    ]) {
      await mustAllow(`${label} reading one enrollment`, getDoc(enrollment(uid)))
      await mustAllow(`${label} listing enrollments`, getDocs(enrollments(uid)))
    }
    // Removal is the client's, and it is the write that has to follow the
    // read: whoever may see who is on a list may take them off it.
    await mustAllow(
      'an org-wide editor removing an enrollment',
      deleteDoc(enrollment(ORG_EDITOR)),
    )
  })

  /**
   * AGL-1026, unchanged. A collaborator invited to one site is refused the
   * whole audience — the list document as well as its people — because an
   * audience has no per-site slice: it belongs to the org and every host in
   * it may mail the same list.
   */
  it('a site collaborator is still refused the list AND its enrollments', async () => {
    await mustDeny(
      'a scoped editor reading the list document',
      getDoc(listDoc(EDITOR)),
    )
    await mustDeny(
      'a scoped editor reading an enrollment',
      getDoc(enrollment(EDITOR)),
    )
    await mustDeny(
      'a scoped author reading an enrollment',
      getDoc(enrollment(AUTHOR)),
    )
    await mustDeny(
      'an outsider reading an enrollment',
      getDoc(enrollment(OUTSIDER)),
    )
    // THE CONTROL: the collaborator is a real member of this org and reads
    // the org-wide data they were invited for. Without it the three denials
    // above would pass against an account with no membership at all.
    await mustAllow(
      'the same scoped editor reading an org-wide dataset',
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1')),
    )
  })

  /**
   * The permission layer, which is what makes this rule agree with the Emails
   * console rather than merely resemble it: the page resolves `data.manage`,
   * and a member whose resolved verdict is `false` is refused by both.
   *
   * Both halves of `memberResolves` are exercised — the `resolvedPermissions`
   * projection a custom role produces, and the raw `permissions` override it
   * falls back to on a member the projection has not reached.
   *
   * DEFAULT TRUE is the safety argument, so the controls are the point of the
   * test: no map at all, and a map that names other keys, both still read. An
   * absent key must never read as `false`.
   */
  it('a revoked data.manage is honored on both layers; an absent one is not a denial', async () => {
    await mustDeny(
      'an editor whose CUSTOM ROLE revokes data.manage reading an enrollment',
      getDoc(enrollment(CUSTOM_ROLE_EDITOR)),
    )
    await mustDeny(
      'an org-wide editor whose per-member override revokes it',
      getDoc(enrollment(REVOKED_EDITOR)),
    )
    await mustDeny(
      'the same member removing an enrollment',
      deleteDoc(enrollment(REVOKED_EDITOR)),
    )
    // The projection is the resolver's ANSWER and has already applied the
    // per-member layer, so it leads rather than being ORed with it.
    await mustAllow(
      'an editor whose projection GRANTS what their raw override revokes',
      getDoc(enrollment(REGRANTED_EDITOR)),
    )
    // The override governs the PEOPLE, not the audience's name — the list
    // document is metadata and stays on the roster question.
    await mustAllow(
      'the same member reading the list document',
      getDoc(listDoc(REVOKED_EDITOR)),
    )
    // The two default-true controls.
    await mustAllow(
      'the owner, who carries no permissions map at all',
      getDoc(enrollment(OWNER)),
    )
    await mustAllow(
      'an editor whose permissions map never mentions data.manage',
      getDoc(enrollment(UNRELATED_OVERRIDES_EDITOR)),
    )
  })

  /**
   * Suspension freezes writing, not looking. A workspace that may not read
   * its own audience may not export it either, and winding down is precisely
   * when that is asked for — so the read helper deliberately leaves
   * `orgNotSuspended()` to the write half.
   */
  it('a suspended org still READS its audience and cannot change it', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), 'orgs', ORG, 'members', ORG_EDITOR),
        { orgSuspended: true },
      )
    })
    await mustAllow(
      'a suspended org-wide editor reading an enrollment',
      getDoc(enrollment(ORG_EDITOR)),
    )
    await mustDeny(
      'a suspended org-wide editor removing an enrollment',
      deleteDoc(enrollment(ORG_EDITOR)),
    )
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
   * NOBODY reads the org activity log from a client any more (AGL-2444).
   *
   * The rule was `isOrgWideMember()`, which is the ROSTER question and knows
   * nothing about the `org.auditLog` permission — so revoking that permission
   * in a custom role hid the console card and left the collection readable
   * from any Firestore client. `/api/orgs/activity` checks the permission
   * with the Admin SDK, and this denial is what makes that check the access
   * control rather than a second opinion on one.
   *
   * The org-wide VIEWER is the case that matters: they pass every roster
   * check the old rule made, so a rule that still granted them would leave
   * the hole exactly where it was.
   */
  it('and NO org-wide member reads it directly either — the route is the door', async () => {
    await assertFails(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'activity', 'a1')))
    await assertFails(getDoc(doc(authed(OWNER), 'orgs', ORG, 'activity', 'a1')))
    // The paired control: the same reader still gets the org data the rules
    // are genuinely responsible for, so this is a targeted denial rather than
    // an org that stopped being readable.
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
  // AGL-2131. `staffRole()` defaulted to 'super' here long after AGL-495 made
  // every /api/admin/* route default to 'support', so ONE claim-less staff
  // token was simultaneously super at the rules layer and support at the
  // handlers. This pins the default at the least privilege, and it is the
  // assertion that fails against `token.get('staffRole', 'super')`.
  it('a staff token with NO staffRole gets support, not super', async () => {
    const rolelessDb = authed(STAFF, { staff: true })
    const superDb = authed(STAFF, { staff: true, staffRole: 'super' })
    // The negative control's twin: the same write, under an EXPLICIT super
    // role, must still succeed — otherwise this case would also pass against
    // rules that denied staff everything.
    await assertSucceeds(
      updateDoc(doc(superDb, 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
    await mustDeny(
      'a role-less staff token taking the super branch on orgs/{orgId}',
      updateDoc(doc(rolelessDb, 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
    // And it does not fall through to the billing branch either: `name` is
    // the key that branch may still write, and support may not.
    await mustDeny(
      'a role-less staff token taking the billing branch on orgs/{orgId}',
      updateDoc(doc(rolelessDb, 'orgs', ORG), { name: 'Roleless Rename' }),
    )
    // Plain `isStaff()` surfaces are UNAFFECTED — the role only ever gated
    // the org doc, and a claim-less account must keep its read access or the
    // migration this default was protecting turns into a lockout.
    await assertSucceeds(getDoc(doc(rolelessDb, 'orgs', ORG)))
  })

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
    // AGL-2471. `stripeAccountLivemode` is an INPUT to the sale gate: an owner
    // who could write it could assert their own test-mode account into live
    // readiness and rebuild the exact defect that shipped three unusable
    // storefronts. `stripePayoutsEnabled` was left writable when AGL-1547
    // added it — a seller could forge their own "payouts are enabled" banner.
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripeAccountLivemode: true,
      }),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripePayoutsEnabled: true,
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
    // AGL-2471: the field the marketplace sale gate compares against the
    // platform's Stripe mode. Writable by a publisher, it would let a
    // test-mode account sell.
    await assertFails(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        stripeAccountLivemode: true,
      }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'publisherProfiles', ORG), {
        stripePayoutsEnabled: true,
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

/**
 * The other two §512 collections (AGL-1983), held to the same posture as the
 * queue above and for sharper reasons.
 *
 * A counter-notice's evidentiary value is that the text is exactly what was
 * sworn, at the time it says — and `receivedAtMs` is the instant the
 * 10-to-14 business day put-back clock counts from, so a client that could
 * write it could move its own restoration date in either direction. The
 * strike ledger is the account-termination condition of the whole safe
 * harbour, so a client that could write it could delete its own strikes.
 *
 * `dmcaStrikes` was already deny-all by the ABSENCE of a rule — there is no
 * catch-all under `orgs/{orgId}` — and the block exists so that stays true
 * the day somebody adds a convenience wildcard. This test is what would go
 * red if they did.
 */
describe('the §512 counter-notice and strike ledger are staff-read, nobody-write (AGL-1983)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'dmcaCounterNotices', 'cn-1'), {
        reference: 'CN-ABC1234567', status: 'received',
        url: 'https://acme.aglyn.app/gallery', hostId: HOST, orgId: ORG,
        subscriberName: 'Dana Okonkwo',
        subscriberAddress: '128 Rue Example, Austin, TX',
        subscriberPhone: '+1 512 555 0134',
        receivedAtMs: Date.now() - 2 * 86_400_000,
      })
      await setDoc(doc(db, 'orgs', ORG, 'dmcaStrikes', 'report-1'), {
        reportId: 'report-1', url: 'https://acme.aglyn.app/gallery',
        withdrawnAt: null,
      })
    })
  })

  it('staff read a counter-notice; nobody else does, including its own filer’s org', async () => {
    await mustAllow(
      'staff reading a counter-notice',
      getDoc(doc(authed(STAFF, { staff: true }), 'dmcaCounterNotices', 'cn-1')),
    )
    // The intake is unauthenticated, so there is no uid on the row to match a
    // reader against — admitting one would be admitting an unverified claim
    // to be that person. The row also carries a home address and a phone
    // number §512(g)(3)(D) forced the filer to supply.
    for (const uid of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
      await mustDeny(
        `${uid} reading a counter-notice filed about their own site`,
        getDoc(doc(authed(uid), 'dmcaCounterNotices', 'cn-1')),
      )
    }
    await mustDeny(
      'an anonymous visitor reading a counter-notice',
      getDoc(
        doc(env.unauthenticatedContext().firestore(), 'dmcaCounterNotices', 'cn-1'),
      ),
    )
  })

  it('nobody writes a counter-notice from a client — staff included', async () => {
    for (const [label, db] of [
      ['an anonymous visitor', env.unauthenticatedContext().firestore()],
      ['a site owner', authed(OWNER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} forging a counter-notice at a chosen id`,
        setDoc(doc(db, 'dmcaCounterNotices', 'forged-1'), {
          status: 'received', url: 'https://acme.aglyn.app/gallery',
          receivedAtMs: 1,
        }),
      )
      // The sharpest one: `receivedAtMs` IS the statutory clock. Moving it
      // back would bring a restoration forward; moving it on would push a
      // customer's put-back out.
      await mustDeny(
        `${label} moving a counter-notice's receipt instant`,
        updateDoc(doc(db, 'dmcaCounterNotices', 'cn-1'), { receivedAtMs: 1 }),
      )
      await mustDeny(
        `${label} rewriting what was sworn`,
        updateDoc(doc(db, 'dmcaCounterNotices', 'cn-1'), {
          material: 'Something else entirely',
        }),
      )
      await mustDeny(
        `${label} deleting a counter-notice`,
        deleteDoc(doc(db, 'dmcaCounterNotices', 'cn-1')),
      )
    }
  })

  it('staff read the strike ledger; the counted org does not', async () => {
    await mustAllow(
      'staff reading the strike ledger',
      getDoc(doc(authed(STAFF, { staff: true }), 'orgs', ORG, 'dmcaStrikes', 'report-1')),
    )
    // Not secrecy for its own sake — §512(i) requires subscribers to be
    // INFORMED of the policy, and the published policy plus a per-strike
    // notice does that. What the raw ledger adds is the complainants'
    // identities and an exact live count an org could time its behaviour
    // against.
    for (const uid of [OWNER, EDITOR, VIEWER, OUTSIDER]) {
      await mustDeny(
        `${uid} reading their own workspace's strike ledger`,
        getDoc(doc(authed(uid), 'orgs', ORG, 'dmcaStrikes', 'report-1')),
      )
    }
  })

  it('nobody deletes their own strikes', async () => {
    // The account-termination condition of the entire safe harbour. A client
    // able to write here could clear the ledger that decides it.
    for (const [label, db] of [
      ['an anonymous visitor', env.unauthenticatedContext().firestore()],
      ['the org owner', authed(OWNER)],
      ['an editor', authed(EDITOR)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} deleting a strike`,
        deleteDoc(doc(db, 'orgs', ORG, 'dmcaStrikes', 'report-1')),
      )
      await mustDeny(
        `${label} marking a strike withdrawn from the client`,
        updateDoc(doc(db, 'orgs', ORG, 'dmcaStrikes', 'report-1'), {
          withdrawnAt: new Date(),
        }),
      )
      await mustDeny(
        `${label} writing a strike ledger row directly`,
        setDoc(doc(db, 'orgs', ORG, 'dmcaStrikes', 'invented'), {
          reportId: 'invented',
        }),
      )
    }
  })
})

/**
 * The SSO domain claim, and the field AGL-1887 added to it.
 *
 * `publishSsoDomains` will publish a domain on EITHER of two markers now:
 * `verified === true` (DNS proof this platform re-checked) or a non-empty
 * string `attestedBy` (a named staff member vouching, for the orgs onboarded
 * by hand before self-serve). That second marker is what reopened the one-way
 * door AGL-1375 left — and it is only as trustworthy as the answer to "who
 * can write it".
 *
 * The answer has to be NOBODY client-side. `attestedBy` is a claim of
 * ownership that skips the DNS proof entirely, so an org that could set it on
 * its own claim document could publish `ssoDomains/{domain}` for a domain it
 * does not own — and every sign-in on that domain would route to its IdP.
 * That is the whole account-takeover vector the `verified` check exists to
 * plug, and widening the gate without pinning the writer would have handed it
 * over.
 *
 * So this suite is the other half of the feature, not a nicety. The block at
 * `orgs/{orgId}/ssoDomains/{domain}` is `allow read, write: if false` — staff
 * included, because `attestSsoDomain` and `tools/scripts/attest-sso-domain.mjs`
 * go through the Admin SDK, which bypasses rules. A staff session in a browser
 * is still a browser, and there is no reason for it to hold the write.
 *
 * The read denial is older (AGL-1210) and stands for a different reason: the
 * claim carries the DNS challenge token, and anyone who can read another org's
 * token can publish it as their own TXT record.
 */
describe('an SSO domain attestation is unwritable from any client (AGL-1887)', () => {
  const DOMAIN = 'acme.test'
  const claimPath = (orgId = ORG) => ['orgs', orgId, 'ssoDomains', DOMAIN]

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // A claim midway through the honest path: token issued, DNS not proved.
      // This is exactly the document an attacker wants one field added to.
      await setDoc(doc(db, ...claimPath()), {
        domain: DOMAIN,
        token: 'challenge-token-nobody-else-may-see',
        verified: false,
        createdAt: Date.now(),
      })
      await setDoc(doc(db, 'ssoDomains', DOMAIN), {
        orgId: ORG, tenantId: 'org-acme-t1', providerId: 'saml.acme',
        protocol: 'saml', active: true,
      })
    })
  })

  it('nobody adds attestedBy to their own claim — owner, editor, staff alike', async () => {
    // The sharpest case in the file: the org owner, on their OWN org's claim
    // document, for a domain their org already legitimately routes. Every
    // instinct about ownership says yes and the answer is still no, because
    // the same write shape works just as well on a domain they do not own.
    for (const [label, db] of [
      ['an anonymous visitor', anon()],
      ['the org owner', authed(OWNER)],
      ['an editor', authed(EDITOR)],
      ['an outsider', authed(OUTSIDER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} adding attestedBy to orgs/${ORG}/ssoDomains/${DOMAIN}`,
        updateDoc(doc(db, ...claimPath()), { attestedBy: 'uid-not-staff' }),
      )
      await mustDeny(
        `${label} attesting a claim into existence at a chosen domain`,
        setDoc(doc(db, 'orgs', ORG, 'ssoDomains', 'someone-else.test'), {
          domain: 'someone-else.test', attestedBy: 'uid-not-staff',
        }),
      )
      // `verified` is the older half of the same gate. A fix that pinned
      // `attestedBy` and left this open would have closed nothing.
      await mustDeny(
        `${label} marking their own claim DNS-verified`,
        updateDoc(doc(db, ...claimPath()), { verified: true }),
      )
      await mustDeny(
        `${label} deleting a claim to start it over`,
        deleteDoc(doc(db, ...claimPath())),
      )
    }
  })

  it('an outsider cannot plant an attestation on ANOTHER org’s claim', async () => {
    // The cross-org shape, spelled out separately: `OTHER_ORG` is a real org
    // this uid genuinely owns, so nothing about the request looks anomalous
    // except the path it points at.
    await mustDeny(
      `${OUTSIDER} attesting a domain onto ${OTHER_ORG}`,
      setDoc(doc(anon(), 'orgs', OTHER_ORG, 'ssoDomains', DOMAIN), {
        domain: DOMAIN, attestedBy: OUTSIDER,
      }),
    )
    await mustDeny(
      `${OUTSIDER} attesting ${DOMAIN} onto the org that already routes it`,
      setDoc(doc(authed(OUTSIDER), ...claimPath()), {
        domain: DOMAIN, attestedBy: OUTSIDER,
      }),
    )
  })

  it('nobody reads a claim, because the token in it is the ownership proof', async () => {
    // AGL-1210's half. The console reaches claims through /api/orgs/sso,
    // which returns one only to an admin of THAT org.
    for (const [label, db] of [
      ['an anonymous visitor', anon()],
      ['the org owner', authed(OWNER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} reading the challenge token on orgs/${ORG}/ssoDomains/${DOMAIN}`,
        getDoc(doc(db, ...claimPath())),
      )
    }
  })

  it('the routing document itself takes no client write either', async () => {
    // The claim is the gate; this is what the gate opens. Left writable, the
    // attestation would be an obstacle to walk around rather than a lock.
    for (const [label, db] of [
      ['an anonymous visitor', anon()],
      ['the org owner', authed(OWNER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} pointing ${DOMAIN} routing at their own tenant`,
        updateDoc(doc(db, 'ssoDomains', DOMAIN), { orgId: OTHER_ORG }),
      )
      await mustDeny(
        `${label} publishing routing for a domain outright`,
        setDoc(doc(db, 'ssoDomains', 'unclaimed.test'), {
          orgId: ORG, tenantId: 'org-acme-t1', active: true,
        }),
      )
      await mustDeny(
        `${label} reading who ${DOMAIN} routes to`,
        getDoc(doc(db, 'ssoDomains', DOMAIN)),
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
    // An entry UPDATE, not a create (AGL-2266). Creating one is now denied
    // outright by the entries block, so a create here would pass whether or
    // not suspension worked — a guard that cannot fail. The update is the leg
    // this test is actually about, and `e1` exists in the LOCKED_HOST fixture.
    await mustDeny(
      'a collection entry update on a suspended site',
      updateDoc(
        doc(editor(), 'hosts', LOCKED_HOST, 'collections', 'col-1', 'entries', 'e1'),
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
    // The twin of the `col-1/entries/e1` deny on LOCKED_HOST above, and it has
    // to be an UPDATE for the pair to isolate the freeze: entry CREATE stopped
    // being a client operation at all in AGL-2266 (/api/hosts/resources owns it
    // and holds `ENTRIES_MAX_PER_COLLECTION`), so a create here would fail on a
    // healthy site too and would say nothing about `hostWritesFrozen`.
    await mustAllow(
      'an editor updating a collection entry on a healthy site',
      updateDoc(
        doc(editor(), 'hosts', HOST, 'collections', 'col-1', 'entries', 'entry-draft'),
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
 * THE PLATFORM PANIC BUTTON REACHES THE CLIENT SDK (AGL-1881).
 *
 * `lockdowns/platform` stopped every server-owned surface — pages 503 in
 * ~30s, Admin-SDK routes 423 in ~15s — and stopped the client SDK not at
 * all. `hostWritesFrozen()` was `hostSuspended() || hostOrgSuspended()`, and
 * neither of those reads `/lockdowns/platform`. So a besigner tab already
 * open kept `updateDoc`-ing `hosts/{h}/screens/{s}` straight past the panic
 * button, indefinitely — not for one token lifetime, forever, because no
 * part of the client write path ever consulted the lock. That is the exact
 * hole AGL-1965 closed for host scope and AGL-238 for org scope, left open
 * on the WIDEST scope, which is the one staff pull during a live compromise.
 *
 * Three cases, and each is load-bearing:
 *
 *  - **locked → a member's write is refused.** The bug.
 *  - **locked → STAFF still write.** The un-panic invariant from AGL-1501:
 *    a platform lockdown must never lock out the people who can lift it. It
 *    holds here for free — `isStaff()` is the first disjunct of every rule,
 *    so the staff path short-circuits before `hostWritesFrozen()` is
 *    evaluated and never pays the lock's read at all.
 *  - **expired → writes land again.** `untilMs` is an expiry that passes
 *    with no write, exactly as `suspendedUntilMs` does on the org and host
 *    carriers. The predicate shares `lockWindowActive()` with them rather
 *    than restating "active", so the three levers cannot drift.
 *
 * The fixture writes the doc the way /api/admin/lockdown leaves it, with
 * rules disabled — no client may write this collection (asserted above), and
 * a lock the test could set from a client would be a lock anyone could lift.
 */
describe('a platform lockdown freezes client writes (AGL-1881)', () => {
  const lockPlatform = async (fields) => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lockdowns', 'platform'), {
        scope: 'platform',
        reason: 'security',
        message: 'Back soon',
        lockedAtMs: Date.now(),
        ...fields,
      })
    })
  }

  it('a member cannot publish while the platform lock is up', async () => {
    await mustAllow(
      'an editor publishing BEFORE the lock — the positive control',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home',
      }),
    )
    await lockPlatform()
    await mustDeny(
      'an editor updating a screen during a platform lockdown',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home, edited through the panic button',
      }),
    )
    await mustDeny(
      'an editor saving canvas nodes during a platform lockdown',
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'),
        { nodes: { root: { text: 'still editing' } } },
        { merge: true },
      ),
    )
    await mustDeny(
      'an admin moving the live `screens` pointer during a platform lockdown',
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        screens: { 'screen-1': { versionId: 'v1', path: '/' } },
      }),
    )
  })

  it('STAFF still write — the un-panic invariant (AGL-1501)', async () => {
    await lockPlatform()
    const staffDb = authed(STAFF, { staff: true })
    await mustAllow(
      'staff updating a screen during a platform lockdown',
      updateDoc(doc(staffDb, 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Staff working inside the lock',
      }),
    )
    await mustAllow(
      'staff moving the live `screens` pointer during a platform lockdown',
      updateDoc(doc(staffDb, 'hosts', HOST), {
        screens: { 'screen-1': { versionId: 'v1', path: '/' } },
      }),
    )
  })

  it('an EXPIRED platform lock stops freezing, with no write to lift it', async () => {
    await lockPlatform({ untilMs: Date.now() - AN_HOUR })
    await mustAllow(
      'an editor publishing after the platform lock expired',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home, restored',
      }),
    )
  })

  it('a STILL-RUNNING timed platform lock keeps freezing', async () => {
    // Without this, the case above passes just as well against a predicate
    // that reads every lock as expired — which is the fix deleting itself.
    await lockPlatform({ untilMs: Date.now() + AN_HOUR })
    await mustDeny(
      'an editor publishing during a timed platform lockdown',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home, edited',
      }),
    )
  })

  it('a MALFORMED expiry leaves the lock standing', async () => {
    // The `suspensionActive()` posture, shared: the field is Admin-SDK-only,
    // so a non-number can only arrive through our own bug, and failing
    // closed is the right way round to be wrong about a panic button.
    await lockPlatform({ untilMs: 'soon' })
    await mustDeny(
      'an editor publishing under a lock with a junk expiry',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home, edited',
      }),
    )
  })

  it('no platform doc means no freeze — the everyday path is untouched', async () => {
    await mustAllow(
      'an editor publishing with no platform lockdown document at all',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), {
        name: 'Home',
      }),
    )
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
        orgAdminDenied().includes(key),
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
/**
 * AGL-2269. `hosts/{hostId}/inventoryAdjustments` is an append-only LEDGER and
 * was in none of the catch-all's exclusion lists, so any host admin or editor
 * could rewrite or delete a row from the browser.
 *
 * It is load-bearing rather than historical. `cancel-order.ts` reads its
 * `reason: 'sale'` rows to decide whether a POS card order decremented at all,
 * and caps the units it releases at each row's `appliedDelta` (AGL-2149) so a
 * backordered sale cannot be cancelled into stock nobody has. A row a client
 * can forge or delete changes how much inventory a cancellation invents.
 */
describe('the inventory ledger is append-only (AGL-2269)', () => {
  const ROW = 'adj-1'

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'inventoryAdjustments', ROW),
        {
          productId: 'prod-1',
          variantId: 'var-1',
          delta: -3,
          appliedDelta: -3,
          reason: 'sale',
          orderId: 'order-1',
          atMs: 1_755_000_000_000,
        },
      )
    })
  })

  it('no client rewrites or deletes a ledger row', async () => {
    await mustDeny(
      'the site ADMIN rewriting what a sale took off the shelf',
      updateDoc(
        doc(authed(OWNER), 'hosts', HOST, 'inventoryAdjustments', ROW),
        { appliedDelta: -30 },
      ),
    )
    await mustDeny(
      'the EDITOR changing the reason a cancellation reads',
      updateDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'inventoryAdjustments', ROW),
        { reason: 'correction' },
      ),
    )
    await mustDeny(
      'the site ADMIN deleting the row a cancellation is capped by',
      deleteDoc(doc(authed(OWNER), 'hosts', HOST, 'inventoryAdjustments', ROW)),
    )
  })

  /**
   * POSITIVE CONTROL, and the reason this is an append-only rule rather than a
   * server-only one: the products hub writes a row client-side beside every
   * manual stock edit, and appending is what a ledger is for.
   */
  it('POSITIVE CONTROL: the products hub still appends a row', async () => {
    await mustAllow(
      "the products hub's manual adjustment row",
      setDoc(
        doc(authed(EDITOR), 'hosts', HOST, 'inventoryAdjustments', 'adj-new'),
        {
          productId: 'prod-1',
          variantId: 'var-1',
          delta: 5,
          reason: 'correction',
          atMs: 1_755_000_001_000,
        },
      ),
    )
  })
})

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

  /**
   * AGL-2233. The rule said `hasAny(['status'])`, i.e. "anything but the
   * status", while the paragraph above it described an allowlist of the two
   * writers the console actually has. Everything else on an order was
   * therefore client-writable, and an order carries the money.
   *
   * Each assertion below is a distinct way to take money, not a variation on
   * one: the refund cap, the chargeback reversal, the seller-share marker,
   * the supplier bearer token, and the download cap.
   */
  it('no client rewrites the money on an order', async () => {
    await mustDeny(
      'the site ADMIN zeroing refundedCents (resets the over-refund cap)',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        refundedCents: 0,
      }),
    )
    await mustDeny(
      'the EDITOR raising the total (lifts the refund ceiling)',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        totals: { totalCents: 999999 },
      }),
    )
    await mustDeny(
      'pre-refunding an order so a LOST dispute reverses nothing',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        refundedCents: 4200,
      }),
    )
    await mustDeny(
      "setting the seller-share reversal's own once-only marker",
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        dispute: { id: 'dp_1', outcome: 'lost', reversedTransferCents: 0 },
      }),
    )
    await mustDeny(
      'minting a supplierToken for the unauthenticated supplier route',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        supplierToken: 'chosen-by-the-client',
      }),
    )
    await mustDeny(
      'resetting the download attempt counter',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        downloadAttempts: {},
      }),
    )
    await mustDeny(
      'repointing the payment intent a refund would be issued against',
      updateDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', ORDER), {
        paymentIntentId: 'pi_somebody_elses',
      }),
    )
    await mustDeny(
      'a money field smuggled in beside the note the rule does permit',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', ORDER), {
        refundedCents: 0,
        timeline: [{ type: 'note', message: 'and also', atMs: 1 }],
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

/**
 * The `author` host role — "edit content but not publish" (AGL-2334).
 *
 * The agency guide's own worked example is *"a client who may edit content
 * but not publish"*, and until this role existed the narrowest thing the
 * product could express was `viewer`, which cannot edit at all.
 *
 * ⚠️ THE BOTH-HALVES RULE IS THE WHOLE TEST HERE. Every assertion that an
 * author CANNOT publish would pass just as well for a role that can do
 * nothing whatsoever — a gate that refuses everyone looks identical to a
 * correct one from the deny side. So each refusal below is paired: the author
 * can still make the ordinary content edit on the same document, and the
 * EDITOR can still perform the very publish the author was refused. A change
 * that broke either half would leave a role we cannot sell and a publish
 * button that no longer works for anybody.
 */
describe('the author host role edits content and cannot publish (AGL-2334)', () => {
  const SCREEN = ['hosts', HOST, 'screens', 'screen-1']
  const LAYOUT = ['hosts', HOST, 'layouts', 'layout-1']
  const COMPONENT = ['hosts', HOST, 'components', 'comp-1']
  const ENTRY_DRAFT = [
    'hosts', HOST, 'collections', 'col-1', 'entries', 'entry-draft',
  ]
  const ENTRY_LIVE = [
    'hosts', HOST, 'collections', 'col-1', 'entries', 'entry-live',
  ]
  /** A `publishSchedule` shaped exactly as the console writes one. */
  const schedule = () => ({
    action: 'publish',
    versionId: 'v1',
    publishAt: new Date(Date.now() + AN_HOUR),
    status: 'pending',
    createdAt: new Date(),
  })

  it('HALF ONE — the author really can edit the content', async () => {
    // The role is worthless if this half fails, and every refusal in the
    // tests below would still pass. Asserted FIRST for that reason.
    await mustAllow(
      'the author renaming a screen',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), { name: 'Renamed' }),
    )
    await mustAllow(
      'the author reordering a screen in the tree',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), { order: 3, parentId: null }),
    )
    // The besigner canvas save: a merge-set onto an EXISTING version doc,
    // which is a rules UPDATE (the AGL-1369 create/update split). This is
    // what "edit content" actually means in this product.
    await mustAllow(
      'the author saving the canvas',
      setDoc(
        doc(authed(AUTHOR), ...SCREEN, 'versions', 'v1'),
        { nodes: { root: { text: 'edited by the client' } } },
        { merge: true },
      ),
    )
    await mustAllow(
      'the author editing a layout version',
      setDoc(
        doc(authed(AUTHOR), ...LAYOUT, 'versions', 'lv1'),
        { nodes: { root: {} } },
        { merge: true },
      ),
    )
    await mustAllow(
      'the author editing a component version',
      setDoc(
        doc(authed(AUTHOR), ...COMPONENT, 'versions', 'cv1'),
        { nodes: { root: {} } },
        { merge: true },
      ),
    )
    // The component DOC itself. This one only passes because `components` was
    // added to the host catch-all's update exclusion in the same change AND
    // its dedicated block re-grants — if the exclusion were added without the
    // re-grant, THIS is the assertion that would catch it.
    await mustAllow(
      'the author renaming a component',
      updateDoc(doc(authed(AUTHOR), ...COMPONENT), { name: 'Hero v2' }),
    )
    await mustAllow(
      'the author renaming a layout',
      updateDoc(doc(authed(AUTHOR), ...LAYOUT), { name: 'Main v2' }),
    )
    await mustAllow(
      'the author editing a draft entry body',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_DRAFT), { body: 'new words' }),
    )
    await mustAllow(
      'the author editing a LIVE entry body (editing is not publishing)',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_LIVE), { body: 'a correction' }),
    )
    // "The author adds a post" used to be a client-direct create, and this
    // pair asserted the create-time draft condition the rule carried. AGL-2266
    // took entry CREATE away from every client role — /api/hosts/resources owns
    // it because it is the only place `ENTRIES_MAX_PER_COLLECTION` can be
    // counted — and the draft condition moved with it: `status` is off that
    // route's field allow-list and `'draft'` is stamped server-side.
    //
    // So the author's "add a post" is now a server shell followed by the
    // ordinary merge-set save, and it is THAT save — the one the console
    // actually makes on a brand-new entry — which this half has to prove.
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'hosts', HOST, 'collections', 'col-1',
          'entries', 'entry-new'),
        { title: 'New', status: 'draft' },
      )
    })
    await mustAllow(
      'the author filling in an entry the route just created',
      setDoc(doc(authed(AUTHOR), 'hosts', HOST, 'collections', 'col-1',
        'entries', 'entry-new'), { body: 'first words' }, { merge: true }),
    )
    await mustAllow(
      'the author deleting a draft entry',
      deleteDoc(doc(authed(AUTHOR), ...ENTRY_DRAFT)),
    )
    await mustAllow(
      'the author editing a site variable',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST, 'variables', 'var-1'),
        { value: '2' }),
    )
    await mustAllow(
      'the author reading the site',
      getDoc(doc(authed(AUTHOR), 'hosts', HOST)),
    )
    // And a non-publish key on the HOST doc itself, so the routing-map freeze
    // below is proved to be about `screens` and not about the document.
    await mustAllow(
      'the author editing a non-publish key on the host doc',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), { displayName: 'Site A2' }),
    )
  })

  it('HALF TWO — the author cannot register a route (the routing map)', async () => {
    await mustDeny(
      'the author adding a routing-map entry — the act that makes a page live',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), {
        'screens.screen-2': '/new-page',
      }),
    )
    await mustDeny(
      'the author moving an existing route',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), {
        'screens.screen-1': '/moved',
      }),
    )
    await mustDeny(
      'the author UNpublishing by clearing a routing-map entry',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), {
        'screens.screen-1': deleteField(),
      }),
    )
    await mustDeny(
      'the author replacing the whole routing map',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST), { screens: {} }),
    )
    // The other half of `publishScreenRoute`: it writes the routing map AND
    // the screen's own slug + publishedAt. Both must be refused, or the
    // remaining one leaves the publish half-applied.
    await mustDeny(
      'the author stamping a slug and publishedAt',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        slug: 'client-page', publishedAt: new Date(),
      }),
    )
    await mustDeny(
      'the author clearing publishedAt (unpublish)',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        publishedAt: deleteField(),
      }),
    )
  })

  it('HALF TWO — the author cannot move a live version pointer', async () => {
    await mustDeny(
      'the author republishing a screen',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), { versionId: 'v2' }),
    )
    await mustDeny(
      'the author republishing a layout',
      updateDoc(doc(authed(AUTHOR), ...LAYOUT), { versionId: 'lv2' }),
    )
    // The sharpest of the three: a component republish pushes changes to
    // every page that uses it, with no route touched.
    await mustDeny(
      'the author republishing a component',
      updateDoc(doc(authed(AUTHOR), ...COMPONENT), { versionId: 'cv2' }),
    )
    // Smuggling: a pointer move riding along with a legitimate edit is still
    // a pointer move. `diff().affectedKeys()` reports CHANGED keys, so this
    // is a real second case and not a restatement of the one above.
    await mustDeny(
      'the author smuggling a versionId in with a rename',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        name: 'Innocent rename', versionId: 'v2',
      }),
    )
  })

  it('HALF TWO — publishSchedule is frozen, which is the whole point', async () => {
    // THE BYPASS. `publishSchedule` is a client write; the cron executor then
    // flips `versionId` and registers the routing entry with ADMIN-SDK
    // privileges, subject to no rule at all. Every refusal above is defeated
    // in one write without this — schedule it for a minute from now and the
    // platform publishes it for you.
    await mustDeny(
      'the author SCHEDULING a screen publish',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        publishSchedule: schedule(),
      }),
    )
    await mustDeny(
      'the author scheduling a layout publish',
      updateDoc(doc(authed(AUTHOR), ...LAYOUT), {
        publishSchedule: schedule(),
      }),
    )
    await mustDeny(
      'the author scheduling a component publish',
      updateDoc(doc(authed(AUTHOR), ...COMPONENT), {
        publishSchedule: schedule(),
      }),
    )
    // `action: 'unpublish'` is the same field taking a live page DOWN on a
    // timer, which is the same axis and must be refused for the same reason.
    await mustDeny(
      'the author scheduling an UNpublish',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        publishSchedule: { ...schedule(), action: 'unpublish' },
      }),
    )
    await mustDeny(
      'the author cancelling a schedule somebody else set',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), {
        publishSchedule: deleteField(),
      }),
    )
  })

  it('HALF TWO — the author cannot publish a collection entry', async () => {
    await mustDeny(
      'the author publishing an entry',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_DRAFT), {
        status: 'published', publishedAt: new Date(),
      }),
    )
    await mustDeny(
      'the author unpublishing a live entry',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_LIVE), { status: 'draft' }),
    )
    // The entry scheduler — `publishSchedule` in a different spelling. The
    // tenant runtime flips a due `scheduled` entry to `published` with the
    // Admin SDK, so leaving this open is the same bypass one collection over.
    await mustDeny(
      'the author SCHEDULING an entry publish',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_DRAFT), {
        status: 'scheduled', publishAt: new Date(Date.now() + AN_HOUR),
      }),
    )
    await mustDeny(
      'the author back-dating a live entry',
      updateDoc(doc(authed(AUTHOR), ...ENTRY_LIVE), {
        publishedAt: new Date(0),
      }),
    )
    // A create is the update freeze's escape hatch if it is not covered:
    // delete the draft, re-create it published. AGL-2334 closed it inside this
    // rule; AGL-2266 then welded it shut a level up, because entry CREATE is
    // API-only for every client role now. These two still hold, but they no
    // longer isolate the AUTHOR — which is a guard that cannot fail unless the
    // editor twin below runs beside it and says so.
    await mustDeny(
      'the author CREATING an entry that is already published',
      setDoc(doc(authed(AUTHOR), 'hosts', HOST, 'collections', 'col-1',
        'entries', 'entry-born-live'),
        { title: 'Born live', status: 'published' }),
    )
    await mustDeny(
      'the author creating an entry that is already scheduled',
      setDoc(doc(authed(AUTHOR), 'hosts', HOST, 'collections', 'col-1',
        'entries', 'entry-born-scheduled'),
        { title: 'Born scheduled', status: 'scheduled',
          publishAt: new Date(Date.now() + AN_HOUR) }),
    )
    // The reason the two above are denied is NOT the publish freeze any more,
    // and this is what records that honestly. The editor may publish an entry
    // (HALF THREE) and still cannot create one from the browser.
    await mustDeny(
      'the EDITOR creating an entry client-direct — create is API-only, not author-specific (AGL-2266)',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'collections', 'col-1',
        'entries', 'entry-editor-live'),
        { title: 'Born live', status: 'published' }),
    )
  })

  it('HALF TWO — the author cannot take live content down another way', async () => {
    await mustDeny(
      'the author soft-deleting a screen',
      updateDoc(doc(authed(AUTHOR), ...SCREEN), { deletedAt: new Date() }),
    )
    await mustDeny(
      'the author deleting a screen',
      deleteDoc(doc(authed(AUTHOR), ...SCREEN)),
    )
    await mustDeny(
      'the author deleting a layout',
      deleteDoc(doc(authed(AUTHOR), ...LAYOUT)),
    )
    await mustDeny(
      'the author deleting a component',
      deleteDoc(doc(authed(AUTHOR), ...COMPONENT)),
    )
    // The freeze walked around from underneath: the live page serves whatever
    // `versionId` points at, so deleting that document takes the page down
    // without touching a single publish field.
    await mustDeny(
      'the author deleting the live version document',
      deleteDoc(doc(authed(AUTHOR), ...SCREEN, 'versions', 'v1')),
    )
    await mustDeny(
      'the author deleting a layout version document',
      deleteDoc(doc(authed(AUTHOR), ...LAYOUT, 'versions', 'lv1')),
    )
    await mustDeny(
      'the author deleting a component version document',
      deleteDoc(doc(authed(AUTHOR), ...COMPONENT, 'versions', 'cv1')),
    )
  })

  it('HALF TWO — "edit content" does not quietly mean "read the order book"', async () => {
    // An agency grants this role precisely because it wants to hand a client
    // LESS. Both reads were `canWriteHostContent`, so admitting `author`
    // there would have handed over every shopper's address and every webhook
    // signing secret along with the ability to fix a typo.
    await mustDeny(
      'the author reading an order',
      getDoc(doc(authed(AUTHOR), 'hosts', HOST, 'orders', 'order-1')),
    )
    await mustDeny(
      'the author reading a webhook signing secret',
      getDoc(doc(authed(AUTHOR), 'hosts', HOST, 'webhooks', 'wh1')),
    )
  })

  it('HALF TWO — nor does it mean "redirect the order book" (AGL-1881)', async () => {
    // The read gate above is only half a boundary. `webhooks` was in the
    // catch-all's CREATE exclusion alone, so update and delete fell through
    // to `canWriteHostContent` — which admits `author`. The author could not
    // read this document and could still repoint it, which is the same data
    // one delivery later, and could overwrite the secret so their own
    // endpoint verified the signature. The test above passed throughout.
    await mustDeny(
      'the author repointing a webhook at their own endpoint',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        url: 'https://attacker.example/collect',
      }),
    )
    await mustDeny(
      'the author overwriting a webhook signing secret',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        secret: 'attacker-chosen',
      }),
    )
    await mustDeny(
      'the author soft-deleting a webhook',
      updateDoc(doc(authed(AUTHOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        deletedAt: new Date(),
      }),
    )
    await mustDeny(
      'the author hard-deleting a webhook',
      deleteDoc(doc(authed(AUTHOR), 'hosts', HOST, 'webhooks', 'wh1')),
    )
    // The positive control, and the reason this is a re-grant rather than a
    // blanket exclusion: the EDITOR's soft delete is how a capped site frees
    // a webhook slot (AGL-1360), and it must still work.
    await mustAllow(
      'the editor soft-deleting a webhook',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh1'), {
        deletedAt: new Date(),
      }),
    )
  })

  it('HALF THREE — the EDITOR can still do every one of those things', async () => {
    // Without this, a gate that refuses everybody passes the whole suite
    // above. Each assertion here is the exact write the author was refused.
    await mustAllow(
      'the editor registering a route',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        'screens.screen-2': '/new-page',
      }),
    )
    await mustAllow(
      'the editor clearing a routing-map entry',
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), {
        'screens.screen-1': deleteField(),
      }),
    )
    await mustAllow(
      'the editor stamping a slug and publishedAt',
      updateDoc(doc(authed(EDITOR), ...SCREEN), {
        slug: 'client-page', publishedAt: new Date(),
      }),
    )
    await mustAllow(
      'the editor moving the screen version pointer',
      updateDoc(doc(authed(EDITOR), ...SCREEN), { versionId: 'v2' }),
    )
    await mustAllow(
      'the editor moving the layout version pointer',
      updateDoc(doc(authed(EDITOR), ...LAYOUT), { versionId: 'lv2' }),
    )
    await mustAllow(
      'the editor moving the component version pointer',
      updateDoc(doc(authed(EDITOR), ...COMPONENT), { versionId: 'cv2' }),
    )
    await mustAllow(
      'the editor scheduling a publish',
      updateDoc(doc(authed(EDITOR), ...SCREEN), {
        publishSchedule: schedule(),
      }),
    )
    await mustAllow(
      'the editor scheduling a layout publish',
      updateDoc(doc(authed(EDITOR), ...LAYOUT), {
        publishSchedule: schedule(),
      }),
    )
    await mustAllow(
      'the editor scheduling a component publish',
      updateDoc(doc(authed(EDITOR), ...COMPONENT), {
        publishSchedule: schedule(),
      }),
    )
    await mustAllow(
      'the editor publishing an entry',
      updateDoc(doc(authed(EDITOR), ...ENTRY_DRAFT), {
        status: 'published', publishedAt: new Date(),
      }),
    )
    // The editor's create twin is NOT here, and its absence is deliberate:
    // entry create left the client entirely in AGL-2266, so it is asserted as
    // a DENY in HALF TWO instead. What the editor must still be able to do is
    // publish one the route created — the assertion directly above.
    await mustAllow(
      'the editor renaming a component (the catch-all exclusion did not break it)',
      updateDoc(doc(authed(EDITOR), ...COMPONENT), { name: 'Hero v3' }),
    )
    await mustAllow(
      'the editor deleting a version document',
      deleteDoc(doc(authed(EDITOR), ...SCREEN, 'versions', 'v1')),
    )
    await mustAllow(
      'the editor deleting a component',
      deleteDoc(doc(authed(EDITOR), ...COMPONENT)),
    )
    await mustAllow(
      'the editor reading an order',
      getDoc(doc(authed(EDITOR), 'hosts', HOST, 'orders', 'order-1')),
    )
  })

  it('the viewer is still refused everything the author may do', async () => {
    // The floor under the whole role: `author` must be strictly stronger than
    // `viewer` and strictly weaker than `editor`. If a mistake in the role
    // list admitted `viewer` to content writes, HALF ONE would go green for
    // the wrong reason and nothing else in this file would notice.
    await mustDeny(
      'the viewer renaming a screen',
      updateDoc(doc(authed(VIEWER), ...SCREEN), { name: 'No' }),
    )
    await mustDeny(
      'the viewer saving the canvas',
      setDoc(doc(authed(VIEWER), ...SCREEN, 'versions', 'v1'),
        { nodes: {} }, { merge: true }),
    )
    await mustDeny(
      'the viewer editing an entry',
      updateDoc(doc(authed(VIEWER), ...ENTRY_DRAFT), { body: 'no' }),
    )
  })

  it('a suspended site freezes the author too', async () => {
    // `hostWritesFrozen` is ANDed ahead of every branch, so this should hold
    // for free — which is exactly the kind of claim that turns out to be
    // false when a new role is threaded through by hand.
    await mustDeny(
      'the author editing content on a host-suspended site',
      updateDoc(doc(authed(AUTHOR), 'hosts', LOCKED_HOST, 'screens', 's1'),
        { name: 'nope' }),
    )
  })
})

/**
 * A marketplace purchase is an ORGANIZATION's licence, and the org can read it
 * (AGL-2331).
 *
 * The rule change these pin: before AGL-2331 the buying side of
 * `marketplacePurchases` was `buyerUid == request.auth.uid` and nothing else,
 * so the only person who could see a licence was whoever clicked Buy. Once a
 * purchase licenses the installing organization, that makes the org's own
 * licence invisible to the org — to a colleague, and to the buyer's
 * replacement after their account is gone.
 *
 * The legacy case is the other half and matters more: purchases written before
 * AGL-2331 carry no `buyerOrgId` at all, and the new membership clause must
 * not make them unreadable by the person who bought them.
 */
describe('an org can read the marketplace licences it holds (AGL-2331)', () => {
  const ORG_PURCHASE = ['marketplacePurchases', 'cs_org']
  const LEGACY_PURCHASE = ['marketplacePurchases', 'cs_legacy']
  const OTHER_ORG_PURCHASE = ['marketplacePurchases', 'cs_other_org']

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // Bought by the OWNER, licensed to ORG.
      await setDoc(doc(db, ...ORG_PURCHASE), {
        listingId: 'l1', buyerUid: OWNER, buyerOrgId: ORG,
        sellerOrgId: 'org-seller',
      })
      // Pre-AGL-2331: no buyer org was ever recorded.
      await setDoc(doc(db, ...LEGACY_PURCHASE), {
        listingId: 'l1', buyerUid: OWNER, sellerOrgId: 'org-seller',
      })
      // A different workspace's licence entirely.
      await setDoc(doc(db, ...OTHER_ORG_PURCHASE), {
        listingId: 'l1', buyerUid: OUTSIDER, buyerOrgId: OTHER_ORG,
        sellerOrgId: 'org-seller',
      })
    })
  })

  it('a colleague who did not buy it can still see the org holds it', async () => {
    // THE POINT. `EDITOR` never clicked Buy and is not `buyerUid`; they are on
    // the ORG roster, and the licence is the ORG's.
    await mustAllow(
      "an org member reading their org's licence",
      getDoc(doc(authed(EDITOR), ...ORG_PURCHASE)),
    )
  })

  it('the buyer still reads a LEGACY purchase that names no org', async () => {
    // The regression that would silently strip every pre-AGL-2331 customer of
    // their own receipt: the org clause cannot answer for a document with no
    // `buyerOrgId`, so the `buyerUid` clause has to stay.
    await mustAllow(
      'the buyer reading their pre-AGL-2331 purchase',
      getDoc(doc(authed(OWNER), ...LEGACY_PURCHASE)),
    )
  })

  it("a member of ANOTHER org cannot read this org's licence", async () => {
    // The negative control the membership clause must not have loosened.
    await mustDeny(
      'an outsider reading an org licence they have no membership in',
      getDoc(doc(authed(EDITOR), ...OTHER_ORG_PURCHASE)),
    )
    await mustDeny(
      'a stranger reading a legacy purchase they did not make',
      getDoc(doc(authed(OUTSIDER), ...LEGACY_PURCHASE)),
    )
    await mustDeny(
      'an anonymous reader',
      getDoc(doc(anon(), ...ORG_PURCHASE)),
    )
  })

  it('nobody writes a purchase from a client, org member or not', async () => {
    // `allow write: if false` — the ledger is the Stripe webhook's alone, and
    // widening READ must not have widened WRITE. A client-written purchase is
    // a free licence.
    await mustDeny(
      'an org owner forging a licence for their own org',
      setDoc(doc(authed(OWNER), 'marketplacePurchases', 'cs_forged'), {
        listingId: 'l1', buyerUid: OWNER, buyerOrgId: ORG,
      }),
    )
    await mustDeny(
      'staff forging a licence',
      setDoc(doc(authed(STAFF, { staff: true }), 'marketplacePurchases', 'cs_staff'), {
        listingId: 'l1', buyerOrgId: ORG,
      }),
    )
  })
})

/**
 * `storagePath` and `private` are server-owned on a media document
 * (AGL-1881) — the defence-in-depth half of the pre-launch review's one
 * CRITICAL finding.
 *
 * The sink is fixed (`media-storage-path.ts` refuses a key outside the
 * document's own `<scope>/media/` prefix), and these are the rules that stop
 * the field being written in the first place. Both layers are needed: staff
 * writes and Admin-SDK routes never reach the rules, and rules ship on a
 * different cadence from code, so neither one alone is the answer.
 *
 * What the field bought while it was writable: seven server paths read it and
 * hand it to `bucket.file(...)` on the ADMIN SDK, which the Storage rules do
 * not govern. `serveMediaCdn` streams that object to an anonymous caller
 * behind an `s-maxage=3600` URL, `/api/media/replace` overwrites it and the
 * folder delete removes it — cross-tenant read, overwrite and destroy from a
 * document the attacker legitimately owns. The bucket is shared and holds
 * `adminAudit-archive/` and `erasures/` at FIXED prefixes, so the attack does
 * not even need a stolen object key. `private` is the other half: the
 * download-signature gate is skipped whenever the field is not exactly
 * `true`.
 *
 * Three legs per scope, because two of them alone prove nothing:
 *
 *  1. setting/changing `storagePath` is DENIED,
 *  2. changing `private` is DENIED — including clearing it, which is the
 *     spelling `deleteField()` produces and the one a `hasAny` on
 *     `affectedKeys()` has to catch as well as an assignment,
 *  3. an ordinary DAM edit still LANDS. A freeze that breaks the rename,
 *     the tag, the folder move or the sharing control is worse than the hole,
 *     and every one of those is a client-direct write in
 *     `media-library.component.tsx`.
 *
 * The host leg is the one that needed the catch-all exclusion. `media` now
 * appears in the create and update lists with the block below re-granting
 * both, because sibling matches are OR'd and the LOOSER wins — a dedicated
 * block that freezes a field the catch-all still grants freezes nothing, the
 * shape that left `components` author-publishable (AGL-2334). Drop `media`
 * from either list and legs 1 and 2 of the host test go red.
 */
describe('media object fields are server-owned (AGL-1881)', () => {
  const ORG_ASSET = ['orgs', ORG, 'media', 'agl1881']
  const HOST_ASSET = ['hosts', HOST, 'media', 'agl1881']
  // A fixed, guessable prefix in the same bucket that holds customer media —
  // the retention archive, not another tenant's image. Named literally so the
  // assertion reads as the attack it refuses.
  const SOMEONE_ELSES_OBJECT = 'adminAudit-archive/2026-08/audit.jsonl'

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, ...ORG_ASSET), {
        fileName: 'brochure.pdf',
        visibleTo: ['org'],
        storagePath: `orgs/${ORG}/media/agl1881`,
        private: true,
        contentType: 'application/pdf',
        contentSha256: 'the-digest-the-deny-list-holds',
        sizeBytes: 1024,
      })
      await setDoc(doc(db, ...HOST_ASSET), {
        fileName: 'hero.png',
        storagePath: `hosts/${HOST}/media/agl1881`,
        private: true,
        contentType: 'image/png',
        contentSha256: 'the-digest-the-deny-list-holds',
        sizeBytes: 1024,
      })
    })
  })

  it('an org owner cannot repoint an org asset at another object', async () => {
    await mustDeny(
      'repointing orgs/{orgId}/media at the audit archive',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        storagePath: SOMEONE_ELSES_OBJECT,
      }),
    )
    await mustDeny(
      'repointing it while also making a legitimate edit in the same patch',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        fileName: 'Brochure v2.pdf',
        storagePath: SOMEONE_ELSES_OBJECT,
      }),
    )
    await mustDeny(
      'minting a NEW org media document that addresses another object',
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'media', 'agl1881-forged'), {
        fileName: 'innocent.png',
        visibleTo: ['org'],
        storagePath: SOMEONE_ELSES_OBJECT,
      }),
    )
  })

  it('an org owner cannot flip an org asset out of private', async () => {
    await mustDeny(
      'publishing a private asset by assignment',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), { private: false }),
    )
    await mustDeny(
      'publishing a private asset by DELETING the flag',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), { private: deleteField() }),
    )
    await mustDeny(
      'minting a media document that declares itself already public',
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'media', 'agl1881-public'), {
        fileName: 'innocent.png',
        visibleTo: ['org'],
        private: false,
      }),
    )
  })

  it('the DAM still edits an org asset (the positive control)', async () => {
    await mustAllow(
      'the rename, alt, description and tag edit the detail drawer sends',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        fileName: 'Brochure v2.pdf',
        alt: 'Company brochure',
        description: 'Updated for September',
        tags: ['brochure', 'print'],
        folderId: 'f1',
        folder: 'Print',
      }),
    )
    await mustAllow(
      'the sharing control, which only an org-wide member may move',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        visibleTo: [`host:${HOST}`],
      }),
    )
    await mustAllow(
      're-sending the frozen values UNCHANGED, which diff() must not call a change',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        fileName: 'Brochure v3.pdf',
        storagePath: `orgs/${ORG}/media/agl1881`,
        private: true,
      }),
    )
  })

  it('a site editor cannot repoint a host asset at another object', async () => {
    await mustDeny(
      'repointing hosts/{hostId}/media at the audit archive',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        storagePath: SOMEONE_ELSES_OBJECT,
      }),
    )
    await mustDeny(
      'repointing it at ANOTHER SITE in the same org',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        storagePath: 'hosts/host-other/media/their-asset',
      }),
    )
    await mustDeny(
      'minting a host media document that addresses another object',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'media', 'agl1881-forged'), {
        fileName: 'innocent.png',
        storagePath: SOMEONE_ELSES_OBJECT,
      }),
    )
  })

  it('a site editor cannot flip a host asset out of private', async () => {
    await mustDeny(
      'publishing a private asset by assignment',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), { private: false }),
    )
    await mustDeny(
      'publishing a private asset by DELETING the flag',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), { private: deleteField() }),
    )
    await mustDeny(
      'minting a host media document that declares itself already public',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'media', 'agl1881-public'), {
        fileName: 'innocent.png',
        private: false,
      }),
    )
  })

  /**
   * The two fields the `media-write-deny-coverage` partition turned up, which
   * are security inputs rather than metadata — frozen with the rest rather
   * than classified as harmless.
   *
   *  - `contentSha256` is the key `mediaCdnServeBlock` asks the quarantine
   *    deny-list with, and `serveMediaCdn` returns 410 on a hit. A client that
   *    could rewrite it walked its own asset out of a takedown.
   *  - `contentType` is the served `Content-Type` and the input to
   *    `mediaCdnContentSecurityPolicy`. GCS metadata wins where it exists, so
   *    this is a fallback rather than the only input — hardening, not a second
   *    CRITICAL, and recorded that way so nobody reads more into the test than
   *    it proves.
   */
  it('neither scope can rewrite the quarantine digest or the served type', async () => {
    await mustDeny(
      'walking an org asset out of a takedown by changing its digest',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), {
        contentSha256: 'not-the-hash-the-deny-list-holds',
      }),
    )
    await mustDeny(
      'walking a host asset out of a takedown by changing its digest',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        contentSha256: 'not-the-hash-the-deny-list-holds',
      }),
    )
    await mustDeny(
      'declaring a host asset to be HTML',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        contentType: 'text/html',
      }),
    )
    await mustDeny(
      'lowering the recorded size of an org asset',
      updateDoc(doc(authed(OWNER), ...ORG_ASSET), { sizeBytes: 0 }),
    )
  })

  it('the DAM still edits a host asset (the positive control)', async () => {
    await mustAllow(
      'the rename, alt, description and tag edit the detail drawer sends',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        fileName: 'hero-v2.png',
        alt: 'Hero image',
        description: 'Autumn campaign',
        tags: ['hero'],
        folderId: 'f1',
        folder: 'Campaign',
      }),
    )
    await mustAllow(
      're-sending the frozen values UNCHANGED, which diff() must not call a change',
      updateDoc(doc(authed(EDITOR), ...HOST_ASSET), {
        fileName: 'hero-v3.png',
        storagePath: `hosts/${HOST}/media/agl1881`,
        private: true,
      }),
    )
    await mustAllow(
      'creating a host media document that names no object at all',
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'media', 'agl1881-plain'), {
        fileName: 'innocent.png',
      }),
    )
    // The catch-all still owns DELETE, deliberately: removing the document
    // sets no field, and the re-create is refused above.
    await mustAllow(
      'deleting a host media document, which the catch-all still grants',
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'media', 'agl1881-plain')),
    )
  })

  /**
   * The structural half, and the reason legs 1 and 2 above can fire at all.
   *
   * A freeze in a dedicated block is dead text while the catch-all grants the
   * same operation, because Firestore ORs its allows and the looser branch
   * wins. So the exclusion is asserted here BY NAME, next to the behavioural
   * proof, rather than left to be inferred from a green run.
   */
  it('`media` is excluded from the catch-all create and update, and only those', () => {
    const lists = hostSubcollectionExclusions()
    assert.ok(
      lists.create.includes('media'),
      '`media` has fallen out of the host catch-all CREATE exclusion list. ' +
        'The dedicated block below it freezes `storagePath`/`private` on ' +
        'create, and a freeze under a looser sibling never fires — the ' +
        'AGL-2334 `components` shape.',
    )
    assert.ok(
      lists.update.includes('media'),
      '`media` has fallen out of the host catch-all UPDATE exclusion list, ' +
        'so the dedicated block s update freeze no longer decides anything.',
    )
    assert.ok(
      !lists.delete.includes('media'),
      '`media` has been added to the host catch-all DELETE exclusion list ' +
        'with no dedicated block re-granting delete, so the DAM can no ' +
        'longer remove an asset. That closes nothing: a delete sets no field.',
    )
    assert.ok(
      !hostServerOnlySubcollections().includes('media'),
      '`media` is now denied to the client OUTRIGHT under hosts/{hostId}, ' +
        'but the DAM edits an asset client-direct. Denying it breaks the ' +
        'library for every customer to close a hole the field freeze ' +
        'already closes.',
    )
  })
})

/**
 * WHO MAY APPEND TO A SITE'S ACTIVITY LOG (AGL-118)
 *
 * `hosts/{hostId}/activity` has no dedicated match block. It falls to the
 * host catch-all, and its name is deliberately absent from every exclusion
 * list there, so a member holding a content role appends straight from the
 * browser. That absence is load-bearing and was never asserted, which is how
 * an empty activity log came to be read as a permission denial: the log is
 * silent whether the write was refused or never attempted, and with nothing
 * pinning the rule, "the rules must be denying it" is the cheapest available
 * explanation and it is wrong.
 *
 * These cases exist to make that explanation impossible to reach again. The
 * ALLOW half is the important half — a suite where every case is a deny
 * passes just as well when the collection has been closed by accident.
 *
 * The role axis is exactly `canWriteHostContent`: admin, editor and author
 * append; a viewer does not. That is deliberate rather than incidental — an
 * audit entry is written BY the act it records, so anyone who can perform a
 * logged mutation must be able to log it, and nobody else needs to write here
 * at all.
 */
describe('a site activity entry is appended by the member who caused it (AGL-118)', () => {
  const ACTIVITY = ['hosts', HOST, 'activity']
  /**
   * A host in a healthy org whose `memberRoles` projection is EMPTY.
   *
   * `syncOrgAuthProjections` stamps owner/admin onto every host in the org,
   * so this state should not occur — which is the reason to pin it. It is the
   * shape a missed projection would take, and it must read as a denial rather
   * than as a quietly writable log.
   */
  const UNPROJECTED_HOST = 'host-unprojected'

  /** The document the console's activity logger actually writes. */
  const entry = (actorId) => ({
    actorId,
    actorEmail: 'member@acme.test',
    action: 'Saved the screen',
    target: { type: 'screen', id: 'screen-1', name: 'Home' },
    createdAt: new Date(),
  })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'hosts', UNPROJECTED_HOST), {
        displayName: 'Unprojected', orgId: ORG, memberRoles: {},
      })
    })
  })

  it('THE CONTROL — the roles that mutate content can record having done so', async () => {
    // Asserted FIRST and deliberately: every refusal below would still pass
    // if this collection were closed outright, and a log nobody can write is
    // the defect, not the fix.
    await mustAllow(
      'an org owner (projected admin on every host) logging a screen save',
      addDoc(collection(authed(OWNER), ...ACTIVITY), entry(OWNER)),
    )
    await mustAllow(
      'a site editor logging a screen save',
      addDoc(collection(authed(EDITOR), ...ACTIVITY), entry(EDITOR)),
    )
    // The author edits content without publishing it, so the author generates
    // audit entries too. Excluding this role would lose exactly the actions a
    // reviewer most wants attributed.
    await mustAllow(
      'a site author logging a screen save',
      addDoc(collection(authed(AUTHOR), ...ACTIVITY), entry(AUTHOR)),
    )
    await mustAllow(
      'staff logging a screen save',
      addDoc(
        collection(authed(STAFF, { staff: true }), ...ACTIVITY),
        entry(STAFF),
      ),
    )
  })

  it('a viewer, an outsider and a signed-out browser cannot forge one', async () => {
    // A viewer performs no logged mutation, so an entry from one is either a
    // forgery or a bug. `isHostAdmin` admits a viewer for READS; the write
    // gate is `canWriteHostContent`, which does not.
    await mustDeny(
      'a viewer appending to the activity log',
      addDoc(collection(authed(VIEWER), ...ACTIVITY), entry(VIEWER)),
    )
    await mustDeny(
      'a member of another org appending to this log',
      addDoc(collection(authed(OUTSIDER), ...ACTIVITY), entry(OUTSIDER)),
    )
    await mustDeny(
      'a signed-out browser appending to the activity log',
      addDoc(collection(anon(), ...ACTIVITY), entry('nobody')),
    )
    // The retired uid map must not authorize an append any more than it
    // authorizes anything else.
    await mustDeny(
      'a legacy `admins` entry appending to the activity log',
      addDoc(collection(authed(LEGACY), ...ACTIVITY), entry(LEGACY)),
    )
  })

  it('an org owner with no projected role on the host is refused', async () => {
    // Org standing alone authorizes nothing here: the rules read the host
    // doc's `memberRoles`, never the org roster. So a host the projection
    // never reached is unwritable by its own org's owner — which is the
    // failure this case names, and the reason a missed `registerOrgHost`
    // would present as a site that quietly records nothing.
    await mustDeny(
      'an org owner appending to a host with an empty memberRoles projection',
      addDoc(
        collection(authed(OWNER), 'hosts', UNPROJECTED_HOST, 'activity'),
        entry(OWNER),
      ),
    )
  })

  it('a suspended site stops accepting activity like every other write', async () => {
    // `hostWritesFrozen` is the second conjunct, so the log is not an exception
    // to a takedown. Staff keep the append — the un-panic invariant — because
    // the people working inside the lock are the ones whose actions most need
    // recording.
    await mustDeny(
      'an editor appending to a suspended site\'s activity log',
      addDoc(
        collection(authed(EDITOR), 'hosts', LOCKED_HOST, 'activity'),
        entry(EDITOR),
      ),
    )
    await mustAllow(
      'staff appending to a suspended site\'s activity log',
      addDoc(
        collection(authed(STAFF, { staff: true }), 'hosts', LOCKED_HOST, 'activity'),
        entry(STAFF),
      ),
    )
  })

  it('the catch-all exclusion lists still leave `activity` client-writable', async () => {
    // The mechanism, asserted directly. Adding `activity` to the create list
    // would deny every append above, and the console has no server route to
    // fall back on — the log would simply stop, silently, exactly as it
    // appeared to have done.
    const lists = hostSubcollectionExclusions()
    assert.ok(
      !lists.create.includes('activity'),
      '`activity` has been added to the host catch-all CREATE exclusion ' +
        'list. The console appends activity entries client-direct and no ' +
        'Admin-SDK route writes them, so this silently ends host activity ' +
        'logging rather than moving it.',
    )
    assert.ok(
      !hostServerOnlySubcollections().includes('activity'),
      '`activity` is now denied to the client outright under hosts/{hostId}, ' +
        'which stops the console writing the audit trail it reads back.',
    )
  })
})

/**
 * A sending domain's `status` is what decides whether mail may leave as that
 * domain, so a client that could write it could send as a domain it does not
 * control — and would defeat the send path's refusal at the same time, since
 * that refusal reads exactly this field.
 *
 * The read denial stands on its own: `dkimSelector` names the record an org
 * was issued, which is the first half of impersonating its sending setup.
 */
describe('a custom sending domain is unwritable and unreadable from any client', () => {
  const DOMAIN = 'sender.test'
  const claimPath = (orgId = ORG) => ['orgs', orgId, 'sendingDomains', DOMAIN]

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // A record midway through the honest path: key issued, DNS not proved.
      // Exactly the document an attacker wants one field flipped on.
      await setDoc(doc(db, ...claimPath()), {
        domain: DOMAIN,
        status: 'records-issued',
        dkimSelector: 'aglyn-org-acme',
        dkimPublicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A',
        createdAtMs: Date.now(),
      })
    })
  })

  it('nobody marks their own sending domain verified — owner, staff alike', async () => {
    for (const [label, db] of [
      ['an anonymous visitor', anon()],
      ['the org owner', authed(OWNER)],
      ['an editor', authed(EDITOR)],
      ['an outsider', authed(OUTSIDER)],
      ['staff', authed(STAFF, { staff: true })],
    ]) {
      await mustDeny(
        `${label} marking orgs/${ORG}/sendingDomains/${DOMAIN} verified`,
        updateDoc(doc(db, ...claimPath()), { status: 'verified' }),
      )
      await mustDeny(
        `${label} creating a pre-verified sending domain`,
        setDoc(doc(db, 'orgs', ORG, 'sendingDomains', 'someone-else.test'), {
          domain: 'someone-else.test',
          status: 'verified',
        }),
      )
      await mustDeny(
        `${label} deleting a sending domain to start it over`,
        deleteDoc(doc(db, ...claimPath())),
      )
      await mustDeny(
        `${label} reading the DKIM selector`,
        getDoc(doc(db, ...claimPath())),
      )
    }
  })

  it('an outsider cannot plant a verified sending domain on another org', async () => {
    await mustDeny(
      `${OUTSIDER} planting a sending domain on ${OTHER_ORG}`,
      setDoc(doc(authed(OUTSIDER), 'orgs', OTHER_ORG, 'sendingDomains', DOMAIN), {
        domain: DOMAIN,
        status: 'verified',
      }),
    )
  })
})

/**
 * THE CRM IS SCOPED, AND ITS DELETE IS A DETACH.
 *
 * `contacts` was `isOrgWideMember()` on both sides, so every site in an
 * account read every contact in it: an agency running twelve client brands
 * had one address book with twelve readers. The predicate is now the one
 * `datasets` uses, which is also the one the client's `array-contains-any`
 * filter matches — that pairing is what makes an UNFILTERED list denied
 * rather than quietly returning the collection.
 *
 * `EDITOR` is the persona that matters: a site collaborator, scoped to one
 * host, which is exactly the shape an agency's client has.
 */
describe('contacts are per-site, and letting go of one is not a delete', () => {
  const MINE = `host:${HOST}`
  const THEIRS = 'host:host-b'

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'mine'), {
        email: 'mine@acme.test',
        visibleTo: [MINE],
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'theirs'), {
        email: 'theirs@acme.test',
        visibleTo: [THEIRS],
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'shared'), {
        email: 'shared@acme.test',
        visibleTo: [MINE, THEIRS],
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'unscoped'), {
        email: 'unscoped@acme.test',
      })
    })
  })

  it('refuses a scoped collaborator another site’s contact', async () => {
    await assertFails(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'theirs')),
    )
    // A document nobody scoped is seen by nobody, which is the fail-open
    // this change closed — the field was present and said `['org']`, or was
    // absent and read as org-wide. Neither is "this site may see it".
    await assertFails(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'unscoped')),
    )
  })

  /**
   * THE CONTROL. Every assertion above passes against a rules file that
   * denies the whole collection, which would take Contacts away from
   * everybody. This is the door still opening.
   */
  it('still admits the collaborator’s OWN contacts', async () => {
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'mine')),
    )
    await assertSucceeds(
      getDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'shared')),
    )
    // And an org-wide member is the org, so they read everything.
    await assertSucceeds(
      getDoc(doc(authed(OWNER), 'orgs', ORG, 'contacts', 'theirs')),
    )
  })

  /**
   * An unfiltered LIST is denied outright rather than filtered. That is the
   * property that makes the rule provable per-document — and the one whose
   * absence let a console page with no `where()` stream the whole
   * collection.
   */
  it('denies an unfiltered list and allows the scoped one', async () => {
    await assertFails(
      getDocs(collection(authed(EDITOR), 'orgs', ORG, 'contacts')),
    )
    const scoped = await assertSucceeds(
      getDocs(
        query(
          collection(authed(EDITOR), 'orgs', ORG, 'contacts'),
          where('visibleTo', 'array-contains-any', ['org', MINE]),
        ),
      ),
    )
    assert.deepEqual(
      scoped.docs.map((entry) => entry.id).sort(),
      ['mine', 'shared'],
    )
  })

  /**
   * DELETE IS SOLE-HOLDER ONLY. Another site that captured the same person
   * keeps its own notes, order history and consent, and the deleting site
   * never had a claim on any of it — so letting go is an UPDATE that drops
   * this holder's half, and the document dies with the last holder.
   */
  it('refuses to destroy a contact another site still holds', async () => {
    await assertFails(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'shared')),
    )
  })

  it('allows the LAST holder to delete, and the detach in between', async () => {
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'mine')),
    )
    // The detach: the same collaborator drops their own half of the shared
    // row, which is an update and is allowed.
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG, 'contacts', 'shared'), {
        'facets.host-a': deleteField(),
      }),
    )
  })
})

/**
 * READING THE CRM IS AN AUTHORITY, NOT A MEMBERSHIP.
 *
 * `contacts` and `contactSegments` asked `canReadScoped()` and nothing else,
 * which is the question "is this member near these documents" — the same
 * predicate `datasets` and `media` use, where being near them IS the whole
 * question because a collaborator's pages bind those rows and place those
 * assets. A contact is a person: a name, an address, an order history, notes
 * and a consent record. An org VIEWER — the role whose entire definition is
 * reading and changing nothing — read every one of them, and so did any
 * member whose custom role revoked `data.manage`.
 *
 * `data.manage` is the key because it is the key the surfaces over this data
 * already gate on: the Contacts console registers `permission: 'data.manage'`
 * and the Emails console registers the same. Contact and segment writes are
 * client-direct, so a browser that skips the console reaches Firestore and
 * nothing else — which is what makes those gates defense in depth only once
 * the rule underneath asks the same thing.
 *
 * ## The two halves, and why both are load-bearing
 *
 * SCOPE survives. A site collaborator holding `data.manage` still reads the
 * contacts their own host captured, because that is a shipped capability an
 * agency depends on and the hole being closed is on the ROLE axis. `EDITOR`
 * below is that persona.
 *
 * ROLE now applies to the scoped half too. `AUTHOR` is the counter-case: the
 * same site, the same tokens, an org role of `viewer`. A rule that added the
 * capability only to the org-wide branch would still hand them their host's
 * customer list.
 */
describe('the CRM answers to data.manage, on both halves of the scope', () => {
  const MINE = `host:${HOST}`
  const THEIRS = 'host:host-b'
  // Org-wide shapes the base fixtures do not carry. The permission maps are
  // the four `memberResolves`/`memberStamps` read between them: the resolved
  // projection a custom role produces, the raw per-member override it falls
  // back to, no map at all, and a map that GRANTS to a role that does not
  // hold the permission by default.
  const ORG_ADMIN = 'uid-crm-admin'
  const ORG_EDITOR = 'uid-crm-editor'
  const ROLE_REVOKED_EDITOR = 'uid-crm-editor-role-revoked'
  const OVERRIDE_REVOKED_EDITOR = 'uid-crm-editor-override-revoked'
  const BARE_EDITOR = 'uid-crm-editor-bare'
  const GRANTED_VIEWER = 'uid-crm-viewer-granted'

  const contact = (uid, id) => doc(authed(uid), 'orgs', ORG, 'contacts', id)
  const segment = (uid) => doc(authed(uid), 'orgs', ORG, 'contactSegments', 'seg-vip')
  /** The console's own query shape: filtered on the reader's tokens. */
  const scopedList = (uid, tokens) =>
    query(
      collection(authed(uid), 'orgs', ORG, 'contacts'),
      where('visibleTo', 'array-contains-any', tokens),
    )

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'members', ORG_ADMIN), {
        role: 'admin', allHosts: true, scopeTokens: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'members', ORG_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
      })
      // A custom role's revocation, as `syncOrgAuthProjections` stamps it:
      // the resolver's own output, all three layers already applied.
      await setDoc(doc(db, 'orgs', ORG, 'members', ROLE_REVOKED_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        roleId: 'role-read-only-data',
        resolvedPermissions: { 'data.manage': false, 'plugins.install': true },
      })
      // The same revocation on a member the projection never reached — the
      // per-member layer `memberResolves` falls back to.
      await setDoc(doc(db, 'orgs', ORG, 'members', OVERRIDE_REVOKED_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
        permissions: { 'data.manage': false },
      })
      // NO permission map of any kind — every member written before the
      // field existed. If this one is refused the deploy is a mass lockout.
      await setDoc(doc(db, 'orgs', ORG, 'members', BARE_EDITOR), {
        role: 'editor', allHosts: true, scopeTokens: ['org'],
      })
      // The resolver WIDENS as well as narrows, and the Contacts console
      // admits this member on the resolved map. A rule that stopped at the
      // role list would hand them a page that never loads.
      await setDoc(doc(db, 'orgs', ORG, 'members', GRANTED_VIEWER), {
        role: 'viewer', allHosts: true, scopeTokens: ['org'],
        roleId: 'role-crm-only',
        resolvedPermissions: { 'data.manage': true },
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'shared-org'), {
        email: 'everyone@acme.test', visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'mine'), {
        email: 'mine@acme.test', visibleTo: [MINE],
      })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'theirs'), {
        email: 'theirs@acme.test', visibleTo: [THEIRS],
      })
      // Segments are stamped org-wide at creation, so scope alone admits
      // every member here and the verdict below is about the permission.
      await setDoc(doc(db, 'orgs', ORG, 'contactSegments', 'seg-vip'), {
        name: 'VIPs', tags: ['vip'], visibleTo: ['org'],
      })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds-crm'), {
        name: 'Products', visibleTo: ['org'],
      })
    })
  })

  it('refuses an org-wide VIEWER the contact, the segment and the list', async () => {
    await mustDeny(
      'an org-wide viewer reading an org-wide contact',
      getDoc(contact(VIEWER, 'shared-org')),
    )
    await mustDeny(
      'an org-wide viewer reading a saved segment',
      getDoc(segment(VIEWER)),
    )
    // The shape the console actually opens. A rule that denied only the
    // document read would leave the table streaming.
    await mustDeny(
      'an org-wide viewer listing contacts on the scoped query',
      getDocs(scopedList(VIEWER, ['org'])),
    )
  })

  it('refuses a member whose data.manage was revoked, by either layer', async () => {
    for (const [label, uid] of [
      ['a custom role revocation, resolved onto the member', ROLE_REVOKED_EDITOR],
      ['a per-member override on an unprojected member', OVERRIDE_REVOKED_EDITOR],
    ]) {
      await mustDeny(`${label} — reading a contact`, getDoc(contact(uid, 'shared-org')))
      await mustDeny(`${label} — reading a segment`, getDoc(segment(uid)))
    }
  })

  /**
   * The scoped half is not exempt. AUTHOR carries the SAME tokens as EDITOR
   * and differs only in the org role, so a denial here is about the role and
   * a rule that guarded the org-wide branch alone would fail this and only
   * this.
   */
  it('refuses a scoped collaborator whose ORG role is viewer', async () => {
    await mustDeny(
      'a site author reading a contact inside their own host scope',
      getDoc(contact(AUTHOR, 'mine')),
    )
    await mustDeny(
      'a site author listing their own host\'s contacts',
      getDocs(scopedList(AUTHOR, ['org', MINE])),
    )
  })

  /**
   * THE OTHER DIRECTION. Every denial above passes against a rules file that
   * refuses the collection to everybody, which would delete Contacts from the
   * product. These are the doors that must still open.
   */
  it('still admits every principal the product needs', async () => {
    for (const [label, uid] of [
      ['the owner', OWNER],
      ['an org-wide admin', ORG_ADMIN],
      ['an org-wide editor', ORG_EDITOR],
      ['an editor carrying no permission map at all', BARE_EDITOR],
      ['a viewer a custom role granted data.manage', GRANTED_VIEWER],
    ]) {
      await mustAllow(`${label} reading an org-wide contact`, getDoc(contact(uid, 'shared-org')))
      await mustAllow(`${label} reading a saved segment`, getDoc(segment(uid)))
      await mustAllow(
        `${label} listing contacts on the scoped query`,
        getDocs(scopedList(uid, ['org'])),
      )
    }
  })

  /**
   * The site collaborator, whose access this change had to leave intact: the
   * scope still decides WHICH contacts, and the permission only decides
   * whether they may ask.
   */
  it('keeps the scoped collaborator on exactly their own host\'s contacts', async () => {
    await mustAllow(
      'a scoped editor reading a contact their host captured',
      getDoc(contact(EDITOR, 'mine')),
    )
    await mustAllow(
      'a scoped editor listing on their own tokens',
      getDocs(scopedList(EDITOR, ['org', MINE])),
    )
    await mustDeny(
      'a scoped editor reading another host\'s contact',
      getDoc(contact(EDITOR, 'theirs')),
    )
    await mustDeny(
      'a scoped editor listing the collection unfiltered',
      getDocs(collection(authed(EDITOR), 'orgs', ORG, 'contacts')),
    )
  })

  /**
   * POSITIVE CONTROL FOR THE HARNESS ITSELF. If the emulator were serving a
   * stale ruleset, or these accounts could not reach the org at all, or
   * `mustAllow` had stopped asserting, the denials above would pass for
   * reasons that have nothing to do with the CRM. Every one of these is a
   * read by a REFUSED principal that must still succeed.
   */
  it('CONTROL: the refused readers still reach the org they belong to', async () => {
    await mustAllow(
      'the org-wide viewer reading their own membership document',
      getDoc(doc(authed(VIEWER), 'orgs', ORG, 'members', VIEWER)),
    )
    await mustAllow(
      'the org-wide viewer reading an org DATASET — content, not people',
      getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds-crm')),
    )
    await mustAllow(
      'the revoked editor reading the same dataset',
      getDoc(doc(authed(ROLE_REVOKED_EDITOR), 'orgs', ORG, 'datasets', 'ds-crm')),
    )
    await mustAllow(
      'the site author reading the host they were invited to',
      getDoc(doc(authed(AUTHOR), 'hosts', HOST)),
    )
    // And the negative control on the same axis: an outsider reaches none of
    // it, so "allowed" above is not the ruleset admitting the world.
    await mustDeny(
      'an outsider reading an org contact',
      getDoc(contact(OUTSIDER, 'shared-org')),
    )
  })
})


assert.ok(true)
