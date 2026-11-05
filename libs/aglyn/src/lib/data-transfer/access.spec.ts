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
  transferImportPermission,
  transferRouteIntent,
} from './access'
import { transferResourceProblems } from './resource'

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
    // `readPermissionOnly` (AGL-4047): taking the key from someone who may write the records stops the export too.
    expect(transferAccessPermissions('export', { readPermission: 'data.export', readPermissionOnly: true })).toEqual(['data.export'])
    expect(transferAccessPermissions('export', { readPermission: 'data.export' })).toEqual(['data.export', 'data.manage'])
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

/*
 * A resource stricter than `data.manage` names its `importPermission`
 * (AGL-4047): gift cards, imported by whoever holds "Import gift cards".
 * Exporting never asks it.
 */
describe('the import permission (AGL-4047)', () => {
  const giftCards = { key: 'gifts', label: 'Gift cards', scope: 'host' as const, importPermission: 'gifts.import' }
  const holding = (...keys: string[]) => ({ holds: (key: string) => keys.includes(key), reachesSite: true })

  it('imports only for a member holding the key, on top of Manage data', () => {
    expect(transferAccessAllowed('import', giftCards, holding('data.manage', 'gifts.import'))).toBe(true)
    expect(transferAccessAllowed('import', giftCards, holding('data.manage'))).toBe(false)
    expect(transferAccessAllowed('import', giftCards, holding('gifts.import'))).toBe(false)
  })

  it('never asks it to export, nor of a resource that names none', () => {
    expect(transferAccessAllowed('export', giftCards, holding('data.manage'))).toBe(true)
    expect(transferImportPermission('export', giftCards)).toBeNull()
    expect(transferImportPermission('import', {})).toBeNull()
    expect(transferImportPermission('import', giftCards)).toBe('gifts.import')
  })

  it('is refused at registration on a resource never imported, or naming nothing', () => {
    const base = { key: 'gifts', label: 'Gift cards', scope: 'host' as const, kinds: ['records' as const], formats: ['csv' as const] }
    expect(transferResourceProblems({ ...base, importPermission: 'gifts.import' })).toEqual([])
    expect(transferResourceProblems({ ...base, exportOnly: true, importPermission: 'gifts.import' })).toEqual([
      'gifts names who may import records it never imports.',
    ])
    expect(transferResourceProblems({ ...base, importPermission: ' ' })).toEqual(['gifts names an empty import permission.'])
  })
})
