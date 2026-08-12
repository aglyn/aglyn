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

import { mdiWifiOff } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, Chip, Tooltip } from '@mui/material'
import useOnlineStatus from '../hooks/use-online-status'

/**
 * The connection indicator in the app bar (AGL-1056).
 *
 * The offline shell already covers the case where a NAVIGATION fails — the
 * branded `/offline` page. It cannot cover the one that actually costs work:
 * staying on the page you are editing while every write quietly fails. This is
 * the "say so before the user loses work" half of the issue.
 *
 * Renders nothing at all while online. A permanent green "Connected" pill
 * would be chrome that is right 99.9% of the time and therefore invisible the
 * once it changes; absence-then-presence is the thing people notice.
 *
 * The live region, however, is permanent. An `aria-live` container has to be
 * in the accessibility tree BEFORE its contents change for the change to be
 * announced — a region that appears already populated is, in most screen
 * readers, simply not read out. So the wrapper always mounts (an empty flex
 * box with no children occupies nothing) and only the pill inside it comes and
 * goes.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus()

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', alignItems: 'center' }}
    >
      {online ? null : (
        <Tooltip title="Your device has lost its network connection. Changes you make now cannot be saved until it comes back.">
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            icon={<MdiIcon path={mdiWifiOff.path} />}
            label={'Offline'}
            sx={{
              // Matches the icon cluster it sits in: never the thing that
              // gives when the bar runs out of room (AGL-1414).
              flexShrink: 0,
              mr: 0.5,
              fontWeight: 'fontWeightMedium',
              // Explicit rem: a bare number would be read through MUI's
              // spacing/percentage scale rather than as pixels.
              '& .MuiChip-icon': { fontSize: '1rem' },
            }}
          />
        </Tooltip>
      )}
    </Box>
  )
}
OfflineIndicator.displayName = 'OfflineIndicator'

export default OfflineIndicator
