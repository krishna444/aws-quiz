const cfg = window.QUIZ_CONFIG || {};
const STORAGE_KEY = cfg.storageKey || "quiz_grok_v1";
let BANK = [];
let BY_ID = new Map();

function normalizeBank(raw) {
  if (!Array.isArray(raw)) throw new Error("Question file must be a JSON array");
  return raw.map(function (q) {
    const correct = Array.isArray(q.correct) ? q.correct[0] : q.correct;
    return {
      id: q.examId != null ? q.examId : q.id,
      category: q.category,
      question: q.question,
      options: q.options,
      correct: correct,
      explanation: q.explanation || ""
    };
  });
}

function setBank(raw) {
  BANK = normalizeBank(raw);
  BY_ID = new Map(BANK.map(function (q) { return [q.id, q]; }));
}

const els = {
  attempted: document.getElementById("stat-attempted"),
  correct: document.getElementById("stat-correct"),
  accuracy: document.getElementById("stat-accuracy"),
  search: document.getElementById("search"),
  category: document.getElementById("category"),
  start: document.getElementById("start"),
  resume: document.getElementById("resume"),
  reset: document.getElementById("reset-answers"),
  hint: document.getElementById("filter-hint"),
  count: document.getElementById("match-count"),
  results: document.getElementById("results"),
  setup: document.getElementById("setup"),
  quiz: document.getElementById("quiz"),
  meta: document.getElementById("q-meta"),
  bar: document.getElementById("bar"),
  banner: document.getElementById("banner"),
  qtext: document.getElementById("q-text"),
  options: document.getElementById("options"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  submit: document.getElementById("submit"),
  explain: document.getElementById("explain"),
  explainBox: document.getElementById("explain-box"),
  back: document.getElementById("back"),
};

let memoryState = null;
function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) {
    try { sessionStorage.setItem(key, value); return true; }
    catch (e2) { return false; }
  }
}
function loadState() {
  memoryState = null;
  try {
    const raw = storageGet(STORAGE_KEY);
    if (!raw) return { answers: {}, session: null };
    const data = JSON.parse(raw);
    return {
      answers: data.answers && typeof data.answers === "object" ? data.answers : {},
      session: data.session || null,
    };
  } catch (e) {
    return { answers: {}, session: null };
  }
}
function saveState() {
  const ok = storageSet(STORAGE_KEY, JSON.stringify(state));
  if (!ok) memoryState = state;
}
let state = loadState();
let draftChoice = null;
let listLimit = 40;

function stats() {
  const ids = Object.keys(state.answers);
  const attempted = ids.length;
  const correct = ids.filter(id => state.answers[id].correct).length;
  els.attempted.textContent = String(attempted);
  els.correct.textContent = String(correct);
  els.accuracy.textContent = attempted ? Math.round((correct / attempted) * 100) + "%" : "0%";
}

function categories() {
  while (els.category.options.length > 1) els.category.remove(1);
  const counts = new Map();
  for (const q of BANK) counts.set(q.category, (counts.get(q.category) || 0) + 1);
  for (const [name, n] of [...counts.entries()].sort()) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name + " (" + n + ")";
    els.category.appendChild(opt);
  }
}

function matches() {
  const cat = els.category.value;
  const term = els.search.value.trim().toLowerCase();
  return BANK.filter(q => {
    if (cat && q.category !== cat) return false;
    if (!term) return true;
    const hay = (q.question + " " + q.options.join(" ") + " " + q.category).toLowerCase();
    return hay.includes(term);
  });
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function answerOf(id) {
  return state.answers[String(id)] || null;
}

function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({
      "&": "\u0026amp;",
      "<": "\u0026lt;",
      ">": "\u0026gt;",
      "\"": "\u0026quot;",
      "'": "\u0026#39;"
    })[c];
  });
}

/** Convert the quiz explanation markdown into safe HTML. */
function markdownToHtml(md) {
  if (!md) return "";
  // Normalize line endings and soft-wrapped breaks from JSON export
  let text = String(md).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = text.split("\n");
  const out = [];
  let inList = false;

  function closeList() {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  }

  function inlineFormat(s) {
    // Escape first, then restore intentional markdown
    let t = escapeHtml(s);
    // Inline code `code`
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold **text**
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Italic *text* (avoid list markers already handled)
    t = t.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    return t;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      closeList();
      continue;
    }

    // Bullet: * **A:** reason  or  * text
    const bullet = line.match(/^\*\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + inlineFormat(bullet[1]) + "</li>");
      continue;
    }

    closeList();

    // Section headers that are fully bold on one line, e.g. **Detailed Explanation:**
    const section = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (section) {
      out.push('<p class="section-title">' + inlineFormat("**" + section[1] + "**") + "</p>");
      continue;
    }

    // Domain line or normal paragraph
    out.push("<p>" + inlineFormat(line) + "</p>");
  }
  closeList();
  return out.join("");
}

function renderResults() {
  const list = matches();
  const term = els.search.value.trim();
  const cat = els.category.value;
  els.hint.textContent = cat
    ? "Category selected: questions stay in exam order. Already answered items stay locked."
    : "No category: Start Quiz shuffles a random order. Already answered items stay locked.";
  els.start.textContent = "Start Quiz (" + list.length + ")";
  els.start.disabled = list.length === 0;
  els.results.innerHTML = "";
  if (!term && !cat) {
    els.count.textContent = "Type in the search box to list matching questions, or pick a category. " + list.length + " questions available.";
    els.resume.classList.toggle("hidden", !state.session);
    return;
  }
  const show = list.slice(0, listLimit);
  els.count.textContent = list.length
    ? "Showing " + show.length + " of " + list.length + " questions" + (term ? " matching the search" : " in this category") + "."
    : "No questions match that search.";
  for (const q of show) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hit";
    const saved = answerOf(q.id);
    const badge = saved
      ? '<span class="pill ' + (saved.correct ? "good" : "bad") + '">' + (saved.correct ? "Correct" : "Incorrect") + " · already answered</span>"
      : '<span class="pill">Not answered</span>';
    btn.innerHTML = '<div class="meta"><span class="pill">#' + q.id + '</span><span class="pill">' + escapeHtml(q.category) + '</span>' + badge + '</div><div>' + escapeHtml(clip(q.question, 220)) + '</div>';
    btn.addEventListener("click", () => startQuiz({ focusId: q.id }));
    els.results.appendChild(btn);
  }
  if (show.length < list.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "ghost";
    more.textContent = "Show more (" + (list.length - show.length) + " remaining)";
    more.addEventListener("click", () => { listLimit += 40; renderResults(); });
    els.results.appendChild(more);
  }
  els.resume.classList.toggle("hidden", !state.session);
}

function startQuiz(opts) {
  opts = opts || {};
  try {
    const pool = matches();
    if (!pool.length) return;
    let ordered = els.category.value ? pool.slice() : shuffle(pool);
    if (opts.focusId) {
      const i = ordered.findIndex(q => q.id === opts.focusId);
      if (i > 0) {
        const [item] = ordered.splice(i, 1);
        ordered.unshift(item);
      }
    }
    state.session = {
      ids: ordered.map(q => q.id),
      index: 0,
      category: els.category.value,
      search: els.search.value.trim(),
      pending: null,
    };
    draftChoice = null;
    showQuiz();
    saveState();
  } catch (err) {
    console.error(err);
    els.hint.textContent = "Could not start the quiz: " + (err && err.message ? err.message : err);
  }
}

function resumeQuiz() {
  if (!state.session || !state.session.ids || !state.session.ids.length) return;
  draftChoice = state.session.pending && state.session.pending.examId === state.session.ids[state.session.index]
    ? state.session.pending.choice
    : null;
  showQuiz();
}

function showSetup() {
  els.quiz.classList.add("hidden");
  els.setup.classList.remove("hidden");
  renderResults();
}
function showQuiz() {
  els.setup.classList.add("hidden");
  els.quiz.classList.remove("hidden");
  renderQuestion();
}

function currentQuestion() {
  const s = state.session;
  if (!s) return null;
  const id = s.ids[s.index];
  return BY_ID.get(id) || null;
}

function renderQuestion() {
  const q = currentQuestion();
  const s = state.session;
  if (!q || !s) { showSetup(); return; }
  const total = s.ids.length;
  const n = s.index + 1;
  const saved = answerOf(q.id);
  els.meta.innerHTML = '<span class="pill">Question ' + n + ' of ' + total + '</span> <span class="pill">' + escapeHtml(q.category) + '</span> <span class="pill">#' + q.id + '</span>';
  els.bar.style.width = Math.round((n / total) * 100) + "%";
  els.qtext.textContent = q.question;
  els.options.innerHTML = "";
  const locked = !!saved;
  q.options.forEach((text, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt";
    b.textContent = text;
    b.disabled = locked;
    if (locked) {
      if (idx === q.correct) b.classList.add("correct");
      if (idx === saved.choice && idx !== q.correct) b.classList.add("wrong");
      if (idx === saved.choice) b.classList.add("selected");
    } else if (draftChoice === idx) {
      b.classList.add("selected");
    }
    b.addEventListener("click", () => {
      if (locked) return;
      draftChoice = idx;
      s.pending = { examId: q.id, choice: idx };
      saveState();
      renderQuestion();
    });
    els.options.appendChild(b);
  });
  if (locked) {
    els.banner.classList.remove("hidden");
    const letter = "ABCD"[saved.choice] || "?";
    const correctLetter = "ABCD"[q.correct];
    els.banner.className = "banner " + (saved.correct ? "good" : "bad");
    els.banner.textContent = saved.correct
      ? "Already answered — correct (" + letter + "). This question is locked."
      : "Already answered — incorrect (you chose " + letter + ", correct is " + correctLetter + "). This question is locked.";
    els.submit.disabled = true;
    els.submit.textContent = "Answer locked";
    els.explain.disabled = false;
  } else {
    els.banner.classList.add("hidden");
    els.banner.textContent = "";
    els.submit.disabled = draftChoice === null || draftChoice === undefined;
    els.submit.textContent = "Submit answer";
    els.explain.disabled = true;
    hideExplanation();
  }
  els.prev.disabled = s.index <= 0;
  els.next.disabled = s.index >= total - 1;
}

function submitAnswer() {
  const q = currentQuestion();
  if (!q || answerOf(q.id) || draftChoice === null || draftChoice === undefined) return;
  const correct = draftChoice === q.correct;
  state.answers[String(q.id)] = { choice: draftChoice, correct: correct, at: Date.now() };
  if (state.session) state.session.pending = null;
  draftChoice = null;
  saveState();
  stats();
  renderQuestion();
}

function move(delta) {
  const s = state.session;
  if (!s) return;
  const next = s.index + delta;
  if (next < 0 || next >= s.ids.length) return;
  s.index = next;
  const qid = s.ids[s.index];
  draftChoice = s.pending && s.pending.examId === qid ? s.pending.choice : null;
  hideExplanation();
  saveState();
  renderQuestion();
}

function hideExplanation() {
  els.explainBox.classList.add("hidden");
  els.explainBox.innerHTML = "";
}

function showExplanation() {
  const q = currentQuestion();
  if (!q || !answerOf(q.id)) return;
  // Toggle: second click hides the panel
  if (!els.explainBox.classList.contains("hidden")) {
    hideExplanation();
    return;
  }
  const text = (q.explanation || "").trim();
  //const label = document.createElement("span");
  //label.className = "explain-label";
  //label.textContent = "Explanation";
  els.explainBox.innerHTML = "";
  //els.explainBox.appendChild(label);
  if (!text) {
    const p = document.createElement("p");
    p.textContent = "No explanation has been added for this question yet.";
    els.explainBox.appendChild(p);
  } else {
    const body = document.createElement("div");
    body.innerHTML = markdownToHtml(text);
    els.explainBox.appendChild(body);
  }
  els.explainBox.classList.remove("hidden");
}

els.search.addEventListener("input", () => { listLimit = 40; renderResults(); });
els.category.addEventListener("change", () => { listLimit = 40; renderResults(); });
els.start.addEventListener("click", () => startQuiz());
els.resume.addEventListener("click", resumeQuiz);
els.back.addEventListener("click", showSetup);
els.prev.addEventListener("click", () => move(-1));
els.next.addEventListener("click", () => move(1));
els.submit.addEventListener("click", submitAnswer);
els.explain.addEventListener("click", showExplanation);
els.reset.addEventListener("click", () => {
  if (!confirm("Clear every saved answer and the in-progress quiz?")) return;
  state = { answers: {}, session: null };
  draftChoice = null;
  saveState();
  stats();
  showSetup();
});

document.addEventListener("keydown", (e) => {
  if (els.quiz.classList.contains("hidden")) return;
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.key === "ArrowRight") move(1);
  if (e.key === "ArrowLeft") move(-1);
  if (e.key === "Enter") submitAnswer();
  const num = { "1":0,"2":1,"3":2,"4":3,"a":0,"b":1,"c":2,"d":3 }[e.key.toLowerCase()];
  if (num !== undefined) {
    const q = currentQuestion();
    if (!q || answerOf(q.id)) return;
    draftChoice = num;
    state.session.pending = { examId: q.id, choice: num };
    saveState();
    renderQuestion();
  }
});

function boot() {
  if (cfg.label) {
    const set = document.getElementById("quiz-set");
    if (set) set.textContent = cfg.label;
    document.title = "SAA-C03 Practice Quiz — " + cfg.label;
  }
  categories();
  stats();
  if (state.session && state.session.ids && state.session.ids.length) {
    if (state.session.category) els.category.value = state.session.category;
    if (state.session.search) els.search.value = state.session.search;
    resumeQuiz();
  } else {
    renderResults();
  }
}

function useBank(raw) {
  setBank(raw);
  els.start.disabled = false;
  boot();
}

async function loadBank() {
  if (!cfg.bankUrl) throw new Error("No question file configured");
  if (location.protocol === "file:") {
    throw new Error("Open these files through a local web server, or choose the JSON file below. Browsers block a page opened from disk from reading the JSON next to it.");
  }
  const res = await fetch(cfg.bankUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load " + cfg.bankUrl + " (" + res.status + ")");
  useBank(await res.json());
}

els.start.disabled = true;
els.hint.textContent = "Loading questions…";
const fileInput = document.getElementById("bank-file");
const fileBtn = document.getElementById("pick-bank");
if (fileBtn && fileInput) {
  fileBtn.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        useBank(JSON.parse(String(reader.result)));
        fileBtn.classList.add("hidden");
      } catch (err) {
        els.hint.textContent = "That file could not be read: " + (err && err.message ? err.message : err);
      }
    };
    reader.readAsText(file);
  });
}

loadBank().catch(function (err) {
  console.error(err);
  els.hint.textContent = (err && err.message ? err.message : String(err));
  if (fileBtn) fileBtn.classList.remove("hidden");
});