import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release builds pass the tag without its "v" (-PnexoteVersion=0.19.0). The
// version code has to grow with every release, so it is derived from the
// version: 0.19.0 → 19000, 1.2.3 → 1002003.
val nexoteVersion = providers.gradleProperty("nexoteVersion").orNull ?: "0.0.0-dev"
val nexoteVersionCode = if (nexoteVersion == "0.0.0-dev") {
    1
} else {
    val parts = Regex("""^(\d+)\.(\d+)\.(\d+)""").find(nexoteVersion)?.destructured
        ?: throw GradleException("nexoteVersion must look like 1.2.3, got \"$nexoteVersion\"")
    val (major, minor, patch) = parts.toList().map { it.toInt() }
    major * 1_000_000 + minor * 1_000 + patch
}

// The release key only exists in CI (secrets); local release builds stay
// unsigned instead of failing. The names differ from SigningConfig's own
// properties: inside `create("release") { … }` those would shadow them.
val releaseStoreFile = providers.environmentVariable("NEXOTE_KEYSTORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("NEXOTE_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("NEXOTE_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("NEXOTE_KEY_PASSWORD").orNull
val canSign = listOf(releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword).all { !it.isNullOrEmpty() }

android {
    namespace = "app.nexote"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "app.nexote"
        minSdk = 26
        targetSdk = 35
        versionCode = nexoteVersionCode
        versionName = nexoteVersion
    }

    signingConfigs {
        if (canSign) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    // The universal APK carries the Go engine for two ABIs (~22 MB each
    // uncompressed). Compressed, the download is less than half the size,
    // and the device only unpacks its own ABI's copy at install.
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // The Go engine, built by android/build-engine.sh (gomobile bind).
    implementation(files("libs/nexote-engine.aar"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
}
