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
import { REPORT_FIELDS } from '../app/api/_lib/linear-issues'

/**
 * The native apps' "Report an issue" asks exactly what the console's dialog
 * asks. The route validates the answers against `REPORT_FIELDS` for the kind,
 * so a native form that drifts from it either files a thinner report than the
 * console would or is refused with "Please answer: ..." for a field it never
 * showed (the bug kind has four required answers; the first native form sent
 * one).
 */
const SPEC = join(
  __dirname,
  '../../../libs/native/screens/account.screens.json',
)

interface PromptField {
  key: string
  kind?: string
  required?: boolean
  when?: string
  options?: { value: string }[]
}

function reportAction(): {
  prompt: PromptField[]
  body: { answers: Record<string, string>; skipDeflection: string }
} {
  const spec = JSON.parse(readFileSync(SPEC, 'utf8'))
  const support = spec.screens.find((s: { id: string }) => s.id === 'core.support')
  const block = support.blocks.find(
    (b: { title?: string }) => b.title === 'Report an issue',
  )
  return block.items[0]
}

describe('native report-an-issue form', () => {
  const action = reportAction()

  for (const [kind, fields] of Object.entries(REPORT_FIELDS)) {
    describe(kind, () => {
      for (const field of fields) {
        it(`asks "${field.id}" as the console does`, () => {
          const asked = action.prompt.find((p) => p.key === field.id)
          expect(asked).toBeDefined()
          expect(asked?.when).toBe(`form.kind == ${kind}`)
          expect(Boolean(asked?.required)).toBe(field.required)
          expect(asked?.kind).toBe(field.choices ? 'select' : 'multiline')
          if (field.choices) {
            expect(asked?.options?.map((o) => o.value)).toEqual(
              field.choices.map((c) => c.value),
            )
          }
          expect(action.body.answers[field.id]).toBe(`{form.${field.id}}`)
        })
      }
    })
  }

  it('lets a question skip the documentation answer, as "send anyway" does', () => {
    expect(action.body.skipDeflection).toBe('{form.skipDeflection}')
    expect(action.prompt.find((p) => p.key === 'skipDeflection')?.when).toBe(
      'form.kind == question',
    )
  })
})
