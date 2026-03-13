/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../utils/logger.js';

export interface GradleProject {
    buildFile: string;
    isKotlinDsl: boolean;
    javaVersion?: string;
    sourceCompatibility?: string;
    targetCompatibility?: string;
    dependencies: GradleDependency[];
    plugins: string[];
    sourceDirectories: string[];
}

export interface GradleDependency {
    configuration: string;
    group: string;
    name: string;
    version?: string;
}

/**
 * Parse a build.gradle or build.gradle.kts file.
 * Uses regex-based extraction since Groovy/Kotlin DSL aren't easy to parse formally.
 */
export async function parseGradleBuild(buildPath: string, logger: Logger): Promise<GradleProject | null> {
    try {
        const content = await readFile(buildPath, 'utf-8');
        return parseGradleContent(content, buildPath, logger);
    } catch (e) {
        logger.warn(`Failed to read ${buildPath}: ${e}`);
        return null;
    }
}

export function parseGradleContent(content: string, buildPath: string, logger: Logger): GradleProject | null {
    try {
        const isKotlinDsl = buildPath.endsWith('.kts');

        const javaVersion = extractGradleJavaVersion(content);
        const dependencies = extractGradleDependencies(content);
        const plugins = extractGradlePlugins(content);

        // Source compatibility
        const sourceCompat = extractProperty(content, 'sourceCompatibility');
        const targetCompat = extractProperty(content, 'targetCompatibility');

        // Default source directories
        const sourceDirectories = ['src/main/java'];
        if (content.includes('src/main/kotlin')) {
            sourceDirectories.push('src/main/kotlin');
        }

        return {
            buildFile: buildPath,
            isKotlinDsl,
            javaVersion,
            sourceCompatibility: sourceCompat,
            targetCompatibility: targetCompat,
            dependencies,
            plugins,
            sourceDirectories,
        };
    } catch (e) {
        logger.warn(`Failed to parse Gradle build at ${buildPath}: ${e}`);
        return null;
    }
}

function extractGradleJavaVersion(content: string): string | undefined {
    // Java toolchain: java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }
    const toolchainMatch = content.match(/JavaLanguageVersion\.of\(\s*(\d+)\s*\)/);
    if (toolchainMatch) return toolchainMatch[1];

    // sourceCompatibility = '17' or = JavaVersion.VERSION_17
    const sourceCompat = extractProperty(content, 'sourceCompatibility');
    if (sourceCompat) {
        const versionMatch = sourceCompat.match(/VERSION_(\d+)/);
        if (versionMatch) return versionMatch[1];
        const numMatch = sourceCompat.match(/(\d+)/);
        if (numMatch) return numMatch[1];
    }

    return undefined;
}

function extractGradleDependencies(content: string): GradleDependency[] {
    const deps: GradleDependency[] = [];

    // Match: implementation 'group:name:version'
    // Match: implementation "group:name:version"
    // Supports all standard and custom configurations (any word before a string with ':')
    // The quoted string must contain ':' (group:artifact format) and no commas (to avoid matching map-style deps)
    const stringDepRegex = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|developmentOnly|checkstyle|[a-zA-Z]+)\s*[\(]?\s*['"]([^'",]*:[^'",]+)['"]\s*[\)]?/g;
    let match;
    while ((match = stringDepRegex.exec(content)) !== null) {
        // Skip false positives: lines that are clearly not dependencies
        const config = match[1];
        if (['plugins', 'id', 'apply', 'task', 'project', 'file', 'files', 'group', 'version', 'description'].includes(config)) continue;
        const parts = match[2].split(':');
        if (parts.length >= 2) {
            deps.push({
                configuration: match[1],
                group: parts[0],
                name: parts[1],
                version: parts[2],
            });
        }
    }

    // Match: implementation(group = "...", name = "...", version = "...") — Kotlin DSL
    // Match: implementation group: '...', name: '...', version: '...'   — Groovy DSL
    const mapDepRegex = /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|developmentOnly|checkstyle|[a-zA-Z]+)\s*\(?\s*group\s*[:=]\s*['"]([^'"]+)['"]\s*,\s*name\s*[:=]\s*['"]([^'"]+)['"]\s*(?:,\s*version\s*[:=]\s*['"]([^'"]+)['"])?\s*\)?/g;
    while ((match = mapDepRegex.exec(content)) !== null) {
        deps.push({
            configuration: match[1],
            group: match[2],
            name: match[3],
            version: match[4],
        });
    }

    return deps;
}

function extractGradlePlugins(content: string): string[] {
    const plugins: string[] = [];

    // Match: id 'java' or id("java")
    const pluginRegex = /\bid\s*[\(]?\s*['"]([^'"]+)['"]\s*[\)]?/g;
    let match;
    while ((match = pluginRegex.exec(content)) !== null) {
        plugins.push(match[1]);
    }

    // Match: apply plugin: 'java'
    const applyRegex = /apply\s+plugin:\s*['"]([^'"]+)['"]/g;
    while ((match = applyRegex.exec(content)) !== null) {
        plugins.push(match[1]);
    }

    return plugins;
}

function extractProperty(content: string, name: string): string | undefined {
    // Match: sourceCompatibility = '17' or sourceCompatibility = JavaVersion.VERSION_17
    const regex = new RegExp(`${name}\\s*=\\s*['"]?([^'"\n;]+)['"]?`);
    const match = content.match(regex);
    return match ? match[1].trim() : undefined;
}

/**
 * Find Gradle build files in a directory tree.
 */
export async function findGradleBuildFiles(rootDir: string): Promise<string[]> {
    const { readdir, stat: statFn } = await import('node:fs/promises');
    const files: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 5) return;
        try {
            const entries = await readdir(dir);
            for (const entry of entries) {
                if (entry === 'node_modules' || entry === '.git' || entry === 'build' || entry === '.gradle') continue;
                const fullPath = join(dir, entry);
                try {
                    const s = await statFn(fullPath);
                    if (s.isFile() && (entry === 'build.gradle' || entry === 'build.gradle.kts')) {
                        files.push(fullPath);
                    } else if (s.isDirectory()) {
                        await walk(fullPath, depth + 1);
                    }
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    await walk(rootDir, 0);
    return files;
}

/**
 * Detect if a directory is a Gradle project.
 */
export async function isGradleProject(dir: string): Promise<boolean> {
    try {
        await stat(join(dir, 'build.gradle'));
        return true;
    } catch { /* not found */ }
    try {
        await stat(join(dir, 'build.gradle.kts'));
        return true;
    } catch { /* not found */ }
    return false;
}
