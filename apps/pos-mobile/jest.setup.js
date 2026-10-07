/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// The native modules a screen spec would otherwise reach (AGL-3618), each
// replaced by its package's own jest double.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
