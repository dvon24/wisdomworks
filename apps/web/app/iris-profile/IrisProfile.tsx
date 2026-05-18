"use client";

import { useEffect, useState, useCallback } from "react";
import type { DispositionGroup, DispositionKind, IrisProfile } from "./types";
import { RuleCard } from "./RuleCard";
import { AgentCard } from "./AgentCard";
import { KpiBand } from "./KpiBand";
import styles from "./styles.module.css";

const KIND_EMOJI: Record<DispositionKind, string> = {
  preference: "🎯",
  frustration_trigger: "⚠️",
  communication_style: "🗣️",
  correction: "🔧",
  approval: "✅",
};

function relativeTime(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

function Background() {
  return (
    <div className={styles.bgRoot} aria-hidden>
      <div className={styles.aurora}>
        <div className={`${styles.auroraBlob} ${styles.a}`} />
        <div className={`${styles.auroraBlob} ${styles.b}`} />
        <div className={`${styles.auroraBlob} ${styles.c}`} />
      </div>
      <div className={styles.bgVeil} />
    </div>
  );
}

function GroupSection({
  group,
  dismissingIds,
  onDismiss,
}: {
  group: DispositionGroup;
  dismissingIds: Set<string>;
  onDismiss: (id: string) => void;
}) {
  if (group.rules.length === 0) return null;
  const emoji = KIND_EMOJI[group.kind] || "🎯";
  return (
    <section style={{ marginBottom: 32 }}>
      <header className={styles.groupHeader}>
        <span className={styles.groupEmoji}>{emoji}</span>
        <h3 className={styles.groupLabel}>{group.label}</h3>
        <span className="pill dim">
          {group.rules.length} rule{group.rules.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className={styles.ruleStack}>
        {group.rules.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            dismissing={dismissingIds.has(r.id)}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </section>
  );
}

interface IrisProfilePageProps {
  /** Tenant phone; the page falls back to ?phone= URL param if not given. */
  phone?: string;
}

interface FetchState {
  data: IrisProfile | null;
  loading: boolean;
  error: string | null;
}

export function IrisProfile({ phone: phoneProp }: IrisProfilePageProps) {
  const [{ data, loading, error }, setState] = useState<FetchState>({
    data: null,
    loading: true,
    error: null,
  });
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const [dismissError, setDismissError] = useState<string | null>(null);

  // Resolve phone: prop > URL ?phone= > none.
  const phone =
    phoneProp ||
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("phone") || ""
      : "");

  const load = useCallback(async () => {
    setState({ data: null, loading: true, error: null });
    try {
      const url = phone
        ? `/api/iris-profile?phone=${encodeURIComponent(phone)}`
        : `/api/iris-profile`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Failed to load profile (${res.status})`);
      }
      const json = (await res.json()) as IrisProfile;
      setState({ data: json, loading: false, error: null });
    } catch (e) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load profile",
      });
    }
  }, [phone]);

  useEffect(() => {
    load();
  }, [load]);

  // Optimistic dismiss: animate out, drop from local state, POST in background.
  // On error, restore the rule and toast.
  const handleDismiss = useCallback(
    (ruleId: string) => {
      if (!data) return;

      // 1. Mark as animating out.
      setDismissingIds((s) => new Set(s).add(ruleId));

      // 2. After the fade-out animation, remove the rule from local state.
      const removeTimer = setTimeout(() => {
        setState((prev) => {
          if (!prev.data) return prev;
          return {
            ...prev,
            data: {
              ...prev.data,
              learning_stats: {
                ...prev.data.learning_stats,
                total_rules: Math.max(0, prev.data.learning_stats.total_rules - 1),
              },
              disposition: prev.data.disposition.map((g) => ({
                ...g,
                rules: g.rules.filter((r) => r.id !== ruleId),
              })),
            },
          };
        });
        setDismissingIds((s) => {
          const next = new Set(s);
          next.delete(ruleId);
          return next;
        });
      }, 380);

      // 3. Fire the POST. (Endpoint to be wired server-side.)
      void fetch("/api/iris-profile/dismiss-rule", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Dismiss failed (${res.status})`);
        })
        .catch((err) => {
          // Roll back: stop the animation, re-add the rule, surface a toast.
          clearTimeout(removeTimer);
          setDismissingIds((s) => {
            const next = new Set(s);
            next.delete(ruleId);
            return next;
          });
          // The rule is still in state because the timer didn't fire — but
          // animation already played; we just stop and reset opacity by
          // dropping the dismissing class. React handles the rest.
          setDismissError(
            err instanceof Error ? err.message : "Couldn't dismiss the rule. Please retry."
          );
          // Reload to be safe in case state already drifted.
          void load();
        });
    },
    [data, load]
  );

  return (
    <>
      <Background />
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.eyebrow} style={{ marginBottom: 12 }}>
            Your profile · only you can see this
          </div>
          <div className={styles.numXxl}>What Iris has learned about you.</div>
          <div className={styles.headerLede}>
            This is everything the system has picked up from your interactions. Keep what's
            right. Dismiss what's wrong.
          </div>
          <div className={styles.headerMeta}>
            <a
              href={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("phone")
                ? `/?phone=${encodeURIComponent(new URLSearchParams(window.location.search).get("phone")!)}`
                : "/"}
              className={styles.linkBtn}
              style={{ textDecoration: "none" }}
            >
              ← Back to deck
            </a>
            <span className={styles.metaDivider} />
            <span className="mono">
              Last updated {data ? relativeTime(data.computed_at) : "…"}
            </span>
            <span className={styles.metaDivider} />
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => void load()}
              disabled={loading}
            >
              ↻ Refresh
            </button>
          </div>
        </header>

        {dismissError && (
          <div className={styles.errorBanner} role="alert">
            <span>{dismissError}</span>
            <button
              type="button"
              className={styles.errorClose}
              onClick={() => setDismissError(null)}
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !data && (
          <>
            <div className={styles.statBand}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`glass ${styles.statTile} ${styles.skeletonCard}`}>
                  <div className={`${styles.skeletonLine} ${styles.short}`} />
                  <div className={styles.skeletonLine} />
                </div>
              ))}
            </div>
            <div className={styles.ruleStack}>
              {[0, 1, 2].map((i) => (
                <div key={i} className={`glass ${styles.ruleCard} ${styles.skeletonCard}`}>
                  <div className={styles.skeletonLine} />
                  <div className={`${styles.skeletonLine} ${styles.short}`} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className={`glass ${styles.emptyState}`}>
            <div style={{ fontSize: 14, marginBottom: 8, color: "var(--text)" }}>
              Couldn't load your profile.
            </div>
            <div>{error}</div>
            <button
              type="button"
              className={styles.linkBtn}
              style={{ marginTop: 12 }}
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        )}

        {/* Loaded state */}
        {data && (
          <>
            <KpiBand stats={data.learning_stats} agentCount={data.agents.length} />

            <section className={styles.section}>
              <header className={styles.sectionHeader}>
                <div className={styles.eyebrow} style={{ marginBottom: 8 }}>
                  Disposition
                </div>
                <h2 className={styles.sectionTitle}>Rules Iris is following</h2>
                <p className={styles.sectionDescription}>
                  Each rule is injected into every relevant agent's prompt. Iris learns them by
                  watching what you accept, correct, or reverse.
                </p>
              </header>
              {data.disposition.some((g) => g.rules.length > 0) ? (
                data.disposition.map((g) => (
                  <GroupSection
                    key={g.kind}
                    group={g}
                    dismissingIds={dismissingIds}
                    onDismiss={handleDismiss}
                  />
                ))
              ) : (
                <div className={`glass ${styles.emptyState}`}>
                  I'm still learning. Once we've had a few back-and-forths, I'll start picking
                  up your preferences and surfacing them here.
                </div>
              )}
            </section>

            <section className={styles.section}>
              <header className={styles.sectionHeader}>
                <div className={styles.eyebrow} style={{ marginBottom: 8 }}>
                  Your team
                </div>
                <h2 className={styles.sectionTitle}>Operating manuals</h2>
                <p className={styles.sectionDescription}>
                  Each agent maintains a private playbook — techniques they've proven, rules
                  you've corrected them on, and what they know about your world. Tap any name to
                  read theirs.
                </p>
                {/* Outcome legend — the activity chips on each agent card
                    use these four words; this section explains them once
                    so the owner knows what they mean. */}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    marginTop: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--glass-border)",
                    borderRadius: 8,
                    fontSize: 11,
                    color: "var(--text-dim)",
                    lineHeight: 1.45,
                  }}
                >
                  <span><strong style={{ color: "var(--text)" }}>observed</strong> = noticed, nothing to act on</span>
                  <span><strong style={{ color: "var(--text)" }}>proposed</strong> = asked you to approve before acting</span>
                  <span><strong style={{ color: "var(--text)" }}>acted</strong> = did it themselves (within their autonomy level)</span>
                  <span><strong style={{ color: "var(--text)" }}>escalated</strong> = flagged it for your attention</span>
                </div>
              </header>
              {data.agents.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.agents.map((a) => (
                    <AgentCard key={a.agent_name} agent={a} />
                  ))}
                </div>
              ) : (
                <div className={`glass ${styles.emptyState}`}>
                  Your team hasn't been provisioned yet. Talk to Iris to get started.
                </div>
              )}
            </section>

            <footer className={styles.footer}>
              <div className="mono">Tenant {data.tenant_phone}</div>
              <div style={{ marginTop: 4 }}>
                Only you can see this page. Iris updates it continuously.
              </div>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
