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

import type { HeldPageTarget } from '@aglyn/shared-util-email/held-page'
import { Chip, Tooltip } from '@mui/material'
import { holdsForTarget, type PageHold } from './page-hold-copy'

/**
 * The status chip beside a held or flagged page, template, layout or
 * component in a list (AGL-3374): "Held for review", "Flagged — live, under
 * review" or "Not approved", with the page and what visitors see on hover.
 * A status, never a control: the editor's banner carries the actions, and
 * none of them releases anything.
 */
export default function PageHoldChips(props: {
  holds: readonly PageHold[] | null | undefined
  target: HeldPageTarget
}) {
  const mine = holdsForTarget(props.holds, props.target)
  if (!mine.length) return null
  // One chip per status, however many pages share it.
  const byLabel = new Map<string, PageHold[]>()
  for (const hold of mine) {
    const list = byLabel.get(hold.chip.label) ?? []
    list.push(hold)
    byLabel.set(hold.chip.label, list)
  }
  return (
    <>
      {[...byLabel.values()].map((holds) => (
        <Tooltip
          key={holds[0].chip.label}
          title={holds.map((hold) => `${hold.label}: ${hold.visitorSentence}`).join(' ')}
        >
          <Chip
            size="small"
            variant="outlined"
            color={holds[0].chip.color}
            label={holds[0].chip.label}
            data-page-hold={holds[0].kind}
          />
        </Tooltip>
      ))}
    </>
  )
}
