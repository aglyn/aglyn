package com.aglyn.core

/** Small per-install settings: SharedPreferences on Android, java.util.prefs on desktop. */
interface KeyValueStore {
  fun get(key: String): String?
  fun set(key: String, value: String?)
}

class InMemoryKeyValueStore : KeyValueStore {
  private val values = mutableMapOf<String, String>()
  override fun get(key: String): String? = values[key]
  override fun set(key: String, value: String?) {
    if (value == null) values.remove(key) else values[key] = value
  }
}
