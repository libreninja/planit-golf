import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.join(__dirname, "..")
const pnpmRoot = path.join(repoRoot, "node_modules", ".pnpm")

function findSupabaseBinary() {
  if (!fs.existsSync(pnpmRoot)) {
    throw new Error("node_modules/.pnpm not found. Install dependencies first.")
  }

  const entry = fs
    .readdirSync(pnpmRoot)
    .find((name) => name.startsWith("supabase@"))

  if (!entry) {
    throw new Error("Supabase CLI package is not installed.")
  }

  const binaryPath = path.join(
    pnpmRoot,
    entry,
    "node_modules",
    "supabase",
    "bin",
    "supabase",
  )

  if (!fs.existsSync(binaryPath)) {
    throw new Error("Supabase CLI binary is missing. Re-run the installer.")
  }

  return binaryPath
}

const binaryPath = findSupabaseBinary()
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
