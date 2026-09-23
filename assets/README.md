# assets

The pictures of the Windows tray and of the console.

| File | What | From |
|---|---|---|
| `octopod.svg`, `octopod-down.svg` (and their `.ico`, `.png`) | octopod's tako: running, and asleep when the edge is not | drawn for octopod by `gen-icons.mjs` (MIT, as octopod) |
| `github.svg`, `github-32.png` | GitHub's mark, on the links to octopod's repository | `mark-github-16.svg` of [@primer/octicons](https://github.com/primer/octicons) (MIT); the PNG rendered by `gen-icons.mjs` |
| `traefik-16.png`, `traefik-32.png` | Traefik Proxy's logo, on the links to its dashboard | the favicons of Traefik's own dashboard (Traefik 3.6) |

The GitHub and Traefik logos are their owners' marks, shown only to name what a link
opens.

`node assets/gen-icons.mjs` draws the taki again and renders the PNGs (it fetches
`@resvg/resvg-js-cli` through npx).
