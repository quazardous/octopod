/*
 * HTTP over the API's unix socket, what `octopod serve` listens on.
 *
 * The socket is the trust boundary: only its user can open it, and the extension runs as
 * that user — so it holds no credential. The answers are small JSON documents, asked in
 * HTTP/1.0: read to the end, split on the blank line, parse the body.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.SocketClient.prototype, 'connect_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');

const DECODER = new TextDecoder('utf-8');

/** Where `octopod serve` listens by default. */
export function defaultSocketPath() {
    const run = GLib.getenv('XDG_RUNTIME_DIR') || GLib.build_filenamev([GLib.get_tmp_dir(), `octopod-${new Gio.Credentials().get_unix_user()}`]);
    return GLib.build_filenamev([run, 'octopod', 'octopod.sock']);
}

/** Why a read failed: the API's own `{ error }` when it answered one. */
export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/** GET `path`, the JSON body. Throws when the API does not answer, or answers an error. */
export async function getJson(socketPath, path, cancellable = null) {
    const client = new Gio.SocketClient();
    const connection = await client.connect_async(new Gio.UnixSocketAddress({path: socketPath}), cancellable);
    try {
        // HTTP/1.0: the answer comes whole, never chunked, and the connection closes after it.
        const request = `GET ${path} HTTP/1.0\r\nHost: octopod\r\nAccept: application/json\r\n\r\n`;
        await connection.get_output_stream().write_all_async(new TextEncoder().encode(request), GLib.PRIORITY_DEFAULT, cancellable);
        const input = connection.get_input_stream();
        const chunks = [];
        let total = 0;
        for (;;) {
            const bytes = await input.read_bytes_async(8192, GLib.PRIORITY_DEFAULT, cancellable);
            const size = bytes.get_size();
            if (size === 0) break;
            chunks.push(bytes.get_data());
            total += size;
            // A guard: the answers are a few kB, and a wedged API must not grow the shell.
            if (total > 1024 * 1024) throw new ApiError('answer too large', 0);
        }
        const all = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) {
            all.set(c, at);
            at += c.length;
        }
        const raw = DECODER.decode(all);
        const split = raw.indexOf('\r\n\r\n');
        if (split < 0) throw new ApiError('malformed answer', 0);
        const status = Number(raw.slice(0, raw.indexOf('\r\n')).split(' ')[1]);
        let body;
        try {
            body = JSON.parse(raw.slice(split + 4));
        } catch {
            throw new ApiError(`HTTP ${status}`, status);
        }
        if (status !== 200) throw new ApiError(body && body.error ? body.error : `HTTP ${status}`, status);
        return body;
    } finally {
        connection.close(null);
    }
}
