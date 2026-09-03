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

import * as Aglyn from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import ReusableInstance, {
  REUSABLE_INSTANCE_ELEMENTS,
  schema,
} from './reusable-instance'

describe('Reusable component instance (AGL-1247)', () => {
  const box = (container: HTMLElement) =>
    container.querySelector('[data-aglyn-component]') as HTMLElement

  it('names the definition it stands for without emitting its id', () => {
    const { container } = render(
      <ReusableInstance refId="hero-def" name="Site header" />,
    )
    expect(box(container).getAttribute('data-aglyn-component')).toBe(
      'Site header',
    )
    expect(box(container).getAttribute('refid')).toBeNull()
  })

  it('keeps the instance props out of the rendered markup (AGL-2486)', () => {
    // `propValues` is the author's per-instance overrides. It is an
    // instruction to the GRAFT, which reads it off the stored node and
    // substitutes `{{prop.*}}` inside the definition's copy — the wrapper
    // element itself has no use for it. Spread onto the Box it reaches the
    // DOM, where React logs "does not recognize the `propValues` prop" in
    // the canvas and, on a published page, serialises the author's copy a
    // second time as `propvalues="[object Object]"`.
    const { container } = render(
      <ReusableInstance
        refId="hero-def"
        name="Hero"
        {...({
          [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: {
            headline: 'Ship faster',
          },
        } as any)}
      />,
    )
    const el = box(container)
    expect(el.getAttribute('propvalues')).toBeNull()
    expect(el.outerHTML).not.toContain('Ship faster')
    expect(el.outerHTML).not.toContain('[object Object]')
  })

  it('still forwards genuine DOM props', () => {
    // The strip is by name, so it must not become "drop everything the
    // wrapper does not itself declare" — an id or a title typed in the
    // Attributes panel belongs on the element.
    const { container } = render(
      <ReusableInstance refId="hero-def" id="masthead" title="Masthead" />,
    )
    expect(box(container).id).toBe('masthead')
    expect(box(container).getAttribute('title')).toBe('Masthead')
  })

  it('is registered under the id the graft looks for', () => {
    expect(schema.$id).toBe(Aglyn.REUSABLE_INSTANCE_COMPONENT_ID)
  })

  describe('the element the placement renders as (AGL-2514)', () => {
    it('is a div until the author says otherwise', () => {
      // Every instance stored before this attribute existed has no
      // `component`, and must keep rendering exactly the element it did.
      const { container } = render(<ReusableInstance refId="hero-def" />)
      expect(box(container).tagName).toBe('DIV')
    })

    it('renders each offered element', () => {
      for (const element of REUSABLE_INSTANCE_ELEMENTS) {
        const { container, unmount } = render(
          <ReusableInstance refId="hero-def" component={element} />,
        )
        expect(box(container).tagName).toBe(element.toUpperCase())
        unmount()
      }
    })

    it('gives a site nav and a site footer their landmarks', () => {
      // The reason the attribute exists: the wrapper is the outermost
      // element of placed chrome, so a hardcoded div left a published page
      // with no header and no footer region no matter how the definition
      // was built.
      const { container } = render(
        <ReusableInstance refId="nav-def" name="Site nav" component="header" />,
      )
      expect(box(container).tagName).toBe('HEADER')
    })

    it('never offers main — the content region carries that one', () => {
      // An instance may be placed any number of times per page, so an
      // author-selected `main` here could only ever be the SECOND one.
      // `stampDocumentLandmark` places the only one, on the Document layer
      // or the Layout Slot.
      expect(REUSABLE_INSTANCE_ELEMENTS).not.toContain('main')
      const { container } = render(
        <ReusableInstance refId="hero-def" component="main" />,
      )
      expect(box(container).tagName).toBe('DIV')
    })

    it('degrades an unlisted element rather than emitting it', () => {
      // The value is persisted and rendered verbatim, so anything but an
      // allow-list would put `script` into every visitor's page.
      const { container } = render(
        <ReusableInstance refId="hero-def" component="script" />,
      )
      expect(box(container).tagName).toBe('DIV')
    })

    it('offers exactly the elements the renderer accepts', () => {
      const field = (schema.attributes ?? []).find((a) => a.name === 'component')
      const options = (field as unknown as { options: { value: string }[] })
        .options
      expect(options.map((o) => o.value)).toEqual([
        ...REUSABLE_INSTANCE_ELEMENTS,
      ])
    })
  })
})
