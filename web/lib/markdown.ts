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

const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
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
        const langClass = lang ? `hljs language-${lang}` : "hljs";
        const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
        return `<div class="code-block-wrapper">${langLabel}<button class="code-copy-btn" title="Copy" onclick="var t=this.closest('.code-block-wrapper').querySelector('code').textContent||'',a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';document.body.appendChild(a);a.select();document.execCommand('copy');document.body.removeChild(a);this.classList.add('copied');var b=this;setTimeout(function(){b.classList.remove('copied')},1500)"><span class="copy-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span><span class="check-icon" style="color:#3fb950"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></span></button><pre><code class="${langClass}">${text}</code></pre></div>`;
      },
      link({ href, text }) {
        // Block javascript: URLs
        if (/^javascript:/i.test(href)) return text;
        return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
      },
    },
  }
);

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return marked.parse(text) as string;
}
