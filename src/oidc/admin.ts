/**
 * The admin page (`/admin`): the users of the store, added, changed and removed through the
 * admin API with its token. One page, no dependency; the token is kept in the tab's session
 * storage, never in a cookie, so another site cannot act with it.
 */
export function adminPage(): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>OIDC users</title>
<style>
body{font:14px system-ui;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#222}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ddd;vertical-align:top}
code{font-size:12px;word-break:break-all}input,textarea{font:inherit;padding:.35rem;box-sizing:border-box}textarea{width:100%;height:6rem;font-family:monospace}
label{display:block;margin:.6rem 0 .2rem}button{font:inherit;padding:.35rem .9rem}.error{color:#b00}.muted{color:#666}
</style>
<h1>Users</h1>
<p class="muted">Who may sign in, with which claims. The admin token is in <code>octopod secrets &lt;project&gt;</code> (the service's <code>admin-token</code>).</p>
<form id="auth"><input id="token" type="password" placeholder="admin token" size="40" aria-label="admin token"> <button>Use</button></form>
<p id="error" class="error" hidden></p>
<table><thead><tr><th>User</th><th>Claims</th><th>Password</th><th>Issuers</th><th></th></tr></thead><tbody id="users"></tbody></table>
<h2 id="title">Add a user</h2>
<form id="edit">
<label for="sub">User name</label><input id="sub" required pattern="[A-Za-z0-9._@+-]{1,128}">
<label for="claims">Claims (JSON)</label><textarea id="claims">{"email": "", "groups": []}</textarea>
<label for="password">Password <span class="muted">(empty: unchanged; none at all: one-click sign-in)</span></label><input id="password" type="password" autocomplete="new-password">
<label><input id="nopassword" type="checkbox"> remove its password</label>
<label for="issuers">Issuers <span class="muted">(comma-separated; empty: all)</span></label><input id="issuers" placeholder="admi, google">
<p><button>Save</button> <button type="button" id="reset">New</button></p>
</form>
<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('oidc-admin') || '';
const fail = (m) => { $('error').textContent = m; $('error').hidden = !m; };
async function api(method, path, payload) {
  const r = await fetch('/admin/api' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || r.statusText);
  return data;
}
function cell(text, code) { const td = document.createElement('td'); const n = document.createElement(code ? 'code' : 'span'); n.textContent = text; td.append(n); return td; }
async function load() {
  if (!token) return;
  try {
    const { users } = await api('GET', '/users');
    fail('');
    $('users').replaceChildren(...users.map((u) => {
      const tr = document.createElement('tr');
      const actions = document.createElement('td');
      const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.onclick = () => fill(u);
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.onclick = async () => { if (del.textContent !== 'Sure?') { del.textContent = 'Sure?'; return; } await api('DELETE', '/users/' + encodeURIComponent(u.sub)).catch((e) => fail(e.message)); load(); };
      actions.append(edit, ' ', del);
      tr.append(cell(u.sub), cell(JSON.stringify(u.claims), true), cell(u.password ? 'yes' : 'none'), cell((u.issuers || ['all']).join(', ')), actions);
      return tr;
    }));
  } catch (e) { fail(e.message); }
}
function fill(u) {
  $('title').textContent = u ? 'Edit ' + u.sub : 'Add a user';
  $('sub').value = u ? u.sub : ''; $('sub').readOnly = Boolean(u);
  $('claims').value = u ? JSON.stringify(u.claims, null, 2) : '{"email": "", "groups": []}';
  $('password').value = ''; $('nopassword').checked = false;
  $('issuers').value = u && u.issuers ? u.issuers.join(', ') : '';
}
$('auth').onsubmit = (e) => { e.preventDefault(); token = $('token').value.trim(); sessionStorage.setItem('oidc-admin', token); load(); };
$('reset').onclick = () => fill(null);
$('edit').onsubmit = async (e) => {
  e.preventDefault();
  let claims;
  try { claims = JSON.parse($('claims').value || '{}'); } catch { return fail('The claims must be JSON.'); }
  const issuers = $('issuers').value.split(',').map((s) => s.trim()).filter(Boolean);
  const payload = { claims, issuers: issuers.length ? issuers : null };
  if ($('nopassword').checked) payload.password = null; else if ($('password').value) payload.password = $('password').value;
  try { await api('PUT', '/users/' + encodeURIComponent($('sub').value), payload); fill(null); fail(''); load(); } catch (err) { fail(err.message); }
};
load();
</script>`;
}
