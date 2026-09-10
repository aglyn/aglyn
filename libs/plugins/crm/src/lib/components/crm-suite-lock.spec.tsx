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
 * THE CRM SUITE'S LOCKS (AGL-2788).
 *
 * What has to hold: the plan question is `checkEntitlement`'s, so a per-org
 * grant opens the suite on Free and a revocation closes it on a paid plan; a
 * locked control stands where the working one would, disabled, saying which
 * plan includes it; the notice names that plan and links to the plans; and
 * a record's one-to-one email and a duplicate's merge are locked rather than
 * opened.
 */

import { soloConsentGroup } from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import ContactDuplicatesCard from './contact-duplicates-card'
import CrmSendEmailButton from './crm-send-email-button'
import {
  CrmSuiteLockedButton,
  CrmSuiteNotice,
  crmSuiteIncluded,
  crmSuiteLockedReason,
} from './crm-suite-lock'

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme', host: 'shop' }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  CardDisplay: ({
    HeaderProps,
    children,
  }: {
    HeaderProps?: { action?: ReactNode }
    children: ReactNode
  }) => (
    <section>
      {HeaderProps?.action}
      {children}
    </section>
  ),
  MdiIcon: () => null,
}))

/** Every dialog the email button opened. */
const openedDialogs: unknown[] = []
jest.mock('./crm-send-email-dialog', () => ({
  __esModule: true,
  default: (props: unknown) => {
    openedDialogs.push(props)
    return <div data-testid="send-email-dialog" />
  },
}))

/** A second record for the person on the page: the same name and phone. */
const mockTwin = {
  email: 'ada.l@example.test',
  name: 'Ada Lovelace',
  phone: '+15125550107',
  facets: { 'host-1': { phone: '+15125550107' } },
}
jest.mock('@aglyn/tenant-feature-instance', () => ({ useFirestore: () => ({}) }))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (base: unknown) => base,
  where: () => undefined,
  limit: () => undefined,
  getDocs: async () => ({ docs: [{ id: 'c-2', data: () => mockTwin }] }),
}))

const GROUP = soloConsentGroup('host-1')
const current = {
  id: 'c-1',
  doc: {
    email: 'ada@example.test',
    name: 'Ada Lovelace',
    phone: '+15125550107',
    facets: { 'host-1': { phone: '+15125550107' } },
  },
}

beforeEach(() => {
  openedDialogs.length = 0
})

describe('crmSuiteIncluded', () => {
  it('answers from the plan, and from a per-org grant or revocation', () => {
    expect(crmSuiteIncluded({ plan: 'free' })).toBe(false)
    // A workspace with no plan resolves as Free.
    expect(crmSuiteIncluded({})).toBe(false)
    expect(crmSuiteIncluded({ plan: 'starter' })).toBe(true)
    expect(
      crmSuiteIncluded({ plan: 'free', entitlements: { features: { crm: true } } }),
    ).toBe(true)
    expect(
      crmSuiteIncluded({ plan: 'agency', entitlements: { features: { crm: false } } }),
    ).toBe(false)
  })
})

describe('CrmSuiteLockedButton', () => {
  it('stands disabled where the control would be, and says which plan includes it', async () => {
    render(<CrmSuiteLockedButton variant="contained">{'New contact'}</CrmSuiteLockedButton>)
    const button = screen.getByRole('button', { name: 'New contact' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // The reason opens on the wrapper, since a disabled button fires nothing.
    fireEvent.mouseOver(button.parentElement as HTMLElement)
    expect(
      await screen.findByText('Part of the CRM suite, included from Starter'),
    ).toBeTruthy()
    expect(crmSuiteLockedReason()).toBe('Part of the CRM suite, included from Starter')
  })
})

describe('CrmSuiteNotice', () => {
  it('names the plan that includes the suite and links to the plans', () => {
    render(<CrmSuiteNotice>{'Importing a CSV is part of the CRM suite.'}</CrmSuiteNotice>)
    expect(
      screen.getByText('Importing a CSV is part of the CRM suite. Included from Starter.'),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View plans' }).getAttribute('href')).toBe(
      '/acme/billing',
    )
  })
})

describe('one-to-one email from a record', () => {
  it('stands locked without the suite, and opens no dialog', () => {
    render(
      <CrmSendEmailButton hostId="host-1" contactId="c-1" email="ada@example.test" suiteLocked />,
    )
    const button = screen.getByRole('button', { name: 'Send email' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(openedDialogs).toHaveLength(0)
  })

  it('opens the dialog with the suite', () => {
    render(<CrmSendEmailButton hostId="host-1" contactId="c-1" email="ada@example.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }))
    expect(screen.getByTestId('send-email-dialog')).toBeTruthy()
  })
})

describe('merging a likely duplicate', () => {
  const renderCard = (suiteLocked: boolean, onMerge: jest.Mock) =>
    render(
      <ContactDuplicatesCard
        current={current}
        scope={['orgs', 'org-1']}
        consentGroup={GROUP}
        visibleTo={['host:host-1']}
        basePath="/acme/hosts/shop/crm"
        onMerge={onMerge}
        suiteLocked={suiteLocked}
      />,
    )

  it('still finds the duplicate without the suite, and locks the merge', async () => {
    const onMerge = jest.fn()
    renderCard(true, onMerge)
    fireEvent.click(screen.getByRole('button', { name: 'Find likely duplicates' }))
    const merge = (await screen.findByRole('button', {
      name: 'Merge into this record',
    })) as HTMLButtonElement
    expect(merge.disabled).toBe(true)
    fireEvent.click(merge)
    expect(onMerge).not.toHaveBeenCalled()
  })

  it('offers the merge with the suite', async () => {
    const onMerge = jest.fn()
    renderCard(false, onMerge)
    fireEvent.click(screen.getByRole('button', { name: 'Find likely duplicates' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Merge into this record' }))
    expect(onMerge).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-2' }))
  })
})
