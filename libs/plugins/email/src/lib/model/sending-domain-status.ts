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
 * WHAT EACH SENDING-DOMAIN STATE LOOKS LIKE, said once.
 *
 * The list and the domain's own page both render a state, and they must not
 * describe the same record differently — a chip saying Verified beside a page
 * saying Not published is the kind of disagreement that makes a customer stop
 * believing either. One module, read twice.
 *
 * ## THE DISTINCTION THIS FILE EXISTS FOR
 *
 * `inconclusive` is not `failed`, and it is not a stored status either.
 *
 * A stored status is the conclusion of a lookup that got answers.
 * `inconclusive` is what happens when NOBODY ANSWERED — a resolver outage, a
 * timeout, a zone that is temporarily unreachable. It is evidence of nothing,
 * so `verifySendingDomain` writes only the check time and leaves the status
 * exactly where it was, and the route answers `503` rather than `200 with
 * verified: false`.
 *
 * Rendering it as a failure would be the most expensive mistake this surface
 * could make. A customer whose DNS is perfect would be told their records are
 * missing, and would go and edit a zone that has nothing wrong with it —
 * possibly breaking the records that were already right. So it is modeled
 * here as a SEPARATE, TRANSIENT layer that sits beside the stored status
 * without replacing it: {@link describeSendingDomain} keeps reporting
 * `records-issued` or `verified`, and {@link INCONCLUSIVE_CHECK} is what the
 * surface adds next to it.
 *
 * ## THE OTHER DISTINCTION: A CLAIM THAT IS WAITING IS NOT A CLAIM THAT FAILED
 *
 * A dedicated platform subdomain is claimed when a merchant asks for one, and
 * the claim is filled only if the mail provider's account-wide domain
 * allowance has room. When it does not, the claim is refused before any call
 * is made and `at-capacity` is stored where a provider refusal would go.
 *
 * The record cannot tell those two apart — both leave a `requested` domain
 * with a reason and no key — but the reader has to, because the sentences
 * point at different people. A provider refusal is a fault to retry; this is a
 * queue, nothing is broken, and the retry does not move it until we have
 * bought more allowance. Describing it as a failed key request would tell a
 * merchant their sending setup is broken when the only thing that happened is
 * that they are waiting for something they were never promised outright.
 */

import { SENDING_DOMAIN_AT_CAPACITY } from '@aglyn/shared-util-email'

/** The four states a record can be stored in. */
export type SendingDomainStatusId =
  | 'requested'
  | 'records-issued'
  | 'verified'
  | 'failed'

export interface SendingDomainStateView {
  /** Two or three words, for a chip. */
  label: string
  color: 'default' | 'info' | 'success' | 'warning' | 'error'
  severity: 'info' | 'success' | 'warning' | 'error'
  /** What is true, and what to do about it, in the customer's terms. */
  text: string
  /** Whether mail can leave on this domain right now. */
  sending: boolean
}

/**
 * One stored state, described.
 *
 * `pendingProvider` splits `requested` in two, and the split matters: both
 * are "no records yet", but one is a deployment that cannot issue signing
 * keys at all and the other is a claim whose issuing call has not happened or
 * did not succeed. Telling a customer to publish records that do not exist is
 * the failure the whole `records-issued` gate is arranged against, and saying
 * "your DNS is wrong" to an operator whose credential is missing points the
 * sentence at the wrong person entirely.
 */
export function describeSendingDomain(input: {
  status: SendingDomainStatusId
  /** Set when this deployment has no credential that can issue a key. */
  pendingProvider?: boolean
  /** A short code from the provider driver's fixed vocabulary. */
  issueError?: string | null
  /** Record keys the last conclusive lookup did not see. */
  missing?: readonly string[] | null
}): SendingDomainStateView {
  switch (input?.status) {
    case 'verified':
      return {
        label: 'Verified',
        color: 'success',
        severity: 'success',
        text:
          'Every required record is published and we can see it. Mail from ' +
          'this site can leave on this domain, signed as you.',
        sending: true,
      }
    case 'records-issued':
      return {
        label: 'Publish the records',
        color: 'info',
        severity: 'info',
        text:
          'The records below are yours to add at whoever hosts your DNS. ' +
          'They usually take a few minutes to spread, sometimes longer — ' +
          'add them, then press Check DNS. Nothing sends on this domain ' +
          'until they are live.',
        sending: false,
      }
    case 'failed':
      return {
        label: 'Records not found',
        color: 'error',
        severity: 'warning',
        text: input?.missing?.length
          ? `We looked, and these records are not published yet: ` +
            `${input.missing.join(', ')}. Add them exactly as shown below ` +
            `and check again.`
          : 'We looked, and the required records are not published yet. Add ' +
            'them exactly as shown below and check again.',
        sending: false,
      }
    default:
      /*
       * `requested`: claimed, with nothing to publish.
       *
       * An empty records table would read as our bug — which, from the
       * customer's side, it is — so this says so in words instead. The
       * distinction below is between a deployment that cannot issue keys and
       * one whose attempt failed, because those are two different people's
       * problems and only one of them is the customer's.
       */
      /*
       * WAITING FOR ROOM, and it is neither of those two.
       *
       * Read FIRST, because it arrives in the same field a provider refusal
       * does and the generic branch would otherwise print "the mail provider
       * did not issue a signing key" about a call that was never made.
       *
       * Three things this has to say and the failure copy gets all three
       * wrong: nothing is broken, nothing at a registrar is involved, and the
       * site's account email is still going out on the shared address. It
       * names the retry anyway — the button is on the screen either way, and
       * a state that says nothing about the one control beside it invites the
       * reader to assume it will help.
       */
      if (String(input?.issueError ?? '') === SENDING_DOMAIN_AT_CAPACITY) {
        return {
          label: 'Waiting for room',
          color: 'warning',
          severity: 'info',
          text:
            'This domain has been asked for and is waiting. We are at our ' +
            'mail provider’s limit on sending domains, so it has not been ' +
            'created yet — nothing here is broken and nothing at your DNS ' +
            'host is involved. This site keeps sending its receipts and ' +
            'account email on the shared address meanwhile; campaigns wait ' +
            'with the domain. Request records will keep answering the same ' +
            'way until we have room, and a domain you own instead of this ' +
            'one is never held this way.',
          sending: false,
        }
      }
      if (input?.pendingProvider !== false && !input?.issueError) {
        return {
          label: 'Waiting on a signing key',
          color: 'warning',
          severity: 'info',
          text:
            'This domain is claimed, but no signing key has been issued for ' +
            'it yet, so there is nothing to publish. This one is on us, not ' +
            'on your DNS — nothing you can change at your registrar will ' +
            'move it. Press Request records to try again.',
          sending: false,
        }
      }
      return {
        label: 'Key request failed',
        color: 'error',
        severity: 'error',
        text:
          `The mail provider did not issue a signing key for this domain ` +
          `(${input.issueError}). The claim is kept, so retrying costs ` +
          `nothing and creates no second domain — press Request records. If ` +
          `it keeps failing, this is ours to fix, not your DNS.`,
        sending: false,
      }
  }
}

/**
 * THE FIFTH SITUATION, and the one that is not a status.
 *
 * Held in the surface's own state after a check that nobody answered, and
 * rendered NEXT TO the stored state rather than in place of it. The record is
 * untouched, the previous conclusion still stands, and the only honest thing
 * to say is that the question could not be asked.
 */
export const INCONCLUSIVE_CHECK = {
  label: 'DNS unreachable',
  color: 'default' as const,
  severity: 'info' as const,
  text:
    'We could not reach DNS to run that check, so nothing has changed — not ' +
    'the records, and not this domain’s state. This is our lookup failing, ' +
    'not a problem with your zone. Try again in a few minutes.',
}

/**
 * WHAT REMOVING ONE SENDING DOMAIN DOES TO THE SITE USING IT.
 *
 * Here for the reason {@link describeSendingDomain} is: the domain's own page
 * and the row menu on the list both ask to remove the same record, and two
 * confirmations describing one action differently is how a merchant comes to
 * dismiss the harsher one as boilerplate.
 *
 * ## Three answers, because releasing a claim does three different things
 *
 * `resolveHostSendingIdentity` reads WHOSE name a selection is from the domain
 * itself, so what a removal costs depends on which of the three the site is
 * standing on:
 *
 *   - a domain the CUSTOMER owns, currently in use. It stops sending
 *     altogether, receipts included. That is deliberate rather than a gap: the
 *     customer published records saying what their recipients would see, and
 *     falling back to any other address would contradict them.
 *   - a domain WE set up, currently in use. It drops to the shared pool, so
 *     all of its mail carries on, on an address whose reputation is shared.
 *   - a domain nothing is sending as. The claim and the key go; no mail moves.
 *
 * Printing the harshest of the three for all of them would be the surface
 * warning about a consequence that is not going to happen, which is the same
 * failure as printing the gentlest.
 */
export function describeSendingDomainRemoval(input: {
  domain: string
  /** The domain this site currently sends as, as the route reported it. */
  selected?: string | null
  /** The site's own platform-provisioned domain, or `''` when it has none. */
  platformDomain?: string | null
}): { title: string; description: string; confirmationText: string } {
  const domain = String(input?.domain ?? '')
  const inUse = Boolean(domain) && String(input?.selected ?? '') === domain
  const ours = Boolean(domain) && String(input?.platformDomain ?? '') === domain

  return {
    title: `Remove ${domain}?`,
    description: !inUse
      ? 'The claim and the signing key are dropped. The DNS records stay in ' +
        'your zone — nothing is changed at your registrar — and you can add ' +
        'the domain again later, which issues a new key.'
      : ours
        ? `This site is currently sending as ${domain}. Removing it moves ` +
          'all of this site’s email back to the shared address, whose ' +
          'delivery reputation is pooled with the other sites on it — so ' +
          'campaigns there are held to tighter complaint and bounce limits. ' +
          'Nothing in your own DNS is involved — we published these records ' +
          'and we remove them.'
        : `This site is currently sending as ${domain}. Removing the domain ` +
          'does not move it onto another address — not the one this site is ' +
          'issued, and not the shared address. It stops this site sending at ' +
          'all, receipts included, until you choose another identity. The ' +
          'DNS records stay in your zone; nothing is changed at your ' +
          'registrar.',
    confirmationText: 'Remove domain',
  }
}
