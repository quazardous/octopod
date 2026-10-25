// octopod's console: reads the API it is served by. A gallery of the projects; each opens
// on a page of its own (#/p/<project>[/<instance>]) with its services, routes, warnings and
// logs. It acts only to bring a project up or down. A browser enrolls first, with a code
// from `octopod console code`: until then the API shows it nothing, and the page its login. Everything the API returns is shown as
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
  /** A service's info page, read once on arrival: { key, data } or { key, error }, or null. */
  info: null,
  /** The page whose logs were opened on arrival. */
  logsPage: null,
  /** A project being brought up or down, by `<project>#<instance>`: 'up' or 'down'. */
  busy: new Map(),
  /** Why the last up or down of a project failed, by the same key, until the next one. */
  actFailed: new Map(),
  /** The project whose Down was clicked once, by the same key: a second click stops it. */
  arming: null,
  armTimer: 0,
  /** What each instance takes on disk, by `<project>#<instance>`: { at, data } or { at, error }; read again after a minute. */
  disk: new Map(),
};

/** How long a project's disk figures are shown before they are read again: reading them walks its folders. */
const DISK_MS = 60_000;

/** How long a first click on Down waits for the second. */
const CONFIRM_MS = 4000;

/** The page the address names: `#/p/<project>[/<instance>]`, `#/g/<group>`, or the gallery. */
function route() {
  const m = /^#\/p\/([^/]+)(?:\/(\d+))?(?:\/info\/([^/]+))?$/.exec(location.hash);
  const g = /^#\/g\/([^/]+)$/.exec(location.hash);
  state.view = m
    ? { project: decodeURIComponent(m[1]), instance: Number(m[2] || 1), ...(m[3] ? { info: decodeURIComponent(m[3]) } : {}) }
    : g
      ? { group: decodeURIComponent(g[1]) }
      : null;
}

const pageOf = (name, instance = 1) => `#/p/${encodeURIComponent(name)}${instance > 1 ? `/${instance}` : ''}`;
const groupPageOf = (group) => `#/g/${encodeURIComponent(group)}`;
const infoPageOf = (name, service, instance = 1) => `${pageOf(name, instance)}/info/${encodeURIComponent(service)}`;

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

/** The API's JSON, or its error; `enroll` set when this browser must enroll first. */
async function answer(res) {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // A 403 that is not the API's: a relay older than this page, which refuses what it does not know.
    if (res.status === 403) throw new Error('the console relay refused it: run octopod edge up to bring it up to date');
    throw new Error(res.ok ? 'the API answered something that is not JSON' : `the API answered ${res.status}`);
  }
  if (!res.ok) throw Object.assign(new Error(body && body.error ? body.error : `the API answered ${res.status}`), { enroll: Boolean(body && body.enroll) });
  return body;
}

async function api(path) {
  return answer(await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' }));
}

/**
 * A POST, with the header the console relay requires: a page of another site cannot add it
 * without a preflight, which the relay never answers.
 */
async function post(path, payload) {
  return answer(
    await fetch(path, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-octopod-console': '1' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    }),
  );
}

// ─── Enrolling ───────────────────────────────────────────────────────────────

/** The login: this browser is not enrolled (or no longer), and the API shows it nothing. */
function showLogin() {
  state.locked = true;
  clearTimeout(state.timer);
  if (state.logs) closeLogs();
  $('login').hidden = false;
  $('main').hidden = true;
  for (const id of ['filter', 'pause', 'signout']) $(id).hidden = true;
  $('summary').textContent = '';
  if (document.activeElement !== $('login-code')) $('login-code').focus();
}

function hideLogin() {
  state.locked = false;
  $('login').hidden = true;
  $('main').hidden = false;
  $('pause').hidden = false;
  $('signout').hidden = false;
  $('login-error').hidden = true;
  $('login-code').value = '';
}

async function enroll(e) {
  e.preventDefault();
  const button = e.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    await post('/v1/console/enroll', { code: $('login-code').value });
    hideLogin();
    refresh();
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').hidden = false;
  }
  button.disabled = false;
}

async function signOut() {
  await post('/v1/console/signout', {}).catch(() => {});
  state.last = null;
  showLogin();
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

// ─── Acting ──────────────────────────────────────────────────────────────────

/** `octopod up` or `octopod down` of a project's instance; an up may build, and take minutes. */
async function act(project, instance, what) {
  const key = `${project}#${instance}`;
  if (state.busy.has(key)) return;
  state.busy.set(key, what);
  state.actFailed.delete(key);
  if (state.last) render(state.last);
  try {
    await post(`/v1/projects/${encodeURIComponent(project)}/${what}`, instance > 1 ? { instance } : {});
  } catch (e) {
    if (e.enroll) return (state.busy.delete(key), showLogin());
    state.actFailed.set(key, `${what} failed: ${e.message}`);
  }
  state.busy.delete(key);
  refresh();
}

/** A group's projects up or down, one after the other: `group` is `group:<name>`. */
async function actGroup(group, instance, what) {
  const key = `${group}#${instance}`;
  if (state.busy.has(key)) return;
  const name = group.slice('group:'.length);
  const members = ((state.last && state.last.projects) || []).filter((p) => p.group === name && !p.sharedOf);
  state.busy.set(key, what);
  state.actFailed.delete(key);
  if (state.last) render(state.last);
  const failed = [];
  for (const p of members) {
    if (what === 'down' && projectTone(p).label === 'down' && !p.problem) continue;
    try {
      await post(`/v1/projects/${encodeURIComponent(p.name)}/${what}`, {});
    } catch (e) {
      if (e.enroll) return (state.busy.delete(key), showLogin());
      failed.push(`${p.name}: ${e.message}`);
    }
  }
  if (failed.length) state.actFailed.set(key, `${what} failed: ${failed.join('; ')}`);
  state.busy.delete(key);
  refresh();
}

/**
 * Down asks first: a first click turns it into a confirmation, a second within a few seconds
 * stops the project; otherwise it goes back.
 */
function armDown(key) {
  clearTimeout(state.armTimer);
  state.arming = key;
  state.armTimer = setTimeout(() => {
    state.arming = null;
    if (state.last) render(state.last);
  }, CONFIRM_MS);
  if (state.last) render(state.last);
}

/** The button that brings a project up or down, or says it is on the way. */
function actButton(project, instance, what, run = act) {
  const key = `${project}#${instance}`;
  const busy = state.busy.get(key);
  if (busy) return el('button', { type: 'button', class: 'act', disabled: true }, busy === 'up' ? 'Starting…' : 'Stopping…');
  if (what === 'up') return el('button', { type: 'button', class: 'act up', title: 'octopod up: start it, or apply what changed', onclick: () => run(project, instance, 'up') }, 'Up');
  if (state.arming === key) {
    const go = () => {
      clearTimeout(state.armTimer);
      state.arming = null;
      run(project, instance, 'down');
    };
    return el('button', { type: 'button', class: 'act down armed', title: 'Click again to stop it: its containers go, its data stays', onclick: go }, 'Stop?');
  }
  return el('button', { type: 'button', class: 'act down', title: 'octopod down: stop it, the data kept', onclick: () => armDown(key) }, 'Down');
}

const failure = (project, instance) => {
  const why = state.actFailed.get(`${project}#${instance}`);
  return why ? el('p', { class: 'problem' }, why) : null;
};

// ─── Showing ─────────────────────────────────────────────────────────────────

function serviceTone(s) {
  if (s.state === 'running') return s.health === 'unhealthy' ? 'bad' : s.health === 'starting' ? 'warn' : 'ok';
  if (s.state === 'restarting' || s.state === 'dead') return 'bad';
  if (s.state === 'exited') return 'bad';
  return '';
}

/**
 * A known service as a small icon of its software, in its colours; a stopped one greyed, one in
 * trouble marked with a dot. Its link opens what it serves (an admin, an inbox; a database, its
 * admin, which it stands for: `admins`). Set through the CSSOM: the page's policy forbids
 * inline styles.
 */
function decoration(s, project, admins = [], groupOf = '') {
  // An app without a link of its own opens the console's page of what runs in it.
  const info = !s.link && s.info && !s.server ? infoPageOf(project, s.service) : null;
  let tone = serviceTone(s);
  if (tone === 'ok' && admins.some((a) => serviceTone(a) !== 'ok')) tone = 'warn';
  const icon = el('span', { class: 'deco-icon' });
  icon.style.setProperty('--icon', `url("/v1/recipes/${encodeURIComponent(s.recipe)}/icon?project=${encodeURIComponent(project)}")`);
  const said = (x) => `${x.state}${x.health ? `, ${x.health}` : ''}`;
  const tip = [
    `${s.service} · ${s.recipe}`,
    said(s),
    s.server ? `shared: group ${groupOf}'s ${s.server}` : null,
    ...admins.map((a) => `${a.service} · ${a.recipe}: ${said(a)}`),
    s.link ? `opens ${s.link.replace(/^http:\/\//, '')}` : info ? 'opens what runs in it' : null,
  ].filter(Boolean);
  const node = s.link
    ? el('a', { class: `deco ${tone}`, href: s.link, target: '_blank', rel: 'noreferrer', 'aria-label': tip.join(', ') }, icon)
    : info
      ? el('a', { class: `deco ${tone}`, href: info, 'aria-label': tip.join(', ') }, icon)
      : el('span', { class: `deco ${tone}`, 'aria-label': tip.join(', ') }, icon);
  node.addEventListener('mouseenter', () => showTip(node, tip));
  node.addEventListener('mouseleave', hideTip);
  node.addEventListener('focus', () => showTip(node, tip));
  node.addEventListener('blur', hideTip);
  return node;
}

/** One tooltip for the page, laid over everything: a tile clips what overflows it. */
function showTip(anchor, lines) {
  hideTip();
  const tip = el('div', { class: 'tip', role: 'tooltip' }, lines.map((l, i) => el('div', { class: i === 0 ? 'tip-head' : '' }, l)));
  document.body.append(tip);
  const a = anchor.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const left = Math.max(8, Math.min(a.left + a.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
  const top = a.bottom + 6 + t.height > window.innerHeight ? a.top - t.height - 6 : a.bottom + 6;
  tip.style.setProperty('left', `${left + window.scrollX}px`);
  tip.style.setProperty('top', `${top + window.scrollY}px`);
}

function hideTip() {
  for (const t of document.querySelectorAll('.tip')) t.remove();
}

/**
 * A project's known services, apps first, then the group's servers it uses: what the stack
 * is, at a glance. An admin is not drawn apart: the service it administers leads to it, and
 * stands for it.
 */
function decorations(p, project) {
  const byName = (a, b) => Number(Boolean(b.app)) - Number(Boolean(a.app)) || a.service.localeCompare(b.service);
  const own = (p.services || []).filter((s) => s.recipe).sort(byName);
  const shared = [...(p.shared || [])].sort(byName);
  const all = [...own, ...shared];
  const admins = new Map();
  const drawn = (list) =>
    list.filter((s) => {
      const of = s.admin && all.find((x) => x.service === s.admin);
      if (!of) return true;
      admins.set(of, [...(admins.get(of) || []), s]);
      return false;
    });
  const mine = drawn(own);
  const group = drawn(shared);
  const icons = [
    ...mine.map((s) => decoration(s, project, admins.get(s))),
    ...(mine.length && group.length ? [el('span', { class: 'deco-gap', 'aria-hidden': 'true' })] : []),
    ...group.map((s) => decoration(s, project, admins.get(s), p.group || 'default')),
  ];
  return icons.length ? el('div', { class: 'decos' }, icons) : null;
}

/**
 * A project as it is made: its apps, each with its address and the services of its own it is
 * wired to; the services of its own no app uses (`loose`); the group's servers it uses
 * (`shared`). A project without apps (compose) has its routed services for apps. An admin is
 * drawn as what it administers (`admins`).
 */
function stackParts(p) {
  const services = p.services || [];
  const shared = p.shared || [];
  const all = [...services, ...shared];
  const routes = p.routes || [];
  const admins = new Map();
  const absorbed = new Set();
  for (const s of all) {
    const of = s.admin && all.find((x) => x.service === s.admin);
    if (!of) continue;
    admins.set(of, [...(admins.get(of) || []), s]);
    absorbed.add(s);
  }
  let apps = services.filter((s) => s.app);
  if (apps.length === 0) {
    const routed = [...new Set(routes.map((r) => r.service))];
    apps = routed.map((name) => services.find((s) => s.service === name) || { service: name, state: 'not created' });
  }
  const appNames = new Set(apps.map((a) => a.service));
  const wired = new Set(apps.flatMap((a) => a.uses || []));
  const mine = (s) => !absorbed.has(s) && !appNames.has(s.service);
  return {
    admins,
    apps: apps.map((a) => ({ app: a, route: routes.find((r) => r.service === a.service), own: services.filter((s) => (a.uses || []).includes(s.service) && mine(s)) })),
    loose: services.filter((s) => s.recipe && !s.app && !wired.has(s.service) && mine(s)),
    shared: shared.filter((s) => !absorbed.has(s)),
  };
}

/** An app's line: its icon, its name (a link when given), its address, its own services. */
function appRow(part, icon, name, href) {
  const { app, route, own } = part;
  return el(
    'div',
    { class: 'app-row' },
    app.recipe ? icon(app) : el('span', { class: `dot ${serviceTone(app)}` }),
    href ? el('a', { href, class: 'mono app-name' }, name) : el('span', { class: 'mono app-name' }, name),
    route ? el('a', { href: route.url, target: '_blank', rel: 'noreferrer', class: 'mono' }, route.url.replace(/^http:\/\//, '')) : null,
    own.map(icon),
  );
}

/** The badges line: services of no app, then the group's servers, after the group's name. */
function badgesRow(loose, shared, group) {
  if (loose.length + shared.length === 0) return null;
  return el(
    'div',
    { class: 'stack-shared' },
    shared.length ? el('span', { class: 'muted' }, `group ${group}`) : null,
    loose,
    loose.length && shared.length ? el('span', { class: 'deco-gap', 'aria-hidden': 'true' }) : null,
    shared,
  );
}

/** A project as it is made, on its tile or its page: its badges, then its apps; on its group's page, the group's servers are the group's. */
function stackView(p, project, withShared = true) {
  const group = p.group || 'default';
  const parts = stackParts(p);
  const icon = (s) => decoration(s, project, parts.admins.get(s), s.server ? group : '');
  const badges = badgesRow(parts.loose.map(icon), withShared ? parts.shared.map(icon) : [], group);
  const rows = parts.apps.map((part) => appRow(part, icon, part.app.service));
  if (!badges && rows.length === 0) return null;
  return el('div', { class: 'stack' }, badges, rows);
}

/** The routes worth listing: an app's, or a service octopod knows nothing of; a known one is its icon. */
function plainRoutes(p) {
  const known = new Set((p.services || []).filter((s) => s.recipe && !s.app).map((s) => s.service));
  return (p.routes || []).filter((r) => !known.has(r.service));
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
  // The group's servers it uses are the group's: on the group's page, not in the project's table.
  const group = p.group || 'default';
  const body = [...rows.values()]
    .sort((a, b) => a.service.localeCompare(b.service))
    .map((s) =>
      el(
        'tr',
        {},
        el('td', {}, s.recipe ? decoration(s, base, [], s.server ? group : '') : el('span', { class: `dot ${serviceTone(s)}` }), el('span', { class: 'mono' }, ` ${s.service}`)),
        el(
          'td',
          {},
          s.state,
          s.server ? el('span', { class: 'muted' }, ` · group ${group}'s ${s.server}`) : null,
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
          s.server && s.link ? el('a', { href: s.link, target: '_blank', rel: 'noreferrer' }, s.link.replace(/^http:\/\//, '')) : null,
          (s.server ? [] : byService.get(s.service) || []).map((r) =>
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
            : // A server of the group logs in the group's stack.
              el('button', { type: 'button', onclick: () => openLogs(s.server ? { project: s.stack, instance: 1, service: s.server } : { project: base, instance, service: s.service }) }, 'Logs'),
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

/** A size for a person: 1.2 GB, 340 MB. */
function humanSize(bytes) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${unit === 0 || n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

/**
 * What an instance takes on disk, on its page: what is kept apart from what `octopod prune`
 * may empty. Read when the page shows it, then once a minute at most; the console only reads.
 */
function diskView(base, instance) {
  const key = `${base}#${instance}`;
  const known = state.disk.get(key);
  if (!known || (Date.now() - known.at > DISK_MS && !known.loading)) {
    state.disk.set(key, { ...known, at: known ? known.at : 0, loading: true });
    api(`/v1/projects/${encodeURIComponent(base)}/disk?instance=${instance}`).then(
      (d) => state.disk.set(key, { at: Date.now(), data: d.projects[0] }),
      (e) => state.disk.set(key, { at: Date.now(), error: e.message }),
    ).then(() => state.last && render(state.last));
  }
  if (!known || (!known.data && !known.error)) return el('div', { class: 'disk muted' }, 'Disk: reading…');
  if (known.error) return el('div', { class: 'disk muted' }, `Disk: ${known.error}`);
  const d = known.data;
  const part = (label, bytes, title) => el('span', { class: 'disk-part', title }, el('span', { class: 'muted' }, `${label} `), humanSize(bytes));
  const lost = d.cache + d.temp + d.leftovers;
  return el(
    'div',
    { class: 'disk' },
    el('span', { class: 'disk-label' }, 'Disk'),
    part('data', d.data, 'its .octopod/data: databases, uploads — only octopod destroy removes it'),
    part('home', d.home, 'its users\' homes kept in .octopod/home'),
    part('images', d.images, 'the images built for it'),
    el('span', { class: 'disk-sep' }, '·'),
    part('cache', d.cache, 'caches its recipes declare, in .octopod/cache'),
    part('temp', d.temp, 'temporary folders, in .octopod/temp'),
    part('leftovers', d.leftovers, 'nameless images its rebuilds left'),
    lost > 0 ? el('span', { class: 'muted mono disk-hint', title: 'empties cache, temp and leftovers; the data stays' }, `octopod prune ${base}`) : null,
  );
}

function card(p, base, nested = false, inGroup = false) {
  const instance = p.instance || 1;
  const { tone, label } = projectTone(p);
  const key = `${base}#${instance}`;
  return el(
    'article',
    { class: nested ? 'card instance' : 'card', 'data-name': base },
    el(
      'div',
      { class: 'card-head' },
      el('h2', {}, nested || inGroup ? el('a', { href: pageOf(base, instance) }, p.name) : p.name, nested ? el('span', { class: 'muted' }, ` (instance ${instance})`) : null),
      el('span', { class: `pill ${tone}` }, label),
      nested ? null : (p.tags || []).map((t) => el('span', { class: 'tag' }, `#${t}`)),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', onclick: () => openLogs({ project: base, instance, service: '' }) }, 'All logs'),
      state.busy.has(key) ? actButton(base, instance, 'up') : [actButton(base, instance, 'up'), actButton(base, instance, 'down')],
    ),
    failure(base, instance),
    nested ? null : el('div', { class: 'root mono muted' }, p.root),
    nested || !(p.compose || []).length ? null : details(`${key}:compose`, `${p.compose.length} compose file${p.compose.length > 1 ? 's' : ''}`, el('ul', {}, p.compose.map((f) => el('li', { class: 'mono' }, f)))),
    p.problem ? el('p', { class: 'problem' }, p.problem) : [stackView(p, base, !inGroup), servicesTable(p, base, instance)],
    // On the project's page only: a group's page lists many, and reading each walks its folders.
    inGroup || p.problem ? null : diskView(base, instance),
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
      return p.name.toLowerCase().includes(word) || (p.group || '').toLowerCase().includes(word) || (p.root || '').toLowerCase().includes(word);
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
    : [`${running}/${services.length} running`, warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
  // A project run more than once is one tile, a pile: a dot per instance tells each one's state.
  const pile = instances
    ? el(
        'span',
        { class: 'pile', title: `${instances + 1} instances` },
        [p, ...p.others].map((x) => el('span', { class: `dot ${projectTone(x).tone}`, title: `${x.name}: ${projectTone(x).label}` })),
        `×${instances + 1}`,
      )
    : null;
  return el(
    'article',
    {
      class: `tile ${tone}${instances ? ' stacked' : ''}${instances > 1 ? ' deep' : ''}`,
      'data-name': p.name,
      // The whole tile opens the page; its links (routes) and its button keep their own.
      onclick: (e) => {
        if (!e.target.closest('a, button')) location.hash = href;
      },
    },
    el(
      'div',
      { class: 'tile-head' },
      el('a', { href, class: 'tile-name' }, p.name),
      el('span', { class: `pill ${tone}` }, label),
      pile,
      el('span', { class: 'spacer' }),
      // Down when anything runs, up otherwise: the page has both.
      actButton(p.name, 1, label === 'down' || p.problem ? 'up' : 'down'),
    ),
    failure(p.name, 1),
    p.problem ? el('p', { class: 'problem' }, p.problem) : el('p', { class: 'tile-facts muted' }, facts, warnings ? el('span', { class: 'dot warn tile-alert' }) : null),
    p.problem ? null : stackView(p, p.name),
    (p.tags || []).length ? el('div', { class: 'tile-tags' }, p.tags.map((t) => el('span', { class: 'tag' }, `#${t}`))) : null,
  );
}

/** A group's state from its projects': the worst of them, up when all are, down when none runs. */
function groupTone(members) {
  const tones = members.map(projectTone);
  if (tones.some((t) => t.tone === 'bad')) return { tone: 'bad', label: 'error' };
  if (tones.every((t) => t.label === 'down')) return { tone: '', label: 'down' };
  if (tones.every((t) => t.tone === 'ok')) return { tone: 'ok', label: 'up' };
  const up = tones.filter((t) => t.label !== 'down').length;
  return { tone: 'warn', label: up === tones.length ? 'up, not healthy' : `${up}/${tones.length} up` };
}

/**
 * A group's view: the servers its projects share, once (for its head), and each project's
 * apps, each line leading to its project's page with the services of its own beside it. A
 * project's services no app uses go on its first line.
 */
function groupStack(group, members) {
  const servers = new Map();
  const rows = [];
  for (const p of [...members].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = stackParts(p);
    const icon = (s) => decoration(s, p.name, parts.admins.get(s), s.server ? group : '');
    for (const s of parts.shared) {
      // The group's server, named as the group knows it; a project's own name for it aside.
      if (!servers.has(s.server)) {
        const admins = (parts.admins.get(s) || []).map((a) => ({ ...a, service: a.server }));
        servers.set(s.server, { server: { ...s, service: s.server }, admins, project: p.name, icon: decoration({ ...s, service: s.server }, p.name, admins, group) });
        for (const a of admins) servers.set(a.server, { server: a, admins: [], project: p.name, hidden: true });
      }
    }
    if (p.problem) {
      rows.push(el('div', { class: 'app-row' }, el('span', { class: 'dot bad' }), el('a', { href: pageOf(p.name), class: 'mono app-name' }, p.name), el('span', { class: 'problem' }, 'error')));
      continue;
    }
    parts.apps.forEach((part, i) => {
      const name = parts.apps.length > 1 ? `${p.name} · ${part.app.service}` : p.name;
      rows.push(appRow(i === 0 ? { ...part, own: [...part.own, ...parts.loose] } : part, icon, name, pageOf(p.name)));
    });
  }
  const all = [...servers.values()];
  return { shared: all.filter((x) => !x.hidden).map((x) => x.icon), servers: all, rows: el('div', { class: 'stack' }, rows) };
}

/** A group in the gallery: one tile for its projects, as one project of several apps. */
function groupTile(group, members) {
  const { tone, label } = groupTone(members);
  const services = members.flatMap((p) => p.services || []).filter((s) => s.state !== 'tool');
  const running = services.filter((s) => s.state === 'running').length;
  const warnings = members.reduce((n, p) => n + [p, ...(p.others || [])].reduce((m, x) => m + (x.warnings || []).length, 0), 0);
  const href = groupPageOf(group);
  const key = `group:${group}`;
  const view = groupStack(group, members);
  const facts = [`${members.length} project${members.length > 1 ? 's' : ''}`, `${running}/${services.length} running`, warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
  return el(
    'article',
    {
      class: `tile ${tone}`,
      'data-name': group,
      onclick: (e) => {
        if (!e.target.closest('a, button')) location.hash = href;
      },
    },
    el(
      'div',
      { class: 'tile-head' },
      el('a', { href, class: 'tile-name' }, group),
      el('span', { class: `pill ${tone}` }, label),
      el('span', { class: 'decos' }, view.shared),
      el('span', { class: 'spacer' }),
      actButton(key, 1, label === 'down' ? 'up' : 'down', actGroup),
    ),
    failure(key, 1),
    el('p', { class: 'tile-facts muted' }, facts, warnings ? el('span', { class: 'dot warn tile-alert' }) : null),
    view.rows,
  );
}

/** The group's servers, each with its state, its address and its logs (read in its stack). */
function sharedTable(servers, group) {
  if (servers.length === 0) return null;
  const rows = [...servers]
    .sort((a, b) => a.server.server.localeCompare(b.server.server))
    .map(({ server: s, project }) =>
      el(
        'tr',
        {},
        el('td', {}, s.recipe ? decoration({ ...s, link: s.link }, project, [], group) : null, el('span', { class: 'mono' }, ` ${s.server}`)),
        el('td', {}, s.state, s.health ? el('span', { class: 'muted' }, ` · ${s.health}`) : null),
        el('td', {}, s.link ? el('a', { href: s.link, target: '_blank', rel: 'noreferrer' }, s.link.replace(/^http:\/\//, '')) : null),
        el('td', { class: 'actions' }, el('button', { type: 'button', onclick: () => openLogs({ project: s.stack, instance: 1, service: s.server }) }, 'Logs')),
      ),
    );
  return el(
    'table',
    { class: 'services' },
    el('thead', {}, el('tr', {}, el('th', {}, `Shared by group ${group}`), el('th', {}, 'State'), el('th', {}, 'Route'), el('th', {}))),
    el('tbody', {}, rows),
  );
}

/** A group's page: its view, then each of its projects as on its own page. */
function renderGroup(projects) {
  const { group } = state.view;
  const members = projects.filter((p) => p.group === group && !p.sharedOf);
  const back = el('a', { href: '#', class: 'back' }, '← All projects');
  if (members.length === 0) {
    $('projects').replaceChildren(back, el('p', { class: 'problem' }, `No group "${group}".`));
    $('summary').textContent = '';
    return;
  }
  const { tone, label } = groupTone(members);
  const key = `group:${group}`;
  const view = groupStack(group, members);
  const head = el(
    'article',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('h2', {}, group),
      el('span', { class: `pill ${tone}` }, label),
      el('span', { class: 'decos' }, view.shared),
      el('span', { class: 'spacer' }),
      state.busy.has(`${key}#1`) ? actButton(key, 1, 'up', actGroup) : [actButton(key, 1, 'up', actGroup), actButton(key, 1, 'down', actGroup)],
    ),
    failure(key, 1),
    view.rows,
    sharedTable(view.servers, group),
  );
  $('projects').replaceChildren(back, head, ...[...members].sort((a, b) => a.name.localeCompare(b.name)).map((p) => card({ ...p, others: [] }, p.name, false, true)));
  $('summary').textContent = `group ${group} · ${members.length} project${members.length > 1 ? 's' : ''}`;
}

/**
 * A project run more than once: one chip per instance, the first included, each with its
 * state, its address and its Up/Down; the chip shown below is the selected one.
 */
function instanceStrip(base, selected) {
  const all = [base, ...(base.others || [])];
  if (all.length < 2) return null;
  return el(
    'nav',
    { class: 'instances', 'aria-label': 'Instances' },
    all.map((x) => {
      const n = x.instance || 1;
      const { tone, label } = projectTone(x);
      const route = plainRoutes(x)[0];
      return el(
        'div',
        { class: `chip${n === selected ? ' selected' : ''}` },
        el('a', { href: pageOf(base.name, n), class: 'chip-name', 'aria-current': n === selected ? 'page' : null }, el('span', { class: `dot ${tone}` }), x.name),
        el('span', { class: `pill ${tone}` }, label),
        route ? el('a', { href: route.url, target: '_blank', rel: 'noreferrer', class: 'mono' }, route.url.replace(/^http:\/\//, '')) : null,
        decorations(x, base.name),
        actButton(base.name, n, label === 'down' || x.problem ? 'up' : 'down'),
      );
    }),
  );
}

/**
 * What runs in a service, as its recipe's `info` action reads it: read once on arrival (and
 * on Refresh), not at each refresh of the page. Sections start with "## "; a line with a tab,
 * or phpinfo's "a => b", is a row of a table; the rest is text.
 */
function renderInfo(projects) {
  const { project, instance, info: service } = state.view;
  const key = `${project}#${instance}#${service}`;
  const base = projects.find((p) => p.name === project);
  const s = base && (base.services || []).find((x) => x.service === service);
  const fetchInfo = () => {
    state.info = { key };
    api(`/v1/projects/${encodeURIComponent(project)}/info?service=${encodeURIComponent(service)}${instance > 1 ? `&instance=${instance}` : ''}`).then(
      (data) => (state.info = { key, data }),
      (e) => (state.info = { key, error: e.message }),
    ).then(() => state.last && render(state.last));
  };
  if (!state.info || state.info.key !== key) fetchInfo();
  if (state.logs) closeLogs();
  const back = el('a', { href: pageOf(project, instance), class: 'back' }, `← ${project}`);
  const head = el(
    'div',
    { class: 'card-head' },
    el('h2', {}, s && s.recipe ? decoration({ ...s, link: undefined, info: false }, project) : null, ` ${service}`, el('span', { class: 'muted' }, s && s.recipe ? ` · ${s.recipe}` : '')),
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', onclick: () => (fetchInfo(), render(state.last)) }, 'Refresh'),
  );
  const { data, error } = state.info;
  let body;
  if (error) body = el('p', { class: 'problem' }, error);
  else if (!data) body = el('p', { class: 'muted' }, 'Reading it in the container…');
  else body = [data.ok ? null : el('p', { class: 'problem' }, 'The info action failed; what it said:'), ...infoSections(data.text)];
  $('projects').replaceChildren(back, el('article', { class: 'card info' }, head, body));
  $('summary').textContent = `what runs in ${project}/${service}`;
}

function infoSections(text) {
  const sections = [];
  let current = { title: '', lines: [] };
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      if (current.title || current.lines.some((l) => l.trim())) sections.push(current);
      current = { title: line.slice(3), lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return sections.flatMap(({ title, lines }) => {
    const nodes = [];
    let rows = [];
    let prose = [];
    const flush = () => {
      if (rows.length) nodes.push(el('table', { class: 'info-table' }, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { class: 'mono' }, k), el('td', { class: 'mono' }, v))))));
      if (prose.some((l) => l.trim())) nodes.push(el('pre', { class: 'info-text' }, prose.join('\n').replace(/^\n+|\s+$/g, '')));
      rows = [];
      prose = [];
    };
    for (const line of lines) {
      const tab = line.indexOf('\t');
      const arrow = line.indexOf(' => ');
      const pair = tab > 0 ? [line.slice(0, tab), line.slice(tab + 1)] : arrow > 0 ? [line.slice(0, arrow), line.slice(arrow + 4)] : null;
      if (pair) {
        if (prose.some((l) => l.trim())) flush();
        prose = [];
        rows.push(pair);
      } else {
        if (rows.length && line.trim()) flush();
        prose.push(line);
      }
    }
    flush();
    if (!title) return nodes;
    // Open unless folded: kept across the page's refreshes, like a group.
    const key = `info:${title}`;
    const node = el('details', { class: 'info-section', open: !state.closed.has(key) }, el('summary', {}, title), ...nodes);
    node.addEventListener('toggle', () => (node.open ? state.closed.delete(key) : state.closed.add(key)));
    return node;
  });
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
  // A grouped project's way back is its group's page.
  const up = base.group ? el('a', { href: groupPageOf(base.group), class: 'back' }, `← group ${base.group}`) : back;
  // replaceChildren writes a null as the text "null": a project run once has no strip.
  $('projects').replaceChildren(...[up, instanceStrip(base, instance), card({ ...p, others: [] }, project)].filter(Boolean));
  $('summary').textContent = [base.group ? `group ${base.group}` : '', instance > 1 ? `instance ${instance} of ${project}` : ''].filter(Boolean).join(' · ');
  // The page opens on its logs, every service's; closed, they stay closed on this page.
  const key = `${project}#${instance}`;
  if (state.logsPage !== key) {
    state.logsPage = key;
    openLogs({ project, instance, service: '' });
  }
}

function render({ edge, projects }) {
  // The nodes a tooltip points at are about to be replaced.
  hideTip();
  const edgeNode = $('edge');
  edgeNode.textContent = edge.running ? `edge on 127.0.0.1:${edge.port}` : 'edge stopped';
  edgeNode.className = `pill ${edge.running ? 'ok' : 'bad'}`;
  if (edge.dashboard) $('dashboard').href = edge.dashboard;
  $('version').textContent = state.version ? `v${state.version}` : '';
  $('filter').hidden = Boolean(state.view);
  $('signout').hidden = false;
  // A group's shared services are not a project: they show in the projects that use them.
  const listed = projects.filter((p) => !p.sharedOf);
  $('empty').hidden = listed.length > 0;
  // Open by itself the first time when there is nothing yet; then as the operator leaves it.
  if (!state.helpSet) {
    state.helpSet = true;
    $('help').open = listed.length === 0;
  }
  $('help').hidden = Boolean(state.view);
  if (state.view) return state.view.group ? renderGroup(projects) : state.view.info ? renderInfo(projects) : renderDetail(projects);
  state.logsPage = null;
  if (state.logs) closeLogs();

  const needle = state.filter.trim().toLowerCase();
  const shown = listed
    .filter((p) => matches(p, needle))
    .sort((a, b) => {
      const rank = (p) => ({ ok: 0, warn: 1, bad: 2, '': 3 })[projectTone(p).tone];
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  // A group is one tile, its projects inside; a project without a group, a tile of its own.
  const groups = [...new Set(shown.map((p) => p.group).filter(Boolean))];
  const units = [
    ...groups.map((g) => {
      const members = listed.filter((p) => p.group === g);
      return { name: g, tone: groupTone(members).tone, node: () => groupTile(g, members) };
    }),
    ...shown.filter((p) => !p.group).map((p) => ({ name: p.name, tone: projectTone(p).tone, node: () => tile(p) })),
  ].sort((a, b) => {
    const rank = (t) => ({ ok: 0, warn: 1, bad: 2, '': 3 })[t];
    return rank(a.tone) - rank(b.tone) || a.name.localeCompare(b.name);
  });
  $('projects').replaceChildren(el('div', { class: 'gallery' }, units.map((u) => u.node())));
  const up = listed.filter((p) => projectTone(p).label !== 'down' && !p.problem).length;
  const services = projects.flatMap((p) => [...(p.services || []), ...(p.others || []).flatMap((o) => o.services || [])]);
  const running = services.filter((s) => s.state === 'running').length;
  const warnings = projects.reduce((n, p) => n + (p.warnings || []).length, 0);
  $('summary').textContent =
    `${listed.length} project${listed.length === 1 ? '' : 's'} · ${up} up · ${running} service${running === 1 ? '' : 's'} running` +
    (warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '') +
    (needle ? ` · ${shown.length} shown` : '');
}

/**
 * The tab's icon, and the one before octopod's name: the tako, asleep and grey when the edge is stopped — or when octopod does
 * not answer, which is what a page served through a stopped edge sees. The grey one is
 * fetched once at the start, while it can be: it comes from the cache when it is shown.
 */
const ICONS = { up: '/favicon.svg', down: '/favicon-down.svg' };
function showIcon(up) {
  const href = up ? ICONS.up : ICONS.down;
  if ($('icon').getAttribute('href') !== href) $('icon').setAttribute('href', href);
  if ($('mascot').getAttribute('src') !== href) $('mascot').setAttribute('src', href);
}

/** The refresh icon turns once for each reading that came back. */
function spin() {
  const node = $('updated');
  node.classList.remove('spin');
  void node.offsetWidth;
  node.classList.add('spin');
}

async function refresh() {
  clearTimeout(state.timer);
  try {
    state.last = await load();
    if (state.locked) hideLogin();
    render(state.last);
    showIcon(state.last.edge.running);
    $('error').hidden = true;
    state.updatedAt = Date.now();
    state.failed = false;
    spin();
  } catch (e) {
    if (e.enroll) return showLogin();
    showIcon(false);
    state.failed = true;
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

/** How fresh the page is: said by the refresh icon's tooltip, shown by its colour. */
function tick() {
  const node = $('updated');
  const s = Math.round((Date.now() - state.updatedAt) / 1000);
  const said = !state.updatedAt ? 'not read yet' : `${state.paused ? 'paused, ' : ''}${state.failed ? 'cannot read octopod, ' : ''}updated ${s < 2 ? 'now' : `${s}s ago`}`;
  node.title = said;
  node.setAttribute('aria-label', said);
  node.classList.toggle('paused', state.paused);
  node.classList.toggle('bad', Boolean(state.failed));
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
    if (e.enroll) return showLogin();
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
  $('login-form').addEventListener('submit', enroll);
  $('signout').addEventListener('click', signOut);
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
  fetch(ICONS.down).catch(() => {});
  refresh();
});
