package com.aglyn.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.ui.resources.Res
import com.aglyn.ui.resources.google_g
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.painterResource

/** One sign-in theme color, light and dark, as ARGB (AuthTheme.generated.kt). */
data class AuthColor(val light: Long, val dark: Long) {
  /** The color for the theme in effect. */
  val current: Color
    @Composable get() = Color(if (LocalAglynDark.current) dark else light)

  fun resolved(dark: Boolean) = Color(if (dark) this.dark else this.light)
}

/** How strong each Facets layer is in one appearance. */
data class FacetsOpacity(val softLight: Float, val top: Float, val band: Float, val corner: Float, val accent: Float)

/** Whether the theme in effect is dark (AglynTheme provides it). */
val LocalAglynDark = staticCompositionLocalOf { false }

/** The sign-in screens' type steps (Figma text styles), in the bundled Roboto Flex. */
object AuthType {
  @Composable private fun face(size: Int, line: Int, weight: FontWeight) =
    TextStyle(fontFamily = aglynFontFamily(), fontSize = size.sp, lineHeight = line.sp, fontWeight = weight)

  /** Phone/Title, 28/34 bold. */
  val title @Composable get() = face(28, 34, FontWeight.Bold)
  /** Body/Regular, 14/20. */
  val body @Composable get() = face(14, 20, FontWeight.Normal)
  /** Phone/Body, 17/22: a field's value. */
  val value @Composable get() = face(17, 22, FontWeight.Normal)
  /** Phone/Headline, 17/22 semibold: a large button's label. */
  val headline @Composable get() = face(17, 22, FontWeight.SemiBold)
  /** Body/Strong, 14/20 semibold: a medium button's label. */
  val strong @Composable get() = face(14, 20, FontWeight.SemiBold)
  /** Body/Small, 13/18. */
  val small @Composable get() = face(13, 18, FontWeight.Normal)
  /** Body/Small Strong, 13/18 semibold: labels and links. */
  val smallStrong @Composable get() = face(13, 18, FontWeight.SemiBold)
  /** Caption/Regular, 12/16: field messages and the legal line. */
  val caption @Composable get() = face(12, 16, FontWeight.Normal)
  /** Roboto Medium 15/20: Google's button label (Google Identity branding). */
  val google @Composable get() = face(15, 20, FontWeight.Medium)
}

private val C = AuthTokens.Colors
private val M = AuthTokens.Metrics

/**
 * The Facets ground's geometry on a canvas (Figma "Auth/Background", Style=Facets; tools/scripts/lib/native-auth-theme.mjs
 * holds the same rules for the iOS launch art): a soft light at the top and four planes cut at the mark's own angles.
 * [settle] runs from 0 (the intro's first frame: each plane a step out from rest, a little fainter) to 1 (rest).
 */
class FacetsLayout(size: Size, dark: Boolean, settle: Float = 1f) {
  class Plane(val name: String, val points: List<Offset>, val opacity: Float)

  val planes: List<Plane>
  val softLight: Rect
  val softLightBlur: Float
  val softLightOpacity: Float

  init {
    val f = AuthTokens.Facets
    val width = size.width
    val height = size.height
    val short = min(width, height)
    val pen = tan(f.PEN_DEGREES * PI / 180).toFloat()
    val complement = tan(f.COMPLEMENT_DEGREES * PI / 180).toFloat()
    val strength = if (dark) f.DARK_OPACITY else f.LIGHT_OPACITY
    val bandRise = (f.BAND_RIGHT_X - f.BAND_LEFT_X) * width * pen
    val bandTop = f.BAND_START_Y * height
    val accentThickness = f.ACCENT_THICKNESS * short
    val accentTop = height - (1 - f.ACCENT_START_X) * width * pen
    val rest = listOf(
      Triple("top", listOf(Offset(f.TOP_START_X * width, 0f), Offset(width, 0f), Offset(width, (1 - f.TOP_START_X) * width * complement)), strength.top),
      Triple(
        "band",
        listOf(
          Offset(f.BAND_LEFT_X * width, bandTop), Offset(f.BAND_RIGHT_X * width, bandTop - bandRise),
          Offset(f.BAND_RIGHT_X * width, bandTop - bandRise + f.BAND_THICKNESS * height), Offset(f.BAND_LEFT_X * width, bandTop + f.BAND_THICKNESS * height),
        ),
        strength.band,
      ),
      Triple(
        "corner",
        listOf(Offset(f.CORNER_START_X * width, height), Offset(width, height - (1 - f.CORNER_START_X) * width * pen), Offset(width, height)),
        strength.corner,
      ),
      Triple(
        "accent",
        listOf(
          Offset(f.ACCENT_START_X * width, height), Offset(width, accentTop), Offset(width, accentTop + accentThickness),
          Offset(f.ACCENT_START_X * width + accentThickness / pen, height),
        ),
        strength.accent,
      ),
    )
    val center = Offset(width / 2, height / 2)
    val out = f.SETTLE_DISTANCE * (1 - settle)
    planes = rest.map { (name, points, opacity) ->
      val mid = Offset(points.sumOf { it.x.toDouble() }.toFloat() / points.size, points.sumOf { it.y.toDouble() }.toFloat() / points.size)
      val length = max(hypot(mid.x - center.x, mid.y - center.y), 1f)
      val shift = Offset((mid.x - center.x) / length * out, (mid.y - center.y) / length * out)
      Plane(name, points.map { it + shift }, opacity * (f.SETTLE_OPACITY + (1 - f.SETTLE_OPACITY) * settle))
    }
    softLight = Rect(Offset(f.SOFT_LIGHT_X * width, f.SOFT_LIGHT_Y * height), Size(f.SOFT_LIGHT_WIDTH * width, f.SOFT_LIGHT_HEIGHT * height))
    softLightBlur = f.SOFT_LIGHT_BLUR * short
    softLightOpacity = strength.softLight
  }

  companion object {
    /**
     * The brand gradient's line across a box: in the box's unit square it runs toward the last stop along (sin, cos) of the
     * gradient's angle, y down, centered on the box (as the Figma boards draw it).
     */
    fun gradientLine(box: Rect): Pair<Offset, Offset> {
      val angle = AuthTokens.GRADIENT_DEGREES * PI / 180
      val gx = sin(angle).toFloat() / max(box.width, 1f)
      val gy = cos(angle).toFloat() / max(box.height, 1f)
      val g2 = gx * gx + gy * gy
      val d = Offset(gx / g2, gy / g2)
      return (box.center - d / 2f) to (box.center + d / 2f)
    }
  }
}

/**
 * The Facets ground behind the sign-in screens and the intro. [settle] 0 is the launch frame and 1 rest; [light] is the soft
 * light's share of its strength, which the intro breathes while it waits. The soft light's blur is drawn as a radial falloff,
 * which every Android version and the desktop draw the same.
 */
@Composable
fun FacetsBackground(modifier: Modifier = Modifier, settle: Float = 1f, light: Float = 1f) {
  val dark = LocalAglynDark.current
  val stops = remember { AuthTokens.GRADIENT_STOPS.map { (argb, at) -> at to Color(argb) }.toTypedArray() }
  Canvas(modifier) {
    drawRect(C.canvas.resolved(dark))
    val layout = FacetsLayout(size, dark, settle)
    val glow = C.softLight.resolved(dark)
    val spot = layout.softLight
    // The blur widens the ellipse by about its radius; the falloff spans that band.
    val grow = layout.softLightBlur / 2
    val outer = Rect(spot.left - grow, spot.top - grow, spot.right + grow, spot.bottom + grow)
    val edge = (min(spot.width, spot.height) / 2) / (min(outer.width, outer.height) / 2)
    val alpha = layout.softLightOpacity * light
    scaleOuter(outer) {
      drawCircle(
        Brush.radialGradient(
          0f to glow.copy(alpha = alpha),
          (edge - (1 - edge)).coerceAtLeast(0f) to glow.copy(alpha = alpha * 0.92f),
          edge to glow.copy(alpha = alpha * 0.5f),
          1f to glow.copy(alpha = 0f),
          center = Offset(0.5f, 0.5f), radius = 0.5f,
        ),
        radius = 0.5f, center = Offset(0.5f, 0.5f),
      )
    }
    for (plane in layout.planes) {
      val path = Path().apply {
        moveTo(plane.points[0].x, plane.points[0].y)
        plane.points.drop(1).forEach { lineTo(it.x, it.y) }
        close()
      }
      val (start, end) = FacetsLayout.gradientLine(path.getBounds())
      drawPath(path, Brush.linearGradient(*stops, start = start, end = end), alpha = plane.opacity)
    }
  }
}

/** Draws [block] in a unit square stretched over [rect], so a circle becomes the rect's ellipse. */
private inline fun DrawScope.scaleOuter(rect: Rect, crossinline block: DrawScope.() -> Unit) {
  withTransform({
    translate(rect.left, rect.top)
    scale(rect.width, rect.height, Offset.Zero)
  }) { block() }
}

/** The button system's kinds (Figma "Button" 8:486). */
enum class AuthButtonKind { PRIMARY, SECONDARY, TERTIARY, DESTRUCTIVE }

/** The button system's sizes: sign-in screens use LARGE (48 dp, rounded 12). */
enum class AuthButtonSize(val height: Int, val radius: Int, val padding: Int, val gap: Int, val icon: Int) {
  LARGE(48, 12, 20, 10, 20),
  MEDIUM(36, 8, 14, 8, 16),
  SMALL(28, 8, 10, 6, 14),
}

/**
 * A button in the system: the kind's fill with its hover and pressed fills, the secondary's hairline, 40% when disabled. Busy,
 * a spinner the icon's size takes the icon's place and the label stays, so the button keeps its width.
 */
@Composable
fun AuthButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  kind: AuthButtonKind = AuthButtonKind.PRIMARY,
  size: AuthButtonSize = AuthButtonSize.LARGE,
  icon: ImageVector? = null,
  busy: Boolean = false,
  enabled: Boolean = true,
  fullWidth: Boolean = true,
) {
  val interaction = remember { MutableInteractionSource() }
  val pressed by interaction.collectIsPressedAsState()
  val hovered by interaction.collectIsHoveredAsState()
  val fill = when (kind) {
    AuthButtonKind.PRIMARY -> (if (pressed) C.primaryPressed else if (hovered) C.primaryHover else C.primary).current
    AuthButtonKind.SECONDARY -> (if (pressed) C.secondaryPressed else if (hovered) C.secondaryHover else C.secondaryFill).current
    AuthButtonKind.TERTIARY -> if (pressed) C.sunken.current else if (hovered) C.hover.current else Color.Transparent
    AuthButtonKind.DESTRUCTIVE -> (if (pressed) C.destructivePressed else if (hovered) C.destructiveHover else C.destructive).current
  }
  val ink = if (kind == AuthButtonKind.PRIMARY || kind == AuthButtonKind.DESTRUCTIVE) C.onPrimary.current else C.textPrimary.current
  // The desktop takes the Compact density: every button size rounds to 6 (Figma Button, Density = Compact).
  val shape = RoundedCornerShape(if (LocalShellMetrics.current.compact) LocalShellMetrics.current.controlRadius else size.radius.dp)
  Surface(
    onClick = onClick,
    enabled = enabled && !busy,
    shape = shape,
    color = fill,
    contentColor = ink,
    border = if (kind == AuthButtonKind.SECONDARY) BorderStroke(1.dp, C.secondaryStroke.current) else null,
    interactionSource = interaction,
    modifier = modifier
      .then(if (fullWidth) Modifier.fillMaxWidth() else Modifier)
      .heightIn(min = size.height.dp)
      .alpha(if (enabled) 1f else M.DISABLED_OPACITY),
  ) {
    Row(
      Modifier.padding(horizontal = size.padding.dp),
      horizontalArrangement = Arrangement.spacedBy(size.gap.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (busy) {
        CircularProgressIndicator(Modifier.size(size.icon.dp), color = ink, strokeWidth = 2.dp)
      } else if (icon != null) {
        Icon(icon, contentDescription = null, Modifier.size(size.icon.dp), tint = ink)
      }
      Text(
        text,
        style = when (size) {
          AuthButtonSize.LARGE -> AuthType.headline
          AuthButtonSize.MEDIUM -> AuthType.strong
          AuthButtonSize.SMALL -> AuthType.smallStrong
        },
        color = ink,
        textAlign = TextAlign.Center,
        maxLines = 2,
      )
    }
  }
}

/**
 * "Continue with Google" as Google's branding guidelines draw it: the official four-color G (never recolored), Roboto Medium,
 * Google's light button on a light ground and its dark one on a dark ground, at the provider buttons' height, radius and
 * padding.
 */
@Composable
fun GoogleButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
  val shape = RoundedCornerShape(if (LocalShellMetrics.current.compact) LocalShellMetrics.current.controlRadius else M.BUTTON_RADIUS.dp)
  Surface(
    onClick = onClick,
    enabled = enabled,
    shape = shape,
    color = C.googleFill.current,
    contentColor = C.googleText.current,
    border = BorderStroke(1.dp, C.googleStroke.current),
    modifier = modifier.fillMaxWidth().heightIn(min = M.BUTTON_HEIGHT.dp).alpha(if (enabled) 1f else M.DISABLED_OPACITY),
  ) {
    Row(
      Modifier.padding(horizontal = M.PROVIDER_PADDING.dp),
      horizontalArrangement = Arrangement.spacedBy(M.BUTTON_ICON_GAP.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Image(painterResource(Res.drawable.google_g), contentDescription = null, Modifier.size(M.GOOGLE_GLYPH.dp))
      Text(text, style = AuthType.google, color = C.googleText.current, maxLines = 1)
    }
  }
}

/** The "or" between a form's own action and the provider buttons. */
@Composable
fun OrDivider(text: String = "or", modifier: Modifier = Modifier) {
  Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    HorizontalDivider(Modifier.weight(1f), color = C.borderSubtle.current)
    Text(text, style = AuthType.small, color = C.textTertiary.current)
    HorizontalDivider(Modifier.weight(1f), color = C.borderSubtle.current)
  }
}

/**
 * The line under a field (Figma "Field/Text" 28:791): an error with its icon, or a helper in the secondary color. It takes the
 * field's width and wraps to as many lines as it needs; never truncated.
 */
@Composable
fun FieldMessage(text: String, isError: Boolean, modifier: Modifier = Modifier) {
  val ink = (if (isError) C.dangerForeground else C.textSecondary).current
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    if (isError) {
      Box(Modifier.size(M.FIELD_MESSAGE_ICON.dp, 16.dp), contentAlignment = Alignment.TopCenter) {
        Icon(Icons.Outlined.WarningAmber, contentDescription = null, Modifier.padding(top = 1.dp).size(M.FIELD_MESSAGE_ICON.dp), tint = ink)
      }
    }
    Text(text, style = AuthType.caption, color = ink, modifier = Modifier.weight(1f))
  }
}

/**
 * A sign-in field: its label above, the 48 dp input on the surface fill with the strong border, a 2 dp accent ring while
 * focused and the danger border on an error, and its message under it.
 */
@Composable
fun AuthInput(
  label: String,
  value: String,
  onValueChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String? = null,
  error: String? = null,
  supporting: String? = null,
  password: Boolean = false,
  keyboardType: KeyboardType = KeyboardType.Text,
  imeAction: ImeAction = ImeAction.Next,
  onSubmit: (() -> Unit)? = null,
  fieldModifier: Modifier = Modifier,
  messageModifier: Modifier = Modifier,
) {
  val interaction = remember { MutableInteractionSource() }
  val focused by interaction.collectIsFocusedAsState()
  val shape = RoundedCornerShape(if (LocalShellMetrics.current.compact) LocalShellMetrics.current.controlRadius else M.FIELD_RADIUS.dp)
  val ink = C.textPrimary.current
  Column(modifier, verticalArrangement = Arrangement.spacedBy(M.FIELD_LABEL_GAP.dp)) {
    Text(label, style = AuthType.smallStrong, color = ink)
    BasicTextField(
      value = value,
      onValueChange = onValueChange,
      singleLine = true,
      textStyle = AuthType.value.copy(color = ink),
      cursorBrush = SolidColor(C.focusRing.current),
      visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
      keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
      keyboardActions = KeyboardActions(onDone = { onSubmit?.invoke() }, onGo = { onSubmit?.invoke() }),
      interactionSource = interaction,
      modifier = fieldModifier
        .fillMaxWidth()
        .heightIn(min = M.FIELD_HEIGHT.dp)
        .background(C.surface.current, shape)
        .border(
          if (focused) M.FOCUS_RING_WIDTH.dp else 1.dp,
          when {
            focused -> C.focusRing.current
            error != null -> C.dangerForeground.current
            else -> C.borderStrong.current
          },
          shape,
        )
        .semantics { contentDescription = label },
      decorationBox = { inner ->
        Box(Modifier.padding(horizontal = M.FIELD_PADDING.dp), contentAlignment = Alignment.CenterStart) {
          if (value.isEmpty() && placeholder != null) Text(placeholder, style = AuthType.value, color = C.textTertiary.current)
          inner()
        }
      },
    )
    val message = error ?: supporting
    if (message != null) FieldMessage(message, isError = error != null, modifier = messageModifier)
  }
}

/** A notice inside the auth card (signups paused, where single sign-on will take you): an icon and a sentence on the tone's fill. */
@Composable
fun AuthNotice(text: String, icon: ImageVector, tone: StatusTone, modifier: Modifier = Modifier) {
  val (ink, fill) = when (tone) {
    StatusTone.WARNING -> C.warningForeground to C.warningBackground
    StatusTone.ERROR -> C.dangerForeground to C.dangerBackground
    else -> C.infoForeground to C.infoBackground
  }
  Row(
    modifier.fillMaxWidth().background(fill.current, RoundedCornerShape(M.FIELD_RADIUS.dp)).padding(12.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Icon(icon, contentDescription = null, Modifier.size(18.dp), tint = ink.current)
    Text(text, style = AuthType.small, color = ink.current, modifier = Modifier.weight(1f))
  }
}

/** A text link in the auth screens: Body/Small Strong, underlined, in the primary text color. */
@Composable
fun AuthTextLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val interaction = remember { MutableInteractionSource() }
  Text(
    text,
    style = AuthType.smallStrong.copy(textDecoration = TextDecoration.Underline),
    color = C.textPrimary.current,
    modifier = modifier
      .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
      .padding(vertical = 6.dp),
  )
}

/**
 * The launch intro's clock (Figma "Intro timeline", spec 53:1638), the Compose twin of Apple's `AglynLaunchIntro`: the ground
 * settles (0–240 ms), the mark travels to the lockup's place and cross-fades into the lockup (360–600 ms), and the destination
 * rises in once the app is ready, never on a fixed wait (it holds and breathes until then). Reduce motion (an animator scale
 * of 0) is a 200 ms cross-fade. It plays once per process.
 */
@Stable
class LaunchIntro internal constructor(played: Boolean) {
  var settled by mutableStateOf(played)
    private set
  var markAtLockup by mutableStateOf(played)
    private set
  var lockupVisible by mutableStateOf(played)
    private set
  var waiting by mutableStateOf(false)
    private set
  var revealed by mutableStateOf(played)
    private set
  var finished by mutableStateOf(played)
    private set
  var crossFades by mutableStateOf(false)
    private set

  suspend fun run(reduceMotion: Boolean, isReady: () -> Boolean) {
    if (finished) return
    val t = AuthTokens.Intro
    if (reduceMotion) {
      crossFades = true
      while (!isReady()) delay(16)
      settled = true
      lockupVisible = true
      revealed = true
      delay(t.REDUCE_MOTION_FADE_MS.toLong())
      finished = true
      return
    }
    settled = true
    delay(t.LOCKUP_START_MS.toLong())
    markAtLockup = true
    delay((t.LOCKUP_END_MS - t.CROSS_FADE_MS - t.LOCKUP_START_MS).toLong())
    lockupVisible = true
    delay(t.CROSS_FADE_MS.toLong())
    if (!isReady()) {
      waiting = true
      while (!isReady()) delay(16)
      waiting = false
    }
    revealed = true
    delay(t.DESTINATION_MS.toLong())
    finished = true
  }

  companion object {
    private var played = false

    /** A new intro; every one after the process's first starts finished (a warm start, a second window, a sign-out). */
    fun create(): LaunchIntro = LaunchIntro(played).also { played = true }

    /** An intro already at its end: where the platform's own splash screen plays instead (Android). */
    fun skipped(): LaunchIntro = LaunchIntro(true)
  }
}

/** The settle, soft light, reveal offset and opacity the intro's state animates to, with the spec's curves. */
class LaunchIntroFrame(val settle: Float, val light: Float, val rise: Float, val reveal: Float)

@Composable
fun LaunchIntro.frame(): LaunchIntroFrame {
  val t = AuthTokens.Intro
  val ease = CubicBezierEasing(0.2f, 0f, 0f, 1f)
  val settle by animateFloatAsState(if (settled) 1f else 0f, if (crossFades) tween(0) else tween(t.SETTLE_MS.toInt(), easing = ease))
  val reveal by animateFloatAsState(
    if (revealed) 1f else 0f,
    tween((if (crossFades) t.REDUCE_MOTION_FADE_MS else t.DESTINATION_MS).toInt(), easing = if (crossFades) LinearEasing else FastOutSlowInEasing),
  )
  val breath = remember { Animatable(1f) }
  LaunchedEffect(waiting) {
    if (waiting) {
      breath.animateTo(t.BREATHE_LOW, infiniteRepeatable(tween((t.BREATHE_PERIOD_MS / 2).toInt()), RepeatMode.Reverse))
    } else {
      breath.animateTo(1f, tween(200))
    }
  }
  return LaunchIntroFrame(settle, breath.value, if (crossFades) 0f else (1 - reveal) * t.DESTINATION_RISE, reveal)
}

/** The intro's travelling mark: centered at the launch size, then at the lockup's place, where the lockup cross-fades in. */
@Composable
fun LaunchMark(intro: LaunchIntro, name: String, compact: Boolean, modifier: Modifier = Modifier) {
  val t = AuthTokens.Intro
  val spring = spring<Float>(dampingRatio = t.SPRING_DAMPING, stiffness = springStiffness(t.SPRING_RESPONSE))
  val travel by animateFloatAsState(if (intro.markAtLockup) 1f else 0f, spring)
  val lockup by animateFloatAsState(if (intro.lockupVisible) 1f else 0f, tween((if (intro.crossFades) t.REDUCE_MOTION_FADE_MS else t.CROSS_FADE_MS).toInt()))
  BoxWithConstraints(modifier.semantics { contentDescription = name }) {
    val launch = M.LAUNCH_MARK_COMPACT
    val height = M.LOCKUP_HEIGHT
    val leading = if (compact) M.LOCKUP_LEADING_COMPACT else M.LOCKUP_LEADING_REGULAR
    val top = if (compact) M.LOCKUP_TOP_COMPACT else M.LOCKUP_CLEAR_SPACE
    val size = launch + (height - launch) * travel
    val x = ((maxWidth.value - launch) / 2) * (1 - travel) + leading * travel
    val y = ((maxHeight.value - launch) / 2) * (1 - travel) + top * travel
    AglynMark(
      Modifier.graphicsLayer { translationX = x.dp.toPx(); translationY = y.dp.toPx(); alpha = 1 - lockup }.size(size.dp),
      contentDescription = null,
    )
    AglynLogo(
      Modifier.graphicsLayer { translationX = leading.dp.toPx(); translationY = top.dp.toPx(); alpha = lockup }.height(height.dp),
      contentDescription = null,
    )
  }
}

/** A spring's stiffness from SwiftUI's response (the period of one oscillation, in seconds). */
private fun springStiffness(response: Float): Float = ((2 * PI / response) * (2 * PI / response)).toFloat()

