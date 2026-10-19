package com.aglyn.shell

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.view.View
import androidx.core.animation.doOnEnd
import androidx.core.splashscreen.SplashScreen
import android.view.animation.PathInterpolator
import com.aglyn.core.AuthState
import com.aglyn.ui.AuthTokens

/**
 * The launch splash's hand-over (Figma "Android / Splash", spec 53:1638): the splash (the ground color and the mark drawing
 * in, 800 ms on Android 12+) stays up until the auth state is known, never on a fixed wait, then exits in 300 ms: the icon
 * scales 1 → 0.9 and fades while the splash slides up 120 dp and fades, onto the sign-in screen or the shell.
 */
fun SplashScreen.handOver(services: ShellServices) {
  setKeepOnScreenCondition { services.auth.state.value is AuthState.Restoring }
  setOnExitAnimationListener { splash ->
    val intro = AuthTokens.Intro
    val view = splash.view
    val icon: View? = runCatching { splash.iconView }.getOrNull()
    val slide = intro.ANDROID_EXIT_SLIDE * view.resources.displayMetrics.density
    val parts = mutableListOf(
      ObjectAnimator.ofFloat(view, View.TRANSLATION_Y, 0f, -slide),
      ObjectAnimator.ofFloat(view, View.ALPHA, 1f, 0f),
    )
    if (icon != null) {
      parts += ObjectAnimator.ofFloat(icon, View.SCALE_X, 1f, intro.ANDROID_EXIT_ICON_SCALE)
      parts += ObjectAnimator.ofFloat(icon, View.SCALE_Y, 1f, intro.ANDROID_EXIT_ICON_SCALE)
      parts += ObjectAnimator.ofFloat(icon, View.ALPHA, 1f, 0f)
    }
    AnimatorSet().apply {
      playTogether(parts.toList())
      duration = intro.ANDROID_EXIT_MS.toLong()
      // FastOutSlowIn.
      interpolator = PathInterpolator(0.4f, 0f, 0.2f, 1f)
      doOnEnd { splash.remove() }
      start()
    }
  }
}

/**
 * P14 (Zach 10/19: "the splash logo animation to lockup flashes a lot and doesn't flow"): a first launch hands the splash to
 * the Compose launch intro, whose frame 1 is the splash's own picture (its ground, its mark at the same size and place). So
 * nothing waits on the splash: the app's first frame takes over at once and the intro moves on from there (the wordmark wipes
 * in, the lockup holds until the auth state is known, the destination rises in). The splash is removed once its icon has drawn
 * in, with no exit motion of its own, and then [onGone] lets the intro start. A warm start (the intro already played) keeps
 * [handOver].
 */
fun SplashScreen.handOverToIntro(onGone: () -> Unit) {
  setOnExitAnimationListener { splash ->
    val iconEnds = runCatching { splash.iconAnimationStartMillis + splash.iconAnimationDurationMillis }.getOrDefault(0L)
    val wait = (iconEnds - android.os.SystemClock.uptimeMillis()).coerceIn(0L, AuthTokens.Intro.ANDROID_ICON_MS.toLong())
    // The main looper, not the splash view's own queue: a view that is never attached (a slow hand-over) never runs it.
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
      runCatching { splash.remove() }
      onGone()
    }, wait)
  }
}

/**
 * How long after the app's first frame the launch intro waits for the splash before it moves anyway. When the system cannot
 * hand its splash over in time (a busy first launch), it removes the splash itself and never calls the exit listener, so the
 * intro must not wait on that call alone.
 */
const val SPLASH_HAND_OVER_LIMIT_MS = 1_200L
