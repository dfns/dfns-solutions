import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.join(__dirname, '../.env'), quiet: true })

export function env(name: string) {
    return process.env[name] || ''
}

export function requireEnv(...names: string[]) {
    const missing = names.filter(n => !process.env[n])
    if (missing.length) throw new Error(`Missing in .env: ${missing.join(', ')}. Run 'npm run setup' first.`)
}
