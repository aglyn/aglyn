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
import { detectTemplatePlaceholders as detectPlaceholders } from './detect-template-placeholders'


describe('detectPlaceholders (AGL-672)', () => {
  it('finds plain named tokens anywhere in the node tree', () => {
    expect(
      detectPlaceholders({
        a: { props: { text: 'Hello {{who}}' } },
        b: { props: { items: [{ label: '{{ product }}' }] } },
      }),
    ).toEqual(['product', 'who'])
  })

  /**
   * The load-bearing case. `{{var:id}}` and `{{fn:id()}}` are host bindings
   * that resolve against the site's own variables and functions at render
   * time. Declaring one as a template placeholder would prompt for it and
   * overwrite the binding — breaking content that already worked.
   */
  it('ignores host variable and function bindings', () => {
    expect(
      detectPlaceholders({
        a: { props: { text: '{{var:abc123}} and {{fn:total(1)}}' } },
      }),
    ).toEqual([])
  })

  it('keeps named tokens that sit alongside bindings', () => {
    expect(
      detectPlaceholders({
        a: { props: { text: '{{var:abc}} for {{customer}}' } },
      }),
    ).toEqual(['customer'])
  })

  it('deduplicates repeats and returns a stable order', () => {
    expect(
      detectPlaceholders({
        a: { props: { text: '{{who}} {{who}}' } },
        b: { props: { text: '{{alpha}}' } },
      }),
    ).toEqual(['alpha', 'who'])
  })

  it('returns nothing for content with no tokens', () => {
    expect(detectPlaceholders({ a: { props: { text: 'Plain copy' } } })).toEqual(
      [],
    )
  })

  it('tolerates nulls and non-string values without throwing', () => {
    expect(
      detectPlaceholders({
        a: { props: { text: null, count: 3, flag: true } },
        b: null as unknown as Record<string, unknown>,
      }),
    ).toEqual([])
  })
})
