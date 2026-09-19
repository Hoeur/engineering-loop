import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  Bug,
  CalendarClock,
  CircleDollarSign,
  Cpu,
  FileCode2,
  FlaskConical,
  GitPullRequest,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Map as MapIcon,
  Monitor,
  Route,
  ScanEye,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

/** Sidebar information architecture (spec section 24). */
export const NAVIGATION: NavSection[] = [
  {
    label: null,
    items: [
      { label: 'Overview', href: '/', icon: LayoutDashboard },
      { label: 'Inbox', href: '/inbox', icon: Inbox },
      { label: 'Projects', href: '/projects', icon: Boxes },
    ],
  },
  {
    label: 'Engineering',
    items: [
      { label: 'Roadmap', href: '/engineering/roadmap', icon: MapIcon },
      { label: 'Epics', href: '/engineering/epics', icon: Route },
      { label: 'Features', href: '/engineering/features', icon: Sparkles },
      { label: 'Tasks', href: '/engineering/tasks', icon: ListChecks },
      { label: 'Agent Runs', href: '/engineering/agent-runs', icon: Activity },
      { label: 'Reviews', href: '/engineering/reviews', icon: ScanEye },
      { label: 'Tests', href: '/engineering/tests', icon: FlaskConical },
      { label: 'Pull Requests', href: '/engineering/pull-requests', icon: GitPullRequest },
    ],
  },
  {
    label: 'Agents',
    items: [
      { label: 'Agent Team', href: '/agents/team', icon: Bot },
      { label: 'Providers', href: '/agents/providers', icon: Cpu },
      { label: 'Configurations', href: '/agents/configurations', icon: Sliders },
    ],
  },
  {
    label: 'Automation',
    items: [
      { label: 'Workflows', href: '/automation/workflows', icon: Workflow },
      { label: 'Schedules', href: '/automation/schedules', icon: CalendarClock },
      { label: 'Triggers', href: '/automation/triggers', icon: Zap },
    ],
  },
  {
    label: 'Quality',
    items: [
      { label: 'Bugs', href: '/quality/bugs', icon: Bug },
      { label: 'Security', href: '/quality/security', icon: ShieldCheck },
      { label: 'Performance', href: '/quality/performance', icon: Gauge },
      { label: 'UI QA', href: '/quality/ui-qa', icon: Monitor },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Usage', href: '/insights/usage', icon: BarChart3 },
      { label: 'Costs', href: '/insights/costs', icon: CircleDollarSign },
      { label: 'Agent Performance', href: '/insights/agent-performance', icon: Activity },
      { label: 'Delivery Metrics', href: '/insights/delivery', icon: FileCode2 },
    ],
  },
  {
    label: null,
    items: [{ label: 'Settings', href: '/settings', icon: Settings }],
  },
];

export const findActiveItem = (pathname: string): NavItem | undefined => {
  const all = NAVIGATION.flatMap((section) => section.items);
  return (
    all.find((item) => item.href !== '/' && pathname.startsWith(item.href)) ??
    all.find((item) => item.href === pathname)
  );
};
