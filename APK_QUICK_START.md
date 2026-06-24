# APK Build Quick Start Guide

## ✅ What's Ready

**GitHub Actions is configured and active!**
- Automatically builds APK on every push to `master`
- Creates GitHub releases with artifacts
- Ready to sign and upload to Play Store

---

## 🚀 Quick Start (3 Steps)

### Step 1: Get Unsigned APK (For Testing Now)

1. Go to: **https://github.com/JumareKenz/Hivaline/actions**
2. Click the latest **"Build Android Release APK"** workflow
3. Under **Artifacts**, download: `hiva-medichat-unsigned-apk`
4. Extract the ZIP to get: `app-release-unsigned.apk`

**Install on your device:**
```bash
adb install app-release-unsigned.apk
```

✅ This APK has:
- Phase 26b improvements (ARV drug-class boost)
- New name "Hiva Medichat"
- All latest features

---

### Step 2: Create Keystore (One-Time Setup for Play Store)

On your local machine, run:

```bash
keytool -genkey -v -keystore ~/hiva-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias hiva-key-alias
```

When prompted:
- **Keystore password:** Save this! (e.g., `SecurePass123!`)
- **Key password:** Save this! (can be same as keystore)
- **Name, Org, City, State, Country:** Fill in your details

✅ Creates: `~/hiva-release-key.keystore`

---

### Step 3: Configure GitHub Secrets (Automatic Signing)

#### 3a. Encode the keystore

**macOS/Linux:**
```bash
base64 ~/hiva-release-key.keystore | pbcopy
```

**Windows (PowerShell):**
```powershell
$keystore = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\hiva-release-key.keystore")
$base64 = [System.Convert]::ToBase64String($keystore)
Set-Clipboard -Value $base64
```

#### 3b. Add GitHub Secrets

1. Go to: **https://github.com/JumareKenz/Hivaline/settings/secrets/actions**
2. Click **"New repository secret"** for each:

| Name | Value |
|------|-------|
| `KEYSTORE_BASE64` | Paste the base64 string from 3a |
| `KEYSTORE_PASSWORD` | Your keystore password (e.g., `SecurePass123!`) |
| `KEY_ALIAS` | `hiva-key-alias` |
| `KEY_PASSWORD` | Your key password |

✅ GitHub Actions will now automatically sign your APKs!

---

## 📥 Getting Your APK

### Unsigned (Always Available)
- **Use for:** Testing on your own device
- **Location:** Actions → Artifacts → `hiva-medichat-unsigned-apk`
- **Installation:** `adb install app-release-unsigned.apk`

### Signed (After Step 3)
- **Use for:** Google Play Store upload
- **Location:** Actions → Artifacts → `hiva-medichat-signed-apk`
- **Ready for:** Direct upload to Play Store

---

## 📱 Upload to Google Play

Once you have the signed APK:

1. Go to: **https://play.google.com/console**
2. Select "Hivaline" or create new app
3. **Release → Production** → **Create new release**
4. Upload: `app-release.apk` (signed)
5. Fill release notes (copy from GitHub release)
6. Submit for review

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Artifact not found" | Wait 2-3 minutes for workflow to complete. Check Actions tab. |
| "Keystore invalid" | Re-encode with correct base64 command. Verify file path. |
| "APK already uploaded" | Increment `versionCode` in `android/app/build.gradle` before uploading. |
| "Installation fails" | Ensure device has "Unknown sources" enabled. Try USB adb install. |

---

## 📚 Full Documentation

- **`KEYSTORE_SETUP.md`** — Detailed keystore setup & security
- **`BUILD_ANDROID_APK.md`** — Complete Android build guide
- **`.github/workflows/build-android.yml`** — GitHub Actions config

---

## 🎯 Next Steps

1. **Now:** Download unsigned APK and test on device ✅
2. **When Ready:** Follow Step 2-3 for Play Store signing
3. **After:** Upload signed APK to Google Play

---

**Current Version:** Hiva Medichat v2.0
**Last Updated:** 2026-06-22
**Status:** ✅ Production Ready
