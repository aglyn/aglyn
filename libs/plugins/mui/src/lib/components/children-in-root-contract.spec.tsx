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

/**
 * `flags.childrenInRoot` is a promise about markup, so it is checked against
 * markup (AGL-3581).
 *
 * A published page hands an element that declares it
 * `dangerouslySetInnerHTML` in place of its children while it hydrates, so a
 * static subtree keeps the server's HTML. That is only sound if the element
 * puts that markup DIRECTLY inside its root and adds nothing of its own beside
 * it — a component that joins, wraps or decorates its children throws in
 * React ("Can only set one of `children` or `dangerouslySetInnerHTML`"), and
 * the published page would show the error fallback in place of a section.
 *
 * Every declaring element is rendered both ways, as the site renders it and
 * as the editor does (a suppressed link resolves to a different branch).
 */
import * as Aglyn from '@aglyn/aglyn'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as box from './box'
import * as container from './container'
import * as grid from './grid'
import * as paper from './paper'
import * as section from './section'

interface ElementModule {
  default: ComponentType<any>
  schema: Aglyn.ComponentSchema<any>
}

/** Every element module in this plugin that declares the flag. */
const DECLARING: Record<string, ElementModule> = {
  box,
  container,
  grid,
  paper,
  section,
}

const HELD = '<i data-held="1">held</i>'

function renderHeld(
  Component: ComponentType<any>,
  links: Aglyn.ScreenLinkContextValue,
  props: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    <Aglyn.ScreenLinkContext.Provider value={links}>
      <Component
        data-aglyn="leaf:n1"
        {...props}
        dangerouslySetInnerHTML={{ __html: HELD }}
        suppressHydrationWarning
      />
    </Aglyn.ScreenLinkContext.Provider>,
  )
}

/** The root element's own innerHTML, read back from the markup. */
function rootInnerHtml(markup: string): string {
  const host = document.createElement('div')
  host.innerHTML = markup
  return (host.firstElementChild as HTMLElement | null)?.innerHTML ?? ''
}

describe('flags.childrenInRoot (AGL-3581)', () => {
  it.each(Object.entries(DECLARING))(
    '%s declares it, and puts held markup straight into its root',
    (_name, module) => {
      const flags = module.schema.flags ?? {}
      expect((flags.childrenInRoot ?? 0) & Aglyn.FEATURE_FLAG.ENABLED).toBeTruthy()
      // Declaring this without being static would hold an interactive tree.
      expect((flags.lazyHydration ?? 0) & Aglyn.FEATURE_FLAG.ENABLED).toBeTruthy()

      for (const links of [
        { screens: { about: 'company/about' } },
        { suppressNavigation: true },
      ] as Aglyn.ScreenLinkContextValue[]) {
        const markup = renderHeld(module.default, links, { screenId: 'about' })
        expect(rootInnerHtml(markup)).toBe(HELD)
        // The leaf attribute is what the hold finds the element by.
        expect(markup).toContain('data-aglyn="leaf:n1"')
      }
    },
  )

  it('is declared by exactly the elements this spec checks', () => {
    // A new declaration has to be listed above, which is what puts it
    // through the markup check.
    const declaring = readdirSync(__dirname)
      .filter((file) => /\.tsx?$/.test(file) && !/\.spec\./.test(file))
      .filter((file) =>
        /childrenInRoot:\s*Aglyn\.FEATURE_FLAG\.ENABLED/.test(
          readFileSync(join(__dirname, file), 'utf8'),
        ),
      )
      .map((file) => file.replace(/\.tsx?$/, ''))
      .sort()
    expect(declaring).toEqual(
      ['box', 'container', 'grid', 'paper', 'section'],
    )
  })

  it('a grid CONTAINER holds too — it is the shape that wraps a page section', () => {
    const markup = renderHeld(grid.default, {}, { container: true, spacing: 2 })
    expect(rootInnerHtml(markup)).toBe(HELD)
  })
})
