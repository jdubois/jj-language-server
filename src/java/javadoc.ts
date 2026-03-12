/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstNode, CstElement, IToken } from 'chevrotain';
import { isCstNode } from './cst-utils.js';
import type { JavaSymbol } from './symbol-table.js';

export interface JavadocComment {
    description: string;
    params: { name: string; description: string }[];
    returns?: string;
    throws: { type: string; description: string }[];
    since?: string;
    deprecated?: string;
    see: string[];
    author?: string;
    raw: string;
}

/**
 * Parse a Javadoc comment string (`/** ... *​/`) into structured data.
 */
export function parseJavadoc(commentText: string): JavadocComment {
    const raw = commentText;

    // Strip the opening /** and closing */
    let body = commentText.replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, '');

    // Strip leading * from each line
    body = body
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, ''))
        .join('\n')
        .trim();

    // Convert inline {@link ...} and {@code ...} to backtick notation
    body = convertInlineTags(body);

    const params: { name: string; description: string }[] = [];
    const throws: { type: string; description: string }[] = [];
    const see: string[] = [];
    let returns: string | undefined;
    let since: string | undefined;
    let deprecated: string | undefined;
    let author: string | undefined;

    // Split into description and tag sections.
    // Tags start with @ at the beginning of a line.
    const lines = body.split('\n');
    const descriptionLines: string[] = [];
    const tagLines: string[] = [];
    let inTags = false;

    for (const line of lines) {
        if (/^@\w+/.test(line.trimStart())) {
            inTags = true;
        }
        if (inTags) {
            tagLines.push(line);
        } else {
            descriptionLines.push(line);
        }
    }

    const description = descriptionLines.join('\n').trim();

    // Parse tag blocks: a tag line starts with @tagName, continuation lines don't start with @
    const tagBlocks = parseTagBlocks(tagLines);

    for (const tag of tagBlocks) {
        const tagName = tag.name.toLowerCase();
        const tagBody = tag.body.trim();

        switch (tagName) {
            case 'param': {
                const match = tagBody.match(/^(\S+)\s*([\s\S]*)/);
                if (match) {
                    params.push({ name: match[1], description: match[2].trim() });
                }
                break;
            }
            case 'return':
            case 'returns':
                returns = tagBody;
                break;
            case 'throws':
            case 'exception': {
                const match = tagBody.match(/^(\S+)\s*([\s\S]*)/);
                if (match) {
                    throws.push({ type: match[1], description: match[2].trim() });
                }
                break;
            }
            case 'since':
                since = tagBody;
                break;
            case 'deprecated':
                deprecated = tagBody;
                break;
            case 'see':
                see.push(tagBody);
                break;
            case 'author':
                author = tagBody;
                break;
        }
    }

    return { description, params, returns, throws, since, deprecated, see, author, raw };
}

interface TagBlock {
    name: string;
    body: string;
}

function parseTagBlocks(lines: string[]): TagBlock[] {
    const blocks: TagBlock[] = [];
    let current: TagBlock | null = null;

    for (const line of lines) {
        const match = line.trimStart().match(/^@(\w+)\s*([\s\S]*)/);
        if (match) {
            if (current) blocks.push(current);
            current = { name: match[1], body: match[2] };
        } else if (current) {
            current.body += '\n' + line;
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

function convertInlineTags(text: string): string {
    // {@link ClassName#method} → `ClassName#method`
    // {@link ClassName} → `ClassName`
    // {@code expression} → `expression`
    return text.replace(/\{@(?:link|code)\s+([^}]+)\}/g, '`$1`');
}

/**
 * Walk the CST to find the Javadoc comment attached to the node at the symbol's position.
 */
export function extractJavadocForSymbol(cst: CstNode, symbol: JavaSymbol, sourceText?: string): JavadocComment | null {
    const targetLine = symbol.line + 1; // Convert 0-based to 1-based CST line
    const javadocMap = findJavadocComments(cst, sourceText);
    return javadocMap.get(targetLine) ?? null;
}

/**
 * Format a JavadocComment into Markdown for hover display.
 */
export function formatJavadocMarkdown(doc: JavadocComment): string {
    const parts: string[] = [];

    if (doc.description) {
        parts.push(doc.description);
    }

    if (doc.deprecated !== undefined) {
        parts.push(`**@deprecated** ${doc.deprecated}`);
    }

    if (doc.params.length > 0) {
        const paramLines = doc.params.map(p => `- \`${p.name}\` — ${p.description}`);
        parts.push('**Parameters:**\n' + paramLines.join('\n'));
    }

    if (doc.returns) {
        parts.push(`**Returns:** ${doc.returns}`);
    }

    if (doc.throws.length > 0) {
        const throwLines = doc.throws.map(t => `- \`${t.type}\` — ${t.description}`);
        parts.push('**Throws:**\n' + throwLines.join('\n'));
    }

    if (doc.since) {
        parts.push(`**Since:** ${doc.since}`);
    }

    if (doc.see.length > 0) {
        const seeLines = doc.see.map(s => `- ${s}`);
        parts.push('**See also:**\n' + seeLines.join('\n'));
    }

    if (doc.author) {
        parts.push(`**Author:** ${doc.author}`);
    }

    return parts.join('\n\n');
}

/**
 * Walk the entire CST and collect all Javadoc comments, keyed by the 1-based
 * start line of the node they're attached to (not the comment's own line).
 *
 * java-parser does not reliably attach leadingComments to tokens, so we also
 * accept the raw source text and use a regex-based fallback when the CST walk
 * finds nothing.
 */
export function findJavadocComments(cst: CstNode, sourceText?: string): Map<number, JavadocComment> {
    const result = new Map<number, JavadocComment>();
    walkCstForJavadocs(cst, result);

    // Fallback: if CST-based extraction found nothing and we have source text,
    // extract Javadoc comments from the raw text and map them to the next
    // non-blank, non-comment line.
    if (result.size === 0 && sourceText) {
        extractJavadocsFromText(sourceText, result);
    }

    return result;
}

function extractJavadocsFromText(text: string, result: Map<number, JavadocComment>): void {
    const javadocRegex = /\/\*\*[\s\S]*?\*\//g;
    let match;
    const lines = text.split('\n');

    while ((match = javadocRegex.exec(text)) !== null) {
        const commentText = match[0];
        // Find the 1-based end line of this comment
        const textBefore = text.substring(0, match.index + commentText.length);
        const commentEndLine = textBefore.split('\n').length;

        // Find the next non-blank, non-comment line after the comment
        let nextDeclLine = -1;
        for (let i = commentEndLine; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.length > 0 && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
                nextDeclLine = i + 1; // 1-based
                break;
            }
        }

        if (nextDeclLine > 0) {
            const doc = parseJavadoc(commentText);
            result.set(nextDeclLine, doc);
        }
    }
}

function walkCstForJavadocs(node: CstNode, result: Map<number, JavadocComment>): void {
    // java-parser attaches leadingComments on CstNode objects
    const nodeWithComments = node as CstNode & { leadingComments?: IToken[] };
    if (nodeWithComments.leadingComments) {
        for (const comment of nodeWithComments.leadingComments) {
            if (comment.image.startsWith('/**') && comment.image.endsWith('*/')) {
                const firstToken = findFirstTokenInNode(node);
                const nodeStartLine = firstToken?.startLine ?? 1;
                const doc = parseJavadoc(comment.image);
                result.set(nodeStartLine, doc);
            }
        }
    }

    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                walkCstForJavadocs(child, result);
            }
        }
    }
}

function findFirstTokenInNode(node: CstNode): IToken | undefined {
    for (const children of Object.values(node.children)) {
        if (!children) continue;
        for (const child of children as CstElement[]) {
            if (isCstNode(child)) {
                const found = findFirstTokenInNode(child);
                if (found) return found;
            } else {
                return child as IToken;
            }
        }
    }
    return undefined;
}
