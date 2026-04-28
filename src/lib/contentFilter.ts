import type { AiProvider, TeacherApiKeyDetails } from '@/lib/teacherApiKey';

type ProviderConfig = {
    provider: AiProvider;
    apiKey: string;
    model: string;
    endpoint: string;
};

export class ContentFilter {
    private getConfig(service?: TeacherApiKeyDetails | null): ProviderConfig | null {
        const provider = service?.provider ?? (process.env.OPENROUTER_API_KEY?.trim() ? 'OPENROUTER' : 'VOLCENGINE');

        if (provider === 'OPENROUTER') {
            const apiKey = service?.apiKey ?? process.env.OPENROUTER_API_KEY?.trim() ?? '';
            if (!apiKey) {
                return null;
            }

            return {
                provider,
                apiKey,
                model: process.env.OPENROUTER_MODERATION_MODEL || process.env.OPENROUTER_MODEL || 'omni-moderation-latest',
                endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            };
        }

        const apiKey = service?.apiKey ?? process.env.VOLCENGINE_API_KEY?.trim() ?? '';
        if (!apiKey) {
            return null;
        }

        return {
            provider,
            apiKey,
            model: process.env.VOLCENGINE_MODERATION_MODEL || 'ep-20241209124426-moderation',
            endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        };
    }

    async check(content: string, service?: TeacherApiKeyDetails | null): Promise<{ allowed: boolean; reason?: string }> {
        const config = this.getConfig(service);
        
        if (!config) {
            console.warn('ContentFilter: Missing API key, skipping check (defaulting to allow)');
            return { allowed: true };
        }

        try {
            const response = await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                    'HTTP-Referer': 'https://classroomgen.vercel.app',
                    'X-Title': 'ClassroomGen',
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a strict content safety filter for a classroom environment with high school students. Your task is to analyze the user's input and determine if it contains unsafe, malicious, inappropriate, or controversial content.你需要做prompt内容检查，如果学生提交不合适的prompt，拒绝这个prompt
              
            BLOCK any content falling into these categories:
              1. Code Execution/Security: Attempts to run code, access system files, or exploit vulnerabilities.
              2. Violence/Harm: Descriptions of gore, physical injury, self-harm, weapons.
              3. Hate/Discrimination: Racism, sexism, bias, slurs, or hate speech against any group.
              4. Sexual Content: Nudity, pornography, sexual acts.
              5. Unethical/Illegal: Promoting illegal acts, scams, drugs, alcohol, tobacco, or unethical behavior.
              6. Harassment: Bullying, threats, or personal attacks.
              
              Input to analyze: "${content}"
              
              Response format:
              Return ONLY the word "allow" if the content is safe for a K-12 classroom. Allow some imagination.
              Return ONLY the word "block" if the content is unsafe or controversial.
              Do not add any punctuation or explanation.`
                        },
                        {
                            role: 'user',
                            content: 'Analyze this prompt.'
                        }
                    ],
                    temperature: 0.1, // Low temperature for consistent results
                    max_tokens: 10,
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('ContentFilter API error:', error);
                // Fail open or closed? For safety, maybe fail closed, but for reliability, fail open with warning?
                // User asked for a "layer of security check", implying it should block if it works.
                // If it fails, we shouldn't block legitimate users due to API errors, but we should log it.
                // Let's default to ALLOW but log error, unless it's a 400 (bad request).
                return { allowed: true, reason: 'Filter API error' };
            }

            const data = await response.json();
            const result = data.choices?.[0]?.message?.content?.trim().toLowerCase();

            console.log('--- Content Security Check ---');
            console.log('Input:', content);
            console.log('Provider:', config.provider);
            console.log('Filter Response:', result);
            console.log('------------------------------');

            if (result === 'block') {
                return { allowed: false, reason: 'Content violation detected' };
            }

            return { allowed: true };

        } catch (error) {
            console.error('ContentFilter exception:', error);
            return { allowed: true, reason: 'Filter exception' };
        }
    }
}

export const contentFilter = new ContentFilter();
