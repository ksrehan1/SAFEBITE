/*
 * SafeBite: app logic (the "front end")
 * -------------------------------------
 * Plain JavaScript, no framework. The page has four views that are shown one at a time:
 *   home -> profile -> scan -> results
 * State lives in one object. The profile is saved in localStorage so it survives a refresh.
 */
(function () {
  "use strict";

  const SB = window.SafeBite;
  const Scanner = window.SafeBiteScanner;

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  const NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "safebite.profile.v1";

  const state = {
    profile: null,   // the user's saved profile (or the demo profile)
    demo: false,     // true while viewing the sample profile
    dishes: [],      // analysed dishes from the last menu
    counts: { avoid: 0, ask: 0, safe: 0 },
    filter: "all",
  };

  const STATUS = {
    avoid: { label: "Avoid", icon: "avoid" },
    ask: { label: "Ask the chef", icon: "ask" },
    safe: { label: "Looks safe", icon: "safe" },
  };

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- storage ----------
  function loadProfile() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function saveProfile(p) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  function deleteProfile() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ---------- small DOM helpers ----------
  function icon(name) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function chip(status) {
    const c = el("span", "chip chip-" + status);
    c.appendChild(icon(STATUS[status].icon));
    c.appendChild(document.createTextNode(STATUS[status].label));
    return c;
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Put text into an element, wrapping any matched allergen words in <mark>.
  function highlightInto(node, text, terms) {
    if (!terms.length) { node.textContent = text; return; }
    const sorted = terms.slice().sort(function (a, b) { return b.length - a.length; });
    const re = new RegExp("\\b(?:" + sorted.map(escapeRe).join("|") + ")\\b", "gi");
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.textContent = m[0];
      node.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
  }

  // ---------- navigation ----------
  const VIEWS = {
    home: { title: "SafeBite", focus: "#main" },
    profile: { title: "Your profile", focus: "#profile-title" },
    scan: { title: "Add a menu", focus: "#scan-title" },
    results: { title: "Your results", focus: "#results-title" },
  };

  function canOpen(name) {
    if (name === "scan") return !!state.profile;
    if (name === "results") return state.dishes.length > 0;
    return true;
  }

  function go(name) {
    if (!VIEWS[name] || !canOpen(name)) name = state.profile ? "scan" : "profile";
    Object.keys(VIEWS).forEach(function (v) { $("#view-" + v).hidden = v !== name; });
    $$(".nav-btn").forEach(function (b) {
      if (b.dataset.go === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.title = (name === "home" ? "SafeBite | Check a menu against your allergies" : "SafeBite | " + VIEWS[name].title);
    window.scrollTo(0, 0);
    const target = $(VIEWS[name].focus);
    if (target) target.focus({ preventScroll: true });
    updateNav();
  }

  function updateNav() {
    $$(".nav-btn").forEach(function (b) { b.disabled = !canOpen(b.dataset.go); });
    $("#home-cta").textContent = state.profile && !state.demo ? "Scan a menu" : "Set up my profile";
    $("#clear-data").hidden = !loadProfile();
  }

  // ---------- profile form ----------
  function buildChips() {
    const allergenBox = $("#allergen-chips");
    Object.keys(SB.ALLERGENS).forEach(function (key) {
      allergenBox.appendChild(chipInput("allergen", key, SB.ALLERGENS[key].label));
    });
    const condBox = $("#condition-chips");
    SB.CONDITIONS.forEach(function (c) {
      condBox.appendChild(chipInput("condition", c.id, c.label));
    });
  }
  function chipInput(name, value, label) {
    const wrap = el("label", "chip-input");
    const input = document.createElement("input");
    input.type = "checkbox"; input.name = name; input.value = value;
    wrap.appendChild(input);
    wrap.appendChild(el("span", null, label));
    return wrap;
  }

  function fillForm(p) {
    const f = $("#profile-form");
    f.elements.name.value = p.name || "";
    f.elements.age.value = p.age || "";
    f.elements.email.value = p.email || "";
    f.elements.ecName.value = (p.emergency && p.emergency.name) || "";
    f.elements.ecPhone.value = (p.emergency && p.emergency.phone) || "";
    f.elements.ecRel.value = (p.emergency && p.emergency.relation) || "";
    f.elements.other.value = (p.other || []).join(", ");
    f.elements.otherConditions.value = p.otherConditions || "";
    $$('input[name="allergen"]').forEach(function (i) { i.checked = (p.allergens || []).indexOf(i.value) !== -1; });
    $$('input[name="condition"]').forEach(function (i) { i.checked = (p.conditions || []).indexOf(i.value) !== -1; });
    $$('input[name="severity"]').forEach(function (i) { i.checked = i.value === (p.severity || "moderate"); });
  }

  function collectForm() {
    const f = $("#profile-form");
    const sev = $('input[name="severity"]:checked');
    return {
      name: f.elements.name.value.trim(),
      age: parseInt(f.elements.age.value, 10),
      email: f.elements.email.value.trim(),
      emergency: {
        name: f.elements.ecName.value.trim(),
        phone: f.elements.ecPhone.value.trim(),
        relation: f.elements.ecRel.value.trim(),
      },
      allergens: $$('input[name="allergen"]:checked').map(function (i) { return i.value; }),
      other: f.elements.other.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10),
      severity: sev ? sev.value : "moderate",
      conditions: $$('input[name="condition"]:checked').map(function (i) { return i.value; }),
      otherConditions: f.elements.otherConditions.value.trim(),
    };
  }

  function validate(p) {
    const errors = {};
    if (!p.name) errors.name = "Enter your name.";
    if (!(p.age >= 1 && p.age <= 120)) errors.age = "Enter an age between 1 and 120.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) errors.email = "Enter a valid email address, like name@example.com.";
    if (!p.emergency.name) errors.ecName = "Enter your emergency contact's name.";
    if (p.emergency.phone.replace(/\D/g, "").length < 7) errors.ecPhone = "Enter a phone number with at least 7 digits.";
    const impliesAllergen = p.conditions.indexOf("celiac") !== -1 || p.conditions.indexOf("lactose") !== -1;
    if (!p.allergens.length && !p.other.length && !impliesAllergen) {
      errors.allergens = "Pick at least one allergen, or type your own.";
    }
    return errors;
  }

  const FIELD_IDS = { name: "f-name", age: "f-age", email: "f-email", ecName: "f-ec-name", ecPhone: "f-ec-phone" };

  function showErrors(errors) {
    ["name", "age", "email", "ecName", "ecPhone", "allergens"].forEach(function (k) {
      const box = $("#err-" + k);
      const input = FIELD_IDS[k] ? $("#" + FIELD_IDS[k]) : null;
      if (errors[k]) {
        box.textContent = errors[k]; box.hidden = false;
        if (input) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", box.id); }
      } else {
        box.hidden = true;
        if (input) { input.removeAttribute("aria-invalid"); input.removeAttribute("aria-describedby"); }
      }
    });
    const firstKey = Object.keys(errors)[0];
    if (firstKey) {
      const target = FIELD_IDS[firstKey] ? $("#" + FIELD_IDS[firstKey]) : $("#allergen-chips input");
      if (target) target.focus();
    }
  }

  function onProfileSubmit(e) {
    e.preventDefault();
    const p = collectForm();
    const errors = validate(p);
    showErrors(errors);
    if (Object.keys(errors).length) return;
    saveProfile(p);
    state.profile = p;
    state.demo = false;
    state.dishes = [];
    go("scan");
  }

  function onClearData() {
    if (!window.confirm("Delete your saved profile from this device?")) return;
    deleteProfile();
    state.profile = null; state.demo = false; state.dishes = [];
    $("#profile-form").reset();
    go("home");
  }

  // ---------- scanning ----------
  function setMessage(text, kind) {
    const box = $("#scan-message");
    box.textContent = "";
    if (!text) { box.hidden = true; return; }
    box.className = "notice" + (kind === "error" ? " error" : "");
    box.textContent = text;
    box.hidden = false;
  }
  function setProgress(text, pct) {
    const box = $("#scan-progress");
    if (text == null) { box.hidden = true; return; }
    box.hidden = false;
    $("#scan-status").textContent = text;
    $("#scan-bar").value = pct || 0;
  }

  function showQrLink(url) {
    const box = $("#scan-message");
    box.className = "notice";
    box.textContent = "";
    box.appendChild(document.createTextNode("This QR code opens a website, and a browser cannot read other websites for you. "));
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.textContent = "Open the menu page";
    box.appendChild(a);
    box.appendChild(document.createTextNode(", then copy the menu text into the box below or take a screenshot and upload it."));
    box.hidden = false;
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type || file.type.indexOf("image/") !== 0) {
      setMessage("That file is not an image. Choose a JPG or PNG photo of the menu.", "error");
      return;
    }
    setMessage("");
    setProgress("Opening the image...", 5);
    $("#dropzone").setAttribute("aria-busy", "true");
    try {
      const result = await Scanner.scanImage(file, function (p, status) {
        setProgress("Reading the menu... " + Math.round(p * 100) + "%", 10 + p * 90);
      });
      setProgress(null);
      if (result.type === "qr") {
        if (/^https?:\/\//i.test(result.value)) { showQrLink(result.value); return; }
        $("#menu-text").value = result.value;
        setMessage("QR code read. Check the text below, then check the menu.");
      } else {
        const text = result.value.replace(/\n{3,}/g, "\n\n").trim();
        if (!text) {
          setMessage("No text was found in that photo. Try a sharper, well-lit photo, or type the menu below.", "error");
          return;
        }
        $("#menu-text").value = text;
        setMessage("Menu read. Fix anything that looks wrong below, then check the menu.");
      }
      $("#menu-text").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    } catch (err) {
      setProgress(null);
      setMessage((err && err.message ? err.message + " " : "") + "You can still paste the menu text below.", "error");
    } finally {
      $("#dropzone").removeAttribute("aria-busy");
    }
  }

  function onAnalyse() {
    const text = $("#menu-text").value.trim();
    if (!text) { setMessage("Add some menu text first. Upload a photo, or type one dish per line.", "error"); return; }
    runAnalysis(text);
  }

  function runAnalysis(text) {
    const result = SB.analyzeMenu(text, state.profile);
    if (!result.dishes.length) {
      setMessage("No dishes were found. Put each dish on its own line, like: Dal Tadka - lentils, cumin, garlic.", "error");
      return false;
    }
    state.dishes = result.dishes;
    state.counts = result.counts;
    state.filter = "all";
    renderResults();
    go("results");
    return true;
  }

  // ---------- results ----------
  function renderResults() {
    const avoid = SB.effectiveAvoid(state.profile).map(function (a) { return a.label.toLowerCase(); });
    $("#results-sub").textContent = "Checked " + state.dishes.length + " dishes for: " + avoid.join(", ") + ".";
    $("#demo-banner").hidden = !state.demo;
    renderSummary();
    renderDishes();
  }

  function renderSummary() {
    const box = $("#summary");
    box.textContent = "";
    const defs = [
      ["all", "All dishes", state.dishes.length],
      ["avoid", "Avoid", state.counts.avoid],
      ["ask", "Ask the chef", state.counts.ask],
      ["safe", "Looks safe", state.counts.safe],
    ];
    defs.forEach(function (d) {
      const b = el("button", "filter f-" + d[0]);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.filter === d[0]));
      b.appendChild(el("b", null, String(d[2])));
      b.appendChild(document.createTextNode(d[1]));
      b.addEventListener("click", function () {
        state.filter = d[0];
        renderSummary();
        renderDishes();
      });
      box.appendChild(b);
    });
  }

  function renderDishes() {
    const list = $("#dish-list");
    list.textContent = "";
    const shown = state.dishes.filter(function (d) { return state.filter === "all" || d.status === state.filter; });
    if (!shown.length) {
      list.appendChild(el("li", "empty", "No dishes in this group."));
      return;
    }
    const severe = state.profile.severity === "severe";
    shown.forEach(function (d) {
      const li = el("li", "dish is-" + d.status);

      const head = el("div", "dish-head");
      const titleBox = el("div");
      const h3 = el("h3");
      highlightInto(h3, d.name, d.matched);
      titleBox.appendChild(h3);
      if (d.price) titleBox.appendChild(el("p", "dish-price", "Price on menu: " + d.price));
      head.appendChild(titleBox);
      head.appendChild(chip(d.status));
      li.appendChild(head);

      if (d.description) {
        const p = el("p", "dish-desc");
        highlightInto(p, d.description, d.matched);
        li.appendChild(p);
      }

      const ul = el("ul", "reasons");
      d.reasons.forEach(function (r) { ul.appendChild(el("li", null, r.text)); });
      li.appendChild(ul);

      d.tags.forEach(function (t) { li.appendChild(el("span", "tag", t)); });

      if (severe && d.status === "ask") {
        li.appendChild(el("p", "severe-note", "Your profile says reactions can be severe. Do not order this unless the chef confirms."));
      }
      list.appendChild(li);
    });
  }

  // ---------- allergy card ----------
  function openCard() {
    const p = state.profile;
    if (!p) return;
    const body = $("#card-body");
    body.textContent = "";
    const h2 = el("h2", null, "Food allergy alert");
    h2.id = "card-title";
    body.appendChild(h2);
    const avoid = SB.effectiveAvoid(p).map(function (a) { return a.label; });
    body.appendChild(el("p", "big", "I am allergic to: " + avoid.join(", ") + ". Please check every ingredient and avoid cross-contact."));

    const dl = el("dl");
    function row(k, v) { dl.appendChild(el("dt", null, k)); const dd = el("dd"); if (typeof v === "string") dd.textContent = v; else dd.appendChild(v); dl.appendChild(dd); }
    row("Name", p.name);
    row("Age", String(p.age));
    row("Reaction", { mild: "Mild", moderate: "Moderate", severe: "Severe (anaphylaxis)" }[p.severity] || "Moderate");
    const conds = (p.conditions || []).map(function (id) {
      const c = SB.CONDITIONS.find(function (x) { return x.id === id; });
      return c ? c.label : id;
    });
    if (p.otherConditions) conds.push(p.otherConditions);
    if (conds.length) row("Conditions", conds.join(", "));
    const phone = (p.emergency.phone || "").replace(/[^\d+]/g, "");
    const a = el("a", null, p.emergency.phone);
    a.href = "tel:" + phone;
    const contact = el("span");
    contact.appendChild(document.createTextNode(p.emergency.name + (p.emergency.relation ? " (" + p.emergency.relation + ") " : " ")));
    contact.appendChild(a);
    row("Emergency contact", contact);
    body.appendChild(dl);

    const dlg = $("#card-dialog");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  // ---------- demo ----------
  function startDemo() {
    state.profile = JSON.parse(JSON.stringify(SB.DEMO_PROFILE));
    state.demo = true;
    runAnalysis(SB.SAMPLE_MENU);
  }

  // ---------- wiring ----------
  function init() {
    buildChips();

    const saved = loadProfile();
    if (saved) { state.profile = saved; fillForm(saved); }

    $$("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.dataset.go); });
    });
    $("#home-cta").addEventListener("click", function () { go(state.profile && !state.demo ? "scan" : "profile"); });
    $("#home-sample").addEventListener("click", startDemo);
    $("#profile-form").addEventListener("submit", onProfileSubmit);
    // Clear a field's error as soon as the user edits it.
    $("#profile-form").addEventListener("input", function (e) {
      const key = Object.keys(FIELD_IDS).filter(function (k) { return FIELD_IDS[k] === e.target.id; })[0];
      if (key) {
        $("#err-" + key).hidden = true;
        e.target.removeAttribute("aria-invalid");
      }
      if (e.target.name === "allergen" || e.target.name === "other") $("#err-allergens").hidden = true;
    });
    $("#clear-data").addEventListener("click", onClearData);

    $("#file-camera").addEventListener("change", function (e) { handleFile(e.target.files[0]); e.target.value = ""; });
    $("#file-pick").addEventListener("change", function (e) { handleFile(e.target.files[0]); e.target.value = ""; });
    const dz = $("#dropzone");
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("is-over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("is-over"); });
    });
    dz.addEventListener("drop", function (e) { handleFile(e.dataTransfer.files[0]); });

    $("#analyse").addEventListener("click", onAnalyse);
    $("#use-sample").addEventListener("click", function () {
      $("#menu-text").value = SB.SAMPLE_MENU;
      setMessage("Sample menu added. Select Check this menu to see the results.");
    });
    $("#scan-another").addEventListener("click", function () { go("scan"); });
    $("#open-card").addEventListener("click", openCard);

    updateNav();
    go("home");
  }

  init();
})();
