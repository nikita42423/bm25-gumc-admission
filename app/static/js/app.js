// Чат «Помощник абитуриента ГУИМЦ»: отправка вопроса и показ ответа с источниками.
const chat = document.getElementById("chat");
const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const button = document.getElementById("ask-btn");
const welcome = document.getElementById("welcome");
const llmSelect = document.getElementById("llm");
const clearBtn = document.getElementById("clear-btn");

// Выбор модели запоминаем в браузере, чтобы не выбирать заново после перезагрузки.
const LLM_NAMES = { ollama: "Ollama (локально)", yandex: "YandexGPT" };
try {
  const saved = localStorage.getItem("llm");
  if (saved && [...llmSelect.options].some((o) => o.value === saved)) llmSelect.value = saved;
} catch {}
llmSelect.addEventListener("change", () => {
  try { localStorage.setItem("llm", llmSelect.value); } catch {}
});

const STOP_WORDS = new Set([
  "и", "в", "во", "на", "с", "со", "по", "к", "у", "о", "об", "из", "за", "для",
  "ли", "не", "а", "но", "что", "как", "какие", "какой", "когда", "где", "есть", "мне", "я",
]);

function keywords(question) {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// Подсвечивает слова вопроса в тексте. Сравниваем по началу слова,
// чтобы «документы» находило «документов».
function highlight(text, words) {
  const frag = document.createDocumentFragment();
  const stems = words.map((w) => w.slice(0, Math.max(4, w.length - 2)));
  for (const part of text.split(/([\p{L}\p{N}]+)/u)) {
    const lower = part.toLowerCase();
    if (stems.length && stems.some((s) => lower.startsWith(s))) {
      const mark = document.createElement("mark");
      mark.textContent = part;
      frag.append(mark);
    } else {
      frag.append(part);
    }
  }
  return frag;
}

function addMessage(cls, content) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  if (typeof content === "string") div.textContent = content;
  else div.append(content);
  chat.append(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
  updateClearButton();
  return div;
}

// «Очистить» активна, только когда в чате есть сообщения.
function updateClearButton() {
  clearBtn.disabled = !chat.querySelector(".msg");
}

// Удаляем все сообщения и возвращаем приветствие с примерами вопросов
// (тот же элемент, поэтому кнопки-примеры продолжают работать).
function clearChat() {
  chat.querySelectorAll(".msg").forEach((m) => m.remove());
  chat.prepend(welcome);
  chat.scrollTop = 0;
  updateClearButton();
  input.focus();
}

// Кнопка «Скопировать» под ответом: кладёт текст в буфер обмена
// и на 2 секунды меняет подпись на «Скопировано ✓».
function copyButton(text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-ghost btn-copy";
  const label = document.createElement("span");
  label.textContent = "Скопировать";
  btn.innerHTML =
    '<svg class="icon icon-neon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>';
  btn.append(label);
  let timer;
  btn.addEventListener("click", async () => {
    const ok = await copyText(text);
    label.textContent = ok ? "Скопировано ✓" : "Не удалось скопировать";
    btn.classList.toggle("is-done", ok);
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = "Скопировать";
      btn.classList.remove("is-done");
    }, 2000);
  });
  return btn;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Запасной путь: буфер обмена недоступен (например, сайт открыт по http с телефона).
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    area.remove();
    return ok;
  }
}

function renderAnswer(data, question) {
  const words = keywords(question);
  const box = document.createDocumentFragment();
  box.append(highlight(data.answer, words));

  if (data.sources?.length) {
    const list = document.createElement("div");
    list.className = "sources";
    list.innerHTML =
      '<div class="sources-title"><svg class="icon icon-neon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>Источники</div>';
    for (const s of data.sources) {
      const a = document.createElement("a");
      a.className = "source";
      a.href = s.url || "#";
      a.target = "_blank";
      a.rel = "noopener";
      const name = document.createElement("div");
      name.className = "source-name";
      name.textContent = s.title;
      const text = document.createElement("p");
      text.className = "source-text";
      text.append(highlight(s.fragment, words));
      a.append(name, text);
      list.append(a);
    }
    box.append(list);
  }
  const footer = document.createElement("div");
  footer.className = "answer-footer";
  // Копировать имеет смысл только настоящий ответ — с источниками, а не отказ «нет информации».
  if (data.sources?.length) footer.append(copyButton(data.answer));
  if (data.llm) {
    const meta = document.createElement("div");
    meta.className = "answer-meta";
    meta.textContent = `Ответ написала модель: ${LLM_NAMES[data.llm] || data.llm}`;
    footer.append(meta);
  }
  if (footer.childElementCount) box.append(footer);
  return box;
}

async function ask(question) {
  welcome?.remove();
  addMessage("msg-user", question);
  const pending = addMessage("msg-bot msg-loading", "Ищу ответ в документах…");
  button.disabled = true;
  const llm = llmSelect.value;

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, llm }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pending.classList.remove("msg-loading");
    pending.textContent = "";
    if (!data.answer && !data.sources?.length) {
      pending.textContent = "Не нашёл ответа в документах. Попробуйте переформулировать вопрос.";
    } else {
      pending.append(renderAnswer(data, question));
    }
  } catch (err) {
    pending.className = "msg msg-bot msg-error";
    pending.textContent = "Не удалось получить ответ. Проверьте соединение и попробуйте ещё раз.";
    console.error(err);
  } finally {
    button.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  input.value = "";
  ask(q);
});

document.querySelectorAll(".example").forEach((btn) =>
  btn.addEventListener("click", () => ask(btn.textContent)),
);

clearBtn.addEventListener("click", clearChat);
