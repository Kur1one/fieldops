'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) =>
    href === '/tickets' ? path === '/tickets' || (/^\/tickets\/[^/]+$/.test(path) && path !== '/tickets/new') : path.startsWith(href);
  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto">
      {links.map(l => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${active(l.href) ? 'bg-brand-50 text-brand' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
