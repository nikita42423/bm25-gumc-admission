// Чат «Помощник абитуриента ГУИМЦ»: отправка вопроса и показ ответа с источниками.
const chat = document.getElementById("chat");
const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const button = document.getElementById("ask-btn");
const welcome = document.getElementById("welcome");

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
  return div;
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
  return box;
}

async function ask(question) {
  welcome?.remove();
  addMessage("msg-user", question);
  const pending = addMessage("msg-bot msg-loading", "Ищу ответ в документах…");
  button.disabled = true;

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
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
