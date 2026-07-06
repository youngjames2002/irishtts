const API = '/api';
const TIER_COLORS = { S: '#ff883e', A: '#e8c840', B: '#169b62', C: '#4a9fd4', D: '#888' };
const PR_LABELS = ['Irish PR','Ulster PR','Leinster PR','Munster PR','Connacht PR','Former Irish PR','Mid Season Shift'];
const REGIONS = ['Leinster','Ulster','Munster','Connacht'];

let allEvents = [];
let allPlayers = [];
let allTiers = [];
let allSeasons = [];
let sortCol = 'points_value';
let sortDir = 'desc';
let adminToken = null;
let isAdmin = false;
let addMode = 'manual';
let viewingHistoric = false;
let currentEditSeasonId = null;

// --- THEME ---
function setTheme(theme) {
  document.documentElement.className = 'theme-' + theme;
  localStorage.setItem('tts-theme', theme);
}

// --- AUTH ---
function toggleAdmin() {
  if (isAdmin) {
    isAdmin = false; adminToken = null;
    document.getElementById('admin-btn').classList.remove('active');
    document.getElementById('admin-btn').textContent = 'Admin';
    setAdminUI(false);
  } else {
    document.getElementById('login-modal').classList.add('open');
    setTimeout(() => document.getElementById('login-input').focus(), 100);
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (id === 'login-modal') {
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('login-input').value = '';
  }
}

async function doLogin() {
  const pw = document.getElementById('login-input').value;
  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    adminToken = data.token;
    isAdmin = true;
    closeModal('login-modal');
    document.getElementById('admin-btn').classList.add('active');
    document.getElementById('admin-btn').textContent = 'Logout';
    setAdminUI(true);
  } catch {
    document.getElementById('login-error').style.display = 'block';
  }
}

function setAdminUI(on) {
  document.getElementById('events-action-col').style.display = on ? '' : 'none';
  document.getElementById('add-event-btn').style.display = on ? 'block' : 'none';
  document.getElementById('add-player-btn').style.display = on ? 'block' : 'none';
  document.getElementById('add-tier-btn').style.display = on ? 'block' : 'none';
  document.getElementById('archive-season-btn').style.display = (on && !viewingHistoric) ? 'block' : 'none';
  document.getElementById('new-season-btn').style.display = (on && !viewingHistoric) ? 'block' : 'none';
  renderEvents(); renderPlayers(); renderTiers(); renderSeasons();
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` };
}

// --- TABS ---
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

// --- HELPERS ---
function tierPill(name) { return `<span class="tier-pill tier-${name}">${name} TIER</span>`; }

function regionTag(region) {
  if (!region) return '—';
  return `<span class="region-tag region-${region}">${region}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function calcTier(points) {
  if (!points || !allTiers.length) return null;
  const sorted = [...allTiers].sort((a, b) => b.min_points - a.min_points);
  const tier = sorted.find(t => points >= t.min_points);
  return tier ? tier.name : null;
}

// --- SORT ---
function sortTable(col) {
  if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
  else { sortCol = col; sortDir = col === 'points_value' ? 'desc' : 'asc'; }
  renderEvents(); updateSortHeaders();
}

function updateSortHeaders() {
  const cols = ['name','date','region','entrants','five_point_players','three_point_players','regional_bonus_points','points_value'];
  document.querySelectorAll('thead th').forEach((th, i) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (cols[i] === sortCol) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

// --- ADD EVENT MODAL ---
function openAddEventModal() {
  resetAddEventModal();
  document.getElementById('add-event-modal').classList.add('open');
}

function resetAddEventModal() {
  setAddMode('manual');
  ['f-name','f-link','f-date','f-entrants','f-5pt','f-3pt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-region').value = 'Leinster';
  document.getElementById('sg-url').value = '';
  document.getElementById('sg-preview').style.display = 'none';
  document.getElementById('sg-error').style.display = 'none';
  document.getElementById('sg-loading').style.display = 'none';
  document.getElementById('save-error').style.display = 'none';
}

function setAddMode(mode) {
  addMode = mode;
  document.getElementById('choice-manual').classList.toggle('selected', mode === 'manual');
  document.getElementById('choice-startgg').classList.toggle('selected', mode === 'startgg');
  document.getElementById('startgg-panel').style.display = mode === 'startgg' ? 'block' : 'none';
}

// --- STARTGG FETCH ---
async function fetchStartgg() {
  const url = document.getElementById('sg-url').value.trim();
  if (!url) return;

  let slug = url.replace('https://www.start.gg/', '').replace('http://www.start.gg/', '').replace('https://start.gg/', '');

  document.getElementById('sg-loading').style.display = 'block';
  document.getElementById('sg-error').style.display = 'none';
  document.getElementById('sg-preview').style.display = 'none';

  try {
    const res = await fetch(`${API}/startgg/event`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ slug })
    });

    if (!res.ok) throw new Error();
    const data = await res.json();

    document.getElementById('f-name').value = data.name || '';
    document.getElementById('f-link').value = url.startsWith('http') ? url : `https://www.start.gg/${slug}`;
    document.getElementById('f-date').value = data.date || '';
    document.getElementById('f-region').value = data.region || 'Leinster';
    document.getElementById('f-entrants').value = data.entrants || '';
    document.getElementById('f-5pt').value = data.five_point_players || '';
    document.getElementById('f-3pt').value = data.three_point_players || '';

    document.getElementById('sg-5pt-list').innerHTML = (data.matched_five || []).length
      ? data.matched_five.map(p => `<span class="ptag ptag-5">${p.tag}</span>`).join('')
      : '<span style="font-size:12px">None found</span>';

    document.getElementById('sg-3pt-list').innerHTML = (data.matched_three || []).length
      ? data.matched_three.map(p => `<span class="ptag ptag-3">${p.tag}</span>`).join('')
      : '<span style="font-size:12px">None found</span>';

    document.getElementById('sg-preview').style.display = 'block';
    document.getElementById('sg-loading').style.display = 'none';

  } catch(e) {
    document.getElementById('sg-loading').style.display = 'none';
    document.getElementById('sg-error').style.display = 'block';
  }
}

// --- SAVE NEW EVENT ---
async function saveNewEventModal() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) {
    document.getElementById('save-error').style.display = 'block';
    return;
  }

  const payload = {
    name,
    startgg_link: document.getElementById('f-link').value || null,
    date: document.getElementById('f-date').value || null,
    region: document.getElementById('f-region').value || null,
    entrants: parseInt(document.getElementById('f-entrants').value) || null,
    five_point_players: parseInt(document.getElementById('f-5pt').value) || null,
    three_point_players: parseInt(document.getElementById('f-3pt').value) || null,
  };

  await fetch(`${API}/events`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  closeModal('add-event-modal');
  await loadEvents();
}

// --- EVENTS ---
async function loadEvents() {
  try {
    const [eventsRes, tiersRes] = await Promise.all([fetch(`${API}/events`), fetch(`${API}/tiers`)]);
    allEvents = await eventsRes.json();
    allTiers = await tiersRes.json();

    document.getElementById('tiers-legend').innerHTML = allTiers.map(t => `
      <div class="tier-badge">
        <div class="tier-dot" style="background:${TIER_COLORS[t.name] || '#888'}"></div>
        <span style="color:${TIER_COLORS[t.name] || '#888'}">${t.name} TIER</span>
        <span style="color:#666">${t.min_points}+</span>
      </div>
    `).join('');

    renderEvents();
    updateSortHeaders();
  } catch(e) {
    document.getElementById('events-body').innerHTML = '<tr><td colspan="10" class="state-msg">Failed to load.</td></tr>';
  }
}

function renderEvents() {
  const sorted = [...allEvents].sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const body = document.getElementById('events-body');
  if (!sorted.length) { body.innerHTML = '<tr><td colspan="10" class="state-msg">No events.</td></tr>'; return; }

  body.innerHTML = sorted.map(e => `
    <tr data-id="${e.id}">
      <td><a class="event-link" href="${e.startgg_link || '#'}" target="_blank">${e.name}</a></td>
      <td class="date-col">${fmtDate(e.date)}</td>
      <td>${regionTag(e.region)}</td>
      <td>${e.entrants ?? '—'}</td>
      <td class="pts-5-val">${e.five_point_players ?? '—'}</td>
      <td class="pts-3-val">${e.three_point_players ?? '—'}</td>
      <td class="bonus-val">${e.regional_bonus_points ?? '—'}</td>
      <td class="pts">${e.points_value ?? '—'}</td>
      <td>${calcTier(e.points_value) ? tierPill(calcTier(e.points_value)) : '—'}</td>
      ${isAdmin && !viewingHistoric ? `<td><div class="row-actions">
        <button class="btn btn-ghost" style="font-size:12px;padding:3px 10px" onclick="editEventRow(${e.id})">Edit</button>
        <button class="btn btn-danger" onclick="deleteEvent(${e.id})">Del</button>
      </div></td>` : ''}
    </tr>
  `).join('');
}

function editEventRow(id) {
  const event = allEvents.find(e => e.id === id);
  if (!event) return;
  const row = document.querySelector(`tr[data-id="${id}"]`);
  row.classList.add('editing');
  row.innerHTML = `
    <td><input id="e-name" value="${event.name || ''}"></td>
    <td><input id="e-date" type="date" value="${event.date || ''}"></td>
    <td><select id="e-region">${REGIONS.map(r => `<option value="${r}" ${event.region===r?'selected':''}>${r}</option>`).join('')}</select></td>
    <td><input id="e-entrants" type="number" value="${event.entrants ?? ''}"></td>
    <td><input id="e-5pt" type="number" value="${event.five_point_players ?? ''}"></td>
    <td><input id="e-3pt" type="number" value="${event.three_point_players ?? ''}"></td>
    <td class="bonus-val">${event.regional_bonus_points ?? '—'}</td>
    <td class="pts">${event.points_value ?? '—'}</td>
    <td>—</td>
    <td><div class="row-actions">
      <button class="btn btn-primary" onclick="saveEvent(${id})">Save</button>
      <button class="btn btn-ghost" onclick="renderEvents()">Cancel</button>
    </div></td>
  `;
}

async function saveEvent(id) {
  const payload = {
    name: document.getElementById('e-name').value,
    date: document.getElementById('e-date').value,
    region: document.getElementById('e-region').value,
    entrants: parseInt(document.getElementById('e-entrants').value) || null,
    five_point_players: parseInt(document.getElementById('e-5pt').value) || null,
    three_point_players: parseInt(document.getElementById('e-3pt').value) || null,
    startgg_link: allEvents.find(e => e.id === id)?.startgg_link || null
  };
  await fetch(`${API}/events/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
  await loadEvents();
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await fetch(`${API}/events/${id}`, { method: 'DELETE', headers: authHeaders() });
  allEvents = allEvents.filter(e => e.id !== id);
  renderEvents();
}

// --- PLAYERS ---
async function loadPlayers() {
  try {
    const res = await fetch(`${API}/players`);
    allPlayers = await res.json();
    renderPlayers();
  } catch(e) {
    document.getElementById('players-content').textContent = 'Failed to load.';
  }
}

function renderPlayers() {
  const groups = {};
  PR_LABELS.forEach(k => groups[k] = []);
  allPlayers.forEach(p => {
    const src = p.points_source || '';
    const key = PR_LABELS.find(k => k.toLowerCase() === src.toLowerCase());
    if (key) groups[key].push(p);
    else { if (!groups['Other']) groups['Other'] = []; groups['Other'].push(p); }
  });

  const content = document.getElementById('players-content');
  content.className = '';
  content.innerHTML = Object.entries(groups)
    .filter(([, arr]) => arr.length)
    .map(([label, arr]) => `
      <div class="players-section">
        <div class="section-label">${label}</div>
        <div class="players-grid">
          ${arr.map(p => `
            <div class="player-card pts-${p.points_value}" data-pid="${p.id}">
              <span class="player-tag">${p.tag}</span>
              <span class="player-val val-${p.points_value}">${p.points_value}</span>
              ${isAdmin && !viewingHistoric ? `
                <button class="btn btn-ghost" style="font-size:11px;padding:2px 6px" onclick="editPlayer(${p.id})">✎</button>
                <button class="btn btn-danger" onclick="deletePlayer(${p.id})">✕</button>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
}

function editPlayer(id) {
  const player = allPlayers.find(p => p.id === id);
  if (!player) return;
  const card = document.querySelector(`.player-card[data-pid="${id}"]`);
  const grid = card.parentElement;
  const existing = document.getElementById('player-edit-row');
  if (existing) existing.remove();
  const editRow = document.createElement('div');
  editRow.id = 'player-edit-row';
  editRow.style.cssText = 'grid-column:1/-1;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px';
  editRow.innerHTML = `
    <span style="font-size:12px">Editing: <strong>${player.tag}</strong></span>
    <input id="p-tag-${id}" value="${player.tag}" style="padding:4px 8px;font-size:13px;width:120px">
    <select id="p-pts-${id}" style="padding:4px;font-size:13px">
      <option value="5" ${player.points_value==5?'selected':''}>5pts</option>
      <option value="3" ${player.points_value==3?'selected':''}>3pts</option>
    </select>
    <select id="p-src-${id}" style="padding:4px;font-size:13px">
      ${PR_LABELS.map(l => `<option value="${l}" ${player.points_source===l?'selected':''}>${l}</option>`).join('')}
    </select>
    <button class="btn btn-primary" onclick="savePlayer(${id})">Save</button>
    <button class="btn btn-ghost" onclick="document.getElementById('player-edit-row').remove()">Cancel</button>
  `;
  grid.insertBefore(editRow, grid.firstChild);
}

async function savePlayer(id) {
  const payload = {
    tag: document.getElementById(`p-tag-${id}`).value,
    points_value: parseInt(document.getElementById(`p-pts-${id}`).value),
    points_source: document.getElementById(`p-src-${id}`).value
  };
  await fetch(`${API}/players/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
  await loadPlayers();
}

async function deletePlayer(id) {
  if (!confirm('Delete this player?')) return;
  await fetch(`${API}/players/${id}`, { method: 'DELETE', headers: authHeaders() });
  allPlayers = allPlayers.filter(p => p.id !== id);
  renderPlayers();
}

function addPlayerRow() {
  const content = document.getElementById('players-content');
  const existing = document.getElementById('new-player-form');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'new-player-form';
  div.style.cssText = 'padding:12px;margin-bottom:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  div.innerHTML = `
    <input id="np-tag" placeholder="Tag" style="padding:4px 8px;font-size:13px;width:120px">
    <select id="np-pts" style="padding:4px;font-size:13px">
      <option value="5">5pts</option>
      <option value="3">3pts</option>
    </select>
    <select id="np-src" style="padding:4px;font-size:13px">
      ${PR_LABELS.map(l => `<option value="${l}">${l}</option>`).join('')}
    </select>
    <button class="btn btn-primary" onclick="saveNewPlayer()">Save</button>
    <button class="btn btn-ghost" onclick="document.getElementById('new-player-form').remove()">Cancel</button>
  `;
  content.insertBefore(div, content.firstChild);
  document.getElementById('np-tag').focus();
}

async function saveNewPlayer() {
  const payload = {
    tag: document.getElementById('np-tag').value,
    points_value: parseInt(document.getElementById('np-pts').value),
    points_source: document.getElementById('np-src').value
  };
  await fetch(`${API}/players`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  await loadPlayers();
}

// --- TIERS ---
async function loadTiers() {
  try {
    const res = await fetch(`${API}/tiers`);
    allTiers = await res.json();
    renderTiers();
  } catch(e) {
    document.getElementById('tiers-content').textContent = 'Failed to load.';
  }
}

function renderTiers() {
  const content = document.getElementById('tiers-content');
  content.className = '';
  content.innerHTML = `<div class="tiers-grid">` +
    allTiers.map(t => `
      <div class="tier-card" style="border-top-color:${TIER_COLORS[t.name] || '#888'}">
        <div class="tier-card-name" style="color:${TIER_COLORS[t.name] || '#888'}">${t.name} TIER</div>
        <div class="tier-card-pts">${t.min_points}+ points</div>
        ${isAdmin && !viewingHistoric ? `<div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="editTier(${t.id})">Edit</button>
          <button class="btn btn-danger" onclick="deleteTier(${t.id})">Del</button>
        </div>` : ''}
      </div>
    `).join('') +
  `</div>`;
}

function editTier(id) {
  const tier = allTiers.find(t => t.id === id);
  if (!tier) return;
  const cards = document.querySelectorAll('.tier-card');
  const idx = allTiers.findIndex(t => t.id === id);
  cards[idx].innerHTML = `
    <input id="t-name-${id}" value="${tier.name}" placeholder="Name" style="padding:4px 8px;font-size:13px;width:100%;margin-bottom:6px">
    <input id="t-pts-${id}" type="number" value="${tier.min_points}" placeholder="Min pts" style="padding:4px 8px;font-size:13px;width:100%;margin-bottom:8px">
    <div style="display:flex;gap:6px">
      <button class="btn btn-primary" onclick="saveTier(${id})">Save</button>
      <button class="btn btn-ghost" onclick="renderTiers()">Cancel</button>
    </div>
  `;
}

async function saveTier(id) {
  const payload = {
    name: document.getElementById(`t-name-${id}`).value,
    min_points: parseInt(document.getElementById(`t-pts-${id}`).value)
  };
  await fetch(`${API}/tiers/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
  await loadTiers();
}

async function deleteTier(id) {
  if (!confirm('Delete this tier?')) return;
  await fetch(`${API}/tiers/${id}`, { method: 'DELETE', headers: authHeaders() });
  allTiers = allTiers.filter(t => t.id !== id);
  renderTiers();
}

function addTierCard() {
  const content = document.getElementById('tiers-content');
  const existing = document.getElementById('new-tier-form');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'new-tier-form';
  div.style.cssText = 'padding:16px;margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  div.innerHTML = `
    <input id="nt-name" placeholder="Name (e.g. S)" style="padding:4px 8px;font-size:13px;width:80px">
    <input id="nt-pts" type="number" placeholder="Min pts" style="padding:4px 8px;font-size:13px;width:100px">
    <button class="btn btn-primary" onclick="saveNewTier()">Save</button>
    <button class="btn btn-ghost" onclick="document.getElementById('new-tier-form').remove()">Cancel</button>
  `;
  content.insertBefore(div, content.firstChild);
  document.getElementById('nt-name').focus();
}

async function saveNewTier() {
  const payload = {
    name: document.getElementById('nt-name').value,
    min_points: parseInt(document.getElementById('nt-pts').value)
  };
  await fetch(`${API}/tiers`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  await loadTiers();
}

// --- SEASONS ---
async function loadSeasons() {
  try {
    const res = await fetch(`${API}/seasons`);
    allSeasons = await res.json();
    renderSeasons();
  } catch(e) {
    document.getElementById('seasons-content').textContent = 'Failed to load.';
  }
}

function renderSeasons() {
  const content = document.getElementById('seasons-content');
  content.className = '';
  if (!allSeasons.length) {
    content.innerHTML = '<div class="state-msg">No archived seasons.</div>';
    return;
  }
  content.innerHTML = allSeasons.map(s => `
    <div class="season-card">
      <div class="season-name">${s.name}</div>
      <div class="season-date">${fmtDate(s.archived_at ? s.archived_at.split('T')[0] : null)}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="viewSeason(${s.id})">View</button>
        ${isAdmin && !viewingHistoric ? `
          <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="openEditSeason(${s.id})">Edit</button>
          <button class="btn btn-danger" onclick="deleteSeason(${s.id})">Del</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function openEditSeason(id) {
  const season = allSeasons.find(s => s.id === id);
  if (!season) return;
  currentEditSeasonId = id;
  document.getElementById('es-name').value = season.name;
  document.getElementById('es-error').style.display = 'none';
  document.getElementById('edit-season-modal').classList.add('open');
  setTimeout(() => document.getElementById('es-name').focus(), 100);
}

async function saveEditSeason() {
  const name = document.getElementById('es-name').value.trim();
  if (!name) {
    document.getElementById('es-error').style.display = 'block';
    return;
  }
  await fetch(`${API}/seasons/${currentEditSeasonId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ name }) });
  closeModal('edit-season-modal');
  loadSeasons();
}

async function deleteSeason(id) {
  if (!confirm('Delete this season archive? This cannot be undone.')) return;
  await fetch(`${API}/seasons/${id}`, { method: 'DELETE', headers: authHeaders() });
  loadSeasons();
}

async function viewSeason(id) {
  try {
    const res = await fetch(`${API}/seasons/${id}`);
    const season = await res.json();
    const data = season.data;
    allEvents = data.events || [];
    allPlayers = data.players || [];
    allTiers = data.tiers || [];
    viewingHistoric = true;
    document.getElementById('season-banner-name').textContent = season.name;
    document.getElementById('season-banner').style.display = '';
    document.getElementById('archive-season-btn').style.display = 'none';
    document.getElementById('new-season-btn').style.display = 'none';
    renderEvents(); renderPlayers(); renderTiers();
    switchTab('events', document.querySelectorAll('nav button')[0]);
  } catch(e) {}
}

function exitHistoricView() {
  viewingHistoric = false;
  document.getElementById('season-banner').style.display = 'none';
  document.getElementById('archive-season-btn').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('new-season-btn').style.display = isAdmin ? 'block' : 'none';
  loadEvents(); loadPlayers(); loadTiers();
}

function archiveSeason() {
  document.getElementById('as-name').value = '';
  document.getElementById('as-error').style.display = 'none';
  document.getElementById('archive-season-modal').classList.add('open');
}

async function saveArchiveSeason() {
  const name = document.getElementById('as-name').value.trim();
  if (!name) {
    document.getElementById('as-error').style.display = 'block';
    return;
  }
  await fetch(`${API}/seasons`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
  closeModal('archive-season-modal');
  loadSeasons();
}

function startNewSeason() {
  document.getElementById('ns-password').value = '';
  document.getElementById('ns-error').style.display = 'none';
  document.getElementById('new-season-modal').classList.add('open');
  setTimeout(() => document.getElementById('ns-password').focus(), 100);
}

async function confirmNewSeason() {
  const password = document.getElementById('ns-password').value;
  try {
    const res = await fetch(`${API}/seasons/new`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ password })
    });
    if (res.status === 401) {
      document.getElementById('ns-error').style.display = 'block';
      return;
    }
    if (!res.ok) throw new Error();
    closeModal('new-season-modal');
    loadEvents(); loadPlayers(); loadTiers();
    setAdminUI(true);
  } catch {
    document.getElementById('ns-error').style.display = 'block';
  }
}

// --- INIT ---
document.getElementById('theme-select').value = localStorage.getItem('tts-theme') || 'classic';
loadEvents();
loadPlayers();
loadTiers();
loadSeasons();
