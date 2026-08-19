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
 * STAFF CAN READ WHAT A COLLEAGUE TOLD THE PUBLISHER (AGL-2339, item 5).
 *
 * `/api/admin/plugin-reviews` serves `verificationRequest.declineReason` and
 * the detail page declared it in its own type — then branched on `state`
 * alone. So the PUBLISHER could read why verification was refused
 * (`listing-verification-request.component` renders it) and the staff reviewer
 * picking up the re-request could not. Whoever handled the second ask either
 * re-decided it blind or contradicted the first answer.
 *
 * The assertion is the REASON'S OWN TEXT, twice, with different reasons. A
 * check for a "Previously declined" label would pass with the reason dropped,
 * hardcoded, or replaced by the listing name — which is the whole failure mode
 * this sweep is about.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockDetail: { verificationRequest: Record<string, unknown> | null } = {
  verificationRequest: null,
}

jest.mock('next/navigation', () => ({
  useParams: () => ({ listingId: 'listing-1' }),
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
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/staff-super-only.component', () => ({
  SuperStaffOnly: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import ReviewDetailPage from '../app/(app)/admin/plugin-reviews/[listingId]/page'

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
    versions: [],
    verifier: null,
    verifierCached: false,
    checklist: {},
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
    verificationRequest: mockDetail.verificationRequest,
  }
}

beforeEach(() => {
  mockDetail.verificationRequest = null
  ;(global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body(),
  })
})

describe('the reason a colleague already gave', () => {
  it('renders the reason’s OWN text, whatever it says', async () => {
    // Two different refusals for the same listing. A label wired to a constant
    // — or one that dropped the field and showed only "Previously declined" —
    // satisfies exactly one of these passes, or neither.
    for (const reason of [
      'The README does not document the network calls the bundle makes.',
      'Support email bounces; we could not reach anyone about the CSP report.',
    ]) {
      mockDetail.verificationRequest = {
        state: 'pending',
        requestedAt: null,
        declineReason: reason,
      }
      const view = render(<ReviewDetailPage />)
      await waitFor(() =>
        expect(screen.getByText(new RegExp(reason.slice(0, 30)))).toBeTruthy(),
      )
      view.unmount()
    }
  })

  it('says nothing when there is nothing a colleague said', async () => {
    // The control. A first-time request must not show a phantom refusal, and
    // "Previously declined:" with an empty tail reads as one.
    mockDetail.verificationRequest = { state: 'pending', requestedAt: null }
    render(<ReviewDetailPage />)
    // Anchor FIRST: a page that failed to render at all would satisfy the
    // absence assertion below without proving anything. The Decline button is
    // rendered by the same `verificationRequest` block the chip lives in.
    await waitFor(() =>
      expect(screen.getByText('Decline verification')).toBeTruthy(),
    )
    expect(screen.queryByText(/Previously declined/)).toBeNull()
  })
})
