package com.aglyn.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.LEGAL_REACCEPTANCE_CONTEXT
import com.aglyn.core.LegalReacceptanceCopy
import com.aglyn.core.LegalStatus
import com.aglyn.ui.TextButton
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Re-acceptance when the Terms move (the console's `LegalReacceptanceBanner`, AGL-2316): a banner over every screen, answered
 * with I agree, never a wall. The status read fails silent, so a check that could not run never nags someone who has already
 * agreed.
 */
@Composable
internal fun LegalReacceptanceBanner(services: ShellServices, uid: String) {
  var status by remember(uid) { mutableStateOf<LegalStatus?>(null) }
  var accepted by remember(uid) { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(uid) {
    status = runCatching { LegalStatus.of(services.api.request("/api/auth/legal-acceptance") as? JsonObject) }.getOrNull()
  }
  if (accepted) return
  val copy = status?.let { LegalReacceptanceCopy.make(it, services.config.brandName) } ?: return
  val origin = services.config.legalOrigin
  val links = TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))
  Surface(
    Modifier.fillMaxWidth().testTag("legal-reacceptance"),
    color = MaterialTheme.colorScheme.secondaryContainer,
    contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
  ) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(
          buildAnnotatedString {
            append(copy.lead)
            withLink(LinkAnnotation.Url("$origin/legal/terms", links)) { append("Terms of Service") }
            append(" and ")
            withLink(LinkAnnotation.Url("$origin/legal/privacy", links)) { append("Privacy Policy") }
            append(copy.tail)
          },
          style = MaterialTheme.typography.bodyMedium,
        )
        Text(copy.caption, style = MaterialTheme.typography.bodySmall)
      }
      TextButton(
        onClick = {
          busy = true
          scope.launch {
            val ok = runCatching {
              services.api.request("/api/auth/legal-acceptance", ApiMethod.POST, buildJsonObject { put("context", LEGAL_REACCEPTANCE_CONTEXT) })
            }.isSuccess
            if (ok) accepted = true
            busy = false
          }
        },
        enabled = !busy,
        modifier = Modifier.testTag("legal-reaccept"),
      ) { Text(if (busy) "Recording…" else "I agree") }
    }
  }
}
