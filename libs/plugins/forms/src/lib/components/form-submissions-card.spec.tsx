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

import {
  registerConsoleExtension,
  TransferLauncherContext,
  unregisterConsoleExtension,
  type TransferExportLaunch,
  type TransferLauncher,
} from '@aglyn/aglyn'
import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { FormSubmissionsCard } from './form-submissions-card.component'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    header,
    HeaderProps,
    children,
  }: {
    header: string
    HeaderProps?: { action?: ReactNode }
    children: ReactNode
  }) => (
    <section aria-label={header}>
      {HeaderProps?.action ?? null}
      {children}
    </section>
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

describe('exporting one form’s submissions', () => {
  const exports: TransferExportLaunch[] = []
  const launcher: TransferLauncher = {
    openImport: () => {
      throw new Error('submissions are never imported')
    },
    openExport: (launch) => exports.push(launch),
    close: () => undefined,
    can: () => true,
  }

  beforeEach(() => {
    exports.length = 0
  })

  it('opens the export dialog on this form, from the card header, with no Import beside it', () => {
    render(
      <TransferLauncherContext.Provider value={launcher}>
        <FormSubmissionsCard hostId="host-1" formId="form-9" formName="Contact us" />
      </TransferLauncherContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(exports).toEqual([
      {
        resource: 'forms.submissions',
        scope: 'host',
        hostId: 'host-1',
        filter: { label: 'Form: Contact us', value: { formId: 'form-9' } },
      },
    ])
  })

  it('names the form by its id until its name is read', () => {
    render(
      <TransferLauncherContext.Provider value={launcher}>
        <FormSubmissionsCard hostId="host-1" formId="form-9" />
      </TransferLauncherContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(exports[0]?.filter?.label).toBe('Form: form-9')
  })

  it('offers no Export outside the console shell', () => {
    renderCard()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })
})
