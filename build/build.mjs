// Zero-dependency static build step for the bilingual (es/en) pages.
//
// Each page under pages/<slug>/{es.html,en.html} is a complete, standalone
// HTML file — same structure/CSS per locale, translated body text. The only
// generated parts are the nav, the footer, and the shared chrome CSS, so
// those three things can never again drift between pages or between
// locales. Everything else in a page file is authored directly, same as
// today's hand-written pages.
//
// Markers a page file must contain:
//   <!-- NAV -->...<!-- /NAV -->         → replaced with the canonical nav
//   <!-- FOOTER -->...<!-- /FOOTER -->   → replaced with the canonical footer
//   <!-- SHARED_CHROME_CSS -->            → replaced with a <style> block
//
// Usage: node build/build.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD_DIR = path.join(ROOT, 'build');
const PAGES_DIR = path.join(ROOT, 'pages');

const LOCALES = ['es', 'en'];

// slug '' = site root (home). activeNavKey matches a key in the primary
// nav (clubes/academias/competencias/pricing) so that link gets is-active;
// null means none of the primary nav links represent this page.
const PAGES = [
  { slug: '', activeNavKey: null },
  { slug: 'competencias', activeNavKey: 'competencias' },
  { slug: 'clubes', activeNavKey: 'clubes' },
  { slug: 'academias', activeNavKey: 'academias' },
  { slug: 'pricing', activeNavKey: 'pricing' },
  // empezar is a noindex, single-purpose signup/lead-capture page — deliberately
  // minimal chrome (no product nav, one-line footer) to keep the funnel
  // focused. That's not drift to fix; it's a different kind of page. Its own
  // es.html/en.html author a hand-written locale-switch link directly and skip
  // the canonical nav/footer/shared-CSS swap entirely.
  { slug: 'empezar', activeNavKey: null, skipChrome: true },
  // legal is a dense document-reading hub (ToS, privacy notices, refund
  // policy) with its own minimal logo+back-link nav and footer — same
  // reasoning as empezar, a full marketing nav doesn't belong here either.
  { slug: 'legal', activeNavKey: null, skipChrome: true },
  // privacy/ and terms/ are orphaned legacy pages (© 2025 copyright, not in
  // sitemap.xml, only linked from one out-of-scope internal page) — fully
  // superseded by the comprehensive legal/ hub above. Left Spanish-only,
  // untouched, outside this generator entirely.
];

const sharedStrings = JSON.parse(readFileSync(path.join(BUILD_DIR, 'shared-strings.json'), 'utf8'));
const sharedChromeCss = readFileSync(path.join(BUILD_DIR, 'partials', 'shared-chrome.css'), 'utf8');
const navTemplate = readFileSync(path.join(BUILD_DIR, 'partials', 'nav.html'), 'utf8');
const footerTemplate = readFileSync(path.join(BUILD_DIR, 'partials', 'footer.html'), 'utf8');

function fillTemplate(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  const leftover = out.match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (leftover) {
    throw new Error(`Unfilled placeholder(s) ${leftover.join(', ')} — add them to the values passed to fillTemplate.`);
  }
  return out;
}

function pagePath(slug, locale) {
  const localePrefix = locale === 'en' ? '/en' : '';
  if (slug === '') return `${localePrefix}/`;
  return `${localePrefix}/${slug}/`;
}

function outputFilePath(slug, locale) {
  const base = locale === 'en' ? path.join(ROOT, 'en') : ROOT;
  return slug === '' ? path.join(base, 'index.html') : path.join(base, slug, 'index.html');
}

function renderNav(page, locale) {
  const strings = sharedStrings[locale];
  const prefix = locale === 'en' ? '/en' : '';
  const navKeys = ['clubes', 'academias', 'competencias', 'pricing'];
  const activeClasses = {};
  for (const key of navKeys) {
    activeClasses[`active${capitalize(key)}`] = key === page.activeNavKey ? 'is-active' : '';
  }
  const otherLocale = locale === 'es' ? 'en' : 'es';
  return fillTemplate(navTemplate, {
    navAriaLabel: strings.navAriaLabel,
    logoAria: strings.logoAria,
    prefix,
    navClubes: strings.navClubes,
    navAcademias: strings.navAcademias,
    navCompetencias: strings.navCompetencias,
    navTorneos: strings.navTorneos,
    navPricing: strings.navPricing,
    navDashboard: strings.navDashboard,
    navCta: strings.navCta,
    localeSwitchHref: pagePath(page.slug, otherLocale),
    localeSwitchLabel: otherLocale.toUpperCase(),
    ...activeClasses,
  });
}

function renderFooter(page, locale) {
  const strings = sharedStrings[locale];
  const prefix = locale === 'en' ? '/en' : '';
  return fillTemplate(footerTemplate, {
    prefix,
    footerTagline: strings.footerTagline,
    footerProductHeading: strings.footerProductHeading,
    footerToolsHeading: strings.footerToolsHeading,
    footerGuidesHeading: strings.footerGuidesHeading,
    footerDirectoryTournaments: strings.footerDirectoryTournaments,
    footerDirectoryClubs: strings.footerDirectoryClubs,
    footerTournamentCalc: strings.footerTournamentCalc,
    footerLeagueCalc: strings.footerLeagueCalc,
    footerBracketGenerator: strings.footerBracketGenerator,
    footerAllGuides: strings.footerAllGuides,
    footerAcademyGuide: strings.footerAcademyGuide,
    footerHowToOrganize: strings.footerHowToOrganize,
    footerBestPractices: strings.footerBestPractices,
    footerAmericanoLeague: strings.footerAmericanoLeague,
    footerAmericanoIndividual: strings.footerAmericanoIndividual,
    footerCopyright: strings.footerCopyright,
    footerLegal: strings.footerLegal,
    navClubes: strings.navClubes,
    navAcademias: strings.navAcademias,
    navCompetencias: strings.navCompetencias,
    navTorneos: strings.navTorneos,
    navPricing: strings.navPricing,
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function replaceMarkerRegion(html, marker, replacement, filePath) {
  const re = new RegExp(`<!-- ${marker} -->[\\s\\S]*?<!-- /${marker} -->`);
  if (!re.test(html)) {
    throw new Error(`${filePath}: missing <!-- ${marker} --> ... <!-- /${marker} --> region`);
  }
  return html.replace(re, replacement);
}

function buildPage(page, locale) {
  const dir = path.join(PAGES_DIR, page.slug === '' ? 'home' : page.slug);
  const sourceFile = path.join(dir, `${locale}.html`);
  if (!existsSync(sourceFile)) {
    throw new Error(`Missing ${sourceFile}`);
  }
  let html = readFileSync(sourceFile, 'utf8');

  if (!page.skipChrome) {
    html = replaceMarkerRegion(html, 'NAV', renderNav(page, locale), sourceFile);
    html = replaceMarkerRegion(html, 'FOOTER', renderFooter(page, locale), sourceFile);

    if (!html.includes('<!-- SHARED_CHROME_CSS -->')) {
      throw new Error(`${sourceFile}: missing <!-- SHARED_CHROME_CSS --> marker in <head>`);
    }
    html = html.replace('<!-- SHARED_CHROME_CSS -->', `<style>\n${sharedChromeCss}    </style>`);
  }

  const outFile = outputFilePath(page.slug, locale);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, html, 'utf8');
  return outFile;
}

let count = 0;
for (const page of PAGES) {
  for (const locale of LOCALES) {
    const outFile = buildPage(page, locale);
    console.log(`built ${path.relative(ROOT, outFile)}`);
    count++;
  }
}
console.log(`\n${count} pages built (${PAGES.length} pages × ${LOCALES.length} locales).`);
