// octopod's console: reads the API it is served by. A gallery of the projects; each opens
// on a page of its own (#/p/<project>[/<instance>]) with its services, routes, warnings and
// logs. Read-only. Everything the API returns is shown as
// text, never as markup: names and log lines come from the projects.
'use strict';

const REFRESH_MS = 5000;
const LOGS_MS = 2500;

const state = {
  paused: false,
  filter: '',
  updatedAt: 0,
  /** The <details> that are open, by key, kept across refreshes. */
  open: new Set(),
  /** The groups folded, by key: groups start open. */
  closed: new Set(),
  /** The logs shown: { project, instance, service } or null. */
  logs: null,
  timer: 0,
  logsTimer: 0,
  /** The last answer, re-shown when only the filter changes. */
  last: null,
  /** octopod's version, read once. */
  version: '',
  /** The project page shown: { project, instance }, or null for the gallery. */
  view: null,
  /** The page whose logs were opened on arrival. */
  logsPage: null,
};

/** The page the address names: `#/p/<project>[/<instance>]`, or the gallery. */
function route() {
  const m = /^#\/p\/([^/]+)(?:\/(\d+))?$/.exec(location.hash);
  state.view = m ? { project: decodeURIComponent(m[1]), instance: Number(m[2] || 1) } : null;
}

const pageOf = (name, instance = 1) => `#/p/${encodeURIComponent(name)}${instance > 1 ? `/${instance}` : ''}`;

const $ = (id) => document.getElementById(id);

/** An element, its attributes and children; strings become text nodes. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'the API answered something that is not JSON' : `the API answered ${res.status}`);
  }
  if (!res.ok) throw new Error(body && body.error ? body.error : `the API answered ${res.status}`);
  return body;
}

const projectPath = (name, instance, action = '') =>
  `/v1/projects/${encodeURIComponent(name)}${action ? `/${action}` : ''}${instance > 1 ? `?instance=${instance}` : ''}`;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Every project with its status, and the status of each other instance it runs. */
async function load() {
  if (!state.version) state.version = await api('/v1/version').then((v) => v.version, () => '');
  const [edge, projects] = await Promise.all([api('/v1/edge'), api('/v1/projects')]);
  const statuses = await Promise.all(
    projects.map(async (project) => {
      // Listed with its problem: nothing more to ask about it.
      if (project.problem) return { ...project, others: [] };
      try {
        const status = await api(projectPath(project.name, 1));
        const instances = await Promise.all(
          (status.instances || []).map((n) => api(projectPath(project.name, n)).then((s) => ({ ...s, instance: n }), (e) => ({ ...project, instance: n, problem: e.message }))),
        );
        return { ...status, others: instances };
      } catch (e) {
        return { ...project, problem: e.message, others: [] };
      }
    }),
  );
  return { edge, projects: statuses };
}

// ─── Showing ─────────────────────────────────────────────────────────────────

function serviceTone(s) {
  if (s.state === 'running') return s.health === 'unhealthy' ? 'bad' : s.health === 'starting' ? 'warn' : 'ok';
  if (s.state === 'restarting' || s.state === 'dead') return 'bad';
  if (s.state === 'exited') return 'bad';
  return '';
}

function programTone(g) {
  if (g.state === 'RUNNING') return 'ok';
  if (g.state === 'FATAL' || g.state === 'BACKOFF' || g.state === 'UNKNOWN') return 'bad';
  if (g.state === 'STARTING' || g.state === 'STOPPING') return 'warn';
  return '';
}

/** up: every service running; partial: some; down: none. */
function projectTone(p) {
  if (p.problem) return { tone: 'bad', label: 'error' };
  // A tool never runs: it counts neither as up nor as down.
  const services = (p.services || []).filter((s) => s.state !== 'tool');
  const running = services.filter((s) => s.state === 'running').length;
  if (services.length === 0 || running === 0) return { tone: '', label: 'down' };
  if (running === services.length && services.every((s) => serviceTone(s) === 'ok')) return { tone: 'ok', label: 'up' };
  return { tone: 'warn', label: running === services.length ? 'up, not healthy' : `${running}/${services.length} running` };
}

/** A collapsible block, its state kept across refreshes. Groups start open; the rest, closed. */
function details(key, summary, ...children) {
  const group = key.startsWith('group:');
  const open = group ? !state.closed.has(key) : state.open.has(key);
  const node = el('details', { class: group ? 'group' : 'compose', open }, el('summary', {}, summary), ...children);
  node.addEventListener('toggle', () => {
    if (group) node.open ? state.closed.delete(key) : state.closed.add(key);
    else node.open ? state.open.add(key) : state.open.delete(key);
  });
  return node;
}

function servicesTable(p, base, instance) {
  const byService = new Map();
  for (const r of p.routes || []) byService.set(r.service, [...(byService.get(r.service) || []), r]);
  const rows = new Map((p.services || []).map((s) => [s.service, s]));
  // An exposed service with no container yet still shows, with its route.
  for (const service of byService.keys()) if (!rows.has(service)) rows.set(service, { service, state: 'not created' });
  if (rows.size === 0) return el('p', { class: 'muted' }, 'No container: the project is down.');
  const body = [...rows.values()]
    .sort((a, b) => a.service.localeCompare(b.service))
    .map((s) =>
      el(
        'tr',
        {},
        el('td', {}, el('span', { class: `dot ${serviceTone(s)}` }), el('span', { class: 'mono' }, s.service)),
        el(
          'td',
          {},
          s.state,
          s.state === 'tool' ? el('span', { class: 'muted' }, ` · run on demand: octopod shell ${base}${instance > 1 ? ` --instance ${instance}` : ''} ${s.service} -- …`) : null,
          s.health ? el('span', { class: 'muted' }, ` · ${s.health}`) : null,
          // A supervised service: what runs in it, each program with its state.
          (s.programs || []).length
            ? el('ul', { class: 'programs' }, s.programs.map((g) => el('li', { title: g.detail }, el('span', { class: `dot ${programTone(g)}` }), el('span', { class: 'mono' }, g.program), ` ${g.state.toLowerCase()}`)))
            : null,
        ),
        el(
          'td',
          {},
          (byService.get(s.service) || []).map((r) =>
            el(
              'div',
              {},
              el('a', { href: r.url, target: '_blank', rel: 'noreferrer' }, r.url.replace(/^http:\/\//, '')),
              r.port ? el('span', { class: 'muted' }, ` → :${r.port}${r.portSource && r.portSource !== 'declared' ? ` (${r.portSource})` : ''}`) : null,
            ),
          ),
        ),
        el(
          'td',
          { class: 'actions' },
          s.state === 'not created' || s.state === 'tool'
            ? null
            : el('button', { type: 'button', onclick: () => openLogs({ project: base, instance, service: s.service }) }, 'Logs'),
        ),
      ),
    );
  return el(
    'table',
    { class: 'services' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Service'), el('th', {}, 'State'), el('th', {}, 'Route'), el('th', {}))),
    el('tbody', {}, body),
  );
}

function card(p, base, nested = false) {
  const instance = p.instance || 1;
  const { tone, label } = projectTone(p);
  const key = `${base}#${instance}`;
  const routes = (p.routes || []).map((r) => el('a', { href: r.url, target: '_blank', rel: 'noreferrer' }, r.url.replace(/^http:\/\//, '')));
  return el(
    'article',
    { class: nested ? 'card instance' : 'card', 'data-name': base },
    el(
      'div',
      { class: 'card-head' },
      el('h2', {}, nested ? el('a', { href: pageOf(base, instance) }, p.name) : p.name, nested ? el('span', { class: 'muted' }, ` (instance ${instance})`) : null),
      el('span', { class: `pill ${tone}` }, label),
      nested ? null : (p.tags || []).map((t) => el('span', { class: 'tag' }, `#${t}`)),
      el('div', { class: 'routes' }, routes),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', onclick: () => openLogs({ project: base, instance, service: '' }) }, 'All logs'),
    ),
    nested ? null : el('div', { class: 'root mono muted' }, p.root),
    nested || !(p.compose || []).length ? null : details(`${key}:compose`, `${p.compose.length} compose file${p.compose.length > 1 ? 's' : ''}`, el('ul', {}, p.compose.map((f) => el('li', { class: 'mono' }, f)))),
    p.problem ? el('p', { class: 'problem' }, p.problem) : servicesTable(p, base, instance),
    (p.warnings || []).length ? el('ul', { class: 'warnings' }, p.warnings.map((w) => el('li', {}, w))) : null,
    (p.others || []).map((o) => card(o, base, true)),
  );
}

/**
 * The filter: words that must all match. `group:x` and `tag:x` match a project's group and
 * tags; any other word, its name or folder.
 */
function matches(p, needle) {
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (word.startsWith('group:')) return (p.group || '') === word.slice(6);
      if (word.startsWith('tag:')) return (p.tags || []).includes(word.slice(4));
      return p.name.toLowerCase().includes(word) || (p.root || '').toLowerCase().includes(word);
    });
}

/** A project in the gallery: its state at a glance; the rest is on its page. */
function tile(p) {
  const { tone, label } = projectTone(p);
  const services = (p.services || []).filter((s) => s.state !== 'tool');
  const running = services.filter((s) => s.state === 'running').length;
  const warnings = [p, ...(p.others || [])].reduce((n, x) => n + (x.warnings || []).length, 0);
  const instances = (p.others || []).length;
  const href = pageOf(p.name);
  const facts = p.problem
    ? null
    : [`${running}/${services.length} running`, warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : null, instances ? `+${instances} instance${instances > 1 ? 's' : ''}` : null]
        .filter(Boolean)
        .join(' · ');
  return el(
    'article',
    {
      class: `tile ${tone}`,
      'data-name': p.name,
      // The whole tile opens the page; its links (routes) keep their own target.
      onclick: (e) => {
        if (!e.target.closest('a')) location.hash = href;
      },
    },
    el('div', { class: 'tile-head' }, el('a', { href, class: 'tile-name' }, p.name), el('span', { class: `pill ${tone}` }, label)),
    p.problem ? el('p', { class: 'problem' }, p.problem) : el('p', { class: 'tile-facts muted' }, facts, warnings ? el('span', { class: 'dot warn tile-alert' }) : null),
    el('div', { class: 'tile-routes' }, (p.routes || []).map((r) => el('a', { href: r.url, target: '_blank', rel: 'noreferrer' }, r.url.replace(/^http:\/\//, '')))),
    (p.tags || []).length ? el('div', { class: 'tile-tags' }, p.tags.map((t) => el('span', { class: 'tag' }, `#${t}`))) : null,
  );
}

/** A project's page: everything about it, and its logs. */
function renderDetail(projects) {
  const { project, instance } = state.view;
  const base = projects.find((p) => p.name === project);
  const p = base && (instance > 1 ? (base.others || []).find((o) => (o.instance || 1) === instance) : base);
  const back = el('a', { href: '#', class: 'back' }, '← All projects');
  if (!p) {
    $('projects').replaceChildren(back, el('p', { class: 'problem' }, `No project "${project}"${instance > 1 ? `, instance ${instance}` : ''}: unregistered, or down.`));
    $('summary').textContent = '';
    return;
  }
  $('projects').replaceChildren(back, card(instance > 1 ? { ...p, others: [] } : p, project));
  $('summary').textContent = [base.group ? `group ${base.group}` : '', instance > 1 ? `instance ${instance} of ${project}` : ''].filter(Boolean).join(' · ');
  // The page opens on its logs, every service's; closed, they stay closed on this page.
  const key = `${project}#${instance}`;
  if (state.logsPage !== key) {
    state.logsPage = key;
    openLogs({ project, instance, service: '' });
  }
}

function render({ edge, projects }) {
  const edgeNode = $('edge');
  edgeNode.textContent = edge.running ? `edge on 127.0.0.1:${edge.port}` : 'edge stopped';
  edgeNode.className = `pill ${edge.running ? 'ok' : 'bad'}`;
  if (edge.dashboard) $('dashboard').href = edge.dashboard;
  $('version').textContent = state.version ? `v${state.version}` : '';
  $('filter').hidden = Boolean(state.view);
  $('empty').hidden = projects.length > 0;
  if (state.view) return renderDetail(projects);
  state.logsPage = null;
  if (state.logs) closeLogs();

  const needle = state.filter.trim().toLowerCase();
  const shown = projects
    .filter((p) => matches(p, needle))
    .sort((a, b) => {
      const rank = (p) => ({ ok: 0, warn: 1, bad: 2, '': 3 })[projectTone(p).tone];
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  // By group, groups in name order, projects without a group last. No group anywhere: a flat list.
  const groups = [...new Set(shown.map((p) => p.group).filter(Boolean))].sort();
  const gallery = (members) => el('div', { class: 'gallery' }, members.map(tile));
  if (groups.length === 0) {
    $('projects').replaceChildren(gallery(shown));
  } else {
    const section = (key, title, members) => (members.length === 0 ? null : details(`group:${key}`, `${title} · ${members.length}`, gallery(members)));
    $('projects').replaceChildren(
      ...[...groups.map((g) => section(g, g, shown.filter((p) => p.group === g))), section('', 'no group', shown.filter((p) => !p.group))].filter(Boolean),
    );
  }
  const up = projects.filter((p) => projectTone(p).label !== 'down' && !p.problem).length;
  const services = projects.flatMap((p) => [...(p.services || []), ...(p.others || []).flatMap((o) => o.services || [])]);
  const running = services.filter((s) => s.state === 'running').length;
  const warnings = projects.reduce((n, p) => n + (p.warnings || []).length, 0);
  $('summary').textContent =
    `${projects.length} project${projects.length === 1 ? '' : 's'} · ${up} up · ${running} service${running === 1 ? '' : 's'} running` +
    (warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '') +
    (needle ? ` · ${shown.length} shown` : '');
}

async function refresh() {
  clearTimeout(state.timer);
  try {
    state.last = await load();
    render(state.last);
    $('error').hidden = true;
    state.updatedAt = Date.now();
  } catch (e) {
    $('error').textContent = `Cannot read octopod: ${e.message}`;
    $('error').hidden = false;
  }
  tick();
  schedule();
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.paused && !document.hidden) state.timer = setTimeout(refresh, REFRESH_MS);
}

function tick() {
  if (!state.updatedAt) return;
  const s = Math.round((Date.now() - state.updatedAt) / 1000);
  $('updated').textContent = state.paused ? 'paused' : s < 2 ? 'updated now' : `updated ${s}s ago`;
}

// ─── Logs ────────────────────────────────────────────────────────────────────

function openLogs(target) {
  state.logs = target;
  const name = target.instance > 1 ? `${target.project} (instance ${target.instance})` : target.project;
  $('logs-title').textContent = `Logs — ${name}${target.service ? ` / ${target.service}` : ', every service'}`;
  $('logs').hidden = false;
  document.body.classList.add('with-logs');
  $('logs-lines').textContent = 'Loading…';
  loadLogs(true);
}

function closeLogs() {
  state.logs = null;
  clearTimeout(state.logsTimer);
  $('logs').hidden = true;
  document.body.classList.remove('with-logs');
}

async function loadLogs(scroll = false) {
  clearTimeout(state.logsTimer);
  const target = state.logs;
  if (!target) return;
  const pre = $('logs-lines');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
  const query = new URLSearchParams({ tail: $('logs-tail').value });
  if (target.service) query.set('service', target.service);
  if (target.instance > 1) query.set('instance', String(target.instance));
  try {
    const { lines } = await api(`/v1/projects/${encodeURIComponent(target.project)}/logs?${query}`);
    if (state.logs !== target) return;
    pre.textContent = lines.length ? lines.join('\n') : '(no output)';
  } catch (e) {
    if (state.logs !== target) return;
    pre.textContent = `Cannot read the logs: ${e.message}`;
  }
  if (scroll || atBottom) pre.scrollTop = pre.scrollHeight;
  if ($('logs-follow').checked && !document.hidden) state.logsTimer = setTimeout(() => loadLogs(), LOGS_MS);
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  $('filter').addEventListener('input', (e) => {
    state.filter = e.target.value;
    if (state.last) render(state.last);
  });
  $('pause').addEventListener('click', (e) => {
    state.paused = !state.paused;
    e.currentTarget.setAttribute('aria-pressed', String(state.paused));
    e.currentTarget.textContent = state.paused ? 'Resume' : 'Pause';
    state.paused ? (clearTimeout(state.timer), tick()) : refresh();
  });
  $('logs-close').addEventListener('click', closeLogs);
  $('logs-tail').addEventListener('change', () => loadLogs(true));
  $('logs-follow').addEventListener('change', () => loadLogs());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.view) location.hash = '';
  });
  window.addEventListener('hashchange', () => {
    route();
    window.scrollTo(0, 0);
    if (state.last) render(state.last);
  });
  route();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refresh();
    if (state.logs) loadLogs();
  });
  setInterval(tick, 1000);
  refresh();
});
