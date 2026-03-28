package ai.kern.app

import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * JavaScript bridge exposed as `window.KernNative` in the WebView.
 *
 * Web UI can call:
 *   KernNative.startListening()   - begin speech-to-text
 *   KernNative.stopListening()    - stop speech-to-text
 *   KernNative.speak(text)        - text-to-speech
 *   KernNative.stopSpeaking()     - interrupt TTS
 *   KernNative.isSpeaking()       - check TTS state
 *   KernNative.isAvailable()      - always true when running in the native shell
 *   KernNative.disconnect()       - return to setup screen
 *
 * Results are delivered via callbacks on `window`:
 *   window.onKernSpeechResult(text)   - partial/final STT result
 *   window.onKernSpeechError(msg)     - STT error
 */
class NativeBridge(
    private val webView: WebView,
    private val speech: SpeechService,
    private val onDisconnect: () -> Unit,
) {
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun startListening() {
        speech.startListening(
            onResult = { text -> callJs("window.onKernSpeechResult(${jsString(text)})") },
            onError = { msg -> callJs("window.onKernSpeechError(${jsString(msg)})") },
        )
    }

    @JavascriptInterface
    fun stopListening() {
        speech.stopListening()
    }

    @JavascriptInterface
    fun speak(text: String) {
        speech.speak(text)
    }

    @JavascriptInterface
    fun stopSpeaking() {
        speech.stopSpeaking()
    }

    @JavascriptInterface
    fun isSpeaking(): Boolean = speech.isSpeaking

    @JavascriptInterface
    fun disconnect() {
        webView.post { onDisconnect() }
    }

    private fun callJs(script: String) {
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun jsString(s: String): String {
        val escaped = s
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
        return "\"$escaped\""
    }
}
