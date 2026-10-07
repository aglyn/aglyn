package com.aglyn.contracts

import kotlinx.serialization.json.Json

/** The JSON settings every contract decode uses: unknown keys are a newer server, never a failure. */
val ContractJsonFormat: Json = Json {
  ignoreUnknownKeys = true
  explicitNulls = false
  coerceInputValues = true
}

/** The values in contracts.generated.json (list declarations, label maps), decoded once. */
val Contracts: ContractValues by lazy { ContractJsonFormat.decodeFromString(ContractValues.serializer(), ContractJson.contracts) }

/** The raw notification catalog (libs/native/contracts/notification-catalog.generated.json). */
val NotificationCatalogJson: String get() = ContractJson.notificationCatalog
