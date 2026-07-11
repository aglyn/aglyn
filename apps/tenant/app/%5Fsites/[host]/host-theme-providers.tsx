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

import type { HostTheme } from '@aglyn/shared-data-types'
import {
  consoleThemeDark,
  consoleThemeLight,
  HostThemeProvider,
} from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'

/**
 * Client theme boundary for tenant sites (App Router). Replaces the Pages
 * Router `_app` `MainComponent`: the resolved host theme is fetched in the
 * `[host]` server layout and handed down as a serializable prop, then
 * `HostThemeProvider` renders children under the host's MUI theme (falling
 * back to the console light/dark themes when the host has no customization).
 */
export function HostThemeProviders({
  hostTheme,
  children,
}: {
  hostTheme?: HostTheme
  children: ReactNode
}) {
  return (
    <HostThemeProvider
      theme={hostTheme}
      fallback={[consoleThemeLight, consoleThemeDark]}
    >
      {children}
    </HostThemeProvider>
  )
}
