// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import kotlinx.coroutines.delay

/**
 * A Save pressed while it is held is KEPT, not dropped (AGL-4047, the console's `useHeldSave`, #2643).
 *
 * While the data a form is seeded from is only the device cache's copy, its Save is held. A press in that window used to
 * land on a disabled button and do nothing. Now the press is kept: the button shows it is saving from the press, and the
 * save runs once the server's copy is in, over the edits as they are replayed onto that copy, never over the cache's values
 * the press was made on. If no confirmation comes within the guard's wait, the guard's refusal shows and nothing is written.
 * Controls that write on each change (switches, reorder, delete, archive) stay held instead. The Apple kit's
 * `AglynHeldPress`.
 */
class HeldPress {
  /** A press is kept, waiting for the server's copy. */
  var waiting by mutableStateOf(false)
    private set

  /** Why the last kept press saved nothing; cleared by the next press. */
  var refusal by mutableStateOf<String?>(null)
    private set

  /** Counts kept presses, so each gets its own wait. */
  var press by mutableIntStateOf(0)
    private set

  /**
   * Press Save. True when it should run now (nothing is held); while held, the press is kept and this is false. A press
   * while one is already kept is the same press.
   */
  fun pressed(checking: Boolean): Boolean {
    if (waiting) return false
    refusal = null
    if (!checking) return true
    waiting = true
    press += 1
    return false
  }

  /** The hold changed. True when a kept press should run now, because the server's copy is in. */
  fun lifted(checking: Boolean): Boolean {
    if (!waiting || checking) return false
    waiting = false
    return true
  }

  /** The wait ran out with the hold still on: the press saves nothing and the guard's refusal shows. */
  fun timedOut(message: String) {
    if (!waiting) return
    waiting = false
    refusal = message
  }

  /** The surface was discarded or closed: a kept press is dropped with it, and so is its refusal. */
  fun reset() {
    waiting = false
    refusal = null
  }

  companion object {
    /** How long a kept press waits for the server's copy: the guard's own wait (`seedConfirmWaitMs`). */
    var confirmWaitMs: Long = 12_000
  }
}

/**
 * A [HeldPress] that runs a kept press once [checking] lifts, and refuses it with [refusal] once the guard's wait runs out.
 * [run] is the surface's save as it is now; it runs on the frame after the lift, so it reads the edits replayed onto the
 * server's copy.
 */
@Composable
fun rememberHeldPress(checking: Boolean, refusal: String, run: () -> Unit): HeldPress {
  val held = remember { HeldPress() }
  val latestRun by rememberUpdatedState(run)
  val latestRefusal by rememberUpdatedState(refusal)
  LaunchedEffect(held.press, checking) {
    if (!held.waiting) return@LaunchedEffect
    if (!checking) {
      if (held.lifted(checking = false)) {
        withFrameNanos { }
        latestRun()
      }
    } else {
      delay(HeldPress.confirmWaitMs)
      held.timedOut(latestRefusal)
    }
  }
  return held
}

/**
 * What a [FormCard] is held on (AGL-4047): the sentence beside a held Save, and the refusal a kept press shows when the
 * server's copy never comes. The Apple kit's `AglynFormHold`.
 */
data class FormHold(val checking: String, val unconfirmed: String) {
  companion object {
    /** The hold of a form seeded from the cache's copy of [subject] ("site settings"). */
    fun of(subject: String): FormHold =
      FormHold(com.aglyn.core.seedCheckingText(subject), com.aglyn.core.seedUnconfirmedText(subject))
  }
}
