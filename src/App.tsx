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
  useAppStorage,
  useBlockAnalytics,
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
  SegmentedControl,
  Stack,
  Textarea,
  TextInput,
  injectBlocksStyles,
} from '@civitai/blocks-react/ui';
// Toast lives in the design-system's components pack, not in blocks-react/ui —
// pulled in solely for the async-error surface (its provider renders an
// aria-live region for free). `injectStyles` themes it with the same
// `--civitai-color-*` tokens the /ui pack + @civitai/theme use.
import { ToastProvider, injectStyles, useToast } from '@civitai/components-react';

import { classifyWriteError } from './errors.js';
import { RootBoundary } from './RootBoundary.js';
import {
  authorLabel,
  BODY_MAX,
  isOverLimit,
  isOwnEntry,
  isWellFormedItem,
  lengthHint,
  relativeTime,
  sortItems,
  TITLE_MAX,
  type SortMode,
} from './format.js';
import {
  brandMarkStyle,
  cardStyle,
  contentStyle,
  metaText,
  mutedText,
  pageStyle,
  sectionTitle,
  tabularNums,
  token,
} from './theme.js';
import { EmptyState } from './components/EmptyState.js';
import { VoteButton } from './components/VoteButton.js';

// The per-viewer KV key under which we persist the SET of shared-entry keys this
// viewer has up-voted. The shared API is one-vote-per-user + server-enforced but
// does NOT tell a block "did I vote on this" — so we remember it locally (in the
// per-user App Storage KV) and reconcile the count with what vote()/unvote()
// return. Scoped to (block instance, viewer), so it's private to each viewer.
const VOTED_STORAGE_KEY = 'voted-request-keys';

// How many entries per list page.
const PAGE_SIZE = 25;

// The server's `list()` is newest-first only — there is NO server-side rank/order
// param (see the report's "Top ranking" note). To make "Top" HONEST across pages
// we bounded-scan the board when it's selected: page forward until the cursor is
// exhausted OR we've pulled this many pages, then rank the whole loaded window by
// vote count. For a community request board this ceiling comfortably covers the
// realistic board size; if it's ever exceeded we say so ("Top" note) instead of
// silently ranking only part of the board.
const TOP_SCAN_MAX_PAGES = 8;

/**
 * App Requests — a first-party Civitai App Block. A community voting board where
 * anyone submits an idea for a new app/feature and up-votes others'. Built
 * entirely on the cross-user SHARED storage platform (`useSharedStorage`) plus
 * the per-viewer KV (`useAppStorage`) for the local voted-set. No Buzz, no
 * generation — read + write + vote + edit only.
 *
 * The exported root wires the cross-cutting shells the board itself shouldn't
 * own: a {@link ToastProvider} (async-error surface + aria-live region) and a
 * recoverable {@link RootBoundary} so a malformed row can't white-screen the
 * iframe. {@link Board} is the app.
 */
export function App() {
  // Inject BOTH design-system style sheets once: the /ui pack (Card/Button/…)
  // and the components pack (Toast). Both are idempotent + resolve against the
  // same `--civitai-color-*` tokens `@civitai/theme` sets (see theme.ts).
  const injectedRef = useRef(false);
  if (!injectedRef.current) {
    injectBlocksStyles();
    injectStyles();
    injectedRef.current = true;
  }

  const { track } = useBlockAnalytics();
  const onBoundaryError = useCallback(
    (error: Error, info: ErrorInfo) => {
      // Fire-and-forget: surface the white-screen-averted event so a broken row
      // is visible in analytics rather than silently swallowed.
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
  const storage = useAppStorage();
  const { requestSignIn } = useRequestSignIn();
  const { track } = useBlockAnalytics();
  const toast = useToast();

  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // The submit form's wrapper — the empty-state "suggest one" action focuses the
  // first field inside it (DOM-scoped, so it's independent of pack ref-forwarding).
  const formRef = useRef<HTMLDivElement>(null);
  const focusForm = useCallback(() => {
    const el = formRef.current?.querySelector<HTMLElement>('input, textarea');
    el?.focus();
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const viewerId = viewer?.id ?? null;
  const isAnon = ready && viewer == null;

  // The board. `items` accumulates across "load more" pages (server order:
  // newest-first); `sort` re-orders client-side for display.
  const [items, setItems] = useState<SharedListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Default to Newest — an HONEST, server-truthful order. "Top" opts into a
  // bounded whole-board scan (below) so it isn't silently ranking one page.
  const [sort, setSort] = useState<SortMode>('newest');
  // True when a "Top" scan stopped at the page cap — i.e. the board is larger
  // than the scan window, so the ranking covers only the first N. Surfaced as a
  // note so "Top" is never silently partial.
  const [topPartial, setTopPartial] = useState(false);
  const [scanningTop, setScanningTop] = useState(false);

  // The latest sort, readable from the STABLE `refreshList` callback without
  // making it sort-dependent. A sort-dependent `refreshList` would change
  // identity on every toggle and re-fire the initial-load effect (which depends
  // on it) — re-hydrating + double-fetching. The ref sidesteps that.
  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Key of the request the viewer just posted this session — pinned to the top
  // of the board regardless of the active sort so it's immediately visible.
  // Cleared when the viewer picks an explicit sort.
  const [justPostedKey, setJustPostedKey] = useState<string | null>(null);

  // The viewer's own up-votes (keys), hydrated from App Storage. `pending` holds
  // keys with an in-flight vote toggle so a double-click can't double-count.
  const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  /**
   * Page forward from `startCursor`, collecting well-formed rows not already in
   * `seenKeys`, up to {@link TOP_SCAN_MAX_PAGES}. Returns the fetched rows + the
   * final cursor (defined ⇒ board is bigger than the scan window). Shared by the
   * on-toggle scan AND the post-refresh re-rank so both stay honest. Malformed
   * rows are dropped here so one bad row can't poison the ranked window.
   */
  const pageForwardForTop = useCallback(
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

  // Load a fresh first page of the board. Sort-aware (via `sortRef`): when "Top"
  // is active it re-ranks the WHOLE board (continues the bounded scan from
  // page-1's cursor) so a refresh — e.g. after a post — can't collapse the
  // ranking to one page while the note still claims a full-board rank. Malformed
  // rows are filtered before they reach state (one missing row, not a dead board).
  const refreshList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await shared.list({ limit: PAGE_SIZE });
      const firstPage = res.items.filter(isWellFormedItem);
      if (sortRef.current === 'top') {
        setScanningTop(true);
        const seen = new Set(firstPage.map((i) => i.key));
        const { fetched, finalCursor } = await pageForwardForTop(res.nextCursor, seen);
        setItems([...firstPage, ...fetched]);
        setNextCursor(finalCursor);
        setTopPartial(Boolean(finalCursor));
        setScanningTop(false);
      } else {
        setItems(firstPage);
        setNextCursor(res.nextCursor);
        setTopPartial(false); // the note can't outlive its data
      }
    } catch (err) {
      setListError(classifyWriteError(err).message);
      setScanningTop(false);
    } finally {
      setLoading(false);
    }
  }, [shared, pageForwardForTop]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await shared.list({ limit: PAGE_SIZE, cursor: nextCursor });
      setItems((prev) => {
        // De-dupe defensively on key (a concurrent append could shift a page),
        // and drop malformed rows so one bad row can't brick the board.
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...res.items.filter((i) => isWellFormedItem(i) && !seen.has(i.key))];
      });
      setNextCursor(res.nextCursor);
    } catch (err) {
      setListError(classifyWriteError(err).message);
    } finally {
      setLoadingMore(false);
    }
  }, [shared, nextCursor, loadingMore]);

  /**
   * Bounded whole-board scan for "Top". The server has no rank param, so to rank
   * across pages we page forward from the current cursor until it's exhausted or
   * we hit {@link TOP_SCAN_MAX_PAGES}. `sortItems(…, 'top')` then ranks the full
   * loaded window. Sets `topPartial` when we stopped at the cap (board bigger
   * than the scan window) so the UI can say the ranking is over the first N.
   */
  const scanBoardForTop = useCallback(async () => {
    setScanningTop(true);
    setListError(null);
    try {
      const seen = new Set(items.map((i) => i.key));
      const { fetched, finalCursor } = await pageForwardForTop(nextCursor, seen);
      if (fetched.length > 0) setItems((prev) => [...prev, ...fetched]);
      setNextCursor(finalCursor);
      setTopPartial(Boolean(finalCursor)); // still more pages beyond the cap
    } catch (err) {
      setListError(classifyWriteError(err).message);
    } finally {
      setScanningTop(false);
    }
  }, [pageForwardForTop, nextCursor, items]);

  // Initial load once the host context is ready: hydrate the voted-set from the
  // per-viewer KV (empty for anon), then fetch the board.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await storage.get<string[]>(VOTED_STORAGE_KEY);
        if (!cancelled && Array.isArray(stored)) setVotedKeys(new Set(stored));
      } catch {
        /* voted-set is best-effort; a read failure just means no highlights */
      }
      if (!cancelled) await refreshList();
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, storage, refreshList]);

  // Persist the voted-set to the per-viewer KV (best-effort; the count is the
  // source of truth server-side, this is just the local "which did I vote" hint).
  const persistVoted = useCallback(
    (next: Set<string>) => {
      void storage.set(VOTED_STORAGE_KEY, Array.from(next)).catch(() => {
        /* ignore — a failed persist just means the highlight won't survive reload */
      });
    },
    [storage],
  );

  const setCount = useCallback((key: string, count: number) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, count } : i)));
  }, []);

  // Surface an async ACTION error (vote/withdraw/edit) as a toast — the
  // ToastProvider host is an aria-live region, so it's announced. Inline form +
  // list errors keep their contextual <Alert>s.
  const showActionError = useCallback(
    (err: unknown) => {
      toast.show({ message: classifyWriteError(err).message, color: 'error', urgent: true });
    },
    [toast],
  );

  /**
   * Toggle the viewer's up-vote on an entry. Optimistic: flip the local vote
   * state + count immediately, then reconcile with the count vote()/unvote()
   * returns. A `pending` guard drops overlapping clicks so a double-click is a
   * single net request (one-vote-per-user is also server-enforced). Rolls back
   * + surfaces a friendly toast on failure (e.g. the min-trust gate).
   */
  const toggleVote = useCallback(
    async (item: SharedListItem) => {
      if (isAnon) {
        requestSignIn();
        return;
      }
      const key = item.key;
      if (pending.has(key)) return;

      const wasVoted = votedKeys.has(key);
      const prevCount = item.count;

      // Optimistic flip.
      setPending((p) => new Set(p).add(key));
      setVotedKeys((prev) => {
        const next = new Set(prev);
        if (wasVoted) next.delete(key);
        else next.add(key);
        return next;
      });
      setCount(key, Math.max(0, prevCount + (wasVoted ? -1 : 1)));

      try {
        const newCount = wasVoted ? await shared.unvote(key) : await shared.vote(key);
        setCount(key, newCount);
        setVotedKeys((prev) => {
          const next = new Set(prev);
          if (wasVoted) next.delete(key);
          else next.add(key);
          persistVoted(next);
          return next;
        });
        track(wasVoted ? 'request_unvoted' : 'request_voted', { key });
      } catch (err) {
        // Roll back the optimistic flip.
        setCount(key, prevCount);
        setVotedKeys((prev) => {
          const next = new Set(prev);
          if (wasVoted) next.add(key);
          else next.delete(key);
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
    [isAnon, requestSignIn, pending, votedKeys, shared, setCount, persistVoted, track, showActionError],
  );

  const withdraw = useCallback(
    async (item: SharedListItem) => {
      if (pending.has(item.key)) return;
      setPending((p) => new Set(p).add(item.key));
      try {
        await shared.withdraw(item.key);
        setItems((prev) => prev.filter((i) => i.key !== item.key));
        setVotedKeys((prev) => {
          if (!prev.has(item.key)) return prev;
          const next = new Set(prev);
          next.delete(item.key);
          persistVoted(next);
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
    [pending, shared, persistVoted, track, showActionError],
  );

  /**
   * In-place edit of the viewer's OWN request via `shared.update()` — fixes the
   * old typo-forces-withdraw-and-repost flow that lost the entry's votes. Author-
   * scoped server-side; preserves the key + votes + any opaque `data` blob. Only
   * the moderated `{ title, body }` text changes (same content belt as append).
   * Returns whether the update landed so the row can exit edit mode on success.
   */
  const editRequest = useCallback(
    async (item: SharedListItem, next: { title: string; body?: string }): Promise<boolean> => {
      const title = next.title.trim();
      const body = next.body && next.body.trim() ? next.body.trim() : undefined;
      const value: SharedAppendValue = {
        title,
        ...(body ? { body } : {}),
        // Preserve the opaque app-owned payload if the row carried one.
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
      // Optimistically prepend the just-posted request so it renders instantly,
      // before the refetch round-trips. Pinned to the top (via `justPostedKey`)
      // so the active sort can't bury a fresh 0-vote entry. `refreshList()` is
      // the source of truth and supersedes this row (same host-minted key).
      setJustPostedKey(posted.key);
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
        };
        setItems((prev) =>
          prev.some((i) => i.key === optimistic.key) ? prev : [optimistic, ...prev],
        );
      }
      // Reconcile with the server (source of truth for count + ordering).
      await refreshList();
    },
    [refreshList, viewerId, track],
  );

  // Re-sort. Clears the just-posted pin (a deliberate re-sort), fires analytics,
  // and — for "Top" — kicks off the bounded whole-board scan so the ranking is
  // over the full board, not just the first page.
  const handleSortChange = useCallback(
    (s: SortMode) => {
      setJustPostedKey(null);
      setSort(s);
      track('sort_changed', { sort: s });
      if (s === 'top') void scanBoardForTop();
      else setTopPartial(false);
    },
    [track, scanBoardForTop],
  );

  const sorted = useMemo(() => {
    const base = sortItems(items, sort);
    if (!justPostedKey) return base;
    // Hoist the just-posted request to the very top so it's visible regardless
    // of the active sort (a 0-vote entry would otherwise fall below the fold
    // under "Top").
    const idx = base.findIndex((i) => i.key === justPostedKey);
    if (idx <= 0) return base;
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
  }, [items, sort, justPostedKey]);

  return (
    <div ref={rootRef} data-theme={theme} style={pageStyle}>
      <div style={contentStyle}>
        <Stack gap={20}>
          <Header count={items.length} />

          {isAnon ? (
            <SignInCard onSignIn={() => requestSignIn()} />
          ) : (
            <div ref={formRef}>
              <SubmitForm disabled={!ready} shared={shared} onSubmitted={onSubmitted} />
            </div>
          )}

          <Group justify="space-between" align="center" gap={10} wrap>
            <strong style={sectionTitle}>Requests</strong>
            <SortToggle sort={sort} onChange={handleSortChange} />
          </Group>

          {sort === 'top' && topPartial && (
            <span style={metaText} role="note">
              Ranked across the first {TOP_SCAN_MAX_PAGES * PAGE_SIZE} requests — the board is large.
            </span>
          )}

          {loading ? (
            <Group gap={10} align="center" role="status" aria-live="polite">
              <Loader size="sm" />
              <span style={mutedText}>Loading requests…</span>
            </Group>
          ) : listError ? (
            <Alert color="error" title="Couldn't load requests">
              {listError}
              <div style={{ marginTop: 10 }}>
                <Button size="sm" variant="light" onClick={() => void refreshList()}>
                  Retry
                </Button>
              </div>
            </Alert>
          ) : items.length === 0 ? (
            <EmptyState
              data-testid="empty-state"
              icon="💡"
              title="No requests yet"
              body={
                isAnon
                  ? 'Sign in to be the first to suggest an app or feature.'
                  : 'Be the first to suggest an app or feature you’d like on Civitai.'
              }
              action={
                isAnon ? (
                  <Button color="primary" onClick={() => requestSignIn()} data-testid="empty-signin">
                    Sign in
                  </Button>
                ) : (
                  <Button color="primary" onClick={focusForm} data-testid="empty-suggest">
                    Suggest the first one
                  </Button>
                )
              }
            />
          ) : (
            <Stack gap={10}>
              {(scanningTop || loadingMore) && sort === 'top' && (
                <Group gap={8} align="center" role="status" aria-live="polite">
                  <Loader size="sm" />
                  <span style={metaText}>Ranking the whole board…</span>
                </Group>
              )}
              {sorted.map((item) => (
                <RequestRow
                  key={item.key}
                  item={item}
                  viewerId={viewerId}
                  voted={votedKeys.has(item.key)}
                  busy={pending.has(item.key)}
                  onVote={() => void toggleVote(item)}
                  onWithdraw={() => void withdraw(item)}
                  onEdit={(next) => editRequest(item, next)}
                />
              ))}
              {nextCursor && (
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

          <Footer />
        </Stack>
      </div>
    </div>
  );
}

function Header({ count }: { count: number }) {
  return (
    <Stack gap={10}>
      <Group
        justify="space-between"
        align="center"
        gap={12}
        style={{ paddingBottom: 14, borderBottom: `1px solid ${token.border}` }}
      >
        <Group gap={12} align="center" wrap={false}>
          <span aria-hidden="true" style={brandMarkStyle}>
            <BulbIcon />
          </span>
          <Stack gap={2}>
            <h1 style={h1Style}>App Requests</h1>
            <span style={metaText}>
              Suggest an app or feature — and up-vote the ideas you want most.
            </span>
          </Stack>
        </Group>
        {count > 0 && (
          <Badge variant="light" color="primary" size="lg">
            {count.toLocaleString()} idea{count === 1 ? '' : 's'}
          </Badge>
        )}
      </Group>
    </Stack>
  );
}

function Footer() {
  return (
    <p style={footerStyle}>
      One vote per person. Be kind and constructive — posts are moderated.
    </p>
  );
}

/** The submit form. Owns its own draft + submit lifecycle. */
function SubmitForm({
  disabled,
  shared,
  onSubmitted,
}: {
  disabled: boolean;
  shared: ReturnType<typeof useSharedStorage>;
  onSubmitted: (posted: { key: string; title: string; body?: string }) => Promise<void> | void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPosted, setJustPosted] = useState(false);

  const trimmedTitle = title.trim();
  const titleOver = isOverLimit(title, TITLE_MAX);
  const bodyOver = isOverLimit(body, BODY_MAX);
  const canSubmit =
    !disabled && !submitting && trimmedTitle.length > 0 && !titleOver && !bodyOver;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setJustPosted(false);
    try {
      const trimmedBody = body.trim() ? body.trim() : undefined;
      const { key } = await shared.append({ title: trimmedTitle, body: trimmedBody });
      setTitle('');
      setBody('');
      setJustPosted(true);
      await onSubmitted({ key, title: trimmedTitle, body: trimmedBody });
    } catch (err) {
      setError(classifyWriteError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card padding="md" style={cardStyle}>
      <Stack gap={12}>
        <strong style={sectionTitle}>Suggest a request</strong>
        <div>
          <TextInput
            label="Title"
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
            placeholder="What should it do? Who's it for? Any references?"
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

        <div aria-live="polite">
          {error && (
            <Alert color="warning" title="Couldn't post that">
              {error}
            </Alert>
          )}
          {justPosted && !error && (
            <Alert color="success" title="Posted">
              Thanks — your request is on the board.
            </Alert>
          )}
        </div>

        <Group justify="flex-end">
          <Button
            color="primary"
            loading={submitting}
            disabled={!canSubmit}
            onClick={() => void submit()}
            data-testid="submit-btn"
          >
            Post request
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// NOTE — per-row user REPORTING is intentionally NOT wired here. The published
// SDK (@civitai/app-sdk 0.28 / @civitai/blocks-react 0.37) exposes NO report
// method on `useSharedStorage()` and the postMessage protocol has no
// `SHARED_REPORT` message — so there is no host bridge to submit a report, and
// this sandbox (allow-scripts allow-forms, no allow-same-origin) forbids a raw
// fetch. Content is still moderated server-side at write time (trust-gate +
// NSFW/minor block + HTML strip). A `report()` on the shared-storage contract is
// the owed upstream fix; wire a "Report" affordance on each row once it lands.
/** One request row: votes + title/body + author/time + (own) edit / withdraw. */
function RequestRow({
  item,
  viewerId,
  voted,
  busy,
  onVote,
  onWithdraw,
  onEdit,
}: {
  item: SharedListItem;
  viewerId: number | null;
  voted: boolean;
  busy: boolean;
  onVote: () => void;
  onWithdraw: () => void;
  onEdit: (next: { title: string; body?: string }) => Promise<boolean>;
}) {
  const own = isOwnEntry(item.authorUserId, viewerId);
  const [editing, setEditing] = useState(false);

  return (
    <Card padding="md" style={cardStyle} data-testid="request-row" data-key={item.key}>
      <Group gap={14} align="flex-start" wrap={false}>
        <VoteButton count={item.count} voted={voted} busy={busy} onClick={onVote} />

        <Stack gap={6} style={{ flex: '1 1 260px', minWidth: 0 }}>
          {editing ? (
            <EditForm
              item={item}
              onCancel={() => setEditing(false)}
              onSave={async (next) => {
                const ok = await onEdit(next);
                if (ok) setEditing(false);
                return ok;
              }}
            />
          ) : (
            <>
              <span style={requestTitleStyle}>{item.value.title}</span>
              {item.value.body && <p style={requestBodyStyle}>{item.value.body}</p>}
              <Group gap={8} align="center" wrap>
                <span style={metaText}>{authorLabel(item.authorUserId, viewerId)}</span>
                <span style={metaDotStyle} aria-hidden>
                  ·
                </span>
                <span style={metaText}>{relativeTime(item.createdAt)}</span>
                {own && (
                  <>
                    <span style={metaDotStyle} aria-hidden>
                      ·
                    </span>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => setEditing(true)}
                      disabled={busy}
                      data-testid="edit-btn"
                    >
                      Edit
                    </Button>
                    <span style={metaDotStyle} aria-hidden>
                      ·
                    </span>
                    <Button
                      variant="subtle"
                      size="sm"
                      color="error"
                      onClick={onWithdraw}
                      disabled={busy}
                      data-testid="withdraw-btn"
                    >
                      Withdraw
                    </Button>
                  </>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Group>
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
}: {
  sort: SortMode;
  onChange: (s: SortMode) => void;
}) {
  // SegmentedControl gives role="tablist" + role="tab" + aria-selected + roving
  // ArrowLeft/Right for free — the a11y contract the old Group-of-Buttons lacked.
  return (
    <SegmentedControl
      aria-label="Sort requests"
      size="sm"
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

function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Card padding="md" style={cardStyle}>
      <Group justify="space-between" align="center" gap={12} wrap>
        <Stack gap={2} style={{ flex: '1 1 240px', minWidth: 0 }}>
          <strong style={sectionTitle}>Sign in to join in</strong>
          <span style={mutedText}>You can browse requests below. Sign in to post or vote.</span>
        </Stack>
        <Button color="primary" onClick={onSignIn} data-testid="signin-btn">
          Sign in
        </Button>
      </Group>
    </Card>
  );
}

/** Inline `bulb` glyph (currentColor), matching the manifest's page icon. No external dep. */
function BulbIcon(): React.JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.5.4.9 1 1 1.7l.1.5h5l.1-.5c.1-.7.5-1.3 1-1.7A6 6 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- styles (theme-aware via the @civitai/theme `--civitai-color-*` tokens set
// by data-theme; see ./theme.ts). Zero hardcoded colors. ----

const h1Style: CSSProperties = {
  fontSize: 19,
  margin: 0,
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
  color: token.text,
};
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
const footerStyle: CSSProperties = { ...metaText, textAlign: 'center', margin: 0 };
