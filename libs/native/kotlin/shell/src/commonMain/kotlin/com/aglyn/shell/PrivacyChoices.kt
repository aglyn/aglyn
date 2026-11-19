// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.core.KeyValueStore
import com.aglyn.core.PrivacyChoices
import com.aglyn.ui.sheetEntrance

/** The menu row's icon: the console draws a settings mark beside these words. */
internal const val PRIVACY_CHOICES_ICON = "back_hand"

/**
 * "Your Privacy Choices" (Console chrome row 3; the owner's decision of 2026-11-19): the console's panel of the same title,
 * as one switch for this app's analytics, kept on this device ([store]) and applied the moment it moves
 * ([PrivacyChoices]). Every word is the contracts' (`privacy-choices.ts`), so the title stays the regulated one.
 */
@Composable
internal fun PrivacyChoicesDialog(store: KeyValueStore, onDone: () -> Unit) {
  var analytics by remember { mutableStateOf(PrivacyChoices.analyticsAllowed(store)) }
  AlertDialog(
    onDismissRequest = onDone,
    modifier = Modifier.sheetEntrance(com.aglyn.ui.SheetEntrance.GROW).testTag("privacy-choices-dialog"),
    title = { Text(Contracts.consentOptOutTitle) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
          "${Contracts.nativePrivacyChoicesIntro} ${Contracts.nativePrivacyChoicesStrictlyNecessary}",
          style = MaterialTheme.typography.bodyMedium,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Column(Modifier.weight(1f)) {
            Text(Contracts.nativePrivacyChoicesAnalyticsLabel, style = MaterialTheme.typography.bodyMedium)
            Text(
              Contracts.nativePrivacyChoicesAnalyticsDetail,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          Switch(
            checked = analytics,
            onCheckedChange = { allowed ->
              analytics = allowed
              PrivacyChoices.setAnalytics(store, allowed)
            },
            modifier = Modifier.testTag("privacy-choices-analytics"),
          )
        }
      }
    },
    confirmButton = { TextButton(onClick = onDone, modifier = Modifier.testTag("privacy-choices-done")) { Text("Done") } },
  )
}
