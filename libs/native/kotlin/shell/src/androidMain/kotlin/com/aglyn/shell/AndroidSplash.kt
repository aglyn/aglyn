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
