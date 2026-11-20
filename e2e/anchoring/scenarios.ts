/** Real-world page changes a drawing must survive. Each runs in every browser engine and device profile. `target` picks the element the user draws on; `truth` (default: the target) is what the drawing must move with afterwards. Scripts are strings because they run inside the page. */
export interface AnchorScenario {
  name: string;
  html: string;
  target: string;
  /** small: a mark on the target's first word; box: a frame around the whole target; margin: a note in the empty space to its right. */
  draw?: 'small' | 'box' | 'margin';
  /** Async page script run after the drawing is anchored. */
  mutate?: string;
  resize?: { width: number; height: number };
  truth?: string;
  expect: 'follow' | 'hidden' | 'orphaned' | 'clipped';
}

const repeat = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('');
const LOREM = 'The quick brown fox jumps over the lazy dog while the committee reviews every proposal in detail before the vote';

export const SCENARIOS: AnchorScenario[] = [
  {
    name: 'list item when a new item is inserted above',
    html: `<ul>${repeat(8, (i) => `<li>Item number ${i} with some text</li>`)}</ul>`,
    target: `document.querySelectorAll('li')[4]`,
    mutate: `const li = document.createElement('li'); li.textContent = 'Fresh item'; document.querySelector('ul').prepend(li);`,
    expect: 'follow',
  },
  {
    name: 'paragraph inside a large id container when content is inserted above',
    html: `<div id="main" style="width:600px">${repeat(6, (i) => `<p>Paragraph ${i} lorem ipsum dolor sit amet consectetur.</p>`)}</div>`,
    target: `document.querySelectorAll('p')[3]`,
    mutate: `const p = document.createElement('p'); p.style.height = '150px'; p.textContent = 'inserted'; document.getElementById('main').prepend(p);`,
    expect: 'follow',
  },
  {
    name: 'list item after the list is re-sorted',
    html: `<ul>${repeat(6, (i) => `<li>Task ${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][i]}</li>`)}</ul>`,
    target: `document.querySelectorAll('li')[1]`,
    mutate: `const ul = document.querySelector('ul'); [...ul.children].reverse().forEach((c) => ul.appendChild(c));`,
    expect: 'follow',
  },
  {
    name: 'one of many identical "Reply" links when a comment is added above',
    html: `<div id="thread">${repeat(6, (i) => `<div class="c"><p>Comment body number ${i} talking about things</p><a href="#">Reply</a></div>`)}</div>`,
    target: `document.querySelectorAll('a')[3]`,
    mutate: `const d = document.createElement('div'); d.className = 'c'; d.innerHTML = '<p>New comment</p><a href="#">Reply</a>'; document.getElementById('thread').prepend(d);`,
    expect: 'follow',
  },
  {
    name: 'row after a framework re-renders the whole list with new nodes',
    html: `<div id="app"></div><script>window.renderRows = (extra) => { document.getElementById('app').innerHTML = '<div>' + (extra ? '<div class="row">Brand new row</div>' : '') + ${JSON.stringify(repeat(6, (i) => `<div class="row">Row title ${i} details here</div>`))} + '</div>'; }; renderRows(false);</script>`,
    target: `document.querySelectorAll('.row')[2]`,
    mutate: `renderRows(true);`,
    truth: `[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('Row title 2'))`,
    expect: 'follow',
  },
  {
    name: 'table row when a row is inserted above',
    html: `<table><tbody>${repeat(6, (i) => `<tr><td>Name ${i}</td><td>${i * 7} points</td></tr>`)}</tbody></table>`,
    target: `document.querySelectorAll('tr')[3]`,
    mutate: `const tr = document.createElement('tr'); tr.innerHTML = '<td>Newbie</td><td>1</td>'; document.querySelector('tbody').prepend(tr);`,
    expect: 'follow',
  },
  {
    name: 'table cell when a column is inserted before it',
    html: `<table><tbody>${repeat(4, (i) => `<tr><td>Name ${i}</td><td>Role ${i}</td></tr>`)}</tbody></table>`,
    target: `document.querySelectorAll('tr')[2].children[1]`,
    mutate: `document.querySelectorAll('tr').forEach((tr, i) => { const td = document.createElement('td'); td.textContent = 'Inserted column ' + i; tr.prepend(td); });`,
    expect: 'follow',
  },
  {
    name: 'paragraph when the window narrows and text reflows',
    html: `<div style="max-width:900px">${repeat(5, (i) => `<p>Paragraph ${i} ${'word '.repeat(60)}</p>`)}</div>`,
    target: `document.querySelectorAll('p')[3]`,
    resize: { width: 420, height: 700 },
    expect: 'follow',
  },
  {
    name: 'a single word when its paragraph reflows to a narrower width',
    html: `<p id="para" style="max-width:760px">${LOREM} ${LOREM} <mark>keyword</mark> ${LOREM}</p>`,
    target: `document.querySelector('mark')`,
    resize: { width: 380, height: 700 },
    expect: 'follow',
  },
  {
    name: 'a single word when words are inserted earlier in the same paragraph',
    html: `<p style="max-width:600px"><span id="lead">${LOREM}</span> ${LOREM} <mark>keyword</mark> ${LOREM}</p>`,
    target: `document.querySelector('mark')`,
    mutate: `document.getElementById('lead').textContent += ' and a few more words were added here by an edit';`,
    expect: 'follow',
  },
  {
    name: 'a single word when the page font grows',
    html: `<p style="max-width:600px">${LOREM} <mark>keyword</mark> ${LOREM}</p>`,
    target: `document.querySelector('mark')`,
    mutate: `document.documentElement.style.fontSize = '22px'; document.body.style.fontSize = '22px';`,
    expect: 'follow',
  },
  {
    name: 'item in a scrolling pane when the pane scrolls',
    html: `<div id="pane" style="height:400px;overflow:auto;width:500px">${repeat(20, (i) => `<div class="m" style="height:60px">Message ${i} hello</div>`)}</div>`,
    target: `document.querySelectorAll('.m')[3]`,
    mutate: `document.getElementById('pane').scrollTop = 100;`,
    expect: 'follow',
  },
  {
    name: 'item in a scrolling pane is clipped to the pane once scrolled out of view',
    html: `<div style="height:80px">Header</div><div id="pane" style="height:300px;overflow:auto;width:500px">${repeat(20, (i) => `<div class="m" style="height:60px">Message ${i} hello</div>`)}</div>`,
    target: `document.querySelectorAll('.m')[1]`,
    mutate: `document.getElementById('pane').scrollTop = 400;`,
    expect: 'clipped',
  },
  {
    name: 'section that gets hidden with display:none',
    html: `<div>${repeat(4, (i) => `<section style="height:100px">Section ${i} content here</section>`)}</div>`,
    target: `document.querySelectorAll('section')[2]`,
    mutate: `document.querySelectorAll('section')[2].style.display = 'none';`,
    expect: 'hidden',
  },
  {
    name: 'content of a collapsed <details> panel',
    html: `<details open><summary>More info</summary><p>Hidden detail paragraph with useful text</p></details><p>After the details</p>`,
    target: `document.querySelector('details p')`,
    mutate: `document.querySelector('details').open = false;`,
    expect: 'hidden',
  },
  {
    name: 'content of a <details> panel that is collapsed and opened again further down',
    html: `<div id="top"></div><details open><summary>More info</summary><p>Detail paragraph with useful text</p></details>`,
    target: `document.querySelector('details p')`,
    mutate: `const d = document.querySelector('details'); d.open = false; await new Promise((r) => setTimeout(r, 300)); document.getElementById('top').style.height = '120px'; d.open = true;`,
    expect: 'follow',
  },
  {
    name: 'panel in an inactive tab',
    html: `<div role="tablist"><button id="t1">One</button><button id="t2">Two</button></div><div id="p1" role="tabpanel"><p>First tab panel text</p></div><div id="p2" role="tabpanel" hidden><p>Second tab panel text</p></div>`,
    target: `document.querySelector('#p1 p')`,
    mutate: `document.getElementById('p1').hidden = true; document.getElementById('p2').hidden = false;`,
    expect: 'hidden',
  },
  {
    name: 'item whose own counter text changed while an item was added above',
    html: `<ul>${repeat(5, (i) => `<li><b>Post ${i}</b> <span>${i} comments</span></li>`)}</ul>`,
    target: `document.querySelectorAll('li')[2]`,
    mutate: `document.querySelectorAll('li')[2].querySelector('span').textContent = '99 comments'; const li = document.createElement('li'); li.textContent = 'Top'; document.querySelector('ul').prepend(li);`,
    expect: 'follow',
  },
  {
    name: 'note in the empty margin beside a paragraph',
    html: `<div style="width:500px">${repeat(6, (i) => `<p style="margin:0;padding:20px 0">Para ${i} some words go here</p>`)}</div>`,
    target: `document.querySelectorAll('p')[3]`,
    draw: 'margin',
    mutate: `const p = document.createElement('p'); p.style.height = '120px'; p.textContent = 'x'; document.querySelector('div').prepend(p);`,
    expect: 'follow',
  },
  {
    name: 'link in a fixed header when the page scrolls',
    html: `<header style="position:fixed;top:0;left:0;right:0;height:60px;background:#eee"><nav><a href="/home">Home</a> <a href="/docs">Docs</a></nav></header><div style="height:3000px"></div>`,
    target: `document.querySelectorAll('a')[1]`,
    mutate: `window.scrollTo(0, 500);`,
    expect: 'follow',
  },
  {
    name: 'link in a sticky header when the page scrolls',
    html: `<div style="height:200px">Intro</div><header style="position:sticky;top:0;height:50px;background:#eee"><a href="/a">Alpha</a> <a href="/b">Beta</a></header><div style="height:3000px">Body</div>`,
    target: `document.querySelectorAll('a')[1]`,
    mutate: `window.scrollTo(0, 800);`,
    expect: 'follow',
  },
  {
    name: 'card with hashed class names when a card is inserted above (frame drawn around it)',
    html: `<div class="feed_x1">${repeat(5, (i) => `<div class="card_a8f3k" style="padding:12px;margin:8px;border:1px solid #ccc"><h3>Card heading ${i}</h3><p>Body text ${i} with details</p></div>`)}</div>`,
    target: `document.querySelectorAll('.card_a8f3k')[2]`,
    draw: 'box',
    mutate: `const d = document.createElement('div'); d.className = 'card_a8f3k'; d.innerHTML = '<h3>New</h3><p>new</p>'; document.querySelector('.feed_x1').prepend(d);`,
    expect: 'follow',
  },
  {
    name: 'paragraph when a lazy-loaded block above gets its height',
    html: `<div><div id="slot"></div>${repeat(5, (i) => `<p>Line ${i} of the article text here</p>`)}</div>`,
    target: `document.querySelectorAll('p')[2]`,
    mutate: `document.getElementById('slot').style.height = '300px';`,
    expect: 'follow',
  },
  {
    name: 'image tile without text when a tile is inserted before it',
    html: `<div id="gallery">${repeat(6, (i) => `<div role="img" aria-label="Photo ${i}" style="display:inline-block;width:120px;height:90px;margin:4px;background:#ccd"></div>`)}</div>`,
    target: `document.querySelectorAll('[role=img]')[3]`,
    mutate: `const d = document.createElement('div'); d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'Photo new'); d.style.cssText = 'display:inline-block;width:120px;height:90px;margin:4px;background:#dcc'; document.getElementById('gallery').prepend(d);`,
    expect: 'follow',
  },
  {
    name: 'icon button identified by aria-label when a button is added before it',
    html: `<div id="bar"><button aria-label="Bold" style="width:40px;height:32px"></button><button aria-label="Italic" style="width:40px;height:32px"></button><button aria-label="Underline" style="width:40px;height:32px"></button></div>`,
    target: `document.querySelector('[aria-label=Underline]')`,
    mutate: `const b = document.createElement('button'); b.setAttribute('aria-label', 'Strike'); b.style.cssText = 'width:120px;height:32px'; document.getElementById('bar').prepend(b);`,
    expect: 'follow',
  },
  {
    name: 'web component with shadow DOM text when another is inserted above',
    html: `<div id="list"></div><script>customElements.define('user-card', class extends HTMLElement { connectedCallback() { if (this.shadowRoot) return; const r = this.attachShadow({ mode: 'open' }); r.innerHTML = '<div style="padding:10px;border:1px solid #999">' + this.dataset.who + ' profile card</div>'; } }); for (const who of ['Ada', 'Grace', 'Linus', 'Ken']) { const c = document.createElement('user-card'); c.dataset.who = who; c.style.display = 'block'; document.getElementById('list').append(c); }</script>`,
    target: `document.querySelectorAll('user-card')[2]`,
    mutate: `const c = document.createElement('user-card'); c.dataset.who = 'Barbara'; c.style.display = 'block'; document.getElementById('list').prepend(c);`,
    expect: 'follow',
  },
  {
    name: 'element moved by a CSS transition with no further DOM change',
    html: `<style>.mover { transition: transform 200ms linear; } .mover.shifted { transform: translateY(140px); }</style><div><p>Static intro line</p><p class="mover">Moving target paragraph</p></div>`,
    target: `document.querySelector('.mover')`,
    mutate: `document.querySelector('.mover').classList.add('shifted');`,
    expect: 'follow',
  },
  {
    name: 'list re-rendered after being briefly removed (route change and back)',
    html: `<div id="app"><ul>${repeat(5, (i) => `<li>Entry ${i} of the list</li>`)}</ul></div>`,
    target: `document.querySelectorAll('li')[3]`,
    mutate: `const app = document.getElementById('app'); const html = app.innerHTML; app.innerHTML = '<p>Loading...</p>'; await new Promise((r) => setTimeout(r, 400)); app.innerHTML = '<p style="height:90px">Banner</p>' + html;`,
    truth: `[...document.querySelectorAll('li')].find((li) => li.textContent === 'Entry 3 of the list')`,
    expect: 'follow',
  },
  {
    name: 'right-to-left list when an item is inserted above',
    html: `<ul dir="rtl">${repeat(6, (i) => `<li>عنصر رقم ${i} في القائمة</li>`)}</ul>`,
    target: `document.querySelectorAll('li')[3]`,
    mutate: `const li = document.createElement('li'); li.textContent = 'جديد'; document.querySelector('ul').prepend(li);`,
    expect: 'follow',
  },
  {
    name: 'deleted list item stays orphaned instead of jumping to a look-alike',
    html: `<ul>${repeat(8, (i) => `<li>Item number ${i} with some text</li>`)}</ul>`,
    target: `document.querySelectorAll('li')[4]`,
    mutate: `document.querySelectorAll('li')[4].remove();`,
    expect: 'orphaned',
  },
  {
    name: 'deleted comment does not move its "Reply" mark to another comment',
    html: `<div id="thread">${repeat(6, (i) => `<div class="c"><p>Comment body number ${i} talking about things</p><a href="#">Reply</a></div>`)}</div>`,
    target: `document.querySelectorAll('a')[3]`,
    mutate: `document.querySelectorAll('.c')[3].remove();`,
    expect: 'orphaned',
  },
];
