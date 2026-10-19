/**
 * @jest-environment node
 *
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

/**
 * One-click DNS registers its four doors and its sweep (AGL-3963), and the
 * return door, which names no site, tells the release gate whose it is.
 */

import {
  listPluginConsoleCrons,
  resetPluginConsoleCronsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { resolvePluginApiMatch } from '@aglyn/aglyn/server'
import { DOMAINS_API_ROUTES } from '../../constants/bundle-common'
import { registerDomainConnectDeclarations } from './declarations'
import { registerDomainConnectRoutes } from './routes'

describe('registration', () => {
  it('serves discover, start, finish and the return page', () => {
    registerDomainConnectRoutes()
    for (const path of [
      DOMAINS_API_ROUTES.connectDiscover,
      DOMAINS_API_ROUTES.connectStart,
      DOMAINS_API_ROUTES.connectFinish,
      DOMAINS_API_ROUTES.connectReturn,
    ]) {
      expect([path, Boolean(resolvePluginApiMatch(path))]).toEqual([path, true])
    }
  })

  it('declares the console sweep under the plugin’s own id', () => {
    resetPluginConsoleCronsForTests()
    registerDomainConnectDeclarations()
    expect(listPluginConsoleCrons()).toEqual([
      expect.objectContaining({ pluginId: 'domains', id: 'domains-connect-sessions', label: 'One-click DNS' }),
    ])
  })
})
