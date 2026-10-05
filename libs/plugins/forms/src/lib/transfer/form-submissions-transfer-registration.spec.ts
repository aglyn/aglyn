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
 * THE SUBMISSIONS EXPORT, REGISTERED WHERE THE CONSOLE LOOKS FOR IT.
 *
 * The real declaration (the generated `PLUGIN_TRANSFER_RESOURCES_DECLARED`),
 * the real extension point, and this plugin's real registrars: the server
 * half from the console-server declarations, the client half from the
 * console registrar. The Admin app is a stand-in, so the lazy hooks are shown
 * to reach Firestore through it without a project.
 */

const mockFirestoreCalls: string[] = []
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        mockFirestoreCalls.push('firestore')
        return {}
      },
    }),
  },
}))

import { PLUGIN_TRANSFER_RESOURCES_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import {
  pluginTransferResourceProblems,
  pluginTransferResourceUi,
  resetTransferResourceUisForTests,
  resetTransferResourcesForTests,
  resolveTransferResource,
  transferRecordsHooks,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { BUNDLE_ID } from '../constants/bundle-common'
import { registerFormsConsoleServerDeclarations } from '../declarations.console-server'
import { registerFormsConsole } from '../plugin'
import { FORM_SUBMISSIONS_TRANSFER_KEY } from './form-submissions-transfer-key'

beforeEach(() => {
  resetTransferResourcesForTests()
  resetTransferResourceUisForTests()
  mockFirestoreCalls.length = 0
})

describe('forms.submissions on the transfer extension point', () => {
  it('is declared by this plugin, host-scoped and export only', () => {
    const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find((one) => one.key === FORM_SUBMISSIONS_TRANSFER_KEY)
    expect(declared).toMatchObject({ pluginId: BUNDLE_ID, scope: 'host', kinds: ['records'] })
    expect(declared?.exportOnly).toBe(true)
  })

  it('registers a server half the extension point accepts, with no write', async () => {
    registerFormsConsoleServerDeclarations()
    const resolved = await resolveTransferResource(FORM_SUBMISSIONS_TRANSFER_KEY)
    const declared = PLUGIN_TRANSFER_RESOURCES_DECLARED.find((one) => one.key === FORM_SUBMISSIONS_TRANSFER_KEY)
    expect(declared).toBeDefined()
    expect(pluginTransferResourceProblems(declared as NonNullable<typeof declared>, resolved.impl)).toEqual([])
    expect(resolved.impl.lookup).toBeInstanceOf(Function)
    expect(resolved.impl.apply).toBeUndefined()
    expect(resolved.impl.revert).toBeUndefined()
    expect(resolved.impl.count).toBeInstanceOf(Function)
    // Registering read nothing: the resource and the Admin app load with the first export.
    expect(mockFirestoreCalls).toEqual([])
  })

  it('reaches Firestore through the Admin app when an export first asks', async () => {
    registerFormsConsoleServerDeclarations()
    const hooks = transferRecordsHooks(await resolveTransferResource(FORM_SUBMISSIONS_TRANSFER_KEY))
    const catalog = await hooks.fields({
      resource: FORM_SUBMISSIONS_TRANSFER_KEY,
      orgId: 'org-1',
      hostId: null,
      actorUid: 'uid-1',
    })
    expect(catalog.standard.map((field) => field.id)).toContain('createdAt')
    expect(mockFirestoreCalls).toEqual(['firestore'])
  })

  it('registers the client half from the console registrar', () => {
    registerFormsConsole()
    expect(pluginTransferResourceUi(FORM_SUBMISSIONS_TRANSFER_KEY)).toMatchObject({
      label: 'Form submissions',
      pluginId: BUNDLE_ID,
    })
  })
})
