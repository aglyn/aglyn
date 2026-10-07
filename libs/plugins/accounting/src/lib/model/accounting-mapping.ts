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
 * What makes a mapping postable (AGL-3614), checked by the settings route
 * against the ledger's own chart, and by the form as the person chooses.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { isIsoDate, isTimeZone } from './accounting-money'
import {
  ACCOUNTING_ACCOUNT_ROLES,
  ACCOUNTING_SYNC_MODES,
  type AccountingAccountOption,
  type AccountingAccountRole,
  type AccountingMapping,
  type AccountingTaxOption,
} from './accounting.types'

/** The kinds of account each role may name. */
export const ROLE_CLASSIFICATIONS: Readonly<Record<AccountingAccountRole, readonly AccountingAccountOption['classification'][]>> = {
  income: ['income'],
  shippingIncome: ['income'],
  // Both ledgers take a payment only into a bank-type account.
  clearing: ['bank'],
  payoutBank: ['bank'],
  feeExpense: ['expense'],
  taxLiability: ['liability'],
}

/** What each role is called on the form. */
export const ROLE_LABELS: Readonly<Record<AccountingAccountRole, string>> = {
  income: 'Sales income',
  shippingIncome: 'Shipping income',
  clearing: 'Stripe clearing account',
  feeExpense: `${PLATFORM_BRAND_NAME} fee expense`,
  payoutBank: 'Payout bank account',
  taxLiability: 'Sales tax liability',
}

export interface AccountingMappingIssue {
  field: string
  message: string
}

/**
 * Reads a mapping out of a request body and checks it against the ledger's
 * accounts and tax codes. Answers the clean mapping, or the issues.
 */
export function validateAccountingMapping(
  input: unknown,
  options: { accounts: readonly AccountingAccountOption[]; taxCodes: readonly AccountingTaxOption[]; today: string },
): { ok: true; mapping: AccountingMapping } | { ok: false; issues: AccountingMappingIssue[] } {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const issues: AccountingMappingIssue[] = []
  const byId = new Map(options.accounts.map((account) => [account.id, account]))
  const accounts: Partial<Record<AccountingAccountRole, string>> = {}
  const rawAccounts = (raw['accounts'] && typeof raw['accounts'] === 'object' ? raw['accounts'] : {}) as Record<string, unknown>
  for (const role of ACCOUNTING_ACCOUNT_ROLES) {
    const id = typeof rawAccounts[role] === 'string' ? (rawAccounts[role] as string).trim() : ''
    if (!id) continue
    const account = byId.get(id)
    if (!account) {
      issues.push({ field: `accounts.${role}`, message: `${ROLE_LABELS[role]}: that account is not in your chart of accounts.` })
      continue
    }
    if (!ROLE_CLASSIFICATIONS[role].includes(account.classification)) {
      issues.push({
        field: `accounts.${role}`,
        message: `${ROLE_LABELS[role]}: choose ${role === 'clearing' || role === 'payoutBank' ? 'a bank' : `an ${ROLE_CLASSIFICATIONS[role][0]}`} account.`,
      })
      continue
    }
    accounts[role] = id
  }
  if (accounts.clearing && accounts.clearing === accounts.payoutBank) {
    issues.push({
      field: 'accounts.payoutBank',
      message: 'The payout bank account must differ from the Stripe clearing account, or payouts would move money to itself.',
    })
  }

  const taxIds = new Set(options.taxCodes.map((code) => code.id))
  const taxCodes: Record<string, string> = {}
  const rawTax = (raw['taxCodes'] && typeof raw['taxCodes'] === 'object' ? raw['taxCodes'] : {}) as Record<string, unknown>
  for (const [key, value] of Object.entries(rawTax).slice(0, 60)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || typeof value !== 'string' || !value) continue
    if (!taxIds.has(value)) {
      issues.push({ field: `taxCodes.${key}`, message: 'That tax code is not in your ledger.' })
      continue
    }
    taxCodes[key] = value
  }

  const syncMode = (ACCOUNTING_SYNC_MODES as readonly unknown[]).includes(raw['syncMode'])
    ? (raw['syncMode'] as AccountingMapping['syncMode'])
    : 'per-order'
  let startDate: string | null = null
  if (raw['startDate'] !== null && raw['startDate'] !== undefined && raw['startDate'] !== '') {
    if (!isIsoDate(raw['startDate'])) issues.push({ field: 'startDate', message: 'Enter the start date as a date.' })
    else if (raw['startDate'] > options.today) issues.push({ field: 'startDate', message: 'The start date cannot be in the future.' })
    else startDate = raw['startDate']
  }
  const timeZone = isTimeZone(raw['timeZone']) ? raw['timeZone'] : 'UTC'

  if (issues.length) return { ok: false, issues }
  return { ok: true, mapping: { accounts, taxCodes, syncMode, startDate, timeZone } }
}
