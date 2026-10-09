package com.aglyn.plugins.sms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space

/**
 * The "Also send as texts" switch of the console's Customer notifications
 * card: when an order carries the customer's phone number, each update that
 * is on also goes by text, unless the store switches texts off here. Offered
 * only when the platform can send texts, so the screen never offers a channel
 * that does not exist.
 */
@Composable
fun CustomerTextsScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val api = remember(hostId, context.api) { ConsoleTextsApi(context.api, hostId) }
  val texts = remember(api, context.writer) { CustomerTexts(api, context.writer, hostId, scope) }
  LaunchedEffect(texts) { texts.check() }
  val store by remember(hostId, context.firestore) { context.firestore.observeDoc(storeSettingsPath(hostId)) }.collectAsState(Live.Loading)
  when (texts.channel) {
    TextChannel.Checking -> SkeletonList(rows = 2)
    TextChannel.Unavailable -> EmptyState(
      "Texts are not set up",
      body = "This install has no text provider, so order updates go by email only.",
      icon = AglynIcons.named("sms"),
      modifier = Modifier.testTag("texts-unavailable"),
    )
    TextChannel.NotPermitted -> EmptyState(
      "Ask a site admin or editor",
      body = "Only a site admin or editor can change how customers are notified.",
      icon = AglynIcons.named("sms"),
      modifier = Modifier.testTag("texts-not-permitted"),
    )
    TextChannel.Failed -> EmptyState(
      "Could not check texts",
      body = "Check the connection and try again.",
      icon = AglynIcons.named("error"),
      action = { Button(onClick = texts::check) { Text("Try again") } },
    )
    TextChannel.Available -> Column(
      Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      texts.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.testTag("texts-error")) }
      SectionCard("Customer notifications", Modifier.fillMaxWidth().testTag("texts-card")) {
        Text(
          "Order updates reach customers by email. Texts add a second channel for the same updates.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SwitchRow(
          TEXTS_SWITCH_TITLE,
          texts.enabled((store as? Live.Ready)?.value?.data),
          { on -> texts.set(on) },
          supporting = TEXTS_SWITCH_SUPPORTING,
          enabled = !texts.saving && store is Live.Ready,
          modifier = Modifier.testTag("texts-switch"),
        )
      }
    }
  }
}
