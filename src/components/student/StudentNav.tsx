'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Image Lab' },
  { href: '/chat', label: 'Chat Assistant' },
];

export function StudentNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-2 rounded-full bg-[var(--color-surface)]/90 backdrop-blur-sm shadow-[var(--shadow-soft)] border border-[var(--color-border)]/70 p-1 w-fit">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium rounded-full transition ${
              isActive
                ? 'bg-[var(--color-accent)] text-white shadow'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)]/70 hover:text-[var(--color-foreground)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
