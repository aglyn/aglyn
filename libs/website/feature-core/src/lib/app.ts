/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import EventEmitter from 'events'
import { Component, ComponentController, components, eventEmitter } from './core'
import { EventKey, PKG_VERSION, PRODUCTION } from '../const'


export class App {

  public static readonly version: string = PKG_VERSION
  public static readonly production: boolean = PRODUCTION
  public static readonly development: boolean = !PRODUCTION
  public static readonly event: EventEmitter = eventEmitter

  private static instance?: App


  /**
   * Get the currently living singleton instance of Website
   * @throws
   * @returns {App} instance
   */
  public static getInstance(): App {
    if (App.instance instanceof App) {
      return App.instance
    }
    throw new Error('Instance doesn\'t exist! You must call createInstance(...) first!')
  }

  /**
   * Creates a new singleton instance of App
   * @throws
   */
  public static createInstance(): App {
    if (App.instance instanceof App) {
      throw new Error('Instance exist! You have already created an instance.')
    }
    App.instance = new App()
    App.event.emit(EventKey.INSTANCE_CREATED, this, App.instance)
    return App.instance
  }

  /**
   * Builds and registers a {@link ComponentController} instance from the
   * provided {@link Component}
   * @param {string} _id
   * @param {Component['Component']} Component
   * @param {Component} options
   * @return {ComponentController} Reference to the newly created model
   */
  public static setComponent(
    _id: string,
    Component: Component['Component'],
    options?: Omit<Component, '_id'>,
  ): ComponentController {
    const { _id: _1, Component: _2, ...opts } = options as Component
    const config: Component = { ...opts, Component, _id }
    const ctrl = new ComponentController(config, App)
    components.set(_id, ctrl)
    App.event.emit(EventKey.COMPONENT_REGISTERED, App, ctrl)
    return ctrl
  }

}


export function app() {
  return 'app'
}
