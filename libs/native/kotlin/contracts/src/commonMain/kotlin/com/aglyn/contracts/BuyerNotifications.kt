package com.aglyn.contracts

/**
 * Whether a buyer moment (or the `texts` channel) is on in a store's
 * `buyerNotifications` map, ported from `buyerNotificationEnabled`: ONLY an
 * explicit `false` is off. An absent map, an absent key and a malformed value
 * all read as on, so a schema slip can never silence a store's messages.
 */
fun buyerNotificationEnabled(settings: Any?, key: String): Boolean {
  if (settings !is Map<*, *>) return true
  return settings[key] != false
}
