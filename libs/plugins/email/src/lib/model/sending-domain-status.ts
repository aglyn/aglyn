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
 */

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
