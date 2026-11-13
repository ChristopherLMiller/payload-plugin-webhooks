import { MongoBinary } from 'mongodb-memory-server'

/**
 * Download the MongoDB binary once, before test files start in parallel workers.
 * Otherwise every worker downloads it at the same time on a cold machine (e.g. CI), and
 * mongodb-memory-server's download lock can fail with UnableToUnlockLockfileError.
 */
export default async function setup(): Promise<void> {
  await MongoBinary.getPath()
}
