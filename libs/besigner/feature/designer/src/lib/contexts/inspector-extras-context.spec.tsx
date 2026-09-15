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

import { render, screen } from '@testing-library/react'
import {
  BesignerInspectorExtrasContext,
  inspectorExtrasFor,
  useBesignerInspectorExtras,
  type BesignerInspected,
} from './inspector-extras-context'

function Section() {
  const extras = inspectorExtrasFor(useBesignerInspectorExtras(), {
    node: { $id: 'node-1' } as unknown as BesignerInspected['node'],
  })
  return extras ? <div data-testid="extras">{extras}</div> : <div>{'no extras'}</div>
}

describe('BesignerInspectorExtrasContext (AGL-2940)', () => {
  it('carries nothing until a host supplies a section', () => {
    render(<Section />)
    expect(screen.getByText('no extras')).toBeTruthy()
  })

  it('renders whatever the host supplies, and nothing about how it was made', () => {
    render(
      <BesignerInspectorExtrasContext.Provider value={<span>{'plugin section'}</span>}>
        <Section />
      </BesignerInspectorExtrasContext.Provider>,
    )
    expect(screen.getByTestId('extras').textContent).toBe('plugin section')
  })
})
