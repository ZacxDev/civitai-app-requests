import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
} from 'react';

import {
  useBlockAnalytics,
  useBlockBreakpoint,
  useBlockContext,
  useBlockResize,
  useRequestSignIn,
  useSharedStorage,
  type SharedAppendValue,
  type SharedListItem,
} from '@civitai/blocks-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Textarea,
  TextInput,
  injectBlocksStyles,
} from '@civitai/blocks-react/ui';
import { ToastProvider, injectStyles, useToast } from '@civitai/components-react';

import { paletteCssVars } from './brand.js';
import { bootThemeGuess } from './bootTheme.js';
import {
  horizonModeFor,
  horizonNote,
  PAGE_SIZE,
  TOP_SCAN_MAX_PAGES,
} from './disclosure.js';
import { classifyWriteError } from './errors.js';
import { RootBoundary } from './RootBoundary.js';
import {
  authorLabel,
  BODY_MAX,
  findSimilarRequests,
  isOverLimit,
  isOwnEntry,
  isWellFormedItem,
  lengthHint,
  relativeTime,
  sortItems,
  TITLE_MAX,
  type SortMode,
} from './format.js';
import { boardLayout, type BoardLayout } from './layout.js';
import { entryMotionProps, useReducedMotion } from './motion.js';
import {
  buildSuppressionEntry,
  isOwner,
  OWNER_USER_ID,
  visibleRequests,
} from './moderation.js';
import { filterRequests } from './search.js';
import {
  cardStyle,
  contentStyle,
  metaText,
  mutedText,
  pageStyle,
  radius,
  tabularNums,
  token,
  wellStyle,
} from './theme.js';
import { EmptyState } from './components/EmptyState.js';
import { Hero } from './components/Hero.js';
import { OverflowMenu, type OverflowMenuItem } from './components/OverflowMenu.js';
import { SearchField } from './components/SearchField.js';
import { VoteButton } from './components/VoteButton.js';

/**
 * App Requests — a first-party Civitai App Block. A community voting board where
 * anyone posts an idea for a new app or feature and up-votes others'. Built on
 * the cross-user SHARED storage platform (`useSharedStorage`). No Buzz, no
 * generation.
 */
export function App() {
  const injectedRef = useRef(false);
  if (!injectedRef.current) {
    injectBlocksStyles();
    injectStyles();
    injectedRef.current = true;
  }

  const { track } = useBlockAnalytics();
  const onBoundaryError = useCallback(
    (error: Error, info: ErrorInfo) => {
      track('error_boundary', {
        message: error.message,
        componentStack: info.componentStack ?? undefined,
      });
    },
    [track],
  );

  return (
    <ToastProvider label="App Requests notifications">
      <RootBoundary onError={onBoundaryError}>
        <Board />
      </RootBoundary>
    </ToastProvider>
  );
}

function Board() {
  const { ready, viewer, theme } = useBlockContext();
  const shared = useSharedStorage();
  const { requestSignIn } = useRequestSignIn();
  const { track } = useBlockAnalytics();
  const toast = useToast();
  const reduced = useReducedMotion();

  // The host measures THIS element and resizes the iframe to match. Every panel
  // in this app grows the document rather than floating over it, so the observer
  // sees each expansion — see OverflowMenu's header note.
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  /**
   * The block's own WIDTH tier — a container query over `rootRef`, not a media
   * query over the viewport. `useBlockResize` above reports our HEIGHT to the
   * host; this reads back the width the host gave us. They are different
   * directions of the same conversation and both key on the same element.
   *
   * Everything that branches on width reads `layout`; see src/layout.ts for the
   * thresholds and for why each branch is gated on `measured`.
   */
  const layout = boardLayout(useBlockBreakpoint(rootRef));

  const viewerId = viewer?.id ?? null;
  const isAnon = ready && viewer == null;
  const owner = isOwner(viewerId);

  const [items, setItems] = useState<SharedListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // 🔴 TOP IS THE DEFAULT. The board's whole point is which ideas people want
  // most, so the ranked view is the primary object; "Newest" is the alternative.
  // The cost is that the bounded scan now runs on COLD BOOT rather than on a
  // toggle — mitigated below by painting page 1 immediately and continuing the
  // scan in the background, so first paint still costs exactly one round-trip.
  const [sort, setSort] = useState<SortMode>('top');
  const [scanning, setScanning] = useState(false);
  /** True when the server still has rows we never loaded — the horizon binds. */
  const [horizonBinds, setHorizonBinds] = useState(false);

  const [query, setQuery] = useState('');

  /**
   * The viewer's vote state, as an OVERRIDE over the server's truth.
   *
   * 🔴 THIS REPLACES THE OLD CLIENT-SIDE GUESS AND IS THE BUG FIX. The previous
   * version kept the set of voted keys in the per-viewer KV store and hydrated
   * from it. That store knows nothing about votes cast on another device, before
   * the store existed, or after it was cleared — so the button rendered
   * "not voted" for a row the viewer HAD voted on. The first click then called
   * the idempotent `vote()`, which changed nothing, and the viewer had to click
   * AGAIN to unvote: the "double-click to unvote" bug.
   *
   * The server now sends `viewerVoted` on every listed row, so that is the
   * source of truth. This map holds ONLY keys the viewer toggled in this
   * session; a rollback deletes the entry and the row falls back to server
   * truth, which is strictly better than restoring a snapshot.
   */
  const [voteOverride, setVoteOverride] = useState<Map<string, boolean>>(new Map());
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Key of the request the viewer just posted — pinned to the top regardless of
  // sort so a fresh 0-vote entry is immediately visible under "Top".
  const [justPostedKey, setJustPostedKey] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const isVoted = useCallback(
    (item: SharedListItem): boolean => {
      const override = voteOverride.get(item.key);
      return override !== undefined ? override : item.viewerVoted;
    },
    [voteOverride],
  );

  /**
   * Page forward from `startCursor`, collecting well-formed rows not already
   * seen, up to {@link TOP_SCAN_MAX_PAGES}. Malformed rows are dropped here so
   * one bad row can't poison the ranked window.
   */
  const pageForward = useCallback(
    async (startCursor: string | undefined, seenKeys: Set<string>) => {
      let cursor = startCursor;
      let pages = 0;
      const fetched: SharedListItem[] = [];
      while (cursor && pages < TOP_SCAN_MAX_PAGES) {
        const res = await shared.list({ limit: PAGE_SIZE, cursor });
        for (const it of res.items) {
          if (isWellFormedItem(it) && !seenKeys.has(it.key)) {
            seenKeys.add(it.key);
            fetched.push(it);
          }
        }
        cursor = res.nextCursor;
        pages += 1;
      }
      return { fetched, finalCursor: cursor };
    },
    [shared],
  );

  /**
   * Load the board.
   *
   * 🔴 FIRST PAINT COSTS ONE ROUND-TRIP, always. Page 1 lands in state and
   * `loading` clears before the scan continues, so making "Top" the default did
   * NOT move the deep scan onto the critical path. The scan then runs in the
   * background with a visible "ranking the whole board" status, and the ranking
   * settles a moment later. The alternative — awaiting the whole scan before the
   * first paint — would have cost up to nine sequential round-trips before
   * anything appeared.
   */
  const refreshList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await shared.list({ limit: PAGE_SIZE });
      const firstPage = res.items.filter(isWellFormedItem);
      setItems(firstPage);
      setNextCursor(res.nextCursor);
      setHorizonBinds(Boolean(res.nextCursor));
      setLoading(false);

      if (res.nextCursor) {
        setScanning(true);
        try {
          const seen = new Set(firstPage.map((i) => i.key));
          const { fetched, finalCursor } = await pageForward(res.nextCursor, seen);
          if (fetched.length > 0) {
            setItems((prev) => {
              const known = new Set(prev.map((i) => i.key));
              return [...prev, ...fetched.filter((i) => !known.has(i.key))];
            });
          }
          setNextCursor(finalCursor);
          setHorizonBinds(Boolean(finalCursor));
        } finally {
          setScanning(false);
        }
      }
    } catch (err) {
      setListError(classifyWriteError(err).message);
      setLoading(false);
      setScanning(false);
    }
  }, [shared, pageForward]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { fetched, finalCursor } = await pageForward(
        nextCursor,
        new Set(items.map((i) => i.key)),
      );
      if (fetched.length > 0) setItems((prev) => [...prev, ...fetched]);
      setNextCursor(finalCursor);
      setHorizonBinds(Boolean(finalCursor));
    } catch (err) {
      setListError(classifyWriteError(err).message);
    } finally {
      setLoadingMore(false);
    }
  }, [pageForward, nextCursor, loadingMore, items]);

  // Initial load once the host context is ready.
  useEffect(() => {
    if (!ready) return;
    void refreshList();
  }, [ready, refreshList]);

  const setCount = useCallback((key: string, count: number) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, count } : i)));
  }, []);

  const showActionError = useCallback(
    (err: unknown) => {
      toast.show({ message: classifyWriteError(err).message, color: 'error', urgent: true });
    },
    [toast],
  );

  /**
   * Toggle the viewer's up-vote. Optimistic with rollback: the override and the
   * count flip immediately, then reconcile with what `vote()`/`unvote()` return.
   * On failure the override is DELETED (falling back to the server's
   * `viewerVoted`) and the count is restored — a visible rollback plus a toast.
   */
  const toggleVote = useCallback(
    async (item: SharedListItem) => {
      if (isAnon) {
        requestSignIn();
        return;
      }
      const key = item.key;
      if (pending.has(key)) return;

      const wasVoted = isVoted(item);
      const prevCount = item.count;

      setPending((p) => new Set(p).add(key));
      setVoteOverride((prev) => new Map(prev).set(key, !wasVoted));
      setCount(key, Math.max(0, prevCount + (wasVoted ? -1 : 1)));

      try {
        const newCount = wasVoted ? await shared.unvote(key) : await shared.vote(key);
        setCount(key, newCount);
        track(wasVoted ? 'request_unvoted' : 'request_voted', { key });
      } catch (err) {
        setCount(key, prevCount);
        setVoteOverride((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        showActionError(err);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    },
    [isAnon, requestSignIn, pending, isVoted, shared, setCount, track, showActionError],
  );

  const withdraw = useCallback(
    async (item: SharedListItem) => {
      if (pending.has(item.key)) return;
      setPending((p) => new Set(p).add(item.key));
      try {
        await shared.withdraw(item.key);
        setItems((prev) => prev.filter((i) => i.key !== item.key));
        setVoteOverride((prev) => {
          if (!prev.has(item.key)) return prev;
          const next = new Map(prev);
          next.delete(item.key);
          return next;
        });
        track('request_withdrawn', { key: item.key });
      } catch (err) {
        showActionError(err);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(item.key);
          return next;
        });
      }
    },
    [pending, shared, track, showActionError],
  );

  /**
   * File a platform report against a row. Available to any signed-in viewer.
   *
   * 🔴 This does NOT hide the row and the copy must never suggest it does — the
   * contract is explicit that a moderator decides.
   */
  const report = useCallback(
    async (item: SharedListItem) => {
      try {
        await shared.report(item.key);
        track('request_reported', { key: item.key });
        toast.show({
          message: 'Reported to Civitai moderators. The request stays on the board until they review it.',
          color: 'info',
        });
      } catch (err) {
        showActionError(err);
      }
    },
    [shared, track, toast, showActionError],
  );

  /**
   * Owner-only SUPPRESSION — hide a row from this board.
   *
   * 🔴 THIS IS NOT DELETION and the platform offers no owner delete. It appends
   * an owner-authored ledger entry that every client honours by filtering the
   * target out. The request, its text and its votes remain on the server. See
   * `src/moderation.ts`.
   */
  const suppress = useCallback(
    async (item: SharedListItem) => {
      if (pending.has(item.key)) return;
      setPending((p) => new Set(p).add(item.key));
      try {
        await shared.append(buildSuppressionEntry(item.key));
        track('request_suppressed', { key: item.key });
        toast.show({
          message: 'Hidden from the board. The request still exists on the server — this is a hide, not a delete.',
          color: 'info',
        });
        await refreshList();
      } catch (err) {
        showActionError(err);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(item.key);
          return next;
        });
      }
    },
    [pending, shared, track, toast, refreshList, showActionError],
  );

  const editRequest = useCallback(
    async (item: SharedListItem, next: { title: string; body?: string }): Promise<boolean> => {
      const title = next.title.trim();
      const body = next.body && next.body.trim() ? next.body.trim() : undefined;
      const value: SharedAppendValue = {
        title,
        ...(body ? { body } : {}),
        ...(item.value.data !== undefined ? { data: item.value.data } : {}),
      };
      try {
        await shared.update(item.key, value);
        setItems((prev) =>
          prev.map((i) =>
            i.key === item.key
              ? { ...i, value: { ...i.value, title, body }, updatedAt: new Date() }
              : i,
          ),
        );
        track('request_edited', { key: item.key });
        return true;
      } catch (err) {
        showActionError(err);
        return false;
      }
    },
    [shared, track, showActionError],
  );

  const onSubmitted = useCallback(
    async (posted: { key: string; title: string; body?: string }) => {
      setJustPostedKey(posted.key);
      setComposerOpen(false);
      setQuery(''); // a fresh post must not land behind an active filter
      track('request_submitted', { key: posted.key });
      if (viewerId != null) {
        const now = new Date();
        const optimistic: SharedListItem = {
          key: posted.key,
          authorUserId: viewerId,
          value: { title: posted.title, body: posted.body },
          count: 0,
          createdAt: now,
          updatedAt: now,
          viewerVoted: false,
        };
        setItems((prev) =>
          prev.some((i) => i.key === optimistic.key) ? prev : [optimistic, ...prev],
        );
      }
      await refreshList();
    },
    [refreshList, viewerId, track],
  );

  const handleSortChange = useCallback(
    (s: SortMode) => {
      setJustPostedKey(null);
      setSort(s);
      track('sort_changed', { sort: s });
    },
    [track],
  );

  // ---- derived board ----

  /** Ledger entries removed, owner-suppressed rows hidden. Never rendered raw. */
  const visible = useMemo(() => visibleRequests(items, OWNER_USER_ID), [items]);

  const ordered = useMemo(() => {
    const base = sortItems(visible, sort);
    if (!justPostedKey) return base;
    const idx = base.findIndex((i) => i.key === justPostedKey);
    if (idx <= 0) return base;
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
  }, [visible, sort, justPostedKey]);

  const shown = useMemo(() => filterRequests(query, ordered), [query, ordered]);

  const searching = query.trim().length > 0;
  const horizonMode = horizonModeFor(sort, searching);
  const note = horizonMode
    ? horizonNote({ mode: horizonMode, loaded: visible.length, partial: horizonBinds })
    : null;

  const resultSummary = searching
    ? `${shown.length} of ${visible.length} loaded request${visible.length === 1 ? '' : 's'}`
    : '';

  /**
   * 🔴 `theme` FROM THE SDK IS A SENTINEL UNTIL `ready`.
   *
   * The pre-init snapshot hardcodes `theme: 'light'` for every viewer
   * (`@civitai/blocks-react` → `dist/internal/transport.js`, `EMPTY_SNAPSHOT`),
   * and this component renders before BLOCK_INIT arrives. Painting that value
   * would put a LIGHT first commit between index.html's DARK skeleton and the
   * host's real theme: dark → light → dark, newly visible now that
   * `bootSkeleton: true` has stood down the host's veil.
   *
   * So before `ready` we paint whatever the boot script already painted with —
   * read back off `<html>`, not re-derived. AFTER `ready` this is exactly the
   * old expression: the host's theme wins, unconditionally.
   */
  const paintTheme = ready ? theme : bootThemeGuess();

  const rootStyle: CSSProperties = {
    ...pageStyle,
    ...(paletteCssVars(paintTheme) as CSSProperties),
  };

  return (
    <div
      ref={rootRef}
      data-app="app-requests"
      data-theme={paintTheme}
      data-testid="app-root"
      // Machine-readable evidence of what the block resolved its own width to.
      // Not decoration: a capture or a bug report taken at the wrong tier is the
      // hardest kind to read, and this puts the answer in the DOM.
      data-tier={layout.tier}
      data-measured={layout.measured ? 'true' : 'false'}
      style={rootStyle}
    >
      <div style={contentStyle}>
        <Stack gap={18}>
          <Hero
            title="App Requests"
            tagline="Ask. Vote. Watch it get built."
            actionLayout={layout.heroAction}
            action={
              isAnon ? (
                <Button color="primary" onClick={() => requestSignIn()} data-testid="signin-btn">
                  Sign in
                </Button>
              ) : (
                // SECONDARY by design: the board is the object, posting is the
                // side action. A primary "add" button teaches people the list
                // beneath it is the unimportant part.
                <Button
                  variant="light"
                  color="primary"
                  // Below `sm` the CTA owns its own line, so a stretched target
                  // is the honest shape — a 120px button floating in a
                  // full-width plate reads as unfinished.
                  fullWidth={layout.heroAction === 'block'}
                  onClick={() => {
                    setComposerOpen(true);
                    track('composer_opened', {});
                  }}
                  disabled={!ready}
                  data-testid="open-composer-btn"
                >
                  Request an app
                </Button>
              )
            }
          />

          {/*
            The toolbar is the capture recipe's READY ANCHOR (`board-ready`). It
            is mounted at every data condition — zero requests, many requests,
            signed in, signed out — and now, additionally, AT EVERY WIDTH TIER.
            🔴 That last clause is a hard constraint, not a nicety: the store
            capture gates the whole run on this testid being present at rest, so
            a tier that dropped it would time out at 45s reporting that the app
            never booted. Both layouts below render the SAME element with the
            same testid; only its flex direction changes.
            See <datapacket-talos>/.claude/skills/app-capture/scripts/recipes/app-requests.json.
          */}
          <Group
            justify="space-between"
            align={layout.toolbar === 'stacked' ? 'stretch' : 'flex-start'}
            gap={12}
            wrap
            data-testid="board-ready"
            data-layout={layout.toolbar}
            style={layout.toolbar === 'stacked' ? { flexDirection: 'column' } : undefined}
          >
            {visible.length > 0 && (
              // 🔴 `toolbar` is not decoration — the field's flex basis is
              // axis-relative and this container's axis is what `layout.toolbar`
              // decides. The two must move together or the basis becomes a
              // height. See SearchField's `toolbar` prop.
              <SearchField
                value={query}
                onChange={setQuery}
                resultSummary={resultSummary}
                toolbar={layout.toolbar}
              />
            )}
            <Group
              gap={10}
              align="center"
              wrap={false}
              style={layout.toolbar === 'stacked' ? { width: '100%' } : undefined}
            >
              {visible.length > 0 && (
                <Badge variant="light" color="primary" size="lg" data-testid="request-count">
                  {visible.length.toLocaleString()}
                </Badge>
              )}
              {/*
                Stacked, the switcher takes the rest of its row — two fat,
                equal-width targets instead of two squeezed ones. `minWidth: 0`
                is what lets it actually shrink inside the flex row.
              */}
              <div style={layout.sortFullWidth ? { flex: '1 1 auto', minWidth: 0 } : undefined}>
                <SortToggle
                  sort={sort}
                  onChange={handleSortChange}
                  fullWidth={layout.sortFullWidth}
                />
              </div>
            </Group>
          </Group>

          {note && (
            <span style={noteStyle} role="note" data-testid="horizon-note">
              {note}
            </span>
          )}

          {scanning && (
            <Group gap={8} align="center" role="status" aria-live="polite" data-testid="scanning">
              <Loader size="sm" />
              <span style={metaText}>Ranking the whole board…</span>
            </Group>
          )}

          {loading ? (
            <Group gap={10} align="center" role="status" aria-live="polite" data-testid="app-loading">
              <Loader size="sm" />
              <span style={mutedText}>Loading requests…</span>
            </Group>
          ) : listError ? (
            <Alert color="error" title="Couldn't load requests">
              {listError}
              <div style={{ marginTop: 10 }}>
                <Button size="sm" variant="light" onClick={() => void refreshList()} data-testid="list-retry">
                  Retry
                </Button>
              </div>
            </Alert>
          ) : visible.length === 0 ? (
            <EmptyState
              data-testid="empty-state"
              icon="▲"
              title="No requests yet"
              body={
                isAnon
                  ? 'Sign in to be the first to ask for an app or feature.'
                  : 'Be the first to ask for an app or feature.'
              }
              action={
                isAnon ? (
                  <Button color="primary" onClick={() => requestSignIn()} data-testid="empty-signin">
                    Sign in
                  </Button>
                ) : (
                  <Button color="primary" onClick={() => setComposerOpen(true)} data-testid="empty-suggest">
                    Request an app
                  </Button>
                )
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              data-testid="no-matches"
              icon="⌕"
              title="No matches"
              body={
                // 🔴 Never "no such request exists" — the search only saw the
                // rows that were loaded, and this says which.
                horizonBinds
                  ? `Nothing in the ${visible.length} requests loaded so far matches “${query.trim()}”. There are more on the server.`
                  : `Nothing in the ${visible.length} requests on the board matches “${query.trim()}”.`
              }
              action={
                <Group gap={8} justify="center" wrap>
                  <Button variant="light" onClick={() => setQuery('')} data-testid="clear-search-btn">
                    Clear search
                  </Button>
                  {horizonBinds && nextCursor && (
                    // The constructive way past the horizon: pull the next window
                    // and re-run the same filter over it.
                    <Button
                      variant="subtle"
                      loading={loadingMore}
                      onClick={() => void loadMore()}
                      data-testid="search-load-more"
                    >
                      Load more and search again
                    </Button>
                  )}
                </Group>
              }
            />
          ) : (
            <Stack gap={10}>
              {shown.map((item) => (
                <RequestRow
                  key={item.key}
                  item={item}
                  layout={layout.row}
                  viewerId={viewerId}
                  isAnon={isAnon}
                  owner={owner}
                  voted={isVoted(item)}
                  busy={pending.has(item.key)}
                  reduced={reduced}
                  onVote={() => void toggleVote(item)}
                  onWithdraw={() => void withdraw(item)}
                  onReport={() => void report(item)}
                  onSuppress={() => void suppress(item)}
                  onEdit={(next) => editRequest(item, next)}
                />
              ))}
              {nextCursor && !searching && (
                <Group justify="center">
                  <Button
                    variant="subtle"
                    loading={loadingMore}
                    onClick={() => void loadMore()}
                    data-testid="load-more"
                  >
                    Load more
                  </Button>
                </Group>
              )}
            </Stack>
          )}
        </Stack>
      </div>

      <Modal
        opened={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Request an app"
        size="md"
      >
        <SubmitForm disabled={!ready} shared={shared} items={visible} onSubmitted={onSubmitted} />
      </Modal>
    </div>
  );
}

/** The submit form. Owns its own draft + submit lifecycle. */
function SubmitForm({
  disabled,
  shared,
  items,
  onSubmitted,
}: {
  disabled: boolean;
  shared: ReturnType<typeof useSharedStorage>;
  /** The already-loaded board — read (never mutated) for the duplicate nudge. */
  items: SharedListItem[];
  onSubmitted: (posted: { key: string; title: string; body?: string }) => Promise<void> | void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleOver = isOverLimit(title, TITLE_MAX);
  const bodyOver = isOverLimit(body, BODY_MAX);
  const canSubmit = !disabled && !submitting && trimmedTitle.length > 0 && !titleOver && !bodyOver;

  // A SOFT, non-blocking nudge: if the draft title looks like an already-posted
  // request, surface the top matches so the poster can up-vote the existing idea
  // instead of splitting the vote across a near-duplicate.
  const similar = useMemo(() => findSimilarRequests(title, items, 3), [title, items]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedBody = body.trim() ? body.trim() : undefined;
      const { key } = await shared.append({ title: trimmedTitle, body: trimmedBody });
      setTitle('');
      setBody('');
      await onSubmitted({ key, title: trimmedTitle, body: trimmedBody });
    } catch (err) {
      setError(classifyWriteError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Stack gap={12}>
        <div>
          <TextInput
            label="What should we build?"
            placeholder="e.g. A prompt-library app with tags"
            value={title}
            maxLength={TITLE_MAX + 40 /* let the server be the hard gate; warn softly */}
            onChange={(e) => {
              setTitle(e.currentTarget.value);
              if (error) setError(null);
            }}
            error={titleOver ? `Title must be ${TITLE_MAX} characters or fewer` : undefined}
            data-testid="title-input"
          />
          <div style={hintRowStyle}>
            <span style={titleOver ? hintOverStyle : hintStyle}>{lengthHint(title, TITLE_MAX)}</span>
          </div>
        </div>
        <div>
          <Textarea
            label="Details (optional)"
            placeholder="What should it do? Who's it for?"
            value={body}
            rows={4}
            onChange={(e) => {
              setBody(e.currentTarget.value);
              if (error) setError(null);
            }}
            error={bodyOver ? `Details must be ${BODY_MAX} characters or fewer` : undefined}
            data-testid="body-input"
          />
          <div style={hintRowStyle}>
            <span style={bodyOver ? hintOverStyle : hintStyle}>{lengthHint(body, BODY_MAX)}</span>
          </div>
        </div>

        {similar.length > 0 && (
          <Alert color="info" title="Already asked?" data-testid="similar-nudge">
            <span style={mutedText}>Up-voting an existing idea lifts it faster than a near-duplicate:</span>
            <ul style={similarListStyle}>
              {similar.map((it) => (
                <li key={it.key} style={requestTitleStyle} data-testid="similar-item">
                  {it.value.title}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div aria-live="polite">
          {error && (
            <Alert color="warning" title="Couldn't post that">
              {error}
            </Alert>
          )}
        </div>

        <Group justify="flex-end">
          <Button
            type="submit"
            color="primary"
            loading={submitting}
            disabled={!canSubmit}
            data-testid="submit-btn"
          >
            Post request
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * One request row: vote pill + title/body + meta + an overflow menu of actions.
 *
 * TWO ARRANGEMENTS OF THE SAME PARTS, and that is the whole of it — every
 * element, every testid and every handler is identical in both:
 *
 *   `regular` (≥ 480px)  [ ▲12 ]  Title / body / meta          [ ⋯ ]
 *   `compact` (< 480px)  Title / body                          [ ⋯ ]
 *                        [ ▲12 ]  meta
 *
 * The left rail costs the title ~90px, which a 360px slot does not have to
 * spare. Moving the pill down rather than shrinking it keeps the vote target at
 * full size, which is the control that matters most on a phone.
 */
function RequestRow({
  item,
  layout,
  viewerId,
  isAnon,
  owner,
  voted,
  busy,
  reduced,
  onVote,
  onWithdraw,
  onReport,
  onSuppress,
  onEdit,
}: {
  item: SharedListItem;
  layout: BoardLayout['row'];
  viewerId: number | null;
  isAnon: boolean;
  owner: boolean;
  voted: boolean;
  busy: boolean;
  reduced: boolean;
  onVote: () => void;
  onWithdraw: () => void;
  onReport: () => void;
  onSuppress: () => void;
  onEdit: (next: { title: string; body?: string }) => Promise<boolean>;
}) {
  const own = isOwnEntry(item.authorUserId, viewerId);
  const [editing, setEditing] = useState(false);
  // Withdraw removes the post AND its votes with no undo, so it is gated behind
  // an explicit confirm that names the vote count.
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  // Suppression is reversible only by an owner edit to the ledger, and it hides
  // someone else's content — also confirmed, with copy that says "hide".
  const [confirmingSuppress, setConfirmingSuppress] = useState(false);
  const entry = entryMotionProps('ar-row-in', 'list', reduced);

  const menuItems: OverflowMenuItem[] = [];
  if (own) {
    menuItems.push({
      id: 'edit',
      label: 'Edit request',
      icon: '✎',
      onSelect: () => setEditing(true),
      'data-testid': 'edit-btn',
    });
    menuItems.push({
      id: 'withdraw',
      label: 'Withdraw request',
      icon: '⌫',
      destructive: true,
      onSelect: () => setConfirmingWithdraw(true),
      'data-testid': 'withdraw-btn',
    });
  } else {
    menuItems.push({
      id: 'report',
      label: 'Report to moderators',
      icon: '⚐',
      onSelect: onReport,
      'data-testid': 'report-btn',
    });
  }
  if (owner && !own) {
    menuItems.push({
      id: 'suppress',
      // "Hide", never "Delete" — the row survives on the server.
      label: 'Hide from board',
      icon: '⊘',
      destructive: true,
      onSelect: () => setConfirmingSuppress(true),
      'data-testid': 'suppress-btn',
    });
  }

  // ---- the parts, composed once and arranged twice ----

  const vote = <VoteButton count={item.count} voted={voted} busy={busy} onClick={onVote} />;

  const meta = (
    <Group gap={8} align="center" wrap>
      <span style={metaText}>{authorLabel(item.authorUserId, viewerId)}</span>
      <span style={metaDotStyle} aria-hidden>
        ·
      </span>
      <span style={metaText}>{relativeTime(item.createdAt)}</span>
    </Group>
  );

  const editForm = (
    <EditForm
      item={item}
      onCancel={() => setEditing(false)}
      onSave={async (next) => {
        const ok = await onEdit(next);
        if (ok) setEditing(false);
        return ok;
      }}
    />
  );

  const titleBlock = (
    <>
      <span style={requestTitleStyle}>{item.value.title}</span>
      {item.value.body && <p style={requestBodyStyle}>{item.value.body}</p>}
    </>
  );

  // Signed-out viewers get NO menu: every item in it is a mutation the platform
  // will reject for them, and offering an affordance that can only produce an
  // error is worse than offering nothing.
  const menu =
    !isAnon && !editing && menuItems.length > 0 ? (
      <OverflowMenu
        label={`More actions for “${item.value.title}”`}
        items={menuItems}
        data-testid="row-menu"
      />
    ) : null;

  const compact = layout === 'compact';

  return (
    <Card
      padding="md"
      style={{ ...cardStyle, animation: entry.animation }}
      data-motion={entry['data-motion']}
      data-testid="request-row"
      data-layout={layout}
      data-key={item.key}
    >
      {compact ? (
        <Stack gap={10}>
          <Group gap={10} align="flex-start" wrap={false}>
            <Stack gap={6} style={{ flex: '1 1 auto', minWidth: 0 }}>
              {editing ? editForm : titleBlock}
            </Stack>
            {menu}
          </Group>
          {/*
            The pill stays mounted while editing, exactly as the left rail does
            in the regular arrangement — the two layouts must differ in
            ARRANGEMENT only, never in which controls exist.
          */}
          <Group gap={10} align="center" wrap>
            {vote}
            {!editing && meta}
          </Group>
        </Stack>
      ) : (
        <Group gap={14} align="flex-start" wrap={false}>
          {vote}

          <Stack gap={6} style={{ flex: '1 1 260px', minWidth: 0 }}>
            {editing ? (
              editForm
            ) : (
              <>
                {titleBlock}
                {meta}
              </>
            )}
          </Stack>

          {menu}
        </Group>
      )}

      <Modal
        opened={confirmingWithdraw}
        onClose={() => setConfirmingWithdraw(false)}
        title="Withdraw this request?"
        size="sm"
      >
        <Stack gap={16} data-testid="withdraw-confirm">
          <p style={{ ...mutedText, margin: 0 }}>
            It and its{' '}
            <strong style={{ color: token.text }}>
              {item.count} vote{item.count === 1 ? '' : 's'}
            </strong>{' '}
            will be permanently removed. This can’t be undone.
          </p>
          <Group justify="flex-end" gap={8}>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setConfirmingWithdraw(false)}
              disabled={busy}
              data-testid="withdraw-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              color="error"
              loading={busy}
              onClick={() => {
                setConfirmingWithdraw(false);
                onWithdraw();
              }}
              data-testid="withdraw-confirm-btn"
            >
              Withdraw
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={confirmingSuppress}
        onClose={() => setConfirmingSuppress(false)}
        title="Hide this request from the board?"
        size="sm"
      >
        <Stack gap={16} data-testid="suppress-confirm">
          {/*
            🔴 This copy is load-bearing. The platform gives an app owner NO
            delete: the row, its text and its votes stay on the server and this
            only stops clients rendering it. Saying "delete" here would be a
            promise the app cannot keep.
          */}
          <p style={{ ...mutedText, margin: 0 }}>
            It stops showing on this board for everyone. It is{' '}
            <strong style={{ color: token.text }}>not deleted</strong> — the request and its{' '}
            {item.count} vote{item.count === 1 ? '' : 's'} remain stored on Civitai. To have content
            removed, report it to moderators instead.
          </p>
          <Group justify="flex-end" gap={8}>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setConfirmingSuppress(false)}
              disabled={busy}
              data-testid="suppress-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              color="error"
              loading={busy}
              onClick={() => {
                setConfirmingSuppress(false);
                onSuppress();
              }}
              data-testid="suppress-confirm-btn"
            >
              Hide
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

/** Inline edit form for the author's own request. */
function EditForm({
  item,
  onCancel,
  onSave,
}: {
  item: SharedListItem;
  onCancel: () => void;
  onSave: (next: { title: string; body?: string }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(item.value.title);
  const [body, setBody] = useState(item.value.body ?? '');
  const [saving, setSaving] = useState(false);

  const trimmedTitle = title.trim();
  const titleOver = isOverLimit(title, TITLE_MAX);
  const bodyOver = isOverLimit(body, BODY_MAX);
  const canSave = !saving && trimmedTitle.length > 0 && !titleOver && !bodyOver;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ title, body: body.trim() ? body : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={8} data-testid="edit-form">
      <TextInput
        label="Title"
        value={title}
        maxLength={TITLE_MAX + 40}
        onChange={(e) => setTitle(e.currentTarget.value)}
        error={titleOver ? `Title must be ${TITLE_MAX} characters or fewer` : undefined}
        data-testid="edit-title-input"
      />
      <Textarea
        label="Details (optional)"
        value={body}
        rows={3}
        onChange={(e) => setBody(e.currentTarget.value)}
        error={bodyOver ? `Details must be ${BODY_MAX} characters or fewer` : undefined}
        data-testid="edit-body-input"
      />
      <Group justify="flex-end" gap={8}>
        <Button size="sm" variant="subtle" onClick={onCancel} disabled={saving} data-testid="edit-cancel-btn">
          Cancel
        </Button>
        <Button
          size="sm"
          color="primary"
          loading={saving}
          disabled={!canSave}
          onClick={() => void save()}
          data-testid="edit-save-btn"
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}

function SortToggle({
  sort,
  onChange,
  fullWidth = false,
}: {
  sort: SortMode;
  onChange: (s: SortMode) => void;
  fullWidth?: boolean;
}) {
  // SegmentedControl gives role="tablist" + role="tab" + aria-selected + roving
  // ArrowLeft/Right for free.
  //
  // 🔴 `data` stays a two-item array at EVERY tier. The capture recipe drives
  // this control by ordinal — `[data-testid=sort-control] button:nth-of-type(1)`
  // and `(2)` — so collapsing it to a menu, or hiding a segment on a narrow
  // slot, would break both of the store's board states.
  return (
    <SegmentedControl
      aria-label="Sort requests"
      size="sm"
      fullWidth={fullWidth}
      value={sort}
      onChange={(v) => onChange(v as SortMode)}
      data-testid="sort-control"
      data={[
        { value: 'top', label: 'Top' },
        { value: 'newest', label: 'Newest' },
      ]}
    />
  );
}

// ---- styles (app-owned tokens via ./theme; see brand.ts for the palette) ----

const hintRowStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: 4 };
const hintStyle: CSSProperties = { ...metaText, ...tabularNums };
const hintOverStyle: CSSProperties = { ...hintStyle, color: token.error, fontWeight: 600 };
const requestTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  lineHeight: 1.35,
  color: token.text,
  wordBreak: 'break-word',
};
const requestBodyStyle: CSSProperties = {
  ...mutedText,
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const metaDotStyle: CSSProperties = { color: token.dimmed };
const noteStyle: CSSProperties = {
  ...metaText,
  ...wellStyle,
  display: 'block',
  padding: '8px 12px',
  borderRadius: radius.sm,
};
const similarListStyle: CSSProperties = {
  margin: '6px 0 0',
  paddingInlineStart: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};
