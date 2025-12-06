/**
 * Security utility to sanitize prompts and validate AI responses
 * to prevent command injection attacks
 */

// Patterns that indicate potential command injection attempts
const DANGEROUS_PATTERNS = [
    /\$\([^)]*\)/g, // Command substitution: $(command)
    /`[^`]*`/g, // Backtick command substitution: `command`
    /;\s*\w+/g, // Command chaining: ; command
    /\|\s*\w+/g, // Pipe to command: | command
    /&&\s*\w+/g, // AND command: && command
    /\|\|\s*\w+/g, // OR command: || command
    />\s*\/\w+/g, // Redirect to file: > /path
    /<\s*\/\w+/g, // Redirect from file: < /path
    /\$\{[^}]*\}/g, // Variable expansion: ${var}
    /\$\w+/g, // Variable reference: $var
    /eval\s*\(/gi, // eval() function
    /exec\s*\(/gi, // exec() function
    /system\s*\(/gi, // system() function
    /\/bin\/(sh|bash|zsh|fish)/gi, // Shell paths
    /\b(bash|sh|zsh|fish)\s+-c/gi, // Shell command execution: bash -c
];

// Suspicious keywords that might indicate injection attempts
const SUSPICIOUS_KEYWORDS = [
    'rm -rf',
    'chmod',
    'chown',
    'sudo',
    'passwd',
    '/etc/passwd',
    '/etc/shadow',
    'curl',
    'wget',
    'nc ',
    'netcat',
    'base64',
    'python -c',
    'perl -e',
    'ruby -e',
    'node -e',
];

export interface SanitizationResult {
    safe: boolean;
    sanitized: string;
    warnings: string[];
}

/**
 * Sanitize user input to remove or flag dangerous patterns
 */
export function sanitizePrompt(prompt: string): SanitizationResult {
    const warnings: string[] = [];
    let sanitized = prompt;
    let safe = true;

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(prompt)) {
            warnings.push(`Detected suspicious pattern: ${pattern.source}`);
            safe = false;
            // Remove the dangerous pattern
            sanitized = sanitized.replace(pattern, '[REMOVED]');
        }
    }

    // Check for suspicious keywords
    const lowerPrompt = prompt.toLowerCase();
    for (const keyword of SUSPICIOUS_KEYWORDS) {
        if (lowerPrompt.includes(keyword.toLowerCase())) {
            warnings.push(`Detected suspicious keyword: ${keyword}`);
            safe = false;
        }
    }

    // Additional validation: check for excessive special characters
    const specialCharCount = (prompt.match(/[`$;|&<>]/g) || []).length;
    if (specialCharCount > 5) {
        warnings.push(`Excessive special characters detected (${specialCharCount})`);
        safe = false;
    }

    return {
        safe,
        sanitized,
        warnings,
    };
}

/**
 * Validate AI response to ensure it doesn't contain executable code
 */
export function validateAIResponse(response: string): SanitizationResult {
    const warnings: string[] = [];
    let safe = true;

    // Check if response contains shell command patterns
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(response)) {
            warnings.push(`AI response contains suspicious pattern: ${pattern.source}`);
            safe = false;
        }
    }

    // Check for code block markers that might contain executable code
    const codeBlockPattern = /```(?:bash|sh|shell|zsh|fish)\s*\n([\s\S]*?)```/gi;
    const matches = response.match(codeBlockPattern);
    if (matches && matches.length > 0) {
        warnings.push('AI response contains shell code blocks');
        // This might be intentional (e.g., teaching), so we'll flag but not fail
    }

    return {
        safe,
        sanitized: response,
        warnings,
    };
}

/**
 * Log security warnings for monitoring
 */
export function logSecurityWarning(
    type: 'prompt' | 'response',
    warnings: string[],
    content: string,
    metadata?: Record<string, unknown>
) {
    if (warnings.length === 0) return;

    console.warn('🔒 SECURITY WARNING:', {
        type,
        warnings,
        contentPreview: content.substring(0, 100),
        timestamp: new Date().toISOString(),
        ...metadata,
    });
}
