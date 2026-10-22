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

import { mdiArrowDown, mdiArrowUp, mdiViewDashboardOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useDashboardWidgetPrefs } from './dashboard-widget-prefs.context'
import { useSlotWidgets } from './plugin-widget-slot.component'
import {
  CORE_DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_SLOTS,
  isDashboardWidgetHidden,
  orderDashboardWidgets,
} from '../utils/dashboard-widgets'

/** One row of the dialog: a card, and the group its arrows move it within. */
interface CustomizeRow {
  widgetId: string
  title: string
  /**
   * Sibling ids in render order, or `undefined` for a card the page places
   * itself. `Traffic` spans the container above the capability grid, so there
   * is nothing for it to trade places with.
   */
  groupIds?: readonly string[]
}

/**
 * Which cards this person keeps on the host dashboard, and in what order.
 *
 * The list is the SLOT's answer, not a catalog of its own: `useSlotWidgets`
 * is the same resolution the dashboard renders through, so a card the org is
 * not entitled to is absent from both. A dialog that listed more than the
 * page can draw would offer switches that do nothing.
 *
 * Nothing here refuses. Every card can be switched off, including all of
 * them — an empty dashboard is a choice a person is allowed to make, and one
 * switch undoes it.
 */
export function DashboardCustomizeButton() {
  const [open, setOpen] = useState(false)
  const { widgets, ready: widgetsReady } = useSlotWidgets(
    DASHBOARD_WIDGET_SLOTS,
  )
  const { prefs, ready: prefsReady, setHidden, move } = useDashboardWidgetPrefs()

  const rows: CustomizeRow[] = [
    ...CORE_DASHBOARD_WIDGETS.map((widget) => ({
      widgetId: widget.widgetId,
      title: widget.title,
    })),
    ...DASHBOARD_WIDGET_SLOTS.flatMap((slot) => {
      // Hidden cards keep their place in the group so the arrangement reads
      // the same here as on the page, and turning one back on returns it
      // where it was rather than to the end.
      const arranged = orderDashboardWidgets(
        widgets.filter((widget) => widget.slot === slot),
        prefs.order,
      )
      const groupIds = arranged.map((widget) => widget.widgetId)
      return arranged.map((widget) => ({
        widgetId: widget.widgetId,
        title: widget.title,
        groupIds,
      }))
    }),
  ]

  return (
    <>
      <Tooltip title="Customize dashboard">
        <IconButton
          onClick={() => setOpen(true)}
          aria-label="customize dashboard"
        >
          <MdiIcon path={mdiViewDashboardOutline.path} />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Customize dashboard'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {
              'Switch off the cards you do not need. Nothing is deleted — turn one back on any time.'
            }
          </Typography>
          {!widgetsReady || !prefsReady ? (
            <Stack sx={{ alignItems: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Stack spacing={1}>
              {rows.map((row) => {
                const hidden = isDashboardWidgetHidden(prefs, row.widgetId)
                const position = row.groupIds?.indexOf(row.widgetId) ?? -1
                const last = (row.groupIds?.length ?? 0) - 1
                return (
                  <Stack
                    key={row.widgetId}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center' }}
                  >
                    <Switch
                      checked={!hidden}
                      onChange={(event) =>
                        setHidden(row.widgetId, !event.target.checked)
                      }
                      slotProps={{
                        input: { 'aria-label': `show ${row.title}` },
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{ flexGrow: 1 }}
                      color={hidden ? 'text.secondary' : 'text.primary'}
                    >
                      {row.title}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={`move ${row.title} up`}
                      disabled={position <= 0}
                      onClick={() => move(row.groupIds ?? [], row.widgetId, -1)}
                    >
                      <MdiIcon path={mdiArrowUp.path} size={0.8} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`move ${row.title} down`}
                      disabled={position < 0 || position >= last}
                      onClick={() => move(row.groupIds ?? [], row.widgetId, 1)}
                    >
                      <MdiIcon path={mdiArrowDown.path} size={0.8} />
                    </IconButton>
                  </Stack>
                )
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
DashboardCustomizeButton.displayName = 'DashboardCustomizeButton'

export default DashboardCustomizeButton
