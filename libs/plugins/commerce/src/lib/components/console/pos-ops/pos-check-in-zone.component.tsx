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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { memo } from 'react'
import { POS_CHECK_IN_ZONE, type ConsolePosCheckInZoneProps } from '../pos-zones'

/**
 * The register's check-in zone (AGL-4043), for one customer on one day:
 * whatever another plugin shows there — a status, a button that starts its
 * own flow — through the console shell's renderer and its gates. Outside the
 * shell it draws nothing. Memoized: the check-in list redraws on every tap,
 * and the shell's renderer is not.
 */
export const PosCheckInZone = memo(function PosCheckInZone(props: ConsolePosCheckInZoneProps) {
  const Renderer = useConsoleWidgetSlot()
  if (!Renderer) return null
  return <Renderer slot={POS_CHECK_IN_ZONE.id} {...props} />
})

PosCheckInZone.displayName = 'PosCheckInZone'
