package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * The fast name bubble of a column of look-alike targets, the workspace rail's tiles, whose one or two letters alone do
 * not say which workspace is which: the platform tooltip waits too long and sits on top of the next tile. Hovering a target shows its full name beside it after [delayMillis]; moving on to the next target while
 * one shows (or within [graceMillis] of it hiding) shows the next name at once, so the bubble follows the pointer down
 * the column without waiting again. A press hides it. Touch screens never hover: there a long press opens the target's
 * menu, which carries the same name as its header.
 */
@Stable
class FastTooltipState internal constructor(
  private val scope: CoroutineScope,
  private val delayMillis: Long,
  private val graceMillis: Long,
) {
  /** What the bubble says and the target it sits beside (in window coordinates), or null while none shows. */
  var shown by mutableStateOf<Shown?>(null)
    private set
  private var warm = false

  /** The column's trailing edge (window coordinates), set by [fastTooltipEdge]: the bubble sits clear of it. */
  internal var edge by mutableStateOf<Float?>(null)
  private var job: Job? = null

  data class Shown(val label: String, val hint: String?, val target: Rect)

  internal fun enter(label: String, hint: String?, target: Rect) {
    job?.cancel()
    if (shown != null || warm) {
      shown = Shown(label, hint, target)
    } else {
      job = scope.launch {
        delay(delayMillis)
        shown = Shown(label, hint, target)
      }
    }
  }

  internal fun exit(label: String) {
    job?.cancel()
    val wasShown = shown != null
    if (shown?.label == label) shown = null
    if (wasShown) {
      warm = true
      job = scope.launch {
        delay(graceMillis)
        warm = false
      }
    }
  }

  internal fun dismiss() {
    job?.cancel()
    shown = null
    warm = false
  }
}

/** Marks the column whose edge the bubble keeps clear of (the rail), so it never overlaps the column's ground. */
fun Modifier.fastTooltipEdge(state: FastTooltipState): Modifier = onGloballyPositioned { state.edge = it.boundsInWindow().right }

/** The rail's bubble timing: 150 ms before the first name, none while the pointer moves on within 300 ms. */
@Composable
fun rememberFastTooltipState(delayMillis: Long = 150, graceMillis: Long = 300): FastTooltipState {
  val scope = rememberCoroutineScope()
  return remember(scope) { FastTooltipState(scope, delayMillis, graceMillis) }
}

/** This target's [label] (and an optional [hint], such as its shortcut) in [state]'s bubble while the pointer is on it. */
fun Modifier.fastTooltip(state: FastTooltipState, label: String, hint: String? = null): Modifier {
  var bounds = Rect.Zero
  return this
    .onGloballyPositioned { bounds = it.boundsInWindow() }
    .pointerInput(state, label, hint) {
      awaitPointerEventScope {
        while (true) {
          val event = awaitPointerEvent()
          when (event.type) {
            PointerEventType.Enter -> state.enter(label, hint, bounds)
            PointerEventType.Exit -> state.exit(label)
            PointerEventType.Press -> state.dismiss()
            else -> Unit
          }
        }
      }
    }
}

/**
 * Draws [state]'s bubble: the name in a small label to the right of its target, centered on it, 8 dp clear of the
 * column's edge ([fastTooltipEdge]; of the target itself without one). Inverse colors (the theme's primary text as the ground) so it reads on any rail.
 */
@Composable
fun FastTooltipHost(state: FastTooltipState) {
  val shown = state.shown ?: return
  val m = LocalShellMetrics.current
  val gap = with(LocalDensity.current) { 8.dp.roundToPx() }
  val edge = maxOf(shown.target.right, state.edge ?: shown.target.right)
  val provider = remember(shown.target, edge, gap) {
    object : PopupPositionProvider {
      override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
        val x = edge.roundToInt() + gap
        val y = (shown.target.center.y - popupContentSize.height / 2f).roundToInt()
        return IntOffset(x, y.coerceIn(0, (windowSize.height - popupContentSize.height).coerceAtLeast(0)))
      }
    }
  }
  Popup(popupPositionProvider = provider, properties = PopupProperties(focusable = false)) {
    Row(
      Modifier
        .clip(RoundedCornerShape(if (m.compact) 6.dp else 8.dp))
        .background(MaterialTheme.colorScheme.inverseSurface)
        .testTag("fast-tooltip")
        .padding(horizontal = if (m.compact) 8.dp else 10.dp, vertical = if (m.compact) 4.dp else 6.dp),
    ) {
      Text(
        shown.label,
        color = MaterialTheme.colorScheme.inverseOnSurface,
        fontSize = if (m.compact) 12.sp else 14.sp,
        lineHeight = if (m.compact) 16.sp else 20.sp,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        modifier = Modifier.testTag("fast-tooltip-label"),
      )
      shown.hint?.let { hint ->
        Text(
          "  $hint",
          color = MaterialTheme.colorScheme.inverseOnSurface.copy(alpha = 0.7f),
          fontSize = if (m.compact) 12.sp else 14.sp,
          lineHeight = if (m.compact) 16.sp else 20.sp,
          maxLines = 1,
        )
      }
    }
  }
}
