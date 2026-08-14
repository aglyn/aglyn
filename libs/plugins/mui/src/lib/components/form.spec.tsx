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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Form, {
  FORM_SUBMITTED_EVENT,
  FormField,
  formNavigation,
  formFieldSchema,
  formSchema,
  parseFieldOptions,
  resolveRedirectTarget,
  sanitizeRedirectUrl,
  type FormProps,
} from './form'

/** Renders children inside a Form with a live site context + fetch mock. */
const renderForm = (
  children: React.ReactNode,
  formProps: Partial<FormProps> = {},
) => {
  const utils = render(
    <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
      <Form formName="Survey" {...formProps}>
        {children}
      </Form>
    </Aglyn.SiteContext.Provider>,
  )
  const form = utils.container.querySelector('form') as HTMLFormElement
  return { ...utils, form }
}

/** Body payload of the (single) mocked submit call. */
const submittedBody = (fetchMock: jest.Mock): Record<string, any> => {
  const [, init] = fetchMock.mock.calls[0]
  return JSON.parse(init.body)
}

/** Fields payload of the (single) mocked submit call. */
const submittedFields = (fetchMock: jest.Mock): Record<string, string> =>
  submittedBody(fetchMock).fields

describe('form survey fields (AGL-544)', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  describe('parseFieldOptions', () => {
    it('splits newline- and comma-separated lists', () => {
      expect(parseFieldOptions('Red\nGreen\nBlue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
      expect(parseFieldOptions('Red, Green, Blue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
      expect(parseFieldOptions('Red\nGreen, Blue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
    })

    it('trims entries and drops empties', () => {
      expect(parseFieldOptions('  Red \r\n\n , ,Blue  ')).toEqual([
        'Red',
        'Blue',
      ])
      expect(parseFieldOptions('')).toEqual([])
      expect(parseFieldOptions(undefined)).toEqual([])
    })
  })

  describe('FormField rendering', () => {
    it('keeps the legacy default text input behavior', () => {
      const { container } = render(<FormField fieldName="name" />)
      const input = container.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement
      expect(input.type).toBe('text')
      expect(input.required).toBe(false)
    })

    it('renders a required select with the parsed choices', () => {
      const { container } = render(
        <FormField
          fieldName="color"
          label="Color"
          fieldType="select"
          options={'Red\nGreen\nBlue'}
          required
        />,
      )
      const nativeInput = container.querySelector(
        'input[name="color"]',
      ) as HTMLInputElement
      expect(nativeInput.required).toBe(true)
      fireEvent.mouseDown(screen.getByRole('combobox'))
      const options = screen.getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
    })

    it('renders a required radio group with one radio per choice', () => {
      render(
        <FormField
          fieldName="size"
          label="Size"
          fieldType="radio"
          options="Small, Medium, Large"
          required
        />,
      )
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radios).toHaveLength(3)
      expect(radios.map((radio) => radio.value)).toEqual([
        'Small',
        'Medium',
        'Large',
      ])
      for (const radio of radios) {
        expect(radio.name).toBe('size')
        expect(radio.required).toBe(true)
      }
    })

    it('requires a checkbox group only until one box is ticked', () => {
      render(
        <FormField
          fieldName="toppings"
          fieldType="checkbox"
          options="Cheese, Olives"
          required
        />,
      )
      const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(boxes.map((box) => box.required)).toEqual([true, true])
      fireEvent.click(boxes[0])
      expect(boxes.map((box) => box.required)).toEqual([false, false])
      fireEvent.click(boxes[0])
      expect(boxes.map((box) => box.required)).toEqual([true, true])
    })
  })

  /**
   * AGL-1330: the frames pair a label ABOVE the control with a grey
   * placeholder inside it, and Form Field had no placeholder at all — the
   * copy on /contact and /contact-sales simply could not be published.
   */
  describe('field placeholder (AGL-1330)', () => {
    it('renders the placeholder on a text input', () => {
      const { container } = render(
        <FormField
          fieldName="email"
          label="Work email"
          fieldType="email"
          placeholder="you@company.com"
        />,
      )
      const input = container.querySelector(
        'input[name="email"]',
      ) as HTMLInputElement
      expect(input.getAttribute('placeholder')).toBe('you@company.com')
    })

    it('renders the placeholder on a multiline field', () => {
      const { container } = render(
        <FormField
          fieldName="message"
          label="Message"
          fieldType="textarea"
          placeholder="How can we help?"
        />,
      )
      const textarea = container.querySelector(
        'textarea[name="message"]',
      ) as HTMLTextAreaElement
      expect(textarea.getAttribute('placeholder')).toBe('How can we help?')
    })

    it('renders NO placeholder attribute when none is set', () => {
      const { container } = render(<FormField fieldName="name" label="Name" />)
      const input = container.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement
      expect(input.hasAttribute('placeholder')).toBe(false)
    })

    /**
     * Clearing must persist as cleared. The attributes form drops an
     * emptied text field's key entirely and `updateNodeProps` REPLACES the
     * props object, so a cleared placeholder reaches the component as
     * absent — but pre-existing documents can still carry `''`/`null`, and
     * neither may reach the DOM as an empty `placeholder` attribute.
     */
    it('treats a cleared or blank placeholder as no placeholder', () => {
      for (const cleared of ['', '   ', null, undefined]) {
        const { container, unmount } = render(
          <FormField
            fieldName="name"
            label="Name"
            placeholder={cleared as unknown as string}
          />,
        )
        const input = container.querySelector(
          'input[name="name"]',
        ) as HTMLInputElement
        expect(input.hasAttribute('placeholder')).toBe(false)
        // The label is untouched by clearing — it is a separate prop.
        expect(screen.getByRole('textbox', { name: 'Name' })).toBe(input)
        unmount()
      }
    })

    it('keeps the label as the accessible name — a placeholder is not a label', () => {
      const { container } = render(
        <FormField
          fieldName="message"
          label="Message"
          placeholder="How can we help?"
        />,
      )
      // The placeholder never becomes the name…
      expect(
        screen.queryByRole('textbox', { name: 'How can we help?' }),
      ).toBeNull()
      const input = screen.getByRole('textbox', { name: 'Message' })
      expect(input.getAttribute('placeholder')).toBe('How can we help?')
      // …and both are visible at once: MUI hides the placeholder while the
      // label still sits inside the box, so the label must be shrunk.
      expect(container.querySelector('label')?.className).toContain(
        'MuiInputLabel-shrink',
      )
    })

    it('leaves the floating label alone when there is no placeholder', () => {
      const { container } = render(
        <FormField fieldName="message" label="Message" />,
      )
      expect(container.querySelector('label')?.className).not.toContain(
        'MuiInputLabel-shrink',
      )
    })

    it('shows the placeholder as a dropdown’s empty display value', () => {
      render(
        <FormField
          fieldName="teamSize"
          label="Team size"
          fieldType="select"
          options={'1-10\n11-50'}
          placeholder="Select"
        />,
      )
      // A Select has no native placeholder; it displays the hint until a
      // choice is made (needs `displayEmpty` — MUI renders nothing for '').
      expect(screen.getByRole('combobox').textContent).toBe('Select')
    })

    it('never leaks the placeholder onto choice fields, which have no input', () => {
      for (const fieldType of ['radio', 'checkbox', 'rating'] as const) {
        const { container, unmount } = render(
          <FormField
            fieldName="size"
            label="Size"
            fieldType={fieldType}
            options="Small, Large"
            placeholder="Pick one"
          />,
        )
        expect(container.querySelector('[placeholder]')).toBeNull()
        unmount()
      }
    })

    it('exposes Placeholder as a free-text attribute alongside Label', () => {
      const byName = Object.fromEntries(
        (formFieldSchema.attributes ?? []).map((attribute) => [
          attribute.name,
          attribute,
        ]),
      )
      expect(byName['placeholder']?.label).toBe('Placeholder')
      expect(byName['placeholder']?.component).toBe(
        Aglyn.FieldComponentType.TEXT_FIELD,
      )
      // Free text, not a choice list: the AGL-1191 trap (an option whose
      // value is `''` can never persist) needs an option to bite, and
      // clearing free text is exactly how the hint is removed.
      expect(byName['placeholder']?.options).toBeUndefined()
      // The label attribute survives — the placeholder never replaces it.
      expect(byName['label']?.label).toBe('Label')
    })
  })

  describe('Form submission', () => {
    it('joins multiple checkbox values under one field name', async () => {
      const { form } = renderForm(
        <FormField
          fieldName="toppings"
          fieldType="checkbox"
          options={'Cheese\nOlives\nPeppers'}
        />,
      )
      const boxes = screen.getAllByRole('checkbox')
      fireEvent.click(boxes[0])
      fireEvent.click(boxes[2])
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(submittedFields(fetchMock)).toEqual({
        toppings: 'Cheese, Peppers',
      })
    })

    it('serializes the rating as a number and hides the star radios', async () => {
      const { form } = renderForm(
        <FormField fieldName="satisfaction" fieldType="rating" />,
      )
      fireEvent.click(screen.getByRole('radio', { name: '4 Stars' }))
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      // Only the hidden input submits; the `__`-prefixed radios do not.
      expect(submittedFields(fetchMock)).toEqual({ satisfaction: '4' })
    })
  })

  describe('after-submit outcomes (AGL-557)', () => {
    describe('sanitizeRedirectUrl', () => {
      it('allows same-site paths and absolute https URLs', () => {
        expect(sanitizeRedirectUrl('/thanks')).toBe('/thanks')
        expect(sanitizeRedirectUrl('  /thanks?x=1  ')).toBe('/thanks?x=1')
        expect(sanitizeRedirectUrl('https://example.com/next')).toBe(
          'https://example.com/next',
        )
        expect(sanitizeRedirectUrl('HTTPS://EXAMPLE.COM')).toBe(
          'HTTPS://EXAMPLE.COM',
        )
      })

      it('rejects protocol-relative, http, and script URLs', () => {
        expect(sanitizeRedirectUrl('//evil.com/x')).toBeUndefined()
        expect(sanitizeRedirectUrl('http://example.com')).toBeUndefined()
        expect(sanitizeRedirectUrl('javascript:alert(1)')).toBeUndefined()
        expect(sanitizeRedirectUrl('data:text/html,x')).toBeUndefined()
        expect(sanitizeRedirectUrl('thanks')).toBeUndefined()
        expect(sanitizeRedirectUrl('')).toBeUndefined()
        expect(sanitizeRedirectUrl(undefined)).toBeUndefined()
      })
    })

    describe('resolveRedirectTarget', () => {
      it('prefers the resolved screen href over the manual URL', () => {
        expect(resolveRedirectTarget('/thanks', 'https://x.com')).toBe(
          '/thanks',
        )
        expect(resolveRedirectTarget(undefined, '/thanks')).toBe('/thanks')
        expect(
          resolveRedirectTarget(undefined, 'javascript:alert(1)'),
        ).toBeUndefined()
        expect(resolveRedirectTarget(undefined, undefined)).toBeUndefined()
      })
    })

    /** jsdom's location is unpatchable — stub the navigation seam. */
    const mockLocationAssign = () => {
      const assign = jest
        .spyOn(formNavigation, 'assign')
        .mockImplementation(() => undefined)
      return { assign, restore: () => assign.mockRestore() }
    }

    const renderOutcomeForm = (
      props: Partial<React.ComponentProps<typeof Form>>,
      context: Partial<Aglyn.ScreenLinkContextValue> = {},
    ) => {
      const utils = render(
        <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
          <Aglyn.ScreenLinkContext.Provider value={context}>
            <Form formName="Signup" {...props}>
              <FormField fieldName="email" fieldType="email" />
            </Form>
          </Aglyn.ScreenLinkContext.Provider>
        </Aglyn.SiteContext.Provider>,
      )
      const form = utils.container.querySelector('form') as HTMLFormElement
      return { ...utils, form }
    }

    it('dispatches the submitted event on success', async () => {
      const listener = jest.fn()
      window.addEventListener(FORM_SUBMITTED_EVENT, listener)
      const { form } = renderOutcomeForm({})
      fireEvent.submit(form)
      await waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
        formName: 'Signup',
      })
      window.removeEventListener(FORM_SUBMITTED_EVENT, listener)
    })

    it('redirects to the resolved screen route after a successful submit', async () => {
      const { assign, restore } = mockLocationAssign()
      const { form } = renderOutcomeForm(
        { afterSubmit: 'redirect', redirectScreenId: 'scr-1' },
        { screens: { 'scr-1': 'thank-you' } },
      )
      fireEvent.submit(form)
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith('/thank-you'),
      )
      restore()
    })

    it('falls back to the message and never navigates on a bad URL', async () => {
      const { assign, restore } = mockLocationAssign()
      const { form } = renderOutcomeForm({
        afterSubmit: 'redirect',
        redirectUrl: '//evil.com/x',
      })
      fireEvent.submit(form)
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toMatch(/Thanks/),
      )
      expect(assign).not.toHaveBeenCalled()
      restore()
    })

    it('never navigates on editing surfaces (suppressNavigation)', async () => {
      const { assign, restore } = mockLocationAssign()
      const { form } = renderOutcomeForm(
        { afterSubmit: 'redirect', redirectScreenId: 'scr-1' },
        { screens: { 'scr-1': 'thank-you' }, suppressNavigation: true },
      )
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(assign).not.toHaveBeenCalled()
      restore()
    })

    it('hides the reveal target until submit, then unmounts with the form', async () => {
      const { container, form } = renderOutcomeForm({
        afterSubmit: 'reveal',
        revealNodeId: 'node-1',
      })
      const style = container.querySelector('style')
      expect(style?.textContent).toBe(
        '[data-aglyn="leaf:node-1"]{display:none !important}',
      )
      fireEvent.submit(form)
      // The whole form (style tag included) unmounts — that is the reveal.
      await waitFor(() =>
        expect(container.querySelector('style')).toBeNull(),
      )
      expect(container.querySelector('form')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('ignores reveal ids that could smuggle CSS selector syntax', async () => {
      const { container, form } = renderOutcomeForm({
        afterSubmit: 'reveal',
        revealNodeId: 'x"],body{display:none}',
      })
      expect(container.querySelector('style')).toBeNull()
      fireEvent.submit(form)
      // Degrades to the message outcome.
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toMatch(/Thanks/),
      )
    })

    it('keeps the reveal target visible on editing surfaces', () => {
      const { container } = renderOutcomeForm(
        { afterSubmit: 'reveal', revealNodeId: 'node-1' },
        { suppressNavigation: true },
      )
      expect(container.querySelector('style')).toBeNull()
    })

    it('declares the outcome attributes with edit-time conditions', () => {
      const byName = Object.fromEntries(
        (formSchema.attributes ?? []).map((attribute) => [
          attribute.name,
          attribute,
        ]),
      )
      // `message`, not `''`, since AGL-1451 — the first member of the
      // declared FormAfterSubmit union, so the outcome can be set back.
      expect((byName['afterSubmit']?.options ?? []).map((o: any) => o.value))
        .toEqual(['message', 'redirect', 'reveal'])
      expect(byName['redirectScreenId']?.component).toBe(
        Aglyn.FieldComponentType.SCREEN_SELECT,
      )
      expect(byName['revealNodeId']?.component).toBe(
        Aglyn.FieldComponentType.NODE_SELECT,
      )
      expect(byName['redirectScreenId']?.condition).toEqual({
        when: 'afterSubmit',
        is: 'redirect',
      })
      expect(byName['revealNodeId']?.condition).toEqual({
        when: 'afterSubmit',
        is: 'reveal',
      })
    })
  })

  describe('conditional automations over submitted fields (AGL-565)', () => {
    /**
     * Submits a survey with a ticked `subscribe` box and a filled `email`
     * and returns the fields payload — the exact object the action
     * pipeline hands to evaluateTriggerConditions on formSubmission.
     */
    const submitSurvey = async () => {
      const { form } = renderForm(
        <>
          <FormField fieldName="email" fieldType="email" />
          <FormField
            fieldName="subscribe"
            fieldType="checkbox"
            options="Keep me posted"
          />
        </>,
      )
      fireEvent.change(form.querySelector('input[name="email"]') as Element, {
        target: { value: 'ada@example.com' },
      })
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      return submittedFields(fetchMock)
    }

    it('still honors a legacy single-condition automation (AGL-557 shape)', async () => {
      const fields = await submitSurvey()
      // Pre-565 docs carry `condition`; nothing about them changes.
      expect(
        Aglyn.evaluateTriggerConditions(
          { condition: { field: 'subscribe', op: 'notEmpty' } },
          fields,
        ),
      ).toBe(true)
      expect(
        Aglyn.evaluateTriggerConditions(
          { condition: { field: 'phone', op: 'notEmpty' } },
          fields,
        ),
      ).toBe(false)
    })

    it('AND chains require every condition over the submission', async () => {
      const fields = await submitSurvey()
      const conditions: Aglyn.HostActionTriggerCondition[] = [
        { field: 'subscribe', op: 'notEmpty' },
        { field: 'email', op: 'contains', value: '@example.com' },
      ]
      expect(
        Aglyn.evaluateTriggerConditions(
          { conditions, combinator: 'and' },
          fields,
        ),
      ).toBe(true)
      expect(
        Aglyn.evaluateTriggerConditions(
          {
            conditions: [...conditions, { field: 'phone', op: 'notEmpty' }],
            combinator: 'and',
          },
          fields,
        ),
      ).toBe(false)
    })

    it('OR chains pass on any matching condition', async () => {
      const fields = await submitSurvey()
      expect(
        Aglyn.evaluateTriggerConditions(
          {
            conditions: [
              { field: 'phone', op: 'notEmpty' },
              { field: 'subscribe', op: 'contains', value: 'keep me posted' },
            ],
            combinator: 'or',
          },
          fields,
        ),
      ).toBe(true)
      expect(
        Aglyn.evaluateTriggerConditions(
          {
            conditions: [
              { field: 'phone', op: 'notEmpty' },
              { field: 'email', op: 'equals', value: 'someone-else' },
            ],
            combinator: 'or',
          },
          fields,
        ),
      ).toBe(false)
    })
  })

  describe('dataset binding by id (AGL-556)', () => {
    it('sends datasetId, with the legacy name riding along', async () => {
      const { form } = renderForm(<FormField fieldName="comments" />, {
        datasetId: 'ds-1',
        datasetName: 'Survey responses',
      })
      fireEvent.change(form.querySelector('input[name="comments"]') as Element, {
        target: { value: 'Hi' },
      })
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = submittedBody(fetchMock)
      expect(body.datasetId).toBe('ds-1')
      expect(body.dataset).toBe('Survey responses')
    })

    it('sends only the legacy name for pre-556 nodes', async () => {
      const { form } = renderForm(<FormField fieldName="comments" />, {
        datasetName: 'Survey responses',
      })
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = submittedBody(fetchMock)
      expect(body.datasetId).toBeUndefined()
      expect(body.dataset).toBe('Survey responses')
    })

    it('collects field → schema-field mappings without leaking them into fields', async () => {
      const { form } = renderForm(
        <>
          <FormField fieldName="stars" datasetFieldId="satisfaction" />
          <FormField fieldName="feedback" />
        </>,
        { datasetId: 'ds-1' },
      )
      fireEvent.change(form.querySelector('input[name="stars"]') as Element, {
        target: { value: '5' },
      })
      fireEvent.change(
        form.querySelector('input[name="feedback"]') as Element,
        { target: { value: 'Great' } },
      )
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = submittedBody(fetchMock)
      expect(body.fieldMap).toEqual({ stars: 'satisfaction' })
      expect(body.fields).toEqual({ stars: '5', feedback: 'Great' })
    })

    it('omits fieldMap entirely when no field is mapped', async () => {
      const { form } = renderForm(<FormField fieldName="comments" />, {
        datasetId: 'ds-1',
      })
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(submittedBody(fetchMock).fieldMap).toBeUndefined()
    })

    it('maps every survey field type, including the rating', async () => {
      const { form } = renderForm(
        <FormField
          fieldName="stars"
          fieldType="rating"
          datasetFieldId="satisfaction"
        />,
        { datasetId: 'ds-1' },
      )
      fireEvent.click(screen.getByRole('radio', { name: '4 Stars' }))
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = submittedBody(fetchMock)
      expect(body.fields).toEqual({ stars: '4' })
      expect(body.fieldMap).toEqual({ stars: 'satisfaction' })
    })

    it('exposes the dataset picker by id and keeps the legacy name field conditional', () => {
      const datasetId = formSchema.attributes?.find(
        (attribute) => attribute.name === 'datasetId',
      )
      expect(datasetId?.component).toBe(
        Aglyn.FieldComponentType.DATASET_SELECT,
      )
      const datasetName = formSchema.attributes?.find(
        (attribute) => attribute.name === 'datasetName',
      )
      expect(datasetName?.condition).toEqual({
        when: 'datasetName',
        isNotEmpty: true,
      })
    })

    it('exposes the schema-field mapping picker on form fields', () => {
      const datasetFieldId = formFieldSchema.attributes?.find(
        (attribute) => attribute.name === 'datasetFieldId',
      )
      expect(datasetFieldId?.component).toBe(
        Aglyn.FieldComponentType.DATASET_FIELD_SELECT,
      )
    })
  })

  describe('formFieldSchema', () => {
    it('offers every survey field type in the editor', () => {
      const fieldType = formFieldSchema.attributes?.find(
        (attribute) => attribute.name === 'fieldType',
      )
      const values = (fieldType?.options ?? []).map(
        (option: { value: string }) => option.value,
      )
      for (const expected of ['select', 'radio', 'checkbox', 'rating']) {
        expect(values).toContain(expected)
      }
    })

    it('exposes an options textarea for the choice lists', () => {
      const options = formFieldSchema.attributes?.find(
        (attribute) => attribute.name === 'options',
      )
      expect(options?.component).toBe(Aglyn.FieldComponentType.TEXTAREA)
    })
  })
})

/**
 * A refused submit says the RIGHT no (AGL-1511).
 *
 * Two deliberate 423s can now reach this block — Preview declining a write
 * client-side, and a read-only lockdown refusing a real visitor's write on a
 * live site — and until this issue the component keyed on the status alone.
 * That would have told a paying customer's visitor "this form works on your
 * published site" while they stood on the published site.
 */
describe('AGL-1511 · a refused submit', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const submitAnd = async (response: {
    ok: boolean
    status: number
    body: unknown
  }) => {
    fetchMock.mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    })
    const { container } = render(
      <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
        <Form formName="Contact">
          <FormField fieldName="email" fieldType="text" />
        </Form>
      </Aglyn.SiteContext.Provider>,
    )
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    return container
  }

  it('renders the lockdown pause inline, in the server’s own words', async () => {
    const container = await submitAnd({
      ok: false,
      status: 423,
      body: {
        error: 'locked',
        mode: 'read-only',
        title: 'Temporarily paused',
        message:
          'This form is not accepting submissions for a few minutes. ' +
          'Nothing you typed has been lost — please try again shortly.',
      },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('Nothing you typed'),
    )
    // NOT the generic failure, and NOT the Preview sentence.
    expect(container.textContent).not.toContain('Something went wrong')
    expect(container.textContent).not.toContain('published site')
    // `info`, not `error`: nothing failed and nothing was lost. Matched on
    // the severity token inside the class list rather than one exact MUI
    // class, which moves between variants and major versions.
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.className).toContain('Info')
    expect(alert?.className).not.toContain('Error')
  })

  it('still shows the Preview notice for Preview’s own 423', async () => {
    const container = await submitAnd({
      ok: false,
      status: 423,
      body: { error: 'Preview does not change real data.', preview: true },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('published site'),
    )
  })

  it('leaves a real failure saying so', async () => {
    const container = await submitAnd({
      ok: false,
      status: 500,
      body: { error: 'Submission failed' },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('Something went wrong'),
    )
  })
})

/**
 * The abuse ceiling's visitor (AGL-1666).
 *
 * AGL-1655 added `code: 'form-abuse-ceiling'` to the 429 so this component
 * could tell it apart from the Free plan's monthly wall, which answers the
 * same status. Nothing consumed it, so a real customer of a customer filled
 * in a lead form, was told "something went wrong — please try again", and
 * retried into the identical refusal. The site owner never learned they lost
 * the lead.
 *
 * The status is deliberately NOT what selects this branch. Both 429s reach
 * here and only the code separates them.
 */
describe('AGL-1666 · a form refused by the site’s abuse ceiling', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const submitAnd = async (response: {
    ok: boolean
    status: number
    body: unknown
  }) => {
    fetchMock.mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    })
    const { container } = render(
      <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
        <Form formName="Contact">
          <FormField fieldName="email" fieldType="text" />
        </Form>
      </Aglyn.SiteContext.Provider>,
    )
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    return container
  }

  it('tells the visitor the message was not sent, without saying why', async () => {
    const container = await submitAnd({
      ok: false,
      status: 429,
      body: {
        error: 'Submissions are paused for this site',
        code: 'form-abuse-ceiling',
      },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('was not sent'),
    )
    // Not the generic failure it used to be, and not the Preview sentence.
    expect(container.textContent).not.toContain('Something went wrong')
    expect(container.textContent).not.toContain('published site')
    // Nothing about the OWNER's account reaches a stranger standing on their
    // site — not the volume, not the ceiling, not the word for either.
    for (const leak of ['limit', 'abuse', 'unusual', 'bot', 'plan', 'spam']) {
      expect(container.textContent?.toLowerCase()).not.toContain(leak)
    }
  })

  it('renders as a warning — not reassurance, not a breakage', async () => {
    const container = await submitAnd({
      ok: false,
      status: 429,
      body: { error: 'paused', code: 'form-abuse-ceiling' },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('was not sent'),
    )
    // Severity token inside the class list, like the AGL-1511 spec above:
    // one exact MUI class moves between variants and major versions.
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.className).toContain('Warning')
    expect(alert?.className).not.toContain('Error')
    expect(alert?.className).not.toContain('Success')
  })

  it('offers the site’s own contact address as a mailto link', async () => {
    const container = await submitAnd({
      ok: false,
      status: 429,
      body: {
        error: 'paused',
        code: 'form-abuse-ceiling',
        contact: 'help@northwind.example',
      },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('help@northwind.example'),
    )
    const link = container.querySelector('a[href^="mailto:"]')
    expect(link?.getAttribute('href')).toBe('mailto:help@northwind.example')
  })

  it('still refuses honestly when the site publishes no contact', async () => {
    const container = await submitAnd({
      ok: false,
      status: 429,
      body: { error: 'paused', code: 'form-abuse-ceiling' },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('was not sent'),
    )
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
    expect(container.textContent).not.toContain('In the meantime')
  })

  it('leaves the Free plan’s 429 on the generic branch', async () => {
    // Same status, no code. This one is not fixed by waiting and not fixed
    // by writing to the site — it is the owner's plan. Claiming the form is
    // "not accepting right now" would be a different, wrong story.
    const container = await submitAnd({
      ok: false,
      status: 429,
      body: { error: 'Submission limit reached' },
    })
    await waitFor(() =>
      expect(container.textContent).toContain('Something went wrong'),
    )
    expect(container.textContent).not.toContain('was not sent')
  })
})
