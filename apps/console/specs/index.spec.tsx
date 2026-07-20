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

import Index from '../app/(app)/[orgSlug]/hosts/[host]/page'

// The page tree reads Firebase services from FirebaseServicesProvider, which
// needs a real firebase app; stub the hooks so the smoke test can render.
//
// STABLE IDENTITIES ONLY (AGL-597): each mock returns the same module-level
// object on every call. Returning a fresh object per call re-fires every
// effect keyed on a hook result each render — one state-setting effect and
// the render loops until the jest worker exhausts its heap (the OOM that
// broke full-suite runs). The real hooks return referentially stable
// results; the mocks must too.
jest.mock('@aglyn/tenant-feature-instance', () => {
  const auth = { currentUser: null }
  const firestore = {}
  const signinCheck = { status: 'loading', data: undefined, error: undefined }
  const user = { data: undefined }
  const docResult = {
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
  return {
    ...jest.requireActual('@aglyn/tenant-feature-instance'),
    useAnalytics: () => null,
    useAuth: () => auth,
    useFirestore: () => firestore,
    useSigninCheck: () => signinCheck,
    useUser: () => user,
    useUserPhoto: () => undefined,
    useHost: () => docResult,
    useLayout: () => docResult,
    useLayoutVersion: () => docResult,
  }
})

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

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const snackbar = { enqueueSnackbar: jest.fn(), closeSnackbar: jest.fn() }
  return {
    ...jest.requireActual('@aglyn/shared-ui-snackstack'),
    useSnackbar: () => snackbar,
  }
})

jest.mock('@aglyn/shared-ui-jsx', () => {
  const confirmation = { confirm: jest.fn() }
  return {
    ...jest.requireActual('@aglyn/shared-ui-jsx'),
    useConfirmationContext: () => confirmation,
  }
})

describe('Index', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<Index />)
    expect(baseElement).toBeTruthy()
  })
})
