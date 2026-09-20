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
import { render } from '@testing-library/react'
import { CampaignTopicOptionsWidget } from './campaign-topic-options-widget'

/**
 * The topics a campaign can open on, as this plugin reports them to the
 * drawers that list them.
 *
 * Two things are this widget's to hold. A retired topic is never offered — a
 * campaign may not be aimed at a stream nobody can leave, while one already
 * SENT under it keeps resolving — and the catalog, the largest read on the
 * section that hosts the zone, is not read while the drawer is shut.
 */
let asked: boolean[] = []

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: (_hostId: string, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled ?? true
    asked.push(enabled)
    return {
      topics: enabled
        ? [
            { id: 'marketing', name: 'Promotions and offers' },
            { id: 'sales', name: 'Sales outreach' },
            { id: 'retired', name: 'Old stream', archived: true },
          ]
        : [],
    }
  },
}))

beforeEach(() => {
  asked = []
})

describe('CampaignTopicOptionsWidget', () => {
  it('reports only the topics a recipient can still leave', () => {
    const onTopics = jest.fn()
    render(
      <CampaignTopicOptionsWidget hostId="host-1" enabled onTopics={onTopics} />,
    )
    expect(onTopics).toHaveBeenLastCalledWith([
      { id: 'marketing', name: 'Promotions and offers' },
      { id: 'sales', name: 'Sales outreach' },
    ])
  })

  it('does not read the catalog until it is asked to', () => {
    const onTopics = jest.fn()
    const view = render(
      <CampaignTopicOptionsWidget
        hostId="host-1"
        enabled={false}
        onTopics={onTopics}
      />,
    )
    expect(asked.some(Boolean)).toBe(false)
    expect(onTopics).toHaveBeenLastCalledWith([])

    view.rerender(
      <CampaignTopicOptionsWidget hostId="host-1" enabled onTopics={onTopics} />,
    )
    expect(asked.some(Boolean)).toBe(true)
    expect(onTopics.mock.calls.at(-1)?.[0]).toHaveLength(2)
  })

  it('draws nothing', () => {
    const view = render(
      <CampaignTopicOptionsWidget
        hostId="host-1"
        enabled
        onTopics={() => undefined}
      />,
    )
    expect(view.container.innerHTML).toBe('')
  })
})
