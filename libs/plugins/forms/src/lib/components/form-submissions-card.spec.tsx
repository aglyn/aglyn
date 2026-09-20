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
 */

import { registerConsoleExtension, unregisterConsoleExtension } from '@aglyn/aglyn'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FormSubmissionsCard } from './form-submissions-card.component'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header: string; children: ReactNode }) => (
    <section aria-label={header}>{children}</section>
  ),
}))

/**
 * THE FORM PAGE HOSTS A ZONE; IT DOES NOT IMPORT A READER.
 *
 * The reader of one form's submissions belongs to whichever plugin reads
 * submissions. This card draws the `formSubmissions` zone behind the reader's
 * ask, and says plainly when nothing in the workspace registered one.
 */

/** What the shell's slot renderer was asked to draw, and with what. */
const drawn: Array<Record<string, unknown>> = []
const Slot = (props: { slot: string } & Record<string, unknown>) => {
  drawn.push(props)
  return <div data-testid="zone">{`zone:${props.slot}`}</div>
}

const renderCard = () =>
  render(
    <ConsoleWidgetSlotContext.Provider value={Slot}>
      <FormSubmissionsCard hostId="host-1" formId="form-9" />
    </ConsoleWidgetSlotContext.Provider>,
  )

beforeEach(() => {
  drawn.length = 0
  unregisterConsoleExtension('reader')
})

describe('one form’s submissions, read through a zone', () => {
  it('says where submissions are read when no plugin registered a reader', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Show submissions' })).toBeNull()
    expect(screen.getByText(/Submissions are read in the Inbox/)).toBeTruthy()
    expect(drawn).toEqual([])
  })

  it('draws the zone with the site and the form, and only after the ask', () => {
    // A plugin that reads submissions, standing in for the Inbox.
    registerConsoleExtension({
      pluginId: 'reader',
      displayName: 'Reader',
      widgets: [
        { slot: 'formSubmissions', widgetId: 'reader-form', title: 'Submissions', Component: () => null },
      ],
    })
    renderCard()
    // Opening the page reads nothing: the zone is not drawn until asked.
    expect(drawn).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Show submissions' }))
    expect(screen.getByTestId('zone').textContent).toBe('zone:formSubmissions')
    expect(drawn.at(-1)).toEqual({
      slot: 'formSubmissions',
      hostId: 'host-1',
      formId: 'form-9',
    })
  })
})
