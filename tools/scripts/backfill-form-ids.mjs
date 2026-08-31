/**
 * Stamp `formId` onto the submissions an adopted form already collected.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-form-ids.mjs \
 *     [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-form-ids.mjs --self-test
 *
 * DRY RUN BY DEFAULT.
 *
 * Every form on the platform predates the form entity, so every submission
 * already collected carries a caption (`formName`) and a page path (`path`)
 * and no id. Adopting a form mints `hosts/{hostId}/forms/{formId}` with a
 * `legacyMatch: { formName, paths }` recording what that form was called and
 * where it rendered; this reads those claims and stamps `formId` onto the
 * rows they identify.
 *
 * A design that only works for new forms is not a design. This is the half
 * that makes an adopted form's history its own.
 *
 * ## ⛔ AN AMBIGUOUS SUBMISSION IS LEFT ALONE
 *
 * The two failure modes are not symmetric, and the whole matching rule falls
 * out of that:
 *
 *  - An UNMATCHED row is still in the Inbox, still readable, still exportable
 *    over `/v1`. It is missing from one form's list, this script counts it,
 *    and a later adoption can still claim it.
 *  - A WRONGLY STAMPED row is filed under a form it was never sent to. It
 *    leaves the Inbox's unassigned view, joins a stranger's submission list,
 *    and nothing on any screen says it moved. It is invisible, and invisible
 *    is not recoverable.
 *
 * So the match is on the PAIR `(formName, path)`, and exactly one form may
 * claim it. `formName` alone is a caption two pages may legitimately share —
 * that shared caption is the defect the form entity exists to fix, and using
 * it as the migration key would carry the defect into the migration. A
 * submission that recorded no path is never matched: older rows genuinely
 * predate the field, and falling back to the caption is the guess this
 * refuses.
 *
 * ## Two preconditions, both read from the tree
 *
 * Neither is answerable by prose. A guard on a run that rewrites customer
 * rows must not be satisfiable by a comment promising the change.
 *
 *  1. **The tenant route must already stamp `formId`.** Filling a field that
 *     nothing maintains going forward is the "reported success while doing
 *     nothing" shape: the backfilled rows would be correct and every row
 *     arriving after the run would not, so the gap grows from the moment the
 *     script reports success.
 *  2. **`forms` must be denied to client CREATE in the rules.** `legacyMatch`
 *     decides where a visitor's submission is filed. If a form document could
 *     be minted from the browser, the claim this script trusts could be
 *     written by anyone the host lets author, against any caption and path.
 *
 * ## Idempotence and interruption
 *
 * Re-running is a no-op: a submission that already carries a `formId` is
 * never re-examined, and one left unmatched is re-offered on the next run
 * against whatever forms have been adopted since. Writes are one field on one
 * document with no companion state, so an interruption leaves a partially
 * stamped collection — which is exactly the state a re-run finishes.
 *
 * Nothing is ever deleted, and no submission is modified other than by
 * gaining the field. `formName` and `path` are left as they are: the legacy
 * `?form=` filter still reads them, and no phase of this work removes it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/*
 * ARGUMENTS FAIL CLOSED, for the same reason the deploys do (AGL-1489).
 *
 * Scanning argv for known flags and ignoring the rest makes a typo silent,
 * and the two typos available here both widen the run rather than narrowing
 * it. `--hosts=abc` or `--host abc` leaves `onlyHost` null, so a run the
 * operator scoped to one site sweeps EVERY host on the platform; `--aply`
 * leaves a run they believe is writing as a dry run, which reads as success
 * and stamps nothing. Both produce a report about a job that is not the job
 * that ran.
 *
 * So an unrecognized argument exits 2 having written nothing, and `--help`
 * prints usage instead of scanning a live project.
 */
const args = parseDeployArgs({
  command: 'backfill-form-ids',
  summary:
    'Stamp `formId` onto the submissions an adopted form already collected, ' +
    'matching on the (formName, path) pair. Writes to the live project with ' +
    '--apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host.' },
  ],
})
const apply = args.apply
const selfTest = args.selfTest
const onlyHost = args.host

/** How many submissions to read per page. */
const PAGE_SIZE = 400
const FORM_NAME_MAX = 100
const PATH_MAX = 500

/**
 * `normalizeSubmissionFormName`, restated — see the source guard below.
 *
 * Must produce the string the submit route WROTE, or every match misses
 * silently and in the safe direction, which is the failure that looks like
 * success: the script would report "0 matched, N unmatched" and read as a
 * site with genuinely ambiguous history.
 */
function submissionFormName(value) {
  return String(value ?? '').trim()
    ? String(value).slice(0, FORM_NAME_MAX)
    : 'Form'
}

/** `normalizeSubmissionPath`, restated — see the source guard below. */
function submissionPath(value) {
  return String(value ?? '').slice(0, PATH_MAX)
}

/**
 * `matchSubmissionToForm`, restated — see the source guard below.
 *
 * @returns the form id to stamp, or `null` to leave the row alone. Never a
 *          best guess.
 */
function matchSubmission(submission, candidates) {
  const formName = submissionFormName(submission.formName)
  const path = submissionPath(submission.path)
  if (!path) return null
  const matched = candidates.filter(
    (candidate) =>
      candidate.legacyMatch?.formName === formName &&
      Array.isArray(candidate.legacyMatch?.paths) &&
      candidate.legacyMatch.paths.includes(path),
  )
  return matched.length === 1 ? matched[0].formId : null
}

/**
 * Comments out, code and strings intact — a scanner, not two regexes.
 *
 * Two regexes in either order corrupt a real source file: block-first, a
 * `//`-comment mentioning a block opener swallows everything to the next
 * close, deleting the very text a guard exists to read — silently, so the
 * guard then reports a correct tree as failing. Since what is at stake is
 * whether a run that rewrites customer rows may proceed, the parse is exact.
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
        if (char === "'" || char === '"' || char === '`') {
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

/**
 * Whether the rules already refuse a client-minted form document.
 *
 * Read from the rules SOURCE rather than trusting a deploy, because the
 * failure this guards is "the migration ran and the rules change did not".
 * Only membership of the catch-all's CREATE exclusion list counts; a
 * dedicated block that grants nothing is not a denial, because sibling match
 * blocks are OR'd and the looser allow wins.
 */
function rulesDenyClientFormCreate(rulesSource) {
  const source = stripComments(
    rulesSource ??
      readFileSync(join(REPO_ROOT, 'cloud', 'firebase-firestore.rules'), 'utf8'),
  )
  const host = blockBody(source, HOST_HEADER)
  const catchAll = host && blockBody(host, CATCH_ALL_HEADER)
  if (!catchAll) {
    return {
      ok: false,
      why: `no \`${CATCH_ALL_HEADER}\` under \`${HOST_HEADER}\` — the rules have been restructured, re-read them before trusting this guard`,
    }
  }
  const statement = catchAll
    .split(';')
    .find((entry) => /\ballow\b[^:]*\bcreate\b/.test(entry))
  const list = statement?.match(/subcollection\s+in\s+\[([^\]]*)\]/)
  const ok = Boolean(list) && list[1].includes("'forms'")
  return {
    ok,
    why: ok
      ? 'client form creation is denied by the catch-all'
      : "'forms' is missing from the catch-all's create exclusion list",
  }
}

/**
 * Whether the tenant route stamps the field this script fills.
 *
 * Matched on the WRITE expression rather than on the word `formId`, which
 * appears in the route as a request field, a validation and a comment. What
 * has to be true is that the submission document gains the id.
 */
function routeStampsFormId(routeSource) {
  const source = stripComments(
    routeSource ??
      readFileSync(
        join(REPO_ROOT, 'apps', 'tenant', 'app', 'api', 'forms', 'submit', 'route.ts'),
        'utf8',
      ),
  )
  const ok = /formId:\s*form\.id/.test(source)
  return {
    ok,
    why: ok
      ? 'the submit route stamps `formId` on every bound submission'
      : 'the submit route does not stamp `formId` — backfilling a field nothing maintains leaves a gap that grows from the moment this reports success',
  }
}

/**
 * Whether the tree still matches the way this file does.
 *
 * Matching on the derivation EXPRESSION rather than on a computed value: the
 * helper is TypeScript and this is a plain module, so it cannot be imported
 * and compared by result. What can be compared is that the rule is still the
 * pair rule and still refuses more than one claimant.
 */
function helperMatches(helperSource) {
  const source = stripComments(helperSource)
  const checks = [
    [
      'matches on the caption AND the path',
      /legacyMatch\?\.formName === formName/.test(source) &&
        /legacyMatch\.paths\.includes\(path\)/.test(source),
    ],
    [
      'refuses a pathless submission',
      /if \(!path\) return null/.test(source),
    ],
    [
      'refuses more than one claimant',
      /matched\.length === 1/.test(source),
    ],
    [
      'files an unnamed form under `Form`',
      /'Form'/.test(source),
    ],
  ]
  const missing = checks.filter(([, held]) => !held).map(([name]) => name)
  return {
    ok: missing.length === 0,
    why: missing.length ? `no longer ${missing.join('; no longer ')}` : 'agrees',
  }
}

function preconditions() {
  const read = (path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8')
    } catch {
      return null
    }
  }
  const helper = read('libs/aglyn/src/lib/app-utils/forms.ts')
  if (!helper) return { ok: false, why: 'forms.ts could not be read' }
  const agrees = helperMatches(helper)
  if (!agrees.ok) {
    return { ok: false, why: `forms.ts and this script disagree: ${agrees.why}` }
  }
  const stamps = routeStampsFormId()
  if (!stamps.ok) return { ok: false, why: stamps.why }
  const rules = rulesDenyClientFormCreate()
  if (!rules.ok) return { ok: false, why: rules.why }
  return { ok: true, why: `${agrees.why}; ${stamps.why}; ${rules.why}` }
}

/**
 * What one host's submissions need, as a verdict rather than an action — so
 * the dry run and the apply run cannot disagree about what was planned.
 */
export function planForHost(forms, submissions) {
  const candidates = forms
    .filter((form) => form.legacyMatch?.formName)
    .map((form) => ({ formId: form.formId, legacyMatch: form.legacyMatch }))
  const plan = { stamp: [], unmatched: [], alreadyStamped: 0, candidates: candidates.length }
  for (const submission of submissions) {
    if (submission.formId) {
      plan.alreadyStamped += 1
      continue
    }
    const formId = matchSubmission(submission, candidates)
    if (formId) plan.stamp.push({ id: submission.id, formId })
    else plan.unmatched.push(submission.id)
  }
  return plan
}

async function run() {
  const gate = preconditions()
  console.log(`preconditions: ${gate.ok ? 'OK' : 'REFUSED'} — ${gate.why}`)
  if (apply && !gate.ok) {
    console.error('\nrefusing --apply until the preconditions above hold.')
    process.exitCode = 1
    return
  }

  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()

  const hostDocs = onlyHost
    ? [await firestore.collection('hosts').doc(onlyHost).get()]
    : (await firestore.collection('hosts').select().get()).docs

  const totals = { stamped: 0, unmatched: 0, alreadyStamped: 0, hosts: 0 }

  for (const hostDoc of hostDocs) {
    if (!hostDoc.exists) {
      console.log(`host ${hostDoc.id}: does not exist`)
      continue
    }
    const hostRef = firestore.collection('hosts').doc(hostDoc.id)
    const formDocs = await hostRef.collection('forms').get()
    const forms = formDocs.docs.map((doc) => ({
      formId: doc.id,
      displayName: doc.get('displayName'),
      legacyMatch: doc.get('legacyMatch'),
    }))
    const claiming = forms.filter((form) => form.legacyMatch?.formName)
    if (!claiming.length) continue

    totals.hosts += 1
    /*
     * Paged by `__name__`, deliberately.
     *
     * `orderBy` on a data field DROPS every document missing it, invisibly.
     * This collection is exactly the one where that bites: the rows worth
     * stamping are the OLDEST, and any field an older generation did not
     * write would silently exclude them from their own migration. The
     * document id is the one path every document has.
     */
    let cursor = null
    const hostPlan = { stamp: [], unmatched: [], alreadyStamped: 0 }
    for (;;) {
      let query = hostRef
        .collection('formSubmissions')
        .orderBy('__name__')
        .limit(PAGE_SIZE)
      if (cursor) query = query.startAfter(cursor)
      const page = await query.get()
      if (page.empty) break
      const plan = planForHost(
        claiming,
        page.docs.map((doc) => ({
          id: doc.id,
          formId: doc.get('formId'),
          formName: doc.get('formName'),
          path: doc.get('path'),
        })),
      )
      hostPlan.stamp.push(...plan.stamp)
      hostPlan.unmatched.push(...plan.unmatched)
      hostPlan.alreadyStamped += plan.alreadyStamped

      if (apply && plan.stamp.length) {
        // One field on one document, batched. No companion state, so an
        // interruption leaves a partially stamped collection — which is the
        // state a re-run finishes.
        const batch = firestore.batch()
        for (const row of plan.stamp) {
          batch.update(hostRef.collection('formSubmissions').doc(row.id), {
            formId: row.formId,
          })
        }
        await batch.commit()
      }
      cursor = page.docs[page.docs.length - 1]
      if (page.size < PAGE_SIZE) break
    }

    const byForm = new Map()
    for (const row of hostPlan.stamp) {
      byForm.set(row.formId, (byForm.get(row.formId) ?? 0) + 1)
    }
    console.log(
      `\nhost ${hostDoc.id}: ${claiming.length} adopted form(s) claiming history`,
    )
    for (const form of claiming) {
      console.log(
        `  ${form.displayName ?? form.formId}: ${byForm.get(form.formId) ?? 0} ` +
          `${apply ? 'stamped' : 'would be stamped'} ` +
          `(claims "${form.legacyMatch.formName}" on ${(form.legacyMatch.paths ?? []).join(', ') || 'no path'})`,
      )
    }
    if (hostPlan.alreadyStamped) {
      console.log(`  ${hostPlan.alreadyStamped} already carried a form id`)
    }
    if (hostPlan.unmatched.length) {
      // The number the Forms page surfaces. Not an error, and not a row that
      // was lost: it is in the Inbox, and a later adoption can claim it.
      console.log(
        `  ⚠️ ${hostPlan.unmatched.length} earlier submission(s) could not be ` +
          'matched to a form — left unstamped, still in the Inbox',
      )
    }
    totals.stamped += hostPlan.stamp.length
    totals.unmatched += hostPlan.unmatched.length
    totals.alreadyStamped += hostPlan.alreadyStamped
  }

  console.log(
    `\n${apply ? 'stamped' : 'would stamp'} ${totals.stamped} submission(s) ` +
      `across ${totals.hosts} site(s); ${totals.unmatched} left unstamped; ` +
      `${totals.alreadyStamped} already had an id`,
  )
  if (!apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/**
 * The matching rule, pinned against the cases that decide whether this is
 * safe to run. No Firestore, no credentials.
 */
function runSelfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual, expected })
  }
  const contact = {
    formId: 'form-contact',
    legacyMatch: { formName: 'Contact', paths: ['/contact'] },
  }
  const support = {
    formId: 'form-support',
    legacyMatch: { formName: 'Contact', paths: ['/support'] },
  }

  check(
    'stamps when caption and path both name one form',
    matchSubmission({ formName: 'Contact', path: '/contact' }, [contact, support]),
    'form-contact',
  )
  check(
    'refuses a lone caption match on a path no form claims',
    matchSubmission({ formName: 'Contact', path: '/retired' }, [contact]),
    null,
  )
  check(
    'refuses when two forms claim the same pair',
    matchSubmission({ formName: 'Contact', path: '/contact' }, [
      contact,
      { formId: 'x', legacyMatch: { formName: 'Contact', paths: ['/contact'] } },
    ]),
    null,
  )
  check(
    'refuses a submission that recorded no path',
    matchSubmission({ formName: 'Contact' }, [contact]),
    null,
  )
  check(
    'files an unnamed form under the caption the route wrote',
    submissionFormName(undefined),
    'Form',
  )
  check(
    'skips a row that already carries an id',
    planForHost([contact], [{ id: 's1', formId: 'form-contact' }]).alreadyStamped,
    1,
  )
  check(
    'is idempotent: a second run plans no writes',
    planForHost(
      [contact],
      [{ id: 's1', formId: 'form-contact', formName: 'Contact', path: '/contact' }],
    ).stamp,
    [],
  )
  check(
    'counts an unmatched row rather than guessing',
    planForHost(
      [contact],
      [{ id: 's1', formName: 'Contact', path: '/retired' }],
    ).unmatched,
    ['s1'],
  )

  // The guards, against texts staged here rather than against the tree, so a
  // guard that stopped guarding is visible.
  const denied = rulesDenyClientFormCreate(
    "match /hosts/{hostId} { match /{subcollection}/{document=**} { allow create: if !(subcollection in ['forms', 'orders']); } }",
  )
  check('reads a real create exclusion list', denied.ok, true)
  const notDenied = rulesDenyClientFormCreate(
    "// forms will be added to the list\nmatch /hosts/{hostId} { match /{subcollection}/{document=**} { allow create: if !(subcollection in ['orders']); } }",
  )
  check('is NOT satisfied by a comment promising the change', notDenied.ok, false)
  const stamps = routeStampsFormId('const x = { formId: form.id }')
  check('sees the route stamping the id', stamps.ok, true)
  const noStamp = routeStampsFormId('// TODO stamp formId: form.id later')
  check('is NOT satisfied by a TODO', noStamp.ok, false)

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  // And the same guards against the ACTUAL tree, so "the guards work" and
  // "this tree may be applied against" are answered separately. Reads files
  // only — no credentials, no Firestore, so it is safe to run anywhere.
  const live = preconditions()
  console.log(
    `\nthis tree: ${live.ok ? 'may be applied against' : 'REFUSED'} — ${live.why}`,
  )
  if (failed) process.exitCode = 1
}

if (selfTest) runSelfTest()
else await run()
