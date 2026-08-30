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
 * Ask the provider for a signing key, and write down what it said.
 *
 * The join between the driver (`sending-domain-provider.ts`, which holds the
 * credential and no storage) and the store (`@aglyn/tenant-data-admin`, which
 * holds the record and no credential). It is in the console for the same
 * reason the driver is: the tenant runtime must not be able to import a module
 * that reads `RESEND_DOMAINS_API_KEY`.
 *
 * ## The two rules
 *
 * **Never call the provider for a domain that already has a key.** That is
 * where idempotency actually lives: a customer clicking Add twice, or a retry
 * after a timeout, resolves against our own record and never reaches the
 * network. Leaving it to the provider's duplicate handling would work and
 * would still be wrong — it spends a round trip, and it makes correctness
 * depend on a vendor answering `422`.
 *
 * **A failure writes a REASON, never a status.** There is no path from a
 * provider error to `records-issued`. A domain whose issuing call failed stays
 * `requested`: it has no records to publish and it refuses sends, which is the
 * truth about a domain with no signing key. The alternative — a status that
 * says records exist beside an empty DKIM row — is the shape this whole
 * feature is arranged against, because the customer reads it as our bug and
 * cannot act on it.
 */

import {
  recordIssuedSendingDomain,
  recordSendingDomainIssueFailure,
} from '@aglyn/tenant-data-admin'
import type { SendingDomainRecord } from '@aglyn/shared-util-email'
import {
  sendingDomainProvider,
  type SendingDomainIssue,
} from './sending-domain-provider'

export interface IssuedSendingDomain {
  /** The record as it now stands — unchanged unless a key was recorded. */
  record: SendingDomainRecord
  outcome: SendingDomainIssue['outcome']
  /** A short code, safe to show an admin. Null when nothing went wrong. */
  detail: string | null
}

export async function issueSendingDomainRecords(options: {
  orgId: string
  record: SendingDomainRecord
}): Promise<IssuedSendingDomain> {
  const record = options?.record
  if (!record?.domain || !options?.orgId) {
    // Distinct from `unconfigured`: nothing was asked for, as against nothing
    // being able to answer. Collapsing the two would tell an operator their
    // credential is missing when the claim is.
    return { record, outcome: 'skipped', detail: 'no-claim' }
  }

  // Already issued. No provider call, no second domain at the provider, and
  // nothing that could overwrite a key the customer may have published.
  if (String(record.dkimPublicKey ?? '').trim()) {
    return { record, outcome: 'already-exists', detail: null }
  }

  const provider = sendingDomainProvider()
  if (!provider.configured()) {
    return { record, outcome: 'skipped', detail: 'unconfigured' }
  }

  const issue = await provider.issue(record.domain)

  if (issue.outcome === 'skipped') {
    return { record, outcome: 'skipped', detail: issue.detail }
  }

  if (issue.outcome === 'failed' || !issue.dkimPublicKey) {
    /*
     * `!issue.dkimPublicKey` is checked alongside the outcome rather than
     * trusted from it. A driver reporting success with nothing to publish is
     * a bug in the driver, and the consequence of believing it is a record at
     * `records-issued` with an empty DKIM row — the one state
     * `recordIssuedSendingDomain` refuses outright, but which should not get
     * as far as being refused.
     */
    await recordSendingDomainIssueFailure({
      orgId: options.orgId,
      domain: record.domain,
      detail: issue.detail || 'no-key-issued',
    })
    return {
      record: { ...record, lastIssueError: issue.detail || 'no-key-issued' },
      outcome: 'failed',
      detail: issue.detail || 'no-key-issued',
    }
  }

  /*
   * No `returnPathHost`. Only the DKIM record comes from the provider; the
   * return path and the SPF include are this deployment's configuration
   * (`AGLYN_EMAIL_RETURN_PATH_HOST`, `AGLYN_EMAIL_SPF_INCLUDE`) and are
   * issued by `sendingDnsRecords`, which is also what the verifier compares
   * against. Pinning a copy onto the record would freeze it against an
   * operator who later changes the setting.
   */
  const stored = await recordIssuedSendingDomain({
    orgId: options.orgId,
    domain: record.domain,
    dkimPublicKey: issue.dkimPublicKey,
    dkimSelector: issue.dkimSelector,
    providerDomainId: issue.providerDomainId,
  })

  if (stored.error) {
    /*
     * The provider issued a key and we could not store it. The record stays
     * where it was, and the reason is written down: an admin looking at a
     * domain that will not progress needs to see that the failure was ours.
     */
    await recordSendingDomainIssueFailure({
      orgId: options.orgId,
      domain: record.domain,
      detail: `store-${stored.status}`,
    })
    return {
      record: stored.record ?? record,
      outcome: 'failed',
      detail: `store-${stored.status}`,
    }
  }

  /*
   * `?? record` because the store re-reads the document after writing it, and
   * a domain released between the two reads comes back null. The caller
   * renders records off this and would otherwise throw on a race whose worst
   * honest outcome is showing the claim as it was a moment ago.
   */
  return { record: stored.record ?? record, outcome: issue.outcome, detail: null }
}
