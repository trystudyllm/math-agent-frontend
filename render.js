(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function markdownToHtml(input) {
    if (!input) return "";
    const placeholders = [];
    let text = String(input).replace(/\r\n?/g, "\n");

    function store(html) {
      const token = `@@MATH_AGENT_${placeholders.length}@@`;
      placeholders.push(html);
      return token;
    }

    // 代码块优先，避免内部内容被 Markdown 改写。
    text = text.replace(/```([\s\S]*?)```/g, function (_, code) {
      const clean = code.replace(/^\w+\n/, "");
      return store(`<pre><code>${escapeHtml(clean)}</code></pre>`);
    });

    // 行内代码。
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      return store(`<code>${escapeHtml(code)}</code>`);
    });

    // 数学块和行内公式。
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (_, math) {
      return store(`<div class="math-display">$$${escapeHtml(math)}$$</div>`);
    });
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, function (_, math) {
      return store(`<div class="math-display">\\[${escapeHtml(math)}\\]</div>`);
    });
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, function (_, math) {
      return store(`\\(${escapeHtml(math)}\\)`);
    });
    text = text.replace(/(^|[^$])\$([^$\n]+?)\$(?!\$)/g, function (_, before, math) {
      return before + store(`\\(${escapeHtml(math)}\\)`);
    });

    text = escapeHtml(text);

    const lines = text.split("\n");
    const html = [];
    let listType = null;
    let listItems = [];

    function flushList() {
      if (!listItems.length) return;
      const tag = listType === "ul" ? "ul" : "ol";
      html.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      listItems = [];
      listType = null;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
      const olMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);

      if (ulMatch || olMatch) {
        const nextType = ulMatch ? "ul" : "ol";
        if (listType !== nextType) flushList();
        listType = nextType;
        listItems.push((ulMatch || olMatch)[1]);
        continue;
      }

      flushList();
      if (!trimmed) {
        continue;
      }

      if (/^#{1,3}\s+/.test(trimmed)) {
        const level = trimmed.match(/^#+/)[0].length;
        html.push(`<h${level}>${trimmed.replace(/^#+\s+/, "")}</h${level}>`);
      } else {
        html.push(`<p>${trimmed}</p>`);
      }
    }
    flushList();

    let result = html.join("");
    result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    result = result.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    placeholders.forEach((value, index) => {
      result = result.replace(`@@MATH_AGENT_${index}@@`, value);
    });

    return result;
  }

  window.renderMarkdown = markdownToHtml;
})();
