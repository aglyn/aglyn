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
import { act, fireEvent, render, screen } from '@testing-library/react'

import { useConfirmationContext } from '../contexts/confirmation.context'
import ConfirmationProviderComponent from './confirmation-provider.component'
import DialogConfirm from './dialog-confirm'

/**
 * Stands in for the dialog during its exit transition: the buttons stay
 * mounted and clickable whatever `open` says, as a fading dialog's do.
 */
function StickyDialog(props: {
  open: boolean
  onCancel: React.MouseEventHandler<unknown>
  onConfirm: React.MouseEventHandler<unknown>
}) {
  return (
    <div data-open={String(props.open)}>
      <button onClick={props.onCancel}>Cancel</button>
      <button onClick={props.onConfirm}>OK</button>
    </div>
  )
}

function Asker(props: { onSettle: (answer: string) => void }) {
  const { confirm } = useConfirmationContext()
  return (
    <button
      onClick={() =>
        confirm().then(
          () => props.onSettle('confirmed'),
          () => props.onSettle('cancelled'),
        )
      }
    >
      Ask
    </button>
  )
}

describe('ConfirmationProviderComponent', () => {
  it('should render successfully', () => {
    const { baseElement } = render(<ConfirmationProviderComponent />)
    expect(baseElement).toBeTruthy()
  })

  it.each(['OK', 'Cancel'])(
    'a second %s click while the dialog closes does not throw',
    async (label) => {
      const onSettle = jest.fn()
      render(
        <ConfirmationProviderComponent component={StickyDialog}>
          <Asker onSettle={onSettle} />
        </ConfirmationProviderComponent>,
      )
      fireEvent.click(screen.getByText('Ask'))
      const answer = screen.getByText(label)
      // The second click lands after the first has re-rendered the provider
      // with the pair cleared, as a real double click does.
      fireEvent.click(answer)
      expect(() => fireEvent.click(answer)).not.toThrow()
      await act(async () => undefined)
      expect(onSettle).toHaveBeenCalledTimes(1)
      expect(onSettle).toHaveBeenCalledWith(
        label === 'OK' ? 'confirmed' : 'cancelled',
      )
    },
  )
})

describe('DialogConfirm', () => {
  const options = { confirmationText: 'OK', cancellationText: 'Cancel' }

  it('disables its buttons once it is no longer open', () => {
    const { rerender } = render(<DialogConfirm open options={options} />)
    const ok = () => screen.getByText('OK').closest('button')
    const cancel = () => screen.getByText('Cancel').closest('button')
    expect(ok()?.disabled).toBe(false)
    expect(cancel()?.disabled).toBe(false)
    rerender(<DialogConfirm open={false} options={options} />)
    // Still on screen for the exit transition, but not clickable.
    expect(ok()?.disabled).toBe(true)
    expect(cancel()?.disabled).toBe(true)
  })
})
