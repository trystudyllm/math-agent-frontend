(function () {
  "use strict";

  const chatLog = document.getElementById("chatLog");
  const chatForm = document.getElementById("chatForm");
  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const imageButton = document.getElementById("imageButton");
  const imageInput = document.getElementById("imageInput");
  const imagePreview = document.getElementById("imagePreview");
  const agentCards = document.getElementById("agentCards");
  const appTitle = document.getElementById("appTitle");
  const appSubtitle = document.getElementById("appSubtitle");
  const API_BASE = (window.API_BASE || "").replace(/\/+$/, "");

  let agents = {};
  let currentAgent = "knowledge";
  let messages = [];
  let isStreaming = false;
  let mathTimer = null;
  let pendingImages = [];

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

  function addMessage(role, content, extraClass, images) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role} ${extraClass || ""}`.trim();
    const avatar = role === "user" ? "🙋" : "🧑‍🏫";
    const imagesHtml = images && images.length
      ? `<div class="message-images">${images
          .map((src) => `<img src="${escapeHtml(src)}" alt="作业图片" />`)
          .join("")}</div>`
      : "";
    wrapper.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="bubble">${window.renderMarkdown(content) || "..."}${imagesHtml}</div>
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
    imageButton.disabled = value;
    imageInput.disabled = value;
    sendButton.querySelector("span").textContent = value ? "回答中" : "发送";
  }

  async function sendMessage() {
    const text = messageInput.value.trim();
    const images = pendingImages.slice();
    if ((!text && images.length === 0) || isStreaming) return;

    const userText = text || "请帮我看看图片里的数学题。";
    messages.push({ role: "user", content: userText });
    addMessage("user", userText, "", images);
    messageInput.value = "";
    pendingImages = [];
    renderImagePreview();
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
          images: images,
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

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("图片读取失败。"));
      };
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file) {
    return new Promise(async function (resolve, reject) {
      try {
        const originalDataUrl = await fileToDataUrl(file);
        const image = new Image();
        image.onload = function () {
          const maxSide = 1600;
          let width = image.width;
          let height = image.height;
          if (width > maxSide || height > maxSide) {
            const ratio = Math.min(maxSide / width, maxSide / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.onerror = function () {
          reject(new Error("图片格式不支持。"));
        };
        image.src = originalDataUrl;
      } catch (error) {
        reject(error);
      }
    });
  }

  function renderImagePreview() {
    imagePreview.innerHTML = "";
    pendingImages.forEach(function (src, index) {
      const item = document.createElement("div");
      item.className = "image-preview-item";
      const image = document.createElement("img");
      image.src = src;
      image.alt = "待上传图片";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "移除图片");
      remove.addEventListener("click", function () {
        pendingImages.splice(index, 1);
        renderImagePreview();
      });
      item.appendChild(image);
      item.appendChild(remove);
      imagePreview.appendChild(item);
    });
  }

  async function handleImageFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 4 - pendingImages.length);
    if (!files.length) return;
    setStatusLike("正在处理图片...");
    for (const file of files) {
      try {
        const dataUrl = await compressImage(file);
        pendingImages.push(dataUrl);
      } catch (error) {
        window.alert(error.message || "图片处理失败。");
      }
    }
    renderImagePreview();
    setStatusLike("");
  }

  function setStatusLike(message) {
    if (!imageButton) return;
    if (message) {
      imageButton.textContent = "⏳";
      imageButton.title = message;
    } else {
      imageButton.textContent = "📷";
      imageButton.title = "添加作业图片";
    }
  }

  function autoResize() {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + "px";
  }

  function startHeroSlideshow() {
    const slides = document.querySelectorAll(".hero-slide");
    if (slides.length < 2) return;
    let activeIndex = 0;
    setInterval(function () {
      slides[activeIndex].classList.remove("active");
      activeIndex = (activeIndex + 1) % slides.length;
      slides[activeIndex].classList.add("active");
    }, 5000);
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

  imageButton.addEventListener("click", function () {
    if (pendingImages.length >= 4) {
      window.alert("最多上传 4 张图片。");
      return;
    }
    imageInput.click();
  });

  imageInput.addEventListener("change", function () {
    handleImageFiles(imageInput.files);
    imageInput.value = "";
  });

  messageInput.addEventListener("input", autoResize);
  messageInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });

  startHeroSlideshow();
  loadConfig();
})();
