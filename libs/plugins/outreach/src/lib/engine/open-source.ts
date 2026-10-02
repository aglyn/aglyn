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

import { outreachIpBlock, outreachIpInBlocks, type OutreachIpBlock } from './ip-range'

/*==========================================
 * WHOSE NETWORK A FETCH OF THE TRACKING IMAGE CAME FROM (AGL-3488).
 *
 * A coarse hint, read from the fetch's address and stored on the open's
 * history row in place of the address itself: the address of a person
 * reading at home is theirs, and the only thing the judgement needs from it
 * is whether it is one of the few networks that fetch mail images on a
 * provider's behalf.
 *
 * The blocks are the published ones, collapsed to their aggregates and
 * checked on 2026-10-02:
 *
 * - **Google** — Google's own space from `gstatic.com/ipranges/goog.json`,
 *   none of it Google Cloud customer space (`cloud.json`): Gmail's image
 *   proxy and Google's mail scanning fetch from here, a stranger's VM on
 *   GCP does not.
 * - **Microsoft's mail filter** — Exchange Online Protection
 *   (`*.protection.outlook.com`, `*.mail.protection.outlook.com`) from the
 *   Microsoft 365 endpoints service: the filter every Microsoft 365 message
 *   passes through, and nothing a person reads mail on.
 * - **Microsoft** — the rest of Exchange Online (`outlook.office.com`,
 *   `outlook.office365.com`). Outlook on the web loads a message's images
 *   through Microsoft's servers when the reader opens it, so this is not a
 *   scanner by itself.
 * - **Apple** — `17.0.0.0/8`, and the relay egress Apple publishes in
 *   `mask-api.icloud.com/egress-ip-ranges.csv`, through which Mail Privacy
 *   Protection fetches: the Akamai, Cloudflare and Fastly blocks it
 *   collapses to.
 * - **Yahoo** — the ranges its mail proxy page lists
 *   (`senders.yahooinc.com/mail-proxy-servers`).
 *
 * A range that moves later costs a hint, never an image: every fetch is
 * answered the same either way.
 *==========================================*/

/** The networks a fetch is told apart by; `other` is every address that is none of them. */
export type OutreachOpenSource = 'google' | 'microsoft_filter' | 'microsoft' | 'apple' | 'yahoo' | 'other'

export const OUTREACH_OPEN_SOURCES: readonly OutreachOpenSource[] = [
  'google',
  'microsoft_filter',
  'microsoft',
  'apple',
  'yahoo',
  'other',
]

const blocks = (cidrs: readonly string[]): OutreachIpBlock[] => cidrs.map(outreachIpBlock)

const GOOGLE = blocks([
  '64.233.160.0/19',
  '66.102.0.0/20',
  '66.249.64.0/19',
  '72.14.192.0/18',
  '74.125.0.0/16',
  '108.170.192.0/18',
  '108.177.0.0/17',
  '142.250.0.0/15',
  '172.217.0.0/16',
  '172.253.0.0/16',
  '173.194.0.0/16',
  '209.85.128.0/17',
  '216.58.192.0/19',
  '216.239.32.0/19',
  '2001:4860::/32',
  '2404:6800::/32',
  '2a00:1450::/32',
])

const MICROSOFT_FILTER = blocks([
  '40.92.0.0/15',
  '40.107.0.0/16',
  '52.100.0.0/14',
  '104.47.0.0/17',
  '2a01:111:f400::/48',
  '2a01:111:f403::/48',
])

const MICROSOFT = blocks([
  '13.107.128.0/22',
  '23.103.160.0/20',
  '40.96.0.0/13',
  '40.104.0.0/15',
  '52.96.0.0/14',
  '132.245.0.0/16',
  '150.171.32.0/22',
  '2603:1000::/24',
  '2620:1ec:8f0::/46',
  '2620:1ec:900::/46',
])

const APPLE = blocks([
  '17.0.0.0/8',
  '104.28.0.0/16',
  '140.248.0.0/16',
  '146.75.0.0/16',
  '172.224.0.0/15',
  '172.226.0.0/16',
  '2606:54c0::/32',
  '2606:54c3::/32',
  '2a02:26f7::/32',
  '2a04:4e41::/32',
  '2a09:bac2::/31',
])

const YAHOO = blocks([
  '27.123.32.0/19',
  '67.195.0.0/16',
  '69.147.64.0/18',
  '87.248.96.0/19',
  '98.138.0.0/15',
  '106.10.128.0/17',
  '115.178.0.0/20',
  '119.161.0.0/19',
  '200.152.160.0/20',
  '202.43.192.0/19',
  '209.73.160.0/19',
  '212.82.96.0/19',
  '216.115.96.0/20',
  '2001:4998::/32',
  '2406:2000::/32',
  '2406:6e00::/32',
  '2804:1bc::/32',
  '2a00:1288::/32',
])

/** Checked in this order; the filter before the rest of Microsoft, which does not contain it. */
const SOURCES: ReadonlyArray<[OutreachOpenSource, readonly OutreachIpBlock[]]> = [
  ['google', GOOGLE],
  ['microsoft_filter', MICROSOFT_FILTER],
  ['microsoft', MICROSOFT],
  ['apple', APPLE],
  ['yahoo', YAHOO],
]

/**
 * The network a fetch came from, or `null` when no address could be read —
 * which is "unknown", a different answer from `other`.
 */
export function outreachOpenSourceOf(address: string | null | undefined): OutreachOpenSource | null {
  const text = String(address ?? '').trim()
  if (!text) return null
  for (const [source, ranges] of SOURCES) if (outreachIpInBlocks(text, ranges)) return source
  return 'other'
}
