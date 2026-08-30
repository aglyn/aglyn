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
 * BRINGING AN EXISTING LIST IN — the four routes an import is made of.
 *
 * `docs/specs/email-competitive-gaps.md` G5: export works, import does not
 * exist, and every customer arriving from another product has a list and no
 * way to bring it. P4 is the condition attached to closing that: a bulk
 * import is the fastest way to destroy a shared sending domain, so it ships
 * WITH its controls.
 *
 * ## Every imported address goes through the checks a typed one does
 *
 * Not a similar set — the same functions. {@link resolveAddresses} is the
 * resolution `email/list-members-preview` runs, `assignmentBasis` is the
 * policy `email/list-members-add` applies, and `enrollListMember` is the one
 * writer of the membership collection. A second bulk path with its own idea of
 * suppression and its own idea of consent is exactly the defect class this
 * register has a P1 entry for, and that entry is closed.
 *
 * What this module adds is everything ABOVE that gate: reading a file,
 * screening it, holding the operator's attestation, and metering the work out
 * over as many requests as it takes.
 *
 * ## Four routes, because an import is four separate acts
 *
 * - `email/list-import-preview` — reads the file and says what is in it.
 *   Writes nothing, enrolls nobody, and resolves a BOUNDED SAMPLE through the
 *   consent gate so the numbers the operator attests against are real numbers
 *   from real records rather than a promise.
 * - `email/list-import-start` — records the attestation and stages the
 *   addresses. Still enrolls nobody: the act of saying "I have permission for
 *   these people" is separated from the act of adding them so that the
 *   attestation has a moment of its own.
 * - `email/list-import-run` — enrolls up to {@link LIST_IMPORT_RUN_BUDGET}
 *   addresses from the cursor and moves it. Called until it answers
 *   `complete`.
 * - `email/list-import-status` — the unfinished import on a list, if there is
 *   one, so a merchant who closed the tab is not left with a half-added
 *   audience and no way to see it.
 *
 * ## A budget and a cursor, not one request and not one transaction
 *
 * The shape `dynamic-list-materialize.ts` already uses: a per-run bound on
 * work, a cursor recording where the run stopped, and a next run that resumes
 * rather than restarts. A 50,000-address file is not a request that times out
 * halfway with no record of what it did; it is 500 bounded requests over one
 * durable job, and stopping in the middle of it leaves the addresses already
 * enrolled enrolled and the rest staged.
 *
 * The run budget is deliberately {@link LIST_MEMBER_BATCH_MAX} — the same
 * number of addresses one hand-typed add already resolves in one request — so
 * an import run costs exactly what an add costs and no new cost profile is
 * introduced to discover in production.
 *
 * ## ⛔ Nothing here is a capacity limit
 *
 * {@link LIST_IMPORT_MAX_ADDRESSES} refuses a FILE before anything is written.
 * It never trims a staged import, never drops an address to fit, and never
 * removes anybody already on the list. A ceiling in this product is enforced
 * at the reduction, and the reduction here is refusing the upload — which the
 * operator sees, can argue with, and can act on by splitting the file.
 *
 * ## Who the attester is, and why a resumer does not become one
 *
 * The attestation is one person's claim about where a file came from. It is
 * recorded on the job with the account that made it, and every run reads the
 * basis from THAT account, not from whoever pressed Resume. A colleague who
 * finishes somebody else's import has asserted nothing, and the consent
 * records the run writes must not say they did.
 */

import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentBasis,
  createResourceUid,
  importedBasisReason,
  LIST_IMPORT_MAX_ADDRESSES,
  LIST_IMPORT_MAX_CHARACTERS,
  parseListImport,
  readMarketingBasis,
  registerPluginApiRoute,
  screenListImport,
  type AssignmentRefusal,
  type ListImportRow,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { enrollListMember } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
/*
 * The gate module directly, never `server-console.ts`'s re-export of it.
 *
 * That file imports THIS one to register these routes, so reaching its
 * re-export would close a cycle — and the constant below is evaluated at
 * module load, which is precisely where a cycle stops being harmless: the
 * binding is still in its temporal dead zone when the loader arrives.
 */
import {
  LIST_MEMBER_BATCH_MAX,
  resolveAddresses,
  resolveListContext,
  type ListContext,
} from './server-list-gate'

/** `source` stamped on every membership an import writes. */
export const CONSOLE_IMPORT_SOURCE = 'console:list-import'

/** Where a list's import jobs live: `orgs/{orgId}/lists/{listId}/imports`. */
export const LIST_IMPORTS_SUBCOLLECTION = 'imports'

/**
 * Addresses one run enrolls before answering and handing back the cursor.
 *
 * The same number as {@link LIST_MEMBER_BATCH_MAX} on purpose — see the module
 * note. It is a bound on WORK: it can never refuse a person, and the addresses
 * it does not reach in this run are reached by the next one.
 */
export const LIST_IMPORT_RUN_BUDGET = LIST_MEMBER_BATCH_MAX

/**
 * Staged addresses per chunk document.
 *
 * Comfortably inside Firestore's one-megabyte document limit at the widths a
 * contact file actually carries, and a multiple of the run budget so a run
 * reads exactly one chunk. Reading two would be the common case at any size
 * that is not a multiple, which is a round trip paid on every run to save
 * nothing.
 */
export const LIST_IMPORT_CHUNK_SIZE = 500

/** Unusable lines kept verbatim on the job, so the result names some of them. */
const UNUSABLE_SAMPLE_MAX = 25

/** Role accounts kept verbatim on the job, for the same reason. */
const ROLE_ACCOUNT_SAMPLE_MAX = 25

/** One staged row, in the short field names a 50,000-row staging area wants. */
interface StagedRow {
  /** The normalized address. */
  e: string
  /** A display name from the file, when it carried one. */
  n?: string
  /** The opt-in source the file declared. */
  s?: string
  /** The opt-in date the file declared, as written. */
  d?: string
}

/** What the merchant is told about the file, before they attest to it. */
interface ImportScreeningReport {
  /** How many addresses are at a shared or unattended mailbox. */
  roleAccounts: number
  /** A bounded sample of them, so the warning names names. */
  roleAccountSamples: string[]
  /** Column names that read as purchase or append tells. */
  purchaseTellColumns: string[]
  /** Whether the file declares an opt-in source or date per row. */
  declaresBasis: boolean
}

/** Reads the request's file text, or the refusal to send back. */
function readImportText(
  req: Parameters<PluginApiHandler>[0],
): { text: string } | { error: string } {
  const text = String(req.body?.text ?? '')
  if (!text.trim()) return { error: 'The file is empty.' }
  if (text.length > LIST_IMPORT_MAX_CHARACTERS) {
    return {
      error:
        'That file is too large to read in one go. Split it and import the ' +
        'pieces — nothing is added until you do, and nothing already on the ' +
        'list is affected.',
    }
  }
  return { text }
}

/**
 * The screening report for a parsed file.
 *
 * Counts plus a bounded sample rather than every offending address. The point
 * of the warning is that the operator SEES the shape of what they are about to
 * attest to; a list of four thousand role accounts is a scroll, not a warning,
 * and it would put four thousand addresses into a document whose reason for
 * existing is bookkeeping.
 */
function screeningReport(parsed: {
  columns: string[]
  rows: ListImportRow[]
}): ImportScreeningReport {
  const screening = screenListImport(parsed)
  return {
    roleAccounts: screening.roleAccounts.length,
    roleAccountSamples: screening.roleAccounts.slice(0, ROLE_ACCOUNT_SAMPLE_MAX),
    purchaseTellColumns: screening.purchaseTellColumns,
    declaresBasis: screening.declaresBasis,
  }
}

/**
 * `POST email/list-import-preview` — what is in this file.
 *
 * Reads only. It answers three separate questions and keeps them separate,
 * because collapsing them is how an import gets attested to on a number that
 * is not the number:
 *
 *  - what the FILE contains: usable addresses, unusable lines, duplicates
 *    collapsed, and the columns it carries;
 *  - what the SCREENING found, which decides nothing and is shown anyway;
 *  - what the CONSENT GATE says about a bounded sample of the addresses.
 *
 * The sample is the honest shape rather than a shortcut. Resolving fifty
 * thousand addresses against the contacts collection and both suppression
 * lists is the same scan the import itself performs, so a preview that did it
 * would be the import minus the writes — twice the cost, and a request that
 * times out on exactly the files this feature exists for. So the sample size
 * is reported beside the total and the run reports the real figures as they
 * become true, which is the same distinction `email/list-rule-preview` draws
 * between `matched` and the batch it hands back.
 */
export const emailListImportPreviewHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const file = readImportText(req)
  if ('error' in file) return res.status(400).json({ error: file.error })
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const parsed = parseListImport(file.text)
    const sample = parsed.rows
      .map((row) => row.email)
      .filter((email): email is string => !!email)
      .slice(0, LIST_MEMBER_BATCH_MAX)
    const resolution = await resolveAddresses({
      hostId: context.hostId,
      inputs: sample,
    })
    return res.status(200).json({
      listName: context.listName,
      columns: parsed.columns,
      usable: parsed.usable,
      unusable: parsed.unusable,
      duplicates: parsed.duplicates,
      overCeiling: parsed.overCeiling,
      ceiling: LIST_IMPORT_MAX_ADDRESSES,
      unusableSamples: parsed.rows
        .filter((row) => !row.email)
        .slice(0, UNUSABLE_SAMPLE_MAX)
        .map((row) => row.input),
      screening: screeningReport(parsed),
      /*
       * The sample's verdicts, in the shape the panel's consent readout
       * already draws, and its SIZE beside them. A count with no denominator
       * next to it is the thing an operator misreads as the whole file.
       */
      sampleSize: sample.length,
      verdicts: resolution.verdicts,
      optedIn: resolution.optedIn,
      needAttestation: resolution.needAttestation,
      refused: resolution.refused,
    })
  } catch (error) {
    console.error('[email] list import preview failed', error)
    return res.status(500).json({ error: 'The file could not be read.' })
  }
}

/**
 * `POST email/list-import-start` — record the attestation, stage the file.
 *
 * Body: `{ hostId, listId, text, attestConsent }`. Enrolls nobody. It writes
 * the job document that every subsequent run reads, and the chunks holding
 * the addresses, and then stops — so the moment the operator makes their
 * claim is a moment of its own, with a record of who made it and when, rather
 * than a flag riding along on the request that also did the work.
 *
 * `attestConsent` is the operator STATING they have these people's
 * permission. It is not a way to name a basis: the basis is derived per
 * address at run time from that person's own record, exactly as the
 * one-address add path derives it, and this flag can only ever produce the
 * attributable kind.
 */
export const emailListImportStartHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const file = readImportText(req)
  if ('error' in file) return res.status(400).json({ error: file.error })
  const attested = req.body?.attestConsent === true
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const parsed = parseListImport(file.text)
    const staged: StagedRow[] = parsed.rows
      .filter((row) => !!row.email)
      .map((row) => ({
        e: row.email as string,
        ...(row.name ? { n: row.name } : {}),
        ...(row.declaredSource ? { s: row.declaredSource } : {}),
        ...(row.declaredAt ? { d: row.declaredAt } : {}),
      }))
    if (!staged.length) {
      return res.status(400).json({
        error:
          'No usable email addresses were found in that file. Check that it ' +
          'has an address column, or paste one address per line.',
      })
    }

    const importId = createResourceUid()
    const importRef = context.listRef
      .collection(LIST_IMPORTS_SUBCOLLECTION)
      .doc(importId)
    const chunks = importRef.collection('chunks')
    /*
     * The staging area first, the job document last.
     *
     * A job whose chunks are not all written yet is a job a run would read
     * past the end of, and the run is driven by a client that starts
     * immediately. Writing the job last means the only state anybody can
     * observe is a complete one.
     *
     * One document per chunk and not one batch over all of them: a batch is
     * capped at 500 writes and, more to the point, is a transaction — the
     * whole reason this is a staged job rather than one request is that a
     * fifty-thousand-address import must not be a single atomic thing that
     * either lands or does not.
     */
    for (let at = 0; at < staged.length; at += LIST_IMPORT_CHUNK_SIZE) {
      await chunks.doc(String(at / LIST_IMPORT_CHUNK_SIZE)).set({
        rows: staged.slice(at, at + LIST_IMPORT_CHUNK_SIZE),
      })
    }

    await importRef.set({
      listName: context.listName,
      status: 'running',
      total: staged.length,
      cursor: 0,
      enrolled: 0,
      refused: 0,
      refusals: {},
      unusable: parsed.unusable,
      duplicates: parsed.duplicates,
      overCeiling: parsed.overCeiling,
      unusableSamples: parsed.rows
        .filter((row) => !row.email)
        .slice(0, UNUSABLE_SAMPLE_MAX)
        .map((row) => row.input),
      columns: parsed.columns,
      screening: screeningReport(parsed),
      /*
       * WHO attested, stored beside WHETHER. A flag on its own is an
       * unattributed claim, which is the one thing `list-assignment-policy`
       * refuses to let an attestation be — and every run reads the account
       * from here rather than from the session that triggered it.
       */
      attested,
      attestedByUid: attested ? context.uid : null,
      attestedAtMs: attested ? Date.now() : null,
      startedByUid: context.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return res.status(200).json({
      importId,
      listName: context.listName,
      total: staged.length,
      attested,
      runBudget: LIST_IMPORT_RUN_BUDGET,
    })
  } catch (error) {
    console.error('[email] list import start failed', error)
    return res.status(500).json({ error: 'The import could not be started.' })
  }
}

/** The staged addresses a run will work on, from the cursor. */
async function readStaged(
  importRef: FirebaseFirestore.DocumentReference,
  cursor: number,
  total: number,
): Promise<StagedRow[]> {
  const take = Math.min(LIST_IMPORT_RUN_BUDGET, Math.max(total - cursor, 0))
  if (take <= 0) return []
  const rows: StagedRow[] = []
  let at = cursor
  /*
   * A loop rather than one read.
   *
   * `LIST_IMPORT_CHUNK_SIZE` is a multiple of `LIST_IMPORT_RUN_BUDGET`, so as
   * those two constants stand a run reads exactly one chunk and this turns
   * once. That relationship is a PERFORMANCE choice — one round trip per run
   * — and the loop is what keeps it from also being a correctness
   * requirement: change either number to something that does not divide, or
   * resume a job whose cursor came from an older budget, and a run's batch
   * straddles a boundary. Reading one chunk and truncating would silently
   * import a short batch and advance the cursor past the rest.
   */
  while (rows.length < take) {
    const index = Math.floor(at / LIST_IMPORT_CHUNK_SIZE)
    const snapshot = await importRef
      .collection('chunks')
      .doc(String(index))
      .get()
    const stored = (snapshot.exists ? snapshot.get('rows') : null) as
      | StagedRow[]
      | null
    if (!Array.isArray(stored) || !stored.length) break
    const offset = at - index * LIST_IMPORT_CHUNK_SIZE
    const slice = stored.slice(offset, offset + (take - rows.length))
    if (!slice.length) break
    rows.push(...slice)
    at += slice.length
  }
  return rows
}

/**
 * `POST email/list-import-run` — enroll the next batch.
 *
 * Body: `{ hostId, listId, importId }`. Answers `complete` when the cursor
 * has reached the total, so the caller's loop is "call until complete" and
 * nothing has to guess how many runs a file needs.
 *
 * ## The cursor moves for every address, enrolled or refused
 *
 * A refusal is a finished address. Advancing only on success would put a
 * suppressed address at the head of the queue forever and turn the import
 * into a loop that never terminates on exactly the files that most need to
 * terminate.
 *
 * ## The counters are incremented, not recomputed
 *
 * `FieldValue.increment` rather than a read-modify-write, so two runs racing
 * on one job — a merchant with the drawer open in two tabs — cannot lose a
 * batch's worth of tally. The cursor is written as an absolute value because
 * it is the position the NEXT run reads from, and two racing runs that both
 * incremented it would skip a batch rather than repeat one; repeating is safe
 * (`enrollListMember` is keyed by the person), skipping is not.
 */
export const emailListImportRunHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const importId = String(req.body?.importId ?? '').trim()
  if (!importId) return res.status(400).json({ error: 'Missing importId' })
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const importRef = context.listRef
      .collection(LIST_IMPORTS_SUBCOLLECTION)
      .doc(importId)
    const job = await importRef.get()
    if (!job.exists) {
      return res.status(404).json({ error: 'Unknown import' })
    }
    const total = Number(job.get('total') ?? 0)
    const cursor = Number(job.get('cursor') ?? 0)
    if (cursor >= total) {
      return res.status(200).json(finishedPayload(job, context))
    }

    const staged = await readStaged(importRef, cursor, total)
    if (!staged.length) {
      /*
       * The staging area is short of what the job claims. Recorded as
       * complete rather than retried forever: the addresses that were
       * enrolled stay enrolled, and a job that cannot be finished is more
       * useful marked finished with its real numbers than left as a
       * permanently unfinished import a merchant is told to resume.
       */
      await importRef.set(
        { status: 'complete', cursor: total, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
      return res.status(200).json({
        ...finishedPayload(job, context),
        complete: true,
        cursor: total,
      })
    }

    const attested = job.get('attested') === true
    /*
     * The ATTESTER's account, not the caller's. See the module note: a
     * colleague who resumes somebody else's import has asserted nothing, and
     * a consent record naming them would be a claim nobody made.
     */
    const attestingUid = String(job.get('attestedByUid') ?? '')
    const nowMs = Date.now()

    const resolution = await resolveAddresses({
      hostId: context.hostId,
      inputs: staged.map((row) => row.e),
    })
    const byEmail = new Map(staged.map((row) => [row.e, row]))

    let enrolled = 0
    const refusals: Record<string, number> = {}
    const results: Array<{
      email: string | null
      enrolled: boolean
      reason?: AssignmentRefusal
      error?: string
    }> = []
    const refuse = (email: string | null, reason: AssignmentRefusal) => {
      refusals[reason] = (refusals[reason] ?? 0) + 1
      results.push({
        email,
        enrolled: false,
        reason,
        error: ASSIGNMENT_REFUSAL_MESSAGES[reason],
      })
    }

    for (const verdict of resolution.verdicts) {
      if (verdict.refusal || !verdict.email) {
        refuse(verdict.email, verdict.refusal ?? 'unroutable-address')
        continue
      }
      const decision = assignmentBasis({
        stored: resolution.stored.get(verdict.email) ?? readMarketingBasis(null),
        attested,
        actingUid: attestingUid,
        nowMs,
      })
      if ('refusal' in decision) {
        refuse(verdict.email, decision.refusal)
        continue
      }
      const row = byEmail.get(verdict.email)
      const enrollment = await enrollListMember({
        listRef: context.listRef,
        email: verdict.email,
        ...(row?.n ? { name: row.n } : {}),
        source: CONSOLE_IMPORT_SOURCE,
        // Never `'rule'`: the dynamic-list materializer reconciles its own
        // rows away when somebody stops matching, and a file a merchant
        // uploaded is not a rule match that can lapse.
        via: 'manual',
        consent: {
          ...decision,
          /*
           * The file's own declaration, carried onto the row it was made
           * about — but only for the basis it is evidence FOR. A
           * pass-through carries the person's own opt-in, and attaching a
           * spreadsheet column's claim to that would be dressing the
           * person's act in the merchant's words.
           */
          ...(decision.basis === 'operator-attested' && row
            ? {
                reason: importedBasisReason({
                  declaredSource: row.s ?? '',
                  declaredAt: row.d ?? '',
                }),
              }
            : {}),
        },
      })
      if (enrollment.enrolled === false) {
        refuse(
          verdict.email,
          enrollment.refusal === 'declined' ? 'declined' : 'unroutable-address',
        )
        continue
      }
      enrolled += 1
      results.push({ email: verdict.email, enrolled: true })
    }

    const nextCursor = cursor + staged.length
    const complete = nextCursor >= total
    await importRef.set(
      {
        cursor: nextCursor,
        status: complete ? 'complete' : 'running',
        enrolled: FieldValue.increment(enrolled),
        refused: FieldValue.increment(staged.length - enrolled),
        /*
         * A NESTED map, not dotted keys. `set({merge:true})` reads its keys
         * as literal field names — only `update()` expands a dot into a field
         * path — so `refusals.declined` here would create a top-level field
         * with a dot in its name and leave the map it was meant to update
         * empty. A deep merge over a nested map does what is wanted and
         * honors the increments inside it.
         */
        refusals: Object.fromEntries(
          Object.entries(refusals).map(([reason, count]) => [
            reason,
            FieldValue.increment(count),
          ]),
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    return res.status(200).json({
      importId,
      listName: context.listName,
      complete,
      total,
      cursor: nextCursor,
      /*
       * This RUN's numbers, named as this run's. The job's running totals are
       * read back by `email/list-import-status`; reporting an increment as a
       * total is how a progress readout comes to disagree with the record.
       */
      ranEnrolled: enrolled,
      ranRefused: staged.length - enrolled,
      refusals,
      results,
    })
  } catch (error) {
    console.error('[email] list import run failed', error)
    return res.status(500).json({ error: 'The import could not continue.' })
  }
}

/** The payload for a job that has nothing left to do. */
function finishedPayload(
  job: FirebaseFirestore.DocumentSnapshot,
  context: Extract<ListContext, { ok: true }>,
): Record<string, unknown> {
  return {
    importId: job.id,
    listName: context.listName,
    complete: true,
    total: Number(job.get('total') ?? 0),
    cursor: Number(job.get('cursor') ?? 0),
    ranEnrolled: 0,
    ranRefused: 0,
    refusals: {},
    results: [],
  }
}

/**
 * `POST email/list-import-status` — the import on this list, if there is one.
 *
 * Reached when the import drawer opens, and at no other time. It exists
 * because a browser is not a durable thing: a merchant who closed the tab
 * during a large import has an audience that is part-way filled and, without
 * this, no way to see that or to finish it. What they must never be offered
 * instead is a fresh import of the same file, which would re-run the whole
 * gate over addresses already enrolled.
 *
 * Ordered on `createdAt`, which every job document written by
 * `email/list-import-start` carries — a `limit()` with no `orderBy` answers in
 * document-id order, and the ids come from `createResourceUid()`, so the
 * "latest" import would be an arbitrary one.
 */
export const emailListImportStatusHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const snapshot = await context.listRef
      .collection(LIST_IMPORTS_SUBCOLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    const job = snapshot.docs[0]
    if (!job) return res.status(200).json({ listName: context.listName, job: null })
    return res.status(200).json({
      listName: context.listName,
      job: {
        importId: job.id,
        status: String(job.get('status') ?? 'running'),
        total: Number(job.get('total') ?? 0),
        cursor: Number(job.get('cursor') ?? 0),
        enrolled: Number(job.get('enrolled') ?? 0),
        refused: Number(job.get('refused') ?? 0),
        refusals: (job.get('refusals') ?? {}) as Record<string, number>,
        attested: job.get('attested') === true,
        unusable: Number(job.get('unusable') ?? 0),
        duplicates: Number(job.get('duplicates') ?? 0),
        unusableSamples: (job.get('unusableSamples') ?? []) as string[],
        screening: (job.get('screening') ?? null) as ImportScreeningReport | null,
      },
    })
  } catch (error) {
    console.error('[email] list import status failed', error)
    return res
      .status(500)
      .json({ error: 'The import could not be looked up.' })
  }
}

/**
 * Import route registration.
 *
 * Reached by a person pressing a button in a browser, like the rest of the
 * console half, so none of these is on the machine-path exemption list in
 * `plugin-api-rate-limit.ts` — with one consequence worth stating: the RUN
 * route is called repeatedly by design, once per {@link
 * LIST_IMPORT_RUN_BUDGET} addresses, so the visitor limiter's per-(site, IP)
 * budget is the ceiling on how fast a large import can proceed. That is the
 * correct ceiling for a path that enrolls people into a marketing audience,
 * and it degrades into a slower import rather than a failed one.
 */
export function registerEmailListImportApi(): void {
  registerPluginApiRoute(
    'email/list-import-preview',
    emailListImportPreviewHandler,
  )
  registerPluginApiRoute('email/list-import-start', emailListImportStartHandler)
  registerPluginApiRoute('email/list-import-run', emailListImportRunHandler)
  registerPluginApiRoute(
    'email/list-import-status',
    emailListImportStatusHandler,
  )
}
