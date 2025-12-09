'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';

export function LanguageToggle() {
    const { language, setLanguage } = useLanguage();

    return (
        <button
            onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)] transition shadow-sm"
            title={language === 'en' ? 'Switch to Chinese' : 'Switch to English'}
        >
            <span className={language === 'en' ? 'font-bold text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}>EN</span>
            <span className="text-[var(--color-border)]">/</span>
            <span className={language === 'zh' ? 'font-bold text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}>ZH</span>
        </button>
    );
}
