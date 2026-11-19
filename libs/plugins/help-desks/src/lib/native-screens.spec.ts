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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HELP_DESKS_API_ROUTES } from './constants'
import { HELP_DESK_PROVIDERS, HELP_DESK_PROVIDER_IDS } from './model/connections'

/**
 * The native Help desks screens restate the console card's table of help desks (their words, the credential fields
 * each asks for, the menu each offers) and call its routes. This keeps them from drifting from the console.
 */
const spec = JSON.parse(
  readFileSync(join(__dirname, '../ios/Sources/AglynHelpDesksPlugin/Resources/help-desks.screens.json'), 'utf8'),
)
const screens: Record<string, any> = Object.fromEntries(spec.screens.map((screen: { id: string }) => [screen.id, screen]))

describe('native help desks screens', () => {
  it('offer every help desk with the console words and credential fields', () => {
    for (const id of ['help-desks.service', 'help-desks.provider']) {
      expect(
        screens[id].constants.providers.map((row: any) => [row.id, row.label, row.orders, row.ticketNoun, row.target, row.fields.map((field: any) => [field.key, field.label, field.secret])]),
      ).toEqual(
        HELP_DESK_PROVIDER_IDS.map((provider) => {
          const info = HELP_DESK_PROVIDERS[provider]
          return [info.id, info.label, info.orders, info.ticketNoun, info.target, info.fields.map((field) => [field.key, field.label, field.secret])]
        }),
      )
    }
  })

  it('call the console card routes', () => {
    const text = JSON.stringify(spec)
    for (const route of Object.values(HELP_DESKS_API_ROUTES)) expect(text).toContain(`/api/${route}`)
  })
})
