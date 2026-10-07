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
import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { MobileThemeProvider } from '@aglyn/mobile-ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

/*
 * Renders a Commerce screen the way the app shell does, with a fresh query
 * cache and the plugin context a screen is handed, for component specs.
 */

export function pluginContext(api: MobilePluginContext['api'], overrides: Partial<MobilePluginContext> = {}): MobilePluginContext & {
  navigate: jest.Mock
  openConsolePath: jest.Mock
} {
  return {
    uid: 'uid-1',
    orgId: 'o1',
    hostId: 'h1',
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: {},
    api,
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    ...overrides,
  } as never
}

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }

export async function renderScreen(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  return {
    client,
    ...(await render(
      <QueryClientProvider client={client}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <MobileThemeProvider>{element}</MobileThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>,
    )),
  }
}
