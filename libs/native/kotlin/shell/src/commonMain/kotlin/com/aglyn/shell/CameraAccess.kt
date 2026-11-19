package com.aglyn.shell

/**
 * When the picker's "Take a photo" may open the system camera. An app that
 * declares the camera permission (both Android apps do, for the barcode
 * scanner) must hold it before it starts the camera app, or the start throws
 * a SecurityException; the picker asks first, once per tap, and a refusal
 * (or a refusal for good, which the system answers without a prompt) ends in
 * a message, never a loop. The words follow the barcode scanner's own.
 */
object CameraAccess {
  /** What the picker does next. */
  enum class Step { LAUNCH, ASK, REFUSE }

  /** Why a camera start failed. */
  enum class Failure { NOT_ALLOWED, NO_CAMERA_APP }

  const val NOT_ALLOWED = "Allow the camera in Settings to take a photo."
  const val NO_CAMERA_APP = "This device has no camera app. Choose a photo from your library instead."

  /** Before anything: a granted (or undeclared) permission launches, otherwise ask. */
  fun before(declared: Boolean, granted: Boolean): Step = if (!declared || granted) Step.LAUNCH else Step.ASK

  /** The system's answer to the ask: allowed launches; denied (once or for good) refuses. */
  fun afterAsk(granted: Boolean): Step = if (granted) Step.LAUNCH else Step.REFUSE

  /**
   * Starts the camera; a start that [classify] knows (a revoked permission, no
   * camera app) answers its failure instead of crashing. Anything else rethrows.
   */
  fun start(launch: () -> Unit, classify: (Throwable) -> Failure?): Failure? =
    try {
      launch()
      null
    } catch (error: Exception) {
      classify(error) ?: throw error
    }

  /** The message for a refused ask or a failed start. */
  fun message(failure: Failure): String = when (failure) {
    Failure.NOT_ALLOWED -> NOT_ALLOWED
    Failure.NO_CAMERA_APP -> NO_CAMERA_APP
  }
}
