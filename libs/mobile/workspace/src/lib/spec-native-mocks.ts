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
 * The native modules a rendered workspace screen reaches, stubbed for jest.
 * A spec imports this FIRST, before anything that imports React Native UI.
 *
 * The horizontal ScrollView's codegen components, and the Modal (which
 * reaches several more), are stubbed because, under the app's jest Babel
 * (CommonJS transform as a plugin, ahead of the preset's codegen), their
 * generated `export` is left as ESM and cannot load; a horizontal `ChipRow`
 * is a ScrollView and a `Sheet` is a Modal, which here renders its children
 * while it is visible.
 */

/** The window size `useLayout` reads; a spec sets it to draw a phone or a tablet. */
export const mockWindow = { size: { width: 390, height: 844, scale: 3, fontScale: 1 } }

export const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 }
export const TABLET = { width: 1180, height: 820, scale: 2, fontScale: 1 }

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@expo/vector-icons/Ionicons', () => ({ __esModule: true, default: () => null }))
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.size,
}))
jest.mock('react-native/src/private/components/scrollview/HScrollViewNativeComponents', () => ({
  HScrollViewNativeComponent: 'RCTScrollView',
  HScrollContentViewNativeComponent: 'RCTScrollContentView',
}))
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { createElement } = jest.requireActual('react')
  const { View } = jest.requireActual('react-native')
  const Modal = ({ visible, children }: { visible?: boolean; children?: unknown }) =>
    visible ? createElement(View, { testID: 'modal' }, children) : null
  return { __esModule: true, default: Modal }
})
