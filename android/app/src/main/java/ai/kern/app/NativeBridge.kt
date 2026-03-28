package ai.kern.app

import android.webkit.JavascriptInterface
import android.webkit.WebView

/**
 * JavaScript bridge exposed as `window.KernNative` in the WebView.
 */
class NativeBridge(
    private val webView: WebView,
    private val speech: SpeechService,
    private val onDisconnect: () -> Unit,
    private val onSwitchAgent: (url: String, token: String?) -> Unit = { _, _ -> },
) {
    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun startListening() {
        speech.startListening(
            onResult = { text -> callJs("if (window.onKernSpeechResult) window.onKernSpeechResult(${jsString(text)})") },
            onPartial = { text -> callJs("if (window.onKernSpeechPartial) window.onKernSpeechPartial(${jsString(text)})") },
            onError = { msg -> callJs("if (window.onKernSpeechError) window.onKernSpeechError(${jsString(msg)})") },
        )
    }

    @JavascriptInterface
    fun stopListening() {
        speech.stopListening()
    }

    @JavascriptInterface
    fun speak(text: String) {
        speech.speak(text) {
            callJs("if (window.onKernTtsDone) window.onKernTtsDone()")
        }
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

    @JavascriptInterface
    fun switchAgent(url: String, token: String?) {
        webView.post { onSwitchAgent(url, token) }
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
