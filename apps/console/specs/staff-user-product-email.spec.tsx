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
 * Product email on the staff user page (AGL-3292).
 *
 * The product keeps two records of one person's product-email consent and
 * nothing keeps them in step: the answer on their own document, and the
 * contact a campaign from the operator's marketing site reads, behind two
 * suppression lists. These pin that the page shows both, says which one the
 * mail follows when they disagree, and never shows an unreadable CRM as "no".
 */
import StaffUserProductEmail, {
  type StaffUserMarketing,
} from '../components/staff-user-product-email.component'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const AT = Date.UTC(2026, 8, 20, 12)
const at = new Date(AT).toLocaleString()

const answered = (
  decision: 'granted' | 'declined' | null,
  sourceKind: string | null = 'console-signup',
): StaffUserMarketing['answer'] => ({
  decision,
  atMs: decision ? AT : null,
  textVersion: decision ? '2026-09-20' : null,
  sourceKind: decision ? (sourceKind as never) : null,
  promptDismissedAtMs: null,
})

const read = (
  overrides: Partial<Extract<StaffUserMarketing['reach'], { status: 'read' }>> = {},
): StaffUserMarketing['reach'] => ({
  status: 'read',
  hostId: 'host-marketing',
  orgId: 'org-operator',
  orgSlug: 'aglyn-org',
  contactId: 'contact-1',
  basis: 'granted',
  basisAtMs: AT,
  assertedBy: 'person',
  basisKind: 'console-signup',
  verdict: 'consented',
  reason: 'granted',
  suppression: null,
  ...overrides,
})

describe('product email on the staff user page (AGL-3292)', () => {
  it('shows the answer and a sendable contact, and links the contact', () => {
    render(
      <StaffUserProductEmail marketing={{ answer: answered('granted'), reach: read() }} />,
    )
    expect(
      screen.getByText(`Product updates, their answer: Yes — at sign-up, ${at}`),
    ).toBeTruthy()
    expect(screen.getByText(`Can send — consented ${at}`)).toBeTruthy()
    expect(screen.getByText('Open contact').getAttribute('href')).toBe(
      '/aglyn-org/crm/contacts/contact-1',
    )
    expect(screen.queryByText(/They said/)).toBeNull()
  })

  it('says the mail follows the contact when a yes meets an unsubscribe', () => {
    render(
      <StaffUserProductEmail
        marketing={{
          answer: answered('granted', 'console-prompt'),
          reach: read({ suppression: { list: 'site', reason: 'unsubscribe' } }),
        }}
      />,
    )
    expect(
      screen.getByText('Won’t send — unsubscribed from the marketing site'),
    ).toBeTruthy()
    expect(screen.getByText(/They said yes in the console, but/)).toBeTruthy()
  })

  it('flags a no that the contact does not reflect', () => {
    render(
      <StaffUserProductEmail
        marketing={{ answer: answered('declined'), reach: read() }}
      />,
    )
    expect(screen.getByText(/They said no in the console, but/)).toBeTruthy()
  })

  it('names a platform-wide bounce as every sender’s', () => {
    render(
      <StaffUserProductEmail
        marketing={{
          answer: answered(null),
          reach: read({ suppression: { list: 'platform', reason: 'bounce' } }),
        }}
      />,
    )
    expect(screen.getByText('Product updates, their answer: Not answered')).toBeTruthy()
    expect(screen.getByText('Won’t send — hard bounce, for every sender')).toBeTruthy()
  })

  it('reads no consent on file as that, and not as a refusal', () => {
    render(
      <StaffUserProductEmail
        marketing={{
          answer: answered(null),
          reach: read({ contactId: null, basis: 'unrecorded', verdict: 'withheld', reason: 'no-basis' }),
        }}
      />,
    )
    expect(screen.getByText('Won’t send — no consent on file')).toBeTruthy()
    expect(screen.queryByText('Open contact')).toBeNull()
  })

  it('never shows an unreadable CRM as a no, and draws no conclusion from it', () => {
    render(
      <StaffUserProductEmail
        marketing={{
          answer: answered('granted'),
          reach: { status: 'unreadable', hostId: 'host-marketing' },
        }}
      />,
    )
    expect(
      screen.getByText('Could not read the marketing contact — unknown, not "no"'),
    ).toBeTruthy()
    expect(screen.queryByText(/They said/)).toBeNull()
  })

  it('says so on a deployment with no marketing site', () => {
    render(
      <StaffUserProductEmail
        marketing={{ answer: answered(null), reach: { status: 'unconfigured' } }}
      />,
    )
    expect(
      screen.getByText(
        'no marketing site is configured (PLATFORM_MARKETING_HOST_ID), so no contact was checked',
      ),
    ).toBeTruthy()
  })

  it('renders nothing for a response that predates the field', () => {
    const { container } = render(<StaffUserProductEmail marketing={undefined} />)
    expect(container.textContent).toBe('')
  })
})
