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

/*==========================================
 * THE PHISHING SCREEN, AT MARKETPLACE SUBMISSION (AGL-3365).
 *
 * A listing is content a stranger reads and trusts — the marketplace is the
 * platform vouching for it — so it goes through the same screen as a
 * tenant's email and published page, with the same brand list, the same
 * lookalike rule and the same tiers (`signalsThatHold`), and it is held
 * BEFORE it is published rather than found afterwards:
 *
 * - its title, description, readme, changelog and links are read as a
 *   message (`screenOutboundEmail`), with the publisher's display name as
 *   the sender — a listing "from" PayPal is mail from PayPal;
 * - the nodes a template, layout, component or email template carries are
 *   read as the page they will become (`screenHostedPage`), so a phishing
 *   template never reaches a buyer's site through the catalog.
 *
 * What holds files the SAME abuse-queue row a held email or page files
 * (`fileOutboundHold`, `heldSend.kind: 'listing'`), and the submission is
 * refused with its reference. Staff dismiss the row to release it — the
 * publisher submits again and it goes through, since the row is keyed on the
 * publisher and the signals — or mark it actioned to reject it.
 *
 * Two NAME rules refuse outright rather than hold, because nothing is lost by
 * asking an honest publisher to rename:
 *
 * - a listing title or publisher name that claims to SPEAK FOR a brand
 *   (`brandClaimedByName`: "PayPal Support", "Official Aglyn Plugins");
 * - a publisher display name or handle that wears the platform's own name at
 *   all. A workspace owns any other brand by carrying its name; the
 *   platform's is owned only by the platform's staff.
 *
 * Pure first: a clean submission costs no read.
 *=========================================*/

import { screenHostedPage } from '@aglyn/shared-util-email/hosted-page-screen'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import {
  brandClaimedByName,
  brandForSubdomainLabel,
  phishingSignalTier,
  platformPhishingBrand,
  type PhishingScreenSignal,
  screenOutboundEmail,
  signalsThatHold,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import { firebaseAdmin, notifyOrgAdmins } from '@aglyn/tenant-data-admin'
import { orgAgeDays } from '@aglyn/tenant-data-admin/server/org-age'
import {
  canonicalJson,
  fileOutboundHold,
  flaggedHostOf,
  heldOutboundReference,
  heldOutboundReviewId,
  outboundContentHash,
} from '@aglyn/tenant-data-admin/server/outbound-send-review'
import type { PublishRefusal } from './publish-preconditions'

/** What a submission says, as a stranger will read it. */
export interface ListingSubmissionContent {
  displayName?: string | null
  /** The publisher's display name, read as the sender. */
  publisherName?: string | null
  description?: string | null
  readme?: string | null
  changelog?: string | null
  /** Homepage, repository, support links. */
  urls?: readonly (string | null | undefined)[]
  /** Nodes that will be rendered as a page (template, layout, component). */
  pageNodes?: unknown
  /** Nodes that will be sent as an email (email template, starter). */
  emailNodes?: unknown
}

export interface ListingScreenInput extends ListingSubmissionContent {
  /** The publishing workspace's own names. */
  ownNames?: readonly (string | null | undefined)[]
  /** The actor is the platform's staff — the one owner of its brand. */
  official?: boolean
}

export interface ListingScreenFindings {
  /** A name rule the submission breaks — refused, never held. */
  impersonation: string | null
  /** Every signal the screen found, before the tiers. */
  signals: PhishingScreenSignal[]
}

/** Names that mention the platform are not "own" unless the actor is its staff. */
function ownNamesFor(input: ListingScreenInput): string[] {
  const platform = platformPhishingBrand()
  return (input.ownNames ?? [])
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .filter((name) => input.official === true || !platform.mention.test(name))
}

/**
 * The refusal for a publisher NAME or HANDLE, or null (AGL-3365): it wears
 * the platform's own name, or claims to speak for any brand, or — the handle
 * being a URL segment, like a subdomain — has a brand lookalike's shape.
 */
export function publisherIdentityImpersonation(input: {
  displayName?: string | null
  handle?: string | null
  official?: boolean
}): string | null {
  if (input.official === true) return null
  const platform = platformPhishingBrand()
  const name = String(input.displayName ?? '')
  const handle = String(input.handle ?? '').toLowerCase()
  if (platform.mention.test(name) || platform.hostTokens.some((token) => handle.includes(token))) {
    return (
      `A publisher name or handle cannot use "${platform.label}" — the marketplace would ` +
      `present it as ${platform.label}'s own. Choose a name of your own.`
    )
  }
  const claimed = brandClaimedByName(name)
  if (claimed) {
    return `"${name}" reads as ${claimed.label} itself. Choose a name of your own.`
  }
  const lookalike = handle ? brandForSubdomainLabel(handle) : null
  if (lookalike) {
    return `The handle "${handle}" is shaped like ${lookalike.label}'s. Choose a handle of your own.`
  }
  return null
}

/** Screen one submission. Pure. */
export function screenListingSubmission(input: ListingScreenInput): ListingScreenFindings {
  const title = String(input.displayName ?? '')
  const claimed = input.official === true ? null : brandClaimedByName(title)
  const impersonation = claimed
    ? `A listing titled "${title}" reads as ${claimed.label} itself. Name what it does instead ` +
      `(for example "… for ${claimed.label}").`
    : null
  const ownNames = ownNamesFor(input)
  const email = screenOutboundEmail({
    subject: title,
    fromName: input.publisherName ?? null,
    bodies: [
      input.description,
      input.readme,
      input.changelog,
      ...(input.urls ?? []),
      input.emailNodes === undefined ? null : JSON.stringify(input.emailNodes),
    ],
    ownNames,
  })
  const page =
    input.pageNodes === undefined
      ? { signals: [] as PhishingScreenSignal[] }
      : screenHostedPage({ nodes: input.pageNodes, ownNames })
  const seen = new Set<string>()
  const signals = [...email.signals, ...page.signals].filter((signal) => {
    const key = canonicalJson(signal)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { impersonation, signals }
}

/**
 * Tell the publisher's owners and admins a submission is held (AGL-3365). The
 * outcome and the way forward only — which rule held it stays with staff.
 * Staff hear from `fileOutboundHold`, the same alert a held email or page
 * raises. Never throws.
 */
export async function notifyPublisherSubmissionHeld(
  publisherOrgId: string,
  held: { title: string; reference: string },
): Promise<void> {
  await notifyOrgAdmins(publisherOrgId, {
    type: 'marketplace.review',
    title: 'A marketplace submission is held for review',
    body:
      `"${held.title}" was not listed yet: it is waiting for a review by our team. If it is ` +
      'released, submit it again and it will go through. To ask about it, contact support ' +
      `with reference ${held.reference}.`,
    link: '/manage/marketplace',
  }).catch(() => undefined)
}

/** The review row a publisher's held submission files, keyed on the publisher and the signals. */
export function listingReviewId(
  publisherOrgId: string,
  signals: readonly PhishingScreenSignal[],
): string {
  const key = signals
    .map((signal) => canonicalJson(signal))
    .sort()
    .join('\n')
  return heldOutboundReviewId(
    `publisherProfiles/${publisherOrgId}/submissions`,
    outboundContentHash([key]),
  )
}

/**
 * The whole gate for a marketplace submission: the refusal to send, or null
 * when it may be published. Every publish door and the listing edit call it
 * with what they are about to store (the sweep in
 * `listing-screen-doors.spec.ts` keeps it that way).
 */
export async function listingSubmissionRefusal(input: {
  publisherOrgId: string
  content: ListingSubmissionContent
  official?: boolean
  /** The publishing org's document, when the caller already holds it. */
  org?: Record<string, unknown> | null
  nowMs?: number
}): Promise<PublishRefusal | null> {
  const first = screenListingSubmission({ ...input.content, official: input.official })
  if (first.impersonation) {
    return { status: 422, body: { error: first.impersonation, code: 'impersonation' } }
  }
  if (!first.signals.length) return null

  const nowMs = input.nowMs ?? Date.now()
  let reviewId = ''
  try {
    const org =
      input.org !== undefined
        ? input.org
        : ((
            await firebaseAdmin.app().firestore().collection('orgs').doc(input.publisherOrgId).get()
          ).data() ?? null)
    const text = (value: unknown) => (typeof value === 'string' ? value : '')
    // Again, now knowing whose submission it is: a brand in the workspace's
    // own name is its own (the platform's excepted — see `ownNamesFor`).
    const { signals } = screenListingSubmission({
      ...input.content,
      official: input.official,
      ownNames: [text(org?.['name'])],
    })
    const ageDays = orgAgeDays((org as { createdAt?: unknown } | null)?.createdAt, nowMs)
    const holding = signalsThatHold(signals, { ageDays })
    if (!holding.length) return null
    reviewId = listingReviewId(input.publisherOrgId, holding)
    const title = String(input.content.displayName ?? '').slice(0, 300) || 'a listing'
    // Whether this hold is new, so the publisher is told once, not on every
    // resubmission while it waits.
    const firstHold = !(
      await firebaseAdmin.app().firestore().collection(ABUSE_REPORT_COLLECTION).doc(reviewId).get()
    ).exists
    const state = await fileOutboundHold({
      reviewId,
      heldSend: {
        kind: 'listing',
        path: `publisherProfiles/${input.publisherOrgId}`,
        hostId: '',
        orgId: input.publisherOrgId,
        contentHash: outboundContentHash([holding]),
        subject: title,
        fromName: input.content.publisherName ?? null,
        signals: holding,
        state: 'held',
        heldAtMs: nowMs,
        ageDays,
      },
      headline:
        `Held a marketplace submission ("${title}") from publisher workspace ` +
        `${input.publisherOrgId}, ${ageDays ?? '?'} day(s) old. Nothing was published.`,
      alertTitle: 'Marketplace submission held for review — possible phishing',
      alertBody: `A marketplace submission ("${title}") was held before it was listed.`,
      url: null,
      reportedHostname: flaggedHostOf(holding),
    })
    if (state === 'released') return null
    const reference = heldOutboundReference(reviewId)
    if (state === 'held' && firstHold) {
      await notifyPublisherSubmissionHeld(input.publisherOrgId, { title, reference })
    }
    return {
      status: 409,
      body: {
        // The outcome and what to do — never which rule held it.
        error:
          state === 'rejected'
            ? `This submission was reviewed and cannot be published. Reference ${reference}.`
            : 'This submission is held for a review before it can be published. Nothing was ' +
              'listed. Our team will look at it; if it is released, submit it again and it will ' +
              `go through. To ask about it, contact support with reference ${reference}.`,
        code: state === 'rejected' ? 'rejected' : 'held-for-review',
        reference,
      },
    }
  } catch (error) {
    // Closed only for what holds whoever the publisher is, the page screen's
    // posture: a soft signal needs the workspace's age to hold at all.
    if (!first.signals.some((signal) => phishingSignalTier(signal) === 'strong')) {
      console.error('[listing-screen] a submission could not be reviewed — allowing it', error)
      return null
    }
    console.error('[listing-screen] a flagged submission could not be reviewed — refusing it', error)
    return {
      status: 503,
      body: {
        error: 'This submission could not be reviewed just now — try again in a minute.',
        ...(reviewId ? { reference: heldOutboundReference(reviewId) } : {}),
      },
    }
  }
}
