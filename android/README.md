# kern android app

Lightweight WebView shell that wraps the kern web UI and adds native device features (voice input, text-to-speech).

## Prerequisites

- **JDK 17+**
- **Android SDK** — command-line tools or Android Studio

### Android SDK setup

Download the [command-line tools](https://developer.android.com/studio#command-line-tools-only) for your platform and extract them:

```
<ANDROID_HOME>/cmdline-tools/latest/bin/
```

Set `ANDROID_HOME` to point to the SDK root, and add `cmdline-tools/latest/bin` and `platform-tools` to your `PATH`.

Then install SDK packages:

```bash
sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

## Build

```bash
cd android
./gradlew assembleDebug
```

The APK will be at `app/build/outputs/apk/debug/app-debug.apk`.

> **Note:** Set `JAVA_HOME` to your JDK 17+ installation if it isn't the default.

## Install on device

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Or transfer the APK to your phone and sideload it.

## Architecture

- **WebView** loads the kern web UI from any reachable server
- **Native SSE** (OkHttp) replaces WebView's EventSource for reliable streaming
- **KernBridge** — the web UI exposes `window.KernBridge`, a stable API the app uses to inject events, send messages, and read state. The app never touches web UI internals directly.
- **Bridge script** injected via `onPageStarted` patches KernBridge methods to route SSE through native, add voice commands, and handle TTS

## Deep linking

Connect directly via URL:

```
kern://connect?url=http://192.168.1.100:9000&token=YOUR_TOKEN
```

## Features

- **Voice input** — mic button in the input row, uses Android SpeechRecognizer
- **Text-to-speech** — toggle in the header, reads assistant responses aloud
- **Connection config** — server URL and token saved to device, or passed via deep link
