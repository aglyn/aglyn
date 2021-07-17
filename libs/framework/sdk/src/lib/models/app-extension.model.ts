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

import { AppComponent, AppExtComponents, AppExtension, ExtensionConfig, WebApp } from '../types'


export class AppExtensionModel implements AppExtension {
  readonly #app: WebApp
  private readonly $id: string
  private readonly _config: ExtensionConfig
  private readonly _components: AppExtComponents

  get component(): AppExtComponents {
    return this._components
  }

  get [Symbol.toStringTag]() {
    return `AppExtension`
  }

  constructor(
    app: WebApp,
    config: ExtensionConfig,
  ) {
    this.#app = app
    this._config = {...config}
    this.$id = this._config.$id
    this._components = this._config?.components ?? []
  }

  public getApp(): WebApp {
    return this.#app
  }

  public getId(): ExtensionConfig['$id'] {
    return this.$id
  }

  public getConfig(): ExtensionConfig {
    return this._config
  }

  public getComponents(): AppComponent[] {
    return [...this._components.values()]
  }

  toString() {
    return `AppExtension(id: ${this.$id})`
  }

  toJSON() {
    return {
      $id: this.$id,
      config: this._config,
    }
  }

}
