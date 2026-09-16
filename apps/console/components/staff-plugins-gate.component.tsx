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

import { Box, CircularProgress } from '@mui/material'
import { type ReactNode, useEffect, useState } from 'react'
import { consolePluginLoader } from '../constants/console-plugin-loader'
import {
  markStaffPluginsSettled,
  resetStaffPluginsSettledForTests,
  STAFF_PLUGIN_IDS,
  staffPluginsSettled,
} from '../constants/staff-plugins'

/**
 * Loads the staff area's plugins before a staff page renders (AGL-2939).
 *
 * The console plugins gate loads plugins for the workspace a URL names, and
 * a staff URL names none, so nothing else loads a plugin here. A staff zone
 * and the generic staff route read the registry synchronously as they
 * render; holding the pages until the registry holds the staff plugins is
 * what lets a staff card or a staff page render on the first paint, rather
 * than never.
 *
 * Mounted inside `StaffGuard`, so a plugin chunk is fetched only for a
 * reader the staff claim admitted. Settled, not succeeded: a chunk that
 * fails to load is logged and the staff pages render without its surfaces.
 */
export function StaffPluginsGate({ children }: { children?: ReactNode }) {
  const [settled, setSettled] = useState(staffPluginsSettled)
  useEffect(() => {
    if (staffPluginsSettled()) return undefined
    let active = true
    void consolePluginLoader
      .ensure(STAFF_PLUGIN_IDS, ['staff'])
      .catch((error) => console.error('staff plugins failed to load', error))
      .then(() => {
        markStaffPluginsSettled()
        if (active) setSettled(true)
      })
    return () => {
      active = false
    }
  }, [])
  if (!settled) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  return <>{children}</>
}
StaffPluginsGate.displayName = 'StaffPluginsGate'

/** Test seam: forget that the staff plugins settled. */
export function resetStaffPluginsGateForTests(): void {
  resetStaffPluginsSettledForTests()
}

export default StaffPluginsGate
