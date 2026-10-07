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

import { SnackbarProvider, useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
} from '@testing-library/react'
import { useEffect } from 'react'

/**
 * Every console toast can be closed by hand (AGL-3598). A toast covers the
 * bottom of a phone screen for its whole timer; the console's provider is
 * `dismissible`, which puts a close button after the message — and after a
 * toast's own action, rather than in place of it.
 */
function Toast(props: { message: string; options?: object }) {
  const { enqueueSnackbar } = useSnackbar()
  useEffect(() => {
    enqueueSnackbar(props.message, { persist: true, ...props.options })
    // One toast per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('dismissible toasts', () => {
  it('closes a toast from its close button', async () => {
    render(
      <SnackbarProvider dismissible>
        <Toast message="Default sharing updated" />
      </SnackbarProvider>,
    )
    expect(await screen.findByText('Default sharing updated')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitForElementToBeRemoved(() =>
      screen.queryByText('Default sharing updated'),
    )
  })

  it('keeps a toast’s own action beside the close button', async () => {
    render(
      <SnackbarProvider dismissible>
        <Toast
          message="Page deleted"
          options={{ action: <button type="button">Undo</button> }}
        />
      </SnackbarProvider>,
    )
    await screen.findByText('Page deleted')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('lets one toast opt out', async () => {
    render(
      <SnackbarProvider dismissible>
        <Toast message="Uploading…" options={{ dismissible: false }} />
      </SnackbarProvider>,
    )
    await screen.findByText('Uploading…')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('draws no close button unless the provider asks for one', async () => {
    render(
      <SnackbarProvider>
        <Toast message="Saved" />
      </SnackbarProvider>,
    )
    await screen.findByText('Saved')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})
