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
 */

/**
 * A connected app's writes say so (AGL-4225): "Connected app Cursor", never
 * "API key Cursor" — in the activity feeds, a run's trigger, the search
 * tokens, and the staff mail, where the name is also kept from becoming a
 * link because the app chose it.
 */

import {
  activityActorLabel,
  connectedAppActorLabel,
  runTriggeredByLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
import {
  apiActorFields,
  apiActorLabel,
  isConnectedAppContext,
} from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unlinkable } from '../app/api/_lib/growth-announcements'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

describe('connected-app attribution (AGL-4225)', () => {
  const key = { credential: 'api_key' as const, keyName: 'Zapier' }
  const app = { credential: 'connected_app' as const, keyName: 'Cursor' }

  it('labels a write by the kind of credential that made it', () => {
    expect(apiActorLabel(key)).toBe('API key Zapier')
    expect(apiActorLabel(app)).toBe('Connected app Cursor')
    expect(apiActorLabel({ keyName: 'Old key' })).toBe('API key Old key')
    expect(apiActorLabel({ credential: 'connected_app', keyName: null })).toBe('A connected app')
    expect(isConnectedAppContext(app)).toBe(true)
  })

  it('stores the name in the field that says which it is', () => {
    expect(apiActorFields(key)).toEqual({ apiKeyName: 'Zapier' })
    expect(apiActorFields(app)).toEqual({ connectedAppName: 'Cursor' })
  })

  it('reads an activity entry and a run trigger back with the right label', () => {
    expect(activityActorLabel({ actorId: 'api', connectedAppName: 'Cursor' })).toBe('Connected app Cursor')
    expect(activityActorLabel({ actorId: 'api', apiKeyName: 'Zapier' })).toBe('API key Zapier')
    expect(runTriggeredByLabel({ triggeredBy: { kind: 'apiKey', connectedAppName: 'Cursor' } })).toBe('Connected app Cursor')
    expect(connectedAppActorLabel('X')).toBe('Connected app X')
  })

  it('finds an entry by the app’s name', () => {
    expect(activitySearchTokens({ connectedAppName: 'Cursor' })).toEqual(expect.arrayContaining(['cursor']))
  })

  it('keeps a self-chosen name from becoming a link in staff mail', () => {
    const shown = unlinkable('Connected app evil.com/login') as string
    expect(shown.replace(/​/g, '')).toBe('Connected app evil.com/login')
    expect(shown).not.toMatch(/evil\.com/)
    expect(unlinkable('Connected app https://evil.com')).not.toMatch(/https:\/\//)
    expect(unlinkable(null)).toBeNull()
  })

  it('names a Zapier hook a connection subscribed as the connection, not as an API key', () => {
    const card = read('libs/plugins/zapier/src/lib/components/zapier-card.component.tsx')
    expect(card).toContain('hook.keyLabel')
    expect(read('libs/plugins/zapier/src/lib/server/hooks-api.ts')).toContain('keyLabel: apiActorLabel(ctx)')
    expect(read('libs/plugins/zapier/src/ios/Sources/AglynZapierPlugin/Resources/zapier.screens.json')).toContain('{item.keyLabel|item.keyName}')
  })

  it('gives the native activity lists and run histories the labelled name, never the raw one', () => {
    for (const screens of ['site', 'team', 'staff']) {
      const json = read(`libs/native/screens/${screens}.screens.json`)
      expect(json).toContain('item.connectedAppLabel')
      expect(json).not.toContain('item.connectedAppName')
    }
    // The host activity writer stores that label beside the name.
    expect(read('libs/tenant/data/admin/src/lib/server/organizations.ts')).toContain(
      'connectedAppLabel: connectedAppActorLabel(actor.connectedAppName)',
    )
    expect(read('libs/native/apple/Sources/AglynContracts/AutomationRules.swift')).toContain('"Connected app \\(app)"')
    expect(read('libs/native/kotlin/contracts/src/commonMain/kotlin/com/aglyn/contracts/AutomationRules.kt')).toContain(
      '"Connected app $it"',
    )
  })

  it('breaks only a connected app’s name in staff mail; a key’s name is shown as typed', () => {
    const resources = read('apps/console/utils/api-v1-resources.ts')
    expect(resources).toContain('createdByIsName: isConnectedAppContext(ctx)')
  })
})

