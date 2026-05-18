"use client";

import type { LearningStats } from "./types";
import styles from "./styles.module.css";

const FORMAT_DATE = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { month: "long", day: "numeric" });

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
}

function StatTile({ label, value, sublabel }: StatTileProps) {
  return (
    <div className={`glass ${styles.statTile}`}>
      <div className={styles.eyebrow}>{label}</div>
      <div className={styles.numLg} style={{ marginTop: 2 }}>{value}</div>
      {sublabel && <div className={styles.statSub}>{sublabel}</div>}
    </div>
  );
}

interface KpiBandProps {
  stats: LearningStats;
  agentCount: number;
}

export function KpiBand({ stats, agentCount }: KpiBandProps) {
  const learningSince = FORMAT_DATE(stats.earliest_rule_created_at);
  const daysAgo = Math.round(
    (Date.now() - new Date(stats.earliest_rule_created_at).getTime()) / 86400000
  );
  const categoryCount = Object.keys(stats.rules_by_kind).length;

  return (
    <div className={styles.statBand}>
      <StatTile
        label="Rules learned"
        value={stats.total_rules}
        sublabel={`across ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`}
      />
      <StatTile
        label="Agents on your team"
        value={agentCount}
        sublabel={`${stats.agents_with_skills} with proven techniques`}
      />
      <StatTile
        label="Proven techniques"
        value={stats.total_skills}
        sublabel="things Iris does because they worked"
      />
      <StatTile
        label="Learning since"
        value={learningSince}
        sublabel={`${daysAgo} days ago`}
      />
    </div>
  );
}
