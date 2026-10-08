package com.aglyn.pluginhost

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * One screen's writes, one at a time: whether one is running, why the last
 * one failed, and what the last one did. A screen's dialogs read [busy] and
 * [error]; its banner reads [notice]. The console's own words come through:
 * a route's refusal is shown as the route wrote it, and a rules refusal reads
 * as the role it needs.
 */
class ActionRunner(private val scope: CoroutineScope, private val roleHint: String = "an editor or admin") {
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)

  /** What just happened, for the screen's banner. */
  var notice by mutableStateOf<String?>(null)

  /** Runs [block] unless another write is running; [onDone] follows a success. */
  fun run(success: String? = null, onDone: () -> Unit = {}, block: suspend () -> Unit) {
    if (busy) return
    busy = true
    error = null
    scope.launch {
      try {
        block()
        if (success != null) notice = success
        onDone()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = describe(failure)
      } finally {
        busy = false
      }
    }
  }

  fun clear() {
    error = null
    notice = null
  }

  /** A failure in a person's words. */
  fun describe(failure: Throwable): String = when {
    failure is ConsoleApiError && failure.status != 0 -> failure.message
    failure is ConsoleApiError -> failure.message
    failure.message.orEmpty().contains("permission", ignoreCase = true) ->
      "That change needs a different role — ask $roleHint"
    else -> "That did not go through. Check the connection and try again."
  }
}
