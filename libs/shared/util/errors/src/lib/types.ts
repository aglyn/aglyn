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

export type EventFlag = string
export type EventMessage = string
export type Key = string
export type VarSyntax<T extends Key> = `{$${T}}`
export type ErrorPayload<K extends keyof any = keyof any, T = unknown> = Partial<Record<K, T>>

export type ErrorTagMessages<T extends EventFlag = string> = Record<T, EventMessage>
export type ErrorTagPayloads<T extends Key = string> = Record<T, ErrorPayload>
