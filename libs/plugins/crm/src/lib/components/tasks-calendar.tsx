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

import { mdiChevronLeft, mdiChevronRight } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Box, Button, ButtonBase, IconButton, Stack, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import type { CrmTaskRow } from '../hooks/use-crm-tasks'
import {
  bucketTasksByCalendarDay,
  CALENDAR_DAY_LABELS,
  CALENDAR_WEEK_DAYS,
  shiftCalendarMonth,
  taskCalendarMonth,
} from '../model/task-calendar'

/** How many tasks a square lists before folding the rest into a count. */
const TASKS_PER_DAY = 3

export interface TasksCalendarProps {
  /** The window the list is holding — the calendar reads no more than it. */
  tasks: readonly CrmTaskRow[]
  /** Open one task's drawer, the same drawer a row opens. */
  onOpen: (task: CrmTaskRow) => void
  /** The list's window filled, so neither surface is showing everything. */
  truncated?: boolean
}

/**
 * A MONTH OF TASKS, BY DUE DATE (AGL-2662).
 *
 * The Tasks list answers "what is on my plate"; this answers "what does
 * next week look like", which a list ordered by due date can only imply.
 *
 * ## Drawn over the list's own window, and never over a second read
 *
 * The rows are the ones the section already holds. A calendar that fetched
 * its own month would be a second listener over the same collection, would
 * disagree with the list whenever the two windows differed, and would put
 * a read behind every page of the arrows. What it costs instead is honesty:
 * the grid can only place what the window carries, so the tasks due in
 * other months are counted under it rather than implied to be absent.
 *
 * ## Hand-built rather than a calendar dependency
 *
 * Seven columns of MUI boxes and the local-day arithmetic in
 * `task-calendar.ts`. The one calendar package already installed
 * (`@mui/x-date-pickers`) draws a date PICKER — a grid whose squares are
 * choices, not content — so it answers a different question, and a
 * scheduling library for one surface is a dependency the whole console
 * would carry.
 */
export function TasksCalendar(props: TasksCalendarProps) {
  const { tasks, onOpen, truncated } = props
  /*
   * The clock is read ONCE, at mount. A component that read `Date.now()`
   * per render would move the today square under a reader who left the tab
   * open across midnight, without any state having changed — and the grid
   * is a pure function of this, so what is drawn can be pinned.
   */
  const [nowMs] = useState(() => Date.now())
  const [anchorMs, setAnchorMs] = useState(() => nowMs)

  const month = useMemo(
    () => taskCalendarMonth(anchorMs, nowMs),
    [anchorMs, nowMs],
  )
  const buckets = useMemo(
    () => bucketTasksByCalendarDay(tasks, (task) => task.dueAtMs, month),
    [tasks, month],
  )
  const label = useMemo(
    () =>
      month.monthDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [month],
  )

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <IconButton
          size="small"
          aria-label="Previous month"
          onClick={() => setAnchorMs((current) => shiftCalendarMonth(current, -1))}
        >
          <MdiIcon path={mdiChevronLeft.path} size={0.9} />
        </IconButton>
        <Typography variant="subtitle1" sx={{ minWidth: 160, textAlign: 'center' }}>
          {label}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next month"
          onClick={() => setAnchorMs((current) => shiftCalendarMonth(current, 1))}
        >
          <MdiIcon path={mdiChevronRight.path} size={0.9} />
        </IconButton>
        <Button size="small" onClick={() => setAnchorMs(nowMs)}>
          {'Today'}
        </Button>
      </Stack>

      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 640 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${CALENDAR_WEEK_DAYS}, 1fr)`,
              gap: 0.5,
              mb: 0.5,
            }}
          >
            {CALENDAR_DAY_LABELS.map((day) => (
              <Typography
                key={day}
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center' }}
              >
                {day}
              </Typography>
            ))}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${CALENDAR_WEEK_DAYS}, 1fr)`,
              gap: 0.5,
            }}
          >
            {month.weeks.flat().map((day) => {
              const held = buckets.byDay.get(day.startMs) ?? []
              const shown = held.slice(0, TASKS_PER_DAY)
              const folded = held.length - shown.length
              return (
                <Box
                  key={day.startMs}
                  sx={{
                    minHeight: 96,
                    p: 0.75,
                    borderRadius: 1,
                    border: 1,
                    borderColor: day.isToday ? 'primary.main' : 'divider',
                    bgcolor: day.inMonth ? 'background.paper' : 'action.hover',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      mb: 0.5,
                      fontWeight: day.isToday ? 'fontWeightBold' : undefined,
                      color: day.inMonth ? 'text.primary' : 'text.disabled',
                    }}
                  >
                    {day.date}
                  </Typography>
                  <Stack spacing={0.25}>
                    {shown.map((task) => (
                      <ButtonBase
                        key={task.$id}
                        onClick={() => onOpen(task)}
                        sx={{
                          justifyContent: 'flex-start',
                          width: '100%',
                          px: 0.5,
                          py: 0.25,
                          borderRadius: 0.5,
                          bgcolor: 'action.selected',
                          '&:hover': { bgcolor: 'action.focus' },
                        }}
                      >
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{
                            width: '100%',
                            textAlign: 'left',
                            textDecoration:
                              task.status === 'done' ? 'line-through' : undefined,
                            color:
                              task.status === 'done'
                                ? 'text.secondary'
                                : day.endMs <= nowMs
                                  ? 'error.main'
                                  : 'text.primary',
                          }}
                        >
                          {task.title}
                        </Typography>
                      </ButtonBase>
                    ))}
                    {folded > 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        {`+${folded} more`}
                      </Typography>
                    ) : null}
                  </Stack>
                </Box>
              )
            })}
          </Box>
        </Box>
      </Box>

      {/*
        What the grid could not place. Said plainly, because a month with
        nothing on it reads as "nothing is due" and the honest reading here
        is often "the window's tasks are somewhere else".
      */}
      {buckets.undated.length || buckets.elsewhere.length || truncated ? (
        <Typography variant="caption" color="text.secondary">
          {[
            buckets.elsewhere.length
              ? `${buckets.elsewhere.length} due outside this month`
              : '',
            buckets.undated.length
              ? `${buckets.undated.length} with no due date`
              : '',
            truncated ? 'and the view is showing only its first page' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      ) : null}
    </Stack>
  )
}
TasksCalendar.displayName = 'TasksCalendar'

export default TasksCalendar
