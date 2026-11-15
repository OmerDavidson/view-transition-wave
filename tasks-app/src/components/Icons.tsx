import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
export const ChevronRight = (p: IconProps) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>;
export const Plus = (p: IconProps) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Close = (p: IconProps) => <Icon {...p}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const Check = (p: IconProps) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>;
export const CloudOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2 2 20 20M5.8 5.8A6 6 0 0 0 6 18h11c.6 0 1.2-.1 1.7-.3M21.5 15.5A4.5 4.5 0 0 0 17.5 9h-1A7 7 0 0 0 9.3 4.3" />
  </Icon>
);
export const Sync = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5" />
  </Icon>
);
export const Alert = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </Icon>
);
export const Logout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Icon>
);
export const Trash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Icon>
);

export function Logo(props: IconProps) {
  return (
    <svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true" {...props}>
      <rect width="64" height="64" rx="16" fill="#5b5bd6" />
      <rect x="14" y="17" width="36" height="32" rx="6" fill="#fff" />
      <rect x="14" y="17" width="36" height="9" rx="4" fill="#c7c7f5" />
      <path d="m24 37 5 5 11-11" fill="none" stroke="#5b5bd6" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
