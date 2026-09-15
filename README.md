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
index2.html                         # standalone Mushaf page view (test)
index2.js                           # its logic: glyph layer, layout, copy
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
QuranText/MushafPages/              # per-page word data (words, glyphs, printed lines)
tools/
  serve.js                          # local dev server
  download-tanzil-translations.ps1  # download/refresh tafsirs & translations
  build-reciter-list.ps1            # rebuild QuranAudio/reciters.json
  build-mushaf-pages.mjs            # build the Mushaf page data + page fonts
```

## 🛠️ Tools

```powershell
# refresh the Tanzil tafsir/translation files and the catalog
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\download-tanzil-translations.ps1

# rebuild the reciters list from the QuranAudio folders
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-reciter-list.ps1

# build the Mushaf page data and page fonts of a surah (default: 18)
node tools/build-mushaf-pages.mjs 18
```

---

## 📖 Mushaf page view (test)

`index2.html` is a standalone test page that draws the Quran the way the printed Mushaf does, using the same technique as quran.com:

- Every **word** is one glyph of a per-page font (`fonts/mushaf/p<page>.woff2`), so each word is a single vector shape in its exact printed form, while the page stays light enough to serve like plain text.
- The words are grouped per printed line and spread over the full page width, so the text breaks exactly where the printed page breaks (15 lines a page, two of which a surah banner takes).
- The real ʿUthmānī word is kept behind every glyph: selection stops at word boundaries, and the copy handler replaces the glyphs with the real words — copying gives you `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ`, never code points.
- Word meanings, transliterations and word-by-word recitation are one click away.

The data (words, glyph code points, printed line numbers, real text, word audio) is built once per surah into `QuranText/MushafPages/` by `tools/build-mushaf-pages.mjs`, together with the page fonts. Those fonts belong to the King Fahd Complex (served through quran.com) and are downloaded here for local development — check the [QUL](https://qul.tarteel.ai) licence before publishing.

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
index2.html                         # عرض صفحات المصحف (صفحة تجريبية مستقلة)
index2.js                           # منطقها: طبقة الرسوم والتوزيع والنسخ
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
```

## 📖 عرض صفحات المصحف (تجريبي)

`index2.html` صفحة مستقلة ترسم النص كما في المصحف المطبوع، بالطريقة نفسها التي يستخدمها quran.com:

- كل **كلمة** رسم متجهي واحد من خط الصفحة (`fonts/mushaf/p<page>.woff2`)، فتبقى الصفحة خفيفة وتُقدَّم كالنص العادي.
- تُجمَّع الكلمات في أسطر الصفحة المطبوعة وتُوزَّع على عرضها كاملًا، فينكسر النص حيث ينكسر في المطبوع (١٥ سطرًا للصفحة، يشغل سطران منها ترويسة السورة).
- النص العثماني الحقيقي محفوظ خلف كل رسمة: يقف التحديد عند حدود الكلمة، وعند النسخ تُستبدل الرسوم بالكلمات الحقيقية — فتحصل على `ٱلْحَمْدُ لِلَّهِ ٱلَّذِىٓ أَنزَلَ` لا على رموز الخط.
- معنى الكلمة ونقلها الصوتي وتلاوتها على مستوى الكلمة بضغطة واحدة.

تُبنى البيانات (الكلمات ورموز الخطوط وأرقام الأسطر والنص الحقيقي والصوت) مرة واحدة لكل سورة عبر `tools/build-mushaf-pages.mjs` وحفظها في `QuranText/MushafPages/` مع خطوط الصفحات. هذه الخطوط ملك لمجمّع الملك فهد (تُقدَّم عبر quran.com)، ونُزِّلت هنا للتجربة المحلية — فراجع رخصة [QUL](https://qul.tarteel.ai) قبل النشر.

## 🤲 دعاء

نسأل الله أن ينفع بهذا العمل، وأن يجعله خالصًا لوجهه الكريم، وأن يجزى خيرًا كل من ساهم في توفير النص القرآني والتفاسير والترجمات وملفات التلاوة المجانية.

</div>
