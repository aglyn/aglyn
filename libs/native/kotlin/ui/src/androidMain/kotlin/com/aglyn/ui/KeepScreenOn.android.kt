package com.aglyn.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView

@Composable
actual fun KeepScreenOn(enabled: Boolean) {
  val view = LocalView.current
  DisposableEffect(view, enabled) {
    // Whatever the view held before (another screen may already have asked) is put back when this one leaves.
    val before = view.keepScreenOn
    if (enabled) view.keepScreenOn = true
    onDispose { view.keepScreenOn = before }
  }
}
