import { PKey, Ref } from '../interfaces/dod'
import { RefController } from '../interfaces/ref-controller'
import { Crud } from '../models/Crud'

/**
 *
 *
 * @export
 * @class BaseRefController
 * @extends {Crud<Ref.Base<S>>}
 * @implements {RefController<S>}
 * @template S
 */
export class BaseRefController<S, T> extends Crud<T> implements RefController<T> {

  constructor(public readonly meta: Ref.Base<S>, model: T) {
    super(model)
  }

  /** @inheritdoc */
  public preInit?(): void

  /**
   * Initialize the instance, should be called immediately after
   * creating the object. If overridden you must call preInit and
   * onInit yourself, do not super this method.
   *
   * @public
   * @memberof BaseRefController
   */
  public init(): this {
    this.preInit && this.preInit()
    this.onInit && this.onInit()
    return this
  }

  /** @inheritdoc */
  public onInit?(): void

  public getId(): PKey {
    return this.meta.id
  }

  public setId(value: PKey): this {
    this.meta.id = value
    return this
  }

  public getSchema(): S {
    return this.meta.schema
  }

  public setSchema(value: S): this {
    this.meta.schema = value
    return this
  }

}