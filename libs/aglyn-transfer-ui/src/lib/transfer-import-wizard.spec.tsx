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
 * The import wizard, driven through the in-memory client the way a person
 * drives it: nothing moves on while a choice is open, every blocker is
 * written beside a disabled Next, Import waits for every warning class to
 * be acknowledged, applying can pause and resume, and undo asks before it
 * overwrites a record edited since.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleImportMappingZoneProps } from '@aglyn/aglyn/plugin-manager/record-zone-props'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import { PEOPLE_CSV, createPeopleClient } from '../fixtures/people'
import type { MemoryTransferClient } from './memory-transfer-client'
import { TransferImportWizard } from './transfer-import-wizard.component'
import type { TransferImportWizardProps } from './transfer-import-wizard.component'
import {
  memoryTransferWizardStorage,
  transferWizardStorageKey,
} from './transfer-wizard-state'
import { detectTransferFileSettings } from './transfer-file'

function choose(name: string | RegExp, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }))
  fireEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', { name: option }),
  )
}

const next = (name: string | RegExp = 'Next') =>
  fireEvent.click(screen.getByRole('button', { name }))

function renderWizard(
  client: MemoryTransferClient = createPeopleClient(),
  props: Partial<TransferImportWizardProps> = {},
) {
  const storage = memoryTransferWizardStorage()
  const onJobChange = jest.fn()
  const view = render(
    <TransferImportWizard
      client={client}
      resource="people"
      storage={storage}
      onJobChange={onJobChange}
      {...props}
    />,
  )
  return { ...view, client, storage, onJobChange }
}

async function toMapping(
  client?: MemoryTransferClient,
  props?: Partial<TransferImportWizardProps>,
) {
  const rendered = renderWizard(client, props)
  fireEvent.change(await screen.findByLabelText('Or paste rows'), {
    target: { value: PEOPLE_CSV },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Read pasted rows' }))
  expect(
    screen.getByRole('table', { name: 'Preview of the file' }),
  ).toBeTruthy()
  expect(screen.getByText(/4 rows, 7 columns/)).toBeTruthy()
  next('Upload and continue')
  await screen.findByRole('table', { name: 'Column matching' })
  return rendered
}

async function toValues(
  client?: MemoryTransferClient,
  props?: Partial<TransferImportWizardProps>,
) {
  const rendered = await toMapping(client, props)
  next()
  await screen.findByRole('table', {
    name: 'Stage values the list does not hold',
  })
  return rendered
}

async function toConflicts(
  client?: MemoryTransferClient,
  props?: Partial<TransferImportWizardProps>,
) {
  const rendered = await toValues(client, props)
  fireEvent.click(screen.getByRole('radio', { name: /Month first/ }))
  choose(/Team: what to do with “Reseach”/, /Use “Research”/)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(false),
  )
  next()
  await screen.findByText('Match rows to existing records by')
  next()
  await screen.findByText('When a row…')
  return rendered
}

async function toReview(
  client?: MemoryTransferClient,
  props?: Partial<TransferImportWizardProps>,
) {
  const rendered = await toConflicts(client, props)
  next()
  await screen.findByText('What this import will do')
  return rendered
}

function acknowledgeAll() {
  for (const box of screen.getAllByRole('checkbox', { name: /^I understand:/ }))
    fireEvent.click(box)
}

describe('TransferImportWizard', () => {
  it('reads a pasted file and proposes a field for every column, with why', async () => {
    const { onJobChange } = await toMapping()
    expect(onJobChange).toHaveBeenCalledWith('job-1')
    const row = screen
      .getByRole('cell', { name: 'Full Name' })
      .closest('tr') as HTMLElement
    expect(within(row).getByRole('combobox').textContent).toBe('Name')
    expect(within(row).getByText('100% sure')).toBeTruthy()
    expect(within(row).getByText(/Same name/)).toBeTruthy()
  })

  it('holds the mapping on two columns for one field and on a required field with no column', async () => {
    await toMapping()
    choose(/Field for column “E-mail”/, /^Name/)
    expect(
      await screen.findByText(/Name is chosen for “Full Name” and “E-mail”/),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true)
    choose(/Field for column “E-mail”/, /^Ignore this column/)
    choose(/Field for column “Full Name”/, /^Ignore this column/)
    expect(
      await screen.findByText('Required field with no column: Name.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('renders the importMapping zone with each column’s shape, never a cell, and takes its proposal', async () => {
    let zone: ConsoleImportMappingZoneProps | null = null
    const Slot = (props: { slot: string } & Record<string, unknown>) => {
      if (props.slot === 'importMapping')
        zone = props as unknown as ConsoleImportMappingZoneProps
      return <div>zone widget</div>
    }
    // The slot renderer comes from the console shell; here it wraps the wizard.
    const client = createPeopleClient()
    const storage = memoryTransferWizardStorage()
    render(
      <ConsoleWidgetSlotContext.Provider value={Slot}>
        <TransferImportWizard
          client={client}
          resource="people"
          storage={storage}
          importMappingZone={{
            collection: 'people',
            hostId: null,
            orgId: 'org-1',
          }}
        />
      </ConsoleWidgetSlotContext.Provider>,
    )
    fireEvent.change(await screen.findByLabelText('Or paste rows'), {
      target: { value: PEOPLE_CSV },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Read pasted rows' }))
    next('Upload and continue')
    await screen.findByText('zone widget')
    expect(zone!.columns.slice(0, 3)).toEqual([
      { header: 'Full Name', shape: 'text' },
      { header: 'E-mail', shape: 'email' },
      { header: 'Phone', shape: 'phone' },
    ])
    expect(JSON.stringify(zone!.columns)).not.toContain('ada@example.com')
    act(() =>
      zone!.proposeMapping(
        { 0: 'name', 1: 'email', 2: 'createdAt', 9: 'phone' },
        'ai',
      ),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /Field for column “Phone”/ })
          .textContent,
      ).toBe('Ignore this column'),
    )
    expect(
      screen.getByRole('combobox', { name: /Field for column “E-mail”/ })
        .textContent,
    ).toBe('Email')
  })

  it('asks what each unknown value becomes before it moves on', async () => {
    await toValues()
    expect(
      screen.getByRole('combobox', {
        name: /Stage: what to do with “Prospect”/,
      }).textContent,
    ).toBe('Leave the field blank')
    expect(
      screen.getByText(
        'Joined: choose whether its dates are month first or day first.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByText('Team: choose what to do with "Reseach".'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
    ).toBe(true)
    choose(/Stage: what to do with “Prospect”/, /^Map to a list value/)
    expect(
      screen.getByRole('combobox', { name: /Stage: list value for “Prospect”/ })
        .textContent,
    ).toBe('Lead')
    fireEvent.click(screen.getByRole('radio', { name: /Day first/ }))
    choose(/Team: what to do with “Reseach”/, /^Leave the field blank/)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
      ).toBe(false),
    )
  })

  it('shows a locked rule disabled with its reason, and re-plans on a field choice', async () => {
    await toConflicts()
    const score = screen.getByRole('combobox', {
      name: /Score: file value meets record value/,
    })
    expect(score.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Scores are computed from activity.')).toBeTruthy()
    const conflict = screen.getByRole('group', {
      name: 'Row 1 and Ada Lovelace',
    })
    const phone = within(conflict)
      .getByRole('cell', { name: 'Phone' })
      .closest('tr') as HTMLElement
    expect(
      within(phone).getByText('+1 555 0100', { selector: 'p' }),
    ).toBeTruthy()
    choose(/Phone: file value meets record value/, /^Overwrite/)
    await waitFor(() =>
      expect(within(phone).getByText(/Overwrite · This field/)).toBeTruthy(),
    )
  })

  it('keeps Import disabled until every warning class is acknowledged, then applies and undoes', async () => {
    const { client } = await toReview()
    const importButton = screen.getByRole('button', { name: 'Import 3 rows' })
    expect(importButton.hasAttribute('disabled')).toBe(true)
    const boxes = screen.getAllByRole('checkbox', { name: /^I understand:/ })
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
      'I understand: Values a list does not hold',
      'I understand: References that name no record',
      'I understand: Rows repeated in the file',
      'I understand: Values a rule holds back',
    ])
    for (const box of boxes.slice(0, 3)) fireEvent.click(box)
    expect(
      screen.getByText('Read and acknowledge 1 more warning below.'),
    ).toBeTruthy()
    expect(importButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(boxes[3] as HTMLElement)
    expect(importButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(importButton)
    await screen.findByText('Import finished')
    expect(screen.getByText('Created: 1')).toBeTruthy()
    expect(screen.getByText('Updated: 2')).toBeTruthy()
    expect(client.records.size).toBe(5)

    client.records.get('rec-2')!.values['team'] = 'Ops'
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Undo this import?',
    })
    expect(within(dialog).getByText(/was edited after the import/)).toBeTruthy()
    const confirm = within(dialog).getByRole('button', {
      name: 'Choose for 1 record',
    })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'Keep it as it is now' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Undo import' }))
    await screen.findByText('This import was undone')
    expect(client.records.size).toBe(4)
    expect(client.records.get('rec-2')?.values['team']).toBe('Ops')
  })

  it('pauses after the chunk in flight, resumes from the cursor, and lists failed rows as they arrive', async () => {
    const client = createPeopleClient({
      chunkRows: 1,
      applyFailures: { 2: 'The server refused this row.' },
    })
    const releases: (() => void)[] = []
    const apply = client.apply.bind(client)
    client.apply = (request) =>
      new Promise((resolve) => releases.push(() => resolve(apply(request))))
    const release = async () => {
      await waitFor(() => expect(releases.length).toBeGreaterThan(0))
      await act(async () => releases.shift()!())
    }
    await toReview(client)
    acknowledgeAll()
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 rows' }))
    await release()
    await screen.findByText('Importing… 1 of 4 rows')
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await release()
    await screen.findByText('Paused at 2 of 4 rows')
    expect(releases).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await release()
    expect(await screen.findByText('The server refused this row.')).toBeTruthy()
    await release()
    await screen.findByText('Import finished')
    expect(screen.getByText('Failed: 1')).toBeTruthy()
  })

  it('resumes a job on the step its draft was saved at', async () => {
    const client = createPeopleClient()
    const job = await client.upload({
      resource: 'people',
      fileName: 'people.csv',
      text: PEOPLE_CSV,
      bytes: 10,
      settings: detectTransferFileSettings('people.csv', PEOPLE_CSV),
    })
    const storage = memoryTransferWizardStorage()
    const first = renderWizard(client, { storage, jobId: job.id })
    await screen.findByRole('table', { name: 'Column matching' })
    choose(/Field for column “Score”/, /^Ignore this column/)
    next()
    await screen.findByRole('table', {
      name: 'Stage values the list does not hold',
    })
    expect(storage.load(transferWizardStorageKey('people', job.id))?.step).toBe(
      'values',
    )

    first.unmount()
    render(
      <TransferImportWizard
        client={client}
        resource="people"
        storage={storage}
        jobId={job.id}
      />,
    )
    await screen.findByRole('table', {
      name: 'Stage values the list does not hold',
    })
    expect(
      storage.load(transferWizardStorageKey('people', job.id))?.mapping[6],
    ).toBeUndefined()
  })

  it('places a plugin’s step and holds Next until it is answered', async () => {
    const consent = {
      id: 'consent',
      label: 'Consent',
      after: 'matching' as const,
      render: ({
        value,
        setValue,
      }: {
        value: unknown
        setValue(value: unknown): void
      }) => (
        <label>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => setValue(event.target.checked)}
          />
          These people agreed to hear from us
        </label>
      ),
      problems: ({ value }: { value: unknown }) =>
        value === true ? [] : ['Confirm these people agreed to hear from you.'],
    }
    await toValues(undefined, { extraSteps: [consent] })
    expect(
      within(
        screen.getByRole('navigation', { name: 'Import steps' }),
      ).getByText('Consent'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Month first/ }))
    choose(/Team: what to do with “Reseach”/, /^Leave the field blank/)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'),
      ).toBe(false),
    )
    next()
    await screen.findByText('Match rows to existing records by')
    next()
    await screen.findByText('Confirm these people agreed to hear from you.')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'These people agreed to hear from us',
      }),
    )
    next()
    await screen.findByText('When a row…')
  })

  it('reopens a passed step from the stepper', async () => {
    await toValues()
    const steps = screen.getByRole('navigation', { name: 'Import steps' })
    fireEvent.click(within(steps).getByRole('tab', { name: 'Columns' }))
    await screen.findByRole('table', { name: 'Column matching' })
  })
})
