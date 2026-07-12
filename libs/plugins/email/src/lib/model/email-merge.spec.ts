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

import { hasMergeTags, resolveMergeTags } from './email-merge'

describe('resolveMergeTags', () => {
  const recipient = { email: 'ada@example.com', name: 'Ada Lovelace' }

  it('substitutes name, firstName, and email', () => {
    expect(
      resolveMergeTags('Hi {{firstName}} ({{name}}, {{email}})', recipient),
    ).toBe('Hi Ada (Ada Lovelace, ada@example.com)')
  })

  it('uses the pipe fallback when the value is missing', () => {
    expect(
      resolveMergeTags('Hi {{name|there}}!', { email: 'x@example.com' }),
    ).toBe('Hi there!')
  })

  it('renders empty for unknown values without a fallback', () => {
    expect(resolveMergeTags('Hi {{name}}!', { email: 'x@example.com' })).toBe(
      'Hi !',
    )
  })

  it('never leaks the raw token for unrecognized tags', () => {
    expect(
      resolveMergeTags('{{company|our team}} says hi', recipient),
    ).toBe('our team says hi')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(resolveMergeTags('{{ firstName }}', recipient)).toBe('Ada')
  })

  it('leaves plain text untouched', () => {
    expect(resolveMergeTags('No tags here', recipient)).toBe('No tags here')
  })
})

describe('hasMergeTags', () => {
  it('detects tags and stays stateless across calls', () => {
    expect(hasMergeTags('Hello {{name}}')).toBe(true)
    expect(hasMergeTags('Hello {{name}}')).toBe(true)
    expect(hasMergeTags('Hello world')).toBe(false)
  })
})
