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

import { render, screen } from '@testing-library/react'

/**
 * The refund card's contextual help resolves to the STAFF refunds runbook
 * (AGL-2486).
 *
 * `staff-org-refund-card.spec.tsx` mocks `docsHelp` to `() => ({})` so it can
 * concentrate on the money path — which means nothing in it can notice where
 * the help button actually points. This file exists to close exactly that
 * hole, and it resolves the REAL registry rather than asserting on source
 * text: a `docsHelp('refunds')` call that named a topic the generator never
 * emitted would still match a grep, and would still ship a help button that
 * throws when it renders.
 *
 * The card first shipped pointing at `billing`, the page a workspace OWNER
 * reads about their own invoices. That page cannot explain the super-only
 * bar, the disputed-charge refusal or the audit row, because none of those
 * are customer-facing — so an operator following the help link on a
 * money-moving action landed somewhere that could not answer the question
 * they had.
 *
 * NO LIVE REFUND IS ISSUED HERE: `fetch` is mocked and nothing reaches Stripe.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/**
 * Captured rather than mocked away — the help prop IS the thing under test,
 * so it is rendered into the DOM where an assertion can read it.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
  CardDisplay: ({ children, help }: any) => (
    <div>
      <a data-testid="help-href" href={help?.href}>
        {help?.title}
      </a>
      <span data-testid="help-excerpt">{help?.excerpt}</span>
      {children}
    </div>
  ),
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => 'super',
}))

// Deliberately NOT mocked: `../constants/docs-links`.

import { DOCS_HELP_ANCHORS, DOCS_HELP_TOPICS } from '../constants/docs-help.generated'
import StaffOrgRefundCard from '../components/staff-org-refund-card.component'

beforeEach(() => {
  jest.clearAllMocks()
  ;(globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ charges: [], hasCustomer: false }),
  }))
})

describe('the refund card’s help destination (AGL-2486)', () => {
  it('points at the staff refunds runbook, not the customer billing page', () => {
    render(<StaffOrgRefundCard orgId="org-1" />)
    const href = screen.getByTestId('help-href').getAttribute('href') ?? ''
    expect(href).toContain('/staff-console/refunds')
    // The page an owner reads about their OWN invoices. Naming it explicitly
    // so a revert to the original topic fails here rather than silently
    // passing the `toContain` above on some future shared path.
    expect(href).not.toContain('/workspace-and-billing/billing-and-plans')
  })

  it('deep-links to the section that describes issuing one', () => {
    render(<StaffOrgRefundCard orgId="org-1" />)
    const href = screen.getByTestId('help-href').getAttribute('href') ?? ''
    expect(href).toContain('#issuing-a-refund')
  })

  it('says a reason is required and that it is audited, before the docs open', () => {
    render(<StaffOrgRefundCard orgId="org-1" />)
    // The tooltip excerpt is read by an operator who does NOT click through,
    // so the two constraints that change what they do next belong in it.
    const excerpt = screen.getByTestId('help-excerpt').textContent ?? ''
    expect(excerpt).toMatch(/reason/i)
    expect(excerpt).toMatch(/audited/i)
  })
})

describe('the refunds topic the card depends on (AGL-2486)', () => {
  it('is a real generated topic on the staff docs section', () => {
    // Regenerated from `apps/docs/docs/staff-console/refunds.md`. Without the
    // page, `docsHelp('refunds')` does not type-check and the card cannot
    // build — this asserts the topic reaches the RUNTIME registry too, which
    // is what the rendered href is built from.
    expect(DOCS_HELP_TOPICS.refunds?.path).toBe('/staff-console/refunds')
    expect(DOCS_HELP_TOPICS.refunds?.title).toBe('Refunds')
  })

  it('carries the anchors the card and the runbook cross-reference', () => {
    // The anchor list is derived from the page's real headings, so a heading
    // renamed in the docs surfaces here rather than as a link that silently
    // lands at the top of the page.
    const anchors: readonly string[] = DOCS_HELP_ANCHORS.refunds ?? []
    expect(anchors).toContain('#issuing-a-refund')
    expect(anchors).toContain('#who-can-refund')
    expect(anchors).toContain('#what-is-recorded')
    // The revenue linkage is the one section another surface depends on: the
    // staff revenue page reports these refunds, and the runbook is where that
    // relationship is written down.
    expect(anchors).toContain('#in-revenue')
  })
})
