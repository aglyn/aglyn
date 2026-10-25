package com.aglyn.core

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.os.Bundle
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics
import com.google.firebase.firestore.FirebaseFirestoreException

/**
 * [Telemetry]'s Firebase end on Android (AGL-4067): Crashlytics for errors, breadcrumbs, the uid and custom keys; Analytics
 * for events. Both SDKs are thread-safe. Only [Telemetry] calls it, and only once collection is on.
 */
class FirebaseTelemetrySink(context: Context) : TelemetrySink {
  private val crashlytics = FirebaseCrashlytics.getInstance()
  private val analytics = FirebaseAnalytics.getInstance(context.applicationContext)

  override fun record(error: Throwable, context: String) {
    crashlytics.setCustomKey("context", context)
    crashlytics.recordException(error)
  }

  override fun breadcrumb(message: String) = crashlytics.log(message)

  override fun setUser(uid: String?) {
    crashlytics.setUserId(uid ?: "")
    analytics.setUserId(uid)
  }

  override fun setValue(key: String, value: String) = crashlytics.setCustomKey(key, value)

  override fun log(event: String, parameters: Map<String, String>) {
    analytics.logEvent(event, Bundle().apply { parameters.forEach { (name, value) -> putString(name, value) } })
  }

  override fun kind(error: Throwable): String =
    if (error is FirebaseFirestoreException) "FirebaseFirestoreException:${error.code}" else super.kind(error)

  /** Firestore's UNAVAILABLE is a device that is offline. */
  override fun isNoise(error: Throwable): Boolean =
    error is FirebaseFirestoreException && error.code == FirebaseFirestoreException.Code.UNAVAILABLE

  companion object {
    /**
     * Turns Crashlytics and Analytics on or off for this launch and starts [Telemetry]. The manifest keeps both off
     * (`firebase_crashlytics_collection_enabled`, `firebase_analytics_collection_enabled`), so nothing is sent before this
     * decides; collection needs the config's say (a release build on production) and a build that is not debuggable.
     */
    fun install(context: Context, app: FirebaseApp, config: AglynConfig) {
      if (app.name != FirebaseApp.DEFAULT_APP_NAME) return
      val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
      val collecting = config.telemetry && !debuggable
      val crashlytics = FirebaseCrashlytics.getInstance()
      crashlytics.setCrashlyticsCollectionEnabled(collecting)
      if (!collecting) crashlytics.deleteUnsentReports()
      FirebaseAnalytics.getInstance(context.applicationContext).setAnalyticsCollectionEnabled(collecting)
      val info = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
      val build = info?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toString() else @Suppress("DEPRECATION") it.versionCode.toString() }
      Telemetry.start(collecting, FirebaseTelemetrySink(context), config.app, info?.versionName, build)
    }
  }
}
