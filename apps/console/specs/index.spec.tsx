/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { render } from '@testing-library/react'
import React from 'react'

import Index from '../app/(app)/[hostId]/page'

// The page tree reads Firebase services from FirebaseServicesProvider, which
// needs a real firebase app; stub the hooks so the smoke test can render.
jest.mock('@aglyn/tenant-feature-instance', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  useAnalytics: () => null,
  useAuth: () => ({ currentUser: null }),
  useFirestore: () => ({}),
  useSigninCheck: () => ({
    status: 'loading',
    data: undefined,
    error: undefined,
  }),
  useUser: () => ({ data: undefined }),
  useUserPhoto: () => undefined,
  useHost: () => mockDocResult(),
  useLayout: () => mockDocResult(),
  useLayoutVersion: () => mockDocResult(),
}))

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  doc: jest.fn(() => ({ path: 'mock/doc' })),
  collection: jest.fn(() => ({ path: 'mock' })),
  collectionGroup: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(),
  orderBy: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(() => () => {}),
  getDoc: jest.fn(() =>
    Promise.resolve({ exists: () => false, data: () => undefined }),
  ),
  getDocs: jest.fn(() => Promise.resolve({ docs: [], empty: true, size: 0 })),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  ...jest.requireActual('@aglyn/shared-ui-snackstack'),
  useSnackbar: () => ({
    enqueueSnackbar: jest.fn(),
    closeSnackbar: jest.fn(),
  }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: jest.fn() }),
}))

function mockDocResult() {
  return {
    doc: {
      status: 'loading',
      hasEmitted: false,
      isComplete: false,
      data: undefined,
      error: undefined,
      firstValuePromise: Promise.resolve(),
    },
    setDoc: jest.fn(),
  }
}

describe('Index', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Index />)
    expect(baseElement).toBeTruthy()
  })
})
