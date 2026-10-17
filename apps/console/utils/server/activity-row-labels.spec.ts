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

import { withActivityLabels } from './activity-row-labels'

describe('withActivityLabels', () => {
  it('names a duplicate code the way the feeds do', () => {
    const [entry] = withActivityLabels([
      { action: 'component.duplicated', target: { type: 'component', id: 'c1', name: 'Hero' } },
    ])
    expect(entry.actionLabel).toBe('Duplicated a component')
    expect(entry.targetLabel).toBe('Hero')
    // The stored fields stay for the readers that filter on them.
    expect(entry.action).toBe('component.duplicated')
  })

  it('keeps a prose action as it was written', () => {
    const [entry] = withActivityLabels([{ action: 'Published the screen', target: { type: 'screen', name: 'Home' } }])
    expect(entry.actionLabel).toBe('Published the screen')
  })

  it('reads a code nobody named as words, never as the code', () => {
    const [entry] = withActivityLabels([{ action: 'billing.invoice.paid' }])
    expect(entry.actionLabel).not.toBe('billing.invoice.paid')
    expect(entry.actionLabel).toMatch(/invoice paid/)
    expect(entry.targetLabel).toBeNull()
  })
})
