# Keystore Setup for Google Play Store

## Step 1: Create a Keystore (One-Time Setup)

Run this command on your local machine to generate a signing keystore:

```bash
keytool -genkey -v -keystore ~/hiva-release-key.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias hiva-key-alias
```

**When prompted, enter:**
- **Keystore password:** `[choose a strong password]` — save this!
- **Key password:** `[same or different]` — save this!
- **First and last name:** Your name
- **Organization:** Hivaline / Hiva Medichat
- **City:** Your city
- **State:** Your state/province
- **Country code:** Your country (e.g., NG for Nigeria)

**Output:** `~/hiva-release-key.keystore` (store safely)

---

## Step 2: Configure GitHub Actions Secrets

The keystore needs to be uploaded to GitHub securely as a secret.

### 2a. Encode the Keystore (Base64)

On your local machine:

```bash
# macOS/Linux
base64 ~/hiva-release-key.keystore | pbcopy
# Copy the output

# Windows (PowerShell)
$keystore = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\hiva-release-key.keystore")
$base64 = [System.Convert]::ToBase64String($keystore)
Set-Clipboard -Value $base64
```

### 2b. Add to GitHub Secrets

1. Go to: **https://github.com/JumareKenz/Hivaline/settings/secrets/actions**
2. Click **"New repository secret"** and add these 4 secrets:

| Secret Name | Value |
|-------------|-------|
| `KEYSTORE_BASE64` | Base64-encoded keystore (from step 2a) |
| `KEYSTORE_PASSWORD` | Your keystore password |
| `KEY_ALIAS` | `hiva-key-alias` |
| `KEY_PASSWORD` | Your key password |

---

## Step 3: Update Android Build Config

The GitHub Actions workflow will automatically use these secrets to sign the APK.

**Signed APK Location:** `android/app/build/outputs/apk/release/app-release.apk`

---

## Step 4: Verify Signing

After GitHub Actions builds, verify the signature:

```bash
jarsigner -verify -verbose -certs app-release.apk
```

**Expected output:**
```
jar verified.
```

---

## Step 5: Upload to Google Play Console

1. Go to: https://play.google.com/console
2. Select "Hivaline" app (or create new)
3. Go to **Release → Production**
4. Click **"Create new release"**
5. Upload the **signed APK** from GitHub Actions artifact
6. Fill in release notes:
   ```
   Hiva Medichat v2.0 - Phase 26b Release
   
   New Features:
   - Improved ARV drug query specificity
   - Better clinical query accuracy (+7%)
   - Rebranded to Hiva Medichat
   
   Improvements:
   - Drug-class boost for ARV, ACT, TPT, CPT, PREP
   - Fixed "ARV dose for 10kg child" query
   - Zero regressions on existing queries
   ```
7. Submit for review

---

## ⚠️ Important Notes

### Security
- **Never commit the keystore file** to git (already in .gitignore)
- GitHub secrets are encrypted and only visible to authorized users
- Keep your passwords safe — you'll need them to update the app

### Version Management
Before uploading to Play Store, update version in `android/app/build.gradle`:

```gradle
android {
  defaultConfig {
    versionCode 2        // Increment by 1 each release
    versionName "2.0.0"  // Semantic versioning
  }
}
```

### Key Rotation
Keep the same keystore and key alias for all future releases. Using a different keystore will prevent updates on Play Store.

---

## Troubleshooting

### "Invalid keystore" error
- Verify base64 encoding is correct
- Check keystore file exists locally
- Confirm password is exact match

### "Keystore was tampered with"
- Re-encode the keystore base64
- Verify KEYSTORE_PASSWORD is correct
- Regenerate if corrupted

### "Alias does not exist"
- Verify KEY_ALIAS is exactly `hiva-key-alias`
- Check key password matches

---

## Next Steps

1. **Create keystore locally** (Step 1)
2. **Encode and add to GitHub secrets** (Step 2)
3. **Push a commit** to trigger GitHub Actions workflow
4. **Download signed APK** from Actions artifacts
5. **Upload to Google Play Console** (Step 5)

---

**Status:** Ready for setup
**Last Updated:** 2026-06-22
