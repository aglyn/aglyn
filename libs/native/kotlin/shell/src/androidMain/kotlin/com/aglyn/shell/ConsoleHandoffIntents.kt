package com.aglyn.shell

import com.aglyn.core.AuthError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Finishes a console sign-in when [link] is its page handing the code back to this app's scheme (AGL-3816): true when it
 * was, and the activity then has nothing else to open. A failure is shown on the sign-in screen.
 */
fun ShellServices.handleConsoleHandoffReturn(link: String?, scope: CoroutineScope): Boolean {
  if (link == null || !isConsoleHandoffReturn(link)) return false
  scope.launch {
    try {
      finishConsoleHandoff(link)
    } catch (failure: AuthError) {
      authFlow.handoffError = failure.message
    }
  }
  return true
}
