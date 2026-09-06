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
 * AN ORDER LINKS TO ITS BUYER'S CONTACT (AGL-2622).
 *
 * The dialog holds an email and nothing else about the person; the CRM's
 * Contacts list is the lookup, asked by that address. A guest checkout with
 * no address updated nobody, so the dialog offers nothing rather than a
 * link that lands on an empty list.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import OrderDetailDialog from './order-detail-dialog.component'

jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({
    data: { uid: 'uid-admin', getIdToken: jest.fn(async () => 'tok') },
  }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
}))

let params: Record<string, string> | null = { orgSlug: 'acme', host: 'shop' }
jest.mock('next/navigation', () => ({
  useParams: () => params,
}))

const order = (extra: Record<string, unknown> = {}) => ({
  $id: 'order-abc',
  number: 1042,
  status: 'paid',
  lineItems: [{ productId: 'p1', name: 'Ceramic mug', quantity: 1, unitAmountCents: 1100 }],
  timeline: [],
  ...extra,
})

const show = (subject: Record<string, unknown>) =>
  render(
    <OrderDetailDialog hostId="host-1" order={subject as never} onClose={() => undefined} />,
  )

beforeEach(() => {
  params = { orgSlug: 'acme', host: 'shop' }
})

describe('View customer in CRM', () => {
  it('links to the Contacts list asked to open the buyer by address', () => {
    show(order({ customerEmail: 'buyer@example.com' }))
    const link = screen.getByRole('link', { name: 'View customer in CRM' })
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/shop/crm/contacts?email=buyer%40example.com',
    )
  })

  it('offers nothing for a guest checkout that carried no address', () => {
    show(order())
    expect(screen.queryByText('View customer in CRM')).toBeNull()
  })

  it('offers nothing until the route params have settled', () => {
    params = null
    show(order({ customerEmail: 'buyer@example.com' }))
    expect(screen.queryByText('View customer in CRM')).toBeNull()
  })
})
