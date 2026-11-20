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

// Блок «Источники» — одно окно с разделами по документам. Сначала свёрнут: видны названия и метки
// пунктов. «Показать» раскрывает фрагменты и кнопку «Скачать документ» (полный PDF), «Скрыть» — сворачивает.
let sourcesCount = 0;
function renderSources(sources, words) {
  const list = document.createElement("div");
  list.className = "sources";
  const id = `sources-${++sourcesCount}`;

  const head = document.createElement("div");
  head.className = "sources-title";
  head.innerHTML =
    '<svg class="icon icon-neon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>';
  const docs = groupByDocument(sources);
  head.append(`Источники (${docs.length})`);         // сколько документов в окне

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn-ghost btn-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", id);
  toggle.innerHTML =
    '<svg class="icon icon-neon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const label = document.createElement("span");
  label.textContent = "Показать";
  toggle.append(label);
  toggle.addEventListener("click", () => {
    const open = list.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Скрыть" : "Показать";
  });
  head.append(toggle);
  list.append(head);

  const items = document.createElement("div");
  items.className = "sources-items";
  items.id = id;
  // Один документ — один раздел окна: название, одна кнопка «Скачать документ» и список его пунктов.
  for (const doc of docs) {
    const item = document.createElement("div");
    item.className = "source";
    const top = document.createElement("div");
    top.className = "source-head";
    const name = document.createElement("div");
    name.className = "source-name";
    name.textContent = doc.name;
    top.append(name);
    if (doc.url) top.append(downloadLink(doc.url, doc.name));

    const points = document.createElement("ul");
    points.className = "source-points";
    for (const p of doc.points) {
      const li = document.createElement("li");
      li.className = "source-point";
      const tag = document.createElement("span");
      tag.className = "point-label";
      tag.textContent = p.label;
      const text = document.createElement("p");
      text.className = "source-text";
      text.append(highlight(p.fragment, words));
      li.append(tag, text);
      points.append(li);
    }
    item.append(top, points);
    items.append(item);
  }
  list.append(items);
  return list;
}

// «Правила приёма 2026, п. 2.8» → документ «Правила приёма 2026» и пункт «п. 2.8».
// Фрагменты одного документа (одна ссылка на PDF) собираем вместе; пункты — по порядку номеров.
function groupByDocument(sources) {
  const docs = new Map();
  for (const s of sources) {
    const m = s.title.match(/^(.*?),\s*((?:п\.|пп\.|стр\.|раздел|глава|приложение)\s*.*)$/i);
    const name = m ? m[1] : s.title;
    const label = m ? m[2] : "фрагмент";
    const url = s.url && s.url !== "#" ? s.url : "";
    const key = url || name;
    if (!docs.has(key)) docs.set(key, { name, url, points: [] });
    docs.get(key).points.push({ label, fragment: s.fragment });
  }
  for (const d of docs.values()) {
    d.points.sort((a, b) => a.label.localeCompare(b.label, "ru", { numeric: true }));
  }
  return [...docs.values()];
}

// «Скачать документ» — весь PDF приёмной комиссии по ссылке с сайта МГТУ (а не найденные фрагменты).
function downloadLink(url, title) {
  const a = document.createElement("a");
  a.className = "btn-ghost btn-download";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.download = "";
  a.title = `Скачать полный документ: ${title}`;
  a.innerHTML =
    '<svg class="icon icon-neon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
  a.append("Скачать документ");
  return a;
}

function renderAnswer(data, question) {
  const words = keywords(question);
  const box = document.createDocumentFragment();
  box.append(highlight(data.answer, words));

  if (data.sources?.length) box.append(renderSources(data.sources, words));
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

const NOT_FOUND_TEXT = "Не нашёл ответа в документах. Попробуйте переформулировать вопрос.";
const ERROR_TEXT = "Не удалось получить ответ. Проверьте соединение и попробуйте ещё раз.";
const ROBOT_TIMEOUT_MS = 7000;   // робот не вернулся за это время — показываем ответ сами

async function ask(question) {
  welcome?.remove();
  const userMsg = addMessage("msg-user", question);
  button.disabled = true;
  const llm = llmSelect.value;

  // Робот (robot.js) может унести копию вопроса и сам принести ответ — тогда он ставит accepted = true.
  // Робота нет (телефон, узкое окно, «уменьшить движение») — accepted остаётся false.
  const robot = { from: userMsg, text: question, accepted: false };
  window.dispatchEvent(new CustomEvent("robot:search", { detail: robot }));
  // Ответ несёт робот — вместо «Ищу ответ…» пустое невидимое место, куда прилетит карточка.
  const pending = robot.accepted
    ? addMessage("msg-bot msg-slot", "")
    : addMessage("msg-bot msg-loading", "Ищу ответ в документах…");

  let show, text;
  let found = false;
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, llm }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const empty = !data.answer && !data.sources?.length;
    found = Boolean(data.answer && data.sources?.length);
    text = empty ? NOT_FOUND_TEXT : data.answer;
    show = () => {
      pending.classList.remove("msg-loading", "msg-slot");
      pending.textContent = "";
      if (empty) pending.textContent = NOT_FOUND_TEXT;
      else pending.append(renderAnswer(data, question));
    };
  } catch (err) {
    console.error(err);
    text = ERROR_TEXT;
    show = () => {
      pending.className = "msg msg-bot msg-error";
      pending.textContent = ERROR_TEXT;
    };
  }
  deliver(robot, { found, text, target: pending, show });
}

// Показ ответа: без робота — сразу; с роботом — когда он вернётся и «отдаст» карточку
// (robot.js сам вызовет deliver), но не позже ROBOT_TIMEOUT_MS.
function deliver(robot, { found, text, target, show }) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    finish.done = true;          // робот видит, что ответ уже показан, и не несёт карточку
    show();
    unfold(target);
    button.disabled = false;
    input.focus();
  };
  if (!robot.accepted) {
    finish();
    return;
  }
  setTimeout(finish, ROBOT_TIMEOUT_MS);
  window.dispatchEvent(new CustomEvent("robot:result", { detail: { found, text, target, deliver: finish } }));
}

// Ответ раскрывается из левого верхнего угла, где села пустая карточка робота (robot.js, fly):
// сначала вправо до своей ширины, потом вниз. clip-path только обрезает видимую часть,
// текст при этом не перестраивается.
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
function unfold(el) {
  if (REDUCED_MOTION.matches || !el.isConnected) return;
  const { width, height } = el.getBoundingClientRect();
  const right = Math.max(0, width - 320);    // 320 px — ширина летящей карточки
  const below = Math.max(0, height - 46);    // 46 px — её высота (с запасом)
  el.animate([
    { clipPath: `inset(0 ${right}px ${below}px 0 round 14px)` },
    { clipPath: `inset(0 0 ${below}px 0 round 14px)`, offset: 0.35 },
    { clipPath: "inset(0 0 0 0 round 14px)" },
  ], { duration: 700, easing: "cubic-bezier(.4,0,.2,1)" });
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
