package com.aglyn.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import com.aglyn.core.AglynConfig
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem

/** A documentation or legal page the app links to; each opens in the in-app browser screen. */
data class HelpLink(val id: String, val title: String, val icon: String, val url: String)

/**
 * The console user menu's Documentation, the docs' What's new, and the Terms of Service and Privacy Policy the sign-up
 * links to, from the build's own docs and legal origins (a self-hosted build's, never ours).
 */
fun helpLinks(config: AglynConfig): List<HelpLink> = listOf(
  HelpLink("docs", "Documentation", "article", "${config.docsOrigin}/"),
  HelpLink("whats-new", "What's new", "auto_awesome", "${config.docsOrigin}/whats-new"),
  HelpLink("terms", "Terms of Service", "gavel", "${config.legalOrigin}/legal/terms"),
  HelpLink("privacy", "Privacy Policy", "privacy_tip", "${config.legalOrigin}/legal/privacy"),
)

/** Settings' Help rows, each opening its page in the browser screen. */
@Composable
internal fun HelpSection(config: AglynConfig) {
  val uri = LocalUriHandler.current
  Column {
    SectionHeader("Help")
    for (link in helpLinks(config)) {
      AglynListItem(
        title = link.title,
        icon = AglynIcons.named(link.icon),
        trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
        onClick = { uri.openUri(link.url) },
        modifier = Modifier.testTag("help-${link.id}"),
      )
    }
  }
}
