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
 * SITE CARE PROJECTS: THE ARITHMETIC (AGL-3970). The quote is hours × the
 * rate rounded up to the whole hour, never below the kind's starting price,
 * and only ever rounded up by staff; above the split line it bills half and
 * half; nothing invoices without the owner's yes to the quote as it stands.
 */

import {
  SITE_CARE_EXTRA_HOUR_USD,
  SITE_CARE_PROJECT_BRAND_KIT_FROM_USD,
  SITE_CARE_PROJECT_LANDING_PAGE_FROM_USD,
  SITE_CARE_PROJECT_REDESIGN_FROM_USD,
  SITE_CARE_PROJECT_SPLIT_ABOVE_USD,
} from './plan-entitlements'
import {
  readSiteCareProject,
  readSiteCareProjectScope,
  readSiteCareProjectTitle,
  siteCareProjectAcceptanceSentence,
  siteCareProjectBilledHours,
  siteCareProjectInvoiceDescription,
  siteCareProjectInvoiceLine,
  siteCareProjectInvoicePlan,
  siteCareProjectNextInvoice,
  siteCareProjectQuote,
  siteCareProjectQuoteIsEditable,
  siteCareProjectSplit,
  siteCareProjectSplitSentence,
  siteCareProjectStatus,
  type SiteCareProject,
  type SiteCareProjectAcceptance,
  type SiteCareProjectInvoice,
  type SiteCareProjectQuote,
} from './site-care-project'

function quoteOf(input: Parameters<typeof siteCareProjectQuote>[0]): SiteCareProjectQuote {
  const result = siteCareProjectQuote(input)
  if (result.ok === false) throw new Error(result.error)
  return result.quote
}

function invoice(partial: Partial<SiteCareProjectInvoice>): SiteCareProjectInvoice {
  return {
    seq: 1,
    kind: 'full',
    status: 'open',
    amountCents: 24900,
    description: '',
    idempotencyKey: 'k',
    invoiceId: 'in_1',
    invoiceItemId: 'ii_1',
    number: null,
    hostedInvoiceUrl: 'https://pay',
    totalCents: 0,
    amountPaidCents: 0,
    creditNoteId: null,
    refundId: null,
    error: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    paidAtMs: null,
    ...partial,
  }
}

function project(partial: Partial<SiteCareProject> = {}): SiteCareProject {
  const quote = partial.quote ?? quoteOf({ kind: 'landingPage', estimatedHours: 2 })
  return {
    orgId: 'org-1',
    title: 'Holiday page',
    scope: ['A landing page'],
    quote,
    quoteVersion: 1,
    acceptance: null,
    invoices: [],
    invoiceSeq: 0,
    firstInvoiceSentAtMs: null,
    launchedAtMs: null,
    launchedByUid: null,
    status: 'quoted',
    createdAtMs: 1,
    createdByUid: 'staff',
    createdByEmail: null,
    updatedAtMs: 1,
    ...partial,
  }
}

const YES: SiteCareProjectAcceptance = {
  hours: 4,
  rateUsd: SITE_CARE_EXTRA_HOUR_USD,
  channel: 'in-person',
  approvedAtMs: Date.UTC(2026, 9, 19, 19, 10),
  recordedAtMs: 0,
  recordedByUid: 'staff',
  recordedByEmail: null,
  note: null,
  version: 1,
  corrected: false,
  correctionReason: null,
  quoteVersion: 1,
  priceUsd: 249,
}

describe('siteCareProjectQuote', () => {
  it('rounds the estimate up to the whole hour', () => {
    expect(siteCareProjectBilledHours(2.25)).toBe(3)
    expect(siteCareProjectBilledHours(3)).toBe(3)
    expect(siteCareProjectBilledHours(3.0000000001)).toBe(3)
    expect(siteCareProjectBilledHours(0.1)).toBe(1)
    expect(quoteOf({ kind: 'other', estimatedHours: 2.5 }).priceUsd).toBe(3 * SITE_CARE_EXTRA_HOUR_USD)
  })

  it('never quotes below the kind’s published starting price', () => {
    expect(quoteOf({ kind: 'landingPage', estimatedHours: 1 }).priceUsd).toBe(SITE_CARE_PROJECT_LANDING_PAGE_FROM_USD)
    expect(quoteOf({ kind: 'redesign', estimatedHours: 2 }).priceUsd).toBe(SITE_CARE_PROJECT_REDESIGN_FROM_USD)
    expect(quoteOf({ kind: 'brandKit', estimatedHours: 2 }).priceUsd).toBe(SITE_CARE_PROJECT_BRAND_KIT_FROM_USD)
    // Past the floor, the hours decide.
    expect(quoteOf({ kind: 'landingPage', estimatedHours: 7.5 }).priceUsd).toBe(8 * SITE_CARE_EXTRA_HOUR_USD)
  })

  it('takes a higher price and refuses a lower one', () => {
    expect(quoteOf({ kind: 'landingPage', estimatedHours: 1, priceUsd: 300 }).priceUsd).toBe(300)
    const lower = siteCareProjectQuote({ kind: 'landingPage', estimatedHours: 1, priceUsd: 200 })
    expect(lower.ok).toBe(false)
    expect(lower.ok === false && lower.error).toMatch(/only be rounded up/)
    expect(siteCareProjectQuote({ kind: 'landingPage', estimatedHours: 1, priceUsd: 250.5 }).ok).toBe(false)
    // Blank means the computed price.
    expect(quoteOf({ kind: 'landingPage', estimatedHours: 1, priceUsd: '' }).priceUsd).toBe(249)
  })

  it('refuses an unreadable kind or estimate', () => {
    expect(siteCareProjectQuote({ kind: 'mystery', estimatedHours: 1 }).ok).toBe(false)
    expect(siteCareProjectQuote({ kind: 'other', estimatedHours: 0 }).ok).toBe(false)
    expect(siteCareProjectQuote({ kind: 'other', estimatedHours: 'two' }).ok).toBe(false)
    expect(siteCareProjectQuote({ kind: 'other', estimatedHours: 401 }).ok).toBe(false)
  })
})

describe('the split', () => {
  it('bills above the line half and half, at or below it in full', () => {
    expect(siteCareProjectSplit(SITE_CARE_PROJECT_SPLIT_ABOVE_USD)).toBe('full')
    expect(siteCareProjectSplit(SITE_CARE_PROJECT_SPLIT_ABOVE_USD + 1)).toBe('half')
    expect(quoteOf({ kind: 'redesign', estimatedHours: 1 }).split).toBe('half')
    expect(quoteOf({ kind: 'landingPage', estimatedHours: 1 }).split).toBe('full')
  })

  it('plans the invoices, the halves adding to the price', () => {
    expect(siteCareProjectInvoicePlan({ priceUsd: 249, split: 'full' })).toEqual([{ kind: 'full', amountCents: 24900 }])
    expect(siteCareProjectInvoicePlan({ priceUsd: 749, split: 'half' })).toEqual([
      { kind: 'deposit', amountCents: 37450 },
      { kind: 'final', amountCents: 37450 },
    ])
  })

  it('says how it is billed', () => {
    expect(siteCareProjectSplitSentence({ priceUsd: 249, split: 'full' })).toBe('$249, paid in full before work starts.')
    expect(siteCareProjectSplitSentence({ priceUsd: 749, split: 'half' })).toBe(
      '$749: half ($374.50) before work starts and half ($374.50) at launch.',
    )
  })
})

describe('scope and title', () => {
  it('reads one deliverable per line, bullets stripped, blanks dropped', () => {
    const scope = readSiteCareProjectScope('- A landing page\n\n* A sign-up form\n2. Photos')
    expect(scope).toEqual({ ok: true, scope: ['A landing page', 'A sign-up form', 'Photos'] })
    expect(readSiteCareProjectScope(['  one  ', '']).ok).toBe(true)
    expect(readSiteCareProjectScope('  \n ').ok).toBe(false)
    expect(readSiteCareProjectTitle('  Holiday   page ')).toEqual({ ok: true, title: 'Holiday page' })
    expect(readSiteCareProjectTitle('').ok).toBe(false)
  })
})

describe('where a project stands', () => {
  it('walks quoted → accepted → invoiced → paid in full', () => {
    expect(siteCareProjectStatus(project())).toBe('quoted')
    expect(siteCareProjectStatus(project({ acceptance: YES }))).toBe('accepted')
    expect(siteCareProjectStatus(project({ acceptance: YES, invoices: [invoice({})] }))).toBe('invoiced')
    expect(siteCareProjectStatus(project({ acceptance: YES, invoices: [invoice({ status: 'paid' })] }))).toBe('paid')
  })

  it('walks quoted → deposit paid → launched → paid half and half', () => {
    const quote = quoteOf({ kind: 'redesign', estimatedHours: 1 })
    const deposit = invoice({ kind: 'deposit', status: 'paid', amountCents: 37450 })
    expect(siteCareProjectStatus(project({ quote, acceptance: YES, invoices: [{ ...deposit, status: 'open' }] }))).toBe('invoiced')
    expect(siteCareProjectStatus(project({ quote, acceptance: YES, invoices: [deposit] }))).toBe('deposit-paid')
    const final = invoice({ seq: 2, kind: 'final', status: 'open', invoiceId: 'in_2' })
    expect(siteCareProjectStatus(project({ quote, acceptance: YES, invoices: [deposit, final], launchedAtMs: 5 }))).toBe('launched')
    expect(
      siteCareProjectStatus(project({ quote, acceptance: YES, invoices: [deposit, { ...final, status: 'paid' }], launchedAtMs: 5 })),
    ).toBe('paid')
  })

  it('goes back to accepted when the only invoice was voided', () => {
    expect(siteCareProjectStatus(project({ acceptance: YES, invoices: [invoice({ status: 'voided' })] }))).toBe('accepted')
  })

  it('reads a stale yes as no yes', () => {
    expect(siteCareProjectStatus(project({ acceptance: YES, quoteVersion: 2 }))).toBe('quoted')
  })
})

describe('what may be invoiced next', () => {
  it('needs the owner’s yes to the quote as it stands', () => {
    const none = siteCareProjectNextInvoice(project())
    expect(none.ok === false && none.error).toMatch(/Record how and when/)
    const stale = siteCareProjectNextInvoice(project({ acceptance: YES, quoteVersion: 2 }))
    expect(stale.ok === false && stale.error).toMatch(/quote changed/)
    expect(siteCareProjectNextInvoice(project({ acceptance: YES }))).toEqual({ ok: true, kind: 'full', amountCents: 24900 })
  })

  it('raises the balance only after the deposit is paid and the launch is marked', () => {
    const quote = quoteOf({ kind: 'redesign', estimatedHours: 1 })
    const base = { quote, acceptance: YES }
    expect(siteCareProjectNextInvoice(project(base))).toEqual({ ok: true, kind: 'deposit', amountCents: 37450 })
    const open = invoice({ kind: 'deposit', status: 'open', amountCents: 37450 })
    expect(siteCareProjectNextInvoice(project({ ...base, invoices: [open] })).ok).toBe(false)
    const paid = { ...open, status: 'paid' as const }
    const unlaunched = siteCareProjectNextInvoice(project({ ...base, invoices: [paid] }))
    expect(unlaunched.ok === false && unlaunched.error).toMatch(/marked launched/)
    expect(siteCareProjectNextInvoice(project({ ...base, invoices: [paid], launchedAtMs: 9 }))).toEqual({
      ok: true,
      kind: 'final',
      amountCents: 37450,
    })
  })

  it('refuses a second invoice while one is in flight, and re-raises after a void', () => {
    expect(siteCareProjectNextInvoice(project({ acceptance: YES, invoices: [invoice({ status: 'failed' })] })).ok).toBe(false)
    expect(siteCareProjectNextInvoice(project({ acceptance: YES, invoices: [invoice({ status: 'voided' })] })).ok).toBe(true)
    expect(siteCareProjectNextInvoice(project({ acceptance: YES, invoices: [invoice({ status: 'paid' })] })).ok).toBe(false)
  })
})

describe('the quote lock', () => {
  it('is editable until the first invoice reaches the owner', () => {
    expect(siteCareProjectQuoteIsEditable(project())).toBe(true)
    expect(siteCareProjectQuoteIsEditable(project({ invoices: [invoice({ status: 'failed', invoiceId: null })] }))).toBe(true)
    expect(siteCareProjectQuoteIsEditable(project({ invoices: [invoice({ status: 'creating', invoiceId: null })] }))).toBe(false)
    expect(siteCareProjectQuoteIsEditable(project({ firstInvoiceSentAtMs: 5 }))).toBe(false)
  })
})

describe('the owner’s words', () => {
  it('describes the line, the yes and each invoice', () => {
    const quote = quoteOf({ kind: 'redesign', estimatedHours: 1 })
    expect(siteCareProjectInvoiceDescription({ title: 'New site', quote }, 'deposit')).toBe(
      'New site: deposit, half of the $749 quote',
    )
    expect(siteCareProjectAcceptanceSentence(YES, { title: 'New site', quote }, () => 'Oct 19')).toBe(
      'You accepted our quote for “New site”: $749: half ($374.50) before work starts and half ($374.50) at launch. You said yes in person on Oct 19.',
    )
    expect(siteCareProjectInvoiceLine(invoice({ kind: 'deposit', amountCents: 37450, status: 'paid' }))).toBe('Deposit $374.50: paid')
    expect(siteCareProjectInvoiceLine(invoice({ status: 'voided' }))).toBe('Invoice $249: canceled, nothing is owed')
  })

  it('reads a stored project back, its status recomputed', () => {
    const stored = { ...project({ acceptance: YES, invoices: [invoice({ status: 'paid' })] }), status: 'quoted' }
    const read = readSiteCareProject(JSON.parse(JSON.stringify(stored)))
    expect(read?.status).toBe('paid')
    expect(read?.acceptance?.quoteVersion).toBe(1)
    expect(readSiteCareProject({ title: 'no quote' })).toBeNull()
  })
})
