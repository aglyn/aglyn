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
 * SENDER READINESS, LOOKED UP (AGL-3328).
 *
 * The lookups behind `@aglyn/shared-util-email`'s `assessSenderReadiness`:
 * SPF at the envelope domain, the provider's DKIM selector, and DMARC at the
 * From domain (and at its organizational domain when a subdomain publishes
 * none). Through `dns-probe`'s pinned resolvers, so an unanswered lookup is
 * `null` — the engine's `unknown` — and never an empty zone.
 *
 * Remembered for ten minutes per process, keyed by what was asked: a
 * sending-domain card and a mailbox card render often, and a zone does not
 * change between two renders. A caller that just changed something (the
 * sending domain's "Check DNS") asks with `fresh` and skips the memory.
 *==========================================*/

import {
  assessSenderReadiness,
  senderReadinessHosts,
  type SenderReadiness,
  type SenderReadinessExpectation,
} from '@aglyn/shared-util-email'
import { lookupTxt, type DnsLookupResult } from './dns-probe'

/** How a TXT lookup is made; `dns-probe`'s `lookupTxt` unless a spec hands in its own. */
export type SenderReadinessTxtLookup = (host: string) => Promise<DnsLookupResult<string>>

export interface SenderReadinessDeps {
  lookupTxt?: SenderReadinessTxtLookup
  nowMs?: number
}

/** How long a readiness answer is reused. */
export const SENDER_READINESS_MEMORY_MS = 10 * 60_000

const MEMORY_MAX = 500
const memory = new Map<string, SenderReadiness>()

const memoryKey = (expectation: SenderReadinessExpectation) =>
  JSON.stringify([
    expectation.fromDomain,
    expectation.envelopeDomain,
    expectation.spfInclude,
    expectation.dkimSelector,
    expectation.dkimDomain,
  ])

/** Test seam: forget every answer remembered in this process. */
export function resetSenderReadinessMemoryForTests(): void {
  memory.clear()
}

/**
 * Whether the mail one provider sends as one From domain will be believed —
 * see the module note. Never throws: a lookup that fails is a `null` answer,
 * which the engine reads as unknown.
 */
export async function readSenderReadiness(
  expectation: SenderReadinessExpectation,
  options: { fresh?: boolean } = {},
  deps: SenderReadinessDeps = {},
): Promise<SenderReadiness> {
  const nowMs = deps.nowMs ?? Date.now()
  const key = memoryKey(expectation)
  const remembered = memory.get(key)
  if (!options.fresh && remembered && remembered.checkedAtMs + SENDER_READINESS_MEMORY_MS > nowMs) {
    return remembered
  }

  const lookup = deps.lookupTxt ?? lookupTxt
  const ask = async (host: string): Promise<string[] | null> => {
    try {
      const answer = await lookup(host)
      return answer.answered ? answer.records : null
    } catch {
      return null
    }
  }
  const hosts = senderReadinessHosts(expectation)
  const [spfTxt, dkimTxt, dmarcTxt] = await Promise.all([ask(hosts.spf), ask(hosts.dkim), ask(hosts.dmarc)])
  // The organizational domain's policy matters only to a subdomain that
  // publishes none of its own.
  const ownDmarc = (dmarcTxt ?? []).some((entry) => /^v\s*=\s*DMARC1\b/i.test(String(entry).trim()))
  const organizationalDmarcTxt =
    hosts.organizationalDmarc && dmarcTxt && !ownDmarc ? await ask(hosts.organizationalDmarc) : undefined

  const readiness = assessSenderReadiness(
    expectation,
    { spfTxt, dkimTxt, dmarcTxt, organizationalDmarcTxt },
    nowMs,
  )
  // An answer with an unanswered lookup in it is not kept: the next render
  // should ask again rather than show "unknown" for ten minutes.
  const complete = [readiness.spf, readiness.dkim, readiness.dmarc].every((check) => check.state !== 'unknown')
  if (complete) {
    if (memory.has(key)) memory.delete(key)
    else if (memory.size >= MEMORY_MAX) {
      const oldest = memory.keys().next().value
      if (oldest !== undefined) memory.delete(oldest)
    }
    memory.set(key, readiness)
  }
  return readiness
}
