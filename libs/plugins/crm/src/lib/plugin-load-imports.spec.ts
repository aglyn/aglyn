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

import { readFileSync } from 'fs'
import { resolve } from 'path'

import * as fields from './transfer/fields'
import * as resourceKeys from './transfer/resource-keys'
import { localDayBounds as reportsLocalDayBounds } from './model/crm-reports'
import { localDayBounds } from './model/local-day-bounds'

/**
 * What the CRM plugin reads the moment it loads (AGL-4047).
 *
 * The console loads CRM on every screen it fills, and `check:plugin-budgets`
 * holds the bytes of that load to 50 KB. Two load-time modules each reached
 * into a large module for one small name: the transfer labels for the
 * resource keys in `transfer/fields.ts` (every field table, about 9 KB) and
 * the glance card for `localDayBounds` in `model/crm-reports.ts` (the report
 * tables, about 7 KB). They read the small modules instead.
 */

const source = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

/** The specifiers of every `import … from` statement, comments ignored. */
const specifiers = (text: string) =>
  [
    ...text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .matchAll(/^import\s[\s\S]*?\sfrom\s+'([^']+)'/gm),
  ].map((match) => match[1])

describe('the CRM plugin reads small modules when it loads (AGL-4047)', () => {
  it('the transfer labels read the resource keys, not the field tables', () => {
    expect(specifiers(source('transfer/ui.ts'))).not.toContain('./fields')
    expect(specifiers(source('transfer/ui.ts'))).toContain('./resource-keys')
  })

  it('the glance card reads the day bounds, not the report tables', () => {
    const card = specifiers(source('components/crm-glance-card.tsx'))
    expect(card).not.toContain('../model/crm-reports')
    expect(card).toContain('../model/local-day-bounds')
  })

  it('the moved names are the same values where they used to be', () => {
    for (const [name, value] of Object.entries(resourceKeys)) {
      expect((fields as Record<string, unknown>)[name]).toBe(value)
    }
    expect(reportsLocalDayBounds).toBe(localDayBounds)
  })

  it('every resource key is one plugins.config.json declares for the CRM', () => {
    const config = readFileSync(
      resolve(__dirname, '../../../../../plugins.config.json'),
      'utf8',
    )
    for (const key of Object.values(resourceKeys)) {
      expect(config).toContain(`"key": "${key}"`)
    }
  })
})
