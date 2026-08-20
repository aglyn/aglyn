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
 * The words the console uses for a custom domain's live state (AGL-2011).
 *
 * Extracted from `custom-domain-card.component.tsx` unchanged, because a
 * SECOND surface now renders them: the staff host page. The point of sharing
 * rather than copying is the support conversation — when a customer says "it
 * says DNS not pointing here" the staff member has to be looking at that
 * sentence, not at a paraphrase of it. Two independently-worded renderings of
 * the same verdict is the failure mode, and it is invisible from either side.
 */

/**
 * What `/api/domains/status` reports (AGL-1913). `none` is a site with no
 * custom domain; `unknown`/`skipped` mean the platform could not be asked.
 */
export interface DomainStatus {
  domain: string | null
  state:
    | 'none'
    | 'serving'
    | 'certificate-pending'
    | 'ownership-pending'
    | 'dns-misconfigured'
    | 'not-attached'
    | 'skipped'
    | 'unknown'
  verification?: { type: string; domain: string; value: string }[]
  conflicts?: { type?: string; name?: string; value?: string }[]
  attachmentPending?: boolean
}

/** The colour a chip takes, in MUI's vocabulary. */
export type DomainChipColor = 'success' | 'warning' | 'error' | 'info'

/**
 * The chip, per state.
 *
 * Every state here used to render as the same green chip, which is the bug:
 * a certificate still issuing and a domain that will never work are not the
 * same news, and the customer is the one who has to act on the difference.
 * `unknown` deliberately falls back to the old label rather than inventing a
 * problem — a status call that could not answer is not evidence of one.
 */
export function domainChipFor(
  domain: string,
  status: DomainStatus | null,
  attachmentPending: boolean,
): { label: string; color: DomainChipColor } {
  switch (status?.state) {
    case 'serving':
      return { label: `${domain} — live`, color: 'success' }
    case 'certificate-pending':
      return { label: `${domain} — issuing certificate`, color: 'info' }
    case 'ownership-pending':
      return { label: `${domain} — ownership check needed`, color: 'warning' }
    case 'dns-misconfigured':
      return { label: `${domain} — DNS not pointing here`, color: 'warning' }
    case 'not-attached':
      return { label: `${domain} — not attached`, color: 'error' }
    default:
      return attachmentPending
        ? { label: `${domain} — attachment pending`, color: 'warning' }
        : { label: domain, color: 'success' }
  }
}

/**
 * One line of staff-facing context for a state, in the SUPPORT reader's terms.
 *
 * Deliberately not the customer's `explanationFor`, and the difference is the
 * addressee, not the facts: the customer's copy says "add the record below at
 * your registrar", which a staff member cannot do and must not be told to. So
 * each line here says what is true and who has to move, so support can read it
 * out without first translating it out of the second person.
 */
export function staffDomainNoteFor(
  status: DomainStatus | null,
): { severity: 'info' | 'warning' | 'error'; text: string } | null {
  switch (status?.state) {
    case 'certificate-pending':
      return {
        severity: 'info',
        text:
          'DNS resolves here and the domain is attached; the certificate is ' +
          'still issuing. Nobody needs to do anything — the completer cron ' +
          'clears the pending flag once it lands. Until then the domain may ' +
          'show a security warning and visitors are still sent to the ' +
          'platform subdomain.',
      }
    case 'ownership-pending':
      return {
        severity: 'warning',
        text:
          'The apex is registered to another account on the hosting ' +
          'platform, so it will not serve until a TXT challenge is answered. ' +
          'The record below is the one the customer has to add at their ' +
          'registrar; Re-attach re-probes once they have.',
      }
    case 'dns-misconfigured':
      return {
        severity: 'warning',
        text:
          'The domain is attached but no longer resolves here — the customer ' +
          'changed the record at their registrar, or another record is ' +
          'answering for the same name. Nothing on our side fixes this; the ' +
          'conflicting records below, if any, are the usual cause.',
      }
    case 'not-attached':
      return {
        severity: 'error',
        text:
          'Saved on the site but not attached to the hosting platform, so it ' +
          'serves nothing. Try Re-attach. If it keeps failing the name is ' +
          'held by another account on the platform and needs a support ' +
          'escalation with the domain name.',
      }
    case 'skipped':
    case 'unknown':
      return {
        severity: 'info',
        text:
          'The hosting platform could not be asked for this domain, so there ' +
          'is no verdict — this is not evidence of a problem. On a ' +
          'self-hosted deployment there is no platform to ask at all.',
      }
    default:
      return null
  }
}
