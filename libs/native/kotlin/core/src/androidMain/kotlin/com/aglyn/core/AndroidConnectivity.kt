package com.aglyn.core

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** The device's default network, as ConnectivityManager reports it: online while it has one with the internet capability. */
class AndroidConnectivity(context: Context) : Connectivity {
  private val manager = context.getSystemService(ConnectivityManager::class.java)
  private val state = MutableStateFlow(currentlyOnline())
  override val online: StateFlow<Boolean> = state

  init {
    manager?.registerDefaultNetworkCallback(
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { state.value = currentlyOnline() }
        override fun onLost(network: Network) { state.value = false }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          state.value = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
      },
    )
  }

  private fun currentlyOnline(): Boolean {
    val network = manager?.activeNetwork ?: return false
    return manager.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
  }
}
