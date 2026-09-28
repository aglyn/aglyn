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
 * HELD FOR REVIEW: a published page (AGL-3362).
 *
 * ## Why the check sits where a page is COMPOSED, not where it is published
 *
 * A publish is a browser write. The besigner toolbar, the versions panel,
 * the screen details page, page-from-template, the layout and component
 * besigners and the form besigner each move a pointer (`versionId`, the
 * host's `screens` map, a component's own `nodes`) straight from the
 * client SDK; the scheduled-publish beat moves it from the server; an
 * experiment serves a version no pointer names; and an author may rewrite
 * the LIVE version document itself without moving any pointer at all. A
 * check on any one of those writes is a check the next one walks around.
 *
 * They all meet in one place: `composeScreenNodes` (`@aglyn/tenant-runtime`),
 * which every published render, the password unlock, the collection and
 * product templates and every experiment variant go through, and which
 * returns the page exactly as a visitor will receive it — the screen, its
 * layout chrome, its grafted components and its forms. So the screen is read
 * there, and a held page is one that is never composed for a visitor. For a
 * visitor, "publish" is the first render after the pointer moved; this is
 * that moment.
 *
 * ## What a hold does
 *
 * - The version is not served. The last version this page served clean
 *   ({@link servedPageVersion}) is composed instead — screened again, since
 *   a version document can be edited in place — and if there is none, or it
 *   holds too, the page is not found. A first publish that holds therefore
 *   serves nothing.
 * - One review row per (page, signal set) lands in the abuse queue at
 *   `/admin/abuse-reports`, the same `phishing` row a held email files
 *   (`fileOutboundHold`), with `heldSend.kind: 'page'`, the page's URL and
 *   the held version. Staff dismiss it to RELEASE (the admin route drops the
 *   site's cache and the next render serves it) or mark it actioned to
 *   REJECT (it stays unserved; any later version carrying the same signals
 *   is refused without a new row).
 * - Keyed on the SIGNALS, as the send seam's rows are: a composed page
 *   carries per-render values (dates, collection rows) that no content hash
 *   would survive, while what makes it phishing does not change between
 *   renders.
 *
 * ## Tiers
 *
 * `signalsThatHold`: a lookalike link or embed and an author-defined
 * credential field hold for EVERY workspace; a brand's call to action only
 * for a workspace in its first fortnight. The workspace's documents are read
 * only when the pure screen has found something, so a clean page costs no
 * read for this.
 *
 * Fails CLOSED, unlike the send path. Composition itself reads the store, so
 * an outage here is an outage on the render already, and the only cost of
 * not serving a page the screen flagged is a false positive's wait; serving
 * it is the phishing page this exists to stop.
 *=========================================*/

import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import { screenHostedPage } from '@aglyn/shared-util-email/hosted-page-screen'
import {
  lookalikeBrandForHost,
  phishingScreenBrandLabel,
  type PhishingScreenSignal,
  signalsThatHold,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import { FieldValue } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import { notifyRiskEvent } from './risk-notice'
import { orgAgeDays } from './org-age'
import { getHostDocAdmin, getOrgForHost } from './organizations'
import {
  canonicalJson,
  fileOutboundHold,
  flaggedHostOf,
  heldOutboundReference,
  heldOutboundReviewId,
  outboundContentHash,
  type HeldOutboundSendState,
  workspaceScreenIdentity,
} from './outbound-send-review'

/** Where the last version a page served clean is noted: a hint, re-screened before use. */
export const PAGE_REVIEW_SUBCOLLECTION = 'pageReviews'

export interface HostedPageReviewRequest {
  hostId: string
  screenId: string
  versionId: string
  /** The page as composed for a visitor. */
  nodes: unknown
  /** The host and org documents, when the caller already holds them. */
  host?: Record<string, unknown> | null
  org?: Record<string, unknown> | null
  orgId?: string | null
  nowMs?: number
}

export type HostedPageReviewOutcome =
  | { outcome: 'serve' }
  | { outcome: 'held' | 'rejected'; reviewId: string; reference: string }

/** The review row's id for a page and the signals that held. */
export function pageReviewId(
  hostId: string,
  screenId: string,
  signals: readonly PhishingScreenSignal[],
): string {
  const key = signals
    .map((signal) => canonicalJson(signal))
    .sort()
    .join('\n')
  return heldOutboundReviewId(`hosts/${hostId}/screens/${screenId}`, outboundContentHash([key]))
}

/** How long this process trusts a page row's state — the send seam's minute. */
const PAGE_MEMO_TTL_MS = 60_000
const pageMemo = new Map<string, { state: HeldOutboundSendState; atMs: number }>()
/** The version each page last served clean, as this process last wrote it. */
const servedMemo = new Map<string, string>()

/** Test seam: forget what this process learned. */
export function resetHostedPageReviewMemoForTests(): void {
  pageMemo.clear()
  servedMemo.clear()
}

/** The page's public URL, for the review row. Best effort; the row stands without it. */
function pageUrl(host: Record<string, unknown> | null, screenId: string): string | null {
  const subdomain = typeof host?.['subdomain'] === 'string' ? (host['subdomain'] as string) : ''
  const cname = typeof host?.['cname'] === 'string' ? (host['cname'] as string) : ''
  const origin = cname ? `https://${cname}` : subdomain ? `https://${subdomain}.${TENANT_APEX}` : ''
  if (!origin) return null
  const screens = (host?.['screens'] ?? {}) as Record<string, unknown>
  const path = typeof screens[screenId] === 'string' ? (screens[screenId] as string) : ''
  const clean = path.replace(/^\/+|\/+$/g, '')
  return `${origin}/${clean === 'index' ? '' : clean}`
}

/**
 * Screen one page as a visitor would receive it, and say whether it may be
 * served. See the module header.
 */
export async function reviewHostedPage(
  request: HostedPageReviewRequest,
): Promise<HostedPageReviewOutcome> {
  const found = screenHostedPage({ nodes: request.nodes })
  if (!found.signals.length) return { outcome: 'serve' }

  const nowMs = request.nowMs ?? Date.now()
  let reviewId = ''
  try {
    const [host, owner] = await Promise.all([
      request.host !== undefined ? request.host : getHostDocAdmin(request.hostId),
      request.org !== undefined
        ? { orgId: request.orgId ?? null, org: request.org }
        : getOrgForHost(request.hostId),
    ])
    const org = (owner?.org as Record<string, unknown> | null | undefined) ?? null
    const orgId = owner?.orgId ?? null
    // Again, now knowing whose page it is: a brand in the workspace's own
    // name or domain is its own, and a link to its own site is not away.
    const identity = workspaceScreenIdentity({ org, host })
    const verdict = screenHostedPage({ nodes: request.nodes, ...identity })
    const ageDays = orgAgeDays((org as { createdAt?: unknown } | null)?.createdAt, nowMs)
    const signals = signalsThatHold(verdict.signals, { ageDays })
    if (!signals.length) return { outcome: 'serve' }

    reviewId = pageReviewId(request.hostId, request.screenId, signals)
    const reference = heldOutboundReference(reviewId)
    const memo = pageMemo.get(reviewId)
    if (memo && nowMs - memo.atMs < PAGE_MEMO_TTL_MS) {
      return memo.state === 'released'
        ? { outcome: 'serve' }
        : { outcome: memo.state === 'rejected' ? 'rejected' : 'held', reviewId, reference }
    }
    const url = pageUrl(host, request.screenId)
    const flagged = flaggedHostOf(signals)
    const pageName =
      typeof host?.['name'] === 'string' && host['name'] ? `"${host['name']}"` : 'a site'
    const state = await fileOutboundHold({
      reviewId,
      heldSend: {
        kind: 'page',
        path: `hosts/${request.hostId}/screens/${request.screenId}`,
        hostId: request.hostId,
        orgId,
        contentHash: outboundContentHash([signals]),
        subject: (url ?? `screen ${request.screenId}`).slice(0, 300),
        fromName: null,
        signals,
        state: 'held',
        heldAtMs: nowMs,
        ageDays,
      },
      extra: { heldPage: { screenId: request.screenId, versionId: request.versionId, url } },
      headline:
        `Held a published page of ${pageName}${url ? ` (${url})` : ''}, version ` +
        `${request.versionId}, from a workspace ${ageDays ?? '?'} day(s) old. The page ` +
        'serves its last clean version, or nothing, until this is decided.',
      alertTitle: 'Published page held for review — possible phishing',
      alertBody: `A page ${url ? `at ${url} ` : ''}was held before it went live.`,
      // The owners' words for it, and the held version's own page in the
      // console (AGL-3368).
      item: {
        label: url ? `the page ${url}` : 'a page on your site',
        path:
          `/${request.hostId}/screens/${encodeURIComponent(request.screenId)}` +
          `/versions/${encodeURIComponent(request.versionId)}/view`,
      },
      // The page itself is what was reported; the flagged host, when there
      // is one, is named in the details and on `reportedHostname`.
      url,
      reportedHostname: flagged,
    })
    pageMemo.set(reviewId, { state, atMs: nowMs })
    return state === 'released'
      ? { outcome: 'serve' }
      : { outcome: state === 'rejected' ? 'rejected' : 'held', reviewId, reference }
  } catch (error) {
    // Closed only for what holds whoever the workspace is: a soft signal
    // needs the workspace's age to hold at all, and that is what failed.
    if (!signalsThatHold(found.signals, { ageDays: null }).length) {
      console.error('[page-review] a page could not be reviewed — serving it', error)
      return { outcome: 'serve' }
    }
    console.error('[page-review] a flagged page could not be reviewed — not serving it', error)
    return {
      outcome: 'held',
      reviewId,
      reference: reviewId ? heldOutboundReference(reviewId) : '',
    }
  }
}

function pageReviewRef(hostId: string, screenId: string) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(PAGE_REVIEW_SUBCOLLECTION)
    .doc(screenId)
}

/**
 * The version this page last served clean, or null. A HINT, not a
 * clearance: the caller composes and screens it again before serving it,
 * because a version document can be edited after it was served.
 */
export async function servedPageVersion(hostId: string, screenId: string): Promise<string | null> {
  try {
    const snapshot = await pageReviewRef(hostId, screenId).get()
    const value = snapshot.get('servedVersionId')
    return typeof value === 'string' && value ? value : null
  } catch {
    return null
  }
}

/**
 * Note that this page served `versionId` clean. One read the first time a
 * process renders a page, a write only when the version moved; nothing
 * after that, however often the page is rendered.
 */
export async function recordServedPageVersion(
  hostId: string,
  screenId: string,
  versionId: string,
): Promise<void> {
  const key = `${hostId}/${screenId}`
  if (!versionId || servedMemo.get(key) === versionId) return
  try {
    const ref = pageReviewRef(hostId, screenId)
    const snapshot = await ref.get()
    if (snapshot.get('servedVersionId') !== versionId) {
      await ref.set({ servedVersionId: versionId, servedAtMs: Date.now() }, { merge: true })
    }
    servedMemo.set(key, versionId)
  } catch (error) {
    console.warn('[page-review] the served version could not be noted', error)
  }
}

/**
 * A domain a workspace attached that wears a brand (AGL-3356, AGL-3362):
 * filed in the abuse queue as an urgent `phishing` row for staff, not
 * refused. Two kinds, one rule:
 *
 * - `site` — a custom domain a site is served on (the attach route);
 * - `sending` — a custom domain a workspace sends email as, when it is
 *   added and again when it verifies (`sending-domains.ts`);
 * - `link` — a link a merchant configured that a buyer or a server would
 *   follow: a product's paid download or video hotlink, a supplier's order
 *   webhook (AGL-3363). The link itself is refused where it is followed; this
 *   files it, and tells the site's managers once ({@link notifyLookalikeLink}).
 *
 * Not refused, because the domain is the merchant's own registration and
 * the platform cannot tell a brand's own agency attaching `paypal-promo.com`
 * from a kit — but a brand's lookalike on a site or in a `From:` line is
 * exactly what staff look at first. The site's pages are still screened as
 * they are served, and mail FROM a lookalike domain is held at the send seam
 * for every workspace. The test is the phishing screen's own lookalike rule
 * (`lookalikeBrandForHost`), the one that holds a link in an email. One row
 * per (owner, kind, domain), so a re-attach or a re-verify counts rather than
 * re-alerts.
 *
 * Never throws: the write it rides on has already happened.
 */
export async function flagLookalikeDomain(input: {
  kind: 'site' | 'sending' | 'link'
  hostId: string | null
  orgId: string | null
  domain: string
  /** For a `link`: where it was configured, as staff read it. */
  where?: string
}): Promise<'flagged' | 'clean' | 'failed'> {
  const domain = String(input.domain ?? '').trim().toLowerCase()
  const brand = lookalikeBrandForHost(domain)
  if (!brand) return 'clean'
  const label = phishingScreenBrandLabel(brand.id)
  const sending = input.kind === 'sending'
  const link = input.kind === 'link'
  try {
    const firestore = firebaseAdmin.app().firestore()
    const owner = sending
      ? `orgs/${input.orgId ?? ''}/sendingDomains`
      : link
        ? `hosts/${input.hostId ?? ''}/links`
        : `hosts/${input.hostId ?? ''}/cname`
    const reviewId = heldOutboundReviewId(owner, domain)
    const reference = heldOutboundReference(reviewId)
    const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
    const first = !(await ref.get()).exists
    await ref.set(
      {
        reference,
        category: 'phishing',
        severity: 'urgent',
        source: 'outbound-screen',
        url: `https://${domain}/`,
        reportedHostname: domain,
        hostId: input.hostId,
        orgId: input.orgId,
        details: [
          sending
            ? `A workspace added ${domain} as a domain to send email from.`
            : link
              ? `A site configured a link to ${domain} (${input.where ?? 'a commerce link'}).`
              : `A site attached the custom domain ${domain}.`,
          `${domain} wears the ${label} name but is not ${label}'s domain.`,
          sending
            ? 'Email from it is held at the send seam for every workspace. Mark this actioned ' +
              'and lock the workspace if it is impersonation; dismiss it if the brand is theirs.'
            : link
              ? 'Nobody is sent to it: the link is refused wherever it is followed. Mark this ' +
                'actioned and lock the site if it is impersonation.'
              : 'Its pages are still screened as they are served. Mark this actioned ' +
                'and lock the site if it is impersonation; dismiss it if the brand is theirs.',
        ].join('\n'),
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        reportCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        ...(first ? { status: 'open', createdAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    )
    if (first && link) {
      await notifyLookalikeLink({
        hostId: input.hostId,
        orgId: input.orgId,
        domain,
        label,
        where: input.where ?? 'a commerce link',
        reference,
        reviewId,
      })
    } else if (first) {
      // The owners hear that the domain is waiting on a routine review — not
      // which name it resembles; staff get the brand and a link to the row.
      await notifyRiskEvent({
        kind: 'domain-flagged',
        orgId: input.orgId,
        hostId: input.hostId,
        reviewId,
        reference,
        item: {
          label: sending ? `the sending domain ${domain}` : `the custom domain ${domain}`,
          // Emails → Sending, or the site's Domain settings.
          path: sending ? '/org/emails/sending' : input.hostId ? `/${input.hostId}/admin/domain` : null,
        },
        staffEvidence:
          `${sending ? 'Sending domain' : 'Custom domain'} ${domain} looks like ${label}.`,
      })
    }
    return 'flagged'
  } catch (error) {
    console.error('[page-review] a lookalike domain could not be flagged', error)
    return 'failed'
  }
}

/**
 * Tell staff and the site's managers and the workspace's owners, once per
 * (site, domain), that a link the merchant configured was refused because it
 * wears another brand's name (AGL-3363), through the risk notice seam
 * (AGL-3368). The merchant reads the catalog's `link-blocked` words — what
 * was refused and how to fix it, never how the check works; staff get the
 * brand and a link to the row. Never throws.
 */
export async function notifyLookalikeLink(input: {
  hostId: string | null
  orgId?: string | null
  domain: string
  label: string
  where: string
  reference: string
  reviewId?: string | null
}): Promise<void> {
  await notifyRiskEvent({
    kind: 'link-blocked',
    orgId: input.orgId ?? null,
    hostId: input.hostId,
    reviewId: input.reviewId ?? null,
    reference: input.reference,
    item: {
      label: `${input.where} pointing to ${input.domain}`,
      path: input.hostId ? `/${input.hostId}/products` : null,
    },
    staffEvidence:
      `A site configured ${input.where} to ${input.domain}, which looks like ${input.label}. ` +
      'It is refused wherever it is followed.',
  }).catch(() => undefined)
}

/** A site's custom domain, through {@link flagLookalikeDomain}. */
export function flagLookalikeCustomDomain(input: {
  hostId: string
  orgId: string | null
  domain: string
}): Promise<'flagged' | 'clean' | 'failed'> {
  return flagLookalikeDomain({ kind: 'site', ...input })
}
