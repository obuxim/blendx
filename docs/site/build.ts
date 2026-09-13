/**
 * Builds the documentation site into site/: the guide and the cookbook as pages under
 * /docs/, and the narrated walkthrough under /tutorial/. The Markdown stays the source, and
 * site/ is not committed. Links between pages become site links, links into the repository
 * go to GitHub, and the build fails on any link that resolves to nothing.
 *
 *   bun docs/site/build.ts
 *
 * Vercel runs it on every push that touches docs/ (vercel.json). To preview, serve site/
 * with any static server, such as `bunx serve site`.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const here = import.meta.dir;
const root = resolve(here, '..', '..');
const out = join(root, 'site');
const REPO = 'https://github.com/obuxim/blendx';
const WALKTHROUGH = 'docs/media/walkthrough';

type Group = 'Start here' | 'Reference' | 'More';

interface Page {
  /** The Markdown source, relative to the repository root. */
  source: string;
  /** The page's folder under /docs/; '' is /docs/ itself. */
  slug: string;
  group: Group;
  /** The name in the navigation, when it is not the page's own title. */
  label?: string;
}

/** Every page, in reading order: the navigation, and previous and next, follow it. */
const PAGES: Page[] = [
  { source: 'docs/guide/README.md', slug: '', group: 'Start here', label: 'Overview' },
  { source: 'docs/guide/getting-started.md', slug: 'getting-started', group: 'Start here' },
  { source: 'docs/guide/tutorial.md', slug: 'tutorial', group: 'Start here' },
  { source: 'docs/guide/schema.md', slug: 'schema', group: 'Reference' },
  { source: 'docs/guide/blends.md', slug: 'blends', group: 'Reference' },
  { source: 'docs/guide/hooks.md', slug: 'hooks', group: 'Reference' },
  { source: 'docs/guide/app.md', slug: 'app', group: 'Reference' },
  { source: 'docs/guide/http.md', slug: 'http', group: 'Reference' },
  { source: 'docs/guide/review.md', slug: 'review', group: 'Reference' },
  { source: 'docs/guide/testing.md', slug: 'testing', group: 'Reference' },
  { source: 'docs/guide/deployment.md', slug: 'deployment', group: 'Reference' },
  { source: 'docs/guide/cli.md', slug: 'cli', group: 'Reference' },
  { source: 'docs/guide/known-issues.md', slug: 'known-issues', group: 'Reference' },
  { source: 'docs/cookbook.md', slug: 'cookbook', group: 'More' },
];

/** Links in the navigation that are not pages of the guide. */
const EXTRA: Record<Group, { label: string; href: string }[]> = {
  'Start here': [],
  Reference: [],
  More: [
    { label: 'Walkthrough, narrated', href: '/tutorial/' },
    { label: 'blendx on GitHub', href: REPO },
  ],
};

const pageUrl = (page: Page) => (page.slug ? `/docs/${page.slug}/` : '/docs/');

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const attribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** GitHub's heading slug, so that anchors written for GitHub keep working on the site. */
const slugOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

interface Rendered {
  page: Page;
  title: string;
  description: string;
  html: string;
  ids: Set<string>;
  toc: { id: string; label: string }[];
}

interface Anchor {
  from: Page;
  to: Page;
  anchor: string;
}

const problems: string[] = [];
const anchors: Anchor[] = [];

/** Where a link in a page's Markdown goes on the site. */
function destination(page: Page, href: string): string {
  if (/^(https?:|mailto:)/.test(href)) return href;
  if (href.startsWith('#')) {
    anchors.push({ from: page, to: page, anchor: href.slice(1) });
    return href;
  }
  const [path = '', anchor] = href.split('#');
  const target = normalize(join(dirname(page.source), decodeURIComponent(path))).replace(/\/$/, '');
  const absolute = resolve(root, target);
  if (!absolute.startsWith(root) || !existsSync(absolute)) {
    problems.push(`${page.source}: ${href} is not in the repository`);
    return href;
  }
  const linked = PAGES.find((candidate) => candidate.source === target);
  if (linked) {
    if (anchor) anchors.push({ from: page, to: linked, anchor });
    return `${pageUrl(linked)}${anchor ? `#${anchor}` : ''}`;
  }
  if (target === WALKTHROUGH || target === `${WALKTHROUGH}/index.html`) return '/tutorial/';
  const kind = statSync(absolute).isDirectory() ? 'tree' : 'blob';
  return `${REPO}/${kind}/main/${target}${anchor ? `#${anchor}` : ''}`;
}

function render(page: Page): Rendered {
  const markdown = readFileSync(join(root, page.source), 'utf8');
  let html: string = Bun.markdown.html(markdown);

  // Headings get GitHub's ids; the h2s make the page's table of contents.
  const ids = new Set<string>();
  const toc: Rendered['toc'] = [];
  html = html.replace(/<h([1-6])(?: id="[^"]*")?>([\s\S]*?)<\/h\1>/g, (_, level, inner) => {
    const base = slugOf(text(inner));
    let id = base;
    for (let n = 1; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    if (level === '2') toc.push({ id, label: text(inner) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });

  html = html.replace(
    /href="([^"]*)"/g,
    (_, href) => `href="${attribute(destination(page, href))}"`,
  );
  html = html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');

  const title = text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? page.slug);
  const lead = text(/<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '');
  const description = lead.length > 160 ? `${lead.slice(0, lead.lastIndexOf(' ', 157))}...` : lead;
  return { page, title, description, html, ids, toc };
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231e6b57'/%3E%3Ctext x='16' y='23' font-family='Georgia,serif' font-size='20' text-anchor='middle' fill='%23ffffff'%3Eb%3C/text%3E%3C/svg%3E";

function navigation(current: Page | undefined, rendered: Rendered[]): string {
  const groups: Group[] = ['Start here', 'Reference', 'More'];
  return groups
    .map((group) => {
      const pages = rendered
        .filter(({ page }) => page.group === group)
        .map(({ page, title }) => {
          const here = page === current ? ' aria-current="page"' : '';
          return `<li><a href="${pageUrl(page)}"${here}>${attribute(page.label ?? title)}</a></li>`;
        });
      const extra = EXTRA[group].map(
        (link) => `<li><a href="${attribute(link.href)}">${attribute(link.label)}</a></li>`,
      );
      return `<div class="nav-group"><p class="nav-label">${group}</p><ul>${[...pages, ...extra].join('')}</ul></div>`;
    })
    .join('');
}

function layout(options: {
  title: string;
  description: string;
  nav: string;
  body: string;
  toc?: Rendered['toc'];
  after?: string;
}): string {
  const toc =
    options.toc && options.toc.length > 1
      ? `<aside class="toc" aria-label="On this page"><p class="toc-label">On this page</p><ol>${options.toc
          .map((entry) => `<li><a href="#${entry.id}">${attribute(entry.label)}</a></li>`)
          .join('')}</ol></aside>`
      : '<aside class="toc" aria-hidden="true"></aside>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${attribute(options.title)}</title>
<meta name="description" content="${attribute(options.description)}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=JetBrains+Mono:wght@400;500;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400&display=swap">
<link rel="stylesheet" href="/assets/docs.css">
</head>
<body>
<div class="site">
<header class="topbar"><a class="brand" href="/docs/"><span class="mark">blendx</span> docs</a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Pages</button></header>
<nav class="sidebar" id="sidebar" aria-label="Guide">
<div class="sidebar-head"><a class="brand" href="/docs/"><span class="mark">blendx</span> docs</a><p class="tagline">Version 0 · not on npm yet</p></div>
${options.nav}
</nav>
<main class="content">
<article class="prose">
${options.body}
</article>
${options.after ?? ''}
</main>
${toc}
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="/assets/docs.js"></script>
</body>
</html>
`;
}

function pager(at: number, rendered: Rendered[]): string {
  const link = (entry: Rendered | undefined, direction: 'Previous' | 'Next') =>
    entry
      ? `<a class="${direction === 'Next' ? 'next' : 'prev'}" href="${pageUrl(entry.page)}"><span class="dir">${direction}</span><span class="name">${attribute(entry.page.label ?? entry.title)}</span></a>`
      : '';
  const page = rendered[at]?.page;
  const edit = page ? `${REPO}/edit/main/${page.source}` : REPO;
  return `<nav class="pager" aria-label="Previous and next">${link(rendered[at - 1], 'Previous')}${link(
    rendered[at + 1],
    'Next',
  )}</nav><footer class="foot"><a href="${edit}">Edit this page on GitHub</a><span>blendx is MIT licensed.</span></footer>`;
}

// Render every page first: links are checked against all of them.
const rendered = PAGES.map(render);
for (const { from, to, anchor } of anchors) {
  const target = rendered.find((entry) => entry.page === to);
  if (!target?.ids.has(anchor))
    problems.push(`${from.source}: no heading #${anchor} in ${to.source}`);
}
if (problems.length > 0) {
  console.error(`site: ${problems.length} broken link${problems.length === 1 ? '' : 's'}`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
cpSync(join(here, 'docs.css'), join(out, 'assets', 'docs.css'));
cpSync(join(here, 'docs.js'), join(out, 'assets', 'docs.js'));

for (const [at, entry] of rendered.entries()) {
  const folder = join(out, 'docs', entry.page.slug);
  mkdirSync(folder, { recursive: true });
  const title = entry.page.slug ? `${entry.title} · blendx docs` : 'blendx docs';
  writeFileSync(
    join(folder, 'index.html'),
    layout({
      title,
      description: entry.description,
      nav: navigation(entry.page, rendered),
      body: entry.html,
      toc: entry.toc,
      after: pager(at, rendered),
    }),
  );
}

writeFileSync(
  join(out, '404.html'),
  layout({
    title: 'Not found · blendx docs',
    description: 'There is no page at this address.',
    nav: navigation(undefined, rendered),
    body: '<h1>Not found</h1><p>There is no page at this address. The <a href="/docs/">overview</a> lists every page of the guide.</p>',
  }),
);

// The root of the site is the guide. Vercel redirects too (vercel.json); this covers other hosts.
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/docs/"><title>blendx docs</title><a href="/docs/">blendx docs</a>\n',
);

// The walkthrough as it is, with the doctype its page leaves to the host.
const tutorial = join(out, 'tutorial');
cpSync(join(root, WALKTHROUGH), tutorial, {
  recursive: true,
  filter: (source) => !source.endsWith('.ts') && !source.endsWith('narration.json'),
});
const player = join(tutorial, 'index.html');
writeFileSync(
  player,
  `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${readFileSync(player, 'utf8')}`,
);

const external = rendered.reduce(
  (sum, entry) => sum + (entry.html.match(new RegExp(`href="${REPO}/`, 'g'))?.length ?? 0),
  0,
);
console.log(
  `wrote site/: ${rendered.length} pages under /docs/, the walkthrough under /tutorial/, ${anchors.length} anchors checked, ${external} links to GitHub`,
);
