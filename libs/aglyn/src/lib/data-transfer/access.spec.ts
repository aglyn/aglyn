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

import {
  TRANSFER_MANAGE_PERMISSION,
  transferAccessAllowed,
  transferAccessPermissions,
  transferRouteIntent,
} from './access'

const holding = (...keys: string[]) => ({ holds: (key: string) => keys.includes(key), reachesSite: true })

describe('transfer access (AGL-3546)', () => {
  it('reads export and the export dialog’s fields as exporting, and every other route as importing', () => {
    expect(transferRouteIntent('export')).toBe('export')
    expect(transferRouteIntent('fields')).toBe('export')
    for (const route of ['upload', 'analyze', 'plan', 'apply', 'status', 'undo'] as const) {
      expect(transferRouteIntent(route)).toBe('import')
    }
  })

  it('imports with Manage data whatever the resource reads with', () => {
    expect(transferAccessPermissions('import', null)).toEqual([TRANSFER_MANAGE_PERMISSION])
    expect(transferAccessPermissions('import', { readPermission: 'books.read' })).toEqual([TRANSFER_MANAGE_PERMISSION])
    expect(transferAccessAllowed('import', null, holding())).toBe(false)
    expect(transferAccessAllowed('import', null, holding('data.manage'))).toBe(true)
  })

  it('exports with Manage data unless the resource says who else may read it', () => {
    expect(transferAccessPermissions('export', null)).toEqual(['data.manage'])
    expect(transferAccessPermissions('export', {})).toEqual(['data.manage'])
    expect(transferAccessAllowed('export', {}, holding())).toBe(false)
    expect(transferAccessAllowed('export', {}, holding('data.manage'))).toBe(true)
  })

  it('exports with membership alone for a resource every member may read', () => {
    expect(transferAccessPermissions('export', { readableByMembers: true })).toEqual([])
    expect(transferAccessAllowed('export', { readableByMembers: true }, holding())).toBe(true)
    expect(transferAccessAllowed('import', { readableByMembers: true }, holding())).toBe(false)
  })

  it('exports with the permission a resource declares it reads with, or Manage data', () => {

    expect(transferAccessPermissions('export', { readPermission: 'books.read' })).toEqual(['books.read', 'data.manage'])
    expect(transferAccessPermissions('export', { readPermission: 'data.manage' })).toEqual(['data.manage'])
    expect(transferAccessAllowed('export', { readPermission: 'books.read' }, holding())).toBe(false)
    expect(transferAccessAllowed('export', { readPermission: 'books.read' }, holding('books.read'))).toBe(true)
    expect(transferAccessAllowed('export', { readPermission: 'books.read' }, holding('data.manage'))).toBe(true)
  })

  it('refuses a member who does not reach the named site, whatever they hold', () => {
    const away = { holds: () => true, reachesSite: false }
    expect(transferAccessAllowed('export', { readableByMembers: true }, away)).toBe(false)
    expect(transferAccessAllowed('import', {}, away)).toBe(false)
  })
})
