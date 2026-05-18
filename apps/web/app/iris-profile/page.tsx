"use client";

import { IrisProfile } from "./IrisProfile";

/**
 * Route entry for /iris-profile (drop this folder into apps/web/app/iris-profile/).
 *
 * The component self-fetches GET /api/iris-profile?phone=<phone>, using:
 *   1. an explicit `phone` prop (if you wrap this page),
 *   2. otherwise the ?phone= URL search param,
 *   3. otherwise none (and the API resolves the owner from the session cookie).
 *
 * Dismissing a rule POSTs to /api/iris-profile/dismiss-rule with { rule_id }.
 * The optimistic UI animates the card out before the request resolves, and
 * rolls back with an error banner if the POST fails.
 */
export default function Page() {
  return <IrisProfile />;
}
