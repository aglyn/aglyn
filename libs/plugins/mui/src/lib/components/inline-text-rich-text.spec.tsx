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
import { AglynText } from '@aglyn/shared-ui-jsx'
import { render } from '@testing-library/react'
import InlineText, { schema as inlineTextSchema } from './inline-text'

/**
 * RICH TEXT ON THE INLINE RUN (AGL-2557).
 *
 * The controls got the read side first because they were what Zach was
 * editing. Inline Text was the last element left holding `textEditable`
 * without it, so a double-click on a run still opened a toolbar of `{}` and
 * Done — on the one component in the catalog whose entire purpose is
 * emphasising a phrase.
 *
 * It takes EMPHASIS only, and not for the controls' reason. Nothing here is
 * interactive; the constraint is that the run is `display: inline` and every
 * element it may render as is phrasing content, so a block inside one is
 * markup the parser lifts back out of the enclosing paragraph.
 */
describe('an inline run renders its formatted text (AGL-2557)', () => {
  it('draws the markup instead of the plain fallback', () => {
    const { container } = render(
      <InlineText html={'part of the <b>platform</b>'}>
        <AglynText>{'part of the platform'}</AglynText>
      </InlineText>,
    )
    expect(container.querySelector('b')?.textContent).toBe('platform')
    // ONE reading of the run, not the markup plus the fallback beside it.
    expect(container.textContent).toBe('part of the platform')
  })

  it('keeps the formatting on every element the run may render as', () => {
    // `element` is an allow-list of phrasing content, so the formatted
    // branch has to hold for all of it rather than for the `span` default.
    for (const element of ['span', 'strong', 'em', 'mark', 'small'] as const) {
      const { container } = render(
        <InlineText element={element} html={'a <i>b</i>'}>
          {'a b'}
        </InlineText>,
      )
      expect(container.querySelector(`${element} i`)?.textContent).toBe('b')
    }
  })

  it('renders exactly what it always did with no html prop', () => {
    // The overwhelmingly common case: nothing is substituted, and the run
    // gets the children the renderer handed it.
    const { container } = render(<InlineText>{'Inline text'}</InlineText>)
    expect(container.querySelector('aglyn-text')).toBeNull()
    expect(container.textContent).toBe('Inline text')
  })

  it('renders into `aglyn-text`, which is what the canvas edits', () => {
    // In-place editing EMPTIES whatever element it is handed and looks for
    // the leaf's `aglyn-text` first (AGL-2556). Rendering the formatted run
    // anywhere else would move the edit target between plain and rich mode.
    const { container } = render(
      <InlineText html={'a <b>b</b>'}>{'a b'}</InlineText>,
    )
    const text = container.querySelector('aglyn-text') as HTMLElement
    expect(text).toBeTruthy()
    expect(text.querySelector('b')?.textContent).toBe('b')
  })

  it('leaves the authored attributes doing their own job', () => {
    // `weight` and `tone` are node styling and must survive the swap; the
    // formatted branch replaces the CHILDREN, not the box around them.
    const { container } = render(
      <InlineText element="strong" weight="bold" html={'a <em>b</em>'}>
        {'a b'}
      </InlineText>,
    )
    expect(container.querySelector('strong em')?.textContent).toBe('b')
  })
})

/**
 * THE PROP IS RE-SANITIZED ON EVERY RENDER (AGL-497).
 *
 * The editor sanitizes at commit, and that is not where the guarantee comes
 * from. Screen node props are written straight through the Firebase client
 * SDK, so a host editor can plant arbitrary `html` on a node without the
 * editor ever seeing it — and it would then run on the published site AND on
 * the besigner canvas at app.aglyn.com.
 */
describe('a planted html prop cannot execute or break the run (AGL-2557)', () => {
  it('drops a script and an event handler', () => {
    const { container } = render(
      <InlineText html={'<script>alert(1)</script><b onclick="x()">hi</b>'}>
        {'hi'}
      </InlineText>,
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')?.getAttribute('onclick')).toBeNull()
  })

  it('unwraps block markup rather than putting a list inside an inline box', () => {
    const { container } = render(
      <InlineText html={'<ul><li>one</li><li>two</li></ul>'}>
        {'one two'}
      </InlineText>,
    )
    expect(container.querySelector('ul')).toBeNull()
    expect(container.querySelector('li')).toBeNull()
    expect(container.textContent).toBe('onetwo')
  })

  it('unwraps an anchor, which this run does not offer and cannot resolve', () => {
    const { container } = render(
      <InlineText html={'go <a href="https://evil.test">there</a>'}>
        {'go there'}
      </InlineText>,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('go there')
  })
})

/**
 * The three parts have to travel together: a schema may only turn the
 * editor's flag on where the component reads `html` back, and may only offer
 * a command whose output the element can hold.
 */
describe('the Inline Text schema declares emphasis-only rich text (AGL-2557)', () => {
  it('is rich-text editable', () => {
    expect(
      (inlineTextSchema.flags?.richTextEditable ?? 0) &
        Aglyn.FEATURE_FLAG.ENABLED,
    ).not.toBe(0)
    // Still plain-text editable: the rich flag is an upgrade to the same
    // double-click, not a replacement for it.
    expect(
      (inlineTextSchema.flags?.textEditable ?? 0) & Aglyn.FEATURE_FLAG.ENABLED,
    ).not.toBe(0)
  })

  it('offers emphasis and nothing else', () => {
    expect(inlineTextSchema.richTextCommands).toEqual([
      Aglyn.RICH_TEXT_COMMANDS.EMPHASIS,
    ])
  })
})
