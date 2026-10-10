/**
 * @jest-environment node
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

import {
  AiJobCanceledError,
  aiJobCancelPending,
  aiJobCanceledBy,
  isAiJobCanceledError,
  throwIfAiJobCanceled,
  watchAiJobCancel,
} from './ai-job-cancel'
import type { AiJob } from '../model/ai-jobs.types'

type Watched = Pick<AiJob, 'status' | 'cancelRequested'>
const asked = { at: new Date() as never, by: 'uid-2' }

describe('canceling mid-step (AGL-3616)', () => {
  it('a cancel is pending only on a job that has not ended', () => {
    expect(aiJobCancelPending({ status: 'running', cancelRequested: asked })).toBe(true)
    expect(aiJobCancelPending({ status: 'queued', cancelRequested: asked })).toBe(true)
    expect(aiJobCancelPending({ status: 'canceled', cancelRequested: asked })).toBe(false)
    expect(aiJobCancelPending({ status: 'done', cancelRequested: asked })).toBe(false)
    expect(aiJobCancelPending({ status: 'running', cancelRequested: null })).toBe(false)
  })

  it('the cancel reads as an abort to every path that already handles one, and is told apart from a budget', () => {
    const error = new AiJobCanceledError()
    expect(error.name).toBe('AbortError')
    expect(isAiJobCanceledError(error)).toBe(true)
    expect(isAiJobCanceledError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false)
  })

  it('stops a write once the step was canceled, and only then', () => {
    expect(() => throwIfAiJobCanceled(undefined)).not.toThrow()
    expect(() => throwIfAiJobCanceled(new AbortController().signal)).not.toThrow()
    const budget = new AbortController()
    budget.abort(Object.assign(new Error('budget'), { name: 'TimeoutError' }))
    expect(() => throwIfAiJobCanceled(budget.signal)).not.toThrow()
    expect(aiJobCanceledBy(budget.signal)).toBe(false)
    const canceled = new AbortController()
    canceled.abort(new AiJobCanceledError())
    expect(() => throwIfAiJobCanceled(canceled.signal)).toThrow(AiJobCanceledError)
    expect(aiJobCanceledBy(canceled.signal)).toBe(true)
  })

  it('the watch aborts the step once the job is asked to cancel, and stops looking after', async () => {
    let stored: Watched = { status: 'running', cancelRequested: null }
    const read = jest.fn(async () => stored)
    const controller = new AbortController()
    const stop = watchAiJobCancel(read, controller, 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.signal.aborted).toBe(false)
    stored = { status: 'running', cancelRequested: asked }
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.signal.aborted).toBe(true)
    expect(isAiJobCanceledError(controller.signal.reason)).toBe(true)
    const reads = read.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(read.mock.calls.length).toBe(reads)
    stop()
  })

  it('a read that fails is skipped, and a stopped watch never aborts', async () => {
    const read = jest
      .fn<Promise<Watched | null>, []>()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({ status: 'canceled', cancelRequested: asked })
    const controller = new AbortController()
    const stop = watchAiJobCancel(read, controller, 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.signal.aborted).toBe(true)
    stop()

    const quiet = new AbortController()
    const stopQuiet = watchAiJobCancel(async () => ({ status: 'canceled', cancelRequested: asked }), quiet, 5)
    stopQuiet()
    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(quiet.signal.aborted).toBe(false)
  })
})
