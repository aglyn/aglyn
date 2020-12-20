import { Box } from '../interfaces/dod'
import { BaseRef } from '../interfaces/ref-controller'
import { Crud } from '../models/Crud'
import { ID } from '../types'


/**
 * Base model to be shared with all document models
 *
 * @export
 * @class BaseRefController
 * @extends {Crud<T>}
 * @implements {BaseRef<T>}
 * @template T
 */
export class BaseRefController<T extends Box.Id = Box.Id> extends Crud<T> implements BaseRef<T> {

  public get id(): ID { return this.get('id') }
  public set id(value: ID) { this.set('id', value) }

  /** @inheritdoc */
  preInit?(): void

  /**
   * Initialize the instance, should be called immediately after
   * creating the object. If overridden you must call preInit and
   * onInit yourself, do not super this method.
   *
   * @public
   * @memberof BaseRefController
   */
  init(): this {
    this.preInit && this.preInit()
    this.onInit && this.onInit()
    return this
  }

  /** @inheritdoc */
  onInit?(): void

}