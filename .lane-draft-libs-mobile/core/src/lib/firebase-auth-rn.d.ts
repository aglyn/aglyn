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

/**
 * The React Native build of `@firebase/auth` exports the AsyncStorage
 * persistence, but `firebase/auth`'s published types are the browser build's
 * and omit it. Metro resolves the `react-native` condition at runtime; this
 * declares the one function so TypeScript agrees.
 */
import 'firebase/auth'
import type { Persistence } from 'firebase/auth'

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    setItem(key: string, value: string): Promise<void>
    getItem(key: string): Promise<string | null>
    removeItem(key: string): Promise<void>
  }): Persistence
}
