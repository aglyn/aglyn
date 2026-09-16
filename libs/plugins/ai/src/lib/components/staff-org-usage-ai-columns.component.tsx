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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import { Typography } from '@mui/material'
import {
  aiCreditsCell,
  aiOverageCell,
  assistCostCell,
  assistPoolSentence,
  staffAssistPool,
  type StaffOrgUsageAiMonth,
} from '../usage/staff-org-usage-ai'

/**
 * THE STAFF ORG USAGE TABLE'S AI COLUMNS (AGL-2984): Assist spend, AI
 * credits used and AI overage billed, one cell per monthly rollup through
 * the `staffOrgUsageColumn` zone, and the credit pool line the org page
 * draws above the table. Each cell reads only the month row the table hands
 * it.
 */
export function StaffOrgUsageAssistCell(props: {
  month?: StaffOrgUsageAiMonth
}) {
  return <>{props.month ? assistCostCell(props.month.assistCostUsd) : '—'}</>
}
StaffOrgUsageAssistCell.displayName = 'StaffOrgUsageAssistCell'

/** The credits the month drew, or a dash for a rollup older than the meter. */
export function StaffOrgUsageAiCreditsCell(props: {
  month?: StaffOrgUsageAiMonth
}) {
  return <>{aiCreditsCell(props.month?.assistCredits)}</>
}
StaffOrgUsageAiCreditsCell.displayName = 'StaffOrgUsageAiCreditsCell'

/** The overage the month billed, or a dash for a rollup older than the meter. */
export function StaffOrgUsageAiOverageCell(props: {
  month?: StaffOrgUsageAiMonth
}) {
  return <>{aiOverageCell(props.month?.assistOverageUsd)}</>
}
StaffOrgUsageAiOverageCell.displayName = 'StaffOrgUsageAiOverageCell'

/**
 * The org's AI credit pool as one line above the table, so whoever reads the
 * Assist column knows what band its dollars are drawn against. Drawn only
 * where the surface holds the org document: without one, a line claiming
 * "add-on off" would be a claim nobody checked.
 */
export function StaffOrgUsageAiPool(props: {
  org?: Partial<AglynOrgBilling> | null
}) {
  if (!props.org) return null
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      sx={{ mb: 1 }}
    >
      {assistPoolSentence(staffAssistPool(props.org))}
    </Typography>
  )
}
StaffOrgUsageAiPool.displayName = 'StaffOrgUsageAiPool'
