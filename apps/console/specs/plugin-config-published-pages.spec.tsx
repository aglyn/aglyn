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
 * Settings a published page reads reach it at once (AGL-3700).
 *
 * The tenant's pages are cached for an hour, and a plugin's settings are not
 * a publish, so nothing dropped the cache when they changed: an owner who
 * turned Weglot on would see nothing on the live site for up to an hour. A
 * schema that says `affectsPublishedPages` now has its site-scope save drop
 * that site's cached pages, and a schema's `notice` — what the form cannot
 * say field by field — is shown above the fields.
 */

import { registerPluginConfigSchema } from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDocCalls: Array<{ path: string; data: Record<string, unknown> }> = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => ({ __sentinel: 'deleteField' }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    mockSetDocCalls.push({ path: ref.path, data })
  },
}))

const mockUser = { uid: 'u1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
  useFirestoreDoc: (buildRef: () => { path: string } | null) =>
    buildRef()
      ? { data: undefined, status: 'success', fromCache: false }
      : { data: undefined, status: 'loading', fromCache: false },
  writeGuardedBySeed: async (_options: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: { header: ReactNode; children: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

const mockRevalidate = jest.fn(async () => null)
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  revalidateLivePages: (...args: unknown[]) => mockRevalidate(...(args as [])),
  default: (...args: unknown[]) => mockRevalidate(...(args as [])),
}))

const PluginConfigCards =
  require('../components/plugin-config-card.component').default

const LIVE = 'published-pages-spec'
const QUIET = 'console-only-spec'

registerPluginConfigSchema({
  pluginId: LIVE,
  notice: 'Translated pages are for visitors and may not rank.',
  affectsPublishedPages: true,
  fields: [{ key: 'label', label: 'Label', type: 'string' }],
  defaults: { label: '' },
})
registerPluginConfigSchema({
  pluginId: QUIET,
  fields: [{ key: 'label', label: 'Label', type: 'string' }],
  defaults: { label: '' },
})

const edit = async (button: string) => {
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: button }))
  await waitFor(() => expect(mockSetDocCalls.length).toBeGreaterThan(0))
}

beforeEach(() => {
  mockSetDocCalls.length = 0
  mockRevalidate.mockClear()
})

describe('a schema whose settings a published page reads', () => {
  it('shows its notice above the fields', () => {
    render(<PluginConfigCards orgId="org-1" hostId="host-1" pluginId={LIVE} />)
    expect(
      screen.getByText('Translated pages are for visitors and may not rank.'),
    ).toBeTruthy()
  })

  it('drops the site’s cached pages after a site save', async () => {
    render(<PluginConfigCards orgId="org-1" hostId="host-1" pluginId={LIVE} />)
    await edit('Save site settings')
    await waitFor(() =>
      expect(mockRevalidate).toHaveBeenCalledWith({
        user: mockUser,
        hostId: 'host-1',
        entireHost: true,
      }),
    )
  })

  it('drops nothing on a workspace save, which names no single site', async () => {
    render(<PluginConfigCards orgId="org-1" pluginId={LIVE} />)
    await edit('Save settings')
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe('a schema that does not say so', () => {
  it('drops nothing, and shows no notice', async () => {
    render(<PluginConfigCards orgId="org-1" hostId="host-1" pluginId={QUIET} />)
    expect(screen.queryByRole('alert')).toBeNull()
    await edit('Save site settings')
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})
