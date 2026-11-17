package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aglyn.core.PlatformLockdownNotice
import com.aglyn.ui.space

/**
 * What a signed-in person who is not staff sees while the platform is locked (the console's `PlatformLockdownGate`): the
 * lock's title and message, when it is expected back, who to ask, and Sign out.
 */
@Composable
internal fun LockdownGate(notice: PlatformLockdownNotice, signOut: () -> Unit) {
  val uriHandler = LocalUriHandler.current
  Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).testTag("lockdown-gate"), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 480.dp).padding(horizontal = space(3f)),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      Text(notice.title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
      Text(notice.message, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
      notice.until?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      notice.contact?.let { contact ->
        TextButton(onClick = { runCatching { uriHandler.openUri("mailto:$contact") } }) {
          Text("Questions? $contact", style = MaterialTheme.typography.bodyMedium)
        }
      }
      OutlinedButton(onClick = signOut, modifier = Modifier.testTag("lockdown-sign-out")) { Text("Sign out") }
    }
  }
}
