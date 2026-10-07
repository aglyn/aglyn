// Aglyn and Aglyn POS on the JVM desktop (Compose Multiplatform). Windows
// ships from here (MSI/MSIX, packaged on Windows CI); macOS ships the SwiftUI
// app, so a Mac build of this is for development and screenshots.
//
// One module, two apps: -Paglyn.desktopApp=pos builds and runs Aglyn POS.
import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
  alias(libs.plugins.kotlin.multiplatform)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.compose.multiplatform)
}

val pos = (findProperty("aglyn.desktopApp") as String?) == "pos"

kotlin {
  jvmToolchain(21)
  jvm("desktop")

  sourceSets {
    named("desktopMain") {
      dependencies {
        implementation(project(":native-shell"))
        implementation(project(":plugin-manifest"))
        implementation(compose.desktop.currentOs)
        implementation(libs.kotlinx.coroutines.swing)
      }
    }
  }
}

compose.desktop {
  application {
    mainClass = if (pos) "com.aglyn.desktop.AglynPosDesktopKt" else "com.aglyn.desktop.AglynDesktopKt"
    // Run settings: the local emulator stack unless -Daglyn.* says otherwise.
    jvmArgs += (findProperty("aglyn.jvmArgs") as String?)?.split(' ')?.filter { it.isNotBlank() } ?: emptyList()

    nativeDistributions {
      targetFormats(TargetFormat.Msi, TargetFormat.Exe, TargetFormat.Dmg)
      packageName = if (pos) "Aglyn POS" else "Aglyn"
      packageVersion = "1.0.0"
      vendor = "Aglyn LLC"
      description = if (pos) "The Aglyn register" else "Manage your Aglyn workspace"
      windows {
        // Stable per app, so an install upgrades in place.
        upgradeUuid = if (pos) "5d3c8e2a-7f1b-4c4e-9a7e-2b6f0c9d1e42" else "9b1f4a6e-3c2d-4e8f-a1b7-6d5c0e9f2a13"
        menuGroup = "Aglyn"
        perUserInstall = true
        shortcut = true
      }
      macOS {
        bundleID = if (pos) "com.aglyn.pos.desktop" else "com.aglyn.app.desktop"
      }
    }
  }
}

// Offscreen screenshots of every desktop screen against the emulator stack
// (a development tool; see DesktopSnapshots.kt).
tasks.register<JavaExec>("snapshots") {
  val test = kotlin.jvm("desktop").compilations.getByName("test")
  dependsOn(test.compileTaskProvider)
  classpath = files(test.output.allOutputs, test.runtimeDependencyFiles)
  mainClass.set("com.aglyn.desktop.DesktopSnapshotsKt")
  jvmArgs((findProperty("aglyn.jvmArgs") as String?)?.split(' ')?.filter { it.isNotBlank() } ?: emptyList<String>())
  (findProperty("aglyn.snapshotDir") as String?)?.let { systemProperty("aglyn.snapshotDir", it) }
}

// This module's test source set holds the snapshot tool, not tests; the
// shells' UI tests live in libs/native/kotlin/shell.
tasks.withType<Test>().configureEach { failOnNoDiscoveredTests.set(false) }
