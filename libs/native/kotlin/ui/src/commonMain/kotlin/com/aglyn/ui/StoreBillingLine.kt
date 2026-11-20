package com.aglyn.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.StoreBilling

/**
 * Opens the workspace's billing page on the console in the device's browser (never the in-app browser), where a store build
 * may link to it; null where it may not, or where the shell has no workspace. The shell provides it.
 */
val LocalWebBillingOpener = staticCompositionLocalOf<(() -> Unit)?> { null }

/**
 * The one quiet line a store build shows in place of the buying controls it leaves out, once per screen (the owner's decision
 * of 2026-11-19; the twin of Apple's AglynStoreBillingLine): "Manage billing on the web" where a link is allowed (never on
 * Google Play for now, [StoreBilling.webBillingLink]), otherwise the plain sentence, which names no address and no other place
 * to buy. Draws nothing in a build that may buy.
 */
@Composable
fun StoreBillingLine(modifier: Modifier = Modifier) {
  if (StoreBilling.buying) return
  val open = LocalWebBillingOpener.current
  if (StoreBilling.webBillingLink && open != null) {
    TextButton(onClick = open, modifier = modifier.testTag("store-billing-link")) { Text(StoreBilling.webBillingLinkLabel) }
  } else {
    Text(
      StoreBilling.noBillingNote, fontSize = shellMetrics.rowText, color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = modifier.testTag("store-billing-note"),
    )
  }
}
