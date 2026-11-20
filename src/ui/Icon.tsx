import {
  ArchiveX,
  ArrowLeftRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleQuestionMark,
  Compass,
  Cookie,
  Cpu,
  Database,
  DatabaseZap,
  Download,
  Ellipsis,
  FileBraces,
  Hourglass,
  Info,
  Key,
  KeyRound,
  Link,
  ListEnd,
  ListOrdered,
  Monitor,
  Scale,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  Rss,
  RadioTower,
  Redo2,
  Split,
  Server,
  TriangleAlert,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ComponentIcon } from '../engine/registry'

/** Icons the UI itself uses (toolbar, counters, dialogs), next to the component ones. */
export type UiIcon =
  | 'in-flight'
  | 'queued'
  | 'ok'
  | 'error'
  | 'pending'
  | 'sessions'
  | 'keys'
  | 'warning'
  | 'scenarios'
  | 'guide'
  | 'link'
  | 'edit'
  | 'play'
  | 'pause'
  | 'power'
  | 'undo'
  | 'redo'
  | 'export'
  | 'import'
  | 'new'
  | 'caret'
  | 'more'
  | 'close'
  | 'external'
  | 'info'
  | 'collapse'
  | 'expand'
  | 'unknown'

export type IconName = ComponentIcon | UiIcon

/** Every icon comes from Lucide (lucide.dev): outlined, 24px grid, drawn with currentColor. */
const ICONS: Record<IconName, LucideIcon> = {
  // Components
  monitor: Monitor,
  scale: Scale,
  split: Split,
  server: Server,
  cpu: Cpu,
  'database-zap': DatabaseZap,
  'list-end': ListEnd,
  'radio-tower': RadioTower,
  rss: Rss,
  'archive-x': ArchiveX,
  database: Database,
  'key-round': KeyRound,
  'file-json': FileBraces,
  // UI
  'in-flight': Hourglass,
  queued: ListOrdered,
  ok: Check,
  error: X,
  pending: ArrowLeftRight,
  sessions: Cookie,
  keys: Key,
  warning: TriangleAlert,
  scenarios: Compass,
  guide: BookOpen,
  link: Link,
  edit: Pencil,
  play: Play,
  pause: Pause,
  power: Power,
  undo: Undo2,
  redo: Redo2,
  export: Download,
  import: Upload,
  new: Plus,
  caret: ChevronDown,
  more: Ellipsis,
  close: X,
  external: ArrowUpRight,
  info: Info,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  unknown: CircleQuestionMark,
}

/**
 * A decorative icon: hidden from assistive tech (the button or label next to it carries the meaning).
 * `size` is in px; the stroke stays thin at small sizes so it matches the hand-drawn canvas.
 */
export function Icon({ name, size = 16, strokeWidth = 1.75, className }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  const Svg = ICONS[name] ?? CircleQuestionMark
  return <Svg size={size} strokeWidth={strokeWidth} className={className ? `icon ${className}` : 'icon'} data-icon={name} aria-hidden="true" focusable="false" />
}
