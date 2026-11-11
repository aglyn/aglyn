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
'use client'

import type { ConfirmationContextConfig } from '@aglyn/shared-ui-jsx'
import { useEffect, useState } from 'react'
import { type LimitAccessUsage, limitAccessDescription } from './media-sharing'

export interface LimitAccessConfirmDescriptionProps {
  /** The usage check, ALREADY RUNNING; it never rejects (a failure is `failed`). */
  usage: Promise<LimitAccessUsage>
  count: number
  allExcept: boolean
}

/**
 * The body of a "Limit who can use…" confirmation, filled in when the usage
 * check answers (AGL-4047).
 *
 * Before, the library awaited the scan and only then opened the dialog, and
 * any answer short of a full read of every site was said as "Current usage
 * was not checked": a workspace with more sites than one scan reads always
 * heard that, though the scan had answered and named what it found. Now the
 * dialog opens at once and says it is checking, and says what the check found
 * once it answers. Same inline-only rule as the delete confirmation: this
 * renders inside a `<p>`.
 */
export function LimitAccessConfirmDescription(props: LimitAccessConfirmDescriptionProps) {
  const { usage, count, allExcept } = props
  const [answer, setAnswer] = useState<LimitAccessUsage>({ state: 'checking' })
  useEffect(() => {
    let live = true
    setAnswer({ state: 'checking' })
    usage.then(
      (result) => {
        if (live) setAnswer(result)
      },
      () => {
        if (live) setAnswer({ state: 'failed' })
      },
    )
    return () => {
      live = false
    }
  }, [usage])
  return (
    <span aria-live="polite">{limitAccessDescription({ usage: answer, count, allExcept })}</span>
  )
}
LimitAccessConfirmDescription.displayName = 'LimitAccessConfirmDescription'

export interface LimitAccessConfirmRequest {
  title: string
  count: number
  allExcept: boolean
  /** The usage check, started by the caller in the same tick. */
  usage: Promise<LimitAccessUsage>
  /** The confirmation provider's `confirm`. */
  confirm: (options: ConfirmationContextConfig) => Promise<unknown>
}

/**
 * Ask before narrowing who can use files, with the usage check running behind
 * the dialog. "Limit access" is held until the check answers, either way, so
 * the sites a narrowing breaks are named before anyone can confirm it, as they
 * were when the dialog waited for the scan; Cancel is never held.
 *
 * @returns whether the person confirmed. A dismissed dialog is `false`.
 */
export function confirmLimitAccess(request: LimitAccessConfirmRequest): Promise<boolean> {
  const { title, count, allExcept, usage, confirm } = request
  // Settles either way, so the hold always lifts.
  const answered = usage.then(
    (result) => result,
    (): LimitAccessUsage => ({ state: 'failed' }),
  )
  return confirm({
    title,
    description: <LimitAccessConfirmDescription usage={answered} count={count} allExcept={allExcept} />,
    confirmationText: 'Limit access',
    confirmationHeldUntil: answered,
  }).then(
    () => true,
    () => false,
  )
}

export default LimitAccessConfirmDescription
