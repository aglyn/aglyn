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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import type { ComposedOutreachEmail } from '../engine/compose'
import { hasOutreachValidationErrors, validateOutreachSteps } from '../engine/sequence-validation'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import { outreachLocalDay } from '../mailboxes/mailbox-settings'
import {
  markOutreachMailboxReconnectRequired,
  type OpenedOutreachMailbox,
} from '../mailboxes/mailbox-transport'
import type { OutreachStepTestResponse } from '../model/outreach-api'
import { OUTREACH_COLLECTIONS, type OutreachMailbox } from '../model/outreach.types'
import { previewOutreachStep } from '../model/step-preview'
import {
  newOutreachLinkId,
  OUTREACH_TEST_LINK_ENROLLMENT,
  outreachStoredLink,
  type OutreachStoredLink,
} from '../runtime/click-link'
import { readStoredOutreachMailbox } from '../storage/outreach-records'
import { GmailTransportError } from '../transport/gmail-errors'
import { Rfc5322MessageError } from '../transport/rfc5322'
import { sendComposedOutreachEmail } from '../transport/send-message'
import { readOutreachStepRender } from './preview-routes'
import type { OutreachRouteDeps } from './route-deps'
import { outreachMethodNotAllowed, outreachOk, outreachRefusal, readOutreachJsonBody } from './route-http'

/**
 * A TEST OF ONE STEP, IN A REAL INBOX (AGL-3325): `outreach/steps/test`.
 *
 * The Mailboxes page's test proves a mailbox can send; this proves what a
 * step LOOKS like once it has been through Gmail. It is the preview's email
 * — the same reader, the same person or sample person, the same personal
 * line, the same footer — sent through the sequence's mailbox to the member
 * who asked, or to an address they typed, with `[Test] ` in front of the
 * subject so it never reads as real mail.
 *
 * ## Rendered as a send, sent as a test
 *
 * A later step in a thread is written as `Re:` the thread's subject, as the
 * preview writes it, but sent as a new message: there is no thread to
 * answer, and the preview's placeholder message id must not leave the
 * server. When the sequence counts clicks, every link is rewritten to a
 * short link as a real send's would be, so the member sees the link their
 * recipients will see — but each is stored as a TEST link, which the click
 * route follows and never records (`click-link.ts`). A member clicking their
 * own test must not move the sequence's `clicks` or `machineClicks`.
 *
 * Merge fields the person has nothing for are sent empty and named in the
 * answer, where a real send would pause: the point of a test is to see the
 * gap, not to be refused it.
 *
 * ## Counted on nothing but the mailbox's tests
 *
 * A test is a real Gmail send and spends the account's own limits. It is
 * not a person emailed: it moves neither the sequence's `stats` nor the
 * mailbox's `health.daily.<day>.sent`, it reserves nothing of the daily cap,
 * it files nothing on anyone's record, and it enrolls nobody. It is tallied
 * on `health.daily.<day>.tests`, which the Mailboxes card shows as "Tests
 * today", and held to {@link OUTREACH_STEP_TESTS_PER_HOUR} a mailbox.
 *
 * ## Who, and from what
 *
 * The mailbox's own member, or an organization owner or admin — the people
 * who may edit and activate the sequence. A paused mailbox, or one waiting
 * to be reconnected, refuses and says which; a member who cannot send is
 * told where to fix it rather than shown a Google error.
 */

/** Tests one mailbox may send in an hour: a few steps for a few people. */
export const OUTREACH_STEP_TESTS_PER_HOUR = 20

/** What every test's subject starts with. */
export const OUTREACH_TEST_SUBJECT_PREFIX = '[Test] '

/** The route's reach beyond the shared route deps: the mailbox's Gmail, the limit, the links. */
export interface OutreachStepTestDeps {
  /** Opens a mailbox's Gmail client from its sealed grant. */
  openMailbox(mailboxId: string): Promise<OpenedOutreachMailbox>
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean }>
  /** The short tracking link for a stored link's id, or `null` when none can be made. */
  clickLinkUrl(linkId: string, trackingOrigin?: string | null): string | null
  /** The click-tracking origin for mail sent as `senderAddress` (AGL-3306), or `null` for the console's. */
  clickLinkOrigin?(input: { orgId: string; senderAddress: string }): Promise<string | null>
}

/** What the route answers: the response the console reads, and the fields the test sent empty. */
export interface OutreachStepTestAnswer extends OutreachStepTestResponse {
  unresolvedFields: string[]
}

const RECONNECT_SENTENCE =
  "This sequence's mailbox needs to be connected again before it can send. Reconnect it on the Mailboxes page."

/** Why the mailbox cannot send a test now, in a sentence, or `null`. */
function mailboxRefusal(mailbox: OutreachMailbox | null): string | null {
  if (!mailbox) return 'This sequence has no mailbox. Choose one and save before sending a test.'
  if (mailbox.status === 'paused') {
    return "This sequence's mailbox is paused. Resume it on the Mailboxes page before sending a test."
  }
  if (mailbox.status === 'reconnect_required' || mailbox.status === 'disconnected') return RECONNECT_SENTENCE
  return null
}

export function createOutreachStepTestRoute(
  deps: OutreachRouteDeps,
  testDeps: OutreachStepTestDeps,
): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    // The address the member typed, when they typed one — read before any
    // record, so a typo is answered before a Gmail call.
    const named = typeof body['to'] === 'string' ? body['to'].trim() : ''
    const typed = named ? normalizeContactEmail(named) : null
    if (named && !typed) {
      return outreachRefusal(400, 'invalid-request', `"${named}" isn't a valid email address.`)
    }
    const loaded = await readOutreachStepRender(deps, request, body)
    if (loaded instanceof Response) return loaded
    const { caller, sequence, stepIndex, mailbox } = loaded

    const refusedBy = mailboxRefusal(mailbox)
    if (refusedBy || !mailbox) return outreachRefusal(409, 'mailbox-unavailable', refusedBy ?? RECONNECT_SENTENCE)
    if (mailbox.connectedByUid !== caller.uid && !caller.isOrgAdmin) {
      return outreachRefusal(
        403,
        'permission',
        "Only the member who connected this sequence's mailbox, or an organization owner or admin, can send a test from it.",
      )
    }
    const to = typed ?? caller.email
    if (!to) return outreachRefusal(400, 'invalid-request', 'Type an address to send the test to.')
    // The rules every sequence email keeps, asked of the stored steps: a
    // sequence saved under an older rule is refused rather than sent broken.
    const issues = validateOutreachSteps(sequence.steps)
    if (hasOutreachValidationErrors(issues)) {
      return outreachRefusal(400, 'invalid-sequence', "Fix the sequence's steps before sending a test.", { issues })
    }
    const limited = await testDeps.consumeRateLimit(`outreach-step-test:${mailbox.id}`, {
      limit: OUTREACH_STEP_TESTS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.allowed) {
      return outreachRefusal(
        429,
        'rate-limited',
        `A mailbox can send ${OUTREACH_STEP_TESTS_PER_HOUR} tests an hour. Try again later.`,
      )
    }

    const firestore = deps.firestore()
    const nowMs = deps.now()
    const sender = { address: mailbox.sendAs || mailbox.email, name: mailbox.displayName || null }
    /*
     * The links, as a real send would rewrite them (AGL-3239, AGL-3297) and
     * marked as a test's: the member sees what a recipient sees, and their
     * own click counts for nothing.
     */
    let linkOrigin: string | null = null
    if (sequence.settings.trackClicks && testDeps.clickLinkOrigin) {
      linkOrigin = await testDeps
        .clickLinkOrigin({ orgId: caller.orgId, senderAddress: sender.address })
        .catch(() => null)
    }
    const shortLinks: Array<{ id: string; doc: OutreachStoredLink }> = []
    const rewriteLink = sequence.settings.trackClicks
      ? (link: { url: string; index: number }) => {
          const doc = outreachStoredLink(
            {
              orgId: caller.orgId,
              enrollmentId: OUTREACH_TEST_LINK_ENROLLMENT,
              stepIndex,
              linkIndex: link.index,
              url: link.url,
              test: true,
            },
            nowMs,
          )
          const id = newOutreachLinkId()
          const url = doc ? testDeps.clickLinkUrl(id, linkOrigin) : null
          if (!doc || !url) return null
          shortLinks.push({ id, doc: { ...doc, sequenceId: sequence.id } })
          return url
        }
      : null
    let composed = previewOutreachStep({ ...loaded.input, rewriteLink })
    if (composed.error || !composed.email) {
      return outreachRefusal(409, 'invalid-sequence', composed.error?.message ?? "This email can't be written yet.")
    }
    if (shortLinks.length) {
      try {
        const batch = firestore.batch()
        for (const link of shortLinks) {
          batch.create(firestore.collection(OUTREACH_COLLECTIONS.links).doc(link.id), link.doc)
        }
        await batch.commit()
      } catch (error) {
        // A link that resolves nowhere is worse than one shown as written:
        // the test goes out with the step's own links.
        console.error('[outreach] the test links could not be stored; the test carries the links as written', error)
        composed = previewOutreachStep({ ...loaded.input, rewriteLink: null })
        if (composed.error || !composed.email) {
          return outreachRefusal(409, 'invalid-sequence', composed.error?.message ?? "This email can't be written yet.")
        }
      }
    }

    const opened = await testDeps.openMailbox(mailbox.id)
    if (opened.ok === false) {
      if (opened.reason === 'not-configured') {
        return outreachRefusal(503, 'mailbox-unavailable', "Google mailboxes aren't set up on this deployment.")
      }
      await markOutreachMailboxReconnectRequired(firestore, {
        orgId: caller.orgId,
        mailboxId: mailbox.id,
        errorCode: opened.reason,
        nowMs,
      })
      return outreachRefusal(409, 'mailbox-unavailable', RECONNECT_SENTENCE)
    }
    /*
     * The preview's email, addressed to the member: `[Test]` in front, and a
     * `Re:` step sent as a new message — no thread id, no `In-Reply-To`, no
     * `References` — since the thread it answers exists only on screen. The
     * unsubscribe header is left off: it names an enrollment, and there is
     * none.
     */
    const email: ComposedOutreachEmail = {
      to,
      subject: `${OUTREACH_TEST_SUBJECT_PREFIX}${composed.email.subject}`,
      text: composed.email.text,
      trackedLinks: composed.email.trackedLinks,
    }
    let subject: string
    try {
      subject = (await sendComposedOutreachEmail(opened.client, email, sender)).subject
    } catch (error) {
      if (error instanceof GmailTransportError && error.reconnectRequired) {
        await markOutreachMailboxReconnectRequired(firestore, {
          orgId: caller.orgId,
          mailboxId: mailbox.id,
          errorCode: error.code,
          nowMs,
        })
        return outreachRefusal(409, 'mailbox-unavailable', 'Google refused this mailbox’s access. Connect it again.')
      }
      if (error instanceof Rfc5322MessageError) {
        return outreachRefusal(400, 'invalid-request', `The test could not be written: ${error.message}`)
      }
      if (!(error instanceof GmailTransportError)) throw error
      return outreachRefusal(
        502,
        'google-unavailable',
        error.retryable ? 'Google did not answer. Try again in a moment.' : `Google refused the request: ${error.message}`,
      )
    }

    const testsToday = await countTest(firestore, caller.orgId, mailbox, nowMs)
    return outreachOk({
      ok: true,
      stepIndex,
      sentTo: to,
      subject,
      sentAtMs: nowMs,
      testsToday,
      unresolvedFields: composed.unresolvedFields,
    } satisfies OutreachStepTestAnswer)
  }
}

/**
 * One more test on the mailbox's local day, in `health.daily.<day>.tests`
 * beside the day's sends and never in them. Bookkeeping beside the act: the
 * email has left, so a failure is logged and answered as no count.
 */
async function countTest(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  mailbox: OutreachMailbox,
  nowMs: number,
): Promise<number> {
  const ref = mailboxRef(firestore, orgId, mailbox.id)
  try {
    return await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const stored = readStoredOutreachMailbox(mailbox.id, snapshot.exists ? snapshot.data() : undefined)
      if (!stored) return 0
      const day = outreachLocalDay(nowMs, stored.timezone)
      const counts = stored.health?.daily?.[day] ?? { sent: 0, bounces: 0, replies: 0 }
      const tests = Math.max(0, Number(counts.tests) || 0) + 1
      transaction.update(ref, { [`health.daily.${day}`]: { ...counts, tests }, updatedAtMs: nowMs })
      return tests
    })
  } catch (error) {
    console.warn('[outreach] a test send could not be counted on its mailbox', error)
    return 0
  }
}
