// ── STATE ─────────────────────────────────────────────────────────────────────
let allNodes = [], allLinks = [];
let noteMap  = new Map();  // filenameStem → zk list note object
let simulation, zoomBehavior;
let selectedNode = null;

const svg     = d3.select('#svg');
const tooltip = document.getElementById('tooltip');
const panel   = document.getElementById('panel');

// ── AUTO-LOAD via fetch ───────────────────────────────────────────────────────
const statusPill = document.getElementById('status-pill');
const reloadBtn  = document.getElementById('reload-btn');

async function loadAll() {
  reloadBtn.classList.add('loading');
  reloadBtn.textContent = '↺ Loading…';
  statusPill.className = 'status-pill';
  statusPill.textContent = 'loading…';

  try {
    const [graphRes, notesRes] = await Promise.all([
      fetch('data/graph.json'),
      fetch('data/notes.json')
    ]);

    if (!graphRes.ok) throw new Error(`graph.json: ${graphRes.status} ${graphRes.statusText}`);
    if (!notesRes.ok) throw new Error(`notes.json: ${notesRes.status} ${notesRes.statusText}`);

    const [graphRaw, notesRaw] = await Promise.all([graphRes.json(), notesRes.json()]);

    const links = Array.isArray(graphRaw) ? graphRaw : (graphRaw.links || graphRaw.edges || graphRaw.data || []);
    const notes = Array.isArray(notesRaw) ? notesRaw : (notesRaw.notes || notesRaw.data || []);

    // Load notes first so titles are ready when graph builds
    noteMap.clear();
    notes.forEach(n => noteMap.set(n.filenameStem, n));

    buildGraph(links);

    statusPill.className = 'status-pill ok';
    statusPill.textContent = `✓ ${allNodes.length} notes · ${allLinks.length} links`;
  } catch (err) {
    statusPill.className = 'status-pill err';
    statusPill.textContent = '⚠ ' + err.message;
    document.getElementById('empty-hint').querySelector('h2').textContent = 'Failed to load';
    document.getElementById('empty-hint').querySelector('p').innerHTML =
      `<b>${err.message}</b><br><br>Make sure <code>graph.json</code> and <code>notes.json</code><br>are in the same folder as this HTML file<br>and the server is running:<br><code>python3 -m http.server</code>`;
    document.getElementById('empty-hint').style.display = '';
  }

  reloadBtn.classList.remove('loading');
  reloadBtn.textContent = '↺ Reload';
}

reloadBtn.addEventListener('click', loadAll);
loadAll();

// ── BUILD GRAPH ───────────────────────────────────────────────────────────────
function buildGraph(rawLinks) {
  const nodeMap = new Map();

  rawLinks.forEach(l => {
    if (!nodeMap.has(l.sourceId)) {
      const stem = stemFromPath(l.sourcePath);
      nodeMap.set(l.sourceId, { id: l.sourceId, stem, label: stem, path: l.sourcePath, links: [] });
    }
    if (!nodeMap.has(l.targetId)) {
      const stem = l.href || stemFromPath(l.targetPath);
      nodeMap.set(l.targetId, { id: l.targetId, stem, label: stem, path: l.targetPath, links: [] });
    }
    nodeMap.get(l.sourceId).links.push({ dir: 'out', targetId: l.targetId, snippet: l.snippet, title: l.title });
    nodeMap.get(l.targetId).links.push({ dir: 'in',  targetId: l.sourceId, snippet: l.snippet, title: l.title });
  });

  allNodes = Array.from(nodeMap.values());
  allLinks = rawLinks.map(l => ({ source: l.sourceId, target: l.targetId, snippet: l.snippet, title: l.title }));

  const deg = {};
  allLinks.forEach(l => { deg[l.source]=(deg[l.source]||0)+1; deg[l.target]=(deg[l.target]||0)+1; });
  allNodes.forEach(n => { n.degree = deg[n.id] || 0; });

  enrichNodes();

  document.getElementById('stat-nodes').textContent = allNodes.length;
  document.getElementById('stat-links').textContent = allLinks.length;
  document.getElementById('empty-hint').style.display = 'none';
  renderGraph();
}

function stemFromPath(path) {
  if (!path) return '?';
  const m = path.match(/\[([^\]]+)\]/);
  return (m ? m[1] : path).replace(/\.md$/i, '');
}

function enrichNodes() {
  allNodes.forEach(n => {
    const note = noteMap.get(n.stem);
    if (note) {
      n.label      = note.title  || n.stem;
      n.rawContent = note.rawContent || '';
      n.lead       = note.lead   || '';
      n.tags       = note.tags   || [];
      n.created    = note.created;
      n.modified   = note.modified;
      n.wordCount  = note.wordCount;
    } else {
      n.label = n.label || n.stem;
    }
  });
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderGraph() {
  svg.selectAll('*').remove();
  selectedNode = null;
  panel.classList.remove('open');

  const cont = document.getElementById('graph-container');
  const W = cont.clientWidth, H = cont.clientHeight;
  const maxDeg = d3.max(allNodes, d => d.degree) || 1;
  const nodeR  = d => 5 + (d.degree / maxDeg) * 14;

  const g = svg.append('g');
  zoomBehavior = d3.zoom().scaleExtent([0.05, 10]).on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoomBehavior).on('dblclick.zoom', null);

  const linkSel = g.append('g').selectAll('line')
    .data(allLinks).join('line').attr('class', 'link');

  const nodeSel = g.append('g').selectAll('g')
    .data(allNodes, d => d.id).join('g').attr('class', 'node')
    .call(d3.drag()
      .on('start', (e,d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag',  (e,d) => { d.fx=e.x; d.fy=e.y; })
      .on('end',   (e,d) => { if (!e.active) simulation.alphaTarget(0); d.fx=null; d.fy=null; })
    );

  nodeSel.append('circle')
    .attr('r', d => nodeR(d))
    .attr('fill',   d => d.degree >= maxDeg*0.6 ? 'var(--node-hub)' : 'var(--node-default)')
    .attr('stroke', d => d.degree >= maxDeg*0.6 ? cssVar('--node-hub-stroke') : cssVar('--node-default-stroke'))
    .style('filter',d => d.degree >= maxDeg*0.6
      ? `drop-shadow(0 0 6px ${cssVar('--node-hub-glow')})` : `drop-shadow(0 0 4px ${cssVar('--node-default-glow')})`);

  nodeSel.append('text')
    .attr('dy', d => nodeR(d) + 12)
    .attr('text-anchor', 'middle')
    .text(d => truncLabel(d.label));

  nodeSel
    .on('mouseenter', (e,d) => showTooltip(e, d.label + (d.label !== d.stem ? `\n${d.stem}` : '') + (d.degree ? ` · ${d.degree} links` : '')))
    .on('mousemove',  e => moveTooltip(e))
    .on('mouseleave', () => hideTooltip())
    .on('click', (e,d) => { e.stopPropagation(); selectNode(d, nodeSel, linkSel); });

  svg.on('click', () => {
    deselectAll(nodeSel, linkSel);
    panel.classList.remove('open');
    selectedNode = null;
  });

  simulation = d3.forceSimulation(allNodes)
    .force('link',      d3.forceLink(allLinks).id(d=>d.id).distance(90).strength(0.5))
    .force('charge',    d3.forceManyBody().strength(-220))
    .force('center',    d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide().radius(d => nodeR(d)+10))
    .on('tick', () => {
      linkSel.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
             .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
      nodeSel.attr('transform', d=>`translate(${d.x},${d.y})`);
      updateHintOverlay();
    });

  // Re-sync hint positions whenever the user pans or zooms
  zoomBehavior.on('zoom.hints', updateHintOverlay);

  buildHintOverlay(nodeSel);

  document.getElementById('zoom-in').onclick  = () => svg.transition().call(zoomBehavior.scaleBy, 1.4);
  document.getElementById('zoom-out').onclick = () => svg.transition().call(zoomBehavior.scaleBy, 0.7);
  document.getElementById('zoom-fit').onclick = () => fitAll(W, H);
}

function truncLabel(s) {
  if (!s) return '';
  return s.length > 24 ? s.slice(0,22)+'…' : s;
}

// ── HINT OVERLAY ──────────────────────────────────────────────────────────────
// Invisible <a> elements that sit on top of each node so qutebrowser's
// f-hint mode can target them. Positions are kept in sync with the simulation
// and the current zoom/pan transform.

const hintOverlay = document.getElementById('hint-overlay');

function buildHintOverlay(nodeSel) {
  hintOverlay.innerHTML = '';
  allNodes.forEach(d => {
    const a = document.createElement('a');
    a.className  = 'node-hint';
    a.href       = '#';
    a.dataset.id = d.id;
    a.setAttribute('aria-label', d.label);   // qutebrowser shows this as hint text
    a.setAttribute('title', d.label);
    a.addEventListener('click', e => {
      e.preventDefault();
      selectNode(d, d3.selectAll('.node'), d3.selectAll('.link'));
      // Don't pan — the user can see the node, they just hinted it
    });
    hintOverlay.appendChild(a);
  });
}

function updateHintOverlay() {
  if (!zoomBehavior) return;
  const svgEl    = document.getElementById('svg');
  const t        = d3.zoomTransform(svgEl);    // current pan/zoom transform
  const anchors  = hintOverlay.querySelectorAll('a.node-hint');

  allNodes.forEach((d, i) => {
    const a = anchors[i];
    if (!a) return;
    // Convert simulation coords → screen coords using the D3 transform
    const sx = t.applyX(d.x);
    const sy = t.applyY(d.y);
    a.style.left = sx + 'px';
    a.style.top  = sy + 'px';
  });
}

// ── SELECTION ─────────────────────────────────────────────────────────────────
function selectNode(d, nodeSel, linkSel) {
  selectedNode = d;
  const connIds = new Set(), connLinks = new Set();
  allLinks.forEach((l,i) => {
    const sid = typeof l.source==='object' ? l.source.id : l.source;
    const tid = typeof l.target==='object' ? l.target.id : l.target;
    if (sid===d.id || tid===d.id) { connIds.add(sid); connIds.add(tid); connLinks.add(i); }
  });
  const maxDeg = d3.max(allNodes, x=>x.degree)||1;
  nodeSel.classed('dimmed', n => n.id!==d.id && !connIds.has(n.id));
  nodeSel.select('circle')
    .attr('fill', n => {
      if (n.id===d.id) return 'var(--node-selected)';
      if (connIds.has(n.id)) return 'var(--node-connected)';
      return n.degree>=maxDeg*0.6 ? 'var(--node-hub)' : 'var(--node-default)';
    })
    .style('filter', n => {
      if (n.id===d.id) return `drop-shadow(0 0 10px ${cssVar('--node-selected-glow')})`;
      if (connIds.has(n.id)) return `drop-shadow(0 0 6px ${cssVar('--node-connected-glow')})`;
      return null;
    });
  linkSel.classed('dimmed',(_,i)=>!connLinks.has(i)).classed('highlighted',(_,i)=>connLinks.has(i));
  showPanel(d);
}

function deselectAll(nodeSel, linkSel) {
  const maxDeg = d3.max(allNodes, d=>d.degree)||1;
  nodeSel.classed('dimmed', false);
  nodeSel.select('circle')
    .attr('fill',   d => d.degree>=maxDeg*0.6 ? 'var(--node-hub)' : 'var(--node-default)')
    .style('filter',d => d.degree>=maxDeg*0.6
      ? `drop-shadow(0 0 6px ${cssVar('--node-hub-glow')})` : `drop-shadow(0 0 4px ${cssVar('--node-default-glow')})`);
  linkSel.classed('dimmed', false).classed('highlighted', false);
}

// ── TABS ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── PANEL ─────────────────────────────────────────────────────────────────────
function showPanel(d) {
  document.getElementById('panel-title').textContent = d.label;
  document.getElementById('panel-stem').textContent  = d.stem;

  // ── CONTENT TAB ──
  const cpane = document.getElementById('tab-content');
  if (d.rawContent) {
    cpane.innerHTML = `<div class="md-content">${renderMd(d.rawContent)}</div>`;
    foldHeadings(cpane.querySelector('.md-content'));
    cpane.querySelectorAll('.wikilink[data-stem]').forEach(el => {
      el.addEventListener('click', () => {
        const n = allNodes.find(x => x.stem === el.dataset.stem);
        if (!n) return;
        selectNode(n, d3.selectAll('.node'), d3.selectAll('.link'));
        panToNode(n);
      });
    });
    // Ask MathJax to typeset the new content (no-op if MathJax not loaded)
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([cpane]).catch(err => console.warn('MathJax:', err));
    }
  } else {
    cpane.innerHTML = `<div class="no-content">
      <div class="nc-icon">📄</div>
      <p>No content available.<br>Load <b>Notes JSON</b><br>(<code>zk list --format json</code>)<br>to see note content here.</p>
    </div>`;
  }

  // ── LINKS TAB ──
  const outLinks = d.links.filter(l=>l.dir==='out');
  const inLinks  = d.links.filter(l=>l.dir==='in');
  let lh = `<div class="section-label">Stats</div>`;
  lh += srow('Total links', d.degree) + srow('Outgoing', outLinks.length) + srow('Incoming', inLinks.length);
  if (outLinks.length) {
    lh += `<div class="section-label mt">Links to (${outLinks.length})</div>`;
    outLinks.forEach(l => { lh += citem(l, 'out'); });
  }
  if (inLinks.length) {
    lh += `<div class="section-label mt">Linked from (${inLinks.length})</div>`;
    inLinks.forEach(l => { lh += citem(l, 'in'); });
  }
  const lpane = document.getElementById('tab-links');
  lpane.innerHTML = lh;
  lpane.querySelectorAll('.connection-item[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const n = allNodes.find(x => x.id===parseInt(el.dataset.id,10));
      if (!n) return;
      selectNode(n, d3.selectAll('.node'), d3.selectAll('.link'));
      panToNode(n);
    });
  });

  // ── META TAB ──
  let mh = `<div class="section-label">File</div>`;
  mh += srow('Filename', esc(d.stem));
  if (d.wordCount != null) mh += srow('Word count', d.wordCount);
  if (d.created)  mh += srow('Created',  fmtDate(d.created));
  if (d.modified) mh += srow('Modified', fmtDate(d.modified));
  if (d.tags && d.tags.length) {
    mh += `<div class="section-label mt">Tags</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px">` +
      d.tags.map(t=>`<span style="background:rgba(61,127,255,0.12);color:var(--accent);border:1px solid rgba(61,127,255,0.25);border-radius:4px;padding:2px 8px;font-size:10px">${esc(t)}</span>`).join('') +
      `</div>`;
  }
  document.getElementById('tab-meta').innerHTML = mh;

  panel.classList.add('open');
}

function srow(label, value) {
  return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

function citem(l, dir) {
  const node  = allNodes.find(n => n.id===l.targetId);
  const title = node ? node.label : (l.title || String(l.targetId));
  const stem  = node ? node.stem  : '';
  const showStem = node && node.label !== node.stem;
  return `<div class="connection-item" data-id="${l.targetId}">
    <span class="conn-arrow">${dir==='out'?'→':'←'}</span>
    <div style="flex:1;min-width:0">
      <div class="conn-title">${esc(title)}</div>
      ${showStem ? `<div class="conn-stem">${esc(stem)}</div>` : ''}
      ${l.snippet ? `<div class="conn-snippet">${esc(l.snippet)}</div>` : ''}
    </div>
    <span class="conn-dir dir-${dir}">${dir}</span>
  </div>`;
}

document.getElementById('panel-close').addEventListener('click', () => {
  panel.classList.remove('open');
  deselectAll(d3.selectAll('.node'), d3.selectAll('.link'));
  selectedNode = null;
});

// ── PANEL RESIZE ──────────────────────────────────────────────────────────────
(function () {
  const handle = document.getElementById('panel-resize-handle');
  let dragging = false;
  let startX, startWidth;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging   = true;
    startX     = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    // Handle is on the LEFT edge of the panel; dragging left = wider
    const delta    = startX - e.clientX;
    const newWidth = Math.min(780, Math.max(260, startWidth + delta));
    panel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });
})();

// ── FOLDABLE HEADINGS ─────────────────────────────────────────────────────────
// Wraps every H2/H3 and its following sibling content in a <details> element.
// H1 is left as-is (it's the note title). Starts collapsed.
function foldHeadings(container) {
  if (!container) return;

  // Heading tags we want to make foldable (not H1)
  const FOLD_TAGS = new Set(['H2', 'H3']);

  const children = Array.from(container.childNodes);
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    if (node.nodeType === Node.ELEMENT_NODE && FOLD_TAGS.has(node.tagName)) {
      const level   = parseInt(node.tagName[1]);
      const details = document.createElement('details');
      const summary = document.createElement('summary');

      // Move heading content into <summary>
      summary.innerHTML = node.innerHTML;
      summary.dataset.level = level;
      details.appendChild(summary);

      // Collect all following siblings that belong under this heading:
      // stop when we hit another heading of equal or lesser depth
      let j = i + 1;
      while (j < children.length) {
        const sib = children[j];
        if (
          sib.nodeType === Node.ELEMENT_NODE &&
          FOLD_TAGS.has(sib.tagName) &&
          parseInt(sib.tagName[1]) <= level
        ) break;
        details.appendChild(sib.cloneNode(true));
        j++;
      }

      // Replace original nodes with the <details> block
      const toRemove = children.slice(i, j);
      toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));
      container.insertBefore(details, children[j] || null);

      // Refresh children array after DOM mutation
      children.splice(i, j - i, details);
    }

    i++;
  }
}

// ── INLINE FORMATTER ─────────────────────────────────────────────────────────
// Apply bold, italic, inline-code and wiki-links to an already-escaped string.
// Used for table cells and list items that need inline formatting.
function inlineFmt(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  return s;
}

// ── TABLE RENDERER ────────────────────────────────────────────────────────────
// Receives the raw lines array (before esc()), the latex stash function, and
// the latex array. Produces table HTML with cells already escaped+formatted,
// including LaTeX stashing inside cells.
function renderTables(lines, stashLatex) {
  const out = [];
  let i = 0;

  function parseCells(line) {
    // strip leading/trailing pipe then split — handles lines with or without outer pipes
    return line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  }

  function isSeparator(line) {
    // each cell must be only dashes, optional colons, optional spaces
    const cells = parseCells(line.trim());
    return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c.trim()));
  }

  function alignment(cell) {
    const t = cell.trim();
    if (/^:-+:$/.test(t)) return 'center';
    if (/^-+:$/.test(t))  return 'right';
    return 'left';
  }

  // Render a single cell: stash latex, then escape, then inline-format
  function renderCell(raw) {
    const latexed = stashLatex(raw);
    return inlineFmt(esc(latexed));
  }

  while (i < lines.length) {
    const line = typeof lines[i] === 'string' ? lines[i] : '';
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      isSeparator(lines[i + 1])
    ) {
      const headers = parseCells(line);
      const aligns  = parseCells(lines[i + 1]).map(alignment);
      i += 2;

      let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
      headers.forEach((h, ci) => {
        html += `<th style="text-align:${aligns[ci]||'left'}">${renderCell(h)}</th>`;
      });
      html += '</tr></thead><tbody>';

      while (i < lines.length && typeof lines[i] === 'string' && lines[i].trim().startsWith('|')) {
        const cells = parseCells(lines[i]);
        html += '<tr>';
        cells.forEach((c, ci) => {
          html += `<td style="text-align:${aligns[ci]||'left'}">${renderCell(c)}</td>`;
        });
        html += '</tr>';
        i++;
      }

      html += '</tbody></table></div>';
      out.push(html);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out;
}

// ── NESTED LIST RENDERER ──────────────────────────────────────────────────────
function renderLists(s) {
  const lines = s.split('\n');
  const out   = [];
  let i = 0;

  function indentOf(line) {
    const m = line.match(/^([ \t]*)/);
    return m ? m[1].replace(/\t/g, '    ').length : 0;
  }
  function isUL(line) { return /^[ \t]*[-*+] /.test(line); }
  function isOL(line) { return /^[ \t]*\d+\. /.test(line); }
  function isList(line) { return isUL(line) || isOL(line); }

  function parseList(minIndent) {
    const tag = isOL(lines[i]) ? 'ol' : 'ul';
    let html = `<${tag}>`;

    while (i < lines.length && isList(lines[i]) && indentOf(lines[i]) >= minIndent) {
      const indent = indentOf(lines[i]);
      const text = lines[i].replace(/^[ \t]*(?:[-*+]|\d+\.) /, '');
      i++;
      let children = '';
      while (i < lines.length && isList(lines[i]) && indentOf(lines[i]) > indent) {
        children += parseList(indentOf(lines[i]));
      }
      html += `<li>${text}${children}</li>`;
    }

    html += `</${tag}>`;
    return html;
  }

  while (i < lines.length) {
    if (isList(lines[i])) {
      out.push(parseList(indentOf(lines[i])));
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

// ── MARKDOWN RENDERER ─────────────────────────────────────────────────────────
function renderMd(raw) {
  // Shared latex stash — populated by stashLatex(), restored at the very end.
  const latex = [];

  function stashLatex(src) {
    return src
      .replace(/\$\$([\s\S]+?)\$\$/g,              (_, m) => { latex.push(`$$${m}$$`);   return `\x00L${latex.length-1}\x00`; })
      .replace(/\\\[([\s\S]+?)\\\]/g,              (_, m) => { latex.push(`\\[${m}\\]`); return `\x00L${latex.length-1}\x00`; })
      .replace(/(?<!\$)\$([^\$\n]+?)\$(?!\$)/g,    (_, m) => { latex.push(`$${m}$`);     return `\x00L${latex.length-1}\x00`; })
      .replace(/\\\((.+?)\\\)/g,                   (_, m) => { latex.push(`\\(${m}\\)`); return `\x00L${latex.length-1}\x00`; });
  }

  // ── STEP 1: split into lines; run table renderer on raw lines
  // (renderTables handles its own LaTeX stashing + escaping per cell)
  let lines = raw.split('\n');
  lines = renderTables(lines, stashLatex);

  // ── STEP 2: stash table HTML behind placeholders
  const tableBlocks = [];
  lines = lines.map(l => {
    if (typeof l === 'string' && l.startsWith('<div class="md-table-wrap">')) {
      tableBlocks.push(l);
      return `\x00T${tableBlocks.length-1}\x00`;
    }
    return l;
  });

  let s = lines.join('\n');

  // ── STEP 3: stash LaTeX in remaining (non-table) raw text
  s = stashLatex(s);

  // ── STEP 4: HTML-escape plain text
  s = esc(s);

  // ── STEP 5: protect fenced code blocks
  const blocks = [];
  s = s.replace(/```[\s\S]*?```/g, m => { blocks.push(m); return `\x00B${blocks.length-1}\x00`; });

  // ── STEP 6: inline code
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);

  // ── STEP 7: wiki-links [[stem]]
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, stem) => {
    const node  = allNodes.find(n => n.stem===stem);
    const res   = node ? ' resolved' : '';
    const label = (node && node.label && node.label !== node.stem) ? node.label : stem;
    return `<span class="wikilink${res}" data-stem="${escAttr(stem)}" title="${escAttr(stem)}">${esc(label)}</span>`;
  });

  // ── STEP 8: headings
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // ── STEP 9: HR (--- that isn't a table separator — those are already consumed)
  s = s.replace(/^---+$/gm, '<hr>');

  // ── STEP 10: bold / italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // ── STEP 11: callouts and blockquotes (run on raw-escaped text)
  // Obsidian/GitHub callout: > [!TYPE] on first line, then > continuation lines
  s = s.replace(
    /(?:^|\n)(&gt; \[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT|INFO)\][ \t]*\n?)((?:&gt;[^\n]*\n?)*)/gi,
    (_, first, type, rest) => {
      const label = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
      const icon  = { note:'ℹ️', tip:'💡', warning:'⚠️', caution:'🔥', important:'📌', info:'ℹ️' }[type.toLowerCase()] || 'ℹ️';
      const body  = rest.replace(/^&gt; ?/gm, '').trim();
      return `<div class="callout callout-${type.toLowerCase()}"><div class="callout-title">${icon} ${label}</div><div class="callout-body">${body}</div></div>`;
    }
  );
  // Plain blockquotes
  s = s.replace(/^(&gt; .+\n?)+/gm, block => {
    const inner = block.replace(/^&gt; ?/gm, '').trimEnd();
    return `<blockquote>${inner}</blockquote>\n`;
  });

  // ── STEP 12: nested lists
  s = renderLists(s);

  // ── STEP 13: restore code blocks
  s = s.replace(/\x00B(\d+)\x00/g, (_, i) => {
    const inner = blocks[+i].replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    return `<pre><code>${inner}</code></pre>`;
  });

  // ── STEP 14: restore table blocks
  s = s.replace(/\x00T(\d+)\x00/g, (_, i) => tableBlocks[+i]);

  // ── STEP 15: restore LaTeX verbatim (MathJax processes after DOM insertion)
  s = s.replace(/\x00L(\d+)\x00/g, (_, i) => latex[+i]);

  // ── STEP 16: paragraphs (skip lines already starting with a block tag)
  s = s.replace(/^(?!<[houtbpdr]|<pre|<hr|<blockquote|<div)(.+)$/gm, '<p>$1</p>');
  s = s.replace(/<p>\s*<\/p>/g, '');

  return s;
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
let searchMatches = [];   // ordered list of matching nodes
let searchIndex   = -1;   // which match is currently focused

function runSearch(q) {
  if (!q) {
    searchMatches = [];
    searchIndex   = -1;
    d3.selectAll('.node').classed('dimmed', false);
    clearSearchCount();
    // close panel only if it was opened by a search selection
    if (panel.dataset.openedBySearch) {
      panel.classList.remove('open');
      deselectAll(d3.selectAll('.node'), d3.selectAll('.link'));
      selectedNode = null;
      delete panel.dataset.openedBySearch;
    }
    return;
  }

  // Collect matches in a stable order (by node id)
  searchMatches = allNodes.filter(n =>
    n.label.toLowerCase().includes(q) || n.stem.toLowerCase().includes(q)
  );
  searchIndex = searchMatches.length ? 0 : -1;

  // Dim non-matches
  d3.selectAll('.node').classed('dimmed', d =>
    !d.label.toLowerCase().includes(q) && !d.stem.toLowerCase().includes(q)
  );

  focusSearchMatch();
}

function focusSearchMatch() {
  if (searchIndex < 0 || !searchMatches.length) return;
  const n = searchMatches[searchIndex];
  selectNode(n, d3.selectAll('.node'), d3.selectAll('.link'));
  panToNode(n);
  panel.dataset.openedBySearch = '1';
  // Update counter badge
  const counter = document.getElementById('search-count');
  if (counter) counter.textContent = `${searchIndex + 1} / ${searchMatches.length}`;
}

function clearSearchCount() {
  const counter = document.getElementById('search-count');
  if (counter) counter.textContent = '';
}

const searchEl = document.getElementById('search');

searchEl.addEventListener('input', function () {
  runSearch(this.value.toLowerCase().trim());
});

searchEl.addEventListener('keydown', function (e) {
  if (!searchMatches.length) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    // Shift+Enter goes backwards, Enter goes forwards
    if (e.shiftKey) {
      searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length;
    } else {
      searchIndex = (searchIndex + 1) % searchMatches.length;
    }
    focusSearchMatch();
  }

  if (e.key === 'Escape') {
    this.value = '';
    runSearch('');
    this.blur();
  }
});

// ── TOOLTIP ───────────────────────────────────────────────────────────────────
function showTooltip(e, text) {
  tooltip.style.whiteSpace = 'pre';
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  moveTooltip(e);
}
function moveTooltip(e) { tooltip.style.left=(e.clientX+14)+'px'; tooltip.style.top=(e.clientY-28)+'px'; }
function hideTooltip()  { tooltip.style.display='none'; }

// ── PAN / FIT ─────────────────────────────────────────────────────────────────
function panToNode(n) {
  const c = document.getElementById('graph-container');
  svg.transition().duration(500).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(c.clientWidth/2 - n.x, c.clientHeight/2 - n.y)
  );
}

function fitAll(W, H) {
  const xs = allNodes.map(d=>d.x).filter(Boolean);
  const ys = allNodes.map(d=>d.y).filter(Boolean);
  if (!xs.length) return;
  const pad=60, xMin=d3.min(xs), xMax=d3.max(xs), yMin=d3.min(ys), yMax=d3.max(ys);
  const scale = Math.min((W-pad*2)/(xMax-xMin||1), (H-pad*2)/(yMax-yMin||1), 4);
  svg.transition().duration(600).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(W/2-scale*(xMin+xMax)/2, H/2-scale*(yMin+yMax)/2).scale(scale)
  );
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }
  catch { return iso; }
}

// ── RESIZE ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  if (simulation) {
    const c = document.getElementById('graph-container');
    simulation.force('center', d3.forceCenter(c.clientWidth/2, c.clientHeight/2));
    simulation.alpha(0.1).restart();
  }
});

// ── COLOR SCHEME CHANGE ───────────────────────────────────────────────────────
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!allNodes.length) return;
  const maxDeg = d3.max(allNodes, d=>d.degree)||1;
  d3.selectAll('.node circle')
    .attr('stroke', d => d.degree>=maxDeg*0.6 ? cssVar('--node-hub-stroke') : cssVar('--node-default-stroke'))
    .style('filter', d => {
      if (selectedNode && d.id===selectedNode.id)
        return `drop-shadow(0 0 10px ${cssVar('--node-selected-glow')})`;
      if (selectedNode && !d3.selectAll('.node').filter(n=>n.id===d.id).classed('dimmed'))
        return `drop-shadow(0 0 6px ${cssVar('--node-connected-glow')})`;
      return d.degree>=maxDeg*0.6
        ? `drop-shadow(0 0 6px ${cssVar('--node-hub-glow')})`
        : `drop-shadow(0 0 4px ${cssVar('--node-default-glow')})`;
    });
});
