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

import { companyDomainForEmail } from '@aglyn/aglyn'

/** What the convert dialog should propose for the company step. */
export type CompanySuggestion =
  /** A public mailbox or a malformed address implies no company. */
  | { mode: 'none' }
  /** The org already has a company at this domain the caller can see. */
  | { mode: 'existing'; companyId: string }
  /** No company at this domain yet — propose creating one. */
  | { mode: 'new'; name: string; domain: string }

/**
 * The company a lead's address implies, matched against the companies the
 * caller can already see (AGL-2608).
 *
 * The email domain is the one fact about a company a capture carries, and
 * `companyDomainForEmail` already refuses the public mailboxes, so a lead at
 * `gmail.com` proposes nothing rather than a phantom account. A match on a
 * loaded company wins over creating one: two contacts at one business should
 * land under one company, and the dialog's job is to make that the default
 * click rather than a lookup the converter has to remember to do.
 *
 * The proposed name is the domain's first label with a capital — `acme.com`
 * → `Acme` — which is a starting point the converter edits, not a claim
 * about what the business is called.
 */
export function suggestCompanyForLead(
  email: unknown,
  companies: ReadonlyArray<{ $id: string; domain?: unknown }>,
): CompanySuggestion {
  const domain = companyDomainForEmail(email)
  if (!domain) return { mode: 'none' }
  const existing = companies.find(
    (company) => String(company.domain ?? '').toLowerCase() === domain,
  )
  if (existing) return { mode: 'existing', companyId: existing.$id }
  const label = domain.split('.')[0] ?? domain
  return {
    mode: 'new',
    name: label.charAt(0).toUpperCase() + label.slice(1),
    domain,
  }
}

/**
 * A typed dollar amount as cents, `null` for an empty field, and `undefined`
 * for something that is not an amount — the three answers a form has to tell
 * apart: nothing entered, a number entered, and a mistake to point at.
 */
export function dollarsToCents(input: string): number | null | undefined {
  const cleaned = input.replace(/[,$\s]/g, '')
  if (!cleaned) return null
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars < 0) return undefined
  return Math.round(dollars * 100)
}
