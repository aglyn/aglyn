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

/*
 * Spec support for the workspace screens: a fake screen context and the
 * platform dialog's buttons. Imported by specs only; nothing in the lib's
 * entry reaches it.
 */

import type { MobileApiClient, MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Alert } from 'react-native'

export type FakeContext = MobilePluginContext & {
  navigate: jest.Mock
  openConsolePath: jest.Mock
  api: MobileApiClient & { request: jest.Mock }
}

export function fakeContext(overrides: Partial<MobilePluginContext> = {}): FakeContext {
  return {
    uid: 'owner-uid',
    orgId: 'org-1',
    hostId: 'site-1',
    orgSlug: 'acme',
    hostSlug: 'shop',
    firestore: { fake: true },
    api: { request: jest.fn(async () => ({})) },
    navigate: jest.fn(),
    openConsolePath: jest.fn(),
    ...overrides,
  } as FakeContext
}

type AlertButton = { text?: string; onPress?: () => void; style?: string }

/** Every `Alert.alert` the code under test shows, and a way to press one of its buttons. */
export function captureAlerts() {
  const shown: Array<{ title: string; message?: string; buttons: AlertButton[] }> = []
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    shown.push({ title, message, buttons: (buttons as AlertButton[]) ?? [] })
  })
  return {
    shown,
    spy,
    last: () => shown[shown.length - 1],
    /** Presses the named button of the most recent dialog. */
    press(text: string) {
      const dialog = shown[shown.length - 1]
      const button = dialog?.buttons.find((candidate) => candidate.text === text)
      if (!button) throw new Error(`no "${text}" button on "${dialog?.title}"`)
      button.onPress?.()
    },
  }
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
