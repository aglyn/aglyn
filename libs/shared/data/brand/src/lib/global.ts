/**
 * @license
 * Copyright 2021 Aglyn LLC
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


export const PKG_VERSION = String(process.env.PKG_VERSION || 'NULL')
export const BUILD_ID = String(process.env.BUILD_ID || 'NULL')
export const COMMIT_REF = String(process.env.COMMIT_REF || 'NULL')

export const IS_PRODUCTION = process.env.NODE_ENV === 'production'
export const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'
export const IS_TEST = process.env.NODE_ENV === 'test'

export const HAS_WINDOW = typeof window !== undefined
export const HAS_DOCUMENT = typeof document !== undefined
export const IS_BROWSER = Boolean(process['browser'])

export const CURRENT_YEAR = new Date().getFullYear()
