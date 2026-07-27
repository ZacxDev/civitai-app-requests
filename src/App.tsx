import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import {
  useAppStorage,
  useBlockContext,
  useBlockResize,
  useRequestSignIn,
  useSharedStorage,
  type SharedListItem,
} from '@civitai/blocks-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Textarea,
  TextInput,
  injectBlocksStyles,
} from '@civitai/blocks-react/ui';

import { classifyWriteError } from './errors.js';
import {
  authorLabel,
  BODY_MAX,
  isOverLimit,
  isOwnEntry,
  lengthHint,
  relativeTime,
  sortItems,
  TITLE_MAX,
  type SortMode,
} from './format.js';

// The per-viewer KV key under which we persist the SET of shared-entry keys this
// viewer has up-voted. The shared API is one-vote-per-user + server-enforced but
// does NOT tell a block "did I vote on this" — so we remember it locally (in the
// per-user App Storage KV) and reconcile the count with what vote()/unvote()
// return. Scoped to (block instance, viewer), so it's private to each viewer.
const VOTED_STORAGE_KEY = 'voted-request-keys';

// How many entries per list page.
const PAGE_SIZE = 25;

/**
 * App Requests — a first-party Civitai App Block. A community voting board where
 * anyone submits an idea for a new app/feature and up-votes others'. Built
 * entirely on the cross-user SHARED storage platform (`useSharedStorage`) plus
 * the per-viewer KV (`useAppStorage`) for the local voted-set. No Buzz, no
 * generation — read + write + vote only.
 */
export function App() {
  const { ready, viewer, theme } = useBlockContext();
  const shared = useSharedStorage();
  const storage = useAppStorage();
  const { requestSignIn } = useRequestSignIn();

  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  const viewerId = viewer?.id ?? null;
  const isAnon = ready && viewer == null;

  // The board. `items` accumulates across "load more" pages (server order:
  // newest-first); `sort` re-orders client-side for display.
  const [items, setItems] = useState<SharedListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('top');

  // Key of the request the viewer just posted this session — pinned to the top
  // of the board regardless of the active sort so it's immediately visible. A
  // brand-new request has 0 votes, so under "Top" it would otherwise sort below
  // the fold and look like "nothing happened". Cleared when the viewer picks an
  // explicit sort.
  const [justPostedKey, setJustPostedKey] = useState<string | null>(null);

  // The viewer's own up-votes (keys), hydrated from App Storage. `pending` holds
  // keys with an in-flight vote toggle so a double-click can't double-count.
  const [votedKeys, setVotedKeys] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Errors from a vote/withdraw action (distinct from list + submit errors).
  const [actionError, setActionError] = useState<string | null>(null);

  const injectedRef = useRef(false);
  if (!injectedRef.current) {
    injectBlocksStyles();
    injectedRef.current = true;
  }

  // Load a fresh first page of the board.
  const refreshList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await shared.list({ limit: PAGE_SIZE });
      setItems(res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setListError(classifyWriteError(err).message);
    } finally {
      setLoading(false);
    }
  }, [shared]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await shared.list({ limit: PAGE_SIZE, cursor: nextCursor });
      setItems((prev) => {
        // De-dupe defensively on key (a concurrent append could shift a page).
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...res.items.filter((i) => !seen.has(i.key))];
      });
      setNextCursor(res.nextCursor);
    } catch (err) {
      setListError(classifyWriteError(err).message);
    } finally {
      setLoadingMore(false);
    }
  }, [shared, nextCursor, loadingMore]);

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

  /**
   * Toggle the viewer's up-vote on an entry. Optimistic: flip the local vote
   * state + count immediately, then reconcile with the count vote()/unvote()
   * returns. A `pending` guard drops overlapping clicks so a double-click is a
   * single net request (one-vote-per-user is also server-enforced). Rolls back
   * + surfaces a friendly message on failure (e.g. the min-trust gate).
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
        setActionError(null);
      } catch (err) {
        // Roll back the optimistic flip.
        setCount(key, prevCount);
        setVotedKeys((prev) => {
          const next = new Set(prev);
          if (wasVoted) next.add(key);
          else next.delete(key);
          return next;
        });
        setActionError(classifyWriteError(err).message);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    },
    [isAnon, requestSignIn, pending, votedKeys, shared, setCount, persistVoted],
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
        setActionError(null);
      } catch (err) {
        setActionError(classifyWriteError(err).message);
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(item.key);
          return next;
        });
      }
    },
    [pending, shared, persistVoted],
  );

  const onSubmitted = useCallback(
    async (posted: { key: string; title: string; body?: string }) => {
      // Optimistically prepend the just-posted request so it renders instantly,
      // before the refetch round-trips. The item is pinned to the top (via
      // `justPostedKey`) so the active sort can't bury the fresh 0-vote entry.
      // `refreshList()` below is the source of truth and supersedes this row
      // with the authoritative server one (same host-minted key → de-duped).
      setJustPostedKey(posted.key);
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
    [refreshList, viewerId],
  );

  // Clears the just-posted pin when the viewer deliberately re-sorts the board.
  const handleSortChange = useCallback((s: SortMode) => {
    setJustPostedKey(null);
    setSort(s);
  }, []);

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
      <div style={containerStyle}>
        <Stack gap={20}>
          <Header count={items.length} />

          {isAnon ? (
            <SignInCard onSignIn={() => requestSignIn()} />
          ) : (
            <SubmitForm
              disabled={!ready}
              shared={shared}
              onSubmitted={onSubmitted}
            />
          )}

          {actionError && (
            <Alert color="warning" title="Couldn't do that">
              {actionError}
            </Alert>
          )}

          <Group justify="space-between" align="center" wrap>
            <strong style={sectionTitleStyle}>Requests</strong>
            <SortToggle sort={sort} onChange={handleSortChange} />
          </Group>

          {loading ? (
            <Group gap={10} align="center">
              <Loader size="sm" />
              <span style={mutedStyle}>Loading requests…</span>
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
            <EmptyState isAnon={isAnon} />
          ) : (
            <Stack gap={10}>
              {sorted.map((item) => (
                <RequestRow
                  key={item.key}
                  item={item}
                  viewerId={viewerId}
                  voted={votedKeys.has(item.key)}
                  busy={pending.has(item.key)}
                  onVote={() => void toggleVote(item)}
                  onWithdraw={() => void withdraw(item)}
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
    <Stack gap={4}>
      <Group justify="space-between" align="center" wrap>
        <h1 style={h1Style}>App Requests</h1>
        {count > 0 && (
          <Badge variant="light" color="primary">
            {count} idea{count === 1 ? '' : 's'}
          </Badge>
        )}
      </Group>
      <p style={subtitleStyle}>
        Suggest an app or feature you'd like on Civitai — and up-vote the ideas you want most.
      </p>
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
        <strong style={sectionTitleStyle}>Suggest a request</strong>
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
          <span style={titleOver ? hintOverStyle : hintStyle}>
            {lengthHint(title, TITLE_MAX)}
          </span>
        </div>
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
          <span style={bodyOver ? hintOverStyle : hintStyle}>
            {lengthHint(body, BODY_MAX)}
          </span>
        </div>

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

/** One request row: votes + title/body + author/time + (own) withdraw. */
function RequestRow({
  item,
  viewerId,
  voted,
  busy,
  onVote,
  onWithdraw,
}: {
  item: SharedListItem;
  viewerId: number | null;
  voted: boolean;
  busy: boolean;
  onVote: () => void;
  onWithdraw: () => void;
}) {
  const own = isOwnEntry(item.authorUserId, viewerId);
  return (
    <Card padding="md" style={cardStyle} data-testid="request-row" data-key={item.key}>
      <Group gap={14} align="flex-start" wrap={false}>
        <button
          type="button"
          onClick={onVote}
          disabled={busy}
          aria-pressed={voted}
          aria-label={voted ? `Remove your vote (${item.count})` : `Up-vote (${item.count})`}
          data-testid="vote-btn"
          style={voteButtonStyle(voted)}
        >
          <span aria-hidden style={voteCaretStyle}>▲</span>
          <span style={voteCountStyle} data-testid="vote-count">
            {item.count}
          </span>
        </button>

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <span style={requestTitleStyle}>{item.value.title}</span>
          {item.value.body && <p style={requestBodyStyle}>{item.value.body}</p>}
          <Group gap={8} align="center" wrap>
            <span style={metaStyle}>{authorLabel(item.authorUserId, viewerId)}</span>
            <span style={metaDotStyle} aria-hidden>·</span>
            <span style={metaStyle}>{relativeTime(item.createdAt)}</span>
            {own && (
              <>
                <span style={metaDotStyle} aria-hidden>·</span>
                <button
                  type="button"
                  onClick={onWithdraw}
                  disabled={busy}
                  style={withdrawStyle}
                  data-testid="withdraw-btn"
                >
                  Withdraw
                </button>
              </>
            )}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}

function SortToggle({
  sort,
  onChange,
}: {
  sort: SortMode;
  onChange: (s: SortMode) => void;
}) {
  return (
    <Group gap={6} align="center">
      <Button
        size="sm"
        variant={sort === 'top' ? 'filled' : 'subtle'}
        onClick={() => onChange('top')}
        data-testid="sort-top"
      >
        Top
      </Button>
      <Button
        size="sm"
        variant={sort === 'newest' ? 'filled' : 'subtle'}
        onClick={() => onChange('newest')}
        data-testid="sort-newest"
      >
        Newest
      </Button>
    </Group>
  );
}

function EmptyState({ isAnon }: { isAnon: boolean }) {
  return (
    <Card padding="lg" style={cardStyle}>
      <Stack gap={6} align="center">
        <span style={{ fontSize: 30 }} aria-hidden>💡</span>
        <strong style={sectionTitleStyle}>No requests yet</strong>
        <span style={mutedStyle}>
          {isAnon
            ? 'Sign in to be the first to suggest an app or feature.'
            : 'Be the first to suggest an app or feature.'}
        </span>
      </Stack>
    </Card>
  );
}

function SignInCard({ onSignIn }: { onSignIn: () => void }) {
  return (
    <Card padding="md" style={cardStyle}>
      <Group justify="space-between" align="center" wrap>
        <Stack gap={2}>
          <strong style={sectionTitleStyle}>Sign in to join in</strong>
          <span style={mutedStyle}>You can browse requests below. Sign in to post or vote.</span>
        </Stack>
        <Button color="primary" onClick={onSignIn} data-testid="signin-btn">
          Sign in
        </Button>
      </Group>
    </Card>
  );
}

// ---- styles (theme-aware via the W6 pack CSS vars set by data-theme) ----

const pageStyle: CSSProperties = {
  minHeight: '100dvh',
  background: 'var(--ci-color-surface-2, transparent)',
  color: 'var(--ci-color-text, inherit)',
  boxSizing: 'border-box',
};
const containerStyle: CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '24px 16px 48px',
};
const h1Style: CSSProperties = { fontSize: 26, margin: 0, lineHeight: 1.2 };
const subtitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ci-color-text-muted, #868e96)',
  lineHeight: 1.5,
};
const sectionTitleStyle: CSSProperties = { fontSize: 16 };
const cardStyle: CSSProperties = {
  background: 'var(--ci-color-surface, transparent)',
  border: '1px solid var(--ci-color-border, rgba(128,128,128,0.25))',
};
const hintRowStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', marginTop: -6 };
const hintStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--ci-color-text-muted, #868e96)',
  fontVariantNumeric: 'tabular-nums',
};
const hintOverStyle: CSSProperties = { ...hintStyle, color: 'var(--ci-color-error, #e03131)', fontWeight: 600 };
const requestTitleStyle: CSSProperties = { fontWeight: 600, fontSize: 15, lineHeight: 1.35, wordBreak: 'break-word' };
const requestBodyStyle: CSSProperties = {
  margin: 0,
  color: 'var(--ci-color-text-muted, #868e96)',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};
const metaStyle: CSSProperties = { fontSize: 12, color: 'var(--ci-color-text-muted, #868e96)' };
const metaDotStyle: CSSProperties = { color: 'var(--ci-color-text-muted, #868e96)' };
const mutedStyle: CSSProperties = { color: 'var(--ci-color-text-muted, #868e96)' };
const footerStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--ci-color-text-muted, #868e96)',
  textAlign: 'center',
  margin: 0,
};
const withdrawStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  color: 'var(--ci-color-error, #e03131)',
  cursor: 'pointer',
  textDecoration: 'underline',
};
const voteCaretStyle: CSSProperties = { fontSize: 12, lineHeight: 1 };
const voteCountStyle: CSSProperties = { fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' };
function voteButtonStyle(voted: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    minWidth: 52,
    padding: '8px 6px',
    borderRadius: 8,
    cursor: 'pointer',
    border: `1px solid ${voted ? 'var(--ci-color-primary, #1971c2)' : 'var(--ci-color-border, rgba(128,128,128,0.35))'}`,
    background: voted ? 'var(--ci-color-primary, #1971c2)' : 'transparent',
    color: voted ? '#fff' : 'var(--ci-color-text, inherit)',
    transition: 'background 120ms ease, border-color 120ms ease',
  };
}
