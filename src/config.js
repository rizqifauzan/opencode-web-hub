import os from "node:os"
import path from "node:path"

const env = process.env

export const config = {
  port: Number(env.PORT || 8080),
  opencodePort: Number(env.OPENCODE_PORT || 4096),
  opencodeBin: env.OPENCODE_BIN || "opencode",
  workspacesDir: path.resolve(env.WORKSPACES_DIR || path.join(os.homedir(), "workspaces")),
  password: env.HUB_PASSWORD || "",
  githubClientId: env.GITHUB_CLIENT_ID || "",
  githubToken: env.GITHUB_TOKEN || "",
  // set to "0" to run the hub without spawning opencode (useful for dev)
  spawnOpencode: env.SPAWN_OPENCODE !== "0",
}
