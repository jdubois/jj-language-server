/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { Logger } from '../utils/logger.js';

export interface MavenProject {
    groupId: string;
    artifactId: string;
    version: string;
    packaging: string;
    javaVersion?: string;
    sourceDirectory: string;
    testSourceDirectory: string;
    dependencies: MavenDependency[];
    modules: string[];
    parentPomPath?: string;
}

export interface MavenDependency {
    groupId: string;
    artifactId: string;
    version?: string;
    scope?: string;
    optional?: boolean;
}

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => name === 'dependency' || name === 'module' || name === 'plugin',
});

/**
 * Parse a pom.xml file and extract project metadata.
 */
export async function parsePomXml(pomPath: string, logger: Logger): Promise<MavenProject | null> {
    try {
        const content = await readFile(pomPath, 'utf-8');
        return parsePomContent(content, pomPath, logger);
    } catch (e) {
        logger.warn(`Failed to read ${pomPath}: ${e}`);
        return null;
    }
}

export function parsePomContent(content: string, pomPath: string, logger: Logger): MavenProject | null {
    try {
        const parsed = xmlParser.parse(content);
        const project = parsed?.project;
        if (!project) {
            logger.warn(`No <project> element found in ${pomPath}`);
            return null;
        }

        const parentGroupId = project.parent?.groupId;
        const parentVersion = project.parent?.version;

        const groupId = project.groupId ?? parentGroupId ?? 'unknown';
        const artifactId = project.artifactId ?? 'unknown';
        const version = project.version ?? parentVersion ?? 'unknown';
        const packaging = project.packaging ?? 'jar';

        // Extract Java version from various sources
        const javaVersion = extractJavaVersion(project);

        // Source directories
        const basedir = dirname(pomPath);
        const sourceDirectory = project.build?.sourceDirectory ?? 'src/main/java';
        const testSourceDirectory = project.build?.testSourceDirectory ?? 'src/test/java';

        // Dependencies
        const deps: MavenDependency[] = [];
        const depSection = project.dependencies?.dependency;
        if (Array.isArray(depSection)) {
            for (const d of depSection) {
                deps.push({
                    groupId: resolveProperty(d.groupId, project) ?? 'unknown',
                    artifactId: resolveProperty(d.artifactId, project) ?? 'unknown',
                    version: resolveProperty(d.version, project),
                    scope: d.scope,
                    optional: d.optional === 'true' || d.optional === true,
                });
            }
        }

        // Modules (multi-module project)
        const modules: string[] = [];
        const moduleSection = project.modules?.module;
        if (Array.isArray(moduleSection)) {
            modules.push(...moduleSection);
        } else if (typeof moduleSection === 'string') {
            modules.push(moduleSection);
        }

        return {
            groupId,
            artifactId,
            version,
            packaging,
            javaVersion,
            sourceDirectory,
            testSourceDirectory,
            dependencies: deps,
            modules,
        };
    } catch (e) {
        logger.warn(`Failed to parse pom.xml at ${pomPath}: ${e}`);
        return null;
    }
}

function extractJavaVersion(project: any): string | undefined {
    // 1. Check properties
    const props = project.properties;
    if (props) {
        if (props['maven.compiler.release']) return String(props['maven.compiler.release']);
        if (props['maven.compiler.target']) return String(props['maven.compiler.target']);
        if (props['maven.compiler.source']) return String(props['maven.compiler.source']);
        if (props['java.version']) return String(props['java.version']);
    }

    // 2. Check compiler plugin configuration
    const plugins = project.build?.plugins?.plugin;
    if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
            if (plugin.artifactId === 'maven-compiler-plugin') {
                const config = plugin.configuration;
                if (config) {
                    if (config.release) return String(config.release);
                    if (config.target) return String(config.target);
                    if (config.source) return String(config.source);
                }
            }
        }
    }

    return undefined;
}

function resolveProperty(value: string | undefined, project: any): string | undefined {
    if (!value) return undefined;
    if (typeof value !== 'string') return String(value);

    // Resolve ${property} references
    return value.replace(/\$\{([^}]+)\}/g, (_, propName: string) => {
        if (propName === 'project.groupId') return project.groupId ?? '';
        if (propName === 'project.version') return project.version ?? '';
        if (propName === 'project.artifactId') return project.artifactId ?? '';
        const props = project.properties;
        if (props && props[propName] !== undefined) return String(props[propName]);
        return `\${${propName}}`;
    });
}

/**
 * Find pom.xml files in a directory tree.
 */
export async function findPomFiles(rootDir: string): Promise<string[]> {
    const { readdir, stat } = await import('node:fs/promises');
    const files: string[] = [];

    async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 5) return;
        try {
            const entries = await readdir(dir);
            for (const entry of entries) {
                if (entry === 'node_modules' || entry === '.git' || entry === 'target') continue;
                const fullPath = join(dir, entry);
                try {
                    const s = await stat(fullPath);
                    if (s.isFile() && entry === 'pom.xml') {
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
