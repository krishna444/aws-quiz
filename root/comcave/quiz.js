const cfg = window.QUIZ_CONFIG || {};

// --- SUPABASE INITIALIZATION ---
const supabaseUrl = 'https://qlotppkpldbtokjlavbk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsb3RwcGtwbGRidG9ramxhdmJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNDAxOTgsImV4cCI6MjEwNzkxNjE5OH0.te_hXIg6SrYzy0NnHjUymjn_d1nYX80xpqZ5uVZVYW0';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

let BANK = [];
let BY_ID = new Map();
let currentUser = null;
let state = { answers: {}, session: null };
/** @type {number[]|null} selected option indices while answering */
let draftChoices = null;
let listLimit = 40;

function toCorrectArray(c) {
  if (Array.isArray(c)) return c.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (c == null) return [];
  return [Number(c)].filter(n => !isNaN(n));
}

function normalizeBank(raw) {
  if (!Array.isArray(raw)) throw new Error("Question file must be a JSON array");
  return raw.map(function (q) {
    const correct = toCorrectArray(q.correct);
    return {
      id: q.examId != null ? q.examId : q.id,
      category: q.category || "Uncategorized",
      question: q.question,
      options: q.options || [],
      correct: correct,
      isMulti: correct.length > 1,
      explanation: q.explanation || ""
    };
  });
}

function setBank(raw) {
  BANK = normalizeBank(raw);
  BY_ID = new Map(BANK.map(function (q) { return [q.id, q]; }));
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lettersFor(indices) {
  return (indices || []).map(i => "ABCDEFGHIJKLMNOP"[i] || "?").join(", ");
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
  multiHint: document.getElementById("multi-hint"),
  options: document.getElementById("options"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  submit: document.getElementById("submit"),
  explain: document.getElementById("explain"),
  explainBox: document.getElementById("explain-box"),
  back: document.getElementById("back"),
  login: document.getElementById("login"),
  logoutBtn: document.getElementById("logout-btn"),
  userName: document.getElementById("user-name")
};

// --- REMOTE STATE MANAGEMENT ---

async function loadRemoteState() {
  if (!currentUser) return { answers: {}, session: null };

  const { data, error } = await supabaseClient
    .from('user_progress')
    .select('state')
    .eq('user_id', currentUser.id)
    .eq('quiz_category', cfg.storageKey)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error("Error loading state:", error);
  }

  return data?.state || { answers: {}, session: null };
}

async function saveState() {
  if (!currentUser) return;

  const { error } = await supabaseClient
    .from('user_progress')
    .upsert({
      user_id: currentUser.id,
      quiz_category: cfg.storageKey,
      state: state,
      updated_at: new Date().toISOString()
    });

  if (error) console.error("Error saving state:", error);
}

// --- QUIZ LOGIC & UI ---

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

function markdownToHtml(md) {
  if (!md) return "";
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
    let t = escapeHtml(s);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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

    const section = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (section) {
      out.push('<p class="section-title">' + inlineFormat("**" + section[1] + "**") + "</p>");
      continue;
    }

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
    const multiBadge = q.isMulti ? '<span class="pill warn">Multi</span>' : '';
    const badge = saved
      ? '<span class="pill ' + (saved.correct ? "good" : "bad") + '">' + (saved.correct ? "Correct" : "Incorrect") + " · already answered</span>"
      : '<span class="pill">Not answered</span>';
    btn.innerHTML = '<div class="meta"><span class="pill">#' + q.id + '</span><span class="pill">' + escapeHtml(q.category) + '</span>' + multiBadge + badge + '</div><div>' + escapeHtml(clip(q.question, 220)) + '</div>';
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
    draftChoices = null;
    showQuiz();
    saveState();
  } catch (err) {
    console.error(err);
    els.hint.textContent = "Could not start the quiz: " + (err && err.message ? err.message : err);
  }
}

function resumeQuiz() {
  if (!state.session || !state.session.ids || !state.session.ids.length) return;
  const pending = state.session.pending;
  const qid = state.session.ids[state.session.index];
  if (pending && pending.examId === qid && Array.isArray(pending.choices)) {
    draftChoices = pending.choices.slice();
  } else {
    draftChoices = null;
  }
  showQuiz();
}

function showSetup() {
  if (els.quiz) els.quiz.classList.add("hidden");
  if (els.setup) els.setup.classList.remove("hidden");
  if (els.login) els.login.classList.add("hidden");
  renderResults();
}

function showQuiz() {
  if (els.setup) els.setup.classList.add("hidden");
  if (els.quiz) els.quiz.classList.remove("hidden");
  if (els.login) els.login.classList.add("hidden");
  renderQuestion();
}

function currentQuestion() {
  const s = state.session;
  if (!s) return null;
  const id = s.ids[s.index];
  return BY_ID.get(id) || null;
}

function getDraftSorted() {
  if (!draftChoices || !draftChoices.length) return [];
  return draftChoices.slice().sort((a, b) => a - b);
}

function renderQuestion() {
  const q = currentQuestion();
  const s = state.session;
  if (!q || !s) { showSetup(); return; }
  const total = s.ids.length;
  const n = s.index + 1;
  const saved = answerOf(q.id);
  const multi = q.isMulti;

  els.meta.innerHTML =
    '<span class="pill">Question ' + n + ' of ' + total + '</span> ' +
    '<span class="pill">' + escapeHtml(q.category) + '</span> ' +
    '<span class="pill">#' + q.id + '</span>' +
    (multi ? ' <span class="pill warn">Multi-select</span>' : '');

  els.bar.style.width = Math.round((n / total) * 100) + "%";
  els.qtext.textContent = q.question;

  if (els.multiHint) {
    if (multi && !saved) {
      els.multiHint.textContent = "Select all that apply (" + q.correct.length + " correct)";
      els.multiHint.classList.remove("hidden");
    } else {
      els.multiHint.classList.add("hidden");
    }
  }

  els.options.innerHTML = "";
  const locked = !!saved;
  const selectedSet = locked
    ? new Set(Array.isArray(saved.choice) ? saved.choice : [saved.choice])
    : new Set(draftChoices || []);
  const correctSet = new Set(q.correct);

  q.options.forEach((text, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opt " + (multi ? "multi" : "single");
    const marker = document.createElement("span");
    marker.className = "opt-marker";
    marker.textContent = multi ? "✓" : "";
    const span = document.createElement("span");
    span.className = "opt-text";
    span.textContent = text;
    b.appendChild(marker);
    b.appendChild(span);
    b.disabled = locked;

    if (locked) {
      if (correctSet.has(idx)) b.classList.add("correct");
      if (selectedSet.has(idx) && !correctSet.has(idx)) b.classList.add("wrong");
      if (selectedSet.has(idx)) b.classList.add("selected");
    } else if (selectedSet.has(idx)) {
      b.classList.add("selected");
    }

    b.addEventListener("click", () => {
      if (locked) return;
      if (multi) {
        if (!draftChoices) draftChoices = [];
        const pos = draftChoices.indexOf(idx);
        if (pos >= 0) draftChoices.splice(pos, 1);
        else draftChoices.push(idx);
        if (draftChoices.length === 0) draftChoices = null;
      } else {
        draftChoices = [idx];
      }
      s.pending = { examId: q.id, choices: draftChoices ? draftChoices.slice() : null };
      saveState();
      renderQuestion();
    });
    els.options.appendChild(b);
  });

  if (locked) {
    els.banner.classList.remove("hidden");
    const userLetters = lettersFor(Array.isArray(saved.choice) ? saved.choice : [saved.choice]);
    const correctLetters = lettersFor(q.correct);
    els.banner.className = "banner " + (saved.correct ? "good" : "bad");
    if (saved.correct) {
      els.banner.textContent = "Already answered — correct (" + userLetters + "). This question is locked.";
    } else {
      els.banner.textContent = "Already answered — incorrect (you chose " + userLetters + ", correct is " + correctLetters + "). This question is locked.";
    }
    els.submit.disabled = true;
    els.submit.textContent = "Answer locked";
    els.explain.disabled = false;
  } else {
    els.banner.classList.add("hidden");
    els.banner.textContent = "";
    const hasSelection = draftChoices && draftChoices.length > 0;
    els.submit.disabled = !hasSelection;
    els.submit.textContent = multi ? "Submit answers" : "Submit answer";
    els.explain.disabled = true;
    hideExplanation();
  }
  els.prev.disabled = s.index <= 0;
  els.next.disabled = s.index >= total - 1;
}

function submitAnswer() {
  const q = currentQuestion();
  if (!q || answerOf(q.id) || !draftChoices || draftChoices.length === 0) return;

  const chosen = draftChoices.slice().sort((a, b) => a - b);
  const isCorrect = arraysEqual(chosen, q.correct);

  state.answers[String(q.id)] = {
    choice: chosen,
    correct: isCorrect,
    at: Date.now()
  };
  if (state.session) state.session.pending = null;
  draftChoices = null;
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
  if (s.pending && s.pending.examId === qid && Array.isArray(s.pending.choices)) {
    draftChoices = s.pending.choices.slice();
  } else {
    draftChoices = null;
  }
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
  if (!els.explainBox.classList.contains("hidden")) {
    hideExplanation();
    return;
  }
  const text = (q.explanation || "").trim();
  els.explainBox.innerHTML = "";
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

// --- EVENT LISTENERS ---

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
  draftChoices = null;
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
  const num = { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "a": 0, "b": 1, "c": 2, "d": 3, "e": 4, "f": 5 }[e.key.toLowerCase()];
  if (num !== undefined) {
    const q = currentQuestion();
    if (!q || answerOf(q.id) || num >= q.options.length) return;
    if (q.isMulti) {
      if (!draftChoices) draftChoices = [];
      const pos = draftChoices.indexOf(num);
      if (pos >= 0) draftChoices.splice(pos, 1);
      else draftChoices.push(num);
      if (draftChoices.length === 0) draftChoices = null;
    } else {
      draftChoices = [num];
    }
    state.session.pending = { examId: q.id, choices: draftChoices ? draftChoices.slice() : null };
    saveState();
    renderQuestion();
  }
});

// --- BOOTSTRAPPING & AUTH FLOW ---

function boot() {
  if (els.hint) els.hint.textContent = "";

  if (cfg.label) {
    const set = document.getElementById("quiz-set");
    if (set) set.textContent = cfg.label;
    document.title = "Practice Quiz — " + cfg.label;
  }
  categories();
  stats();
  if (state.session && state.session.ids && state.session.ids.length) {
    if (state.session.category) els.category.value = state.session.category;
    if (state.session.search) els.search.value = state.session.search;
    resumeQuiz();
  } else {
    showSetup();
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
    throw new Error("Open these files through a local web server, or choose the JSON file below.");
  }
  const res = await fetch(cfg.bankUrl, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load " + cfg.bankUrl + " (" + res.status + ")");
  useBank(await res.json());
}

async function loginWithGoogle() {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href
    }
  });
}

async function loginWithGitHub() {
  await supabaseClient.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: window.location.href
    }
  });
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.reload();
}

async function handleAuth() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (session) {
    currentUser = session.user;
    const displayName = currentUser.user_metadata?.full_name ||
                        currentUser.user_metadata?.name ||
                        currentUser.email;

    if (els.userName) els.userName.textContent = "Welcome, " + displayName;
    if (els.hint) els.hint.textContent = "Loading your progress...";

    if (els.logoutBtn) els.logoutBtn.classList.remove("hidden");

    state = await loadRemoteState();

    // Migrate old single-choice answers to array form if needed
    if (state.answers) {
      for (const id of Object.keys(state.answers)) {
        const a = state.answers[id];
        if (a && !Array.isArray(a.choice) && typeof a.choice === "number") {
          a.choice = [a.choice];
        }
      }
    }

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

  } else {
    if (els.setup) els.setup.classList.add("hidden");
    if (els.quiz) els.quiz.classList.add("hidden");
    if (els.login) els.login.classList.remove("hidden");
    if (els.userName) els.userName.textContent = "";
    if (els.logoutBtn) els.logoutBtn.classList.add("hidden");
    if (els.hint) els.hint.textContent = "Please log in to continue.";
  }

  supabaseClient.auth.onAuthStateChange((event, newSession) => {
    if ((event === 'SIGNED_IN' && !currentUser) || event === 'SIGNED_OUT') {
      window.location.reload();
    }
  });
}

// Start the app sequence by checking auth first
document.addEventListener('DOMContentLoaded', handleAuth);

// Mobile header hamburger menu
(function setupHeaderMenu() {
  const header = document.querySelector("header");
  const toggle = document.getElementById("menu-toggle");
  if (!header || !toggle) return;

  function closeMenu() {
    header.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  }

  function openMenu() {
    header.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close menu");
  }

  toggle.addEventListener("click", function () {
    if (header.classList.contains("menu-open")) closeMenu();
    else openMenu();
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth >= 768) closeMenu();
  });
})();