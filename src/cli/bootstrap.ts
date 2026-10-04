import { VERSION } from './version'

// Task 1 probe: proves Node mode inside app.asar. Replaced in Task 11.
process.stdout.write(`${VERSION} ${process.resourcesPath ?? '(no resourcesPath)'}\n`)
