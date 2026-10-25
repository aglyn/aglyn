package com.aglyn.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.animation.togetherWith
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.clickable
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
 *
 * Narrower than [UPGRADE_NOTICE_INLINE_MIN] (a phone) it stacks: icon and sentence on one row, the action under the
 * sentence, as Apple's AglynUpgradeNotice does and Figma's Notice/Upgrade Layout=Stacked draws (AGL-4055).
 */
@Composable
fun UpgradeNotice(message: String, kind: UpgradeKind = UpgradeKind.PLAN, modifier: Modifier = Modifier, action: (() -> Unit)?) {
  val m = shellMetrics
  val palette = LocalAglynPalette.current
  BoxWithConstraints(
    modifier.fillMaxWidth().clip(RoundedCornerShape(m.controlRadius + 2.dp)).background(palette.info.main.copy(alpha = 0.08f))
      .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp).testTag("upgrade-notice"),
  ) {
    val icon = @Composable { Icon(AglynIcons.named(kind.icon), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    val button = @Composable {
      if (action != null) {
        OutlinedButton(onClick = action, shape = controlShape(), modifier = Modifier.testTag("upgrade-notice-action")) { Text(kind.actionTitle) }
      }
    }
    if (maxWidth < UPGRADE_NOTICE_INLINE_MIN) {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          icon()
          Text(message, fontSize = m.rowText, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
        }
        Box(Modifier.padding(start = 32.dp)) { button() }
      }
    } else {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        icon()
        Text(message, fontSize = m.rowText, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
        button()
      }
    }
  }
}

/** The narrowest an upgrade notice keeps its action beside the sentence (Figma Notice/Upgrade Layout=Inline). */
val UPGRADE_NOTICE_INLINE_MIN = 560.dp

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

/** One meter on the plan card: the Usage page's label, its figures ("1.2 / 5 GB"), and how full it is (0–1). */
data class PlanMeterLine(val key: String, val label: String, val figures: String, val share: Float)

/**
 * The plan card at the sidebar's foot (Figma 98:1048; AGL-3992, the twin of Apple's): whose plan it is ("Juniper Street
 * Bakery · Pro plan"), then a slow carousel of the console's usage meters, the one that fits the screen first: its name with
 * Upgrade in the accent, its 6 bar (the accent, the warning amber from the warning share, danger at the limit), then its
 * figures with the page dots at the trailing edge, which step through them. It moves on every [advanceMs], and holds while hovered, focused or touched, while a screen reader is on,
 * and with animations off (the dots then step by hand). A tap opens Billing › Usage; Upgrade opens the plans; a long press
 * (or right click) hides it.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PlanMeterCarousel(
  detail: String,
  meters: List<PlanMeterLine>,
  advanceMs: Long,
  warningShare: Float,
  onUpgrade: (() -> Unit)?,
  onOpenUsage: () -> Unit,
  onHide: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (meters.isEmpty()) return
  val m = shellMetrics
  val palette = LocalAglynPalette.current
  val shape = RoundedCornerShape(m.cardRadius)
  // The context's meter leads: a new order (another screen, another workspace) starts again at its first meter.
  var index by androidx.compose.runtime.remember(meters.map { it.key }) { androidx.compose.runtime.mutableIntStateOf(0) }
  val interaction = androidx.compose.runtime.remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
  val hovered by interaction.collectIsHoveredAsState()
  val focused by interaction.collectIsFocusedAsState()
  val pressed by interaction.collectIsPressedAsState()
  var touches by androidx.compose.runtime.remember { androidx.compose.runtime.mutableIntStateOf(0) }
  val auto = !reduceMotion() && !screenReaderOn()
  val shown = meters[index.coerceIn(0, meters.lastIndex)]
  androidx.compose.runtime.LaunchedEffect(index, meters.size, auto, hovered, focused, pressed, touches) {
    if (auto && meters.size > 1 && !hovered && !focused && !pressed) {
      kotlinx.coroutines.delay(advanceMs)
      index = (index + 1) % meters.size
    }
  }
  Column(
    // Figma's bg/surface (white in light), not the scheme's surface, which a theme sets to its grey canvas.
    modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surfaceContainerLowest)
      .then(Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape))
      .hoverable(interaction)
      .pointerInput(Unit) {
        // A touch anywhere on the card starts its wait again, so the meter being read does not move away.
        awaitPointerEventScope {
          while (true) {
            val event = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
            if (event.type == androidx.compose.ui.input.pointer.PointerEventType.Press) touches++
          }
        }
      }
      .combinedClickable(interactionSource = interaction, indication = androidx.compose.material3.ripple(), onClick = onOpenUsage, onLongClick = onHide)
      .padding(if (m.compact) 10.dp else 12.dp)
      .testTag("plan-card")
      .semantics(mergeDescendants = true) {
        contentDescription = "${shown.label}, ${shown.figures}. $detail"
        customActions = listOfNotNull(
          onUpgrade?.let { androidx.compose.ui.semantics.CustomAccessibilityAction("Upgrade") { it(); true } },
          androidx.compose.ui.semantics.CustomAccessibilityAction("Open usage") { onOpenUsage(); true },
          androidx.compose.ui.semantics.CustomAccessibilityAction("Next meter") { index = (index + 1) % meters.size; true }.takeIf { meters.size > 1 },
          androidx.compose.ui.semantics.CustomAccessibilityAction("Hide") { onHide(); true },
        )
      },
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text(detail, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
    androidx.compose.animation.AnimatedContent(
      shown,
      transitionSpec = { androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(400)) togetherWith androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(400)) },
      contentKey = { it.key },
      label = "plan-meter",
    ) { meter ->
      // Figma 98:1048 (216:1660–216:1921): the meter's name with Upgrade in the accent, its 6 bar, then its figures with the
      // page dots at the trailing edge.
      Column(Modifier.fillMaxWidth().testTag("plan-card-meter-${meter.key}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(meter.label, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
          if (onUpgrade != null) {
            Text(
              "Upgrade", fontSize = 13.sp, lineHeight = 18.sp, color = aglynAccentText, maxLines = 1,
              modifier = Modifier.clickable(onClick = onUpgrade).testTag("plan-card-upgrade"),
            )
          }
        }
        // The console's meter: the accent below the warning share, the warning amber from it, danger at the limit.
        val fill = when {
          meter.share >= 1f -> MaterialTheme.colorScheme.error
          meter.share >= warningShare -> palette.warning.main
          else -> MaterialTheme.colorScheme.primary
        }
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant)) {
          Box(Modifier.fillMaxWidth(meter.share.coerceIn(0f, 1f)).fillMaxSize().background(fill))
        }
      }
    }
    // The figures never truncate: the dots sit beside them when both fit, and take their own row under them when not (with
    // seven to nine meters), as Apple's card does. The widest meter's figures decide, so the layout holds as it advances.
    BoxWithConstraints(Modifier.fillMaxWidth()) {
      val measurer = androidx.compose.ui.text.rememberTextMeasurer()
      val figureStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
      val density = androidx.compose.ui.platform.LocalDensity.current
      val widest = with(density) { meters.maxOf { measurer.measure(it.figures, figureStyle).size.width }.toDp() }
      val dotsWidth = 12.dp * meters.size + 4.dp * (meters.size - 1).coerceAtLeast(0)
      val beside = meters.size <= 1 || widest + 8.dp + dotsWidth <= maxWidth
      val figures: @Composable () -> Unit = {
        Text(shown.figures, style = figureStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, softWrap = false, modifier = Modifier.testTag("plan-card-figures"))
      }
      val dots: @Composable () -> Unit = {
        // A 6 dot in a 12 cell, 4 apart: the meter in front in the accent, the rest the subtle border's grey.
        Row(Modifier.testTag("plan-card-dots"), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          meters.forEachIndexed { i, meter ->
            Box(Modifier.size(12.dp).clip(CircleShape).clickable { index = i }.testTag("plan-card-dot-${meter.key}"), contentAlignment = Alignment.Center) {
              Box(Modifier.size(6.dp).clip(CircleShape).background(if (i == index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant))
            }
          }
        }
      }
      if (beside) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          figures()
          Spacer(Modifier.weight(1f))
          if (meters.size > 1) dots()
        }
      } else {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
          Box(Modifier.fillMaxWidth()) { figures() }
          dots()
        }
      }
    }
  }
}
