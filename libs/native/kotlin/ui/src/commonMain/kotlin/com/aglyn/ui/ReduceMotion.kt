package com.aglyn.ui

import androidx.compose.runtime.Composable

/**
 * Whether the person asked the system for less motion: Android's animator duration scale at 0 (Remove animations), macOS's
 * Reduce motion. Moving transitions then become cross-fades of the same length.
 */
@Composable
expect fun reduceMotion(): Boolean
