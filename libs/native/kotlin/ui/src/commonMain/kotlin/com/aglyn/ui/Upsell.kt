package com.aglyn.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions

/*
 * The console's upgrade surfaces, drawn the native way (Figma Notice/Upgrade 121:18654, Promo/Add-on card 121:18655), the
 * Compose twins of Apple's AglynUpgradeNotice and AglynAddOnPromoCard. The words are always the console's: a screen hands in
 * the sentence its console twin shows.
 */

/** What an upgrade notice offers: the plans, or the add-ons (a feature sold only as an add-on). */
enum class UpgradeKind(val actionTitle: String, internal val icon: String) {
  PLAN("View plans", "lock"),
  ADD_ON("View add-ons", "confirmation_number"),
}

/**
 * A feature the plan leaves out, where the feature would be (the console's blocked plugin page): a lock (a ticket for an
 * add-on), the console's sentence naming the plan that includes it, and View plans (or View add-ons). The screen stays
 * reachable, so the way to buy the feature is where people look for it.
 */
@Composable
fun UpgradeNotice(message: String, kind: UpgradeKind = UpgradeKind.PLAN, modifier: Modifier = Modifier, action: (() -> Unit)?) {
  val m = shellMetrics
  val palette = LocalAglynPalette.current
  Row(
    modifier.fillMaxWidth().clip(RoundedCornerShape(m.controlRadius + 2.dp)).background(palette.info.main.copy(alpha = 0.08f))
      .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp).testTag("upgrade-notice"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Icon(AglynIcons.named(kind.icon), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(message, fontSize = m.rowText, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
    if (action != null) {
      OutlinedButton(onClick = action, shape = controlShape(), modifier = Modifier.testTag("upgrade-notice-action")) { Text(kind.actionTitle) }
    }
  }
}

/** The notice standing in for a whole screen the plan leaves out: at the top of the content, at its margins. */
@Composable
fun UpgradeNoticeScreen(message: String, kind: UpgradeKind, tag: String, action: (() -> Unit)?) {
  Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp).testTag(tag)) {
    UpgradeNotice(message, kind, action = action)
  }
}

/**
 * An add-on's offer where the console shows one (Figma Promo/Add-on card; the console's AiUpsellDialog): an icon tile, the
 * title, what it does, where it comes from (the console's offer sentence), then the dismissal and the add action. A
 * member who cannot buy it reads the "ask an owner or admin" sentence and only the dismissal ([actionTitle] null).
 */
@Composable
fun AddOnPromoCard(
  title: String,
  does: String,
  offer: String,
  dismissTitle: String,
  actionTitle: String?,
  onDismiss: () -> Unit,
  onAction: () -> Unit,
  icon: String = "auto_awesome",
  modifier: Modifier = Modifier,
) {
  val m = shellMetrics
  Surface(
    shape = RoundedCornerShape(m.sheetRadius),
    color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = modifier.widthIn(max = 360.dp).testTag("addon-promo"),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
          Icon(AglynIcons.named(icon), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
      }
      Text(does, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
      Text(offer, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
        TextButton(onClick = onDismiss, modifier = Modifier.testTag("addon-promo-dismiss")) { Text(dismissTitle) }
        if (actionTitle != null) Button(onClick = onAction, shape = controlShape(), modifier = Modifier.testTag("addon-promo-add")) { Text(actionTitle) }
      }
    }
  }
}

/**
 * The plan card at the sidebar's foot (Figma 98:1048): whose plan it is, what is close to its limit (the console's usage
 * notice, in its words), and the way to more. Dismissible.
 */
@Composable
fun PlanUsageCard(detail: String?, title: String, actionTitle: String, reached: Boolean, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
  val m = shellMetrics
  val palette = LocalAglynPalette.current
  Surface(
    shape = RoundedCornerShape(m.cardRadius),
    color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = modifier.fillMaxWidth().testTag("plan-card"),
  ) {
    Column(Modifier.padding(start = 10.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
          detail?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
          Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (reached) palette.error.text else MaterialTheme.colorScheme.onSurface, maxLines = 3)
        }
        androidx.compose.material3.IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp).testTag("plan-card-dismiss")) {
          Icon(AglynIcons.named("close"), "Dismiss", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      OutlinedButton(onClick = onOpen, shape = controlShape(), modifier = Modifier.testTag("plan-card-open")) { Text(actionTitle) }
      Spacer(Modifier.size(0.dp))
    }
  }
}

/**
 * The plan card at the sidebar's foot, as Figma 98:1048 draws it (the twin of Apple's PlanCard): whose plan it is ("Juniper
 * Street Bakery · Pro plan"), the console meter's own label and figures with Upgrade ("Pages 84 / 100 · Upgrade"), and the
 * meter, amber from 80% and red at the limit. A long press (or right click) hides it until the next limit.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PlanMeterCard(detail: String, label: String, used: Long, limit: Long, onUpgrade: () -> Unit, onHide: () -> Unit, modifier: Modifier = Modifier) {
  val m = shellMetrics
  val palette = LocalAglynPalette.current
  val full = used >= limit
  val share = if (limit > 0) (used.toFloat() / limit).coerceIn(0f, 1f) else 0f
  val shape = RoundedCornerShape(m.cardRadius)
  Column(
    modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surface)
      .then(Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape))
      .combinedClickable(onClick = onUpgrade, onLongClick = onHide)
      .padding(if (m.compact) 10.dp else 12.dp)
      .testTag("plan-card")
      .semantics(mergeDescendants = true) {
        contentDescription = "$label, $used of $limit. $detail"
        customActions = listOf(
          androidx.compose.ui.semantics.CustomAccessibilityAction("Upgrade") { onUpgrade(); true },
          androidx.compose.ui.semantics.CustomAccessibilityAction("Hide until the next limit") { onHide(); true },
        )
      },
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text(detail, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text(label, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
      Spacer(Modifier.weight(1f))
      Text("$used / $limit · ", fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
      Text("Upgrade", fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.primary, maxLines = 1, modifier = Modifier.testTag("plan-card-upgrade"))
    }
    // The console's meter: amber from 80%, red at the limit.
    Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant)) {
      Box(Modifier.fillMaxWidth(share).fillMaxSize().clip(RoundedCornerShape(50)).background(if (full) palette.error.main else palette.warning.main))
    }
  }
}
