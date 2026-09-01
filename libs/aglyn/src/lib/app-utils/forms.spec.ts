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

import { PLAN_ENTITLEMENTS } from './plan-entitlements'
import {
  collectFormFieldNodeIds,
  FORMS_MAX_PER_HOST,
  formFieldDeclsFromNodes,
  formPeriodSeries,
  formStatsWindow,
  discoverFormNodes,
  matchSubmissionToForm,
  normalizeFormSlug,
  normalizeSubmissionFormName,
  readFormDeclaredConsent,
} from './forms'

/** A node map in the stored shape: flat, children as ordered id arrays. */
const tree = (
  entries: Array<[string, Record<string, any>]>,
): Record<string, any> =>
  Object.fromEntries(entries.map(([id, node]) => [id, { $id: id, ...node }]))

describe('a form declares the fields an author already drew', () => {
  const nodes = tree([
    ['form-1', { componentId: 'form', nodes: ['group', 'consent'] }],
    ['group', { componentId: 'stack', nodes: ['name', 'email'] }],
    [
      'name',
      { componentId: 'formField', props: { fieldName: 'name', label: 'Your name', required: true } },
    ],
    [
      'email',
      { componentId: 'formField', props: { fieldName: 'email', fieldType: 'email' } },
    ],
    [
      'consent',
      {
        componentId: 'formField',
        props: { fieldName: 'subscribe', fieldType: 'checkbox', options: 'Email me' },
      },
    ],
  ])

  it('finds fields nested arbitrarily deep under the form', () => {
    // The runtime rides the DOM precisely so nesting between Form and field
    // needs no React context, so the reader may not assume direct children.
    expect(collectFormFieldNodeIds(nodes, 'form-1')).toEqual([
      'name',
      'email',
      'consent',
    ])
  })

  it('keeps the author\'s reading order, not the map\'s insertion order', () => {
    // Depth-first pre-order. A breadth-first walk would emit the top-level
    // `consent` before the nested `name`/`email`, which is not the order the
    // form renders in and not the order a submission list wants its columns.
    expect(
      formFieldDeclsFromNodes(nodes, 'form-1').map((field) => field.fieldName),
    ).toEqual(['name', 'email', 'subscribe'])
  })

  it('reads type, label, required and options off the nodes', () => {
    const declarations = formFieldDeclsFromNodes(nodes, 'form-1')
    expect(declarations[0]).toEqual({
      fieldName: 'name',
      fieldType: 'text',
      label: 'Your name',
      required: true,
    })
    expect(declarations[1]).toEqual({ fieldName: 'email', fieldType: 'email' })
    expect(declarations[2]).toEqual({
      fieldName: 'subscribe',
      fieldType: 'checkbox',
      options: ['Email me'],
    })
  })

  it('splits a choice list on the same separators the runtime does', () => {
    // `parseFieldOptions` splits on `[\n,]`, trims, and drops blanks. The two
    // derivations must agree or an adopted form declares options the rendered
    // control does not offer. The plugin cannot be imported here — a
    // foundation lib may not depend on one — so the parity is asserted from
    // the plugin's side in `form.spec.tsx` and the behavior is pinned here.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['size'] }],
        [
          'size',
          {
            componentId: 'formField',
            props: {
              fieldName: 'size',
              fieldType: 'select',
              options: 'Small, Medium\nLarge, ,',
            },
          },
        ],
      ]),
      'f',
    )
    expect(declared[0]?.options).toEqual(['Small', 'Medium', 'Large'])
  })

  it('DROPS an unnamed field rather than declaring a key that names no value', () => {
    // The runtime falls back to `name = fieldName || 'field'`, so several
    // unnamed fields collapse onto ONE submission key. Declaring them would
    // put a key in the schema that does not identify a value.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['a', 'b'] }],
        ['a', { componentId: 'formField', props: {} }],
        ['b', { componentId: 'formField', props: { fieldName: 'real' } }],
      ]),
      'f',
    )
    expect(declared.map((field) => field.fieldName)).toEqual(['real'])
  })

  it('keeps the first of a duplicated field name', () => {
    // `FormData` joins repeated keys into one value, so the second node
    // contributes no separate value and must not become a second column.
    const declared = formFieldDeclsFromNodes(
      tree([
        ['f', { componentId: 'form', nodes: ['a', 'b'] }],
        ['a', { componentId: 'formField', props: { fieldName: 'q', label: 'First' } }],
        ['b', { componentId: 'formField', props: { fieldName: 'q', label: 'Second' } }],
      ]),
      'f',
    )
    expect(declared).toHaveLength(1)
    expect(declared[0]?.label).toBe('First')
  })

  it('terminates on a cyclic document instead of hanging', () => {
    const cyclic = tree([
      ['f', { componentId: 'form', nodes: ['a'] }],
      ['a', { componentId: 'stack', nodes: ['b'] }],
      ['b', { componentId: 'stack', nodes: ['a'] }],
    ])
    expect(collectFormFieldNodeIds(cyclic, 'f')).toEqual([])
  })
})

describe('discovery finds the forms that already exist', () => {
  it('reports every form node in a document with its caption and fields', () => {
    const found = discoverFormNodes(
      tree([
        ['contact', { componentId: 'form', props: { formName: 'Contact' }, nodes: ['e'] }],
        ['e', { componentId: 'formField', props: { fieldName: 'email' } }],
        ['signup', { componentId: 'form', props: { formName: 'Newsletter' } }],
        ['text', { componentId: 'typography' }],
      ]),
      { kind: 'screen', id: 'screen-1', name: 'Contact page' },
    )
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({
      sourceKind: 'screen',
      sourceId: 'screen-1',
      sourceName: 'Contact page',
      nodeId: 'contact',
      formName: 'Contact',
    })
    expect(found[0]?.fields.map((field) => field.fieldName)).toEqual(['email'])
  })

  it('files an unnamed form under the caption its submissions carry', () => {
    // The client sends `formName || 'Form'` and the route stores
    // `String(formName ?? 'Form')`. Discovery must claim the SAME string or
    // every legacy match misses — silently, and in the safe direction, which
    // is the failure that looks like success.
    const [found] = discoverFormNodes(
      tree([['f', { componentId: 'form' }]]),
      { kind: 'screen', id: 's' },
    )
    expect(found?.formName).toBe('Form')
    expect(normalizeSubmissionFormName(undefined)).toBe('Form')
    expect(normalizeSubmissionFormName('   ')).toBe('Form')
  })

  it('reports a form that is already bound', () => {
    const [found] = discoverFormNodes(
      tree([['f', { componentId: 'form', props: { formId: 'form-abc' } }]]),
      { kind: 'component', id: 'def-1' },
    )
    expect(found?.formId).toBe('form-abc')
  })
})

describe('an ambiguous submission is left UNSTAMPED', () => {
  const contact = {
    formId: 'form-contact',
    legacyMatch: { formName: 'Contact', paths: ['/contact'] },
  }
  const support = {
    formId: 'form-support',
    legacyMatch: { formName: 'Contact', paths: ['/support'] },
  }

  it('stamps when the caption AND the path both name one form', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        contact,
        support,
      ]),
    ).toBe('form-contact')
  })

  it('refuses when the caption matches but the path matches no adopted form', () => {
    // Two pages sharing a label is the DEFECT the entity exists to fix.
    // Matching on the caption alone would carry that defect into the
    // migration and file the row under whichever form was adopted first.
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/old-contact' }, [
        contact,
        support,
      ]),
    ).toBeNull()
  })

  it('refuses a lone caption match — the shape a caption-keyed backfill stamps', () => {
    // The dangerous case, and the one the assertion above does NOT cover: with
    // only ONE form carrying the caption, a `formName`-keyed match finds
    // exactly one candidate and stamps it. The submission came from a page
    // this form never rendered on — a retired page, or a second form since
    // deleted — and stamping files it under a form it was never sent to.
    //
    // Unstamped, it stays in the Inbox and the Forms page counts it. Wrongly
    // stamped, it is invisible, and invisible is not recoverable.
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/retired-page' }, [
        contact,
      ]),
    ).toBeNull()
  })

  it('refuses when two forms both claim the same caption and path', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        contact,
        { ...support, legacyMatch: { formName: 'Contact', paths: ['/contact'] } },
      ]),
    ).toBeNull()
  })

  it('refuses a submission that recorded no path', () => {
    // Older rows genuinely predate the field. They stay unstamped rather
    // than falling back to the caption, which is the guess this refuses.
    expect(matchSubmissionToForm({ formName: 'Contact' }, [contact])).toBeNull()
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '' }, [contact]),
    ).toBeNull()
  })

  it('refuses a form that claims no history', () => {
    expect(
      matchSubmissionToForm({ formName: 'Contact', path: '/contact' }, [
        { formId: 'form-new' },
      ]),
    ).toBeNull()
  })
})

describe('consent comes from a declared field, never from the submission', () => {
  const form = { consentFieldName: 'subscribe' }

  it('reads the field the form named', () => {
    expect(readFormDeclaredConsent(form, { subscribe: 'on' })).toBe(true)
    expect(readFormDeclaredConsent(form, { subscribe: 'true' })).toBe(true)
    expect(readFormDeclaredConsent(form, { subscribe: true })).toBe(true)
  })

  it('is FALSE when the visitor left the box unticked', () => {
    expect(readFormDeclaredConsent(form, { subscribe: '' })).toBe(false)
    expect(readFormDeclaredConsent(form, { subscribe: 'false' })).toBe(false)
  })

  it('is FALSE for a form that declares no consent field, whatever it collected', () => {
    // ⛔ The fact of submission is not an opt-in. A form with no consent
    // field produces no consent record, and a field that merely LOOKS like
    // one does not become the declaration.
    expect(readFormDeclaredConsent({}, { subscribe: 'on' })).toBe(false)
    expect(readFormDeclaredConsent(null, { marketingConsent: 'true' })).toBe(false)
  })

  it('is FALSE when the declared field was not submitted at all', () => {
    expect(readFormDeclaredConsent(form, { email: 'a@b.com' })).toBe(false)
  })
})

describe('a form slug is a handle, never an identity', () => {
  it('reduces a display name to a url-safe handle', () => {
    expect(normalizeFormSlug('  Contact Us! ')).toBe('contact-us')
    expect(normalizeFormSlug('Sign-up / Newsletter')).toBe('sign-up-newsletter')
  })

  it('answers empty for a name that reduces to nothing', () => {
    // The caller falls back to the document id. An empty slug stored as a
    // slug would be a second form's slug too.
    expect(normalizeFormSlug('!!!')).toBe('')
    expect(normalizeFormSlug(undefined)).toBe('')
  })

  it('never ends in a separator after truncation', () => {
    expect(normalizeFormSlug('a'.repeat(63) + ' tail')).not.toMatch(/-$/)
  })
})

describe('the listing bound is not the allowance', () => {
  /**
   * `FORMS_MAX_PER_HOST` pages a READ of `hosts/{hostId}/forms`; the plan's
   * `formsPerHost` is what a site may hold. Two numbers with one obvious
   * failure between them: a page size below the allowance drops forms the
   * customer made, silently, from a picker and a filter that show no sign of
   * having truncated anything.
   */
  const finiteAllowances = Object.entries(PLAN_ENTITLEMENTS)
    .map(([plan, value]) => [plan, value.formsPerHost] as const)
    .filter(([, allowance]) => Number.isFinite(allowance))

  it('pages at or above every finite per-plan allowance', () => {
    // Reported as pairs rather than a boolean so a failure names the plan.
    expect(
      finiteAllowances.filter(([, allowance]) => allowance > FORMS_MAX_PER_HOST),
    ).toEqual([])
  })

  it('has finite allowances to compare against at all', () => {
    // The control. `filter` over an empty list passes vacuously, so a rename
    // of the entitlement key would otherwise turn the guard above green while
    // it compared nothing.
    expect(finiteAllowances.length).toBeGreaterThan(0)
  })

  it('is NOT the number a surface should publish as the cap', () => {
    // It disagrees with most plans on purpose. A surface reading this instead
    // of the entitlement publishes one plan's terms to every plan.
    expect(
      finiteAllowances.filter(([, allowance]) => allowance !== FORMS_MAX_PER_HOST),
    ).not.toEqual([])
  })

  it('stays STRICTLY above the largest allowance, leaving headroom', () => {
    /*
     * Not merely "at or above". Two things need the gap.
     *
     * A catalog can legitimately sit above the ceiling — a per-org override
     * raised then withdrawn, or the ceiling lowered under forms already
     * built — and those forms are never deleted, so a window equal to the
     * ceiling would truncate a list the moment that happens.
     *
     * And the two numbers must stay TELLABLE APART. Collapse them and a
     * surface reading the window where it means the ceiling becomes
     * accidentally right, so the day they diverge again it silently
     * misreports — which is how `forms/page.tsx` came to publish this
     * constant as a customer's cap.
     */
    const largest = Math.max(...finiteAllowances.map(([, value]) => value))
    expect(largest).toBeGreaterThan(0)
    expect(FORMS_MAX_PER_HOST).toBeGreaterThan(largest)
  })
})

describe('a form’s month series never draws a month nobody measured', () => {
  it('starts at the first RECORDED month, not a rolling window', () => {
    /*
     * The defect this shape exists to prevent. A series padded backwards to a
     * fixed twelve months renders every month before the counter shipped as a
     * confident zero — "this form collected nothing in March" over a March
     * nothing was counting in. Absent-because-quiet and
     * absent-because-unmeasured are opposite claims, and only the position of
     * the month tells them apart.
     */
    const series = formPeriodSeries({
      periods: { '2026-07': { submissions: 3 }, '2026-08': { submissions: 5 } },
    })
    expect(series.map((point) => point.period)).toEqual(['2026-07', '2026-08'])
  })

  it('fills an INTERIOR gap at zero', () => {
    // Inside the recorded range the counter was live and wrote nothing, so
    // the month really is zero. Closing the gap instead would make two
    // months a quarter apart draw as neighbours.
    const series = formPeriodSeries({
      periods: { '2026-06': { submissions: 2 }, '2026-09': { submissions: 4 } },
    })
    expect(series.map((point) => point.period)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
    expect(series.map((point) => point.submissions)).toEqual([2, 0, 0, 4])
  })

  it('crosses a year boundary', () => {
    const series = formPeriodSeries({
      periods: { '2025-11': { views: 1 }, '2026-01': { views: 1 } },
    })
    expect(series.map((point) => point.period)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ])
  })

  it('keeps the most recent months when the history is longer than asked for', () => {
    const periods: Record<string, { submissions: number }> = {}
    for (let month = 1; month <= 12; month += 1) {
      periods[`2026-${String(month).padStart(2, '0')}`] = { submissions: month }
    }
    const series = formPeriodSeries({ periods }, 3)
    expect(series.map((point) => point.period)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ])
  })

  it('answers empty for a form nothing has been recorded for', () => {
    expect(formPeriodSeries(undefined)).toEqual([])
    expect(formPeriodSeries({ submissions: 40 })).toEqual([])
  })

  it('ignores a key that is not a month', () => {
    // The map is written by dotted field paths on a public write path. A key
    // that is not `YYYY-MM` cannot be placed on the calendar, and walking
    // from one would run the month cursor off the end.
    const series = formPeriodSeries({
      periods: {
        'not-a-month': { submissions: 9 },
        '2026-13': { submissions: 9 },
        '2026-08': { submissions: 1 },
      } as never,
    })
    expect(series.map((point) => point.period)).toEqual(['2026-08'])
  })
})

describe('a rate is taken only over the months its denominator was live', () => {
  /*
   * THE ARITHMETIC LIE THIS PREVENTS.
   *
   * `submissions` has counted since the form entity existed; `views` only
   * since the beacon shipped. Dividing the lifetime totals answers
   * "submissions ever, over views since Tuesday" — and it is wrong in the
   * flattering direction, so nothing about the number invites a second look.
   */
  const stats = {
    submissions: 500,
    views: 60,
    periods: {
      '2026-06': { submissions: 200 },
      '2026-07': { submissions: 300, views: 40 },
      '2026-08': { submissions: 100, views: 20 },
    },
  }

  it('sums both counters over the months the denominator carries', () => {
    const window = formStatsWindow(stats, 'views', 'submissions')
    expect(window.periods).toBe(2)
    expect(window.over).toBe(60)
    // 400, NOT the lifetime 500: June had submissions and no view counter.
    expect(window.of).toBe(400)
  })

  it('excludes a month the denominator did not record', () => {
    const window = formStatsWindow(stats, 'views', 'submissions')
    const everything = Object.values(stats.periods).reduce(
      (sum, month) => sum + month.submissions,
      0,
    )
    expect(window.of).toBeLessThan(everything)
  })

  it('answers zero periods when the denominator was never recorded', () => {
    // Which every caller must render as a dash. A window of nothing is not a
    // rate of nought.
    expect(formStatsWindow(stats, 'starts', 'submissions')).toEqual({
      periods: 0,
      over: 0,
      of: 0,
    })
  })

  it('treats a month recorded at zero as no measurement', () => {
    // A key present at zero is the beacon having written nothing that month,
    // not the month having had no views. Counting it would deflate every rate
    // by however long the counter was dark.
    const window = formStatsWindow(
      { periods: { '2026-08': { submissions: 10, views: 0 } } },
      'views',
      'submissions',
    )
    expect(window.periods).toBe(0)
  })
})
