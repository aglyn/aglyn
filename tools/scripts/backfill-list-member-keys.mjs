/**
 * List-member key reconciliation (`docs/specs/email-overhaul.md` D4).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-list-member-keys.mjs \
 *     [--apply] [--org=<orgId>]
 *
 *   node tools/scripts/backfill-list-member-keys.mjs --self-test
 *
 * DRY RUN BY DEFAULT.
 *
 * `orgs/{orgId}/lists/{listId}/members` was written under two derivations —
 * `sha256(email)` from the commerce newsletter handler and
 * `hmac('aglyn-list-member', email)` truncated to 20 hex from the workflow
 * `enrollList` step. A person who arrived by both routes holds two documents
 * on one list.
 *
 * ## What this does, and the one thing it refuses to do
 *
 * It NEVER deletes a member document. An enrollment is the record that a
 * person asked to be on a list; it is the evidence behind every later send,
 * and behind an unsubscribe having been honoured. Removing one is not this
 * script's decision to make, and a merge that removes the row it merged is
 * indistinguishable from a merge that lost it.
 *
 * So the three states are handled asymmetrically, on purpose:
 *
 *  * **Legacy id only** — LEFT ALONE. `enrollListMember` finds these rows and
 *    keeps writing to them, so the person already has exactly one document.
 *    Copying them to a canonical id would give them a second one, which is
 *    the defect, arrived at from the other side.
 *  * **Canonical id only** — nothing to do.
 *  * **BOTH** — the genuinely split person. The canonical row is completed
 *    from the legacy row (earliest `addedAt` wins, fields the canonical row
 *    lacks are filled), and the legacy row is marked `supersededBy` so that a
 *    later, deliberate cleanup knows which rows are redundant and why, without
 *    having to re-derive the answer.
 *
 * ⚠️ **The member count stays inflated for split people until something
 * removes the superseded rows, and that is not this script.** The console's
 * list card counts documents. This is the honest trade: a wrong count is a
 * cosmetic defect, and an enrollment deleted by an automated pass is not
 * recoverable. Removal wants an owner decision and a report — which is what
 * the dry run prints.
 *
 * ## The precondition it can see
 *
 * `--apply` is refused unless the working tree it is run from actually
 * contains the fix. Two things are checked by reading the source, because a
 * guard on a write that cannot be undone must not be answerable by prose:
 *
 *  1. `person-key.ts` still derives the key the way this script does. If the
 *     shared helper changes, this file becomes a second, stale spelling of the
 *     id — which is the original defect — so it refuses rather than guesses.
 *  2. Neither enrollment route derives a member id of its own any more.
 *     Merging rows while a deployed writer still keys new ones the old way
 *     re-splits every person it just reconciled.
 *
 * ## Idempotence
 *
 * Re-running is a no-op: a legacy row already carrying `supersededBy` is
 * skipped, and the canonical row is only written where a field is actually
 * missing or older. Interruption is safe — the canonical row is completed
 * BEFORE the legacy row is marked, so a stop between the two leaves work this
 * script knows how to finish, and never a marked row whose content was not
 * copied.
 */
import { readFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const apply = process.argv.includes('--apply')
const selfTest = process.argv.includes('--self-test')
const orgArg = process.argv.find((a) => a.startsWith('--org='))
const onlyOrg = orgArg ? orgArg.slice('--org='.length) : null

/** Marks a row the canonical one now represents. Never a deletion. */
const SUPERSEDED_FIELD = 'supersededBy'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `normalizeContactEmail`, restated — see the source guard below. */
function normalizeEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 320 ? email : null
}

/** `personKey`, restated — see the source guard below. */
function personKeyFor(input) {
  const normalized = normalizeEmail(input)
  if (!normalized) return null
  return createHash('sha256').update(normalized).digest('hex')
}

/** The two ids this collection was written under before `personKey`. */
function legacyIdsFor(normalizedEmail) {
  return [
    createHash('sha256').update(normalizedEmail).digest('hex'),
    createHmac('sha256', 'aglyn-list-member')
      .update(normalizedEmail)
      .digest('hex')
      .slice(0, 20),
  ]
}

/**
 * Whether the tree still derives the key the way this file does.
 *
 * Matching on the derivation EXPRESSION rather than on a computed value: the
 * helper is TypeScript and this is a plain module, so the digest cannot be
 * compared by running both. What can be compared is that the one line which
 * decides the id has not moved out from under this copy.
 */
function helperMatches(source) {
  const normalizes = /const normalized = normalizeContactEmail\(email\)/.test(
    source,
  )
  const hashes =
    /createHash\('sha256'\)\s*\.update\(normalized\)\s*\.digest\('hex'\)(?!\s*\.slice)/.test(
      source,
    )
  if (!normalizes) return { ok: false, why: 'it no longer normalizes first' }
  if (!hashes) {
    return { ok: false, why: 'the digest is no longer a full sha256 of it' }
  }
  return { ok: true }
}

/** Whether a former call site still derives a member id for itself. */
function routeDerivesItsOwnId(source) {
  return /aglyn-list-member/.test(source) || /\.doc\(memberId\)/.test(source)
}

function preconditions() {
  const read = (path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8')
    } catch {
      return null
    }
  }
  const helper = read('libs/aglyn/src/lib/app-utils/person-key.ts')
  if (!helper) return { ok: false, why: 'person-key.ts could not be read' }
  const match = helperMatches(helper)
  if (!match.ok) {
    return {
      ok: false,
      why: `person-key.ts and this script disagree: ${match.why}`,
    }
  }
  const routes = [
    'libs/plugins/commerce/src/lib/server/newsletter.ts',
    'libs/tenant/runtime/src/lib/run-event-actions.ts',
  ]
  for (const path of routes) {
    const source = read(path)
    if (!source) return { ok: false, why: `${path} could not be read` }
    if (routeDerivesItsOwnId(source)) {
      return { ok: false, why: `${path} still derives a member id of its own` }
    }
  }
  return { ok: true }
}

/**
 * What to do about one list's members. Pure, so the self-test can drive every
 * state without a database.
 *
 * @param members `[{ id, data }]` as stored.
 */
export function planForList(members) {
  const byId = new Map(members.map((member) => [member.id, member]))
  const actions = []
  for (const member of members) {
    const email = normalizeEmail(member.data?.email)
    if (!email) {
      actions.push({ kind: 'unkeyable', id: member.id })
      continue
    }
    const canonical = personKeyFor(email)
    if (member.id === canonical) continue
    if (!legacyIdsFor(email).includes(member.id)) {
      // Keyed by neither derivation — a hand-seeded or imported row. Left
      // alone: this script knows what the two legacy ids mean and nothing
      // about what an unrecognized one meant to whoever wrote it.
      actions.push({ kind: 'unrecognized', id: member.id, email })
      continue
    }
    if (member.data?.[SUPERSEDED_FIELD]) continue
    if (!byId.has(canonical)) {
      // Legacy id only. `enrollListMember` adopts this row, so the person has
      // exactly one document and creating its canonical twin would be the
      // defect in reverse.
      actions.push({ kind: 'adopted-in-place', id: member.id, email })
      continue
    }
    actions.push({
      kind: 'merge',
      id: member.id,
      canonical,
      email,
      fill: fieldsToFill(byId.get(canonical).data ?? {}, member.data ?? {}),
    })
  }
  return actions
}

/**
 * What the canonical row is missing from the legacy row.
 *
 * `addedAt` is the one field where OLDER wins — it is the date the person
 * actually joined, and the collapse `docs/specs/email-overhaul.md` §3d
 * describes keeps the earliest. Every other field is filled only where the
 * canonical row has nothing, so a merge never overwrites a live value.
 */
function fieldsToFill(canonicalData, legacyData) {
  const fill = {}
  for (const [key, value] of Object.entries(legacyData)) {
    if (key === SUPERSEDED_FIELD) continue
    if (canonicalData[key] === undefined) fill[key] = value
  }
  const canonicalAddedAt = secondsOf(canonicalData.addedAt)
  const legacyAddedAt = secondsOf(legacyData.addedAt)
  if (
    legacyAddedAt !== null &&
    (canonicalAddedAt === null || legacyAddedAt < canonicalAddedAt)
  ) {
    fill.addedAt = legacyData.addedAt
  }
  return fill
}

/** Seconds from a Timestamp, a Date, or a number; null for anything else. */
function secondsOf(value) {
  if (value == null) return null
  if (typeof value === 'number') return value
  if (typeof value.toMillis === 'function') return value.toMillis() / 1000
  if (typeof value.seconds === 'number') return value.seconds
  if (value instanceof Date) return value.getTime() / 1000
  return null
}

async function migrate(firestore, { write }) {
  const tally = {
    lists: 0,
    members: 0,
    merged: 0,
    adoptedInPlace: 0,
    unrecognized: 0,
    unkeyable: 0,
  }
  const rows = []
  const orgs = onlyOrg
    ? [await firestore.collection('orgs').doc(onlyOrg).get()]
    : (await firestore.collection('orgs').get()).docs
  for (const org of orgs) {
    if (!org.exists) continue
    const lists = await org.ref.collection('lists').get()
    for (const list of lists.docs) {
      tally.lists += 1
      const membersRef = list.ref.collection('members')
      const members = (await membersRef.get()).docs.map((doc) => ({
        id: doc.id,
        data: doc.data() ?? {},
      }))
      tally.members += members.length
      for (const action of planForList(members)) {
        if (action.kind === 'unkeyable') {
          tally.unkeyable += 1
          rows.push([org.id, list.id, action.id, 'no usable email — left'])
          continue
        }
        if (action.kind === 'unrecognized') {
          tally.unrecognized += 1
          rows.push([org.id, list.id, action.id, 'unrecognized id — left'])
          continue
        }
        if (action.kind === 'adopted-in-place') {
          tally.adoptedInPlace += 1
          rows.push([org.id, list.id, action.id, 'legacy id, adopted in place'])
          continue
        }
        tally.merged += 1
        rows.push([
          org.id,
          list.id,
          action.id,
          `split — fills ${Object.keys(action.fill).length} field(s) into ${action.canonical.slice(0, 12)}…`,
        ])
        if (!write) continue
        // Destination first, and only then the marker: an interruption
        // between them leaves an unmarked legacy row, which is the state a
        // re-run knows how to finish.
        if (Object.keys(action.fill).length) {
          await membersRef.doc(action.canonical).set(action.fill, { merge: true })
        }
        const readBack = await membersRef.doc(action.canonical).get()
        if (!readBack.exists) {
          rows.push([org.id, list.id, action.id, 'ABORTED — canonical missing'])
          continue
        }
        await membersRef
          .doc(action.id)
          .set({ [SUPERSEDED_FIELD]: action.canonical }, { merge: true })
      }
    }
  }
  return { tally, rows }
}

function report({ tally, rows }, { write }) {
  console.log(
    `\n${write ? 'APPLIED' : 'DRY RUN'} — ${tally.lists} list(s), ${tally.members} member(s)\n`,
  )
  for (const [orgId, listId, id, note] of rows) {
    console.log(`  ${orgId}/${listId}/${id.slice(0, 16)}…  ${note}`)
  }
  console.log(
    [
      '',
      `  split, ${write ? 'merged' : 'would merge'}: ${tally.merged}`,
      `  legacy id kept in place:  ${tally.adoptedInPlace}`,
      `  unrecognized id, left:    ${tally.unrecognized}`,
      `  no usable email, left:    ${tally.unkeyable}`,
      '',
      '  Nothing was deleted. Superseded rows still count toward the',
      '  member total shown in the console until a separate, deliberate',
      '  pass removes them.',
      '',
    ].join('\n'),
  )
}

/**
 * Every state this script can meet, including the ones it must refuse to
 * damage. Runs against an in-memory store — no emulator, no credentials — so
 * that there is no reason not to run it.
 */
async function runSelfTest() {
  const results = []
  const check = (name, ok) => results.push([name, ok])

  const email = 'bob@example.com'
  const canonical = personKeyFor(email)
  const [legacySha, legacyHmac] = legacyIdsFor(email)

  check('the canonical key is the full sha256 of the normalized address', canonical ===
    createHash('sha256').update(email).digest('hex'))
  check('casing does not fork the key', personKeyFor('Bob@Example.COM') === canonical)
  check(
    'the newsletter legacy id equals the canonical one for a lowercase address',
    legacySha === canonical,
  )

  // A person under the truncated id alone must be LEFT, not copied.
  check(
    'a legacy-only row is left in place',
    planForList([{ id: legacyHmac, data: { email } }])[0].kind ===
      'adopted-in-place',
  )
  // CONTROL: the check above can fail.
  check(
    'CONTROL: a split person is NOT reported as left in place',
    planForList([
      { id: legacyHmac, data: { email } },
      { id: canonical, data: { email } },
    ])[0].kind === 'merge',
  )
  check(
    'a canonical-only row produces no action',
    planForList([{ id: canonical, data: { email } }]).length === 0,
  )
  check(
    'an already-superseded row produces no action',
    planForList([
      { id: legacyHmac, data: { email, [SUPERSEDED_FIELD]: canonical } },
      { id: canonical, data: { email } },
    ]).length === 0,
  )
  check(
    'an unrecognized id is left alone',
    planForList([{ id: 'hand-seeded-1', data: { email } }])[0].kind ===
      'unrecognized',
  )

  const merge = planForList([
    { id: legacyHmac, data: { email, addedAt: { seconds: 100 }, name: 'Bob' } },
    { id: canonical, data: { email, addedAt: { seconds: 900 } } },
  ])[0]
  check('a merge keeps the EARLIEST addedAt', merge.fill.addedAt?.seconds === 100)
  check('a merge fills a field the canonical row lacks', merge.fill.name === 'Bob')

  const noRegress = planForList([
    { id: legacyHmac, data: { email, addedAt: { seconds: 900 } } },
    { id: canonical, data: { email, addedAt: { seconds: 100 }, name: 'Real' } },
  ])[0]
  check(
    'a merge never moves addedAt forward',
    noRegress.fill.addedAt === undefined,
  )
  check(
    'a merge never overwrites a live field',
    noRegress.fill.name === undefined,
  )

  check(
    'a row with no usable email is not keyed',
    planForList([{ id: 'x', data: { email: 'not-an-email' } }])[0].kind ===
      'unkeyable',
  )

  // The guard itself must be able to fail.
  check(
    'the helper guard accepts the shipped derivation',
    helperMatches(
      "const normalized = normalizeContactEmail(email)\nreturn createHash('sha256').update(normalized).digest('hex')",
    ).ok,
  )
  check(
    'CONTROL: the helper guard refuses a truncated digest',
    !helperMatches(
      "const normalized = normalizeContactEmail(email)\nreturn createHash('sha256').update(normalized).digest('hex').slice(0, 20)",
    ).ok,
  )
  check(
    'CONTROL: the helper guard refuses an unnormalized digest',
    !helperMatches("return createHash('sha256').update(String(email)).digest('hex')").ok,
  )
  check(
    'the route guard spots a local hmac derivation',
    routeDerivesItsOwnId("createHmac('sha256', 'aglyn-list-member')"),
  )
  check(
    'the route guard passes a route that delegates',
    !routeDerivesItsOwnId('await enrollListMember({ listRef, email })'),
  )

  for (const [name, ok] of results) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`)
  }
  const failed = results.filter(([, ok]) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} passed\n`)
  return failed === 0
}

if (selfTest) {
  const ok = await runSelfTest()
  process.exit(ok ? 0 : 1)
}

const gate = preconditions()
if (apply && !gate.ok) {
  console.error(
    `\nREFUSING --apply: ${gate.why}.\n\n` +
      'This script merges rows on the assumption that the tree it is run from\n' +
      'is the code that is deployed. Fix the mismatch and run it again.\n',
  )
  process.exit(1)
}

initializeApp({ credential: applicationDefault() })
const result = await migrate(getFirestore(), { write: apply })
report(result, { write: apply })
if (!apply) {
  console.log('  Re-run with --apply to write.\n')
}
process.exit(0)
