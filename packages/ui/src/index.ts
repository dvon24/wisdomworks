// @wisdomworks/ui — Shared React component library

// Existing components
export { Button } from './button';
export { Card } from './card';
export { Code } from './code';

// Design system components (light theme — see design-tokens.css)
export { WisdomMark, WisdomMarkInline, WisdomLockup } from './wisdom-mark';
export { Background, BG_IMAGES } from './background';
export { Hierarchy } from './hierarchy';
export type {
  AgentTier,
  AgentStatus,
  HierarchyAgent,
  HierarchyExternal,
  HierarchyPrincipal,
} from './hierarchy';

// Note: Import design-tokens.css from your app's global stylesheet:
//   import '@wisdomworks/ui/design-tokens.css';
