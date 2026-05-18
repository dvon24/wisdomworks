"use client";

import { useState } from "react";
import type { Agent, ActivityOutcome } from "./types";
import styles from "./styles.module.css";

const OUTCOME_ORDER: ActivityOutcome[] = ["observed", "proposed", "acted", "escalated"];

function OutcomeChips({ by_outcome }: { by_outcome: Agent["recent_activity"]["by_outcome"] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {OUTCOME_ORDER.filter((k) => by_outcome[k]).map((k) => (
        <span key={k} className={`${styles.outcome} ${styles[k]}`}>
          {k} {by_outcome[k]}
        </span>
      ))}
    </div>
  );
}

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const [open, setOpen] = useState(false);
  const ra = agent.recent_activity;
  const isIdle = agent.idle || !ra.total_ticks;

  // Group domain facts by kind for the bottom section.
  const groupedFacts: Record<string, typeof agent.domain_facts> = {};
  for (const f of agent.domain_facts) {
    (groupedFacts[f.kind] = groupedFacts[f.kind] || []).push(f);
  }

  return (
    <article className={`glass ${styles.agentCard} pop-in`}>
      <header
        className={styles.agentHead}
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-expanded={open}
      >
        <div className={styles.agentAvatar}>{agent.agent_name[0]}</div>
        <div style={{ minWidth: 0 }}>
          <div className={styles.agentNameRow}>
            <span className={styles.agentName}>{agent.agent_name}</span>
            <span className={styles.agentRole}>· {agent.agent_role}</span>
          </div>
          <div className={styles.agentChips}>
            {isIdle ? (
              <span className={styles.idleLine}>Idle this week — nothing to report</span>
            ) : (
              <>
                <span className={styles.agentTickLine}>{ra.total_ticks} ticks</span>
                <OutcomeChips by_outcome={ra.by_outcome} />
              </>
            )}
          </div>
        </div>
        <span className={`pill dim mono`} style={{ fontSize: 10 }}>
          {agent.proven_techniques.length} TECH · {agent.guardrails.length} RULE
        </span>
        <span className={`${styles.chevron} ${open ? styles.open : ""}`}>›</span>
      </header>

      {open && (
        <div className={`${styles.agentBody} pop-in`}>
          <div style={{ paddingTop: 18 }}>
            <div className={styles.subEyebrow}>What they do</div>
            <p className={styles.bodyDescription}>{agent.description}</p>
            <div className={styles.capRow}>
              {agent.capabilities.map((c) => (
                <span
                  key={c}
                  className={`pill dim mono`}
                  style={{ fontSize: 9.5, letterSpacing: "0.04em" }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>

          {ra.sample_outputs.length > 0 && (
            <div>
              <div className={styles.subEyebrow}>Recent activity</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ra.sample_outputs.map((s, i) => (
                  <div key={i} className={styles.sample}>
                    <span
                      className={`${styles.outcome} ${styles[s.outcome as ActivityOutcome] || ""}`}
                    >
                      {s.outcome}
                    </span>
                    <span className={styles.sampleText}>{s.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {agent.proven_techniques.length > 0 && (
            <div>
              <div className={styles.subEyebrow}>Proven techniques</div>
              <div>
                {agent.proven_techniques.map((t, i) => (
                  <div key={i} className={styles.technique}>
                    <div className={styles.techniqueText}>{t.technique}</div>
                    <span className={`pill ok mono`} style={{ fontSize: 10 }}>
                      {t.uses} uses · {Math.round(t.success_rate * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {agent.guardrails.length > 0 && (
            <div>
              <div className={styles.subEyebrow}>Guardrails</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {agent.guardrails.map((g, i) => (
                  <details key={i} className={styles.guardrail}>
                    <summary className={styles.guardrailSummary}>
                      <span className={styles.guardrailRule}>{g.rule}</span>
                      <span
                        className={`pill ${
                          g.severity === "high" ? "bad" : g.severity === "medium" ? "warn" : "dim"
                        }`}
                        style={{ fontSize: 10 }}
                      >
                        {g.severity.toUpperCase()}
                      </span>
                    </summary>
                    <div className={styles.guardrailReason}>
                      <span className={styles.guardrailReasonLabel}>Why:</span>
                      {g.reason}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {agent.domain_facts.length > 0 && (
            <div>
              <div className={styles.subEyebrow}>Domain knowledge</div>
              <div className={styles.domainGroup}>
                {Object.entries(groupedFacts).map(([kind, facts]) => (
                  <div key={kind}>
                    <div className={styles.domainKind}>{kind}</div>
                    <ul className={styles.domainList}>
                      {facts.map((f, i) => (
                        <li key={i} className={styles.domainItem}>
                          {f.content}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
