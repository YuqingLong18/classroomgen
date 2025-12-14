'use client';

import React, { createContext, useContext, useState } from 'react';
import { translations, Language } from './translations';

type LanguageContextType = {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: typeof translations.en;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    // Always default to Chinese for all landing pages (login, dashboard, student view)
    // This ensures everyone lands on Chinese by default, regardless of saved preferences
    const [language, setLanguageState] = useState<Language>('zh');

    const setLanguage = (lang: Language) => {
        setLanguageState(lang);
        localStorage.setItem('classroomgen_language', lang);
    };

    const value = {
        language,
        setLanguage,
        t: translations[language],
    };

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}
