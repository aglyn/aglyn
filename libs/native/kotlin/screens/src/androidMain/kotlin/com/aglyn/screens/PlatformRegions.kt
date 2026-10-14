package com.aglyn.screens

import java.text.Collator
import java.util.Locale

internal actual fun platformRegions(): List<Pair<String, String>> {
  val locale = Locale.getDefault()
  val collator = Collator.getInstance(locale)
  return Locale.getISOCountries().map { code -> code to Locale.Builder().setRegion(code).build().getDisplayCountry(locale) }
    .sortedWith { a, b -> collator.compare(a.second, b.second) }
}
