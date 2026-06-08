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


export const PACKAGE_VERSION = String(process.env['PACKAGE_VERSION'] || 'NULL')
export const BUILD_ID = String(process.env['BUILD_ID'] || 'NULL')
export const COMMIT_REF = String(process.env['COMMIT_REF'] || 'NULL')

export const IS_PRODUCTION = process.env['NODE_ENV'] === 'production'
export const IS_DEVELOPMENT = process.env['NODE_ENV'] === 'development'
export const IS_TEST = process.env['NODE_ENV'] === 'test'

export const FIREBASE_FIRESTORE_EMULATOR_ENABLED = process.env['FIREBASE_FIRESTORE_EMULATOR_ENABLED'] === 'true'
export const FIREBASE_AUTH_EMULATOR_ENABLED = process.env['FIREBASE_AUTH_EMULATOR_ENABLED'] === 'true'
export const FIREBASE_STORAGE_EMULATOR_ENABLED = process.env['FIREBASE_STORAGE_EMULATOR_ENABLED'] === 'true'
export const FIREBASE_DATABASE_EMULATOR_ENABLED = process.env['FIREBASE_DATABASE_EMULATOR_ENABLED'] === 'true'

export const AGLYN_SILOED_HOST = String(process.env['AGLYN_SILOED_HOST'] || '')

export const HAS_WINDOW = () => typeof window !== 'undefined'
export const HAS_DOCUMENT = () => typeof document !== 'undefined'
export const HAS_BROWSER = () => typeof (process as any)['browser'] !== 'undefined'

export const CURRENT_YEAR = new Date().getFullYear()
export const CURRENT_YEAR_UTC = new Date().getUTCFullYear()
