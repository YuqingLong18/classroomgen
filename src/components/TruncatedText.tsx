import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface TruncatedTextProps {
    text: string;
    lines?: number;
    className?: string;
}

export function TruncatedText({ text, lines = 5, className = '' }: TruncatedTextProps) {
    const { t } = useLanguage();
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className={className}>
            <p
                className={`transition-all duration-200 ${isExpanded ? '' : 'overflow-hidden'}`}
                style={isExpanded ? {} : {
                    display: '-webkit-box',
                    WebkitLineClamp: lines,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {text}
            </p>
            {(text.split('\n').length > lines || text.length > lines * 50) && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsExpanded(!isExpanded);
                    }}
                    className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent-strong)] mt-1 font-medium"
                >
                    {isExpanded ? t.common.showLess : t.common.showMore}
                </button>
            )}
        </div>
    );
}
