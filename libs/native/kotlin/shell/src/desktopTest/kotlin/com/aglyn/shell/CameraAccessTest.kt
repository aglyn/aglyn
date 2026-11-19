package com.aglyn.shell

import com.aglyn.shell.CameraAccess.Failure
import com.aglyn.shell.CameraAccess.Step
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class CameraAccessTest {
  @Test
  fun aGrantedOrUndeclaredPermissionLaunchesAndAnyOtherAsksFirst() {
    assertEquals(Step.LAUNCH, CameraAccess.before(declared = true, granted = true))
    assertEquals(Step.LAUNCH, CameraAccess.before(declared = false, granted = false))
    assertEquals(Step.ASK, CameraAccess.before(declared = true, granted = false))
  }

  @Test
  fun anAllowLaunchesAndADenialOnceOrForGoodRefusesWithoutAskingAgain() {
    assertEquals(Step.LAUNCH, CameraAccess.afterAsk(granted = true))
    // Denied once, and denied for good (the system answers false with no prompt): both end in the message, never a re-ask.
    assertEquals(Step.REFUSE, CameraAccess.afterAsk(granted = false))
    assertEquals(CameraAccess.NOT_ALLOWED, CameraAccess.message(Failure.NOT_ALLOWED))
  }

  @Test
  fun aStartThatThrowsAnswersItsFailureInsteadOfCrashing() {
    val classify = { error: Throwable ->
      when (error) {
        is SecurityException -> Failure.NOT_ALLOWED
        is UnsupportedOperationException -> Failure.NO_CAMERA_APP
        else -> null
      }
    }
    var started = false
    assertNull(CameraAccess.start({ started = true }, classify))
    assertEquals(true, started)
    assertEquals(Failure.NOT_ALLOWED, CameraAccess.start({ throw SecurityException("revoked") }, classify))
    assertEquals(Failure.NO_CAMERA_APP, CameraAccess.start({ throw UnsupportedOperationException("no app") }, classify))
    assertEquals(CameraAccess.NO_CAMERA_APP, CameraAccess.message(Failure.NO_CAMERA_APP))
    assertFailsWith<IllegalStateException> { CameraAccess.start({ error("other") }, classify) }
  }
}
