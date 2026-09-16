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
 * The run history hosts the `automationRun` zone on each FAILED run (AGL-2919):
 * what another plugin adds there reads the run as it was recorded, so the
 * zone is handed the automation — which the row does not record as an action
 * or a workflow, and the card that opened the history does — and the run's id.
 */

import { ConsoleWidgetSlotContext } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { HostRunHistoryCard } from './host-run-history-card.component'

const entries = [
  {
    $id: 'run-failed',
    createdAt: { seconds: 900 },
    trigger: 'formSubmission',
    target: { id: 'act-1', type: 'workflow' },
    action: 'Action ran on formSubmission with errors: unknown list "[newsletter]"',
    result: 'failed',
    summary: 'Ran',
  },
  {
    $id: 'run-ok',
    createdAt: { seconds: 800 },
    trigger: 'formSubmission',
    target: { id: 'act-1', type: 'workflow' },
    action: 'Action ran on formSubmission',
    result: 'succeeded',
    summary: 'sent email',
  },
]

const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useFirestoreCollection: () => ({ data: entries, status: 'success', fromCache: false }),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
}))
jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let drawn: Array<{ slot: string; props: Record<string, unknown> }> = []

function ShellSlot({ slot, ...props }: { slot: string } & Record<string, unknown>) {
  drawn.push({ slot, props })
  return <span data-testid={`zone-${slot}-${String(props['runId'])}`} />
}

beforeEach(() => {
  drawn = []
})

describe('the automationRun zone (AGL-2919)', () => {
  it('draws on a failed run with the automation and the run, and on no other run', () => {
    render(
      <ConsoleWidgetSlotContext.Provider value={ShellSlot}>
        <HostRunHistoryCard
          hostId="host-1"
          orgId="org-1"
          targetId="act-1"
          targetType="action"
          targetName="Welcome newsletter sign-ups"
        />
      </ConsoleWidgetSlotContext.Provider>,
    )
    expect(screen.getByTestId('zone-automationRun-run-failed')).toBeTruthy()
    expect(screen.queryByTestId('zone-automationRun-run-ok')).toBeNull()
    expect(drawn.at(-1)).toEqual({
      slot: 'automationRun',
      props: {
        hostId: 'host-1',
        orgId: 'org-1',
        target: { type: 'action', id: 'act-1', name: 'Welcome newsletter sign-ups' },
        runId: 'run-failed',
      },
    })
  })

  it('draws nothing where the card was not told what the runs belong to', () => {
    render(
      <ConsoleWidgetSlotContext.Provider value={ShellSlot}>
        <HostRunHistoryCard hostId="host-1" orgId="org-1" targetId="act-1" />
      </ConsoleWidgetSlotContext.Provider>,
    )
    expect(drawn).toEqual([])
    // The run itself is still listed.
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('draws nothing outside the console shell', () => {
    render(<HostRunHistoryCard hostId="host-1" targetId="act-1" targetType="action" />)
    expect(screen.queryByTestId('zone-automationRun-run-failed')).toBeNull()
    expect(screen.getByText('Failed')).toBeTruthy()
  })
})
