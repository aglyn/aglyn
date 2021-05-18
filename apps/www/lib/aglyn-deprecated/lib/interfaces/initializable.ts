/**
 * Init hooks for object methods
 *
 * @export
 * @interface Initializable
 */
export interface Initializable {

  /**
   * Hook to be called from and at the beginning
   * of Initializable.init
   *
   * @memberof Initializable
   */
  preInit?(): void

  /**
   * Hook to be called after initialization of the
   * object (e.g., new Initializable().init())
   *
   * @returns {this}
   * @memberof Initializable
   */
  init(): this

  /**
   * Hook to be called from and at the end of
   * Initializable.init
   *
   * @memberof Initializable
   */
  onInit?(): void

}