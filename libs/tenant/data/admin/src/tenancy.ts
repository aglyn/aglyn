/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export { appCheck, firebaseApp } from '@aglyn/shared-util-fbclient'

export * from './lib/server/erase'
export * from './lib/server/firebase-admin'
export * from './lib/server/notifications'
export * from './lib/server/organizations'
export * from './lib/server/realm-plugins'
export * from './lib/server/release-flags'
export * from './lib/server/serve-media-cdn'
export * from './lib/server/serve-plugin-fetch'
export * from './lib/server/upsert-contact'
