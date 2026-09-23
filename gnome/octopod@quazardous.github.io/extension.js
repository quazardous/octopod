/*
 * octopod — GNOME Shell top-bar indicator: the Windows tray's counterpart.
 *
 * A view, not a supervisor. On Linux the API is octopod's systemd user service, which
 * `systemctl --user` keeps up; an extension that also watched it could fight it. So this
 * shows the edge's state and the projects, and runs what the CLI runs — nothing else.
 *
 * It reads the API on its unix socket (no credential: the socket is the trust boundary),
 * and acts through the CLI, as the tray does. Every read has a deadline, every command is
 * asynchronous: the shell never waits on a slow docker.
 */
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {defaultSocketPath, getJson} from './octopodClient.js';
import {actionNotice, projectLabel, projectState, trayLook} from './look.js';
import {COMMANDS, START_SERVICE, describe, octopodArgv} from './actions.js';

// The edge's state for the icon, often and cheaply; the projects when the menu opens, and
// now and then so the first look at it is not empty.
const EDGE_INTERVAL_S = 10;
const PROJECTS_INTERVAL_S = 60;
// A read that hangs must not pile up inside the shell.
const READ_TIMEOUT_MS = 2000;
const GITHUB_URL = 'https://github.com/quazardous/octopod';

const OctopodIndicator = GObject.registerClass(
class OctopodIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'octopod');
        this._extension = extension;
        this._socketPath = defaultSocketPath();
        this._cancellable = new Gio.Cancellable();
        this._config = readConfig(extension.path);
        this._edge = null;
        this._why = '';
        this._projects = [];
        this._version = null;
        this._up = null;
        this._sources = [];

        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._showIcon(false);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._refresh(true, true);
        });
        this._build();
        this._refresh(true, true);
        this._sources.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, EDGE_INTERVAL_S, () => {
            this._refresh(false);
            return GLib.SOURCE_CONTINUE;
        }));
        this._sources.push(GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PROJECTS_INTERVAL_S, () => {
            this._refresh(true);
            return GLib.SOURCE_CONTINUE;
        }));
    }

    /** The tako: awake and red while the edge runs, grey and asleep otherwise. Changed only when it changes. */
    _showIcon(up) {
        if (this._up === up) return;
        this._up = up;
        this._icon.gicon = Gio.icon_new_for_string(`${this._extension.path}/icons/${up ? 'octopod.svg' : 'octopod-down.svg'}`);
    }

    /** GET with a deadline, cancelled with the indicator. */
    async _get(path) {
        const cancellable = new Gio.Cancellable();
        const link = this._cancellable.connect(() => cancellable.cancel());
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, READ_TIMEOUT_MS, () => {
            cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        try {
            return await getJson(this._socketPath, path, cancellable);
        } finally {
            GLib.source_remove(timer);
            this._cancellable.disconnect(link);
        }
    }

    /** Read again; rebuild the menu with the projects — never under the pointer, unless asked. */
    async _refresh(withProjects, rebuild = false) {
        try {
            this._edge = await this._get('/v1/edge');
            this._why = '';
        } catch (e) {
            if (this._cancellable.is_cancelled()) return;
            this._edge = null;
            // Nothing on the socket, or no answer in time: the service. Otherwise, what the API said.
            this._why = e instanceof GLib.Error ? 'its service does not answer (systemctl --user status octopod)' : String(e.message || e);
        }
        if (this._cancellable.is_cancelled()) return;
        if (withProjects && this._edge) {
            try {
                [this._projects, this._version] = await Promise.all([this._get('/v1/projects'), this._get('/v1/version')]);
            } catch {
                // The edge answered, the list did not: keep the last one.
            }
            if (this._cancellable.is_cancelled()) return;
        }
        this._showIcon(trayLook(this._edge, this._why, this._projects, this._version).up);
        if (rebuild || (withProjects && !this.menu.isOpen)) this._build();
    }

    _build() {
        const look = trayLook(this._edge, this._why, this._projects, this._version);
        this.menu.removeAll();
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(look.title, {reactive: false, style_class: 'octopod-title'}));
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(look.line, {reactive: false}));

        if (!this._edge && !look.dockerDown) {
            this._action("Start octopod's service", START_SERVICE, "systemctl --user start octopod");
            return;
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (this._edge && this._edge.console) this._link('octopod console', this._edge.console);
        if (this._edge && this._edge.dashboard) this._link('Traefik dashboard', this._edge.dashboard);

        if (this._projects.length > 0) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Projects'));
            for (const project of this._projects) this._project(project);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (this._edge && this._edge.running) this._octopod('Stop the edge', COMMANDS.edgeDown());
        else if (this._edge) this._octopod('Start the edge', COMMANDS.edgeUp());
        this._link('octopod on GitHub', GITHUB_URL);
    }

    _project(project) {
        const sub = new PopupMenu.PopupSubMenuMenuItem(projectLabel(project));
        const state = new PopupMenu.PopupMenuItem(project.problem ? project.problem : '…', {reactive: false});
        sub.menu.addMenuItem(state);
        for (const route of project.routes || []) this._link(route.url.replace(/^http:\/\//, ''), route.url, sub.menu);
        this._octopod('Start (octopod up)', COMMANDS.up(project.name), sub.menu);
        this._octopod('Stop (octopod down)', COMMANDS.down(project.name), sub.menu);
        this._link('Open its folder', GLib.filename_to_uri(project.root, null), sub.menu);
        // Its services' state, read when its submenu opens: a status costs a docker call.
        if (!project.problem) {
            sub.menu.connect('open-state-changed', async (_menu, open) => {
                if (!open) return;
                try {
                    const status = await this._get(`/v1/projects/${encodeURIComponent(project.name)}`);
                    if (!this._cancellable.is_cancelled()) state.label.text = projectState(status);
                } catch (e) {
                    if (!this._cancellable.is_cancelled()) state.label.text = String(e.message || e);
                }
            });
        }
        this.menu.addMenuItem(sub);
    }

    _link(label, uri, menu = this.menu) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(uri, null);
            } catch (e) {
                Main.notify('octopod', `Cannot open ${uri}: ${e.message}`);
            }
        });
        menu.addMenuItem(item);
    }

    _octopod(label, args, menu = this.menu) {
        this._action(label, octopodArgv(this._config.argv, args), describe(args), menu);
    }

    /** Run argv in the background; a notice says done, or its first error line; then read again. */
    _action(label, argv, what, menu = this.menu) {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            let proc;
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE});
                // The PATH octopod was set up with: the shell's often lacks docker's or ~/.local/bin.
                if (this._config.path) launcher.setenv('PATH', this._config.path, true);
                proc = launcher.spawnv(argv);
            } catch (e) {
                Main.notify('octopod', actionNotice(what, 127, e.message).text);
                return;
            }
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                let stderr = '';
                try {
                    [, , stderr] = p.communicate_utf8_finish(res);
                } catch {
                    if (this._cancellable.is_cancelled()) return;
                }
                if (this._cancellable.is_cancelled()) return;
                Main.notify('octopod', actionNotice(what, p.get_exit_status(), stderr).text);
                this._refresh(true, true);
            });
        });
        menu.addMenuItem(item);
    }

    destroy() {
        // Cancel first, so no read in flight lands on a destroyed actor; then the timers.
        this._cancellable.cancel();
        for (const source of this._sources) GLib.source_remove(source);
        this._sources = [];
        super.destroy();
    }
});

/** config.json, written by `octopod setup --gnome-extension`: how to start octopod, and its PATH. */
function readConfig(dir) {
    try {
        const [, bytes] = GLib.file_get_contents(`${dir}/config.json`);
        const config = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if (Array.isArray(config.argv) && config.argv.length > 0) return config;
    } catch {
        // Not installed by setup: octopod on the PATH, if it is there.
    }
    return {argv: [GLib.find_program_in_path('octopod') || 'octopod']};
}

export default class OctopodExtension extends Extension {
    enable() {
        this._indicator = new OctopodIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
