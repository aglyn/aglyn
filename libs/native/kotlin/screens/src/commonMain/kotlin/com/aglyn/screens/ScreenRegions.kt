package com.aglyn.screens

/**
 * The countries a `country` field offers: the platform's own region list, named in the person's language, as the console builds its
 * picker from the browser's (`utils/country-options.ts`). A code is the two letters Stripe and Stripe Tax expect; Stripe stays the validator.
 */
internal expect fun platformRegions(): List<Pair<String, String>>

/** Two-letter codes the platform names that are not countries a customer is billed in. Degrade-safe like the console's. */
internal val NOT_COUNTRIES = setOf("EU", "EZ", "UN", "QO", "XA", "XB", "ZZ")

/** Every region the platform can name, as `(code, name)`, by name in the locale's order. */
internal fun isoRegions(): List<Pair<String, String>> = platformRegions().filter { (code, name) ->
  code.length == 2 && code.all { it in 'A'..'Z' } && code !in NOT_COUNTRIES && name.isNotBlank() && name != code
}
