# opencode-web-hub

Lapisan tipis di depan `opencode web` supaya terasa seperti Claude Code web:

- Halaman hub: daftar workspace, **clone dari GitHub**, atau **folder baru**
- Satu container, satu proses opencode melayani semua workspace
- Login password (single user) + koneksi GitHub (device flow atau PAT)
- Data ephemeral: workspace dan sesi hilang saat redeploy

```
Browser → hub (:8080, auth) ─┬─ /hub/*  landing + API
                             └─ /*      reverse proxy → opencode web (127.0.0.1:4096)
```

Workspace dibuka lewat URL `/<base64url(path)>`, yaitu rute `/:dir` bawaan UI opencode.
Folder kosong dibuat dengan `git init` + commit awal, karena opencode hanya menganggap
sebuah folder sebagai project sendiri kalau ia repo git.

## Jalankan (Docker)

```bash
cp .env.example .env     # isi HUB_PASSWORD, GITHUB_CLIENT_ID, API key LLM
docker compose up -d --build
```

Buka `http://127.0.0.1:8080`. Untuk akses dari luar rumah gunakan Tailscale atau
Cloudflare Tunnel; jangan buka port langsung (ini memberi akses shell).

### GitHub

Buat OAuth App di GitHub (Settings → Developer settings), centang **Enable Device Flow**,
isi `GITHUB_CLIENT_ID`. Tanpa itu, tempel Personal Access Token di UI.
Token ditulis ke `~/.git-credentials` dan `gh auth`, jadi `git push` dan `gh pr create`
dari agent langsung jalan.

## Dev tanpa Docker

```bash
npm install
HUB_PASSWORD=secret WORKSPACES_DIR=./ws node src/server.js      # butuh `opencode` di PATH
SPAWN_OPENCODE=0 ...                                            # hub saja
```

## Status

Teruji: auth, validasi input, folder kosong, hapus, redirect. Belum teruji end-to-end:
build Docker, clone dari GitHub, dan deep-link `/<base64url>` di Linux.
