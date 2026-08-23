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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-2486 — the plugin CSS route onto every site surface.
 *
 * The pragma lives inside the license docblock deliberately: jest reads
 * `@jest-environment` only from the FIRST docblock, and libs/aglyn's config is
 * `testEnvironment: 'node'`, so a second block would be silently ignored and
 * every `document` reference here would throw.
 *
 * ## What these assert against, and why
 *
 * The cascade claim is "plugin CSS occupies the same UNLAYERED slot on the
 * canvas that it occupies on the published page". Rendered markup cannot say
 * that — the `<style>` text is byte-identical whether or not something else
 * later wraps it — so the layer assertions read `document.styleSheets` and
 * inspect `cssText`.
 *
 * `cssText`, NOT `rule.name`: the jsdom bundled inside `jest-environment-jsdom`
 * builds a real `CSSLayerBlockRule` whose `.name` is `undefined` (standalone
 * jsdom returns the name), so keying a stylesheet walk off `.name` makes a
 * layered and an unlayered build indistinguishable and every assertion passes
 * against either. That cost the AGL-2486 canvas-layering work a debugging
 * round and is written down here so it costs nobody a second one.
 */

import { act, render } from '@testing-library/react'
import {
  capturePluginStyles,
  listPluginStyles,
  registerPluginStyles,
  resetPluginStylesForTest,
  subscribeToPluginStyles,
  unregisterPluginStyles,
} from './plugin-styles'
import { PluginStyles } from './plugin-styles-ui'

/**
 * Every rule the DOCUMENT is actually carrying, flattened, with a marker for
 * whether it arrived inside a cascade layer. Reads the CSSOM rather than
 * markup for the reason in the file docblock.
 */
function documentRules(): { text: string; layered: boolean }[] {
  const out: { text: string; layered: boolean }[] = []
  const walk = (rules: CSSRuleList, layered: boolean) => {
    for (const rule of Array.from(rules)) {
      const text = rule.cssText || ''
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested) {
        walk(nested, layered || text.trimStart().startsWith('@layer'))
        continue
      }
      out.push({ text, layered })
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    walk(rules, false)
  }
  return out
}

const ruleFor = (needle: string) =>
  documentRules().find((rule) => rule.text.includes(needle))

beforeEach(() => {
  resetPluginStylesForTest()
  document.head.querySelectorAll('style').forEach((node) => node.remove())
})

describe('registerPluginStyles', () => {
  it('renders a registered sheet into the document, UNLAYERED', () => {
    registerPluginStyles({ pluginId: 'p1', css: '.thing{color:rgb(1,2,3)}' })
    render(<PluginStyles scope="document" />)

    const rule = ruleFor('rgb(1,2,3)')
    // Fails on purpose if the component ever routes through an emotion cache:
    // the layered cache would wrap this in `@layer mui`, where it would start
    // LOSING to the component defaults it is supposed to beat.
    expect(rule).toBeDefined()
    expect(rule?.layered).toBe(false)
  })

  it('scrubs refused url() schemes with the published path’s sanitizer', () => {
    registerPluginStyles({
      pluginId: 'p1',
      css: '.thing{background-image:url(http://evil.example/x.png)}',
    })
    const [sheet] = listPluginStyles()
    expect(sheet.css).toContain('about:invalid')
    expect(sheet.css).not.toContain('evil.example')
  })

  it('leaves an https url() alone — hosts are not restricted here either', () => {
    const css = '.thing{background-image:url(https://cdn.example/x.png)}'
    registerPluginStyles({ pluginId: 'p1', css })
    expect(listPluginStyles()[0].css).toBe(css)
  })

  it('keeps sheets separate per styleId and replaces on the same pair', () => {
    registerPluginStyles({ pluginId: 'p1', styleId: 'a', css: '.a{top:1px}' })
    registerPluginStyles({ pluginId: 'p1', styleId: 'b', css: '.b{top:2px}' })
    expect(listPluginStyles()).toHaveLength(2)
    registerPluginStyles({ pluginId: 'p1', styleId: 'a', css: '.a{top:9px}' })
    expect(listPluginStyles()).toHaveLength(2)
    expect(listPluginStyles()[0].css).toBe('.a{top:9px}')
  })

  it('does not notify when identical css is registered again', () => {
    const listener = jest.fn()
    subscribeToPluginStyles(listener)
    registerPluginStyles({ pluginId: 'p1', css: '.a{top:1px}' })
    expect(listener).toHaveBeenCalledTimes(1)
    registerPluginStyles({ pluginId: 'p1', css: '.a{top:1px}' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unregisters one sheet, or every sheet a plugin owns', () => {
    registerPluginStyles({ pluginId: 'p1', styleId: 'a', css: '.a{top:1px}' })
    registerPluginStyles({ pluginId: 'p1', styleId: 'b', css: '.b{top:2px}' })
    registerPluginStyles({ pluginId: 'p2', css: '.c{top:3px}' })
    unregisterPluginStyles('p1', 'a')
    expect(listPluginStyles().map((s) => s.styleId)).toEqual(['b', 'default'])
    unregisterPluginStyles('p1')
    expect(listPluginStyles().map((s) => s.pluginId)).toEqual(['p2'])
  })
})

describe('PluginStyles', () => {
  it('renders sheets registered AFTER it mounted', () => {
    // Realm bundles load asynchronously, so this is the ordinary case rather
    // than an edge one: the canvas is normally mounted first.
    render(<PluginStyles scope="document" />)
    expect(ruleFor('rgb(4,5,6)')).toBeUndefined()
    act(() => {
      registerPluginStyles({ pluginId: 'p1', css: '.late{color:rgb(4,5,6)}' })
    })
    expect(ruleFor('rgb(4,5,6)')).toBeDefined()
  })

  it('withholds a MIRRORED sheet from a document surface and renders it in a shadow one', async () => {
    const injected = document.createElement('style')
    injected.textContent = '.mirrored{color:rgb(7,8,9)}'
    await capturePluginStyles('p1', async () => {
      document.head.appendChild(injected)
    })
    expect(listPluginStyles()[0].mirrored).toBe(true)

    // The original is still in the head — that is what a document surface is
    // relying on, and what keeps a plugin's console-side CSS working.
    expect(injected.isConnected).toBe(true)

    const doc = render(<PluginStyles scope="document" />)
    expect(doc.container.querySelectorAll('style')).toHaveLength(0)

    const shadow = render(<PluginStyles scope="shadow" />)
    expect(shadow.container.querySelectorAll('style')).toHaveLength(1)
    expect(shadow.container.querySelector('style')?.textContent).toBe(
      '.mirrored{color:rgb(7,8,9)}',
    )
  })

  it('renders a REGISTERED sheet on both scopes', async () => {
    registerPluginStyles({ pluginId: 'p1', css: '.both{top:1px}' })
    const doc = render(<PluginStyles scope="document" />)
    const shadow = render(<PluginStyles scope="shadow" />)
    expect(doc.container.querySelectorAll('style')).toHaveLength(1)
    expect(shadow.container.querySelectorAll('style')).toHaveLength(1)
  })
})

describe('capturePluginStyles', () => {
  it('captures a <style> the bundle appends to document.head while it loads', async () => {
    await capturePluginStyles('listing-1', async () => {
      // Exactly what `import './styles.css'` compiles to in every bundler.
      const style = document.createElement('style')
      style.textContent = '.from-bundle{color:rgb(1,2,3)}'
      document.head.appendChild(style)
    })
    expect(listPluginStyles()).toEqual([
      {
        pluginId: 'listing-1',
        styleId: 'captured-1',
        css: '.from-bundle{color:rgb(1,2,3)}',
        mirrored: true,
      },
    ])
  })

  it('captures across an await — module eval is not synchronous', async () => {
    await capturePluginStyles('listing-1', async () => {
      await Promise.resolve()
      const style = document.createElement('style')
      style.textContent = '.late-eval{top:1px}'
      document.head.appendChild(style)
      await Promise.resolve()
    })
    expect(listPluginStyles()).toHaveLength(1)
  })

  it('captures nothing added before or after the window', async () => {
    const before = document.createElement('style')
    before.textContent = '.before{top:1px}'
    document.head.appendChild(before)

    await capturePluginStyles('listing-1', async (): Promise<void> => {
      // a bundle that ships no CSS at all
    })

    const after = document.createElement('style')
    after.textContent = '.after{top:1px}'
    document.head.appendChild(after)
    await Promise.resolve()

    expect(listPluginStyles()).toHaveLength(0)
  })

  it('does not capture a <link>, which cannot be told from a framework chunk', async () => {
    await capturePluginStyles('listing-1', async () => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://plugins.example/x.css'
      document.head.appendChild(link)
    })
    expect(listPluginStyles()).toHaveLength(0)
  })

  it('sanitizes captured css too', async () => {
    await capturePluginStyles('listing-1', async () => {
      const style = document.createElement('style')
      style.textContent = '.x{background:url(http://evil.example/a.png)}'
      document.head.appendChild(style)
    })
    expect(listPluginStyles()[0].css).toContain('about:invalid')
  })

  it('keeps a captured sheet in sync when the bundle rewrites its text', async () => {
    const style = document.createElement('style')
    await capturePluginStyles('listing-1', async () => {
      style.textContent = '.x{top:1px}'
      document.head.appendChild(style)
    })
    expect(listPluginStyles()[0].css).toBe('.x{top:1px}')
    style.textContent = '.x{top:2px}'
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
    expect(listPluginStyles()[0].css).toBe('.x{top:2px}')
  })

  it('returns the load result and propagates its failure', async () => {
    await expect(
      capturePluginStyles('listing-1', async () => 'ok'),
    ).resolves.toBe('ok')
    await expect(
      capturePluginStyles('listing-1', async () => {
        throw new Error('bundle exports no register(host)')
      }),
    ).rejects.toThrow('bundle exports no register(host)')
  })
})
