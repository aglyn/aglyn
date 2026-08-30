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
 * Putting somebody on an email list from the Emails console.
 *
 * The audience card could create a list and delete a list and nothing else:
 * no way to see who was on one, no way to add anybody, no way to take anybody
 * off. Every member document in production arrived from a capture surface —
 * the newsletter handler, the workflow `enrollList` step, the dynamic-list
 * materializer, the Inbox assignment — so the one act a merchant most expects
 * of a list, "add this person", was the one act the product refused.
 *
 * ## Why this is a route and not a client write
 *
 * Rules put `orgs/{orgId}/lists/{listId}/members` behind org-wide membership,
 * and until now that block allowed a client CREATE. Nothing used it, and it
 * was the whole feature waiting to be built wrong: a browser that can write a
 * member document can write `marketingConsent: true` beside an address it has
 * never checked, which is a consent record minted by pressing a button. The
 * rules now deny client create and update on that collection, and this route
 * is the writer — through `enrollListMember`, which owns the document id, and
 * through the shared `list-assignment-policy`, which owns the basis.
 *
 * ## The same policy the Inbox uses, not a second one
 *
 * `assignmentBasis` and `assignmentReadout` are imported from the framework,
 * where they moved when this became their second caller. There is no third
 * consent basis and no console-only override: a stored `declined` refuses
 * here exactly as it refuses there, an attestation is recorded with the
 * account that made it, and a stored opt-in is carried across with the date
 * the PERSON set rather than the date somebody pressed Add.
 *
 * ## Reads only, until the operator has seen the count
 *
 * `email/list-members-preview` writes nothing. It answers, per address, what
 * would happen and why, so the attestation the operator gives on the second
 * call is given with the numbers in front of them. Both routes run the SAME
 * resolution over the SAME inputs — `resolveAddresses` — so the summary they
 * were shown is the summary that acts.
 *
 * ## Finding people is a read, and it uses the same gate
 *
 * `email/list-rule-preview` answers "who do these filters select" without
 * writing anything, so a fixed list can be filled from a search rather than
 * from somebody typing addresses one at a time. It runs the addresses it finds
 * through `resolveAddresses` as well — a bulk path that reached the membership
 * without the suppression check and the attestation would be a way to enroll
 * exactly the people the single-address path refuses.
 *
 * ## The gate itself is `server-list-gate.ts`
 *
 * Who may change a list's membership, and what is true about each address, are
 * asked by three route modules now: these two, and the file importer in
 * `server-list-import.ts`. They live in a module of their own so the importer
 * shares this file's answer rather than importing this file — which would be a
 * cycle, and a cycle whose module-level constants would evaluate in whichever
 * order the loader happened to reach them.
 */

import { registerEmailSuppressionsApi } from './server-suppressions'
import { registerEmailListImportApi } from './server-list-import'
import {
  LIST_MEMBER_BATCH_MAX,
  readAddresses,
  resolveAddresses,
  resolveListContext,
} from './server-list-gate'
import {
  ASSIGNMENT_REFUSAL_MESSAGES,
  assignmentBasis,
  dynamicListRuleIsEmpty,
  normalizeDynamicListRule,
  readMarketingBasis,
  registerPluginApiRoute,
  type AssignmentRefusal,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import {
  collectDynamicListCandidates,
  enrollListMember,
} from '@aglyn/tenant-data-admin'

/** `source` stamped on every membership these routes write. */
export const CONSOLE_ADD_SOURCE = 'console:list-add'

/*
 * Re-exported, not redefined. `@aglyn/plugins-email/server` has published
 * these names since the add path shipped, and the console panel and its specs
 * import them from there; moving the gate must not move the plugin's public
 * surface with it.
 */
export {
  LIST_MEMBER_BATCH_MAX,
  resolveAddresses,
  resolveListContext,
  type AddressResolution,
  type AddressVerdict,
  type ListContext,
  type ResolvedBatch,
} from './server-list-gate'


/**
 * `POST email/list-members-preview` — what adding these addresses would do.
 *
 * Reads only, and reached by an explicit act — typing an address or pasting a
 * column — never on mount. It exists because the answer needs three things
 * the browser cannot have: the org's contacts (rules put them behind org-wide
 * membership, which the acting console session may not hold) and both
 * suppression lists. Computing any of it client-side would be a second copy
 * of the rule, on the surface whose whole job is to tell the operator the
 * truth about what is about to happen.
 *
 * It takes no attestation and has nowhere to put one. The preview answers
 * what is TRUE about each person, which is the input to the operator's
 * decision rather than a function of it — a preview whose numbers moved as
 * the box was ticked would not be a count anybody could stand behind.
 */
export const emailListMembersPreviewHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const requested = readAddresses(req)
  if ('error' in requested) {
    return res.status(400).json({ error: requested.error })
  }
  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const { verdicts, optedIn, needAttestation, refused } =
      await resolveAddresses({
        hostId: context.hostId,
        inputs: requested.emails,
      })
    /*
     * Named fields rather than a spread of the resolution.
     *
     * The resolution carries the consent RECORDS it was computed from, for the
     * write path's use — raw stored basis, provenance, the account behind an
     * operator assertion. None of that is the browser's, and a spread would
     * put all of it on the wire the moment a field was added to the internal
     * shape. What the surface needs is the verdicts and the counts.
     */
    return res.status(200).json({
      listName: context.listName,
      verdicts,
      optedIn,
      needAttestation,
      refused,
    })
  } catch (error) {
    console.error('[email] list member preview failed', error)
    return res.status(500).json({ error: 'The addresses could not be checked.' })
  }
}

/**
 * `POST email/list-members-add` — put these addresses on the list.
 *
 * Body: `{ hostId, listId, email | emails[], name?, attestConsent? }`.
 * `attestConsent` is the operator STATING that they have these people's
 * permission; it is not a way to name a basis, because the pass-through basis
 * is derived server-side from each person's own record.
 *
 * ## One attestation, for the count the operator was shown
 *
 * The batch carries a single assertion because it is a single act: an
 * operator pasting a column is making one claim about where that column came
 * from. What makes that safe is that the claim is applied per address by the
 * same function the preview ran, so it reaches only the addresses that
 * actually need it — an address with a stored opt-in keeps its own basis and
 * its own date, and an address nothing can enroll is refused with the
 * attestation on the table.
 *
 * ## Partial success is the honest answer
 *
 * A batch where one address is suppressed and forty are fine is not a failed
 * request. Every address comes back with what happened to it, so 200 here
 * means "the request was processed", never "everybody was added" — the caller
 * reads the per-address verdicts, which is why they are returned rather than
 * a count.
 */
export const emailListMembersAddHandler: PluginApiHandler = async (
  req,
  res,
) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const requested = readAddresses(req)
  if ('error' in requested) {
    return res.status(400).json({ error: requested.error })
  }
  const attested = req.body?.attestConsent === true
  const name = String(req.body?.name ?? '').trim()

  try {
    const context = await resolveListContext(req)
    if (context.ok === false) {
      return res.status(context.status).json(context.body)
    }
    const nowMs = Date.now()
    const resolution = await resolveAddresses({
      hostId: context.hostId,
      inputs: requested.emails,
    })

    const results = []
    for (const verdict of resolution.verdicts) {
      if (verdict.refusal || !verdict.email) {
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason: verdict.refusal,
          error: verdict.summary,
        })
        continue
      }
      /*
       * The ONE place a basis is decided, and the only place the attestation
       * is consulted.
       *
       * `resolveAddresses` has already answered the questions that are facts
       * about the person; this answers the question that is about the
       * operator, per address, from the consent record that resolution read.
       * `no-basis` — an address with nothing on record and nobody asserting
       * anything — is refused HERE and only here.
       */
      const decision = assignmentBasis({
        stored: resolution.stored.get(verdict.email) ?? readMarketingBasis(null),
        attested,
        actingUid: context.uid,
        nowMs,
      })
      if ('refusal' in decision) {
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason: decision.refusal,
          error: ASSIGNMENT_REFUSAL_MESSAGES[decision.refusal],
        })
        continue
      }
      const enrollment = await enrollListMember({
        listRef: context.listRef,
        email: verdict.email,
        ...(name && requested.emails.length === 1 ? { name } : {}),
        source: CONSOLE_ADD_SOURCE,
        // Never `'rule'`: the dynamic-list materializer reconciles its own
        // rows away when a person stops matching, and a decision somebody
        // made by hand is not a rule match that lapsed.
        via: 'manual',
        consent: decision,
      })
      if (enrollment.enrolled === false) {
        /*
         * The membership itself records a refusal the CRM record did not.
         * `enrollListMember` is the only writer of the collection and holds
         * the row, so it is the backstop for every enrollment route; reaching
         * it here means the two records disagree, and the refusal wins.
         */
        const reason: AssignmentRefusal =
          enrollment.refusal === 'declined' ? 'declined' : 'unroutable-address'
        results.push({
          input: verdict.input,
          email: verdict.email,
          enrolled: false,
          reason,
          error: ASSIGNMENT_REFUSAL_MESSAGES[reason],
        })
        continue
      }
      results.push({
        input: verdict.input,
        email: verdict.email,
        enrolled: true,
        memberId: enrollment.memberId,
        created: enrollment.created,
        basis: decision.basis,
      })
    }

    return res.status(200).json({
      listName: context.listName,
      added: results.filter((result) => result.enrolled).length,
      results,
    })
  } catch (error) {
    console.error('[email] list member add failed', error)
    return res.status(500).json({ error: 'The addresses could not be added.' })
  }
}

/**
 * WHO A SET OF FILTERS FINDS, and what would happen if you added them.
 *
 * ## The gap it fills
 *
 * The filters behind a list could only ever be MATERIALIZED — the sweep wrote
 * the matching people straight into the membership. A merchant could not ask
 * "who is this" without committing to it, and a fixed list could not use the
 * filters at all: its only way to gain a member was somebody typing or pasting
 * an address. This answers the question without writing anything.
 *
 * ## It is the same consent gate, not a second one
 *
 * The addresses the scan finds are put through {@link resolveAddresses} — the
 * exact function `email/list-members-preview` uses — so a suppressed address
 * is reported as refused here, and somebody with no opt-in on record is
 * reported as needing an attestation here, before any of them is offered for
 * adding. That is deliberate and load-bearing: a bulk path that skipped the
 * check would be a way to fill a list with people the one-at-a-time path
 * refuses, which is the defect class this product already has a register entry
 * for. The ADD still goes through `email/list-members-add`, which re-runs
 * every check server-side, so this preview is an honest readout rather than a
 * permission.
 *
 * ## What it will not do
 *
 * It writes nothing, it enrolls nobody, and it compares no count against any
 * limit. The batch cap below bounds how many addresses it hands back for a
 * single add — the scan itself still reports how many people it MATCHED, so a
 * merchant is told the audience is larger than one batch rather than shown a
 * truncated number as if it were the whole.
 */
export const emailListRulePreviewHandler: PluginApiHandler = async (
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
    const rule = normalizeDynamicListRule(req.body?.rule)
    if (dynamicListRuleIsEmpty(rule)) {
      /*
       * Not an error, and not an empty result either. A rule with no source
       * matches nobody by construction, and reporting that as "0 people" is
       * indistinguishable from a rule that ran and found none — which is the
       * confusion the `empty` flag exists to prevent everywhere else.
       */
      return res.status(200).json({
        matched: 0,
        truncated: false,
        complete: true,
        empty: true,
        emails: [],
        verdicts: [],
        optedIn: 0,
        needAttestation: 0,
        refused: 0,
      })
    }
    const scan = await collectDynamicListCandidates({
      hostId: context.hostId,
      rule,
    })
    /*
     * The addresses, in the scan's own order, capped at what one add can
     * carry. `matched` is reported separately and is NOT this length: a
     * merchant looking at a 400-person audience must be told it is 400 even
     * when the button in front of them adds 100.
     */
    const emails = scan.candidates
      .map((candidate) => candidate.email)
      .filter(Boolean)
    const batch = emails.slice(0, LIST_MEMBER_BATCH_MAX)
    const resolution = await resolveAddresses({
      hostId: context.hostId,
      inputs: batch,
    })
    return res.status(200).json({
      listName: context.listName,
      matched: emails.length,
      /*
       * Two different reasons a readout can be short of the truth, reported
       * apart: `truncated` is this batch being smaller than the match, and
       * `complete: false` is the SCAN having run out of budget, so `matched`
       * is itself a floor.
       */
      truncated: emails.length > batch.length,
      complete: scan.complete,
      empty: false,
      emails: batch,
      verdicts: resolution.verdicts,
      optedIn: resolution.optedIn,
      needAttestation: resolution.needAttestation,
      refused: resolution.refused,
    })
  } catch (error) {
    console.error('[email] list rule preview failed', error)
    return res
      .status(500)
      .json({ error: 'The audience could not be worked out.' })
  }
}

/**
 * Console API registration.
 *
 * None of these is on the machine-path exemption list in
 * `plugin-api-rate-limit.ts`. Each is reached by a person pressing a button in
 * a browser, so the visitor limiter's per-(site, IP) budget is far above any
 * real use of them and is the right ceiling for a surface that puts a person
 * into a marketing audience.
 */
export function registerEmailConsoleApi(): void {
  registerPluginApiRoute('email/list-rule-preview', emailListRulePreviewHandler)
  registerPluginApiRoute(
    'email/list-members-preview',
    emailListMembersPreviewHandler,
  )
  registerPluginApiRoute('email/list-members-add', emailListMembersAddHandler)
  // The importer is four routes over one staged job, so it has its own
  // module — but not its own gate: it reaches this file's `resolveListContext`
  // and `resolveAddresses` rather than a bulk-shaped copy of them, which is
  // the whole reason an import cannot enroll somebody the add path refuses.
  registerEmailListImportApi()
  // Suppressions live in their own module: they are a per-SITE list gated on
  // the site role, where list membership is an ORG audience gated on org-wide
  // access, and one file holding both gates is one file for the wrong one to
  // be copied out of.
  registerEmailSuppressionsApi()
}
