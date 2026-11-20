package com.aglyn.site

/**
 * The button of an upgrade notice that opens the plans screen, or null where this build may not start a payment to
 * Aglyn ([com.aglyn.core.StoreBilling.buying] is false in a store build): the notice keeps its sentence and shows no
 * button.
 */
fun planUpgradeAction(buying: Boolean = com.aglyn.core.StoreBilling.buying, open: () -> Unit): (() -> Unit)? =
  if (buying) open else null
