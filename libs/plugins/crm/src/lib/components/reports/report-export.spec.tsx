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
 * A report table's Export CSV writes the rows on screen, once, when asked
 * (AGL-2624): the header first, the rows in the table's order, quoted by
 * the one serializer the contacts export uses, and nothing at all while the
 * card has nothing to write.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { downloadTextFile } from '../../model/contacts-csv'
import { ReportExport } from './report-export'

jest.mock('../../model/contacts-csv', () => ({
  ...jest.requireActual('../../model/contacts-csv'),
  downloadTextFile: jest.fn(),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  MdiIcon: () => null,
}))

const download = downloadTextFile as jest.MockedFunction<typeof downloadTextFile>

beforeEach(() => {
  download.mockClear()
})

describe('ReportExport', () => {
  it('hands the browser the header and the rows as one CSV, built on the click', () => {
    const rows = jest.fn(() => [
      ['Ada, Countess', 3],
      ['Grace', 1],
    ])
    render(
      <ReportExport
        filename="crm-activity-30d.csv"
        columns={['Teammate', 'Activities']}
        rows={rows}
      />,
    )
    expect(rows).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(rows).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(
      'crm-activity-30d.csv',
      'text/csv',
      'Teammate,Activities\n"Ada, Countess",3\nGrace,1',
    )
  })

  it('writes nothing while disabled, and shows the window caption beside the button', () => {
    render(
      <ReportExport
        filename="crm-activity-30d.csv"
        columns={['Teammate']}
        rows={() => []}
        disabled
        caption="Grouped from the 1,000 most recent activities."
      />,
    )
    const button = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(download).not.toHaveBeenCalled()
    expect(
      screen.getByText('Grouped from the 1,000 most recent activities.'),
    ).toBeTruthy()
  })
})
