package com.aglyn.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.ui.TextButton

/**
 * The sign-in screens, framed for Add account while another account stays signed in: Cancel back to it, the heading
 * "Add an account" and whose session stays. The forms themselves are the sign-in screens' own (lane signin's), unchanged.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun AddAccountFrame(services: ShellServices, content: @Composable () -> Unit) {
  val accounts = services.accounts
  val adding = accounts?.adding?.collectAsState()?.value
  if (accounts == null || adding == null) {
    content()
    return
  }
  val staying = accounts.accounts.collectAsState().value.firstOrNull { it.slot == adding }
  BackHandler { accounts.cancelAdding() }
  Column(Modifier.fillMaxSize().testTag("add-account")) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainerLow) {
      Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { accounts.cancelAdding() }, modifier = Modifier.testTag("add-account-cancel")) { Text("Cancel") }
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
          Text("Add an account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
          Text(
            "Sign in to another account. You stay signed in to ${staying?.email ?: staying?.title ?: "your other account"}, and can switch from your photo at any time.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }
    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) { Box(Modifier.widthIn(max = 720.dp)) { content() } }
  }
}

/** A switch to another account starts at its Home, with nothing of the last account's screens left on the stack. */
@Composable
internal fun AccountSwitchReset(navigator: ShellNavigator, uid: String) {
  LaunchedEffect(uid) {
    if (navigator.shownUid != null && navigator.shownUid != uid) navigator.select(ShellNavigator.HOME)
    navigator.shownUid = uid
  }
}

/**
 * A tapped push names the account it was sent to (`MobilePushData.uid`): when another signed-in account on this device
 * holds it, that account comes on screen first, so the push's link opens where it belongs. Returns whether it switched.
 */
suspend fun ShellServices.showAccountOfPush(uid: String?): Boolean {
  val sessions = accounts ?: return false
  if (uid.isNullOrEmpty()) return false
  val account = sessions.accounts.value.firstOrNull { it.uid == uid } ?: return false
  if (account.slot == sessions.active.value) return false
  sessions.switchTo(account.slot)
  return true
}
