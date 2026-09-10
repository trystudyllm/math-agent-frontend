(function () {
  "use strict";

  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const agentCards = document.getElementById("agentCards");
  const appTitle = document.getElementById("appTitle");
  const appSubtitle = document.getElementById("appSubtitle");
  const API_BASE = (window.API_BASE || "").replace(/\/+$/, "");

  let agents = {};
  let currentAgent = "knowledge";
  let messages = [];
  let isStreaming = false;
  let mathTimer = null;

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  function renderWelcome() {
    const welcomeText =
      (window.appConfig && window.appConfig.app && window.appConfig.app.welcome_text) ||
      "你好，我是你的高等数学助教。下面选择一个助教，然后问我数学问题吧。";
    chatLog.innerHTML = "";
    const welcome = document.createElement("div");
    welcome.className = "welcome-panel";
    welcome.innerHTML = `<h2>👋 今天想学什么？</h2><p>${escapeHtml(welcomeText)}</p>`;
    chatLog.appendChild(welcome);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderAgentCards() {
    if (!agentCards) return;
    agentCards.innerHTML = "";
    Object.values(agents).forEach((agent) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "agent-card" + (agent.id === currentAgent ? " active" : "");
      button.dataset.agent = agent.id;
      button.innerHTML = `
        <span class="agent-icon">${escapeHtml(agent.icon || "🧮")}</span>
        <span class="agent-name">${escapeHtml(agent.name || agent.id)}</span>
        <span class="agent-desc">${escapeHtml(agent.description || "")}</span>
      `;
      button.addEventListener("click", function () {
        currentAgent = agent.id;
        renderAgentCards();
        messageInput.focus();
      });
      agentCards.appendChild(button);
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatLog.scrollTop = chatLog.scrollHeight;
    });
  }

  function queueMathRender(element) {
    if (typeof window.MathJax === "undefined" || !window.MathJax.typesetPromise) {
      return;
    }
    clearTimeout(mathTimer);
    mathTimer = setTimeout(() => {
      window.MathJax.typesetPromise([element]).catch(() => {});
    }, 300);
  }

  function addMessage(role, content, extraClass) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role} ${extraClass || ""}`.trim();
    const avatar = role === "user" ? "🙋" : "🧑‍🏫";
    wrapper.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="bubble">${window.renderMarkdown(content) || "..."}</div>
    `;
    chatLog.appendChild(wrapper);
    scrollToBottom();
    queueMathRender(wrapper.querySelector(".bubble"));
    return wrapper.querySelector(".bubble");
  }

  function addTypingMessage() {
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";
    wrapper.innerHTML = `
      <div class="avatar">🧑‍🏫</div>
      <div class="bubble"><span class="typing-indicator"><i></i><i></i><i></i></span></div>
    `;
    chatLog.appendChild(wrapper);
    scrollToBottom();
    return wrapper;
  }

  function updateBubble(bubble, content) {
    bubble.innerHTML = window.renderMarkdown(content);
    scrollToBottom();
    queueMathRender(bubble);
  }

  function setStreaming(value) {
    isStreaming = value;
    sendButton.disabled = value;
    messageInput.disabled = value;
    sendButton.querySelector("span").textContent = value ? "回答中" : "发送";
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || isStreaming) return;

    messages.push({ role: "user", content: text });
    addMessage("user", text);
    messageInput.value = "";
    autoResize();
    setStreaming(true);

    const typingWrapper = addTypingMessage();
    const bubble = typingWrapper.querySelector(".bubble");
    let assistantText = "";

    try {
      const response = await fetch(apiUrl("/api/chat/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: currentAgent,
          messages: messages,
        }),
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "请求失败，请稍后重试。");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const result = await reader.read();
        if (result.done) {
          done = true;
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const jsonText = dataLine.slice(5).trim();
          if (!jsonText) continue;
          let payload;
          try {
            payload = JSON.parse(jsonText);
          } catch (error) {
            continue;
          }
          if (payload.error) {
            throw new Error(payload.delta || "请求失败。");
          }
          if (payload.delta) {
            assistantText += payload.delta;
            updateBubble(bubble, assistantText);
          }
          if (payload.done) {
            done = true;
            typingWrapper.className = payload.is_math === false
              ? "message assistant rejected"
              : "message assistant";
          }
        }
      }

      if (!assistantText) {
        assistantText = "没有收到回答，请稍后重试。";
        updateBubble(bubble, assistantText);
      }
      messages.push({ role: "assistant", content: assistantText });
    } catch (error) {
      const message = error && error.message ? error.message : "网络错误，请检查后端是否启动。";
      typingWrapper.className = "message assistant error";
      updateBubble(bubble, message);
      messages.push({ role: "assistant", content: message });
    } finally {
      setStreaming(false);
      messageInput.focus();
    }
  }

  function autoResize() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
  }

  async function loadConfig() {
    try {
      const response = await fetch(apiUrl("/api/config/public"));
      if (!response.ok) throw new Error("配置加载失败");
      const config = await response.json();
      window.appConfig = config;
      if (config.app) {
        appTitle.textContent = config.app.title || appTitle.textContent;
        appSubtitle.textContent = config.app.subtitle || appSubtitle.textContent;
        document.title = config.app.title || document.title;
      }
      if (config.agents) {
        agents = config.agents;
      }
    } catch (error) {
      agents = {
        knowledge: {
          id: "knowledge",
          name: "知识点助教",
          icon: "📘",
          description: "概念、公式、例题讲解",
        },
        exam: {
          id: "exam",
          name: "期末考试大纲助教",
          icon: "📋",
          description: "梳理考点、题型与复习策略",
        },
        homework: {
          id: "homework",
          name: "作业助教",
          icon: "✏️",
          description: "给提示和步骤，不直接给答案",
        },
      };
    }
    renderAgentCards();
    renderWelcome();
  }

  chatForm.addEventListener("submit", function (event) {
    event.preventDefault();
    sendMessage();
  });

  messageInput.addEventListener("input", autoResize);
  messageInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  loadConfig();
})();
