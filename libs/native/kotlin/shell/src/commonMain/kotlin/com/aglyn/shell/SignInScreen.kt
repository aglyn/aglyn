package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.aglyn.core.AuthError
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.AglynLogo
import com.aglyn.ui.space
import kotlinx.coroutines.launch

@Composable
fun SignInScreen(services: ShellServices, autoSignIn: Boolean = false) {
  var email by remember { mutableStateOf(services.debugSignIn?.first ?: "") }
  var password by remember { mutableStateOf(services.debugSignIn?.second ?: "") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val brand = services.config.brandName
  val title = if (services.app == NativeApp.POS) "$brand POS" else brand

  fun submit() {
    if (busy) return
    if (email.isBlank() || password.isEmpty()) {
      error = "Enter your email and password."
      return
    }
    busy = true
    error = null
    scope.launch {
      try {
        services.auth.signInWithEmail(email, password)
      } catch (failure: AuthError) {
        error = failure.message
      } finally {
        busy = false
      }
    }
  }

  LaunchedEffect(Unit) {
    if (autoSignIn && services.debugSignIn != null) submit()
  }

  Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
    Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
      Surface(
        Modifier.padding(space(2f)).widthIn(max = 440.dp).fillMaxWidth(),
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        shadowElevation = 2.dp,
      ) {
        Column(Modifier.padding(space(3f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
          AglynLogo(Modifier.height(36.dp), contentDescription = title)
          Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Sign in to $title", style = MaterialTheme.typography.headlineSmall)
            Text(
              if (services.app == NativeApp.POS) "Take payments at your store's register." else "Manage your sites, orders and team.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("sign-in-email"),
          )
          OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            modifier = Modifier.fillMaxWidth().testTag("sign-in-password"),
          )
          if (error != null) {
            Text(
              error!!,
              color = MaterialTheme.colorScheme.error,
              style = MaterialTheme.typography.bodyMedium,
              modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("sign-in-error"),
            )
          }
          Button(
            onClick = { submit() },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("sign-in-submit"),
          ) {
            if (busy) {
              CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            } else {
              Text("Sign in")
            }
          }
        }
      }
    }
  }
}
