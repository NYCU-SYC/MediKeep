import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  FileArchive,
  FilePlus2,
  FileText,
  Folder,
  Heart,
  Home,
  Hospital,
  Image,
  ListTodo,
  LogOut,
  Menu,
  Pill,
  ScanLine,
  Settings2,
  Share2,
  ShieldCheck,
  Siren,
  Stethoscope,
  TrendingUp,
  Upload,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * User-facing code uses semantic icon names; every name resolves to a real
 * lucide-react component and never renders a text glyph or emoji.
 */
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  health: Stethoscope,
  bell: Bell,
  user: UserRound,
  profile: FileText,
  shield: ShieldCheck,
  emergency: Siren,
  hospital: Hospital,
  medication: Pill,
  trend: TrendingUp,
  file: FilePlus2,
  image: Image,
  folder: Folder,
  records: ClipboardList,
  family: UsersRound,
  logout: LogOut,
  menu: Menu,
  close: X,
  arrowRight: ArrowRight,
  tasks: ListTodo,
  activity: Activity,
  archive: FileArchive,
  upload: Upload,
  settings: Settings2,
  share: Share2,
  alert: CircleAlert,
  confirmed: CheckCircle2,
  book: BookOpen,
  scan: ScanLine,
  help: CircleHelp,
};

export function Icon({ name, size = '1.25em' }: { name: string; size?: string | number }) {
  const IconComponent = ICONS[name] || CircleHelp;
  return <IconComponent size={size} aria-hidden="true" focusable="false" strokeWidth={2} />;
}

export function HeartLogo({ size = 20 }: { size?: number }) {
  return <Heart size={size} fill="currentColor" aria-hidden="true" focusable="false" strokeWidth={1.8} />;
}
