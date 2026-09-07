/**
 * @jest-environment jsdom
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
 * The shared advertising mount hands the request's CSP nonce to BOTH elements
 * of every vendor pair, asserted on the script elements themselves.
 *
 * The production defect this pins: a surface enforcing a nonce'd `script-src`
 * refused the inline boot of every pair while the library beside it loaded,
 * because `next/script` stamps a nonce only when one reaches it and the App
 * Router's client-side head manager carries none. The library then ran with
 * no account configured and no consent declared, and nothing but a CSP
 * violation said so. The nonce is therefore a PROP, and the test is whether
 * the attribute lands on the elements — the layer the browser reads.
 *
 * Every positive case asserts non-emptiness before it asserts a property, so
 * a fixture that mounted nothing could not pass on `[].every()`.
 */
import {
  ADVERTISING_TAG_ATTRIBUTE,
  LINKEDIN_INSIGHT_VENDOR,
  META_PIXEL_VENDOR,
  type ResolvedAdvertisingTag,
} from './advertising-tags'
import AdvertisingTagMounts from './advertising-tag-mounts'
import { act, render } from '@testing-library/react'

/**
 * `next/script` is inert in jsdom, so it is replaced with a double that
 * appends a REAL `<script>` carrying every string prop — `nonce` included —
 * imperatively rather than as a React child, which is how the real one
 * behaves at `afterInteractive` and why the teardown removes elements by
 * hand. The attribute the case reads is only ever the one the mount passed:
 * the double invents nothing.
 */
jest.mock('next/script', () => {
  const react = jest.requireActual('react')
  return {
    __esModule: true,
    default: (props: Record<string, any>): null => {
      const { children, strategy, src, id, ...rest } = props
      react.useEffect(() => {
        const doc = globalThis.document
        const element = doc.createElement('script')
        element.setAttribute('data-testid', String(id))
        for (const [key, value] of Object.entries(rest)) {
          if (typeof value === 'string') element.setAttribute(key, value)
        }
        if (src) element.setAttribute('src', String(src))
        if (children) element.textContent = String(children)
        doc.head.appendChild(element)
        return () => {
          if (element.parentNode) element.parentNode.removeChild(element)
        }
      }, [])
      return null
    },
  }
})

const NONCE = 'c0ffee0123456789'

/** Two vendors that each bring their own library — four elements in all. */
const TAGS: readonly ResolvedAdvertisingTag[] = [
  { vendor: META_PIXEL_VENDOR, accountId: '1234567890123456' },
  { vendor: LINKEDIN_INSIGHT_VENDOR, accountId: '9626898' },
]

/** Every element the mount is answerable for, by the marker it stamps live. */
const markedScripts = () =>
  Array.from(
    document.querySelectorAll<HTMLScriptElement>(
      `script[${ADVERTISING_TAG_ATTRIBUTE}]`,
    ),
  )

async function mount(nonce?: string) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(
      <AdvertisingTagMounts
        active
        tags={TAGS}
        resolve={() => TAGS}
        nonce={nonce}
      />,
    )
  })
  return result
}

afterEach(() => {
  for (const element of markedScripts()) element.remove()
})

describe('the advertising mount and the CSP nonce', () => {
  it('stamps the nonce onto the inline boot AND the library of every pair', async () => {
    await mount(NONCE)

    // Non-emptiness first: two vendors, a boot and a library each.
    const scripts = markedScripts()
    expect(scripts).toHaveLength(4)

    // Split by role so a nonce reaching only one half cannot hide behind an
    // aggregate. The boot is the half the policy actually refuses; the library
    // gets it too, so a surface that ever drops `https:` from its directive
    // does not lose the vendor's code the same silent way.
    const boots = scripts.filter((element) => !element.getAttribute('src'))
    const libraries = scripts.filter((element) => element.getAttribute('src'))
    expect(boots).toHaveLength(2)
    expect(libraries).toHaveLength(2)
    for (const element of [...boots, ...libraries]) {
      expect(element.getAttribute('nonce')).toBe(NONCE)
    }
  })

  it('stamps nothing when no nonce is handed down, so the attribute is the prop', async () => {
    // The control for the case above: a double that stamped a nonce of its own
    // would make that case pass against a mount that forwards nothing.
    await mount(undefined)

    const scripts = markedScripts()
    expect(scripts).toHaveLength(4)
    for (const element of scripts) {
      expect(element.hasAttribute('nonce')).toBe(false)
    }
  })
})
