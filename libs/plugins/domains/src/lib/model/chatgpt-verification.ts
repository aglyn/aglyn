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

import type { DnsRecordInput, DnsRecordView } from './dns-records'

/*
 * VERIFY WITH CHATGPT. ChatGPT lists businesses, and a business owner claims
 * theirs by proving they control its website's domain: ChatGPT hands them one
 * TXT record to add, and looks it up.
 *
 * For a name whose DNS is kept here, the owner pastes what ChatGPT showed and
 * the record is added for them. This module reads the paste and says which
 * record that is. Pure, so the form and its spec agree.
 */

/** The name ChatGPT asks for the record under, before the domain. */
export const CHATGPT_CLAIM_RECORD_NAME = 'openai-business-claim'

const PREFIX = `${CHATGPT_CLAIM_RECORD_NAME}=`
const CODE = /^[A-Za-z0-9_-]{16,128}$/

/**
 * The record's value from what was pasted: the whole value as ChatGPT shows
 * it, with or without quotes around it, or the code after the `=` alone.
 * `null` for anything that is not one of ChatGPT's values.
 */
export function chatgptClaimValue(pasted: unknown): string | null {
  if (typeof pasted !== 'string') return null
  const trimmed = pasted.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  const code = trimmed.toLowerCase().startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed
  return CODE.test(code) ? `${PREFIX}${code}` : null
}

/** What the field says about a paste it cannot use; `null` when it can. */
export function chatgptClaimValueError(pasted: unknown): string | null {
  if (typeof pasted !== 'string' || !pasted.trim()) return 'Paste the value ChatGPT shows.'
  return chatgptClaimValue(pasted)
    ? null
    : `That doesn’t look like ChatGPT’s value. It starts with ${PREFIX}`
}

/** The record to write for a value `chatgptClaimValue` returned. */
export function chatgptClaimRecord(value: string): DnsRecordInput {
  return { type: 'TXT', name: CHATGPT_CLAIM_RECORD_NAME, value, ttl: 60 }
}

/** The name's ChatGPT record among its listed records, if it has one. */
export function findChatgptClaimRecord(records: readonly DnsRecordView[]): DnsRecordView | null {
  return (
    records.find(
      (record) => record.type === 'TXT' && record.name.toLowerCase() === CHATGPT_CLAIM_RECORD_NAME,
    ) ?? null
  )
}

/**
 * The domain a site's ChatGPT record goes on: the site's own domain without a
 * leading `www.`, because ChatGPT asks for the record on the domain itself.
 * `null` for a site with no domain.
 */
export function siteDomainForChatgpt(connectedDomain: string | null | undefined): string | null {
  const domain = String(connectedDomain ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!domain) return null
  return domain.startsWith('www.') ? domain.slice(4) : domain
}
