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

import { LinearProgress, Link, Stack, Typography } from '@mui/material'
import { HelpTip, type HelpTipContent } from './help-tip.component'

export interface UsageMeterProps {
  label: string
  /** `null` while the usage source has not answered — "not yet metered". */
  used: number | null
  limit: number
  unit?: string
  /** True when the plan caps nothing here; the bar is omitted and the limit reads "Unlimited". */
  unlimited?: boolean
  /**
   * Optional help affordance beside the label.
   *
   * A meter is a number against a limit and says nothing about what happens
   * when the two meet — which for bandwidth is the whole question, and is
   * different on Free (the site pauses) than on a paid plan (the extra bills).
   */
  help?: HelpTipContent
  /** Where "Upgrade" points once the meter warns; the plans anchor by default. */
  upgradeHref?: string
}

function formatLimit(limit: number, unit: string | undefined, unlimited: boolean): string {
  if (unlimited) return 'Unlimited'
  return unit ? `${limit} ${unit}` : String(limit)
}

/**
 * One quota meter: used/limit progress with warning at ≥80%, error at the
 * cap, an "Upgrade" link once warning, "Unlimited" for uncapped plans, and
 * a "not yet metered" state for usage sources that have not answered.
 *
 * Shared (AGL-2939) so a plugin's own meter — the AI credits band — draws
 * beside the platform's on the same terms rather than as a lookalike.
 */
export function UsageMeter(props: UsageMeterProps) {
  const { label, used, limit, unit, help, upgradeHref = '#plans' } = props
  const unlimited = props.unlimited === true
  const unmetered = used == null
  const pct =
    unlimited || unmetered || limit <= 0 ? 0 : Math.min(100, (used / limit) * 100)
  const warning = !unlimited && !unmetered && pct >= 80
  return (
    <Stack spacing={0.5} sx={{ mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        {/*
          The tip renders INSIDE the label, not beside it in a wrapper: the
          console's meter specs find a meter by `getByText(label).parentElement`
          and read the row's text from it, and a wrapper would make that
          parent the wrapper, whose text is the label alone.
        */}
        <Typography variant="body2">
          {label}
          {help ? <HelpTip {...help} sx={{ ml: 0.5, fontSize: '0.8em' }} /> : null}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {unmetered
            ? `not yet metered · limit ${formatLimit(limit, unit, unlimited)}`
            : `${used} / ${formatLimit(limit, unit, unlimited)}`}
          {warning ? (
            <>
              {' · '}
              <Link href={upgradeHref} color="primary" underline="hover">
                {'Upgrade'}
              </Link>
            </>
          ) : null}
        </Typography>
      </Stack>
      {unlimited || unmetered ? null : (
        <LinearProgress
          variant="determinate"
          value={pct}
          color={pct >= 100 ? 'error' : warning ? 'warning' : 'primary'}
        />
      )}
    </Stack>
  )
}

export default UsageMeter
