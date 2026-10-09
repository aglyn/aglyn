// The Logic plugin's native screens (Android + JVM desktop): a site's
// variables and no-code functions. Reached only through the
// generated native plugin manifest; the app shells never import it.
plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.android.kmp.library)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

kotlin {
  jvmToolchain(21)
  android {
    namespace = "com.aglyn.plugins.logic"
    compileSdk = libs.versions.android.compileSdk.get().toInt()
    minSdk = libs.versions.android.minSdk.get().toInt()
    withHostTest {}
  }
  jvm("desktop")

  sourceSets {
    commonMain.dependencies {
      implementation(project(":native-plugin-host"))
      implementation(project(":native-ui"))
      implementation(project(":native-contracts"))
    }
    commonTest.dependencies {
      implementation(kotlin("test"))
      implementation(libs.kotlinx.coroutines.test)
    }
  }
}

// The variable and option formatters replay the console's own answers from libs/native/contracts.
tasks.withType<Test>().configureEach {
  systemProperty("aglyn.contractsDir", file("../../../../native/contracts").absolutePath)
}
