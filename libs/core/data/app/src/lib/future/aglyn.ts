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
export * from './utils'
export * from './constants'

export * from './emit-manager'
export * from './log-manager'
export * from './error-manager'
export * from './user-agent-manager'
export * from './components-manager'
export * from './nodes-manager'
export * from './dependency-manager'

// const TAG = 'Aglyn'
// export interface AglynConfig {
//   logLevel?: LogLevelString
// }
//
// export class Aglyn {
//   public static readonly namespace = namespace
//   public static readonly version = version
//   public static readonly platform = new UAParser()
//   public static readonly components = ComponentManager
//   public static readonly errorFactory = error
//   public static readonly logger = logger
//   public static readonly emitter = emitter
//   static {
//     emitter.on(AglynEvent.REGISTER_COMPONENT, ({ component, schema }) => {
//       Aglyn.components.registerComponent(component, schema)
//     })
//   }
//
//   private static singleton: Aglyn
//   public static getInstance(appName?: string, config?: AglynConfig) {
//     if (!Aglyn.singleton) Aglyn.singleton = new Aglyn(appName, config)
//     return Aglyn.singleton
//   }
//
//   //region Properties
//   readonly #createdAt: ITimestamp
//   public get createdAt(): ITimestamp {
//     return this.#createdAt
//   }
//
//   readonly #config: AglynConfig = {}
//   public get config(): AglynConfig {
//     return this.#config
//   }
//
//   #canvas: IAglynCanvasController = null
//   public get canvas(): IAglynCanvasController {
//     return this.#canvas
//   }
//   //endregion
//
//   protected constructor(
//     public readonly appName?: string,
//     config?: AglynConfig,
//   ) {
//     this.#config = { ...config }
//     this.#createdAt = Timestamp.now()
//     this.setupLogger()
//   }
//
//   //region Setup/Breakdown
//   private setupLogger() {
//     setLogLevel(this.#config.logLevel)
//   }
//   //endregion
//
//   //region Lifecycle Methods
//   /** @ignore */
//   public __initialize__(props?: never): this {
//     lifecycleEvent(
//       () => {
//         this.onInitialize()
//       },
//       {
//         startEvent: AglynEvent.APP_INITIALIZING,
//         startPayload: [{ appName: Aglyn.namespace }],
//         endEvent: AglynEvent.APP_INITIALIZED,
//         endPayload: [{ appName: this.appName }],
//       },
//     )
//     return this
//   }
//   /** @ignore */
//   public __activate__(props?: never): this {
//     lifecycleEvent(
//       () => {
//         this.onActivate()
//       },
//       {
//         startEvent: AglynEvent.APP_ACTIVATING,
//         startPayload: [{ appName: this.appName }],
//         endEvent: AglynEvent.APP_ACTIVATED,
//         endPayload: [{ appName: this.appName }],
//       },
//     )
//     return this
//   }
//   /** @ignore */
//   public __deactivate__(props?: never): this {
//     lifecycleEvent(
//       () => {
//         this.onDeactivate()
//       },
//       {
//         startEvent: AglynEvent.APP_DEACTIVATING,
//         startPayload: [{ appName: this.appName }],
//         endEvent: AglynEvent.APP_DEACTIVATED,
//         endPayload: [{ appName: this.appName }],
//       },
//     )
//     return this
//   }
//   /** @ignore */
//   public __destroy__(props?: never): this {
//     lifecycleEvent(
//       () => {
//         this.onDestroy()
//       },
//       {
//         startEvent: AglynEvent.APP_DESTROYING,
//         startPayload: [{ appName: this.appName }],
//         endEvent: AglynEvent.APP_DESTROYED,
//         endPayload: [{ appName: this.appName }],
//       },
//     )
//     return this
//   }
//
//   public onInitialize(): this {
//     return this
//   }
//   public onActivate(): this {
//     return this
//   }
//   public onDeactivate(): this {
//     return this
//   }
//   public onDestroy(): this {
//     return this
//   }
//   //endregion
//
//   //region Built-in
//   public get [Symbol.toStringTag](): string {
//     return TAG
//   }
//   public toString() {
//     return `[object ${this[Symbol.toStringTag]}]`
//   }
//   public toJSON() {
//     return {
//       namespace: Aglyn.namespace,
//       version: Aglyn.version,
//       platform: Aglyn.platform,
//       created: this.#createdAt.toJSON(),
//       appName: this.appName,
//       options: this.#config,
//     }
//   }
//   //endregion
// }
