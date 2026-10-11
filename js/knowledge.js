/*
 * SafeBite: knowledge base + rules engine
 * ---------------------------------------
 * Runs fully in the browser (and in Node for testing).
 * Three jobs:
 *   1. ALLERGENS / CONDITIONS: what we know about each allergen and its other names.
 *   2. parseMenu(): turn raw menu text into a list of dishes.
 *   3. analyzeDish(): compare one dish with the user's profile and return
 *      "avoid" (red), "ask" (yellow) or "safe" (green) with reasons.
 *
 * Golden rule: missing information is never treated as safe.
 */
(function (root) {
  "use strict";

  // ---------- 1. Data ----------
  const ALLERGENS = {
    peanut: {
      label: "Peanuts",
      terms: ["peanut", "peanut butter", "groundnut", "ground nut", "arachis", "monkey nut", "satay"],
    },
    treenut: {
      label: "Tree nuts",
      terms: ["almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut",
        "pine nut", "marzipan", "praline", "nutella", "gianduja", "badam", "kaju", "pista", "mixed nuts", "nut"],
    },
    milk: {
      label: "Milk",
      terms: ["milk", "cream", "butter", "buttermilk", "ghee", "cheese", "paneer", "curd", "yogurt", "yoghurt",
        "dahi", "lassi", "raita", "whey", "casein", "caseinate", "lactose", "custard", "ice cream", "kulfi",
        "malai", "khoa", "khoya", "mawa", "mozzarella", "parmesan", "cheddar", "ricotta", "burrata", "feta",
        "bechamel", "mascarpone", "milkshake", "condensed milk"],
    },
    egg: {
      label: "Eggs",
      terms: ["egg", "mayo", "mayonnaise", "aioli", "albumen", "meringue", "omelette", "omelet", "frittata",
        "hollandaise", "egg wash", "scrambled", "poached"],
    },
    wheat: {
      label: "Wheat / gluten",
      terms: ["wheat", "gluten", "flour", "maida", "atta", "bread", "breadcrumb", "breadcrumbs", "crumbed",
        "naan", "roti", "chapati", "chapathi", "paratha", "puri", "bhatura", "kulcha", "pasta", "noodle",
        "noodles", "spaghetti", "macaroni", "couscous", "semolina", "rava", "sooji", "suji", "bulgur",
        "barley", "rye", "seitan", "batter", "tempura", "pizza", "bun", "wrap", "wrapper", "pita", "croissant",
        "pastry", "tortilla", "sandwich", "toast"],
    },
    soy: {
      label: "Soy",
      terms: ["soy", "soya", "soybean", "tofu", "edamame", "miso", "tempeh", "tamari", "soy sauce", "teriyaki",
        "soya chunks", "meal maker"],
    },
    fish: {
      label: "Fish",
      terms: ["fish", "salmon", "tuna", "cod", "anchovy", "anchovies", "sardine", "mackerel", "hilsa", "pomfret",
        "seer", "basa", "tilapia", "trout", "fish sauce", "worcestershire", "fish fry"],
    },
    shellfish: {
      label: "Shellfish",
      terms: ["shrimp", "prawn", "prawns", "crab", "lobster", "crayfish", "squid", "calamari", "clam", "oyster",
        "mussel", "scallop", "cuttlefish", "shellfish", "seafood", "octopus"],
    },
    sesame: {
      label: "Sesame",
      terms: ["sesame", "tahini", "til", "gingelly", "benne", "sesame oil", "gomashio"],
    },
    mustard: {
      label: "Mustard",
      terms: ["mustard", "mustard seed", "mustard oil", "sarson", "kasundi"],
    },
  };

  const CONDITIONS = [
    { id: "asthma", label: "Asthma" },
    { id: "diabetes", label: "Diabetes" },
    { id: "celiac", label: "Celiac disease", adds: ["wheat"] },
    { id: "lactose", label: "Lactose intolerance", adds: ["milk"] },
    { id: "heart", label: "Heart condition" },
    { id: "bp", label: "High blood pressure" },
  ];

  // Dishes that usually contain an allergen even if the menu does not say so.
  // These only ever create YELLOW ("ask the chef"), never RED, because it is a guess.
  const HINTS = [
    [/pad thai/, ["peanut", "egg", "fish", "shellfish", "soy"]],
    [/caesar/, ["egg", "fish", "milk", "wheat"]],
    [/pesto/, ["treenut", "milk"]],
    [/pizza/, ["wheat", "milk"]],
    [/lasagn|lasagna/, ["wheat", "milk", "egg"]],
    [/pasta|spaghetti|penne|fettuccine|macaroni/, ["wheat", "egg"]],
    [/burger/, ["wheat", "sesame", "egg"]],
    [/sandwich|sub\b|wrap\b|roll\b/, ["wheat"]],
    [/tiramisu|cheesecake|brownie|cake|pudding|waffle|pancake/, ["milk", "egg", "wheat"]],
    [/cookie|biscuit|muffin|croissant|donut|doughnut/, ["wheat", "milk", "egg"]],
    [/butter chicken|tikka masala|makhani|korma|malai/, ["milk", "treenut"]],
    [/biryani|pulao/, ["milk"]],
    [/samosa|kachori|puff|pakora|bhaji|pav\b/, ["wheat"]],
    [/pav bhaji/, ["wheat", "milk"]],
    [/gulab jamun|jalebi|rasmalai|rasgulla|halwa|barfi|burfi|ladoo|laddu|mysore pak/, ["milk", "wheat", "treenut"]],
    [/kheer|payasam|phirni|rabri/, ["milk", "treenut"]],
    [/pongal/, ["milk", "treenut"]],
    [/rasam|sambar|poriyal|kootu/, ["mustard"]],
    [/chicken 65|gobi 65|paneer 65|fry\b.*65/, ["egg", "wheat"]],
    [/fried rice/, ["soy", "egg"]],
    [/noodle|hakka|chow mein|ramen/, ["wheat", "soy", "egg"]],
    [/manchurian|chilli chicken|chili chicken|chilli paneer|chili paneer/, ["soy", "wheat", "egg"]],
    [/sushi|sashimi|maki/, ["fish", "soy", "sesame"]],
    [/falafel|hummus|shawarma|baklava/, ["sesame", "wheat"]],
    [/fish and chips|fish fry|fish curry/, ["fish", "wheat"]],
    [/curry|gravy|masala/, ["treenut"]],
    [/cutlet|nugget|fritter/, ["wheat", "egg"]],
    [/dessert|sundae|milkshake|shake\b|smoothie/, ["milk"]],
  ];

  const CLAIM_MAP = {
    gluten: ["wheat"], wheat: ["wheat"], dairy: ["milk"], lactose: ["milk"], milk: ["milk"],
    nut: ["peanut", "treenut"], nuts: ["peanut", "treenut"], peanut: ["peanut"], peanuts: ["peanut"],
    tree: ["treenut"], egg: ["egg"], eggs: ["egg"], soy: ["soy"], soya: ["soy"], fish: ["fish"],
    shellfish: ["shellfish"], sesame: ["sesame"], mustard: ["mustard"],
  };

  // Words that name the allergen itself (as opposed to foods that usually contain it).
  const CORE = { wheat: ["wheat", "gluten"], milk: ["milk", "dairy"], treenut: ["nut", "nuts"] };

  // Plain items where an empty description is not a worry.
  const SAFE_BASICS = ["steamed rice", "plain rice", "boiled rice", "white rice", "fresh fruit", "sliced fruit",
    "black coffee", "black tea", "water", "mineral water", "soda water"];

  const UNCLEAR_RE = /\b(sauce|gravy|dressing|marinade|marinated|glaze|paste|seasoning|spice mix|special blend|house blend|secret)\b/;
  const SUGAR_RE = /\b(sugar|syrup|honey|jaggery|sweet|dessert|cake|brownie|ice cream|halwa|kheer|payasam|gulab jamun|jalebi|pudding|chocolate|caramel|sundae|milkshake)\b/;

  const SAMPLE_MENU = [
    "STARTERS",
    "Paneer Tikka - cottage cheese marinated in yogurt and spices, grilled in the tandoor 180",
    "Chicken 65 - crisp fried chicken with curry leaves 220",
    "Veg Spring Rolls - cabbage and carrot in a wheat wrapper 150",
    "MAINS",
    "Pad Thai - rice noodles, tamarind sauce, bean sprouts 280",
    "Vegetable Biryani - basmati rice with seasonal vegetables and saffron 240",
    "Steamed Rice 90",
    "Dal Tadka - yellow lentils tempered with cumin and garlic, cooked in sunflower oil 160",
    "Chef's Special Curry 260",
    "DESSERTS",
    "Gulab Jamun 120",
    "Fresh Fruit Plate - seasonal fruit, no added sugar 130",
    "Peanut Butter Brownie - with vanilla ice cream 190",
  ].join("\n");

  const DEMO_PROFILE = {
    name: "Sample user", age: 24, email: "sample@example.com",
    emergency: { name: "Sample contact", phone: "+91 90000 00000", relation: "Parent" },
    allergens: ["peanut", "milk"], other: [], severity: "severe", conditions: ["diabetes"], otherConditions: "",
  };

  // ---------- 2. Helpers ----------
  function normalize(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function cap(s) {
    s = String(s || "").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Remove look-alikes that would cause false alarms, e.g. "peanut butter" is not dairy.
  function prep(s) {
    let t = normalize(s);
    t = t.replace(/\b(coconut|almond|oat|rice|soy|soya|cashew)\s+(milk|cream|butter)\b/g, "$1 drink");
    t = t.replace(/\b(peanut|almond|cashew|nut|cocoa|shea)\s+butter\b/g, "$1 spread");
    t = t.replace(/\bbutter\s+beans?\b/g, "lima beans");
    t = t.replace(/\bcream\s+of\s+tartar\b/g, "tartar");
    return t;
  }

  // Pull out claims like "gluten-free" or "no nuts" so they are not mistaken for ingredients.
  function extractClaims(t) {
    const claims = [];
    let clean = t.replace(/\b([a-z]+)[- ]free\b/g, function (m, w) { claims.push(w); return " "; });
    clean = clean.replace(/\b(?:no|without|free of|free from)\s+(?:added\s+)?([a-z]+)/g, function (m, w) { claims.push(w); return " "; });
    return { clean: clean, claims: claims };
  }

  const reCache = {};
  function termRegex(terms) {
    const key = terms.join("|");
    if (!reCache[key]) {
      const sorted = terms.slice().sort(function (a, b) { return b.length - a.length; });
      reCache[key] = new RegExp("\\b(?:" + sorted.map(escapeRe).join("|") + ")(?:es|s)?\\b", "g");
    }
    return reCache[key];
  }
  function findTerms(text, terms) {
    const re = termRegex(terms);
    re.lastIndex = 0;
    const found = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      if (found.indexOf(m[0]) === -1) found.push(m[0]);
    }
    return found;
  }

  // Allergens to avoid = what the user picked + what their conditions imply + custom words.
  function effectiveAvoid(profile) {
    const keys = new Set(profile.allergens || []);
    const via = {};
    (profile.conditions || []).forEach(function (id) {
      const c = CONDITIONS.find(function (x) { return x.id === id; });
      if (c && c.adds) c.adds.forEach(function (k) { if (!keys.has(k)) { keys.add(k); via[k] = c.label; } });
    });
    const list = [];
    keys.forEach(function (k) {
      if (ALLERGENS[k]) list.push({ key: k, label: ALLERGENS[k].label, terms: ALLERGENS[k].terms, via: via[k] || null });
    });
    (profile.other || []).forEach(function (w) {
      const t = normalize(w).trim();
      if (t) list.push({ key: "custom:" + t, label: cap(w), terms: [t], via: null });
    });
    return list;
  }

  function claimKeys(word, avoid) {
    const keys = (CLAIM_MAP[word] || []).slice();
    avoid.forEach(function (a) {
      if (a.key.indexOf("custom:") === 0 && a.terms[0] === word) keys.push(a.key);
    });
    return keys;
  }

  // ---------- 3. Menu parsing ----------
  const CURRENCY = /(?:₹|rs\.?|inr|\$|€|£)/i;

  function parseMenu(text) {
    const lines = String(text || "").split(/\r?\n/)
      .map(function (l) { return l.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
    const dishes = [];

    lines.forEach(function (raw) {
      let line = raw;
      let price = null;

      // Strip a trailing price. Two-digit numbers are only treated as prices when they
      // follow at least two words, so "Chicken 65" keeps its name.
      const m = line.match(/^(.*?)[\s.:\-–]*((?:₹|rs\.?|inr|\$|€|£)?\s*)(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:\/-|₹|\.00)?$/i);
      if (m && m[1].trim()) {
        const num = m[3];
        const digits = num.replace(/\D/g, "").length;
        const words = m[1].trim().split(" ").filter(Boolean).length;
        const hasCur = CURRENCY.test(m[2]) || CURRENCY.test(line.slice(m[1].length));
        if (hasCur || /[.,]/.test(num) || digits >= 3 || (digits === 2 && words >= 2)) {
          price = num;
          line = m[1].trim();
        }
      }

      const letters = (line.match(/[a-z]/gi) || []).length;
      if (letters < 3) return;
      if (/^(menu|page \d+|thank you|gst|tax|service charge|all prices)/i.test(line)) return;
      // Section headers: ALL CAPS, short, no price.
      if (!price && line === line.toUpperCase() && line.split(" ").length <= 3) return;

      const prev = dishes[dishes.length - 1];
      const continues = prev && (/^[a-z]/.test(line) || /[,&]$|\b(and|with|in|of)$/i.test(prev.description || ""));
      if (continues) {
        prev.description = (prev.description ? prev.description + " " : "") + line;
        if (price && !prev.price) prev.price = price;
        return;
      }

      let name = line, description = "";
      const sep = line.match(/^(.+?)\s*(?:\s[-–—]\s|:\s|\s\()(.+)$/);
      if (sep) {
        name = sep[1].trim();
        description = sep[2].replace(/\)\s*$/, "").trim();
      }
      dishes.push({ name: name, description: description, price: price });
    });

    return dishes;
  }

  // ---------- 4. The rules ----------
  function hintFor(name, key) {
    for (let i = 0; i < HINTS.length; i++) {
      if (HINTS[i][0].test(name) && HINTS[i][1].indexOf(key) !== -1) return true;
    }
    return false;
  }

  function analyzeDish(dish, profile) {
    const avoid = effectiveAvoid(profile);
    const nName = prep(dish.name);
    const nDesc = prep(dish.description || "");
    const full = nName + " . " + nDesc;
    const extracted = extractClaims(full);
    const clean = extracted.clean;

    const reasons = [];
    const matched = [];
    let red = false, yellow = false;

    avoid.forEach(function (a) {
      const hits = findTerms(clean, a.terms);
      // "Gluten-free bread" lists bread and flour, but the menu claims it is safe.
      // Unless the allergen's own name appears, show yellow instead of red.
      const claimed = extracted.claims.some(function (w) { return claimKeys(w, avoid).indexOf(a.key) !== -1; });
      const core = CORE[a.key] || [a.terms[0]];
      const strong = hits.some(function (h) {
        return core.some(function (c) { return h === c || h === c + "s" || h === c + "es"; });
      });
      if (hits.length && claimed && !strong) {
        yellow = true;
        reasons.push({ level: "yellow", text: "The menu says it is free of " + a.label.toLowerCase() + " but also lists " + hits.join(", ") + ". Confirm with the chef." });
        return;
      }
      if (hits.length) {
        red = true;
        hits.forEach(function (h) { if (matched.indexOf(h) === -1) matched.push(h); });
        reasons.push({ level: "red", text: "Contains " + a.label.toLowerCase() + " (" + hits.join(", ") + ")." + (a.via ? " Added because of " + a.via.toLowerCase() + "." : "") });
        return;
      }
      if (hintFor(nName, a.key)) {
        yellow = true;
        reasons.push({ level: "yellow", text: "This dish often contains " + a.label.toLowerCase() + ", but the menu does not say. Ask the chef." });
      }
      extracted.claims.forEach(function (word) {
        if (claimKeys(word, avoid).indexOf(a.key) !== -1) {
          yellow = true;
          reasons.push({ level: "yellow", text: "The menu says \"" + word + "-free\" or \"no " + word + "\". Confirm it with the chef." });
        }
      });
    });

    if (!red && UNCLEAR_RE.test(clean)) {
      yellow = true;
      reasons.push({ level: "yellow", text: "Includes a sauce or marinade with no ingredients listed." });
    }

    const hasDescription = nDesc.replace(/[^a-z]/g, "").length >= 6;
    const isBasic = SAFE_BASICS.indexOf(nName.trim()) !== -1;
    if (!red && !yellow) {
      if (isBasic) {
        reasons.push({ level: "green", text: "A plain item with no listed allergen from your profile." });
      } else if (!hasDescription) {
        yellow = true;
        reasons.push({ level: "yellow", text: "The menu lists no ingredients for this dish. Ask the chef." });
      } else {
        reasons.push({ level: "green", text: "No allergen from your profile appears in the ingredients listed." });
      }
    }

    const tags = [];
    if ((profile.conditions || []).indexOf("diabetes") !== -1 && SUGAR_RE.test(clean)) {
      tags.push("Sweet dish: check against your diabetes plan");
    }

    return {
      name: dish.name,
      description: dish.description || "",
      price: dish.price || null,
      status: red ? "avoid" : yellow ? "ask" : "safe",
      reasons: reasons,
      matched: matched,
      tags: tags,
    };
  }

  function analyzeMenu(text, profile) {
    const dishes = parseMenu(text).map(function (d) { return analyzeDish(d, profile); });
    const counts = { avoid: 0, ask: 0, safe: 0 };
    dishes.forEach(function (d) { counts[d.status]++; });
    return { dishes: dishes, counts: counts };
  }

  const api = {
    ALLERGENS: ALLERGENS, CONDITIONS: CONDITIONS, SAMPLE_MENU: SAMPLE_MENU, DEMO_PROFILE: DEMO_PROFILE,
    normalize: normalize, parseMenu: parseMenu, analyzeDish: analyzeDish, analyzeMenu: analyzeMenu,
    effectiveAvoid: effectiveAvoid,
  };
  root.SafeBite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
