/**
 * Desktop-side entry point for the sync protocol. The implementation lives in
 * shared/sync-protocol.ts so the mobile PWA uses the exact same wire code —
 * see the note there. This file exists to keep `$lib/data/sync/sync-client`
 * working as an import path.
 */

export {
  SYNC_ENDPOINT,
  SyncError,
  flattenRemote,
  generateDeviceId,
  generateToken,
  isValidToken,
  pullState,
  pushDelta,
  type DayClients,
  type PushPayload,
  type RemoteState
} from '../../../../shared/sync-protocol';
