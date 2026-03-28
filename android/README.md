# kern android app

Lightweight WebView shell that wraps the kern web UI and adds native device features (voice input, text-to-speech).

## Prerequisites

- **JDK 17+** — `winget install Microsoft.OpenJDK.17`
- **Android SDK** — command-line tools only, no Android Studio required

### Android SDK setup (Windows PowerShell)

```powershell
curl -o $env:TEMP\cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip
mkdir -p $HOME\android-sdk\cmdline-tools
Expand-Archive $env:TEMP\cmdline-tools.zip -DestinationPath $HOME\android-sdk\cmdline-tools
Rename-Item $HOME\android-sdk\cmdline-tools\cmdline-tools $HOME\android-sdk\cmdline-tools\latest

[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$HOME\android-sdk", "User")
$path = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$path;$HOME\android-sdk\cmdline-tools\latest\bin;$HOME\android-sdk\platform-tools", "User")
```

Restart your terminal, then install SDK packages:

```powershell
sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

## Build

```bash
cd android
./gradlew assembleDebug
```

The APK will be at `app/build/outputs/apk/debug/app-debug.apk`.

## Install on device

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Or transfer the APK to your phone and sideload it.

## Deep linking

Connect directly via URL:

```
kern://connect?url=http://192.168.1.100:3000&token=YOUR_TOKEN
```

## Features

- **Voice input** — mic button in the input row, uses Android SpeechRecognizer
- **Text-to-speech** — toggle in the header, reads assistant responses aloud
- **Connection config** — server URL and token saved to device, or passed via deep link

## Future

- QR code scanning for auth tokens
- File upload / image capture for analysis
- Notification support
