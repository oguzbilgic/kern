import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kern",
  description: "Agent runtime",
};

// Global script for render block iframe features
const renderBlockScript = `
  // Fullscreen toggle for render blocks
  window.toggleRenderFullscreen = function(btn) {
    var block = btn.closest('.render-block');
    if (!block) return;
    block.classList.toggle('fullscreen');
    btn.textContent = block.classList.contains('fullscreen') ? '✕' : '⛶';
    // ESC to exit fullscreen
    if (block.classList.contains('fullscreen')) {
      var handler = function(e) {
        if (e.key === 'Escape') {
          block.classList.remove('fullscreen');
          btn.textContent = '⛶';
          document.removeEventListener('keydown', handler);
        }
      };
      document.addEventListener('keydown', handler);
    }
  };
  // Toggle between rendered iframe and raw source code
  window.toggleRenderSource = function(btn) {
    var block = btn.closest('.render-block');
    if (!block) return;
    var iframe = block.querySelector('iframe');
    var source = block.querySelector('.render-block-source');
    if (!iframe || !source) return;
    var showingSource = source.style.display !== 'none';
    iframe.style.display = showingSource ? '' : 'none';
    source.style.display = showingSource ? 'none' : 'block';
    btn.classList.toggle('active', !showingSource);
  };
  // Auto-resize iframes based on content height (debounced, skip no-ops)
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'render-block-resize' && e.data.id) {
      var iframe = document.getElementById(e.data.id);
      if (!iframe) return;
      var newHeight = Math.min(e.data.height + 2, 800) + 'px';
      if (iframe.style.height !== newHeight) iframe.style.height = newHeight;
    }
  });
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden flex">
        {children}
        <script dangerouslySetInnerHTML={{ __html: renderBlockScript }} />
      </body>
    </html>
  );
}
