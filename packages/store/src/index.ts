export {
  MIGRATIONS_PATH,
  openDb,
  openMigratedDb,
  runMigrations,
  STORE_PATH,
  StoreDb,
  StoreDbLive,
  StoreDbTest,
  tryDb,
} from "./db";
export type { Db } from "./db";
export {
  deleteEmailsByIds,
  getEmailIdsSince,
  getSyncCursor,
  latestSyncRun,
  latestSyncRunAttempt,
  recordSyncRun,
  setEmailUnread,
  setSyncCursor,
  upcomingUnreadThreads,
  upsertEmails,
} from "./queries";
export type { SyncRunInput, UnreadThread } from "./queries";
export { emails, syncCursor, syncRuns } from "./schema";
