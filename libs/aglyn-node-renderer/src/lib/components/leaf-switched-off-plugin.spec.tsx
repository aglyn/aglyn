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
 * A switched-off plugin's element renders the same on the server and in the
 * browser (AGL-3033).
 *
 * The component registry is process-global. A tenant server that rendered one
 * site's form still holds the Forms bundle when it renders the next site —
 * including one that switched Forms off — while that site's browser never
 * loads the bundle at all. The leaf must therefore draw a registered
 * component whose first-party plugin is not in the rendered site's set
 * EXACTLY as it draws an unregistered one, or the server HTML shows what the
 * site switched off and hydration fails on the difference.
 *
 * Each case below renders the same tree twice — once with the component
 * registered, standing for the warm server, and once without, standing for
 * the site's browser — and asserts the two agree.
 */

import * as Aglyn from '@aglyn/aglyn'
import { EnabledPluginsContext } from '@aglyn/aglyn/app-utils/enabled-plugins-context'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import TreeRoot from './tree-root'

/** Stand-in for the Forms bundle's element: a real form with its own controls. */
const FormElement = ({ children, ...rest }: { children?: ReactNode }) => (
  <form data-testid="form-element" {...rest}>
    {children}
    <input name="website" />
    <button type="submit">{'Send'}</button>
  </form>
)
const FieldElement = (props: Record<string, unknown>) => (
  <label>
    {String(props['label'] ?? '')}
    <input name={String(props['fieldName'] ?? '')} />
  </label>
)
const Heading = ({ children }: { children?: ReactNode }) => <h2>{children}</h2>

const node = (
  id: string,
  componentId: string,
  pluginId: string,
  props: Record<string, unknown> = {},
  children: unknown[] = [],
) => ({ $id: id, componentId, pluginId, props, children })

/** A contact section: a heading from the base library, and a form with two fields. */
const CONTACT = () =>
  node('section', 'heading-host', 'mui', {}, [
    node('heading', 'heading', 'mui', { children: 'Get in touch' }),
    node('form-1', 'form', 'forms', { formName: 'Contact' }, [
      node('field-1', 'formField', 'forms', { fieldName: 'email', label: 'Email' }),
      node('field-2', 'formField', 'forms', { fieldName: 'message', label: 'Message' }),
    ]),
  ])

function registerBase() {
  Aglyn.components.registerComponent(Heading as never, { $id: 'heading', pluginId: 'mui' } as never)
  Aglyn.components.registerComponent(
    (({ children }: { children?: ReactNode }) => <div>{children}</div>) as never,
    { $id: 'heading-host', pluginId: 'mui' } as never,
  )
}

function registerForms(pluginId = 'forms') {
  Aglyn.components.registerComponent(FormElement as never, { $id: 'form', pluginId } as never)
  Aglyn.components.registerComponent(FieldElement as never, { $id: 'formField', pluginId } as never)
}

function unregisterForms() {
  Aglyn.components.unregisterComponent('form')
  Aglyn.components.unregisterComponent('formField')
}

function markup(tree: unknown, enabled: readonly string[] | undefined): string {
  const view = render(
    enabled === undefined ? (
      <TreeRoot node={tree as never} />
    ) : (
      <EnabledPluginsContext.Provider value={enabled}>
        <TreeRoot node={tree as never} />
      </EnabledPluginsContext.Provider>
    ),
  )
  const html = view.container.innerHTML
  view.unmount()
  return html
}

beforeEach(() => {
  registerBase()
})

afterEach(() => {
  unregisterForms()
  Aglyn.components.unregisterComponent('heading')
  Aglyn.components.unregisterComponent('heading-host')
})

describe('a site that switched Forms off (AGL-3033)', () => {
  const SITE = ['mui', 'commerce']

  it('draws the same page whether this server holds the Forms bundle or not', () => {
    registerForms()
    const warmServer = markup(CONTACT(), SITE)
    unregisterForms()
    const browser = markup(CONTACT(), SITE)
    expect(warmServer).toBe(browser)
  })

  it('draws no form, no field, no input and no button — the rest of the section stays', () => {
    registerForms()
    const view = render(
      <EnabledPluginsContext.Provider value={SITE}>
        <TreeRoot node={CONTACT() as never} />
      </EnabledPluginsContext.Provider>,
    )
    const { container } = view
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('label')).toBeNull()
    expect(container.textContent).toBe('Get in touch')
    // What stands where the form was: the leaf's plain fallback element, one
    // for the form and one inside it per field, with nothing drawn in any.
    const formLeaf = container.querySelector('[data-aglyn="leaf:form-1"]')
    expect(formLeaf?.tagName).toBe('DIV')
    expect(formLeaf?.querySelectorAll('div[data-aglyn^="leaf:field-"]').length).toBe(2)
    expect(formLeaf?.textContent).toBe('')
  })
})

describe('a site that runs the plugin', () => {
  it('draws the form in full', () => {
    registerForms()
    const html = markup(CONTACT(), ['mui', 'forms'])
    expect(html).toContain('data-testid="form-element"')
    expect(html).toContain('<button type="submit">Send</button>')
  })

  it('draws it where no site set was published at all', () => {
    registerForms()
    expect(markup(CONTACT(), undefined)).toContain('data-testid="form-element"')
  })
})

describe('what the gate does not reach', () => {
  it('leaves a marketplace component alone: its id is not the listing id the site carries', () => {
    registerForms('acme-forms')
    expect(markup(CONTACT(), ['mui'])).toContain('data-testid="form-element"')
  })

  it('leaves the base library alone', () => {
    registerForms()
    expect(markup(CONTACT(), ['mui'])).toMatch(/<h2>.*Get in touch.*<\/h2>/)
  })

  it('never draws the base library as unregistered, even from a set that omits it', () => {
    expect(markup(CONTACT(), ['commerce'])).toMatch(/<h2>.*Get in touch.*<\/h2>/)
  })

  it('reads an EMPTY set as no site at all, rather than switching everything off', () => {
    // The console's editor gate publishes [] while the URL names no workspace
    // it has resolved. Every real site set carries the base library.
    registerForms()
    const html = markup(CONTACT(), [])
    expect(html).toContain('data-testid="form-element"')
    expect(html).toMatch(/<h2>.*Get in touch.*<\/h2>/)
  })
})
