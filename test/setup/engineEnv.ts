import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { setEngineEnv } from '../../src/main/env'

// Every unit test runs against an explicit engine env: the repo's resources and
// a per-worker userData (the old electron mock's layout, so per-worker isolation
// is unchanged). Before M1 the engine silently fell back to cwd paths here.
const root = join(tmpdir(), `filesmith-test-userdata-${process.pid}`)
setEngineEnv({
  userData: join(root, 'userData'),
  resourcesDir: resolve(__dirname, '..', '..', 'resources'),
  downloadsDir: join(root, 'downloads'),
  fetch: (url, init) => fetch(url, init),
  host: 'app'
})
