/**
 * Builds QuranText/MushafPages/verse-pages.json from the built page files:
 * for every printed page, the last verse written on it.
 *
 * The two views use it to swap places around the same verse: given "18:45"
 * the mushaf finds the page the verse starts on - the first page whose last
 * verse comes at or after it (a verse that spans a page break belongs to the
 * page it starts on, which is exactly this rule).
 *
 *     { "pages": [[1, "1:7"], [2, "2:5"], ...] }
 *
 * Reads only what tools/build-mushaf-pages.mjs has already written, so it can
 * be re-run after any page rebuild without touching the network. A full
 * rebuild of the Mushaf writes this file itself; a single-chapter rebuild
 * does not, and this script fills the gap.
 *
 *     node tools/build-verse-pages.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_DIR = path.join(ROOT, 'QuranText', 'MushafPages');

const verseNumber = key => key.split(':').map(Number);

async function main() {
    const manifest = JSON.parse(await readFile(path.join(PAGE_DIR, 'index.json'), 'utf8'));
    if (!Array.isArray(manifest.pages) || !manifest.pages.length) {
        throw new Error('QuranText/MushafPages/index.json has no pages');
    }

    const pages = [];
    let previous = [0, 0];
    let lastVerse = null;
    for (const info of manifest.pages) {
        const data = JSON.parse(await readFile(path.join(PAGE_DIR, `p${info.page}.json`), 'utf8'));
        const verses = data.verses || [];
        /* A page with no verses cannot happen; keeping the previous key also
         * keeps the "last verse" sequence non-decreasing for the search. */
        if (verses.length) lastVerse = verses[verses.length - 1].k;

        const [surah, ayah] = verseNumber(lastVerse);
        if (surah < previous[0] || (surah === previous[0] && ayah < previous[1])) {
            throw new Error(`Page ${info.page} ends before page ${info.page - 1} (${lastVerse})`);
        }
        previous = [surah, ayah];
        pages.push([info.page, lastVerse]);
    }

    await writeFile(path.join(PAGE_DIR, 'verse-pages.json'),
        JSON.stringify({ pages }, null, 1) + '\n', 'utf8');
    console.log(`Wrote QuranText/MushafPages/verse-pages.json`
        + ` (${pages.length} pages, ${pages[0][1]} to ${pages[pages.length - 1][1]})`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
