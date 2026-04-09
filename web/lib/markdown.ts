// Markdown → HTML renderer using marked + highlight.js
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import shell from "highlight.js/lib/languages/shell";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("shell", shell);

// Unique ID counter for render block iframes
let renderBlockId = 0;

const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
      // Skip highlighting for render blocks — handled by code renderer
      if (lang === "render") return code;
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch { /* fall through */ }
      }
      try { return hljs.highlightAuto(code).value; } catch { /* fall through */ }
      return code;
    },
  }),
  {
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        if (lang === "render") {
          const id = `render-block-${++renderBlockId}`;
          // Parse optional height hint from <!-- height: N --> comment
          const heightMatch = text.match(/<!--\s*height:\s*(\d+)\s*-->/);
          const height = heightMatch ? `${heightMatch[1]}px` : "300px";
          // Escape HTML for srcdoc attribute
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          // Code-escaped version for raw view
          const codeEscaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          // Auto-height script: content measures itself, posts height to parent
          const autoHeightScript = `&lt;script&gt;new ResizeObserver(()=&gt;parent.postMessage({type:&quot;render-block-resize&quot;,id:&quot;${id}&quot;,height:document.body.scrollHeight},&quot;*&quot;)).observe(document.body)&lt;/script&gt;`;
          return `<div class="render-block" data-id="${id}">
            <div class="render-block-header">
              <span class="render-block-label">rendered</span>
              <button class="render-block-toggle" onclick="toggleRenderSource(this)" title="Toggle source">{ }</button>
              <button class="render-block-fullscreen" onclick="toggleRenderFullscreen(this)" title="Fullscreen">⛶</button>
            </div>
            <iframe
              id="${id}"
              sandbox="allow-scripts"
              srcdoc="${escaped}${autoHeightScript}"
              style="width:100%;height:${height};border:none;border-radius:0 0 6px 6px;background:#1a1a1a;"
            ></iframe>
            <pre class="render-block-source" style="display:none;margin:0;padding:12px;background:#161616;border-radius:0 0 6px 6px;overflow-x:auto;font-size:13px;"><code class="hljs language-html">${codeEscaped}</code></pre>
          </div>`;
        }
        // Default code block rendering (highlight.js already applied by markedHighlight)
        const langClass = lang ? ` class="hljs language-${lang}"` : "";
        return `<pre><code${langClass}>${text}</code></pre>`;
      },
      link({ href, text }) {
        // Block javascript: URLs
        if (/^javascript:/i.test(href)) return text;
        return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
      },
    },
  }
);

export function renderMarkdown(text: string, opts?: { skipRenderBlocks?: boolean }): string {
  if (!text) return "";
  if (opts?.skipRenderBlocks) {
    // Replace ```render blocks with a loading placeholder before parsing
    text = text.replace(/```render\n[\s\S]*?```/g,
      '```\n⏳ Render block loading…\n```');
  }
  return marked.parse(text) as string;
}
