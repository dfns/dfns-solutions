'use client';

import { usePathname } from 'next/navigation';

export function Header() {
    const pathname = usePathname();

    return (
        <header className="site-header">
            <div className="site-header-inner">
                <a href="/" className="logo">
                    X402-Sessions
                </a>
                <div className="header-right">
                    <a href="/slot" className={pathname === '/slot' ? 'active' : ''}>
                        Slot
                    </a>
                </div>
            </div>
        </header>
    );
}
