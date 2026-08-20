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
 * The app-bar version chip must not change the CASE of a version id.
 *
 * A Firestore document id is case-sensitive and its alphabet contains both
 * `I` and `l`. The chip is a MUI `<Button>`, whose theme default is
 * `text-transform: uppercase`, and its label falls back to the raw id when a
 * version has no display name — so `IpFQ51Z2y3` was PAINTED as `IPFQ51Z2Y3`.
 *
 * That is not cosmetic. Reading an id off this chip and typing it into a
 * besigner URL is exactly how `IpFQ51Z2y3` became `lpFQ51Z2y3`, and the
 * editor answers a version id that does not exist with a bare "Not found"
 * over the canvas — which reads as data loss on a published legal screen
 * rather than as a bad address. One mis-read character blocked a Privacy
 * Policy publish.
 *
 * Asserted through `getComputedStyle` rather than the `sx` prop: emotion
 * injects the real rule, so this measures what the browser would paint. The
 * id is asserted PRESENT before its case is asserted, so the test cannot
 * pass by finding nothing.
 */

const VERSION_ID = 'IpFQ51Z2y3'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useHostVersionApi: () => jest.fn(),
  useUser: () => ({ data: { uid: 'u1' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn() }),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(() => ({})),
  deleteDoc: jest.fn(),
  deleteField: jest.fn(),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

jest.mock('../components/host-id-provider', () => ({
  useHostSubdomain: () => 'aglyn-marketing',
}))

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'aglyn-org',
}))

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'pro' }, ready: true }),
}))

/**
 * One version, deliberately WITHOUT a `displayName` — that is the branch
 * where the chip falls back to the raw document id, and the only branch
 * where the id's case is user-visible.
 */
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({
    data: [{ $id: 'IpFQ51Z2y3', createdAt: { seconds: 1 } }],
  }),
}))

jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {} }),
}))

jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: jest.fn(),
  describeRevalidateShortfall: jest.fn(),
}))

jest.mock('../utils/rewrite-stored-binding-tokens', () => ({
  __esModule: true,
  default: jest.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  BesignerVersionsComponent,
} = require('../components/besigner-versions.component')

describe('besigner app-bar version chip', () => {
  it('paints a version id in its stored case', () => {
    render(
      <BesignerVersionsComponent
        hostId="DXnRbPH4CQ"
        parent={{ kind: 'screen', id: 'MxuaTpTwfk' }}
        versionId={VERSION_ID}
        publishedVersionId={VERSION_ID}
      />,
    )

    // Assert the id is on screen BEFORE asserting anything about it, so a
    // render that produced nothing cannot pass this test.
    const label = screen.getByText(VERSION_ID)
    expect(label).toBeTruthy()
    expect(label.textContent).toBe(VERSION_ID)

    const button = label.closest('button')
    expect(button).not.toBeNull()

    // The painted case is what a reader copies. `uppercase` here turns the
    // leading `I` into a glyph indistinguishable from `l`.
    expect(getComputedStyle(button as Element).textTransform).not.toBe(
      'uppercase',
    )
    expect(getComputedStyle(label).textTransform).not.toBe('uppercase')
  })
})
