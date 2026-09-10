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

    function isTableRow(line) {
      return /^\s*\|.*\|\s*$/.test(line);
    }

    function isTableSeparator(line) {
      return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
    }

    function parseTableRow(line) {
      return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    }

    function renderTables(input) {
      const lines = input.split("\n");
      const output = [];

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const nextLine = lines[index + 1] || "";

        if (isTableRow(line) && isTableSeparator(nextLine)) {
          const headerCells = parseTableRow(line);
          const bodyRows = [];
          index += 2;

          while (index < lines.length && isTableRow(lines[index])) {
            bodyRows.push(parseTableRow(lines[index]));
            index++;
          }
          index--;

          const thead = `<thead><tr>${headerCells
            .map((cell) => `<th>${cell}</th>`)
            .join("")}</tr></thead>`;
          const tbody = bodyRows.length
            ? `<tbody>${bodyRows
                .map(
                  (row) =>
                    `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`
                )
                .join("")}</tbody>`
            : "";

          output.push(
            store(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`)
          );
        } else {
          output.push(line);
        }
      }

      return output.join("\n");
    }

    text = renderTables(text);

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

      if (/^@@MATH_AGENT_\d+@@$/.test(trimmed)) {
        html.push(trimmed);
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

    // 占位符可能互相嵌套，例如表格里包含公式。多轮替换，直到全部展开。
    for (let pass = 0; pass < 10; pass++) {
      const before = result;
      result = result.replace(/@@MATH_AGENT_(\d+)@@/g, function (_, index) {
        const replacement = placeholders[Number(index)];
        return replacement === undefined ? "" : replacement;
      });
      if (result === before) break;
    }

    // 兜底：任何因为异常情况残留的占位符都不应直接显示给用户。
    result = result.replace(/@@MATH_AGENT_\d+@@/g, "");

    return result;
  }

  window.renderMarkdown = markdownToHtml;
})();
