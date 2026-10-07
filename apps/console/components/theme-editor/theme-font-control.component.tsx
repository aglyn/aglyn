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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import type { HostTheme } from '@aglyn/shared-data-types'
import { Skeleton, Stack } from '@mui/material'
import { Suspense, type ReactNode } from 'react'
import { useHostId } from '../host-id-provider'
import { useSlotWidgets } from '../plugin-widget-slot.component'

export interface ThemeFontControlProps {
  draft: HostTheme
  updateDraft: (updater: (draft: HostTheme) => HostTheme) => void
  /** The editor's own short list, for a workspace with no font control. */
  fallback: ReactNode
}

/**
 * The Typography card's font control (AGL-3656): the widgets that fill the
 * `themeEditorFonts` zone, handed the editor's draft and its setter, or the
 * editor's own curated list where nothing fills it.
 *
 * Held as a placeholder while the zone's plugins load, so the curated list is
 * not drawn and then replaced under the reader's cursor.
 */
export function ThemeFontControl(props: ThemeFontControlProps) {
  const { draft, updateDraft, fallback } = props
  const hostId = useHostId() ?? null
  const { widgets, ready } = useSlotWidgets([CONSOLE_WIDGET_SLOTS.themeEditorFonts])
  const controls = widgets.filter((widget) => widget.column === undefined)
  if (controls.length) {
    return (
      <Stack spacing={2} data-widget-zone={CONSOLE_WIDGET_SLOTS.themeEditorFonts}>
        {/* A widget may be lazy; its own boundary keeps the rest of the
            card, and the editor around it, drawn while it loads. */}
        {controls.map((widget) => (
          <Suspense
            key={widget.widgetId}
            fallback={<Skeleton variant="rounded" height={40} aria-label="Loading fonts" />}
          >
            <widget.Component
              hostId={hostId}
              draft={draft}
              updateDraft={updateDraft}
              {...widget.entitlementProps}
            />
          </Suspense>
        ))}
      </Stack>
    )
  }
  if (!ready) return <Skeleton variant="rounded" height={40} aria-label="Loading fonts" />
  return <>{fallback}</>
}
ThemeFontControl.displayName = 'ThemeFontControl'

export default ThemeFontControl
