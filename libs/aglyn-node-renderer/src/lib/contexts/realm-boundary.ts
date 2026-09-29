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
import { createContext } from 'react'

/**
 * The node id of the realm element whose Suspense boundary a leaf is
 * rendering inside (AGL-3390). A namespaced element renders its boundary
 * once and then itself inside it; this is how the inner render knows it is
 * the inner one, without a prop that could reach the DOM.
 */
export const RealmBoundaryContext = createContext<string | undefined>(undefined)
RealmBoundaryContext.displayName = 'RealmBoundaryContext'
