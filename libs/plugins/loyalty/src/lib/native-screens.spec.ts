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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOYALTY_API_ROUTES } from './constants/api-routes'
import {
  LOYALTY_CONNECTOR_FIELDS,
  LOYALTY_CONNECTOR_LABELS,
  LOYALTY_DISCONNECT_EXPLANATION,
  LOYALTY_SYNC_STATUS_WORDS,
} from './model/loyalty-connectors'
import { LOYALTY_LEDGER_LABELS } from './model/loyalty-member'
import { LOYALTY_PROGRAM_BOUNDS } from './model/loyalty-program'

/**
 * The Rewards plugin's native screens restate what the console works out in code, because a screen spec has no tables of
 * its own: the bounds each program number is held to, the words for a movement, the keys each service asks for. This
 * keeps them from drifting from the console's cards, and holds every route they call to the plugin's route table.
 */
const RESOURCES = join(
  __dirname,
  '../ios/Sources/AglynLoyaltyPlugin/Resources',
)

const files = readdirSync(RESOURCES).filter((name) =>
  name.endsWith('.screens.json'),
)
const screens: Record<string, any> = {}
for (const file of files) {
  for (const screen of JSON.parse(readFileSync(join(RESOURCES, file), 'utf8'))
    .screens as any[]) {
    screens[screen.id] = screen
  }
}

const rows = (list: Array<{ id: string; label: string }>) =>
  list.map((row) => [row.id, row.label])

describe('native loyalty screens', () => {
  it('hold every program number to the bounds the route holds it to', () => {
    const form = screens['loyalty.rewards'].blocks.find(
      (block: { id: string }) => block.id === 'program',
    )
    const fields = Object.fromEntries(
      form.fields.map((field: { key: string }) => [field.key, field]),
    )
    for (const [key, [min, max]] of Object.entries(LOYALTY_PROGRAM_BOUNDS)) {
      const field = fields[key] as { min: number; max: number; integer?: boolean }
      // A reward in cents is typed in dollars.
      const scale = key.endsWith('Cents') ? 100 : 1
      expect([key, field.min, field.max]).toEqual([key, min / scale, max / scale])
      expect([key, Boolean(field.integer)]).toEqual([key, scale === 1])
    }
  })

  it('send the program as the console does: whole cents for money, only named fields', () => {
    const form = screens['loyalty.rewards'].blocks.find(
      (block: { id: string }) => block.id === 'program',
    )
    const program = form.submit.body.program
    for (const key of Object.keys(LOYALTY_PROGRAM_BOUNDS)) {
      if (key.endsWith('Cents')) expect(program[key]).toHaveProperty('$cents')
      else expect(typeof program[key]).toBe('string')
    }
    expect(Object.keys(program).sort()).toEqual(
      [...Object.keys(LOYALTY_PROGRAM_BOUNDS), 'enabled', 'referralsEnabled', 'emails'].sort(),
    )
  })

  it('name the services, the movements and the sync states in the console words', () => {
    expect(rows(screens['loyalty.rewards'].constants.connectors)).toEqual(
      Object.entries(LOYALTY_CONNECTOR_LABELS),
    )
    expect(rows(screens['loyalty.member'].constants.kinds)).toEqual(
      Object.entries(LOYALTY_LEDGER_LABELS),
    )
    expect(rows(screens['loyalty.connection'].constants.syncStatus)).toEqual(
      Object.entries(LOYALTY_SYNC_STATUS_WORDS),
    )
  })

  it('ask each service for the keys the console asks for', () => {
    const actions = screens['loyalty.connection'].blocks.find(
      (block: { id: string }) => block.id === 'connect',
    ).items as Array<{
      id: string
      prompt: Array<{ key: string; label: string; kind: string; help?: string }>
      body: { provider: string; credentials: Record<string, string> }
    }>
    for (const [provider, fields] of Object.entries(LOYALTY_CONNECTOR_FIELDS)) {
      const action = actions.find((item) => item.body.provider === provider)!
      expect(action.prompt.filter((field) => field.key !== 'replace')).toEqual(
        fields.map((field) =>
          expect.objectContaining({
            key: field.name,
            label: field.label,
            help: field.helper,
            kind: field.secret ? 'password' : 'text',
          }),
        ),
      )
      expect(Object.keys(action.body.credentials)).toEqual(
        fields.map((field) => field.name),
      )
    }
  })

  it('say what disconnecting does in the console words, and confirm it on the route', () => {
    const disconnect = screens['loyalty.connection'].blocks
      .find((block: { id: string }) => block.id === 'manage')
      .items.find((item: { id: string }) => item.id === 'disconnect')
    expect(disconnect.confirm).toContain(LOYALTY_DISCONNECT_EXPLANATION)
    expect(disconnect.body.confirm).toBe(true)
  })

  it('call only the routes the plugin keeps', () => {
    const known = new Set(
      Object.values(LOYALTY_API_ROUTES).map((route) => `/api/${route}`),
    )
    const called = new Set<string>()
    for (const file of files) {
      const text = readFileSync(join(RESOURCES, file), 'utf8')
      for (const match of text.matchAll(/\/api\/loyalty\/[a-z-]+/g)) {
        called.add(match[0])
      }
    }
    expect(called.size).toBeGreaterThan(0)
    for (const route of called) expect(known).toContain(route)
  })

  it('key every balance change by the press, not the request', () => {
    const give = screens['loyalty.members'].blocks
      .find((block: { id: string }) => block.id === 'tools')
      .items.find((item: { id: string }) => item.id === 'give')
    const adjust = screens['loyalty.member'].blocks
      .find((block: { id: string }) => block.id === 'adjust')
      .items.find((item: { id: string }) => item.id === 'adjust')
    for (const action of [give, adjust]) {
      expect(action.url).toBe(`/api/${LOYALTY_API_ROUTES.member}`)
      expect(action.headers).toEqual({ 'Idempotency-Key': '{press}' })
      expect(action.body.creditCents).toEqual({ $cents: '{form.credit}' })
    }
  })
})
