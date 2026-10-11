# SafeBite

Check a restaurant menu against your allergies. Add a profile, upload a menu photo or QR code, and every dish comes back as:

- **Green, "Looks safe":** nothing from your profile appears in the ingredients the menu lists.
- **Yellow, "Ask the chef":** the menu is silent, vague, or the dish usually contains your allergen.
- **Red, "Avoid":** the menu names one of your allergens.

Missing information is never green.

> **A note on AI help.** This project was written with an AI assistant (Claude). Hackathons and institutions have different rules about AI tools, so check yours and say so if you are asked. The sections below exist so you can read, run, change and explain every part yourself.

---

## 1. Run it in VS Code

1. Install [VS Code](https://code.visualstudio.com/).
2. Open this folder: **File > Open Folder > `safebite`**.
3. Install the **Live Server** extension (Extensions icon, search "Live Server", Install).
4. Right-click `index.html` and choose **Open with Live Server**. It opens at `http://127.0.0.1:5500`.

No `npm install` and no build step. Double-clicking `index.html` also works.

**You need internet the first time** for three things loaded from CDNs: the fonts, the QR reader (jsQR) and the text reader (Tesseract.js). The sample menu and the rules work without the OCR libraries.

## 2. Folder map

```
safebite/
  index.html        The four screens (home, profile, scan, results) and the allergy-card dialog
  css/style.css     Colours, fonts, layout, components
  js/knowledge.js   Allergen data + menu parser + the green/yellow/red rules (the "brain")
  js/scanner.js     Photo -> QR code or text, using jsQR and Tesseract.js
  js/app.js         Navigation, form, saving, scanning, drawing the results
```

Load order matters (see the bottom of `index.html`): `knowledge.js`, then `scanner.js`, then `app.js`.

## 3. How it was built, step by step

Build in this order. After each step, open the browser and check that it works before moving on.

**Step 1: Decide the data.** Everything depends on the shape of a profile. It is one object:

```js
{ name, age, email,
  emergency: { name, phone, relation },
  allergens: ["peanut", "milk"],   // keys from ALLERGENS in knowledge.js
  other: ["kiwi"],                 // free-text allergens
  severity: "mild" | "moderate" | "severe",
  conditions: ["diabetes"],        // ids from CONDITIONS in knowledge.js
  otherConditions: "" }
```

**Step 2: Write the HTML skeleton (`index.html`).** One page, four `<section class="view">` blocks. Only one is visible at a time; JavaScript toggles the `hidden` attribute. Use real `<label>`s, `<fieldset>`s and `<button>`s, because they give you keyboard and screen-reader support for free.

**Step 3: Style it (`css/style.css`).** Start with the `:root` variables at the top (colours and fonts), then base styles, then one component at a time: buttons, chips, form fields, dropzone, dish cards. The three verdict colours always travel with an icon and a word, so colour-blind users are not left out.

**Step 4: Write the rules (`js/knowledge.js`).** This is the most important file. Read it in this order:

1. `ALLERGENS`: for each allergen, the words that mean it (milk: cream, butter, ghee, paneer, whey...).
2. `parseMenu(text)`: splits menu text into `{ name, description, price }`, ignoring section headings and prices.
3. `analyzeDish(dish, profile)`: the verdict. In plain English:
   - Any allergen word found in the name or description: **red**.
   - Otherwise, the dish is known to usually contain it (`HINTS`), or the menu says "nut-free" but lists suspicious words, or it has an unnamed sauce: **yellow**.
   - Otherwise, no description at all: **yellow**.
   - Otherwise: **green**.
4. `prep()` and `extractClaims()`: remove false alarms ("peanut butter" is not dairy, "gluten-free" is a claim, not an ingredient).

You can test this file without a browser: `node -e "const S=require('./js/knowledge.js'); console.log(S.analyzeMenu(S.SAMPLE_MENU, S.DEMO_PROFILE).counts)"`

**Step 5: Read the menu image (`js/scanner.js`).** `scanImage(file)` shrinks the photo onto a canvas, tries to find a QR code first, and if there is none, runs OCR. QR codes that contain a web address cannot be fetched from the browser (cross-origin rules), so the app tells the user to open the link and paste the text. That is a real browser limit, not a bug.

**Step 6: Connect everything (`js/app.js`).** Read it top to bottom: storage helpers, navigation (`go()`), profile form with validation, scanning, `renderResults()`, the allergy card, and `init()` at the bottom that wires up every button.

**Step 7: Test the awkward cases.** Submit the empty profile, upload a blurry photo, scan a QR that holds a URL, resize the window to phone width, and tab through the page with the keyboard.

## 4. Things to try changing (good for learning, and for a demo)

| Change | Where |
| --- | --- |
| New brand colour | `--brand` in `css/style.css` |
| Add an allergen (for example "celery") | Add an entry to `ALLERGENS` in `knowledge.js`. The profile chips are generated from that list. |
| Teach it a local dish | Add a line to `HINTS`, like `[/medu vada/, ["wheat"]]` |
| Make the severe-reaction warning stricter | The `severe` check in `renderDishes()` in `app.js` |

## 5. Honest limits

- The rules use keyword matching and a hand-written list of typical dishes. They are a prototype, not a medical or ingredient database.
- OCR quality depends on the photo. That is why the text box lets the user fix mistakes before checking.
- Profiles are saved in the browser (`localStorage`) and nothing is sent to a server. There is no real login, which is the right call for sensitive health data in a prototype.
- Menus rarely list every ingredient, cooking oil or shared equipment. The yellow rule and the disclaimer exist for that reason.

## 6. Connecting a backend later

If your teammate builds an API, replace `SB.analyzeMenu(text, profile)` in `runAnalysis()` (`app.js`) with a `fetch` call that returns the same shape: a list of dishes, each with `status` (`"safe" | "ask" | "avoid"`), `reasons`, `matched` and `tags`. The screens do not need to change.

## 7. Can you explain it? (checklist before you present)

- Why is a dish with no description yellow and not green?
- What does `extractClaims()` protect against?
- Why do `HINTS` only ever produce yellow?
- Where is the profile stored, and why is that a privacy benefit?
- What happens when the QR code holds a web address, and why?
- What would you change first with another day of work?
