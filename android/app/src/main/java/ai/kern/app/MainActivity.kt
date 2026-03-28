package ai.kern.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    companion object {
        const val BUILD = 21
    }

    private lateinit var webView: WebView
    private lateinit var setupScreen: View
    private lateinit var speech: SpeechService
    private val sseClient = NativeSseClient()
    private var serverUrl: String? = null
    private var serverToken: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        setupScreen = findViewById(R.id.setupScreen)
        speech = SpeechService(this)
        speech.initTts()

        setupWebView()

        intent?.data?.let { uri -> handleDeepLink(uri) } ?: showSetupOrReconnect()
        findViewById<Button>(R.id.connectBtn).setOnClickListener { onConnectClicked() }
    }

    private fun showSetupOrReconnect() {
        val savedUrl = ConnectionConfig.getUrl(this)
        if (savedUrl != null) connect(savedUrl, ConnectionConfig.getToken(this))
        else showSetup()
    }

    private fun handleDeepLink(uri: Uri) {
        val url = uri.getQueryParameter("url") ?: return showSetup()
        val token = uri.getQueryParameter("token")
        ConnectionConfig.save(this, url, token)
        connect(url, token)
    }

    private fun onConnectClicked() {
        val urlInput = findViewById<TextInputEditText>(R.id.serverUrlInput)
        val tokenInput = findViewById<TextInputEditText>(R.id.tokenInput)
        val url = urlInput.text?.toString()?.trim() ?: return
        if (url.isEmpty()) return
        val token = tokenInput.text?.toString()?.trim()?.ifEmpty { null }
        ConnectionConfig.save(this, url, token)
        connect(url, token)
    }

    private fun showSetup() {
        sseClient.close()
        webView.visibility = View.GONE
        setupScreen.visibility = View.VISIBLE
        ConnectionConfig.getUrl(this)?.let {
            findViewById<TextInputEditText>(R.id.serverUrlInput).setText(it)
        }
        ConnectionConfig.getToken(this)?.let {
            findViewById<TextInputEditText>(R.id.tokenInput).setText(it)
        }
    }

    /**
     * JS to inject BEFORE the page's own <script>.
     * Runs at parse time — no timers, no races.
     */
    private fun bridgeScript(): String = """
// --- kern native bridge (build $BUILD) ---
(function() {
    // 1. Kill EventSource so the page can never create one
    var _OrigES = window.EventSource;
    window.EventSource = function(url) {
        console.log('[kern-native] EventSource blocked: ' + url);
        this.close = function(){};
        this.readyState = 2;
    };
    window.EventSource.CONNECTING = 0;
    window.EventSource.OPEN = 1;
    window.EventSource.CLOSED = 2;

    // 2. Flag for native app detection
    window._kernNativeBuild = $BUILD;

    // 3. Wait for page to set up, then patch
    window.addEventListener('DOMContentLoaded', function() {
        // Override AgentClient.connect (page defines it in <script>)
        // Use a polling check since DOMContentLoaded fires before inline scripts
    });

    // Patch after page script runs (using a microtask at end of script parsing)
    var _patchInterval = setInterval(function() {
        if (!window.AgentClient) return;
        clearInterval(_patchInterval);

        // Close existing SSE connection
        if (window._kern && window._kern.connection) {
            window._kern.connection.close();
            window._kern.connection = { close: function(){} };
        }

        // Override connect to no-op
        window.AgentClient.connect = function(baseUrl, token, opts) {
            console.log('[kern-native] SSE connect intercepted');
            window._kernSseOpts = opts;
            return { close: function(){} };
        };

        // Override init to prevent reconnect loops
        var _origInit = window.init;
        window.init = function() {
            console.log('[kern-native] init() intercepted');
            // Run init once for history loading, then replace with no-op
            if (!window._kernInitRan) {
                window._kernInitRan = true;
                _origInit && _origInit();
            }
        };

        // Patch renderMarkdown to strip leading/trailing <br>
        var _origRM = window.renderMarkdown;
        if (_origRM) {
            window.renderMarkdown = function(text) {
                return _origRM(text).replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');
            };
        }

        // Patch handleEvent for trimming leading newlines + TTS on finish
        var _origHE = window.handleEvent;
        if (_origHE) {
            window.handleEvent = function(ev) {
                if (ev.type === 'text-delta' && ev.text && window._kern && !window._kern.streamingText) {
                    ev.text = ev.text.replace(/^\n+/, '');
                    if (!ev.text) return;
                }
                // Capture streaming text before finish clears it
                var textToSpeak = (ev.type === 'finish' && window._kern) ? window._kern.streamingText : '';
                var result = _origHE(ev);
                // Speak the full response after finish
                if (ev.type === 'finish' && window._kernTtsEnabled && textToSpeak) {
                    console.log('[kern-native] TTS speaking: ' + textToSpeak.length + ' chars');
                    KernNative.speak(textToSpeak);
                }
                return result;
            };
        }

        // Native SSE callbacks
        window._kernNativeSseReady = function() {
            console.log('[kern-native] SSE connected');
            if (window.setConnected) window.setConnected('connected');
        };
        window._kernNativeSseDisconnected = function() {
            console.log('[kern-native] SSE disconnected');
            if (window.setConnected) window.setConnected('disconnected');
        };

        // Show build number next to agent name once init sets it
        var an = document.getElementById('agent-name');
        if (an) {
            new MutationObserver(function(_, obs) {
                if (an.textContent && an.textContent !== 'kern' && an.textContent.indexOf('b$BUILD') === -1) {
                    an.textContent = an.textContent + ' [b$BUILD]';
                    obs.disconnect();
                }
            }).observe(an, { childList: true, characterData: true, subtree: true });
        }

        // --- Mic button: tap = dictate, long press = voice mode ---
        var inputRow = document.querySelector('.input-row');
        var inputEl = document.getElementById('input');
        if (inputRow && inputEl && window.KernNative) {
            var micBtn = document.createElement('button');
            micBtn.id = 'kern-mic-btn';
            micBtn.textContent = '\uD83C\uDF99';
            micBtn.title = 'Tap: dictate | Hold: voice mode';
            micBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:18px;cursor:pointer;margin-right:4px;color:var(--text);flex-shrink:0;-webkit-user-select:none;';
            inputRow.insertBefore(micBtn, inputEl);

            var listening = false;
            var voiceMode = false;
            var longPressTimer = null;
            var wasLongPress = false;

            function setMicUI(active) {
                listening = active;
                if (voiceMode) {
                    micBtn.style.borderColor = 'var(--green)';
                    micBtn.style.background = active ? 'rgba(63,185,80,0.2)' : 'rgba(63,185,80,0.1)';
                    micBtn.textContent = active ? '\uD83C\uDF99' : '\uD83D\uDD0A';
                } else {
                    micBtn.style.borderColor = active ? 'var(--red)' : 'var(--border)';
                    micBtn.style.background = active ? 'rgba(248,81,73,0.1)' : 'transparent';
                    micBtn.textContent = '\uD83C\uDF99';
                }
            }

            function setVoiceMode(active) {
                voiceMode = active;
                window._kernTtsEnabled = active;
                var ttsBtn = document.getElementById('kern-tts-btn');
                if (ttsBtn) {
                    ttsBtn.textContent = active ? '\uD83D\uDD0A' : '\uD83D\uDD07';
                    ttsBtn.style.borderColor = active ? 'var(--green)' : 'var(--border)';
                }
                if (active) {
                    console.log('[kern-native] voice mode ON');
                    startVoiceListening();
                } else {
                    console.log('[kern-native] voice mode OFF');
                    KernNative.stopListening();
                    KernNative.stopSpeaking();
                    setMicUI(false);
                }
            }

            function startVoiceListening() {
                if (!voiceMode) return;
                setMicUI(true);
                KernNative.startListening();
            }

            // Voice commands (intercepted before sending to agent)
            var voiceCommands = {
                'stop voice mode': function() { setVoiceMode(false); },
                'stop listening': function() { setVoiceMode(false); },
                'voice off': function() { setVoiceMode(false); },
                'stop': function() { KernNative.stopSpeaking(); setVoiceMode(false); },
                'mute': function() { window._kernTtsEnabled = false; var tb = document.getElementById('kern-tts-btn'); if (tb) { tb.textContent = '\uD83D\uDD07'; tb.style.borderColor = 'var(--border)'; } },
                'unmute': function() { window._kernTtsEnabled = true; var tb = document.getElementById('kern-tts-btn'); if (tb) { tb.textContent = '\uD83D\uDD0A'; tb.style.borderColor = 'var(--green)'; } },
            };

            function checkVoiceCommand(text) {
                var lower = (text || '').toLowerCase().replace(/[.,!?;:]/g, '').trim();
                for (var cmd in voiceCommands) {
                    if (lower === cmd || lower.indexOf(cmd) !== -1) {
                        console.log('[kern-native] voice command: ' + cmd);
                        voiceCommands[cmd]();
                        inputEl.value = '';
                        inputEl.dispatchEvent(new Event('input'));
                        return true;
                    }
                }
                return false;
            }

            // Long press detection
            micBtn.addEventListener('touchstart', function(e) {
                e.preventDefault();
                wasLongPress = false;
                longPressTimer = setTimeout(function() {
                    wasLongPress = true;
                    setVoiceMode(!voiceMode);
                }, 600);
            });
            micBtn.addEventListener('touchend', function(e) {
                e.preventDefault();
                clearTimeout(longPressTimer);
                if (wasLongPress) return;
                // Tap while TTS playing: interrupt and listen
                if (KernNative.isSpeaking()) {
                    KernNative.stopSpeaking();
                    if (voiceMode) startVoiceListening();
                    return;
                }
                // Tap in voice mode: exit
                if (voiceMode) {
                    setVoiceMode(false);
                } else if (listening) {
                    KernNative.stopListening();
                    setMicUI(false);
                } else {
                    KernNative.startListening();
                    setMicUI(true);
                }
            });
            micBtn.addEventListener('touchcancel', function() { clearTimeout(longPressTimer); });

            // Partial STT: live preview in input
            window.onKernSpeechPartial = function(text) {
                inputEl.value = text;
                inputEl.dispatchEvent(new Event('input'));
            };

            // Final STT result
            window.onKernSpeechResult = function(text) {
                setMicUI(false);
                if (voiceMode) {
                    if (checkVoiceCommand(text)) return;
                    if (text && text.trim()) {
                        inputEl.value = text.trim();
                        inputEl.dispatchEvent(new Event('input'));
                        if (window.send) window.send();
                    } else {
                        startVoiceListening();
                    }
                } else {
                    inputEl.value = text;
                    inputEl.dispatchEvent(new Event('input'));
                }
            };

            window.onKernSpeechError = function(msg) {
                setMicUI(false);
                if (voiceMode && msg !== 'Microphone permission required') {
                    startVoiceListening();
                }
            };

            // TTS done: restart listening in voice mode
            window.onKernTtsDone = function() {
                if (voiceMode) startVoiceListening();
            };
        }

        // TTS toggle in header
        var header = document.querySelector('.header');
        if (header && window.KernNative) {
            var ttsBtn = document.createElement('button');
            ttsBtn.id = 'kern-tts-btn';
            ttsBtn.textContent = '\uD83D\uDD07';
            ttsBtn.title = 'Read responses aloud';
            ttsBtn.style.cssText = 'background:transparent;border:1px solid var(--border);border-radius:8px;padding:4px 8px;font-size:16px;cursor:pointer;color:var(--text);margin-left:8px;flex-shrink:0;';
            header.appendChild(ttsBtn);

            window._kernTtsEnabled = false;
            ttsBtn.addEventListener('click', function() {
                window._kernTtsEnabled = !window._kernTtsEnabled;
                ttsBtn.textContent = window._kernTtsEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
                ttsBtn.style.borderColor = window._kernTtsEnabled ? 'var(--green)' : 'var(--border)';
                if (!window._kernTtsEnabled) KernNative.stopSpeaking();
            });
        }

        console.log('[kern-native] injection complete, build $BUILD');
    }, 50);

    // Fix: thinking indicator going behind input area on mobile
    var css = document.createElement('style');
    css.textContent = '.input-area { position: relative; z-index: 10; background: var(--bg-surface); }';
    document.head.appendChild(css);
})();
"""

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                Log.d("KernWebView", "onPageFinished: $url")
                if (url == "about:blank") return
                // Test: minimal injection to prove it works
                view.evaluateJavascript("console.log('[kern-native] page finished, injecting build $BUILD');", null)
                // Inject bridge script and start native SSE
                view.evaluateJavascript(bridgeScript(), null)
                startNativeSse()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                Log.e("KernWebView", "Error loading ${request.url}: ${error.description} (${error.errorCode})")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                Log.e("KernWebView", "HTTP error ${response.statusCode} for ${request.url}")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d("KernWebView", "${msg.messageLevel()}: ${msg.message()} [${msg.sourceId()}:${msg.lineNumber()}]")
                return true
            }
        }

        val bridge = NativeBridge(webView, speech) { runOnUiThread { disconnect() } }
        webView.addJavascriptInterface(bridge, "KernNative")
    }

    private fun connect(url: String, token: String?) {
        ensureMicPermission()
        serverUrl = url.trimEnd('/')
        serverToken = token
        setupScreen.visibility = View.GONE
        webView.visibility = View.VISIBLE
        webView.loadUrl(ConnectionConfig.buildWebUrl(url, token))
    }

    private fun disconnect() {
        sseClient.close()
        webView.loadUrl("about:blank")
        ConnectionConfig.clear(this)
        showSetup()
    }

    private fun startNativeSse() {
        val base = serverUrl ?: return
        val token = serverToken
        val eventsUrl = if (!token.isNullOrBlank()) {
            "$base/events?token=${Uri.encode(token)}"
        } else {
            "$base/events"
        }

        sseClient.connect(eventsUrl, token) { data ->
            runOnUiThread {
                val b64 = Base64.encodeToString(data.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
                webView.evaluateJavascript(
                    "(function(){ try { " +
                    "var b=atob('$b64');" +
                    "var bytes=new Uint8Array(b.length);" +
                    "for(var i=0;i<b.length;i++) bytes[i]=b.charCodeAt(i);" +
                    "var json=new TextDecoder().decode(bytes);" +
                    "var ev=JSON.parse(json);" +
                    "if (ev.type === '__sse_connected') { " +
                    "  if (window._kernNativeSseReady) window._kernNativeSseReady(); " +
                    "} else if (ev.type === '__sse_disconnected') { " +
                    "  if (window._kernNativeSseDisconnected) window._kernNativeSseDisconnected(); " +
                    "} else { " +
                    "  if (window.handleEvent) window.handleEvent(ev); " +
                    "} } catch(e) { console.log('SSE inject error: ' + e); } })();",
                    null
                )
            }
        }
    }

    private fun ensureMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        sseClient.close()
        speech.destroy()
        webView.destroy()
        super.onDestroy()
    }
}
