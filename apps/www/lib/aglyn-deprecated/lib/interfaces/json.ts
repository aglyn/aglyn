/**
 * Interface to describe for class method
 * to generate JSON
 *
 * @export
 * @interface toJSON
 * @template T
 */
export interface toJSON<T> {
  /**
   * Called from JSON.stringify(base)
   *
   * @returns {T}
   * @memberof Base
   */
  toJSON(): T
}