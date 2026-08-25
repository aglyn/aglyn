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
// The panel's BoxStyler reads `palette.surface`, which only the editor's
// own theme carries — a bare `createTheme()` renders the panel not at all.
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import {
  applyStylePartialToSx,
  buildFlexGridGroup,
  buildStyleFieldGroups,
} from '../utils/style-field-groups'
import { ATTRIBUTE_COMMIT_DEBOUNCE_MS } from './element-props-form.component'
import ElementStylesForm from './element-styles-form.component'

/**
 * A bare number must be STORED as a number (AGL-2486).
 *
 * The panel's free-text length fields are the ones whose number is not
 * pixels: `borderRadius: 2` renders 8px (2 × the theme corner radius) and
 * `gap: 2` renders 16px (2 × the spacing unit). That multiplication is
 * MUI's, and MUI only applies it to a NUMBER — a string `'2'` is passed
 * through verbatim as `border-radius: 2`, which the CSS parser drops.
 *
 * So a form, which can only ever hand back a string, silently changed the
 * MEANING of every value that arrived as a number: open Corner Radius on a
 * node with the theme default, retype the same 2, and the corners go
 * square. Nothing anywhere reports it.
 *
 * The rule is the value's own shape, not a per-field list: entirely
 * numeric means a number, anything with a non-numeric character in it
 * (`8px`, `50%`, `1rem`) means a string. It is enforced once, in the merge
 * every control in the panel writes through, so a field added later cannot
 * arrive with the old behaviour.
 */
describe('styles panel numeric values (AGL-2486)', () => {
  const merge = (partial: Record<string, unknown>, sx = {}) =>
    applyStylePartialToSx(sx, partial, null, null)

  describe('the merge every panel control writes through', () => {
    it('stores a purely numeric value as a number', () => {
      // Every field whose bare number is a theme multiple or a ratio, plus
      // the plainly numeric ones. Audited together because the rule is one
      // rule, and a per-field list is what leaves the next one out.
      for (const name of [
        'borderRadius',
        'gap',
        'rowGap',
        'columnGap',
        'lineHeight',
        'zIndex',
        'opacity',
        'flexGrow',
        'flexShrink',
        'order',
        'paddingTop',
        'marginLeft',
      ]) {
        expect([name, merge({ [name]: '2' })]).toEqual([name, { [name]: 2 }])
      }
    })

    it('keeps a value with a unit as a string', () => {
      expect(merge({ borderRadius: '8px' })).toEqual({ borderRadius: '8px' })
      expect(merge({ borderRadius: '50%' })).toEqual({ borderRadius: '50%' })
      expect(merge({ gap: '1rem' })).toEqual({ gap: '1rem' })
      // Not a length at all, and not to be turned into one.
      expect(merge({ gridColumn: 'span 2' })).toEqual({ gridColumn: 'span 2' })
    })

    it('stores zero as zero, not as unset', () => {
      // `0` is falsy AND a legitimate value here — `strictNullChecks` is
      // off repo-wide, so a `if (!value)` guard would delete it.
      expect(merge({ borderRadius: '0' })).toEqual({ borderRadius: 0 })
      expect(merge({ opacity: '0' })).toEqual({ opacity: 0 })
      expect(merge({ flexGrow: '0' }, { flexGrow: 1 })).toEqual({ flexGrow: 0 })
    })

    it('handles fractions and negatives', () => {
      expect(merge({ lineHeight: '1.5' })).toEqual({ lineHeight: 1.5 })
      expect(merge({ opacity: '.5' })).toEqual({ opacity: 0.5 })
      expect(merge({ order: '-1' })).toEqual({ order: -1 })
      expect(merge({ zIndex: '+3' })).toEqual({ zIndex: 3 })
    })

    it('still clears on empty', () => {
      expect(merge({ borderRadius: '' }, { borderRadius: 2 })).toEqual({})
      // Whitespace is emptiness, not a number.
      expect(merge({ borderRadius: '   ' }, { borderRadius: 2 })).toEqual({})
    })

    it('does not rewrite the key when the number round-trips', () => {
      // The stored value already IS the number the box shows, so opening
      // the field and leaving it alone must not count as an edit.
      const sx = { borderRadius: 2 }
      expect(merge({ borderRadius: '2' }, sx)).toEqual({ borderRadius: 2 })
    })

    it('leaves a value that is not numeric text alone', () => {
      expect(merge({ fontFamily: 'Georgia, serif' })).toEqual({
        fontFamily: 'Georgia, serif',
      })
      expect(merge({ position: 'absolute' })).toEqual({ position: 'absolute' })
    })
  })

  /**
   * The other half of the same rule (AGL-2486, items 9 + 10 together).
   *
   * Storing a number is only half a value domain. The panel's FORM holds a
   * copy of every value too, and a control hands back whatever its own
   * input produces — text from a box, the option's own value from a preset
   * menu. So the form's copy of a stored `2` was `'2'` from one control and
   * `2` from another, and react-final-form calls that inequality DIRTY.
   * Item 9's re-seed spares dirty fields, so a numeric field was
   * permanently dirty and an undo never reached it — see
   * `element-styles-form-undo.spec.tsx` for that behaviour end to end.
   *
   * This is the structural half: the same function the merge writes through
   * is attached to EVERY field, on the way in, so the two agree by
   * construction and a field added later cannot arrive without it.
   */
  describe('the domain the form holds a value in', () => {
    const allFields = () =>
      [...buildStyleFieldGroups([], {} as any), buildFlexGridGroup()].flatMap(
        (group) => group.fields,
      )

    it('is the document’s, for every field in the panel', () => {
      const fields = allFields()
      // A guard on the guard: an empty list would pass the loop below
      // without reading anything.
      expect(fields.length).toBeGreaterThan(30)

      for (const field of fields) {
        const parse = (field as any).FieldProps?.parse as (
          v: unknown,
        ) => unknown
        // Named in every expectation so a failure says WHICH field.
        expect([field.name, typeof parse]).toEqual([field.name, 'function'])
        expect([field.name, parse('2')]).toEqual([field.name, 2])
        // Zero is a value, not an absence — falsy, and `strictNullChecks`
        // is off repo-wide.
        expect([field.name, parse('0')]).toEqual([field.name, 0])
        // Anything carrying a non-numeric character is what the author
        // wrote: existing documents keep rendering.
        expect([field.name, parse('8px')]).toEqual([field.name, '8px'])
        expect([field.name, parse('50%')]).toEqual([field.name, '50%'])
        // Empty still clears.
        expect([field.name, parse('')]).toEqual([field.name, undefined])
        // And a control already speaking the document’s language — the
        // preset menus emit their option’s own value — is left alone.
        expect([field.name, parse(3)]).toEqual([field.name, 3])
      }
    })

    it('agrees with what the merge would store, so nothing is dirty at rest', () => {
      // The two ends of the round trip, stated together: what the field
      // parses to is exactly what the merge writes, which is exactly what
      // seeds the field back. That equality IS pristine.
      const gap = allFields().find((field) => field.name === 'gap') as any
      for (const typed of ['2', '0', '1.5', '-1', '8px', 'auto']) {
        const parsed = gap.FieldProps.parse(typed)
        expect([typed, merge({ gap: typed })]).toEqual([
          typed,
          parsed === undefined ? {} : { gap: parsed },
        ])
      }
    })
  })

  describe('through the panel', () => {
    const seedNode = (sx: Record<string, any>) => {
      Aglyn.canvas.reset()
      Aglyn.canvas.setNodes({
        root: { $id: 'root', componentId: 'muiStack', nodes: ['meta'] },
        meta: { $id: 'meta', componentId: 'muiStack', parentId: 'root', sx },
      } as any)
      return Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema
    }
    const live = () => Aglyn.canvas.getNode('meta') as Aglyn.NodeSchema

    const open = async (summary: string) => {
      act(() => {
        fireEvent.click(screen.getByText(summary))
      })
      await act(async () => undefined)
    }

    const type = (label: string, value: string) => {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
      act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
    }

    const renderPanel = async (sx: Record<string, any>, summary: string) => {
      render(
        <ThemeProvider theme={consoleThemeCssVar}>
          <ElementStylesForm node={seedNode(sx)} />
        </ThemeProvider>,
      )
      await open(summary)
    }

    beforeEach(() => jest.useFakeTimers())
    afterEach(() => {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
      Aglyn.canvas.reset()
    })

    it('keeps Corner Radius a theme multiple when it is picked', async () => {
      // The reported shape, end to end: a node carrying the theme default
      // as a NUMBER, opened and nudged the way an author would. Corner
      // Radius is a preset picker now (AGL-2486), so "nudged" is choosing
      // the next rung — but the guarantee under test is unchanged and is
      // the reason the rungs are numbers: what lands in `sx` has to stay a
      // NUMBER, or MUI stops multiplying it by `shape.borderRadius` and the
      // declaration is dropped by the CSS parser.
      //
      // Two layers guarantee that and this test covers the OUTCOME, not
      // either layer: the control emits the option'''s own value, and
      // `normalizeStyleValue` would rescue it even if the control regressed
      // to a string. The control-level half is pinned separately in
      // `preset-choice.spec.tsx` — a mutation proved this test alone cannot
      // see it.
      await renderPanel({ borderRadius: 2 }, 'Borders & Shadows')
      act(() => {
        fireEvent.mouseDown(screen.getByLabelText('Corner Radius'))
      })
      act(() => {
        fireEvent.click(
          within(screen.getByRole('listbox')).getByText('More rounded'),
        )
      })
      act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
      expect(live().sx).toEqual({ borderRadius: 3 })
      expect(typeof (live().sx as any).borderRadius).toBe('number')
    })

    it('takes an explicit unit as the string it is', async () => {
      // Through the raw escape hatch, which is where a hand-typed length
      // goes now — and it must NOT be coerced to a number.
      await renderPanel({ borderRadius: 2 }, 'Borders & Shadows')
      act(() => {
        fireEvent.mouseDown(screen.getByLabelText('Corner Radius'))
      })
      act(() => {
        fireEvent.click(
          within(screen.getByRole('listbox')).getByText('Custom…'),
        )
      })
      type('Corner Radius custom value', '8px')
      expect(live().sx).toEqual({ borderRadius: '8px' })
    })

    it('does the same for the gap controls', async () => {
      // Gap is a spacing picker now (Zach 2026-08-25), so the ladder stores
      // the multiple directly — and Custom… still has to normalise a typed
      // number the same way, or `gap: '2'` reaches CSS as an invalid length.
      await renderPanel({}, 'Flexbox & Grid')
      act(() => {
        fireEvent.mouseDown(screen.getByLabelText('Gap'))
      })
      act(() => {
        // By ROLE, not by text: each rung renders its label AND the px it
        // resolves to ("Small" + "16px"), so a text query matches the inner
        // label span and clicking that never reaches the option.
        fireEvent.click(
          within(screen.getByRole('listbox')).getByRole('option', {
            name: /^Small/,
          }),
        )
      })
      act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
      expect(live().sx).toEqual({ gap: 2 })
      // A NUMBER, or MUI stops multiplying it by the spacing unit and the
      // declaration is dropped by the CSS parser.
      expect(typeof (live().sx as any).gap).toBe('number')
    })

    it('normalises a gap typed into Custom… to a number', async () => {
      await renderPanel({}, 'Flexbox & Grid')
      act(() => {
        fireEvent.mouseDown(screen.getByLabelText('Gap'))
      })
      act(() => {
        fireEvent.click(
          within(screen.getByRole('listbox')).getByText('Custom…'),
        )
      })
      type('Gap custom value', '3')
      expect(live().sx).toEqual({ gap: 3 })
    })
  })
})
