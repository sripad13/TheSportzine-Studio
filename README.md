# Sports Studio

Sports Studio is a browser-based sports editorial graphics editor prototype.

## Run locally
Open `index.html` in a modern browser, or serve this directory with any static web server.

## Prototype features
- 1080 × 1440 (3:4) canvas
- League Gothic headline typography via Google Fonts
- Image upload and clipboard paste
- Drag-to-reposition and zoom
- Comma-separated highlighted phrases
- Headline wrapping and PNG export
- Optional MediaPipe face detection (requires internet access)

## Deploy with GitHub Pages
The included GitHub Actions workflow deploys the repository root to GitHub Pages when changes are pushed to `main`. In repository Settings → Pages, select **GitHub Actions** as the build and deployment source if it is not already selected.

## Current limitations
This is an MVP prototype, not the full production application. Cloud project storage, full layer editing, the exact supplied logo image assets, and the complete reference-matched template set still need implementation.


## Buffer scheduling integration

The editor includes a 280-character caption composer with multi-channel selection, queue scheduling, custom date/time scheduling, and draft saving.

**Security:** The Buffer API key must never be placed in `index.html`, browser storage, or Git. The browser calls the separate Cloudflare Worker in `buffer-worker.js`; the key is stored as a Worker secret.

### Deploy the Buffer Worker

1. In the Cloudflare dashboard, open **Workers & Pages** and create a Worker named `thesportzine-buffer-api`.
2. Deploy the contents of `buffer-worker.js` as the Worker script.
3. In the Worker **Settings → Variables and Secrets**, add a secret named `BUFFER_API_KEY`. Generate the key in Buffer under **Settings → API**.
4. In the Worker **Settings → Domains & Routes**, add the custom domain `buffer-api.thesportzine.com`.
5. Redeploy the Worker after saving the secret, if Cloudflare prompts you.
6. Open `https://buffer-api.thesportzine.com/channels` from the Sports Studio editor using **Load / refresh channels**. The editor should show the connected Buffer channels.

The Worker allows browser requests only from `https://canvas.thesportzine.com` and `https://sripad13.github.io`. It validates the 280-character limit server-side and confirms selected channels against the connected Buffer account before creating posts.

### Scheduling behaviour

- **Queue:** Adds each selected channel's post to its next available Buffer queue slot.
- **Choose date and time:** Schedules each selected channel's post for the chosen local date/time (converted to UTC for Buffer).
- **Save as draft:** Creates a Buffer draft instead of scheduling it.

Buffer uses its GraphQL API at `https://api.buffer.com`. See the [Buffer authentication guide](https://developers.buffer.com/guides/authentication.html) and [posts and scheduling guide](https://developers.buffer.com/guides/posts-and-scheduling.html).
