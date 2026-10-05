import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import httpProxy from "http-proxy"
import { config } from "./config.js"
import * as auth from "./auth.js"
import * as github from "./github.js"
import * as workspaces from "./workspaces.js"

if (!config.password) {
  console.error("HUB_PASSWORD is required (this server gives shell access to whoever logs in).")
  process.exit(1)
}

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")
const target = `http://127.0.0.1:${config.opencodePort}`
const proxy = httpProxy.createProxyServer({ target, ws: true, changeOrigin: true })
proxy.on("error", (err, _req, res) => {
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain" })
    res.end("opencode is not reachable yet, retry in a few seconds")
  } else if (res?.destroy) res.destroy()
  console.error("[proxy]", err.message)
})

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  if (!(req.headers["content-type"] || "").startsWith("application/json")) throw new Error("JSON body required")
  let raw = ""
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 1e6) throw new Error("Body too large")
  }
  return raw ? JSON.parse(raw) : {}
}

async function serveStatic(res, file, type) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" })
  res.end(await fs.readFile(path.join(publicDir, file)))
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`
  try {
    switch (route) {
      case "GET /hub/api/workspaces":
        return json(res, 200, await workspaces.list())
      case "POST /hub/api/workspaces/clone":
        return json(res, 200, await workspaces.clone(await readJson(req)))
      case "POST /hub/api/workspaces/empty":
        return json(res, 200, await workspaces.createEmpty(await readJson(req)))
      case "POST /hub/api/workspaces/delete":
        await workspaces.remove((await readJson(req)).name)
        return json(res, 200, { ok: true })
      case "GET /hub/api/github":
        return json(res, 200, github.status())
      case "POST /hub/api/github/device":
        return json(res, 200, await github.startDeviceFlow())
      case "POST /hub/api/github/poll":
        return json(res, 200, await github.pollDeviceFlow())
      case "POST /hub/api/github/token":
        return json(res, 200, await github.connectWithToken((await readJson(req)).token))
      case "POST /hub/api/github/disconnect":
        await github.disconnect()
        return json(res, 200, { ok: true })
      case "GET /hub/api/github/repos":
        return json(res, 200, await github.listRepos())
      default:
        return json(res, 404, { error: "not found" })
    }
  } catch (e) {
    return json(res, 400, { error: e.message })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://hub")
  const ip = req.socket.remoteAddress || ""

  if (url.pathname === "/hub/login" && req.method === "GET") return serveStatic(res, "login.html", "text/html; charset=utf-8")
  if (url.pathname === "/hub/login" && req.method === "POST") {
    if (auth.throttled(ip)) return json(res, 429, { error: "Terlalu banyak percobaan, coba lagi nanti" })
    try {
      const { password } = await readJson(req)
      if (!auth.checkPassword(password)) {
        auth.recordFail(ip)
        return json(res, 401, { error: "Password salah" })
      }
    } catch (e) {
      return json(res, 400, { error: e.message })
    }
    res.setHeader("Set-Cookie", auth.sessionCookie())
    return json(res, 200, { ok: true })
  }
  if (url.pathname === "/hub/logout") {
    res.writeHead(302, { "Set-Cookie": auth.clearCookie, Location: "/hub/login" })
    return res.end()
  }

  // browsers fetch the manifest without credentials; it is public static JSON
  if (url.pathname === "/site.webmanifest" && req.method === "GET") return proxy.web(req, res)

  if (!auth.isAuthed(req)) {
    if (url.pathname.startsWith("/hub/api/") || req.method !== "GET") return json(res, 401, { error: "unauthorized" })
    res.writeHead(302, { Location: "/hub/login" })
    return res.end()
  }

  if (url.pathname === "/hub" || url.pathname === "/hub/") return serveStatic(res, "index.html", "text/html; charset=utf-8")
  if (url.pathname.startsWith("/hub/api/")) return api(req, res, url)

  // opencode's own "Home" goes to "/": make that the hub
  if (url.pathname === "/" && (req.headers.accept || "").includes("text/html")) {
    res.writeHead(302, { Location: "/hub/" })
    return res.end()
  }

  proxy.web(req, res)
})

server.on("upgrade", (req, socket, head) => {
  if (!auth.isAuthed(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
    return socket.destroy()
  }
  proxy.ws(req, socket, head)
})

let opencode = null
function startOpencode() {
  opencode = spawn(config.opencodeBin, ["web", "--port", String(config.opencodePort), "--hostname", "127.0.0.1"], {
    cwd: config.workspacesDir,
    env: { ...process.env, BROWSER: "none" },
    stdio: "inherit",
  })
  opencode.on("exit", (code) => {
    console.error(`[opencode] exited (${code}), restarting in 2s`)
    setTimeout(startOpencode, 2000)
  })
}

await fs.mkdir(config.workspacesDir, { recursive: true })
await github.init()
if (config.spawnOpencode) startOpencode()
server.listen(config.port, () => console.log(`[hub] http://0.0.0.0:${config.port}  workspaces: ${config.workspacesDir}`))

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    opencode?.removeAllListeners("exit")
    opencode?.kill()
    process.exit(0)
  })
}
