/**
 * Mobile-side entry point for the sync protocol. The implementation lives in
 * the repo's shared/sync-protocol.ts, which the desktop app imports too — this
 * used to be a hand-maintained twin and the two had already drifted apart.
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
} from '../../../shared/sync-protocol';
