/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
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
 * The verdict card says where a version stands, and offers the step that
 * makes it run (AGL-3394).
 *
 * Approving Calculators v1.0.0 left "Approve version" live on an approved
 * version, and the realm trust that makes a signed plugin run sat two cards
 * further down, where the reviewer did not find it.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockVersion: { reviewState: string; trust: string | null } = {
  reviewState: 'approved',
  trust: null,
}
const mockChecklist: Record<string, { by: string }> = {}

jest.mock('next/navigation', () => ({
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@aglyn/aglyn-markdown-editor', () => ({
  MarkdownLiteView: () => null,
}))
/*
 * The chrome and the staff gate are the SHELL's since AGL-3080 — the generic
 * staff route owns the layout and wraps every plugin page in `StaffOnly` —
 * so there is nothing here to stand in for. What is left is the header seam
 * the page publishes into, which renders nothing on its own.
 */
jest.mock('@aglyn/aglyn', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn'),
  PageHeaderRecord: () => null,
  PageHeaderHelp: () => null,
}))

import ReviewDetailPage from './plugin-review-detail.component'

/**
 * The detail body the route returns.
 *
 * Every field the render path dereferences is present — `checklistOutstanding`
 * and friends are read unguarded, so a lean fixture throws before the chip
 * under test is ever reached, and the assertion then fails for a reason that
 * has nothing to do with decline reasons.
 */
function body() {
  return {
    $id: 'listing-1',
    displayName: 'Fancy Widget',
    description: 'A widget.',
    readme: '',
    license: 'MIT',
    categories: [],
    homepageUrl: '',
    repoUrl: '',
    reviewStatus: 'pending',
    reviewVersion: '1.0.0',
    latestVersion: '1.0.0',
    activeInstalls: 0,
    hidden: false,
    hiddenReason: '',
    revoked: false,
    unpublished: false,
    private: false,
    platformHostAbi: 1,
    artifactsBucket: null,
    versions: [
      {
        version: '1.0.0',
        trust: mockVersion.trust,
        sha256: 'a'.repeat(64),
        hostAbi: 1,
        capabilities: {},
        publishedAt: null,
        signed: mockVersion.trust === 'realm',
        reviewState: mockVersion.reviewState,
        grandfathered: false,
        installCount: 2,
        activeInstalls: 2,
        revoked: false,
      },
    ],
    verifier: null,
    verifierCached: false,
    checklist: mockChecklist,
    checklistOutstanding: [],
    attestation: [],
    attestedBy: null,
    attestedAt: null,
    publisherAgreement: {
      version: null,
      acceptedAt: null,
      required: '1',
      state: 'none' as const,
    },
    verificationRequest: null,
  }
}

beforeEach(() => {
  mockVersion.reviewState = 'approved'
  mockVersion.trust = null
  for (const key of Object.keys(mockChecklist)) delete mockChecklist[key]
  ;(global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body(),
  })
})

const approveButton = async () =>
  screen.findByRole('button', { name: /^(Approve version|Approved)$/ })

describe('the verdict on a version', () => {
  it('does not offer to approve an approved version again', async () => {
    render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={["listing-1"]} />)
    const button = await approveButton()
    expect(button.textContent).toBe('Approved')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers approval for a version still pending', async () => {
    mockVersion.reviewState = 'pending'
    render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={["listing-1"]} />)
    const button = await approveButton()
    expect(button.textContent).toBe('Approve version')
  })
})

describe('realm trust beside the verdict', () => {
  const notice = /is approved and still sandboxed/

  it('is offered once the reviewer judged realm access necessary', async () => {
    mockChecklist['realm-need'] = { by: 'staff-1' }
    render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={["listing-1"]} />)
    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy())
    expect(screen.getAllByRole('button', { name: 'Grant realm trust' }).length).toBe(2)
  })

  it('is not pushed on a plugin the reviewer left sandboxed', async () => {
    render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={["listing-1"]} />)
    await approveButton()
    expect(screen.queryByText(notice)).toBeNull()
  })

  it('goes once the version is trusted', async () => {
    mockChecklist['realm-need'] = { by: 'staff-1' }
    mockVersion.trust = 'realm'
    render(<ReviewDetailPage basePath="/admin/plugin-reviews" segments={["listing-1"]} />)
    await approveButton()
    expect(screen.queryByText(notice)).toBeNull()
  })
})
