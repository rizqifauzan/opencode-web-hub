import crypto from "node:crypto"
import { config } from "./config.js"

const COOKIE = "hub_session"
const TTL_MS = 7 * 24 * 60 * 60 * 1000
// regenerated on every boot: a restart/redeploy logs everyone out
const secret = crypto.randomBytes(32)

const sha = (s) => crypto.createHash("sha256").update(s).digest()
const sign = (v) => crypto.createHmac("sha256", secret).update(v).digest("base64url")

export function checkPassword(input) {
  return config.password !== "" && crypto.timingSafeEqual(sha(String(input)), sha(config.password))
}

export function sessionCookie() {
  const exp = String(Date.now() + TTL_MS)
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}`
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`

export function isAuthed(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))
  if (!raw) return false
  const [exp, sig] = raw.slice(COOKIE.length + 1).split(".")
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = Buffer.from(sign(exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

// naive in-memory throttle: 10 failed logins / 15 min / IP
const fails = new Map()
export function throttled(ip) {
  const rec = fails.get(ip)
  return !!rec && rec.until > Date.now() && rec.count >= 10
}
export function recordFail(ip) {
  const rec = fails.get(ip)
  if (!rec || rec.until < Date.now()) fails.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 })
  else rec.count++
}
