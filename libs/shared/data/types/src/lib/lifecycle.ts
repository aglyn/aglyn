/**
 * @license
 * Copyright 2023 Aglyn LLC
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

/** Observers to handle life cycle onInit/onDestroy events */
export interface LifecycleObserver {
  /**
   * Should be invoked once immediately after instantiation
   */
  onInit?(...args: unknown[]): unknown
  /**
   * Should be invoked once as last step before garbage collection
   */
  onDestroy?(...args: unknown[]): unknown
}

export interface LoadableObserver {
  /**
   * Should be invoked each time the object is loaded
   */
  onLoad?(...args: unknown[]): unknown
  /**
   * Should be invoked each time the object is unloaded
   */
  onUnload?(...args: unknown[]): unknown
}

export interface LoadableLifecycleObserver extends LoadableObserver, LifecycleObserver {

}
