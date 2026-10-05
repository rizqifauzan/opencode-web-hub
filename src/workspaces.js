import fs from "node:fs/promises"
import path from "node:path"
import { config } from "./config.js"
import { run } from "./github.js"

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export function toUrlId(dir) {
  return Buffer.from(dir).toString("base64url")
}

function parseRepo(input) {
  const s = String(input || "")
    .trim()
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
  if (!REPO_RE.test(s)) throw new Error("Repo harus berformat owner/name atau URL https://github.com/owner/name")
  return s
}

async function uniqueDir(base) {
  let name = base
  for (let i = 2; ; i++) {
    try {
      await fs.access(path.join(config.workspacesDir, name))
      name = `${base}-${i}`
    } catch {
      return name
    }
  }
}

function resolveInside(name) {
  if (!NAME_RE.test(name)) throw new Error("Nama workspace tidak valid")
  const dir = path.join(config.workspacesDir, name)
  if (path.dirname(dir) !== config.workspacesDir) throw new Error("Nama workspace tidak valid")
  return dir
}

export async function list() {
  await fs.mkdir(config.workspacesDir, { recursive: true })
  const entries = await fs.readdir(config.workspacesDir, { withFileTypes: true })
  const items = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue
    const dir = path.join(config.workspacesDir, e.name)
    const [stat, remote, branch] = await Promise.all([
      fs.stat(dir),
      run("git", ["remote", "get-url", "origin"], { cwd: dir }).catch(() => ""),
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir }).catch(() => ""),
    ])
    items.push({
      name: e.name,
      remote: remote.trim() || null,
      branch: branch.trim() || null,
      updatedAt: stat.mtimeMs,
      openPath: `/${toUrlId(dir)}`,
    })
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function clone({ repo, branch }) {
  const slug = parseRepo(repo)
  if (branch && !BRANCH_RE.test(branch)) throw new Error("Nama branch tidak valid")
  await fs.mkdir(config.workspacesDir, { recursive: true })
  const name = await uniqueDir(slug.split("/")[1])
  const dir = path.join(config.workspacesDir, name)
  const args = ["clone", ...(branch ? ["--branch", branch] : []), "--", `https://github.com/${slug}.git`, dir]
  try {
    await run("git", args, { timeout: 10 * 60 * 1000 })
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true })
    throw e
  }
  return { name, openPath: `/${toUrlId(dir)}` }
}

export async function createEmpty({ name }) {
  if (!NAME_RE.test(String(name || ""))) throw new Error("Nama: huruf/angka/._- (maks 64), harus diawali huruf/angka")
  const dir = resolveInside(name)
  await fs.mkdir(config.workspacesDir, { recursive: true })
  await fs.mkdir(dir).catch((e) => {
    throw new Error(e.code === "EEXIST" ? `Workspace "${name}" sudah ada` : "Gagal membuat folder")
  })
  // opencode only treats a directory as its own project when it is a git repo with a commit
  await run("git", ["init", "-q"], { cwd: dir })
  await run("git", ["-c", "user.name=opencode-hub", "-c", "user.email=hub@localhost", "commit", "-q", "--allow-empty", "-m", "Initial commit"], { cwd: dir })
  return { name, openPath: `/${toUrlId(dir)}` }
}

export async function remove(name) {
  const dir = resolveInside(name)
  await fs.rm(dir, { recursive: true, force: true })
}
