package com.aglyn.shell

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.Impersonation
import com.aglyn.ui.TextButton

/**
 * The band every screen of a support session wears: who the session is, who opened it, that it is audited, and the way back to
 * the staff member's own session. The console's `ImpersonationBanner`, in the same words.
 */
@Composable
fun ImpersonationBanner(impersonation: Impersonation, onExit: () -> Unit, modifier: Modifier = Modifier) {
  Surface(
    modifier.fillMaxWidth().testTag("impersonation-banner").semantics { liveRegion = LiveRegionMode.Polite },
    color = MaterialTheme.colorScheme.tertiaryContainer,
    contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
  ) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Text(impersonation.banner, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
      TextButton(onClick = onExit, modifier = Modifier.testTag("impersonation-exit")) { Text("Exit impersonation") }
    }
  }
}
