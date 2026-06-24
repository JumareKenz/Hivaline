# Building Android APK - Phase 26b Release

**Status:** Java/Gradle environment not available in current session  
**Solution:** Pre-built APK available + Documented build process  
**Alternative:** Use GitHub Actions for automated builds

---

## 📦 Pre-Built APK Available

**Location:** `android/app/build/outputs/apk/release/app-release-unsigned.apk`  
**Size:** 123 MB  
**Built:** May 12, 2026  
**Status:** Unsigned (requires signing for Play Store)

This APK contains the previous build and is ready for:
1. Signing with your keystore
2. Upload to Google Play Console
3. Beta testing

---

## 🔨 How to Build (Local Machine with Java)

### Prerequisites
```bash
# Install Java JDK 11+
# macOS: brew install openjdk@11
# Windows: choco install openjdk11 (requires admin)
#         OR download from oracle.com/java
# Linux: sudo apt-get install openjdk-11-jdk

# Verify Java installation
java -version
```

### Set JAVA_HOME Environment Variable

**Windows (PowerShell as Administrator):**
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-11.0.20.8-hotspot"
# Or for Oracle JDK:
$env:JAVA_HOME = "C:\Program Files\Java\jdk-11.0.20"

# Verify
java -version
```

**macOS/Linux:**
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 11)
# Verify
java -version
```

### Build Steps

**1. Sync Web Assets (from project root)**
```bash
npm run build
npx cap sync android
```

**2. Build Debug APK**
```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

**3. Build Release APK (Unsigned)**
```bash
cd android
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release-unsigned.apk
```

**4. Build & Test**
```bash
cd android
./gradlew build    # Runs tests, linting, and all variants
```

### Build Output Locations
```
Debug:   android/app/build/outputs/apk/debug/app-debug.apk
Release: android/app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## 🔐 Signing Release APK for Play Store

### 1. Create Keystore (One-time setup)

```bash
keytool -genkey -v -keystore ~/hiva-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias hiva-key-alias
```

**Prompts:**
- Keystore password: `[your-secure-password]`
- Key password: `[same-or-different]`
- Name: Enter your name
- Org: Hivaline
- Location: City, State, Country, etc.

### 2. Sign the APK

```bash
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
  -keystore ~/hiva-release-key.keystore \
  android/app/build/outputs/apk/release/app-release-unsigned.apk \
  hiva-key-alias
```

**Enter keystore password when prompted**

### 3. Verify Signature

```bash
jarsigner -verify -verbose -certs \
  android/app/build/outputs/apk/release/app-release-unsigned.apk
```

**Output should show:**
```
jar verified.
```

### 4. Align APK (Optimize)

```bash
zipalign -v 4 \
  android/app/build/outputs/apk/release/app-release-unsigned.apk \
  android/app/build/outputs/apk/release/app-release-signed.apk
```

**Result:** `app-release-signed.apk` ready for upload

---

## 📲 Upload to Google Play Console

1. **Go to** https://play.google.com/console
2. **Select** Hivaline app (or create new)
3. **Navigate to** Release → Production
4. **Create New Release:**
   - Upload `app-release-signed.apk`
   - Update release notes with Phase 26b info:
     ```
     Phase 26b Release: Drug-Class Boost
     - Fixed ARV dosage query specificity
     - Improved clinical query accuracy by 7%
     - Zero regressions on existing queries
     ```
   - Set version code and name
5. **Review & Submit** for review

---

## 🤖 Automated Build via GitHub Actions

### Create `.github/workflows/build-android.yml`

```yaml
name: Build Android Release APK

on:
  push:
    branches: [master]
    paths:
      - 'src/**'
      - 'android/**'
      - 'capacitor.config.ts'
      - 'package.json'
  workflow_dispatch:

jobs:
  build-android:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - uses: actions/setup-java@v3
      with:
        java-version: '11'
        distribution: 'temurin'
    
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Build web
      run: npm run build
    
    - name: Sync to Android
      run: npx cap sync android
    
    - name: Build Release APK
      run: |
        cd android
        chmod +x gradlew
        ./gradlew assembleRelease
    
    - name: Upload APK Artifact
      uses: actions/upload-artifact@v3
      with:
        name: android-release-apk
        path: android/app/build/outputs/apk/release/app-release-unsigned.apk
    
    - name: Create Release
      if: github.ref == 'refs/heads/master'
      uses: actions/create-release@v1
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      with:
        tag_name: v${{ github.run_number }}
        release_name: Release v${{ github.run_number }} (Phase 26b)
        body: |
          ## Android APK - Phase 26b Release
          
          **Changes:**
          - Drug-Class Boost for ARV query specificity
          - Clinical accuracy improved by 7%
          - Zero regressions
          
          **APK:** `app-release-unsigned.apk` (attached)
          
          **Next Steps:**
          1. Download APK artifact
          2. Sign with keystore: `jarsigner -keystore keystore.jks ...`
          3. Align: `zipalign -v 4 unsigned.apk signed.apk`
          4. Upload to Google Play Console
```

### Enable GitHub Actions

1. Go to repository Settings → Actions
2. Enable "Allow all actions and reusable workflows"
3. Commit `.github/workflows/build-android.yml`
4. Workflow runs automatically on push

---

## 🐛 Troubleshooting Build Issues

### Issue: "ERROR: JAVA_HOME is not set"
**Solution:**
```bash
# Windows
set JAVA_HOME=C:\Program Files\Java\jdk-11.0.20
# Or export for session
export JAVA_HOME="/c/Program Files/Java/jdk-11.0.20"

# Verify
echo $JAVA_HOME
java -version
```

### Issue: "Gradle daemon not responding"
**Solution:**
```bash
cd android
./gradlew --stop
./gradlew clean
./gradlew assembleRelease
```

### Issue: "Out of memory"
**Solution:** Increase Gradle heap in `android/gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx2048m  # Increase from 1536m to 2048m
```

### Issue: "Build variant release not available"
**Solution:** Ensure `build.gradle` has release buildType:
```gradle
buildTypes {
    release {
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

---

## 📝 Build Configuration Files

### `android/gradle.properties`
```properties
org.gradle.jvmargs=-Xmx1536m
android.useAndroidX=true
```

### `android/app/build.gradle`
```gradle
android {
    namespace = "com.hiva.runtime"
    compileSdk = 36
    defaultConfig {
        applicationId "com.hiva.runtime"
        minSdkVersion 24
        targetSdkVersion 36
        versionCode 1
        versionName "1.0"
    }
}
```

### `android/build.gradle`
```gradle
buildscript {
    ext {
        compileSdkVersion = 36
        minSdkVersion = 24
        targetSdkVersion = 36
    }
}
```

---

## 📊 Build Profiles

### Debug Build
- **Use for:** Development, testing, debugging
- **Size:** Smaller (includes debug symbols)
- **Speed:** Faster to build
- **Signing:** Optional (auto-signed with debug key)
- **Deployment:** ADB to device, manual installation

```bash
cd android && ./gradlew assembleDebug
# Output: app-debug.apk
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Release Build
- **Use for:** Production, Play Store, distribution
- **Size:** Larger (123 MB with ML models)
- **Speed:** Slower (includes optimizations, minification)
- **Signing:** Required (keystore signature)
- **Deployment:** Google Play Console, manual APK share

```bash
cd android && ./gradlew assembleRelease
# Output: app-release-unsigned.apk
# Must be signed before distribution
```

---

## 🎯 Next Steps for Phase 26b Release

1. **Current Status:**
   - Web build: ✅ Complete (dist/)
   - Git commit: ✅ Complete (b397ab8)
   - GitHub push: ✅ Complete
   - Android APK: ⏳ Pending Java environment

2. **To Build APK Locally:**
   - Install Java JDK 11+ (requires admin)
   - Set JAVA_HOME environment variable
   - Run: `npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`

3. **To Build via GitHub Actions:**
   - Add `.github/workflows/build-android.yml`
   - Push to repository
   - APK builds automatically on next commit

4. **To Sign & Upload:**
   - Create keystore (one-time)
   - Sign APK with jarsigner
   - Align with zipalign
   - Upload to Google Play Console

---

## 📞 Support

**Documentation Files:**
- `DEPLOYMENT_CHECKLIST.md` - Full deployment guide
- `BUILD_SUMMARY.md` - Build artifacts & instructions
- `RELEASE_NOTES.txt` - Release information

**GitHub:** https://github.com/JumareKenz/Hivaline/commit/b397ab8

---

**Last Updated:** 2026-06-24  
**Phase:** 26b (Drug-Class Boost)  
**Status:** Ready for production build
