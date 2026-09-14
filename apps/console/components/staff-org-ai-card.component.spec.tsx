/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * The staff AI card (AGL-2930), mounted.
 *
 * The figures are the route's and are tested there. What only the card can
 * get wrong is what it SAYS about them: which part of the pool is named,
 * whether the add-on reads as on or off, what the overage's state is called,
 * and — the two that matter most — that an org with no jobs and no per-user
 * rollup reads as exactly that, never as a failed read and never as blank.
 * The first assertion is that the card is MOUNTED, read off the page source,
 * because a card nobody renders is a capability with an extra file in it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { StaffOrgAiResponse } from '../utils/staff-org-ai'

jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  aiAddonName: () => 'Acme AI',
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: { header?: ReactNode; children?: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
}))

let mockAnswer: { ok: boolean; status: number; payload: unknown }
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: async () => ({
    ok: mockAnswer.ok,
    status: mockAnswer.status,
    json: async () => mockAnswer.payload,
  }),
}))

import StaffOrgAiCard from './staff-org-ai-card.component'

function body(overrides: Partial<StaffOrgAiResponse> = {}): StaffOrgAiResponse {
  return {
    month: '2026-09',
    addon: { on: true, priceUsd: 19, since: '2026-09-02T10:00:00.000Z', sinceSource: 'stripe' },
    pool: {
      planCredits: 4_000,
      overrideCredits: 12_000,
      addonCredits: 9_000,
      totalCredits: 21_000,
      usedCredits: 2_500,
      providerUsd: 2.5,
      remainingCredits: 18_500,
      projectedCredits: 7_500,
      projectedUsd: 7.5,
      messages: 40,
      deflected: 7,
    },
    overage: {
      overageCredits: 0,
      rateUsdPer1k: 3,
      accruedUsd: 0,
      sellsOverage: true,
      hardCap: false,
      capUsd: null,
      capReached: false,
      bandRefuses: false,
    },
    refusals: { band: 0, cap: 12, messages: 0, budget: 0, total: 12 },
    jobs: {
      counts: { queued: 1, running: 0, needs_input: 0, done: 3, failed: 0, canceled: 0 },
      recent: [
        {
          id: 'job-9',
          kind: 'screen',
          status: 'queued',
          creditsReserved: 400,
          creditsSpent: 0,
          createdAt: '2026-09-10T12:00:00.000Z',
          createdBy: 'user-a',
        },
      ],
      truncated: false,
    },
    users: [{ uid: 'user-a', credits: 1_800, providerUsd: 1.8, requests: 30 }],
    margin: {
      addonRevenueUsd: 19,
      planAssistShareUsd: 12,
      overageRevenueUsd: 0,
      revenueUsd: 31,
      spendUsd: 2.5,
      underwater: false,
      thresholdUsd: 25,
      multiple: 0,
      contribution: { month: null, marginPct: null, rating: null },
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockAnswer = { ok: true, status: 200, payload: body() }
})

describe('StaffOrgAiCard (AGL-2930)', () => {
  it('is mounted on the staff org page between entitlements and metered usage', () => {
    const source = readFileSync(
      join(__dirname, '../app/(app)/admin/orgs/[orgId]/page.tsx'),
      'utf8',
    )
    const entitlements = source.indexOf("header={'Effective entitlements'}")
    const card = source.indexOf('<StaffOrgAiCard orgId={orgId} />')
    const usage = source.indexOf("header={'Metered usage'}")
    expect(entitlements).toBeGreaterThan(0)
    expect(card).toBeGreaterThan(entitlements)
    expect(usage).toBeGreaterThan(card)
  })

  it('names the add-on as on, at its price, since its Stripe date', async () => {
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('Acme AI on')).toBeTruthy())
    expect(screen.getByText('$19.00/mo on this plan')).toBeTruthy()
    expect(screen.getByText(/^since /)).toBeTruthy()
  })

  it('names the pool’s parts — a staff override in place of the plan band, plus the add-on', async () => {
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(
        screen.getByText('21,000 credits = 12,000 staff override + 9,000 Acme AI add-on'),
      ).toBeTruthy(),
    )
    expect(screen.getByText(/Used 2,500 credits \(\$2\.50 provider spend\) · 18,500 remaining/)).toBeTruthy()
  })

  it('reads as off, with the plan band alone, when the add-on is not bought', async () => {
    mockAnswer.payload = body({
      addon: { on: false, priceUsd: 19, since: null, sinceSource: 'no-subscription' },
      pool: { ...body().pool, overrideCredits: null, addonCredits: 0, totalCredits: 4_000, remainingCredits: 1_500 },
    })
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('Acme AI off')).toBeTruthy())
    expect(screen.getByText('4,000 credits = 4,000 plan band')).toBeTruthy()
    expect(screen.queryByText(/^since /)).toBeNull()
  })

  it('says which of the org’s own controls stopped the overage', async () => {
    mockAnswer.payload = body({
      overage: { ...body().overage, overageCredits: 900, accruedUsd: 2.7, capUsd: 50, capReached: true },
    })
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByText('900 credits over the band · $2.70 accrued')).toBeTruthy(),
    )
    expect(
      screen.getByText('Stopped — the org’s $50.00 overage ceiling is reached.'),
    ).toBeTruthy()
  })

  it('renders refusals by reason, the non-zero one filled', async () => {
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('ceiling 12')).toBeTruthy())
    expect(screen.getByText('band 0')).toBeTruthy()
    expect(screen.getByText('Refusals this month · 12')).toBeTruthy()
  })

  it('says "no generation jobs yet" for an org with none, and reports a failed read as one', async () => {
    mockAnswer.payload = body({
      jobs: {
        counts: { queued: 0, running: 0, needs_input: 0, done: 0, failed: 0, canceled: 0 },
        recent: [],
        truncated: false,
      },
    })
    const { unmount } = render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('No generation jobs yet.')).toBeTruthy())
    unmount()

    mockAnswer.payload = body({ jobs: null })
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByText(/Could not read the generation jobs/)).toBeTruthy(),
    )
  })

  it('says where per-user attribution comes from when the rollup is empty', async () => {
    mockAnswer.payload = body({ users: [] })
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByText('Per-user attribution lands with AGL-2928.')).toBeTruthy(),
    )
  })

  it('lists the jobs and the top users when there are some', async () => {
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() => expect(screen.getByText('job-9')).toBeTruthy())
    expect(screen.getByText('queued 1')).toBeTruthy()
    expect(screen.getAllByText('user-a').length).toBeGreaterThan(0)
    expect(screen.getByText('1,800')).toBeTruthy()
  })

  it('turns the margin red when spend exceeds the add-on plus the plan’s share', async () => {
    mockAnswer.payload = body({
      margin: { ...body().margin, spendUsd: 40, underwater: true, multiple: 1 },
    })
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByText(/Spend exceeds the add-on plus the plan’s assist share\./)).toBeTruthy(),
    )
    expect(screen.getByText(/1× the \$25\.00 staff review threshold\./)).toBeTruthy()
  })

  it('reports a failed read as a failure, never as zero usage', async () => {
    mockAnswer = { ok: false, status: 500, payload: { error: 'AI lookup failed' } }
    render(<StaffOrgAiCard orgId="org-1" />)
    await waitFor(() =>
      expect(screen.getByText(/Could not read this organization’s AI usage/)).toBeTruthy(),
    )
  })
})
