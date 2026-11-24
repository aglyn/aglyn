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
 * The two warnings that keep one website build from being billed twice
 * (AGL-4244). A warning, never a refusal: the other charge may be for
 * different work.
 *
 * - Beside a build fee on the Hand off dialog, Ask to upgrade and the bundle
 *   link card, when the workspace has an un-invoiced Charge for work quote.
 * - On a Charge for work project's Send invoice, when the proposal or a
 *   bundle link already carries a build fee, paid or not.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

const mockCall = jest.fn()
jest.mock('./site-care/site-care-api', () => ({
  __esModule: true,
  useSiteCareCall: () => mockCall,
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: (props: { header: string; HeaderProps?: { action?: ReactNode }; children: ReactNode }) => (
    <section aria-label={props.header}>
      <div>{props.HeaderProps?.action}</div>
      {props.children}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('../constants/docs-links', () => ({ __esModule: true, docsHelp: () => null }))
jest.mock('./site-care/site-care-history-list.component', () => ({ __esModule: true, default: () => null }))
jest.mock('@aglyn/tenant-feature-instance', () => ({ useUser: () => ({ data: null }) }))

import { StaffBuildFeeFields } from './staff-build-fee-fields.component'
import { DEFAULT_BUNDLE_DRAFT, type BundleDraft } from './staff-bundle-fields.component'
import StaffSiteCareProjectsCard from './site-care/staff-site-care-projects-card.component'

const OPEN_QUOTE = { title: 'New e-commerce website build', status: 'quoted', quote: { priceUsd: 350 } }

function Fields(props: { initial: BundleDraft; projects: unknown[]; subscriptionLive?: boolean }) {
  const [draft, setDraft] = useState(props.initial)
  return (
    <StaffBuildFeeFields
      orgId="org-1"
      draft={draft}
      onChange={setDraft}
      projects={props.projects as never}
      subscriptionLive={props.subscriptionLive}
    />
  )
}

describe('a build fee beside an open Charge for work quote', () => {
  it('warns, naming the quote and its price, and still shows what the owner sees', () => {
    render(
      <Fields
        initial={{ ...DEFAULT_BUNDLE_DRAFT, buildFee: { amount: '350', label: '' } }}
        projects={[OPEN_QUOTE]}
      />,
    )
    expect(
      screen.getByText(
        'This workspace has an open Charge for work quote, New e-commerce website build $350 (quoted). ' +
          'If it is the same build, withdraw it so the client is not billed twice.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('What the owner sees')).toBeTruthy()
    expect(screen.getByText('Starter with Site Care, billed yearly')).toBeTruthy()
    expect(screen.getByText('Website build, $350 one time')).toBeTruthy()
  })

  it('says nothing while no fee is entered, or when the quote is already invoiced', () => {
    const { unmount } = render(<Fields initial={DEFAULT_BUNDLE_DRAFT} projects={[OPEN_QUOTE]} />)
    expect(screen.queryByText(/open Charge for work quote/)).toBeNull()
    unmount()
    render(
      <Fields
        initial={{ ...DEFAULT_BUNDLE_DRAFT, buildFee: { amount: '350', label: '' } }}
        projects={[{ ...OPEN_QUOTE, status: 'invoiced' }]}
      />,
    )
    expect(screen.queryByText(/open Charge for work quote/)).toBeNull()
  })

  it('starts empty and is turned off, with why, for a workspace that already pays', () => {
    render(<Fields initial={DEFAULT_BUNDLE_DRAFT} projects={[]} subscriptionLive />)
    expect(screen.getByText('This workspace already pays; bill the build with Charge for work.')).toBeTruthy()
    const amount = screen.getByLabelText('Website build fee amount') as HTMLInputElement
    expect(amount.value).toBe('')
    expect(amount.disabled).toBe(true)
  })

  it('says what is wrong with an amount outside $1 to $50,000', () => {
    render(
      <Fields initial={{ ...DEFAULT_BUNDLE_DRAFT, buildFee: { amount: '75000', label: '' } }} projects={[]} />,
    )
    expect(screen.getByText('The build fee must be between $1 and $50,000')).toBeTruthy()
  })
})

describe('a Charge for work invoice when the plan already carries a build fee', () => {
  const project = {
    orgId: 'org-1',
    title: 'New e-commerce website build',
    scope: ['Store setup'],
    quote: {
      kind: 'other',
      estimatedHours: 4,
      billedHours: 4,
      rateUsd: 79,
      floorUsd: 0,
      computedUsd: 316,
      priceUsd: 350,
      split: 'full',
    },
    quoteVersion: 1,
    acceptance: {
      quoteVersion: 1,
      priceUsd: 350,
      hours: 4,
      rateUsd: 79,
      channel: 'in-person',
      approvedAtMs: 1,
      recordedAtMs: 1,
      recordedByUid: 'staff',
      recordedByEmail: null,
      note: null,
      version: 1,
      corrected: false,
      correctionReason: null,
    },
    invoices: [],
    invoiceSeq: 0,
    firstInvoiceSentAtMs: null,
    launchedAtMs: null,
    launchedByUid: null,
    status: 'accepted',
    createdAtMs: 1,
    createdByUid: 'staff',
    createdByEmail: null,
    updatedAtMs: 1,
  }

  const serve = (buildFees: unknown[]) =>
    mockCall.mockResolvedValue({
      ok: true,
      status: 200,
      body: { projects: [{ projectId: 'p-1', project, history: [] }], canInvoice: true, buildFees },
    })

  beforeEach(() => mockCall.mockReset())

  it('warns before Send invoice, naming the fee and whether it was paid', async () => {
    serve([{ source: 'bundle-link', amountCents: 35000, label: 'Website build', paid: true }])
    render(<StaffSiteCareProjectsCard orgId="org-1" />)
    await screen.findByText(/^Send invoice/)
    expect(
      screen.getByText(
        'This workspace already has a build fee: Website build $350 on the bundle link, already paid. ' +
          'If this invoice is for the same build, do not send it, so the client is not billed twice.',
      ),
    ).toBeTruthy()
    // A warning, not a refusal: the button stays.
    expect((screen.getByText(/^Send invoice/).closest('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('says nothing when no proposal or link carries a fee', async () => {
    serve([])
    render(<StaffSiteCareProjectsCard orgId="org-1" />)
    await screen.findByText(/^Send invoice/)
    await waitFor(() => expect(screen.queryByText(/already has a build fee/)).toBeNull())
  })
})
