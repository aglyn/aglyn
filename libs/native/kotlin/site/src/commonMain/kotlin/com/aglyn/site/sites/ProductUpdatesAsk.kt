package com.aglyn.site.sites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod

import com.aglyn.core.MarketingConsent
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.controlShape
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The one-time product-updates ask for an account that never answered (the console's `PlatformMarketingConsentPrompt`,
 * AGL-3185): shown on the Sites list when `/api/auth/marketing-consent` says it is due. Yes, No thanks, or the close (asked
 * again later); nothing once answered.
 */
@Composable
internal fun ProductUpdatesAsk(context: NativePluginContext) {
  var due by remember(context.uid) { mutableStateOf(false) }
  var busy by remember { mutableStateOf<String?>(null) }
  var said by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val scope = rememberCoroutineScope()
  val brand = com.aglyn.core.AglynConfig.DEFAULT_BRAND_NAME
  LaunchedEffect(context.uid) {
    due = runCatching { ((context.api.request("/api/auth/marketing-consent") as? JsonObject)?.get("promptDue") as? JsonPrimitive)?.booleanOrNull }
      .getOrNull() == true
  }
  fun answer(decision: String) {
    busy = decision
    scope.launch {
      val saved = runCatching {
        context.api.request(
          "/api/auth/marketing-consent", ApiMethod.POST,
          buildJsonObject {
            put("decision", decision)
            put("source", "console-prompt")
            put("textVersion", MarketingConsent.TEXT_VERSION)
          },
        )
      }.isSuccess
      busy = null
      if (!saved) {
        said = "Your choice could not be saved. Please try again." to StatusTone.WARNING
        return@launch
      }
      due = false
      said = when (decision) {
        "granted" -> "You will hear about product updates from $brand." to StatusTone.SUCCESS
        "declined" -> "Noted — no product updates." to StatusTone.INFO
        else -> null
      }
    }
  }
  said?.let { (text, tone) -> NoticeBanner(text, tone, Modifier.padding(horizontal = space(2f), vertical = space(0.5f))) }
  if (!due) return
  Surface(
    Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(0.5f)).testTag("product-updates-ask"),
    // The console's info Alert, in the info band every notice uses.
    color = LocalAglynPalette.current.info.main.copy(alpha = 0.12f),
    shape = MaterialTheme.shapes.medium,
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.Top) {
        Text("Want product updates from $brand?", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
        IconButton(onClick = { answer("dismissed") }, enabled = busy == null, modifier = Modifier.testTag("product-updates-not-now")) {
          Icon(AglynIcons.named("close"), contentDescription = "Not now")
        }
      }
      Text(MarketingConsent.text(brand), style = MaterialTheme.typography.bodyMedium)
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { answer("granted") }, enabled = busy == null, shape = controlShape(), modifier = Modifier.testTag("product-updates-yes")) {
          Text(if (busy == "granted") "Saving…" else "Yes, send them")
        }
        TextButton(onClick = { answer("declined") }, enabled = busy == null, modifier = Modifier.testTag("product-updates-no")) {
          Text(if (busy == "declined") "Saving…" else "No thanks")
        }
      }
    }
  }
}
