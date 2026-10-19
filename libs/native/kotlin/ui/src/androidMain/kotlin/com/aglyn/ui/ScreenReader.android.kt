package com.aglyn.ui

import android.view.accessibility.AccessibilityManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun screenReaderOn(): Boolean {
  val context = LocalContext.current
  val manager = remember(context) { context.getSystemService(AccessibilityManager::class.java) }
  var on by remember(manager) { mutableStateOf(manager?.isTouchExplorationEnabled == true) }
  DisposableEffect(manager) {
    val listener = AccessibilityManager.TouchExplorationStateChangeListener { on = it }
    manager?.addTouchExplorationStateChangeListener(listener)
    onDispose { manager?.removeTouchExplorationStateChangeListener(listener) }
  }
  return on
}
