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

import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx'
import { LoadingLayoutAppComponent } from '@aglyn/shared-ui-jsx/components/loading-layout-app.component'
import { SnackbarProvider } from '@aglyn/shared-ui-snackstack'
import {
  consoleThemeDark,
  consoleThemeLight,
  withThemeCssVarProvider,
} from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'
import ConsoleBrandingEffects from '../components/console-branding-effects.component'
import HostIdProvider from '../components/host-id-provider'
import FirebaseAppLayout from '../components/layouts/firebase-app.layout'
import OsfaTooltip from '../components/osfa-tooltip'
// Dynamic plugin activation (AGL-417): the gate loads + registers the org's
// enabled plugins (ConsoleExtension registry) before the shell renders —
// replacing the static register-console-plugins composition root.
import ConsolePluginsGate from '../components/console-plugins-gate.component'

/**
 * The console's global client providers (App Router), ported from the Pages
 * Router `_app` `MainComponent`: MUI theme via `withThemeCssVarProvider`
 * (emotion SSR is handled by the root layout's `AppRouterCacheProvider`),
 * then firebase init, loading gate, confirmation dialogs, snackbars, and the
 * host-id context. Wraps every app route under the root layout.
 */
const ThemeStack = withThemeCssVarProvider(
  ({ children }: { children?: ReactNode }) => (
    <FirebaseAppLayout>
      {/* White-label chrome effects (White-Label Phase 2): favicon + MUI
          primary color for a white-label-entitled org. Inside FirebaseAppLayout
          so the org scope + Firestore contexts it reads are available. */}
      <ConsoleBrandingEffects />
      <LoadingLayoutAppComponent>
        <ConfirmationProviderComponent>
          <SnackbarProvider>
            <HostIdProvider>
              <ConsolePluginsGate>{children}</ConsolePluginsGate>
            </HostIdProvider>
          </SnackbarProvider>
          <OsfaTooltip />
        </ConfirmationProviderComponent>
      </LoadingLayoutAppComponent>
    </FirebaseAppLayout>
  ),
  { theme: { light: consoleThemeLight, dark: consoleThemeDark } },
)

export default function Providers({ children }: { children?: ReactNode }) {
  return <ThemeStack>{children}</ThemeStack>
}
