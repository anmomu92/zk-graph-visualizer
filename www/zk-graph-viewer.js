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
    });

  document.getElementById('zoom-in').onclick  = () => svg.transition().call(zoomBehavior.scaleBy, 1.4);
  document.getElementById('zoom-out').onclick = () => svg.transition().call(zoomBehavior.scaleBy, 0.7);
  document.getElementById('zoom-fit').onclick = () => fitAll(W, H);
}

function truncLabel(s) {
  if (!s) return '';
  return s.length > 24 ? s.slice(0,22)+'…' : s;
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
    cpane.querySelectorAll('.wikilink[data-stem]').forEach(el => {
      el.addEventListener('click', () => {
        const n = allNodes.find(x => x.stem === el.dataset.stem);
        if (!n) return;
        selectNode(n, d3.selectAll('.node'), d3.selectAll('.link'));
        panToNode(n);
      });
    });
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

// ── MARKDOWN RENDERER ─────────────────────────────────────────────────────────
function renderMd(raw) {
  // 1. escape HTML first
  let s = esc(raw);

  // 2. protect fenced code blocks
  const blocks = [];
  s = s.replace(/```[\s\S]*?```/g, m => { blocks.push(m); return `\x00B${blocks.length-1}\x00`; });

  // 3. inline code
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);

  // 4. wiki-links [[stem]] — show title if known, fall back to stem
  s = s.replace(/\[\[([^\]]+)\]\]/g, (_, stem) => {
    const node  = allNodes.find(n => n.stem===stem);
    const res   = node ? ' resolved' : '';
    const label = (node && node.label && node.label !== node.stem) ? node.label : stem;
    return `<span class="wikilink${res}" data-stem="${escAttr(stem)}" title="${escAttr(stem)}">${esc(label)}</span>`;
  });

  // 5. headings
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

  // 6. HR
  s = s.replace(/^---+$/gm, '<hr>');

  // 7. bold / italic
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // 8. blockquotes
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // 9. unordered lists
  s = s.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*+] /, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });

  // 10. ordered lists
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, block => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // 11. restore code blocks
  s = s.replace(/\x00B(\d+)\x00/g, (_, i) => {
    const inner = blocks[+i].replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    return `<pre><code>${inner}</code></pre>`;
  });

  // 12. paragraphs — lines not already inside block tags
  s = s.replace(/^(?!<[houpbr]|<pre|<hr|<blockquote)(.+)$/gm, '<p>$1</p>');
  s = s.replace(/<p>\s*<\/p>/g, '');

  return s;
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  d3.selectAll('.node').classed('dimmed', d =>
    q ? !d.label.toLowerCase().includes(q) && !d.stem.toLowerCase().includes(q) : false
  );
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
