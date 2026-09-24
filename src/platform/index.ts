// The app's platform seam.
//
// Everything the board needs from the Civitai platform comes through here, and
// only this directory imports `@civitai/sdk`. That is the point: the board's
// 1,300 lines are written against these names, so moving transports again means
// changing this directory, not the board.
//
// What lives behind it:
//   - `hooks.ts`         the hooks the board calls, over the SDK
//   - `sharedStorage.ts` the board's data layer, over `/api/v1/blocks/shared-storage/*`
//   - `breakpoint.ts`    the block's own width tier (a container query)
//   - `BlockGate.tsx`    the "Open on Civitai" landing when there is no host
//   - `client.ts`        the one `initialize()` handshake, shared

export { getClient, __configurePlatform, type PlatformOverrides } from './client.js';
export { createSharedStorage } from './sharedStorage.js';
export {
  useBlockAnalytics,
  useBlockContext,
  useBlockResize,
  useRequestSignIn,
  useSharedStorage,
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
  SharedAppendValue,
  SharedListItem,
  SharedListResult,
  SharedStorage,
  Theme,
  Viewer,
} from './types.js';
