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
import {EventEmitter2} from 'eventemitter2'
import mitt, {Emitter as MittEmitterFn} from 'mitt'


export type {
  EventType,
  Handler,
  WildcardHandler,
  EventHandlerList,
  WildCardEventHandlerList,
  EventHandlerMap,
  Emitter as MittEmitter,
} from 'mitt'
export type {
  event,
  eventNS,
  ConstructorOptions,
  ListenerFn,
  EventAndListener,
  WaitForOptions,
  CancelablePromise,
  OnceOptions,
  ListenToOptions,
  GeneralEventEmitter,
  OnOptions,
  Listener,
} from 'eventemitter2'

export class Emitter extends EventEmitter2 {}

export type EmitterFn<Events extends Record<string | symbol, unknown>> = MittEmitterFn<Events>
export const EmitterFn = mitt
