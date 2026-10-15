// The app's platform seam.
//
// Everything the board needs from the Civitai platform comes through here, and
// only this directory imports `@civitai/sdk`. That is the point: the board's
// 1,300 lines are written against these names, so moving transports again means
// changing this directory, not the board.
//
// What lives behind it:
//   - `hooks.ts`         the hooks the board calls, over the SDK
//   - `requests.ts`      the board's data layer, over the document store's `requests` collection
//   - `breakpoint.ts`    the block's own width tier (a container query)
//   - `BlockGate.tsx`    the "Open on Civitai" landing when there is no host
//   - `client.ts`        the one `initialize()` handshake, shared

export {
  getClient,
  getDocumentStorage,
  requestGrants,
  __configurePlatform,
  type PlatformOverrides,
} from './client.js';
export {
  createRequestStore,
  PUBLISH_SCOPE,
  REPORT_MARK,
  REQUESTS_COLLECTION,
  SORT_PARAM,
  toRequestItem,
  VOTE_MARK,
} from './requests.js';
export {
  useBlockAnalytics,
  useBlockContext,
  useBlockResize,
  useRequestSignIn,
  useRequestStore,
  type BlockContextValue,
} from './hooks.js';
export {
  resolveBlockTier,
  useBlockBreakpoint,
  type BlockBreakpoint,
  type BlockSizeTier,
  type BreakpointKey,
} from './breakpoint.js';
export {
  BlockGate,
  DirectLoadFallback,
  hostToRunUrl,
  useDirectLoad,
  type BlockGateProps,
} from './BlockGate.js';
export type {
  RequestItem,
  RequestPage,
  RequestStore,
  RequestValue,
  SortMode,
  Theme,
  Viewer,
} from './types.js';
