/* The docs site's client code: code colour, copy buttons, and the page list on small screens. */
(() => {
  const hl = window.hljs;
  if (hl) {
    hl.registerLanguage('dbml', (h) => ({
      case_insensitive: true,
      keywords: {
        keyword: 'table enum ref indexes note as project tablegroup',
        built_in: 'pk increment unique default not null',
        type: 'int integer bigint varchar text boolean uuid timestamp timestamptz date double numeric',
        literal: 'true false',
      },
      contains: [
        h.C_LINE_COMMENT_MODE,
        h.C_BLOCK_COMMENT_MODE,
        { className: 'string', begin: "'", end: "'" },
        { className: 'code', begin: '`', end: '`' },
        { className: 'number', begin: /\b\d+(\.\d+)?\b/ },
      ],
    }));
    for (const code of document.querySelectorAll('pre code[class*="language-"]')) {
      try {
        hl.highlightElement(code);
      } catch {
        // An unknown language stays plain text.
      }
    }
  }

  for (const pre of document.querySelectorAll('.prose pre')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copy';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? '');
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Select to copy';
      }
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1600);
    });
    pre.append(button);
  }

  const site = document.querySelector('.site');
  const toggle = document.querySelector('.menu-toggle');
  if (site && toggle) {
    toggle.addEventListener('click', () => {
      const open = site.classList.toggle('menu-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
})();
