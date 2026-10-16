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
 * The card reports the Stripe account every money route charges against: the
 * one on the workspace OWNER's profile. A teammate who manages the store sees
 * the owner's connected account, never their own empty profile.
 */

const mockDocPaths: string[] = []
const mockProfiles: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useConsoleHostRoute: () => ({ base: '/acme/hosts/shop', orgSlug: 'acme', subdomain: 'shop' }),
  useFirestore: () => ({}),
  useOrgPlan: () => ({ org: { plan: 'business', ownerUid: 'uid-owner' }, ready: true }),
  useUser: () => ({ data: { uid: 'uid-admin', getIdToken: jest.fn() } }),
  useFirestoreDoc: (build: () => { path?: string } | null) => {
    const ref = build()
    return ref?.path ? { data: mockProfiles[ref.path], status: 'success' } : { data: undefined, status: 'loading' }
  },
  useFirestoreCollection: () => ({ data: [] }),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: (_db: unknown, ...segments: string[]) => {
    const path = segments.join('/')
    mockDocPaths.push(path)
    return { path }
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

import PaymentsSettingsCard from './payments-settings-card.component'

it("reads the owner's Stripe account for a teammate who is not the owner", () => {
  mockProfiles['profiles/uid-owner'] = {
    stripeAccountId: 'acct_1',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeAccountLivemode: false,
  }
  render(<PaymentsSettingsCard hostId="host-1" />)

  expect(mockDocPaths).toContain('profiles/uid-owner')
  expect(mockDocPaths).not.toContain('profiles/uid-admin')
  expect(screen.getByText('Charges enabled')).toBeTruthy()
  expect(screen.queryByText('Not set up')).toBeNull()
  // Connecting stays the owner's act.
  expect(screen.getByText('Only the organization owner can set up payments.')).toBeTruthy()
})
