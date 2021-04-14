/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

// import EventEmitter from 'events'
import { Component, ModulesMap } from './core'
import { EventFlag, PKG_VERSION } from '../const'
import EventEmitter from 'events'


export class App {

  public static readonly $VERSION: string = PKG_VERSION

  public static event: EventEmitter = new EventEmitter()
  public static modules: ModulesMap = new Map()

  private static instance?: App

  private constructor() {/* empty */}


  /**
   * Get or creates the currently living singleton instance of App
   * @returns {this} instance
   */
  public static getInstance(): App {
    if (this.instance instanceof this) {
      return this.instance
    }
    this.instance = new this()
    this.event.emit(EventFlag.INSTANCE_CREATED, this, this.instance)
    return this.instance
  }

  public static setModule(props: { _id: string, declarations: Component[] }) {
    const { _id, declarations } = props
    const module = { _id, declarations }
    this.modules.set(_id, module)
    this.event.emit(EventFlag.SET_MODULE, this, module)
    return this
  }

  public static setComponent(props: {
    moduleId: string,
    _id: string
    ctor: Component['ctor'],
    metadata?: Component['metadata']
  }) {
    const { moduleId, _id, ctor, metadata } = props
    const module = this.modules.get(moduleId) ?? { _id: moduleId, declarations: [] }
    let component
    if (module.declarations.some(i=>i._id === _id)) {
      component = module.declarations.find(i=>i._id === _id)
    }
    component = {...component,  _id, ctor, metadata}
    module.declarations.push(component)
    this.modules.set(_id, module)
    this.event.emit(EventFlag.SET_COMPONENT, this, module)
    return this
  }

}


export function app() {
  return 'app'
}
