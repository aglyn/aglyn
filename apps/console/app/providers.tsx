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

import {
  ConfirmationProviderComponent,
  LoadingLayoutComponent,
} from '@aglyn/shared-ui-jsx'
import { SnackbarProvider } from '@aglyn/shared-ui-snackstack'
import {
  consoleThemeDark,
  consoleThemeLight,
  withThemeCssVarProvider,
} from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'
import HostIdProvider from '../components/host-id-provider'
import FirebaseAppLayout from '../components/layouts/firebase-app.layout'
import OsfaTooltip from '../components/osfa-tooltip'
// Populate the ConsoleExtension registry (nav items + plugin pages) before
// any nav renders, so plugins extend the console shell (AGL-394).
import '../constants/register-console-plugins'

/**
 * The console's global client providers (App Router), ported from the Pages
 * Router `_app` `MainComponent`: MUI theme via `withThemeCssVarProvider`
 * (emotion SSR is handled by the root layout's `AppRouterCacheProvider`),
 * then firebase init, loading gate, confirmation dialogs, snackbars, and the
 * host-id context. Wraps every app route under the root layout.
 */
const Providers = withThemeCssVarProvider(
  ({ children }: { children?: ReactNode }) => (
    <FirebaseAppLayout>
      <LoadingLayoutComponent>
        <ConfirmationProviderComponent>
          <SnackbarProvider>
            <HostIdProvider>{children}</HostIdProvider>
          </SnackbarProvider>
          <OsfaTooltip />
        </ConfirmationProviderComponent>
      </LoadingLayoutComponent>
    </FirebaseAppLayout>
  ),
  { theme: { light: consoleThemeLight, dark: consoleThemeDark } },
)

export default Providers
