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
icons/                              # app icons (install / home screen)
QuranText/
  Quran/                            # Tanzil Quran text XML files
  Arabic-Tafsir/                    # Arabic tafsirs
  English-Translation/              # English translations
  Translations/                     # translations in all other languages
  catalog.json                      # index of available tafsirs/translations
QuranAudio/
  reciters.json                     # list of reciters
  <Reciter-Name>/                   # <sura3><ayah3>.mp3 (e.g. 002255.mp3)
flags/                              # flag images shown next to each source
fonts/                              # Uthmanic Hafs font
fonts/mushaf/                       # QPC page fonts + surah name cartouches
QuranText/MushafPages/              # per-page word data + index.json + verse-pages.json
tools/
  serve.js                          # local dev server
  download-tanzil-translations.ps1  # download/refresh tafsirs & translations
  build-reciter-list.ps1            # rebuild QuranAudio/reciters.json
  build-mushaf-pages.mjs            # build the Mushaf page data + page fonts
  build-verse-pages.mjs             # verse -> page index, rebuilt from the page files (no network)
  icon.html                         # renders the PWA icons (screenshot source)
```

## 🛠️ Tools

```powershell
# refresh the Tanzil tafsir/translation files and the catalog
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\download-tanzil-translations.ps1

# rebuild the reciters list from the QuranAudio folders
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-reciter-list.ps1

# build the Mushaf page data and page fonts (whole Quran, or one chapter)
node tools/build-mushaf-pages.mjs all
node tools/build-mushaf-pages.mjs 18

# rebuild the verse -> page index the two views use to swap places
# (a whole-Quran build writes it too; this one needs no network)
node tools/build-verse-pages.mjs
```

---

## 📖 Mushaf page view

`index2.html` draws the Quran the way the printed Mushaf does — all 604 pages in one endless scroll — with the same technique quran.com uses:

- Every **word** is one glyph of a per-page font (`fonts/mushaf/p<page>.woff2`), so a word is a single vector shape in its exact printed form while the page still behaves like text.
- The words of a printed line are spread over the full page width, so the text breaks exactly where the printed page breaks (15 lines a page, two of which a surah banner takes). The glyph size follows the sheet proportion of the print, so every page of the Quran is laid out identically.
- The real ʿUthmānī word is kept behind every glyph: selection stops at word boundaries, and the copy handler puts the real words on the clipboard — copying gives you `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ`, never code points.
- Scrolling is endless in both directions, on desktop and on mobile: pages are drawn only while they are near the viewport, so carrying the whole Quran on one scroll costs no extra memory.
- The view switch (**القارئ / المصحف**) moves between this page and the app around the same verse: the Mushaf opens on the page the verse is printed on and puts its line at the top, and the reader opens on the same ayah, marked with a short flash. `resume.js` remembers the view that was used last, so the installed app comes back to it — the reader on the ayah it was on, the Mushaf on its page and line — and a reload of either page comes back to the line it was left on.
- Dark and light themes cover the pages themselves: dark paper with light ink in the dark theme (a word is a vector outline, so only the paper and the ink change) and cream paper with dark ink in the light theme; switching the theme also recolours the pages already on screen, with no redraw.
- The app bar keeps only what reading needs — the surah picker, the page pager, the listen button and the القارئ/المصحف switch — and tucks the reciter picker, the random surah and the theme into a tools menu on small screens (on wide ones they stay inline). It also slides away by itself a couple of seconds after you stop scrolling, and returns on the next scroll, touch or hover.
- Pressing **التلاوة** recites from the verse you have selected (or from the word whose card is open), and from the first verse of the page when nothing is selected. Every surah banner carries its own small play button that recites that surah from its first ayah. Both use the same `QuranAudio/` files and reciters as the app: the recited verse is highlighted, the view follows the recitation from page to page, each surah is opened with its basmala (surah 9 has none) and a missing file is skipped with a message, exactly like `index.js`.
- A word's meaning, transliteration and recitation are one click away.

`node tools/build-mushaf-pages.mjs all` fetches every printed page — its words, glyph code points, printed line numbers, real text and word audio — into `QuranText/MushafPages/` (around 93 MB of page fonts, a few minutes). Pass a chapter number instead to build just that chapter while developing. The fonts belong to the King Fahd Complex (served through quran.com) and are downloaded here for local development — check the [QUL](https://qul.tarteel.ai) licence before publishing.

---

## 📲 Install as an app (PWA)

The site is a Progressive Web App: open it in Chrome, Edge or Safari and choose **Install** (or **Add to Home Screen**) to keep it as a standalone app with its own icon. Chromium browsers on Android and desktop also show an **تثبيت التطبيق** button in the tools menu (⋮) of both pages once the browser offers the installation.

- `manifest.webmanifest` declares the app (name, colours, icons). The icons in `icons/` are rendered by `tools/icon.html` — open it in the browser and screenshot it at each size when they need to change.
- `sw.js` caches the app shell up front, then the Quran text, Mushaf page data, fonts and recitation on demand, so whatever has been read or played once keeps working offline. Data and audio each have their own byte budget (150 MB, oldest files evicted first); files downloaded on purpose are pinned and never evicted.
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
QuranAudio/
  reciters.json                     # قائمة القرّاء
  <اسم القارئ>/                     # <السورة><الآية>.mp3 مثل 002255.mp3
flags/                              # صور الأعلام بجانب كل مصدر
fonts/                              # خط عثماني حفص
fonts/mushaf/                       # خطوط صفحات المصحف وترويسات أسماء السور
QuranText/MushafPages/              # بيانات كل صفحة (الكلمات ورموز الخطوط والأسطر)
tools/
  serve.js                          # خادم محلي للتطوير
  download-tanzil-translations.ps1  # تنزيل/تحديث التفاسير والترجمات
  build-reciter-list.ps1            # إعادة بناء ملف QuranAudio/reciters.json
  build-mushaf-pages.mjs            # بناء بيانات صفحات المصحف وخطوطها
  icon.html                         # توليد أيقونات التطبيق (فتحها في المتصفح)
```

## 📖 عرض المصحف

`index2.html` يرسم القرآن كما في المصحف المطبوع — الصفحات الـ604 كلها في تمرير واحد لا ينتهي — بالطريقة نفسها التي يستخدمها quran.com:

- كل **كلمة** رسم متجهي واحد من خط الصفحة (`fonts/mushaf/p<page>.woff2`)، فيكون الرسم في شكله المطبوع تمامًا وتبقى الصفحة خفيفة كالنص العادي.
- تُوزَّع كلمات كل سطر مطبوع على عرض الصفحة كاملًا، فينكسر النص حيث ينكسر في المطبوع (١٥ سطرًا للصفحة، يشغل سطران منها ترويسة السورة)، وحجم الرسم يتبع نسبة الصفحة في المطبوع فتتساوى صفحات القرآن في التنسيق.
- النص العثماني الحقيقي محفوظ خلف كل رسمة: يقف التحديد عند حدود الكلمة، وعند النسخ تُستبدل الرسوم بالكلمات الحقيقية — فتحصل على `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ` لا على رموز الخط.
- التمرير متصل في الاتجاهين، على الحاسوب والجوال: لا تُرسم الصفحة إلا وهي قريبة من نافذة العرض، فحمل المصحف كاملًا في تمرير واحد لا يستهلك ذاكرة إضافية.
- مفتاح التنقل (**القارئ / المصحف**) ينقلك بين هذه الصفحة و`index.html` مع حفظ موضعك: يفتح المصحف على أول صفحة للسورة (`index2.html#s18`)، ويفتح القارئ تلك السورة (`index.html?surah=18`)، ويحفظ القارئ السورة في شريط العنوان فيعود إليها بعد إعادة التحميل.
- الوضع الليلي والنهاري يشمل الصفحات نفسها: ورق داكن بحبر فاتح في الوضع الليلي (الكلمة رسم متجهي، فلا يتغير إلا الورق والحبر)، وورق كريمي بحبر داكن في الوضع النهاري؛ وتبديل الوضع يُعيد تلوين الصفحات المعروضة فورًا دون إعادة رسم.
- شريط الأدوات لا يحمل إلا ما تحتاجه القراءة — قائمة السور، والسابق والتالي، وزر التلاوة، ومفتاح القارئ/المصحف — ويجمع اختيار القارئ والسورة العشوائية والوضع الليلي في قائمة أدوات على الشاشات الصغيرة (وتبقى ظاهرة على الشاشات الواسعة). كما يختفي الشريط وحده بعد ثوانٍ من توقّف التمرير، ويعود مع أول تمرير أو لمس أو مرور بالمؤشر.
- زر **التلاوة** يقرأ من الآية التي حدّدتها (أو من الكلمة المفتوحة)، ومن أول آية في الصفحة إن لم يكن هناك تحديد. وفي ترويسة كل سورة زر تشغيل صغير يقرأ تلك السورة من أولها. وكلاهما بملفات `QuranAudio/` وقرّائها نفسهم: تُبرز الآية الجارية، ويتابع العرض التلاوة من صفحة إلى صفحة، وتُفتتح كل سورة ببسملتها (ولا بسملة لسورة التوبة)، ويُتخطّى الملف المفقود مع تنبيه — تمامًا كسلوك `index.js`.
- معنى الكلمة ونقلها الصوتي وتلاوتها بضغطة واحدة.

يبني الأمر `node tools/build-mushaf-pages.mjs all` كل الصفحات المطبوعة — كلماتها ورموز خطوطها وأرقام أسطرها ونصها الحقيقي وصوتها — في `QuranText/MushafPages/` (نحو ٩٣ ميغابايت من خطوط الصفحات، في بضع دقائق). ويمكن تمرير رقم سورة لبناء سورة واحدة أثناء التطوير. هذه الخطوط ملك لمجمّع الملك فهد (تُقدَّم عبر quran.com)، ونُزِّلت هنا للتجربة المحلية — فراجع رخصة [QUL](https://qul.tarteel.ai) قبل النشر.

## 📲 تثبيت التطبيق (PWA)

الموقع تطبيق ويب تقدّمي (PWA): افتحه في Chrome أو Edge أو Safari واختر **تثبيت** أو **إضافة إلى الشاشة الرئيسية** ليصبح تطبيقًا مستقلًا بأيقونته الخاصة. وفي متصفحات Chromium على أندرويد وسطح المكتب يظهر زر **تثبيت التطبيق** في قائمة الأدوات (⋮) في الصفحتين عند توفّر التثبيت.

- `manifest.webmanifest` يعرّف التطبيق (الاسم والألوان والأيقونات)، والأيقونات في `icons/` مولَّدة من `tools/icon.html` (صفحة تُفتح في المتصفح وتُلتقط لها لقطات بأحجام مختلفة).
- `sw.js` يخزّن هيكل التطبيق مقدمًا، ويخزّن عند الطلب نص القرآن وبيانات المصحف وخطوطه وملفات التلاوة، فيبقى ما قُرئ أو سُمع مرةً يعمل دون اتصال. ولكل نوع سقف بالبايت (١٥٠ ميغابايت للبيانات و١٥٠ للتلاوة، والأقدم يُحذف أولًا).
- `pwa.js` يسجّل عامل الخدمة ويضيف زر التثبيت في الصفحتين.

النشر كالمعتاد (نسخ المجلد)، والمتصفح يلتقط الملفات الجديدة في أول زيارة تالية، وإعادة التحميل القوية (Ctrl+Shift+R) تجلب كل شيء من الشبكة وتحدّث المخزون. وارفع `VERSION` في `sw.js` فقط عند تغيير قواعد التخزين نفسها.

## 🤲 دعاء

نسأل الله أن ينفع بهذا العمل، وأن يجعله خالصًا لوجهه الكريم، وأن يجزى خيرًا كل من ساهم في توفير النص القرآني والتفاسير والترجمات وملفات التلاوة المجانية.

</div>
