/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import React from 'react'
import {act, render, waitFor} from '@testing-library/react'

import DialogConfirm from './dialog-confirm'


describe('NavbarDrawer', () => {
  it('should render successfully', () => {
    const {baseElement} = render(<DialogConfirm open />)
    expect(baseElement).toBeTruthy()
  })
})

describe('DialogConfirm confirmationHeldUntil (AGL-4047)', () => {
  it('holds the confirm button, never Cancel, until the work settles', async () => {
    let finish!: () => void
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { getByRole } = render(
      <DialogConfirm
        open
        options={{ confirmationText: 'Limit access', cancellationText: 'Cancel', confirmationHeldUntil: work }}
      />,
    )
    const confirm = getByRole('button', { name: 'Limit access' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect((getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => finish())
    await waitFor(() => expect(confirm.disabled).toBe(false))
  })

  it('lets go when the work fails too', async () => {
    const work = Promise.reject(new Error('failed'))
    work.catch(() => undefined)
    const { getByRole } = render(
      <DialogConfirm open options={{ confirmationText: 'OK', confirmationHeldUntil: work }} />,
    )
    await waitFor(() => expect((getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('holds nothing without work', () => {
    const { getByRole } = render(<DialogConfirm open options={{ confirmationText: 'OK' }} />)
    expect((getByRole('button', { name: 'OK' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
