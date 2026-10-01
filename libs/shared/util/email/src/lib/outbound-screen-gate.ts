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
 * THE OUTBOUND SCREEN ON THE SEND SEAM (AGL-3362).
 *
 * Every tenant message leaves through `sendEmail`, and every tenant sender
 * but the campaign core resolves its identity through `hostSendingIdentity`,
 * which stamps the verdict with the {@link SendingWorkspace} it read. So the
 * screen is asked HERE, once, for the CRM's one-off mail, inbox replies,
 * newsletters, member posts, cart and restock sweeps, flow steps, receipts —
 * and any marketplace plugin that sends for a site — with no copy of it in
 * any of them.
 *
 * Split the way the governor, the marketing gate and the deliverability
 * preflight are: the DECISION is pure and lives in this library
 * (`screenOutboundEmail` finds signals, `signalsThatHold` applies the tiers);
 * what a hold WRITES — the abuse-queue row, the staff alert, the release
 * lookup — is a store, so it is injected by `@aglyn/tenant-data-admin`
 * through {@link setOutboundScreenGate}. The gate is only called when a
 * signal holds, so a clean message costs no read.
 *
 * Nothing installed is UNGATED, the governor's posture: a deployment that
 * never installs the store must still send.
 *=========================================*/

import { linkReputationSignals } from './link-reputation'
import {
  linkUrlsIn,
  type PhishingScreenSignal,
  screenOutboundEmail,
  signalsThatHold,
} from './outbound-phishing-screen'

/**
 * The workspace a tenant message belongs to, as the screen needs it. Stamped
 * on the sending identity by `hostSendingIdentity` from the host and org
 * documents it already reads, so the screen costs no read of its own.
 */
export interface SendingWorkspace {
  hostId: string
  orgId: string | null
  /** Days since the org was created; `null` when unreadable (an existing customer). */
  ageDays: number | null
  /** The org's and site's names and the subdomain — a brand in one is its own. */
  ownNames: string[]
  /** The site's hosts — a link to one is never "elsewhere". */
  ownDomains: string[]
}

export interface OutboundScreenGateRequest {
  workspace: SendingWorkspace
  /** The signals that HOLD, after the tiers. Never empty. */
  signals: PhishingScreenSignal[]
  subject: string
  fromName: string | null
  /** The sender's `context`, so the reviewer can tell which feature sent it. */
  context: string | null
  /**
   * A review row a caller's own screen held and staff RELEASED for this
   * content (a campaign, an automation step). The gate honors it only when
   * that row really is a release for this site — a caller cannot mint one.
   */
  releasedReviewId: string | null
}

export interface OutboundScreenGateVerdict {
  outcome: 'send' | 'held' | 'rejected'
  /** The `HS-…` reference staff and the merchant quote. */
  reference?: string | null
}

export type OutboundScreenGate = (
  request: OutboundScreenGateRequest,
) => Promise<OutboundScreenGateVerdict>

let installedGate: OutboundScreenGate | null = null

/** Installs the durable gate. Called once, from `@aglyn/tenant-data-admin`. */
export function setOutboundScreenGate(gate: OutboundScreenGate | null): void {
  installedGate = gate
}

/** The installed gate, or null when nothing has been installed. */
export function getOutboundScreenGate(): OutboundScreenGate | null {
  return installedGate
}

/** Test seam: forget any installed gate. */
export function resetOutboundScreenGateForTests(): void {
  installedGate = null
}

export interface TenantMessageScreenInput {
  workspace: SendingWorkspace
  subject: string
  fromName?: string | null
  /** The address it leaves from — a lookalike `From:` domain holds for everyone. */
  fromAddress?: string | null
  replyTo?: string | readonly string[] | null
  /** Everything the recipient reads or clicks: the text part, the HTML. */
  bodies: readonly (string | null | undefined)[]
  /** The recipient's own act made this owed (see `SendEmailOptions.owedFor`). */
  owed?: boolean
  context?: string | null
  releasedReviewId?: string | null
}

/** Why a tenant message may not leave. */
export interface TenantMessageScreenRefusal {
  outcome: 'held' | 'rejected'
  reference: string | null
  /** The sentence a merchant reads. */
  detail: string
}

/**
 * Screen one tenant message: the pure screen, the reputation of every
 * foreign host it links to (AGL-3451), the tiers, then — only when a signal
 * holds — the installed gate, which files or reads the review row. `null`
 * when it may go.
 *
 * The ONE door for every transport. `sendEmail` asks it for every message a
 * site sends through the platform's provider, and a sender on another
 * transport (Outreach's connected mailboxes) asks it the same way, so a
 * second transport is not a second screen.
 *
 * Fails OPEN on a gate that is missing, throws or answers nothing, the
 * posture of every other control on the send path: an outage on the review
 * queue must not become an outage on every site's mail.
 */
export async function screenTenantMessage(
  input: TenantMessageScreenInput,
  label = 'email',
): Promise<TenantMessageScreenRefusal | null> {
  const { workspace } = input
  if (!workspace?.hostId) return null
  const verdict = screenOutboundEmail({
    subject: input.subject,
    fromName: input.fromName ?? null,
    fromAddress: input.fromAddress ?? null,
    replyTo: input.replyTo ?? null,
    bodies: input.bodies,
    ownNames: workspace.ownNames,
    ownDomains: workspace.ownDomains,
  })
  // Every foreign link the message carries, against the reputation list
  // (AGL-3451): its host, and in 'url' mode its address (AGL-3459). A
  // listing is a strong signal; a lookup that fails is none. Nothing
  // installed looks nothing up.
  const reputation = await linkReputationSignals(
    linkUrlsIn([input.subject, ...input.bodies].filter(Boolean).join('\n')),
    { ownDomains: workspace.ownDomains },
  )
  const holding = signalsThatHold([...verdict.signals, ...reputation], {
    ageDays: workspace.ageDays,
    owed: input.owed === true,
  })
  if (!holding.length) return null
  const gate = getOutboundScreenGate()
  if (!gate) {
    console.warn(`${label} matched the phishing screen, and no review store is installed — allowing`)
    return null
  }
  let answer: OutboundScreenGateVerdict | null
  try {
    answer = await gate({
      workspace,
      signals: holding,
      subject: String(input.subject ?? ''),
      fromName: input.fromName ?? null,
      context: input.context ?? null,
      releasedReviewId: input.releasedReviewId ?? null,
    })
  } catch (error) {
    console.error(`${label} phishing review failed — allowing`, error)
    answer = null
  }
  if (!answer || answer.outcome === 'send') return null
  const reference = answer.reference ?? null
  const cited = reference ? ` (${reference})` : ''
  return {
    outcome: answer.outcome,
    reference,
    detail:
      answer.outcome === 'rejected'
        ? `Staff review rejected email like this from this site${cited}, so it was not sent.`
        : 'This email is held for staff review because it may impersonate another ' +
          `business${cited}. Nothing was sent.`,
  }
}
