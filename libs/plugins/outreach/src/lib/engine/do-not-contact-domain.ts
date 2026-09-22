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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'

/**
 * A DOMAIN ON THE DO-NOT-CONTACT LIST (AGL-3244).
 *
 * A gateway block — Barracuda, Proofpoint, Mimecast refusing the sender
 * outright — is the recipient organization's verdict on the sender, not on
 * one address, so the next person at that company bounces the same way and
 * counts against the same bounce rule. The list therefore holds domains
 * beside addresses, and a domain is spelled one way: what
 * {@link normalizeOutreachDomain} answers, which is also its document id.
 *
 * Client-safe — no hashing — so the Compliance page validates what a member
 * types with the same function the route stores it by.
 */

/** RFC 1035's ceiling on a name, which no real domain reaches. */
export const OUTREACH_DOMAIN_MAX = 253

/** A label: letters, digits and hyphens, not starting or ending on a hyphen. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The domain as the list spells it — lower-cased, a leading `@` or `www.`
 * and any scheme or path dropped — or `null` for anything that is not a
 * domain with at least two labels.
 */
export function normalizeOutreachDomain(value: unknown): string | null {
  let domain = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '')
  // An address typed where a domain was meant: its domain is what was meant.
  if (domain.includes('@')) domain = domain.slice(domain.lastIndexOf('@') + 1)
  if (!domain || domain.length > OUTREACH_DOMAIN_MAX) return null
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null
  // The last label is a top-level domain, which has no digits in it.
  if (/^\d+$/.test(labels[labels.length - 1])) return null
  return domain
}

/** The domain of an address, as the list spells it, or `null` for a value that is not an address. */
export function outreachEmailDomain(email: unknown): string | null {
  const address = normalizeContactEmail(email)
  return address ? normalizeOutreachDomain(address.slice(address.lastIndexOf('@') + 1)) : null
}
