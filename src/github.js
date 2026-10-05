import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { config } from "./config.js"

const SCOPES = "repo read:user user:email workflow"

let token = config.githubToken
let user = null
let device = null // { deviceCode, expiresAt }

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill("SIGKILL")
          reject(new Error(`${cmd} timed out`))
        }, opts.timeout)
      : null
    child.stdout.on("data", (d) => (out += d))
    child.stderr.on("data", (d) => (err += d))
    child.on("error", reject)
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`))
    })
    child.stdin.end(opts.input ?? "")
  })
}

async function gh(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "opencode-web-hub",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// Make git (and the agent's shell) use the token for github.com over HTTPS.
async function applyToken() {
  const home = os.homedir()
  await fs.writeFile(path.join(home, ".git-credentials"), `https://x-access-token:${token}@github.com\n`, {
    mode: 0o600,
  })
  await run("git", ["config", "--global", "credential.helper", "store"])
  await run("gh", ["auth", "login", "--with-token"], { input: token + "\n" }).catch(() => {})
  if (user) {
    await run("git", ["config", "--global", "user.name", user.name || user.login])
    await run("git", ["config", "--global", "user.email", `${user.id}+${user.login}@users.noreply.github.com`])
  }
}

async function loadUser() {
  const u = await gh("https://api.github.com/user")
  user = { login: u.login, name: u.name, id: u.id, avatar: u.avatar_url }
  return user
}

export async function init() {
  if (!token) return
  try {
    await loadUser()
    await applyToken()
  } catch (e) {
    console.error("[github] preset token rejected:", e.message)
    token = ""
    user = null
  }
}

export function status() {
  return {
    connected: !!user,
    user,
    deviceFlow: !!config.githubClientId,
  }
}

export async function startDeviceFlow() {
  if (!config.githubClientId) throw new Error("GITHUB_CLIENT_ID is not configured")
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "opencode-web-hub" },
    body: JSON.stringify({ client_id: config.githubClientId, scope: SCOPES }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error_description || data.error || "device flow failed")
  device = { deviceCode: data.device_code, expiresAt: Date.now() + data.expires_in * 1000 }
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval,
    expiresIn: data.expires_in,
  }
}

export async function pollDeviceFlow() {
  if (!device || Date.now() > device.expiresAt) return { status: "expired" }
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "opencode-web-hub" },
    body: JSON.stringify({
      client_id: config.githubClientId,
      device_code: device.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  })
  const data = await res.json()
  if (data.error === "authorization_pending") return { status: "pending" }
  if (data.error === "slow_down") return { status: "slow_down" }
  if (data.error) {
    device = null
    return { status: "error", error: data.error_description || data.error }
  }
  token = data.access_token
  device = null
  await loadUser()
  await applyToken()
  return { status: "ok", user }
}

export async function connectWithToken(pat) {
  token = pat
  try {
    await loadUser()
    await applyToken()
  } catch (e) {
    token = ""
    user = null
    throw e
  }
  return user
}

export async function disconnect() {
  token = ""
  user = null
  await fs.rm(path.join(os.homedir(), ".git-credentials"), { force: true })
  await run("gh", ["auth", "logout", "--hostname", "github.com"]).catch(() => {})
}

export async function listRepos() {
  if (!token) throw new Error("GitHub is not connected")
  const repos = await gh("https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member")
  return repos.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    description: r.description,
    defaultBranch: r.default_branch,
  }))
}
