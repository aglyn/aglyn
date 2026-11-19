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
import { QUOTE_DEFAULT_APPROVAL_STATEMENTS, QUOTE_MAX_APPROVAL_STATEMENTS } from './model/commerce-quotes'

/** The native Quotes settings screen restates the console's suggested statements and their cap (AGL-4206). */
const screen = (
  JSON.parse(
    readFileSync(join(__dirname, '../ios/Sources/AglynCommercePlugin/Resources/commerce-store2.screens.json'), 'utf8'),
  ).screens as any[]
).find((one) => one.id === 'commerce.quoteSettings')

describe('native quote settings', () => {
  it('start quotes with the console defaults and its statement cap', () => {
    expect(screen.constants.defaultStatements).toEqual([...QUOTE_DEFAULT_APPROVAL_STATEMENTS])
    expect(screen.blocks[0].submit.disabledWhen).toContain(`form.approvalStatements.${QUOTE_MAX_APPROVAL_STATEMENTS}`)
    expect(screen.blocks[0].fields.find((field: { key: string }) => field.key === 'approvalStatements').help).toContain(
      `up to ${QUOTE_MAX_APPROVAL_STATEMENTS}`,
    )
  })
})
