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
 * WHOEVER HOLDS "Export workspace data" CAN REACH IT (AGL-4047).
 *
 * The route asks `org.export`, and owners and admins hold it by default, but the
 * card sat in Settings → Delete, a section only the owner is shown. So an admin,
 * or anyone a custom role granted it, held a permission with no way to use it.
 * It lives in Settings → Import & export now; Delete itself stays the owner's.
 */

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let mockHeld = new Set<string>(['org.export'])
let mockLoaded = true

jest.mock('../hooks/use-org-permissions', () => {
  const read = () => ({
    loaded: mockLoaded,
    can: (key: string) => mockHeld.has(key),
    permissions: {},
    granted: {},
  })
  return { __esModule: true, default: read, useOrgPermissions: read }
})
jest.mock('../hooks/use-org-scope', () => {
  const scope = { currentOrg: { $id: 'org-1', role: 'admin' } }
  return { __esModule: true, default: () => scope, useOrgScope: () => scope, useOrgSlug: () => 'acme' }
})
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: unknown; children?: unknown }) => (
    <section>
      <h2>{header as never}</h2>
      {children as never}
    </section>
  ),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({ authorizedFetch: jest.fn() }))
jest.mock('../components/settings/org-data-transfer-card.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/settings/org-transfer-history-card.component', () => ({
  __esModule: true,
  default: () => <div>{'Import history'}</div>,
}))

import SettingsData from '../app/(app)/[orgSlug]/settings/(sections)/data/page'

const REFUSAL = 'Your role does not include "Export workspace data" — ask an organization admin'
const SOURCE = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

const download = () => screen.getByRole('button', { name: 'Download workspace data' }) as HTMLButtonElement

beforeEach(() => {
  mockHeld = new Set(['org.export'])
  mockLoaded = true
})

describe('Settings → Import & export carries the whole workspace’s copy', () => {
  it('a holder, whatever their role, has the button on', () => {
    render(<SettingsData />)
    expect(download().disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('a member here without the key has it switched off, naming the permission, never hidden', () => {
    mockHeld = new Set(['data.manage'])
    render(<SettingsData />)
    expect(download().disabled).toBe(true)
    expect(screen.getByLabelText(REFUSAL).contains(download())).toBe(true)
    // The rest of the page stays theirs.
    expect(screen.getByText('Import history')).toBeTruthy()
  })

  it('holds with no reason said while permissions load', () => {
    mockLoaded = false
    render(<SettingsData />)
    expect(download().disabled).toBe(true)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('names the permission and who holds it by default, not a role as the rule', () => {
    render(<SettingsData />)
    expect(screen.getByText(/It needs the “Export workspace data” permission, which owners and admins hold by default\./)).toBeTruthy()
    expect(screen.queryByText(/Owners and admins only/)).toBeNull()
  })
})

describe('Settings → Delete stays the owner’s', () => {
  const layout = SOURCE('app/(app)/[orgSlug]/settings/(sections)/layout.tsx')
  const card = SOURCE('components/settings/org-delete-card.component.tsx')

  it('the section still asks for the owner', () => {
    expect(layout).toContain("section(Route.ORG_SETTINGS_DELETE, 'Delete', isOwner, OWNER)")
    expect(layout).toContain("const isOwner = currentOrg?.role === 'owner'")
  })

  it('holds no copy of the card, and sends the owner to where it lives', () => {
    expect(card).not.toContain('DataExportCard')
    expect(card).toContain('buildRoute(Route.ORG_SETTINGS_DATA, { orgSlug })')
  })

  it('the Import & export section opens to a holder', () => {
    expect(layout).toContain("section(Route.ORG_SETTINGS_DATA, 'Import & export', transferHubVisible, DATA)")
    expect(SOURCE('hooks/use-transfer-hub-visible.ts')).toContain("can('org.export')")
  })
})
