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
  transferImportRoleAllowed,
  transferImportRoleRefusal,
  transferRouteIntent,
  transferWorkspaceRole,
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
 * A resource stricter than `data.manage` names its `importRoles` (AGL-3554):
 * gift cards, imported by a site's admins — a workspace's owners and admins
 * are every site's admin — and by nobody else, whatever they hold. Exporting
 * never asks the role.
 */
describe('import roles (AGL-3554)', () => {
  const giftCards = { key: 'gifts', label: 'Gift cards', scope: 'host' as const, importRoles: ['admin'] as const }
  const manager = (role: 'admin' | 'editor' | null) => ({ holds: () => true, reachesSite: true, role })

  it('imports only for a member in one of the roles, on top of the permission', () => {
    expect(transferAccessAllowed('import', giftCards, manager('admin'))).toBe(true)
    expect(transferAccessAllowed('import', giftCards, manager('editor'))).toBe(false)
    expect(transferAccessAllowed('import', giftCards, manager(null))).toBe(false)
    expect(transferAccessAllowed('import', giftCards, { holds: () => false, reachesSite: true, role: 'admin' })).toBe(false)
  })

  it('never asks the role to export, nor of a resource that names none', () => {
    expect(transferAccessAllowed('export', giftCards, manager('editor'))).toBe(true)
    expect(transferImportRoleAllowed('import', {}, null)).toBe(true)
    expect(transferImportRoleAllowed('export', giftCards, null)).toBe(true)
  })

  it('reads a workspace role as the site role it is everywhere', () => {
    expect(transferWorkspaceRole('owner')).toBe('admin')
    expect(transferWorkspaceRole('admin')).toBe('admin')
    expect(transferWorkspaceRole('editor')).toBe('editor')
    expect(transferWorkspaceRole('stranger')).toBeNull()
    expect(transferWorkspaceRole(undefined)).toBeNull()
  })

  it('refuses in a sentence naming who may', () => {
    expect(transferImportRoleRefusal(giftCards)).toBe('Only the workspace’s owners and admins, and the site’s admins, can import gift cards.')
    expect(transferImportRoleRefusal({ ...giftCards, scope: 'org' })).toBe('Only the workspace’s owners and admins can import gift cards.')
    expect(transferImportRoleRefusal({ ...giftCards, importRoles: ['admin', 'editor'] })).toBe(
      'Importing gift cards needs one of these roles on the site: Admin, Editor.',
    )
  })

  it('is refused at registration on a resource never imported, or naming an unknown role', () => {
    const base = { key: 'gifts', label: 'Gift cards', scope: 'host' as const, kinds: ['records' as const], formats: ['csv' as const] }
    expect(transferResourceProblems({ ...base, importRoles: ['admin'] })).toEqual([])
    expect(transferResourceProblems({ ...base, exportOnly: true, importRoles: ['admin'] })).toEqual([
      'gifts names who may import records it never imports.',
    ])
    expect(transferResourceProblems({ ...base, importRoles: ['owner' as never] })).toEqual([
      'gifts names an import role that is not admin, editor, author, viewer.',
    ])
  })
})
