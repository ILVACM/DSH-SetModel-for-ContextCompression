import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const DEFAULT_BACKUP_KEEP = 3

export function defaultDataDir(): string {
  return join(homedir(), '.dsh-compaction-setmodel')
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function atomicWriteText(filename: string, text: string): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temporary, filename)
        return
      } catch (error) {
        lastError = error
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
        await pause(20 * (2 ** attempt))
      }
    }
    throw lastError
  } finally {
    try { await unlink(temporary) } catch { /* renamed or already absent */ }
  }
}

export async function readBackupKeep(dataDir = defaultDataDir()): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))
    const value = (parsed as { backupKeep?: unknown }).backupKeep
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50
      ? value
      : DEFAULT_BACKUP_KEEP
  } catch {
    return DEFAULT_BACKUP_KEEP
  }
}

export async function saveBackupKeep(value: number, dataDir = defaultDataDir()): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error('backupKeep must be an integer from 1 to 50')
  await atomicWriteText(join(dataDir, 'settings.json'), `${JSON.stringify({ backupKeep: value }, null, 2)}\n`)
}
