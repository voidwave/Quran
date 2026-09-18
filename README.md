<div dir="rtl" align="center">

# بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْم

</div>

# القرآن الكريم — Quran Web App

A free and open web app for reading and listening to the Holy Quran: full Uthmani text, multiple tafsirs and translations, verse-by-verse audio from several reciters, powerful search, dark/light themes, and a fully responsive RTL interface.

> **Live demo:** https://voidwave.com/Quran/

---

## ✨ Features

- 📖 **Full Quran text** — Uthmani script for reading, with a diacritic-free copy used for search.
- 📚 **Multiple sources** — toggle any number of tafsirs and translations; each ayah shows one block per selected source in the order you picked them.
- 🎧 **Verse-by-verse audio** — several reciters, click any ayah to play it, plus continuous play that moves automatically through the ayahs and surahs.
- 🧠 **Memorisation mode (الحفظ)** — pick a surah and an ayah range, then recite from memory: the text stays hidden and each word reveals as you recite it, mistakes are highlighted and corrected. Live listening uses the browser's speech recognition (Chrome, Edge and Safari with internet); without it the page becomes a tap-to-reveal practice board.
- 🔍 **Search** — search the whole Quran (from 3 letters, debounced), with results rendered in pages so common words stay fast.
- 🎲 **Random ayah / random surah** — jump to a random place in the Quran with one click.
- 🌙 **Dark & light themes** — remembered between visits.
- 🌐 **Responsive & RTL** — built Arabic-first, works on desktop and mobile.
- 🔗 **Two views, one place** — switching between the reader and the printed Mushaf keeps the verse you are on, and the app opens again in the view, surah, ayah and page you left it in.
- ⬇️ **Download for offline use** — the تنزيل button in the tools menu saves the whole content (the six text files, the tafsirs, all 604 Mushaf pages with their fonts — about 124 MB) or one reciter's full recitation (567 MB – 1.4 GB). Downloads can be stopped and resumed, and deleted again to give the space back.
- 🚀 **Fast & static** — no build step, no backend; every file is served as-is. Tafsir/translation files are lazy-loaded only when selected.

## 📦 Data Sources & Credits

This project would not exist without these wonderful free resources:

| Content | Source |
| --- | --- |
| Quran text (Uthmani & simple), tafsirs and translations | [Tanzil.net](https://tanzil.net/) |
| Recited audio files | [VerseByVerseQuran.com](https://www.versebyversequran.com/) |

Please support and respect the terms of use of both websites when reusing their content.

## 🆓 Free to Use

This repository is **free to use** — you are welcome to read it, learn from it, copy it, modify it, and use it for your own projects (personal or commercial).

The Quran text, translations, tafsirs, and audio files belong to their respective sources ([Tanzil.net](https://tanzil.net/) and [VerseByVerseQuran.com](https://www.versebyversequran.com/)) and remain subject to their terms of use.

> أُسألُكم الدعاء — I ask only for your duaa. 🤲

## 🚀 Running Locally

The app loads its data with `fetch()`, so it needs to be served over HTTP (opening `index.html` directly with `file://` will not work).

```bash
node tools/serve.js        # default port 8123
node tools/serve.js 3000   # custom port
```

Then open http://localhost:8123/.

## 📁 Project Structure

```
index.html                          # the app (UI, styles, theme bootstrap)
index.js                            # app logic: text, sources, search, audio
index2.html                         # Mushaf view (all 604 pages in one endless scroll)
index2.js                           # its logic: glyph layer, page layout, copy, lazy pages
manifest.webmanifest                # PWA manifest (name, colours, icons)
pwa.js                              # service worker registration + install button
resume.js                           # shared: the view and place to come back to (localStorage)
offline.js                          # shared: downloads the content / one reciter for offline use
sw.js                               # service worker: offline caching
QuranHifz/                          # memorisation view ("الحفظ") + its ASR engines and dev tools
  memorize.html                     # the page: recite from memory, words revealed as matched
  memorize.js                       # its logic: rendering, practice mode, live recognition
  memorize-core.js                  # pure matching logic (normalizer, alignment, tracker)
  memorize-asr.js                   # on-device recognition engine (Whisper-Basira, WebGPU/WASM)
  memorize-asr-worker.js            # recognition worker (transformers.js + onnxruntime)
  tools/                            # dev tools: speech-spike.html, engine wrappers, model files
icons/                              # app icons (install / home screen)
QuranText/
  Quran/                            # Tanzil Quran text XML files
  Arabic-Tafsir/                    # Arabic tafsirs
  English-Translation/              # English translations
  Translations/                     # translations in all other languages
  catalog.json                      # index of available tafsirs/translations
flags/                              # flag images shown next to each source
fonts/                              # Uthmanic Hafs font
fonts/mushaf/                       # QPC page fonts + surah name cartouches
QuranText/MushafPages/              # per-page word data + index.json + verse-pages.json
tools/
  serve.js                          # local dev server
  download-tanzil-translations.ps1  # download/refresh tafsirs & translations
  build-reciter-list.ps1            # rebuild reciters.json of the audio page (../QuranAudio)
  build-mushaf-pages.mjs            # build the Mushaf page data + page fonts
  build-verse-pages.mjs             # verse -> page index, rebuilt from the page files (no network)
  icon.html                         # renders the PWA icons (screenshot source)
```

The recitations live on their own page next to the app — `voidwave.com/QuranAudio/` — holding `reciters.json` and one folder per reciter (`<sura3><ayah3>.mp3`, e.g. `002255.mp3`). Both views and the تنزيل download read them from `/QuranAudio/`, and `tools/serve.js` serves that folder under the same path while developing when it sits next to this project.

## 🛠️ Tools

```powershell
# refresh the Tanzil tafsir/translation files and the catalog
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\download-tanzil-translations.ps1

# rebuild reciters.json of the audio page (defaults to the ../QuranAudio folder)
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-reciter-list.ps1

# build the Mushaf page data and page fonts (whole Quran, or one chapter)
node tools/build-mushaf-pages.mjs all
node tools/build-mushaf-pages.mjs 18

# rebuild the verse -> page index the two views use to swap places
# (a whole-Quran build writes it too; this one needs no network)
node tools/build-verse-pages.mjs

# run the memorisation matcher's fixture tests (no browser needed)
node QuranHifz/tools/test-memorize-core.mjs
```

---

## 📖 Mushaf page view

`index2.html` draws the Quran the way the printed Mushaf does — all 604 pages in one endless scroll — with the same technique quran.com uses:

- Every **word** is one glyph of a per-page font (`fonts/mushaf/p<page>.woff2`), so a word is a single vector shape in its exact printed form while the page still behaves like text.
- The words of a printed line are spread over the full page width, so the text breaks exactly where the printed page breaks (15 lines a page, two of which a surah banner takes). The glyph size follows the sheet proportion of the print, so every page of the Quran is laid out identically.
- The real ʿUthmānī word is kept behind every glyph: selection stops at word boundaries, and the copy handler puts the real words on the clipboard — copying gives you `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ`, never code points.
- Scrolling is endless in both directions, on desktop and on mobile: pages are drawn only while they are near the viewport, so carrying the whole Quran on one scroll costs no extra memory.
- The view switch (**القارئ / المصحف / الحفظ**) moves between the pages around the same verse: the Mushaf opens on the page the verse is printed on and puts its line at the top, the reader opens on the same ayah, marked with a short flash, and the memorisation view keeps its own surah/ayah range. `resume.js` remembers the view that was used last, so the installed app comes back to it — the reader on the ayah it was on, the Mushaf on its page and line — and a reload of either page comes back to the line it was left on.
- Dark and light themes cover the pages themselves: dark paper with light ink in the dark theme (a word is a vector outline, so only the paper and the ink change) and cream paper with dark ink in the light theme; switching the theme also recolours the pages already on screen, with no redraw.
- The app bar keeps only what reading needs — the surah picker, the page pager, the listen button and the القارئ/المصحف switch — and tucks the reciter picker, the random surah and the theme into a tools menu on small screens (on wide ones they stay inline). It also slides away by itself a couple of seconds after you stop scrolling, and returns on the next scroll, touch or hover.
- Pressing **التلاوة** recites from the verse you have selected (or from the word whose card is open), and from the first verse of the page when nothing is selected. Every surah banner carries its own small play button that recites that surah from its first ayah. Both use the same recitation files and reciters as the app (served from the `/QuranAudio/` page next to it): the recited verse is highlighted, the view follows the recitation from page to page, each surah is opened with its basmala (surah 9 has none) and a missing file is skipped with a message, exactly like `index.js`.
- A word's meaning, transliteration and recitation are one click away.

`node tools/build-mushaf-pages.mjs all` fetches every printed page — its words, glyph code points, printed line numbers, real text and word audio — into `QuranText/MushafPages/` (around 93 MB of page fonts, a few minutes). Pass a chapter number instead to build just that chapter while developing. The fonts belong to the King Fahd Complex (served through quran.com) and are downloaded here for local development — check the [QUL](https://qul.tarteel.ai) licence before publishing.

---

## 🧠 Memorisation mode

`QuranHifz/memorize.html` is the third view next to the reader and the Mushaf. Pick a surah and the ayah range you want to practise, press the microphone and start reciting: every word stays hidden until it is recognised, wrong or skipped words are highlighted with the correct text, and the page keeps its place when you repeat, jump ahead or start the passage over.

- **How the matching works** — the verse text is known in advance, so the page never has to transcribe you perfectly: `memorize-core.js` folds the expected words and the recognised ones to diacritic-free Arabic, scores word pairs with the Levenshtein distance and aligns the heard sequence to the text with a modified Needleman-Wunsch pass (the approach Tarteel-style recitation trackers use). An omitted word becomes "unclear", a wrong word is shown together with what was heard, and a jump to another place in the range is found with a full-range search. When a recognizer blurs the ending or the article of a right word («الصالحات» heard as «الصالحين» or «صالحه») the word still settles — dotted underline and a note naming what was heard — so a wrong ending stays visible and a right recitation is never refused for a guessed ending. A letter replaced, dropped or added is a different word, though — «أنعمت» heard as «أنقمت»، «مالك» as «مالكم» — and is treated as a mistake, never accepted: apart from the alef spellings and the ending rescue above, matching is exact. `node QuranHifz/tools/test-memorize-core.mjs` runs the fixture scenarios — skipped words, wrong words, repeats, jumps, noise — without a browser.
- **Speech recognition** — live listening runs fully on-device, offline after the one-time model download, with the phoneme engine as the default and the compact FastConformer **int8** build (WebAssembly — `QuranHifz/ort-nemo-asr.js`) as the word-recognition alternative offered in the settings. The newer **v8** CTC exports (from `Muno459/fastconformer-quran`; NPL-1.1 — non-commercial, weights are gated) remain in the codebase as dormant code, still fetched by `node QuranHifz/tools/fetch-asr-models.mjs` once the license is accepted, and they carry the upstream `tajweed/` module — the 27-rule tajweed engine, GOP and pronunciation-head scorers — as reference for the planned in-browser tajweed pass, and the same pipeline now runs in the browser: `QuranHifz/quran-gop.js` force-aligns the expected uthmani words against the model's own log-probabilities (blank-interleaved CTC trellis, the upstream formulas) and grades every reference word with per-token GOP margins. Tokenization is an exact offline precompute (`word-ids.json` — this vocabulary's SentencePiece BPE cannot be replayed from piece scores alone, so every Quran word's ids are baked from the real tokenizer, word-independent since no piece spans a space). Calibration on canonical reciter audio showed the raw margins still mix in token-segmentation artefacts (the model's natural pieces differ from the reference spelling on some words, giving −20-size margins on perfect recitation), so the margins travel in the transcript metadata (`meta.gopWords`) but never dot a word yet. The check that does judge a settled word is the harakat comparison in `memorize-core.js`: the short-vowel signature (fatha/damma/kasra/sukun) of what was decoded is compared with the expected word — «مَلِكْ» heard for «مَـٰلِكِ» gets the dotted «راجع النطق» note naming both vowel reads — and it measured zero false alarms on canonical recitation. The phoneme checker ships **Quran-Lab/zipformer_p-arabic-v3.1** (NPL-1.2 — no-profit, weights gated) in two exports chosen in the settings: **int8** (default) and **fp32** (~263 MB); its `tokens.txt` is the same 250-unit alphabet our canonical tables were built for, so the tables and the whole comparison pipeline serve both exports. The worker loads them from the site when present and falls back to the project mirror on Hugging Face otherwise (the `voidwaveDev/phoneme-v3` repo — GitHub cannot host the larger exports). Each export feeds the card's exact kaldi fbank (mel 20–7600, centred `snip_edges=False` frames) and carries a per-unit confidence margin (`margin_peak`: peak probability minus the runner-up at the unit's peak frame). Measured on the repository's own hostile clips, v3 corrects every documented base-model error — Sudais 1:4 «مَ اا لِ كِ» (base: «لَ اا لِ كِ»), Sudais 1:6 «صصِ رَ اا طَ» (base: «حِ رَ اا طَ»), Maher 1:7 «غَ ي رِ … غ ضُ … ضضَ اااااا» (base blurred غ/ض), and the full basmala tail. Automatic tajweed feedback can be wrong and does not replace a qualified teacher. If the fp32 file is absent the checker falls back to int8 automatically. The settings offer a second engine, «الفونيمات فقط»: the phoneme zipformer (`QuranHifz/phoneme-asr-worker.js`) hears the sound units themselves and drives the tracking by aligning them with the canonical phoneme tables in `QuranText/QuranPhonemes/` (built from the MIT `quran-transcript`), flagging vowel, shadda and wrong-letter deviations on the words; with the FastConformer engine the same checker can run alongside via «مدقّق النطق».
- **Practice without a microphone** — everywhere else, and offline, the same page is a practice board: tap a hidden word to see its first letter, tap it again to reveal it fully, and tap a revealed word once more to hear its pronunciation — the same word-by-word recording the Mushaf view plays (streamed, so it needs a connection).
- **Settings** — the recognition engine (phoneme-only with the v3.1 int8/fp32 exports — the default — or FastConformer int8), correction style (show the word right away, or a first-letter hint first), hide mode (fully hidden or softly blurred) and automatic following of the current word; all kept in `localStorage` under `quran-memorize`.

---

## 📲 Install as an app (PWA)

The site is a Progressive Web App: open it in Chrome, Edge or Safari and choose **Install** (or **Add to Home Screen**) to keep it as a standalone app with its own icon. Chromium browsers on Android and desktop also show an **تثبيت التطبيق** button in the tools menu (⋮) of both pages once the browser offers the installation.

- `manifest.webmanifest` declares the app (name, colours, icons). The icons in `icons/` are rendered by `tools/icon.html` — open it in the browser and screenshot it at each size when they need to change.
- `sw.js` caches the app shell up front, then the Quran text, Mushaf page data, fonts and recitation on demand, so whatever has been read or played once keeps working offline. Data and audio each have their own byte budget (150 MB, oldest files evicted first); files downloaded on purpose are pinned and never evicted. The recitations sit on their own page (`/QuranAudio/`), outside the worker's scope, so the pages themselves cache and serve them (`audio.js`) — into the same audio cache and budget.
- `pwa.js` registers the worker and adds the install button on both pages; `offline.js` adds the تنزيل panel that fills the caches with everything the app needs, so the installed app works with no network at all. It also works in a normal tab, since both share the same caches.

Deploying works as usual (copy the folder): the browser picks new files up on the next visit, and a hard reload (Ctrl+Shift+R) re-fetches everything and refreshes the caches. Bump `VERSION` in `sw.js` only when its caching rules change.

---

<div dir="rtl">

# بالعربية

<div align="center">

## بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْم

</div>

تطبيق ويب مجاني ومفتوح لقراءة القرآن الكريم والاستماع إليه: النص القرآني كاملًا بالرسم العثماني، مع التفاسير والترجمات المتعددة، والتلاوة آية بآية بعدة قرّاء، وبحث سريع، ووضع ليلي/نهاري، وواجهة عربية متجاوبة بالكامل.

## ✨ المزايا

- 📖 **نص القرآن كامل** — بالرسم العثماني للقراءة، ونسخة مُجرّدة من التشكيل لأغراض البحث.
- 📚 **مصادر متعددة** — اختر أي عدد من التفاسير والترجمات، ويظهر لكل آية قسم لكل مصدر محدَّد بترتيب اختيارك.
- 🎧 **تلاوة آية بآية** — عدة قرّاء، اضغط على أي آية لتشغيلها، مع تشغيل متواصل ينتقل تلقائيًا بين الآيات والسور.
- 🧠 **وضع الحفظ** — اختر سورة ونطاق آيات ثم اتلُ من حفظك: يبقى النص مخفيًا وتُكشف الكلمات كلمةً كلمة مع تلاوتك، وتُبرَز الأخطاء وتُصحَّح. يعمل الاستماع المباشر بتعرّف الصوت في المتصفح (Chrome وEdge وSafari مع اتصال بالإنترنت)، وفي غيرها تتحول الصفحة إلى لوحة تدريب باللمس.
- 🔍 **البحث** — ابحث في القرآن كاملًا (من ثلاثة أحرف فأكثر)، وتُعرض النتائج على صفحات ليبقى البحث سريعًا.
- 🎲 **آية عشوائية / سورة عشوائية** — انتقل إلى موضع عشوائي من القرآن بضغطة واحدة.
- 🌙 **الوضع الليلي والنهاري** — مع تذكّر اختيارك بين الزيارات.
- 🌐 **متجاوب ودعم كامل للعربية** — صُمِّم للعربية أولًا، ويعمل على الحاسوب والجوال.
- 🚀 **سريع وثابت** — بدون خطوات بناء ولا خوادم؛ تُقدَّم الملفات كما هي، وتُحمَّل ملفات التفاسير والترجمات عند اختيارها فقط.

## 📦 المصادر والشكر

هذا المشروع ما كان ليوجد لولا هذه الموارد المجانية القيّمة:

| المحتوى | المصدر |
| --- | --- |
| النص القرآني (العثماني والمبسّط) والتفاسير والترجمات | [Tanzil.net](https://tanzil.net/) |
| ملفات التلاوة الصوتية | [VerseByVerseQuran.com](https://www.versebyversequran.com/) |

يُرجى دعم الموقعين والالتزام بشروط الاستخدام الخاصة بهما عند إعادة استخدام محتواهما.

## 🆓 مجاني للاستخدام

هذا المستودع **مجاني للاستخدام** — يمكنك قراءته والتعلّم منه ونسخه وتعديله واستخدامه في مشاريعك الشخصية أو التجارية.

أما النص القرآني والترجمات والتفاسير وملفات التلاوة فهي ملك لمصادرها ([Tanzil.net](https://tanzil.net/) و[VerseByVerseQuran.com](https://www.versebyversequran.com/)) وتخضع لشروط الاستخدام الخاصة بها.

> أُسألُكم الدعاء 🤲

## 🚀 التشغيل محليًا

يعتمد التطبيق على `fetch()` لتحميل بياناته، لذا يجب تقديمه عبر HTTP (فتح `index.html` مباشرة عبر `file://` لن يعمل).

```bash
node tools/serve.js        # المنفذ الافتراضي 8123
node tools/serve.js 3000   # منفذ مخصص
```

ثم افتح http://localhost:8123/.

## 📁 هيكل المشروع

```
index.html                          # التطبيق (الواجهة والأنماط وتفعيل الثيم)
index.js                            # منطق التطبيق: النص والمصادر والبحث والصوت
index2.html                         # عرض المصحف (٦٠٤ صفحات في تمرير واحد)
index2.js                           # منطقها: طبقة الرسوم والتوزيع والنسخ والتمرير اللانهائي
QuranHifz/                          # عرض الحفظ ومحرّكات التعرّف عليه
  memorize.html                     # الصفحة: اتلُ من حفظك وتُكشف الكلمات
  memorize.js                       # منطقه: العرض ووضع التدريب والاستماع المباشر
  memorize-core.js                  # منطق المطابقة الصافي (التطبيع والموازنة والمتابعة)
  memorize-asr.js                   # محرّك التعرّف على الجهاز (Whisper-Basira، WebGPU/WASM)
  memorize-asr-worker.js            # عامل التعرّف (transformers.js + onnxruntime)
  tools/                            # أدوات التطوير: speech-spike.html والمحرّكات والملفات
manifest.webmanifest                # ملف تعريف التطبيق (الاسم والألوان والأيقونات)
pwa.js                              # تسجيل عامل الخدمة وزر التثبيت
sw.js                               # عامل الخدمة: التخزين للعمل دون اتصال
icons/                              # أيقونات التطبيق (التثبيت والشاشة الرئيسية)
QuranText/
  Quran/                            # ملفات نص القرآن من Tanzil
  Arabic-Tafsir/                    # التفاسير العربية
  English-Translation/              # الترجمات الإنجليزية
  Translations/                     # الترجمات ببقية اللغات
  catalog.json                      # فهرس التفاسير والترجمات المتاحة
flags/                              # صور الأعلام بجانب كل مصدر
fonts/                              # خط عثماني حفص
fonts/mushaf/                       # خطوط صفحات المصحف وترويسات أسماء السور
QuranText/MushafPages/              # بيانات كل صفحة (الكلمات ورموز الخطوط والأسطر)
tools/
  serve.js                          # خادم محلي للتطوير
  download-tanzil-translations.ps1  # تنزيل/تحديث التفاسير والترجمات
  build-reciter-list.ps1            # إعادة بناء reciters.json لصفحة الصوت (مجلد ../QuranAudio)
  build-mushaf-pages.mjs            # بناء بيانات صفحات المصحف وخطوطها
  icon.html                         # توليد أيقونات التطبيق (فتحها في المتصفح)
```

للتلاوات صفحتها الخاصة بجانب التطبيق — `voidwave.com/QuranAudio/` — وتضم `reciters.json` ومجلدًا لكل قارئ (`<السورة><الآية>.mp3` مثل `002255.mp3`). يقرؤها العرضان وزر تنزيل المحتوى من `/QuranAudio/`، ويخدمها `tools/serve.js` على المسار نفسه أثناء التطوير إذا كانت بجانب هذا المشروع.

## 📖 عرض المصحف

`index2.html` يرسم القرآن كما في المصحف المطبوع — الصفحات الـ604 كلها في تمرير واحد لا ينتهي — بالطريقة نفسها التي يستخدمها quran.com:

- كل **كلمة** رسم متجهي واحد من خط الصفحة (`fonts/mushaf/p<page>.woff2`)، فيكون الرسم في شكله المطبوع تمامًا وتبقى الصفحة خفيفة كالنص العادي.
- تُوزَّع كلمات كل سطر مطبوع على عرض الصفحة كاملًا، فينكسر النص حيث ينكسر في المطبوع (١٥ سطرًا للصفحة، يشغل سطران منها ترويسة السورة)، وحجم الرسم يتبع نسبة الصفحة في المطبوع فتتساوى صفحات القرآن في التنسيق.
- النص العثماني الحقيقي محفوظ خلف كل رسمة: يقف التحديد عند حدود الكلمة، وعند النسخ تُستبدل الرسوم بالكلمات الحقيقية — فتحصل على `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ` لا على رموز الخط.
- التمرير متصل في الاتجاهين، على الحاسوب والجوال: لا تُرسم الصفحة إلا وهي قريبة من نافذة العرض، فحمل المصحف كاملًا في تمرير واحد لا يستهلك ذاكرة إضافية.
- مفتاح التنقل (**القارئ / المصحف / الحفظ**) ينقلك بين هذه الصفحة و`index.html` مع حفظ موضعك: يفتح المصحف على أول صفحة للسورة (`index2.html#s18`)، ويفتح القارئ تلك السورة (`index.html?surah=18`)، ويحفظ القارئ السورة في شريط العنوان فيعود إليها بعد إعادة التحميل. أما صفحة الحفظ فتحفظ هي سورتها ونطاق آياتها.
- الوضع الليلي والنهاري يشمل الصفحات نفسها: ورق داكن بحبر فاتح في الوضع الليلي (الكلمة رسم متجهي، فلا يتغير إلا الورق والحبر)، وورق كريمي بحبر داكن في الوضع النهاري؛ وتبديل الوضع يُعيد تلوين الصفحات المعروضة فورًا دون إعادة رسم.
- شريط الأدوات لا يحمل إلا ما تحتاجه القراءة — قائمة السور، والسابق والتالي، وزر التلاوة، ومفتاح القارئ/المصحف — ويجمع اختيار القارئ والسورة العشوائية والوضع الليلي في قائمة أدوات على الشاشات الصغيرة (وتبقى ظاهرة على الشاشات الواسعة). كما يختفي الشريط وحده بعد ثوانٍ من توقّف التمرير، ويعود مع أول تمرير أو لمس أو مرور بالمؤشر.
- زر **التلاوة** يقرأ من الآية التي حدّدتها (أو من الكلمة المفتوحة)، ومن أول آية في الصفحة إن لم يكن هناك تحديد. وفي ترويسة كل سورة زر تشغيل صغير يقرأ تلك السورة من أولها. وكلاهما يقرأ من صفحة التلاوات المجاورة (`/QuranAudio/`) بالقرّاء أنفسهم: تُبرز الآية الجارية، ويتابع العرض التلاوة من صفحة إلى صفحة، وتُفتتح كل سورة ببسملتها (ولا بسملة لسورة التوبة)، ويُتخطّى الملف المفقود مع تنبيه — تمامًا كسلوك `index.js`.
- معنى الكلمة ونقلها الصوتي وتلاوتها بضغطة واحدة.

يبني الأمر `node tools/build-mushaf-pages.mjs all` كل الصفحات المطبوعة — كلماتها ورموز خطوطها وأرقام أسطرها ونصها الحقيقي وصوتها — في `QuranText/MushafPages/` (نحو ٩٣ ميغابايت من خطوط الصفحات، في بضع دقائق). ويمكن تمرير رقم سورة لبناء سورة واحدة أثناء التطوير. هذه الخطوط ملك لمجمّع الملك فهد (تُقدَّم عبر quran.com)، ونُزِّلت هنا للتجربة المحلية — فراجع رخصة [QUL](https://qul.tarteel.ai) قبل النشر.

## 🧠 وضع الحفظ

`QuranHifz/memorize.html` هو العرض الثالث بجانب القارئ والمصحف. اختر السورة ونطاق الآيات، ثم اضغط الميكروفون وابدأ التلاوة: تبقى كل كلمة مخفية حتى تُتلى، وتُبرَز الكلمة الخطأ مع النص الصحيح، ويتابع الموضع تلقائيًا مع التكرار أو الانتقال أو البدء من جديد.

- **كيف تُطابَق الكلمات** — النص معروف مسبقًا، فلا حاجة إلى نسخ صوتي مثالي: يوحّد `memorize-core.js` الكلمات المتوقعة والكلمات المسموعة إلى عربية بلا تشكيل، ويقيس التشابه بمسافة ليفنشتاين، ثم يوازن التسلسل المسموع مع النص بخوارزمية نيدلمان-فونش معدّلة (الطريقة نفسها التي تستخدمها تطبيقات متابعة التلاوة). الكلمة المتروكة تُعلَّم «غير مؤكدة»، والكلمة الخطأ تُعرض مع ما سُمع، والانتقال إلى موضع آخر يُكتشف ببحث في النطاق كاملًا. وإذا التبس على المتعرّف نهاية كلمة صحيحة أو أداة تعريفها («الصالحات» سُمعت «الصالحين» أو «صالحه») قُبلت الكلمة مع خط منقّط وتنبيه يذكر ما سُمع لمراجعة النهاية — فتبقى النهاية الخطأ ظاهرة، ولا تُرفض تلاوة صحيحة بسبب تخمين المتعرّف. أما استبدال حرف أو حذفه أو زيادته («أنعمت» سُمعت «أنقمت»، «مالك» سُمعت «مالكم») فالكلمة به مختلفة — تُعدّ خطأً ولا تُقبل أبدًا؛ فما عدا قواعد كتابة الألف وإنقاذ النهاية أعلاه، المطابقة تامة. واختبارات `node QuranHifz/tools/test-memorize-core.mjs` تغطي هذه الحالات كلها دون متصفح.
- **التعرّف على الصوت** — الاستماع المباشر يجري على الجهاز بالكامل، ويعمل دون اتصال بعد التنزيل الأول للنموذج، ومحرّك **الفونيمات** هو الافتراضي، مع بناء **FastConformer int8** المدمج (‏WebAssembly — `QuranHifz/ort-nemo-asr.js`) كبديل لتعرّف الكلمات في الإعدادات. وتبقى نسختا **v8** بتقنية CTC (من `Muno459/fastconformer-quran`؛ رخصة NPL-1.1 غير تجارية والأوزان محجوبة) في الشيفرة كمسار خامل يجلبه `node QuranHifz/tools/fetch-asr-models.mjs` بعد قبول الرخصة، وتحمل وحدة `tajweed/` الأصلية — محرك الأحكام السبعة والعشرين ودرجات GOP ومُقيّم رأس النطق — مرجعًا لفحص التجويد المرتقب داخل المتصفح. وتعمل معالجة التجويد نفسها داخل المتصفح: `QuranHifz/quran-gop.js` يُلزم الكلمات العثمانية المتوقعة بالمحاذاة الإجبارية مع مخرجات النموذج (شبكة CTC بالصيغ المرجعية نفسها) ويمنح كل كلمة هامش ثقة لكل رمز (GOP)، مع جدول تقطيع مُعدّ سلفًا بدقة كاملة لكل كلمة قرآنية (`word-ids.json`؛ تقطيع BPE لهذه المفردات لا يمكن إعادة بنائه من درجات القطع وحدها). القياس على تلاوات صحيحة أظهر أن الهوامش الخام تخالطها آثار اختلاف في تقطيع الرموز — قطع النموذج الطبيعية تختلف عن هجاء المرجع في بعض الكلمات فتُعطي هوامش بحجم ‎−20‎ رغم صحة التلاوة — لذلك تُرسَل الهوامش ضمن بيانات التفريغ (`meta.gopWords`) دون تعليم أي كلمة حاليًا. أما الفحص الذي يحكم فعلًا على الكلمة المُثبتة فهو مقارنة الحركات في `memorize-core.js`: يُقارَن توقيع الحركات القصيرة (فتحة/ضمة/كسرة/سكون) لما فُهم بالكلمة المتوقعة — «مَلِكْ» بدل «مَـٰلِكِ» تُعلَّم بنقطة «راجع النطق» مع بيان الحركتين — ولم يُسجَّل أي إنذار خاطئ على التلاوات الصحيحة. ويشتغل مدقّق الفونيمات بـ**Quran-Lab/zipformer_p-arabic-v3.1** (رخصة NPL-1.2 غير ربحية والأوزان خلف موافقة) بنسختين يختارهما الإعداد: **int8** (الافتراضية) و**fp32** (‏~٢٦٣ م.ب)؛ وجدول الرموز واحد (٢٥٠ وحدة) وهو نفسه الذي بُنيت عليه الجداول المرجعية. ويُحمّل العامل النموذج من الموقع إن كان موجودًا، وإلا رجع إلى مرآة المشروع على Hugging Face (مستودع `voidwaveDev/phoneme-v3` — فGitHub لا يحتمل النسخ الكبيرة). مسار v3 يغذّي النموذج بالواجهة الصوتية الموصى بها حرفيًا (‏kaldi fbank بمدى 20–٧٦٠٠ هرتز وإطارات موسّطة `snip_edges=False`)، ويحمل كل رمز هامش ثقة (`margin_peak`: احتمال الذروة ناقص الوصيف). القياس على الملفات العدائية نفسها: v3 يصحّح كل أخطاء النموذج الأساسي الموثّقة — «مَ اا لِ كِ» عند السديس ١:٤ (كانت «لَ اا لِ كِ»)، و«صصِ رَ اا طَ» عند السديس ١:٦ (كانت «حِ رَ اا طَ»)، و«غَ ي رِ … غ ضُ … ضضَ اااااا» عند ماهر ١:٧، وخاتمة البسملة كاملة. التقييم الآلي للتجويد قد يخطئ ولا يغني عن معلّم متقن، وعند غياب ملف fp32 يعود المدقّق إلى نسخة int8 تلقائيًا.
- **التدريب بلا ميكروفون** — في أي متصفح ودون اتصال، تعمل الصفحة كلوحة تدريب: اضغط الكلمة المخفية لإظهار أول حرف، واضغطها ثانية لإظهارها كاملة، واضغطها مرة أخرى بعد ظهورها لسماع نطقها — الملف نفسه الذي يشغّله عرض المصحف (يُبَثّ من الشبكة فيحتاج اتصالًا).
- **الإعدادات** — محرّك التعرّف (الفونيمات فقط بنسختي v3.1: int8 وfp32 — الافتراضي — أو FastConformer int8)، وطريقة التصحيح (فوري أو تلميح أولًا)، وشكل النص (إخفاء كامل أو ضباب خفيف)، والتتبع التلقائي للكلمة الحالية؛ وتُحفظ في `localStorage` تحت `quran-memorize`.

## 📲 تثبيت التطبيق (PWA)

الموقع تطبيق ويب تقدّمي (PWA): افتحه في Chrome أو Edge أو Safari واختر **تثبيت** أو **إضافة إلى الشاشة الرئيسية** ليصبح تطبيقًا مستقلًا بأيقونته الخاصة. وفي متصفحات Chromium على أندرويد وسطح المكتب يظهر زر **تثبيت التطبيق** في قائمة الأدوات (⋮) في الصفحتين عند توفّر التثبيت.

- `manifest.webmanifest` يعرّف التطبيق (الاسم والألوان والأيقونات)، والأيقونات في `icons/` مولَّدة من `tools/icon.html` (صفحة تُفتح في المتصفح وتُلتقط لها لقطات بأحجام مختلفة).
- `sw.js` يخزّن هيكل التطبيق مقدمًا، ويخزّن عند الطلب نص القرآن وبيانات المصحف وخطوطه، فيبقى ما قُرئ يعمل دون اتصال. أما ملفات التلاوة فلها صفحتها الخاصة (`/QuranAudio/`، خارج نطاق عامل الخدمة)، فتحفظها الصفحات نفسها وتقرأ منها (`audio.js`) مع السقف نفسه: ما سُمع مرةً يعمل دون اتصال، والإعادة لا تلمس الشبكة. ولكل نوع سقف بالبايت (١٥٠ ميغابايت للبيانات و١٥٠ للتلاوة، والأقدم يُحذف أولًا).
- `pwa.js` يسجّل عامل الخدمة ويضيف زر التثبيت في الصفحتين.

النشر كالمعتاد (نسخ المجلد)، والمتصفح يلتقط الملفات الجديدة في أول زيارة تالية، وإعادة التحميل القوية (Ctrl+Shift+R) تجلب كل شيء من الشبكة وتحدّث المخزون. وارفع `VERSION` في `sw.js` فقط عند تغيير قواعد التخزين نفسها.

## 🤲 دعاء

نسأل الله أن ينفع بهذا العمل، وأن يجعله خالصًا لوجهه الكريم، وأن يجزى خيرًا كل من ساهم في توفير النص القرآني والتفاسير والترجمات وملفات التلاوة المجانية.

</div>
