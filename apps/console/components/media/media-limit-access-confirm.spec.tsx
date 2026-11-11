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
 * AGL-4047: the "Limit who can use this file?" confirmation said "Current
 * usage was not checked" though `/api/media/references` had answered (after
 * 10–12 s in production, over a workspace with more sites than one scan
 * reads). It now opens at once saying it is checking, holds "Limit access"
 * until the check answers, then says what the check found. Built over the
 * REAL `ConfirmationProviderComponent`, with a check the test settles by hand.
 */

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { confirmLimitAccess } from './media-limit-access-confirm.component'
import type { LimitAccessUsage } from './media-sharing'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Ask(props: { usage: Promise<LimitAccessUsage>; onAnswer: (answer: boolean) => void }) {
  const { confirm } = useConfirmationContext()
  useEffect(() => {
    void confirmLimitAccess({
      title: 'Limit who can use this file?',
      count: 1,
      allExcept: false,
      usage: props.usage,
      confirm: confirm as (options: object) => Promise<unknown>,
    }).then(props.onAnswer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function open(usage: Promise<LimitAccessUsage>) {
  const onAnswer = jest.fn()
  render(
    <ConfirmationProviderComponent>
      <Ask usage={usage} onAnswer={onAnswer} />
    </ConfirmationProviderComponent>,
  )
  return onAnswer
}

const limitButton = () => screen.getByRole('button', { name: 'Limit access' })

describe('confirmLimitAccess (AGL-4047)', () => {
  it('opens before the check answers, says it is checking, and holds Limit access', async () => {
    const check = deferred<LimitAccessUsage>()
    open(check.promise)
    expect(await screen.findByText('Limit who can use this file?')).toBeTruthy()
    expect(screen.getByText(/Checking which sites use this file…/)).toBeTruthy()
    expect(screen.queryByText(/not checked/)).toBeNull()
    expect((limitButton() as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('says what a check of part of the workspace found, then lets the person limit access', async () => {
    const check = deferred<LimitAccessUsage>()
    const onAnswer = open(check.promise)
    await screen.findByText('Limit who can use this file?')
    await act(async () => check.resolve({ state: 'checked', names: ['bakery'], everywhere: false }))
    expect(await screen.findByText(/bakery uses this file and will stop rendering it\. Not every site could be checked/)).toBeTruthy()
    expect(screen.queryByText(/not checked/)).toBeNull()
    await waitFor(() => expect((limitButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(limitButton())
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true))
  })

  it('says usage was not checked when the check failed, and lets the person decide', async () => {
    const check = deferred<LimitAccessUsage>()
    open(check.promise)
    await screen.findByText('Limit who can use this file?')
    await act(async () => check.reject(new Error('Scan failed (500)')))
    expect(await screen.findByText(/Current usage was not checked\./)).toBeTruthy()
    await waitFor(() => expect((limitButton() as HTMLButtonElement).disabled).toBe(false))
  })

  it('is false when the person cancels, even while the check runs', async () => {
    const check = deferred<LimitAccessUsage>()
    const onAnswer = open(check.promise)
    await screen.findByText('Limit who can use this file?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })
})
