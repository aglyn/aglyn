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
 * One DNS lookup, pinned to public resolvers, that can say "I do not know".
 *
 * The same shape appeared independently in `/api/domains/verify` (AGL-734) and
 * in `sso-provisioning.ts` (AGL-1210), and a third copy was about to be
 * written for sending domains. It is here once instead.
 *
 * ## Why the resolvers are pinned
 *
 * The runtime's default resolver is not a neutral observer. A stale zone once
 * made the hosting platform's own resolver return NXDOMAIN for records every
 * public resolver could see, which reads as "the customer deleted their
 * record" and is indistinguishable from the real thing. Asking a public
 * resolver first, and falling back to the runtime's only when the pinned ones
 * are unreachable, keeps a genuine "no such record" answer conclusive.
 *
 * ## Why there are three outcomes and not two
 *
 * A boolean cannot tell "the record is gone" from "nobody answered", and the
 * difference decides whether a customer's working configuration gets marked
 * broken during someone else's outage. `NXDOMAIN`/`ENOTFOUND`/`ENODATA` are
 * ANSWERS — that name has no such record — and stay conclusive. Anything else,
 * from both the pinned resolvers and the fallback, is `unreachable`, and a
 * caller must treat it as evidence of nothing in either direction.
 */

import { promises as dns, Resolver as CallbackResolver } from 'dns'

/** Resolvers asked before the runtime's own. */
export const PUBLIC_DNS_RESOLVERS = ['1.1.1.1', '8.8.8.8']

/** Whether a resolver error code is an answer rather than a failure to get one. */
export function isConclusiveDnsCode(code: string | undefined): boolean {
  return code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN'
}

export interface DnsLookupResult<T> {
  /**
   * True when the lookup got an answer, including the answer "there is
   * nothing here". False only when nobody answered.
   */
  answered: boolean
  /** Empty on a conclusive miss and on an unreachable lookup alike. */
  records: T[]
}

/**
 * TXT records at `host`, each joined from its chunks and trimmed.
 *
 * A TXT answer arrives as an array of string CHUNKS per record, because DNS
 * splits strings longer than 255 bytes. Comparing without joining means a long
 * value — every DKIM public key, for instance — can never match.
 */
export async function lookupTxt(host: string): Promise<DnsLookupResult<string>> {
  const flatten = (records: string[][]) =>
    records.map((chunks) => chunks.join('').trim())

  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_DNS_RESOLVERS)
    const records = await new Promise<string[][]>((resolve, reject) => {
      resolver.resolveTxt(host, (error, addresses) =>
        error ? reject(error) : resolve(addresses),
      )
    })
    return { answered: true, records: flatten(records) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (isConclusiveDnsCode(code)) return { answered: true, records: [] }
    try {
      return { answered: true, records: flatten(await dns.resolveTxt(host)) }
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as NodeJS.ErrnoException)?.code
      if (isConclusiveDnsCode(fallbackCode)) return { answered: true, records: [] }
      return { answered: false, records: [] }
    }
  }
}

export interface MxRecord {
  exchange: string
  priority: number
}

/** MX records at `host`, exchanges lowercased and stripped of a trailing dot. */
export async function lookupMx(host: string): Promise<DnsLookupResult<MxRecord>> {
  const normalize = (records: { exchange: string; priority: number }[]) =>
    records.map((entry) => ({
      exchange: String(entry?.exchange ?? '')
        .trim()
        .toLowerCase()
        .replace(/\.$/, ''),
      priority: Number(entry?.priority) || 0,
    }))

  try {
    const resolver = new CallbackResolver()
    resolver.setServers(PUBLIC_DNS_RESOLVERS)
    const records = await new Promise<{ exchange: string; priority: number }[]>(
      (resolve, reject) => {
        resolver.resolveMx(host, (error, addresses) =>
          error ? reject(error) : resolve(addresses),
        )
      },
    )
    return { answered: true, records: normalize(records) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (isConclusiveDnsCode(code)) return { answered: true, records: [] }
    try {
      return { answered: true, records: normalize(await dns.resolveMx(host)) }
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as NodeJS.ErrnoException)?.code
      if (isConclusiveDnsCode(fallbackCode)) return { answered: true, records: [] }
      return { answered: false, records: [] }
    }
  }
}
