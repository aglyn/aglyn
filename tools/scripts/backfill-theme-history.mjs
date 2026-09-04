/**
 * Theme undo-buffer relocation (host document slimming).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-theme-history.mjs \
 *     [--apply] [--host=<hostId>]
 *
 *   FIRESTORE_EMULATOR_HOST=… node tools/scripts/backfill-theme-history.mjs --self-test
 *
 * DRY RUN BY DEFAULT.
 *
 * Moves `hosts/{hostId}.themeReplaced` — the verbatim copy of the theme a
 * marketplace install displaced, kept so `revert` can put it back — into
 * `hosts/{hostId}/themeHistory/previous`, and leaves a `themeReplacedAt`
 * timestamp on the host document in its place.
 *
 * ## Why this field and no other
 *
 * `hosts/{hostId}` is read on every tenant render. Measured against
 * production, the whole document comes back in one `BatchGetDocuments` and
 * the round trip — not the payload — is the cost, so slimming the document
 * buys nothing until a field is large. The question that decides a move is
 * therefore not "is this field big" but "does the render path need it",
 * and `themeReplaced` is the one field where the answer is a clean no:
 *
 *  * The tenant never reads it. Its only reader and writer anywhere is
 *    `libs/plugins/marketplace/src/lib/server/install-theme.ts`, on the
 *    Admin SDK, in the install/reset/revert actions.
 *  * It is a whole theme by construction — `{ theme, override, installedFrom,
 *    replacedAt }` copied verbatim — so it tracks the size of the field it
 *    shadows. A site with a 60 KB custom theme carries 60 KB of live theme
 *    the render needs and ~60 KB of undo buffer it does not.
 *  * It is bounded to ONE previous theme (each swap overwrites), so this is
 *    not a growth problem that also needs a retention rule.
 *
 * The console still has to know whether a revert is POSSIBLE — that is what
 * enables "Go back to the previous theme" in `theme-source-card.component`,
 * which today receives the whole `themeReplaced` object to answer a boolean.
 * `themeReplacedAt` is that boolean, at eight bytes, and it is why this
 * migration leaves a marker rather than simply deleting the field: the
 * affordance must not depend on reading the payload it exists to restore.
 *
 * ## ⚠️ Blocked on a rules change, which is NOT in this script
 *
 * `hosts/{hostId}/{subcollection}/{document=**}` is a catch-all that grants
 * create/update/delete to `canWriteHostContent` — admin, editor AND author —
 * for every subcollection name not explicitly excluded. A new
 * `themeHistory` collection is therefore client-writable by default, and a
 * forgeable revert target is a way to push arbitrary CSS onto a live site
 * from the narrowest role we sell. `themeHistory` must be added to all three
 * exclusion lists in `cloud/firebase-firestore.rules` — it has no client
 * writer at all — and that change must be deployed BEFORE this runs.
 *
 * The script refuses to `--apply` until it can see the name inside all three
 * of those `subcollection in [...]` lists, so the ordering cannot be got wrong
 * by forgetting it — and a comment about the change does not count, because a
 * guard on an irreversible run must not be answerable by prose.
 *
 * ## Idempotence and interruption
 *
 * Re-running is a no-op: a host whose field is already gone and whose
 * history document already exists is skipped. The write order is
 * destination-first, and the source field is deleted only after the
 * destination has been read BACK and compared — so an interruption leaves
 * the field still on the host document, which is the state this script
 * knows how to finish. It never leaves a host with neither copy.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const apply = process.argv.includes('--apply')
const selfTest = process.argv.includes('--self-test')
const hostArg = process.argv.find((a) => a.startsWith('--host='))
const onlyHost = hostArg ? hostArg.slice('--host='.length) : null

/** Where the undo buffer moves to. One document, overwritten per swap. */
const HISTORY_COLLECTION = 'themeHistory'
const HISTORY_DOC = 'previous'
/** The eight-byte marker that keeps the console's "Go back" button honest. */
const MARKER_FIELD = 'themeReplacedAt'
const SOURCE_FIELD = 'themeReplaced'

/**
 * Serialized size, for the report only. This is JSON byte length, not
 * Firestore's storage accounting — the numbers below compare fields against
 * each other, and a second model would only invite the comparison to be read
 * as a billing figure.
 */
const bytes = (value) =>
  value === undefined ? 0 : Buffer.byteLength(JSON.stringify(value), 'utf8')

/**
 * Comments out, code and strings intact — a scanner, not two regexes.
 *
 * Two regexes in either order corrupt this particular file. Block-first:
 * `// … hosts/{hostId}/datasets/*` opens a block comment inside a LINE
 * comment, and the strip runs to the next block-comment close, deleting the
 * three exclusion lists this guard exists to read — silently, so the guard
 * then reports perfectly good rules as still missing the name. Line-first has
 * the mirror hazard on a one-line block comment. Since what is at stake is
 * whether an irreversible migration may run, the parse is exact rather than
 * approximately right.
 */
function stripComments(source) {
  let out = ''
  let mode = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        i += 1
      } else if (char === '/' && next === '*') {
        mode = 'block'
        i += 1
      } else {
        if (char === "'" || char === '"') {
          mode = 'string'
          quote = char
        }
        out += char
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      } else if (char === '\n') out += char
    } else {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) mode = 'code'
    }
  }
  return out
}

/** Body of the first brace-balanced block introduced by `header`. */
function blockBody(source, header) {
  const start = source.indexOf(header)
  if (start < 0) return null
  let depth = 0
  for (let i = start + header.length - 1; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && --depth === 0) {
      return source.slice(start + header.length, i)
    }
  }
  return null
}

const HOST_HEADER = 'match /hosts/{hostId} {'
const CATCH_ALL_HEADER = 'match /{subcollection}/{document=**} {'
const DENIED_OPERATIONS = ['create', 'update', 'delete']

/**
 * The rules must already deny clients this collection — see the header. Read
 * from the rules SOURCE rather than trusting a deploy, because the failure
 * this guards is "the migration ran and the rules change did not".
 *
 * The name has to appear inside the `subcollection in [...]` exclusion list of
 * each of the host catch-all's three write allows, and nowhere else counts.
 * Comments are stripped FIRST, because the cheap version of this check —
 * counting quoted occurrences anywhere in the file — is satisfied by a comment
 * that merely discusses the change, and a guard whose whole job is to refuse
 * an irreversible run must not be answerable by prose.
 *
 * Takes the source rather than only reading it so the self-test can hold that
 * property against rules texts it stages; production passes nothing.
 */
function rulesDenyClientWrites(rulesSource) {
  const source = stripComments(
    rulesSource ??
      readFileSync(join(REPO_ROOT, 'cloud', 'firebase-firestore.rules'), 'utf8'),
  )

  const host = blockBody(source, HOST_HEADER)
  const catchAll = host && blockBody(host, CATCH_ALL_HEADER)
  if (!catchAll) {
    return {
      occurrences: 0,
      ok: false,
      why: `no \`${CATCH_ALL_HEADER}\` under \`${HOST_HEADER}\` — the rules have been restructured, re-read them before trusting this guard`,
    }
  }

  const covered = DENIED_OPERATIONS.filter((operation) => {
    const statement = catchAll
      .split(';')
      .find((entry) => new RegExp(`\\ballow\\b[^:]*\\b${operation}\\b`).test(entry))
    const list = statement?.match(/subcollection\s+in\s+\[([^\]]*)\]/)
    return Boolean(list) && list[1].includes(`'${HISTORY_COLLECTION}'`)
  })

  return {
    occurrences: covered.length,
    ok: covered.length === DENIED_OPERATIONS.length,
    why:
      covered.length === DENIED_OPERATIONS.length
        ? 'denied to clients on create, update and delete'
        : `missing from the ${DENIED_OPERATIONS.filter((o) => !covered.includes(o)).join('/')} exclusion list(s)`,
  }
}

/**
 * What this host needs, as a verdict rather than an action — so the dry run
 * and the apply run cannot disagree about what was planned.
 */
function planFor(hostDoc, historySnapshot) {
  const replaced = hostDoc.get(SOURCE_FIELD)
  const historyExists = historySnapshot.exists
  const hasMarker = hostDoc.get(MARKER_FIELD) !== undefined

  if (replaced === undefined) {
    if (historyExists) return { action: 'done', why: 'already migrated' }
    return { action: 'skip', why: 'no theme history on this site' }
  }
  if (historyExists) {
    return {
      action: 'finish',
      why: 'interrupted run — history written, host field not yet cleared',
      replaced,
    }
  }
  return {
    action: 'move',
    why: hasMarker ? 'field returned after a migration' : 'first migration',
    replaced,
  }
}

/**
 * `tamper` is a seam, and it exists for one reason: the read-back guard below
 * is the only thing standing between a half-written destination and the
 * permanent loss of a theme that exists in no other document, and a guard
 * nothing can make fire is a guard nobody can prove is still there. Removing
 * the read-back leaves every other assertion in the self-test green — which
 * was measured, not assumed. The self-test passes a `tamper` that corrupts
 * the destination between the write and the read-back; production never
 * passes one, so the seam costs the real run a single undefined check.
 */
async function migrate(firestore, { write, tamper }) {
  const hosts = onlyHost
    ? [await firestore.collection('hosts').doc(onlyHost).get()]
    : (await firestore.collection('hosts').get()).docs

  const tally = { move: 0, finish: 0, done: 0, skip: 0, bytesFreed: 0 }
  const rows = []

  for (const hostDoc of hosts) {
    if (!hostDoc.exists) continue
    const historyRef = hostDoc.ref
      .collection(HISTORY_COLLECTION)
      .doc(HISTORY_DOC)
    const plan = planFor(hostDoc, await historyRef.get())
    tally[plan.action] += 1

    if (plan.action === 'move' || plan.action === 'finish') {
      const freed = bytes(plan.replaced) - 8 // the marker replaces it
      tally.bytesFreed += freed
      rows.push({
        id: hostDoc.id,
        subdomain: hostDoc.get('subdomain') ?? hostDoc.get('cname') ?? '—',
        action: plan.action,
        why: plan.why,
        freed,
        docBefore: bytes(hostDoc.data()),
      })
    }

    if (!write) continue

    if (plan.action === 'move' || plan.action === 'finish') {
      // DESTINATION FIRST, and never a delete that is not preceded by a
      // read-back. `themeReplaced` is the only copy of a theme that may
      // exist in no listing anywhere — a hand-built theme a site replaced —
      // so losing it to a half-finished write is not recoverable from
      // anything else in the database.
      await historyRef.set(plan.replaced, { merge: false })
      if (tamper) await tamper(historyRef)
      const readBack = await historyRef.get()
      if (JSON.stringify(readBack.data()) !== JSON.stringify(plan.replaced)) {
        throw new Error(
          `${hostDoc.id}: history read-back did not match; host field LEFT IN PLACE`,
        )
      }
      await hostDoc.ref.set(
        {
          [SOURCE_FIELD]: FieldValue.delete(),
          // Preserve the moment the swap happened where one was recorded,
          // rather than stamping "now" — the marker answers "is there a way
          // back", and a fabricated date would also answer "when", wrongly.
          [MARKER_FIELD]:
            plan.replaced?.replacedAt ?? hostDoc.get(MARKER_FIELD) ?? null,
        },
        { merge: true },
      )
    }
  }

  return { tally, rows }
}

function report({ tally, rows }, { write }) {
  console.log(
    `\n${write ? 'APPLIED' : 'DRY RUN — nothing was written'}\n` +
      `  move ${tally.move}   finish ${tally.finish}   ` +
      `already-migrated ${tally.done}   nothing-to-do ${tally.skip}\n`,
  )
  if (!rows.length) {
    console.log('  no host carries a theme undo buffer.\n')
    return
  }
  console.log(
    '  host'.padEnd(26) +
      'site'.padEnd(24) +
      'action'.padEnd(9) +
      'doc before'.padStart(11) +
      'freed'.padStart(9),
  )
  for (const r of rows) {
    console.log(
      `  ${r.id}`.padEnd(26) +
        String(r.subdomain).padEnd(24) +
        r.action.padEnd(9) +
        `${r.docBefore} B`.padStart(11) +
        `${r.freed} B`.padStart(9) +
        `   (${r.why})`,
    )
  }
  console.log(
    `\n  total removed from the hot document: ${tally.bytesFreed} B\n`,
  )
}

// ---------------------------------------------------------------- self-test
/**
 * Runs the real `migrate` against the emulator over fixtures that stage every
 * state this script can meet, including the two it must refuse to damage.
 *
 * Each case asserts the OUTCOME of a real run, not the shape of a plan — a
 * test that only checked `planFor` would pass against a migrate() that wrote
 * nothing at all.
 */
async function runSelfTest(firestore) {
  const FIXTURES = {
    'fresh-install': {
      subdomain: 'fresh',
      theme: { palette: { primary: { main: '#0af' } } },
      themeReplaced: {
        theme: { palette: { primary: { main: '#111' } } },
        replacedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    'never-swapped': { subdomain: 'plain', theme: { palette: {} } },
    'no-theme-at-all': { subdomain: 'bare' },
    'already-migrated': { subdomain: 'done', themeReplacedAt: '2026-02-02' },
    interrupted: {
      subdomain: 'halfway',
      themeReplaced: {
        theme: { palette: { primary: { main: '#222' } } },
        replacedAt: '2026-03-03T00:00:00.000Z',
      },
    },
  }
  const failures = []
  const check = (label, condition, detail = '') => {
    if (condition) console.log(`  ✓ ${label}`)
    else {
      console.log(`  ✗ ${label} ${detail}`)
      failures.push(label)
    }
  }

  /**
   * HERMETIC, and not as a nicety. Run twice against one emulator, the second
   * run inherits the first run's control host — whose history document already
   * exists — so its plan comes back `finish` instead of `move` and the CONTROL
   * assertion fails for a reason that has nothing to do with the code under
   * test. A check that reds on leftovers is no more useful than one that
   * greens on them.
   */
  const wipe = async () => {
    const existing = await firestore.collection('hosts').get()
    for (const d of existing.docs) {
      for (const sub of await d.ref.listCollections()) {
        for (const child of (await sub.get()).docs) await child.ref.delete()
      }
      await d.ref.delete()
    }
  }

  const seed = async () => {
    await wipe()
    for (const [id, data] of Object.entries(FIXTURES)) {
      await firestore.collection('hosts').doc(id).set(data)
      const history = firestore
        .collection('hosts')
        .doc(id)
        .collection(HISTORY_COLLECTION)
        .doc(HISTORY_DOC)
      if (id === 'already-migrated') {
        await history.set({ theme: { palette: { primary: { main: '#333' } } } })
      } else if (id === 'interrupted') {
        await history.set(FIXTURES.interrupted.themeReplaced)
      } else {
        await history.delete()
      }
    }
  }
  const read = async (id) => (await firestore.collection('hosts').doc(id).get()).data()
  const readHistory = async (id) =>
    (
      await firestore
        .collection('hosts')
        .doc(id)
        .collection(HISTORY_COLLECTION)
        .doc(HISTORY_DOC)
        .get()
    ).data()

  console.log('\nself-test (emulator fixtures)\n')

  // --- 1. a dry run must change NOTHING. Compared byte-for-byte, because
  //        "the counts looked right" is how a dry run that writes gets shipped.
  await seed()
  const before = JSON.stringify(
    await Promise.all(Object.keys(FIXTURES).map(read)),
  )
  const dry = await migrate(firestore, { write: false })
  const after = JSON.stringify(
    await Promise.all(Object.keys(FIXTURES).map(read)),
  )
  check('a dry run leaves every host document byte-identical', before === after)
  check(
    'a dry run still PLANS the two hosts that need work',
    dry.tally.move === 1 && dry.tally.finish === 1,
    `(move=${dry.tally.move} finish=${dry.tally.finish})`,
  )

  // --- 2. the apply run
  const applied = await migrate(firestore, { write: true })
  check(
    'apply moved the payload off the fresh-install host',
    (await read('fresh-install')).themeReplaced === undefined,
  )
  check(
    'apply wrote the payload into themeHistory/previous, intact',
    JSON.stringify(await readHistory('fresh-install')) ===
      JSON.stringify(FIXTURES['fresh-install'].themeReplaced),
  )
  check(
    'the revert affordance survives as a marker carrying the ORIGINAL date',
    (await read('fresh-install')).themeReplacedAt ===
      FIXTURES['fresh-install'].themeReplaced.replacedAt,
  )
  check(
    'an interrupted host is finished rather than re-copied',
    (await read('interrupted')).themeReplaced === undefined &&
      JSON.stringify(await readHistory('interrupted')) ===
        JSON.stringify(FIXTURES.interrupted.themeReplaced),
  )
  check(
    'a host that never swapped a theme is untouched',
    JSON.stringify(await read('never-swapped')) ===
      JSON.stringify(FIXTURES['never-swapped']),
  )
  check(
    'an already-migrated host is left exactly as it was',
    JSON.stringify(await read('already-migrated')) ===
      JSON.stringify(FIXTURES['already-migrated']),
  )
  check(
    'apply reports the work it did',
    applied.tally.move === 1 && applied.tally.finish === 1,
    `(move=${applied.tally.move} finish=${applied.tally.finish})`,
  )

  // --- 3. idempotence: the second run must find nothing and change nothing
  const settled = JSON.stringify(
    await Promise.all(Object.keys(FIXTURES).map(read)),
  )
  const second = await migrate(firestore, { write: true })
  check(
    're-running finds no work',
    second.tally.move === 0 && second.tally.finish === 0,
    `(move=${second.tally.move} finish=${second.tally.finish})`,
  )
  check(
    're-running changes nothing',
    settled ===
      JSON.stringify(await Promise.all(Object.keys(FIXTURES).map(read))),
  )

  // --- 4. THE CONTROL. These assertions must be able to fail. A run against
  //        fixtures nobody staged would report all-green above, so prove the
  //        harness sees a host that still needs work.
  const controlRef = firestore.collection('hosts').doc('control-must-be-seen')
  await controlRef
    .collection(HISTORY_COLLECTION)
    .doc(HISTORY_DOC)
    .delete()
  await controlRef.set({
    subdomain: 'ctl',
    themeReplaced: { theme: { palette: {} } },
  })
  const control = await migrate(firestore, { write: false })
  check(
    'CONTROL: a newly staged host is detected (the checks above can fail)',
    control.tally.move === 1,
    `(move=${control.tally.move})`,
  )

  // --- 5. the read-back guard itself. Corrupt the destination after it is
  //        written and the run must ABORT with the host field still in place.
  //        Without this, deleting the guard passes every check above.
  await seed()
  let threw = null
  try {
    await migrate(firestore, {
      write: true,
      tamper: (ref) => ref.set({ theme: 'CORRUPTED' }, { merge: false }),
    })
  } catch (error) {
    threw = error
  }
  check(
    'a corrupted destination aborts the run',
    threw !== null && String(threw.message).includes('read-back did not match'),
    `(threw: ${threw?.message ?? 'nothing'})`,
  )
  check(
    'and the host keeps its only copy of the theme',
    JSON.stringify((await read('fresh-install')).themeReplaced) ===
      JSON.stringify(FIXTURES['fresh-install'].themeReplaced),
  )

  // --- 6. the ordering guard. `--apply` is refused until the rules deny the
  //        new collection to clients, so the thing that decides that must be
  //        answerable only by the rules and not by a comment ABOUT them.
  const rulesText = (lists) => `
    service cloud.firestore {
      match /databases/{database}/documents {
        match /hosts/{hostId} {
          allow read: if true;
          match /{subcollection}/{document=**} {
            allow create: if canWriteHostContent(hostId) &&
              !(subcollection in [${lists.create.map((n) => `'${n}'`).join(', ')}]);
            allow update: if canWriteHostContent(hostId) &&
              !(subcollection in [${lists.update.map((n) => `'${n}'`).join(', ')}]);
            allow delete: if canWriteHostContent(hostId) &&
              !(subcollection in [${lists.delete.map((n) => `'${n}'`).join(', ')}]);
          }
        }
      }
    }`
  const all3 = [HISTORY_COLLECTION, 'screens']
  check(
    'the rules guard passes when the name is in all three exclusion lists',
    rulesDenyClientWrites(
      rulesText({ create: all3, update: all3, delete: all3 }),
    ).ok,
  )
  check(
    'CONTROL: two of three is refused (the check above can fail)',
    !rulesDenyClientWrites(
      rulesText({ create: all3, update: all3, delete: ['screens'] }),
    ).ok,
  )
  const inCommentsOnly = rulesText({
    create: ['screens'],
    update: ['screens'],
    delete: ['screens'],
  }).replace(
    'allow read: if true;',
    `// TODO add '${HISTORY_COLLECTION}' to create,\n` +
      `// '${HISTORY_COLLECTION}' to update and '${HISTORY_COLLECTION}' to delete\n` +
      'allow read: if true;',
  )
  check(
    'a comment merely NAMING the collection three times does not satisfy it',
    !rulesDenyClientWrites(inCommentsOnly).ok,
    `(${rulesDenyClientWrites(inCommentsOnly).why})`,
  )
  check(
    'CONTROL: that fixture really does name it three times (a count would pass)',
    inCommentsOnly.split(`'${HISTORY_COLLECTION}'`).length - 1 === 3,
  )
  check(
    'restructured rules with no host catch-all are refused, not assumed safe',
    !rulesDenyClientWrites('service cloud.firestore { }').ok,
  )
  // The real file carries `// … hosts/{hostId}/datasets/*` in a line comment.
  // Strip block comments first and that opens one, swallowing the exclusion
  // lists whole and reporting perfectly good rules as missing the name.
  //
  // The block comment BELOW the line comment is what makes this bite, and it is
  // why the first version of this case passed against the broken parser: with
  // nothing to close it the runaway block comment matches nothing and the lists
  // survive by accident. The real file has a hundred of them.
  const withSlashStarInLineComment = rulesText({
    create: all3,
    update: all3,
    delete: all3,
  })
    .replace(
      'allow read: if true;',
      '// hosts/{hostId}/datasets/* is client-writable\n      allow read: if true;',
    )
    .concat('\n/* a later block comment, as every real rules file has */\n')
  check(
    'a line comment containing `/*` does not swallow the lists it precedes',
    rulesDenyClientWrites(withSlashStarInLineComment).ok,
    `(${rulesDenyClientWrites(withSlashStarInLineComment).why})`,
  )

  console.log(
    failures.length
      ? `\n${failures.length} FAILED: ${failures.join('; ')}\n`
      : '\nall self-test assertions passed\n',
  )
  return failures.length === 0
}

// ---------------------------------------------------------------- main
if (selfTest) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('--self-test requires FIRESTORE_EMULATOR_HOST. Refusing.')
    process.exit(1)
  }
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-theme-history' })
  const ok = await runSelfTest(getFirestore())
  process.exit(ok ? 0 : 1)
}

const rules = rulesDenyClientWrites()
if (apply && !rules.ok) {
  console.error(
    `REFUSING TO APPLY. '${HISTORY_COLLECTION}' is excluded from ` +
      `${rules.occurrences} of ${DENIED_OPERATIONS.length} write allows in the ` +
      `host subcollection catch-all of cloud/firebase-firestore.rules ` +
      `(${rules.why}). All three, and DEPLOYED, before any host document is ` +
      `rewritten — until then the collection is writable by any editor or author.`,
  )
  process.exit(1)
}
if (!rules.ok) {
  console.log(
    `\n⚠️  '${HISTORY_COLLECTION}' is denied to clients on ` +
      `${rules.occurrences} of ${DENIED_OPERATIONS.length} operations ` +
      `(${rules.why}). --apply is blocked until the rules deny all three.`,
  )
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
report(
  await migrate(getFirestore(process.env.FIRESTORE_DATABASE_ID), { write: apply }),
  { write: apply },
)
process.exit(0)
