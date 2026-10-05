/**
 * @jest-environment jsdom
 */
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
 * "RESUME IMPORT" (AGL-3549): beside a surface's Import, the imports the
 * person left unfinished on that resource, each reopened on its step or
 * discarded — and nothing at all outside the shell, for someone who may not
 * import, or with nothing to resume.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  TransferLauncherContext,
  type TransferLauncher,
  type TransferUnfinishedImport,
} from './transfer-launcher-context'
import { TransferResumeImport } from './transfer-resume-import'

const TARGET = { resource: 'email.suppressions', scope: 'host' as const, hostId: 'host-1' }
const JOB: TransferUnfinishedImport = {
  jobId: 'job-1',
  resource: 'email.suppressions',
  hostId: 'host-1',
  fileName: 'bounces.csv',
  status: 'planned',
  updatedAt: Date.parse('2026-10-01T10:00:00Z'),
  label: 'Suppressions',
}

function launcher(overrides: Partial<TransferLauncher> = {}): TransferLauncher & { openImport: jest.Mock; discard: jest.Mock } {
  return {
    openImport: jest.fn(),
    openExport: jest.fn(),
    close: jest.fn(),
    can: () => true,
    unfinished: () => [JOB],
    discard: jest.fn(async (): Promise<void> => undefined),
    ...overrides,
  } as never
}

const mount = (value: TransferLauncher | null, onFinished?: () => void) =>
  render(
    <TransferLauncherContext.Provider value={value}>
      <TransferResumeImport target={TARGET} title="Import suppressions" {...(onFinished ? { onFinished } : {})} />
    </TransferLauncherContext.Provider>,
  )

describe('TransferResumeImport (AGL-3549)', () => {
  it('reopens an unfinished import on its job, as the surface’s Import opens it', () => {
    const shell = launcher()
    const onFinished = jest.fn()
    mount(shell, onFinished)
    fireEvent.click(screen.getByRole('button', { name: 'Resume import' }))
    fireEvent.click(screen.getByText('bounces.csv'))
    expect(shell.openImport).toHaveBeenCalledWith({
      resource: 'email.suppressions',
      scope: 'host',
      hostId: 'host-1',
      jobId: 'job-1',
      title: 'Import suppressions',
      onFinished,
    })
  })

  it('discards one without reopening it', async () => {
    const shell = launcher()
    mount(shell)
    fireEvent.click(screen.getByRole('button', { name: 'Resume import' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })
    expect(shell.discard).toHaveBeenCalledWith('job-1')
    expect(shell.openImport).not.toHaveBeenCalled()
  })

  it('counts several', () => {
    mount(launcher({ unfinished: () => [JOB, { ...JOB, jobId: 'job-2', fileName: null }] }))
    expect(screen.getByRole('button', { name: 'Resume import (2)' })).toBeTruthy()
  })

  it('draws nothing outside the shell, for whom may not import, or with nothing to resume', () => {
    const { container, rerender } = mount(null)
    expect(container.textContent).toBe('')
    for (const value of [launcher({ can: () => false }), launcher({ unfinished: () => [] }), launcher({ unfinished: undefined })]) {
      rerender(
        <TransferLauncherContext.Provider value={value}>
          <TransferResumeImport target={TARGET} />
        </TransferLauncherContext.Provider>,
      )
      expect(container.textContent).toBe('')
    }
  })
})
