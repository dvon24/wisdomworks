"use client";

import type { DispositionRule } from "./types";
import styles from "./styles.module.css";

interface RuleCardProps {
  rule: DispositionRule;
  dismissing: boolean;
  onDismiss: (id: string) => void;
}

const FORMAT_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { month: "long", day: "numeric" });

function confidenceTier(c: number): { tier: string; color: string } {
  if (c >= 0.85) return { tier: "strong rule", color: "var(--accent-deep)" };
  if (c >= 0.6) return { tier: "trusted", color: "var(--accent)" };
  return { tier: "learning", color: "rgba(20,20,30,0.30)" };
}

export function RuleCard({ rule, dismissing, onDismiss }: RuleCardProps) {
  const { tier, color } = confidenceTier(rule.confidence);
  const pct = Math.round(rule.confidence * 100);
  const scopeLabel = rule.scope === "everywhere" ? "ALL AGENTS" : rule.scope.toUpperCase();

  return (
    <article
      className={`glass ${styles.ruleCard} pop-in ${dismissing ? styles.dismissing : ""}`}
    >
      <div className={styles.ruleText}>{rule.rule_text}</div>
      <div className={styles.ruleWhy}>{rule.why}</div>
      {rule.evidence && (
        <div className={styles.ruleEvidence}>“{rule.evidence}”</div>
      )}

      <div className={styles.confRow}>
        <div className={styles.confTrack}>
          <div
            className={styles.confFill}
            style={{ width: `${pct}%`, background: color }}
          />
        </div>
        <span className={styles.confLabel}>{tier} · {pct}%</span>
      </div>

      <div className={styles.ruleMetaRow}>
        <span className={styles.ruleMetaText}>
          {scopeLabel} · APPLIED {rule.applied_count}× · LEARNED {FORMAT_DATE(rule.created_at).toUpperCase()}
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.linkBtn} ${styles.danger ?? ""}`}
          onClick={() => onDismiss(rule.id)}
          aria-label={`Dismiss rule: ${rule.rule_text}`}
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
