/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { MavenDependency } from './maven.js';
import type { GradleDependency } from './gradle.js';

export interface ResolvedDependency {
    groupId: string;
    artifactId: string;
    version: string;
    jarPath: string;
    sourceJarPath?: string;
    scope: string;
}

export interface ResolvedClasspath {
    dependencies: ResolvedDependency[];
    jdkPath?: string;
    jdkVersion?: string;
    unresolvedCount: number;
}

export interface JdkInfo {
    path: string;
    version?: string;
}

/**
 * Compute the expected Maven local repository path for a dependency.
 */
export function computeMavenJarPath(
    groupId: string,
    artifactId: string,
    version: string,
    m2Root?: string
): string {
    const root = m2Root ?? join(homedir(), '.m2', 'repository');
    const groupPath = groupId.replace(/\./g, '/');
    return join(root, groupPath, artifactId, version, `${artifactId}-${version}.jar`);
}

/**
 * Compute the expected Maven source JAR path for a dependency.
 */
export function computeMavenSourceJarPath(
    groupId: string,
    artifactId: string,
    version: string,
    m2Root?: string
): string {
    const root = m2Root ?? join(homedir(), '.m2', 'repository');
    const groupPath = groupId.replace(/\./g, '/');
    return join(root, groupPath, artifactId, version, `${artifactId}-${version}-sources.jar`);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve Maven dependencies to actual JAR file paths on disk.
 */
export async function resolveMavenClasspath(
    dependencies: MavenDependency[],
    m2Root?: string
): Promise<{ resolved: ResolvedDependency[]; unresolvedCount: number }> {
    const resolved: ResolvedDependency[] = [];
    let unresolvedCount = 0;

    const results = await Promise.all(
        dependencies.map(async (dep) => {
            if (!dep.version) {
                return null;
            }

            const jarPath = computeMavenJarPath(dep.groupId, dep.artifactId, dep.version, m2Root);
            const exists = await fileExists(jarPath);

            if (!exists) {
                return null;
            }

            const sourceJarPath = computeMavenSourceJarPath(dep.groupId, dep.artifactId, dep.version, m2Root);
            const sourceExists = await fileExists(sourceJarPath);

            return {
                groupId: dep.groupId,
                artifactId: dep.artifactId,
                version: dep.version,
                jarPath,
                sourceJarPath: sourceExists ? sourceJarPath : undefined,
                scope: dep.scope ?? 'compile',
            } satisfies ResolvedDependency;
        })
    );

    for (let i = 0; i < dependencies.length; i++) {
        const result = results[i];
        if (result) {
            resolved.push(result);
        } else if (dependencies[i].version) {
            unresolvedCount++;
        }
    }

    return { resolved, unresolvedCount };
}

/**
 * Compute the Gradle modules cache base directory for a dependency.
 */
export function computeGradleCacheDir(
    group: string,
    name: string,
    version: string,
    gradleHome?: string
): string {
    const root = gradleHome ?? join(homedir(), '.gradle');
    return join(root, 'caches', 'modules-2', 'files-2.1', group, name, version);
}

/**
 * Find JAR files inside Gradle cache hash subdirectories.
 */
async function findJarsInGradleCache(
    cacheDir: string,
    artifactName: string
): Promise<{ jarPath?: string; sourceJarPath?: string }> {
    let jarPath: string | undefined;
    let sourceJarPath: string | undefined;

    let subdirs: string[];
    try {
        subdirs = await readdir(cacheDir);
    } catch {
        return {};
    }

    for (const subdir of subdirs) {
        const subdirPath = join(cacheDir, subdir);
        let files: string[];
        try {
            files = await readdir(subdirPath);
        } catch {
            continue;
        }

        for (const file of files) {
            if (!file.endsWith('.jar')) continue;

            const filePath = join(subdirPath, file);
            if (file === `${artifactName}-sources.jar` || file.endsWith('-sources.jar')) {
                sourceJarPath ??= filePath;
            } else if (file.endsWith('.jar') && !file.endsWith('-javadoc.jar')) {
                jarPath ??= filePath;
            }
        }
    }

    return { jarPath, sourceJarPath };
}

/**
 * Resolve Gradle dependencies to actual JAR file paths on disk.
 */
export async function resolveGradleClasspath(
    dependencies: GradleDependency[],
    gradleHome?: string
): Promise<{ resolved: ResolvedDependency[]; unresolvedCount: number }> {
    const resolved: ResolvedDependency[] = [];
    let unresolvedCount = 0;

    const results = await Promise.all(
        dependencies.map(async (dep) => {
            if (!dep.version) {
                return null;
            }

            const cacheDir = computeGradleCacheDir(dep.group, dep.name, dep.version, gradleHome);
            const { jarPath, sourceJarPath } = await findJarsInGradleCache(cacheDir, `${dep.name}-${dep.version}`);

            if (!jarPath) {
                return null;
            }

            return {
                groupId: dep.group,
                artifactId: dep.name,
                version: dep.version,
                jarPath,
                sourceJarPath,
                scope: dep.configuration,
            } satisfies ResolvedDependency;
        })
    );

    for (let i = 0; i < dependencies.length; i++) {
        const result = results[i];
        if (result) {
            resolved.push(result);
        } else if (dependencies[i].version) {
            unresolvedCount++;
        }
    }

    return { resolved, unresolvedCount };
}

/**
 * Try to detect the JDK version from the release file.
 */
async function detectJdkVersion(jdkPath: string): Promise<string | undefined> {
    try {
        const releaseFile = join(jdkPath, 'release');
        const content = await readFile(releaseFile, 'utf-8');
        const match = content.match(/JAVA_VERSION="([^"]+)"/);
        return match?.[1];
    } catch {
        return undefined;
    }
}

/**
 * Resolve the JDK installation path and version.
 */
export async function resolveJdkPath(javaHome?: string): Promise<JdkInfo | undefined> {
    const jdkPath = javaHome ?? process.env.JAVA_HOME;
    if (!jdkPath) {
        return undefined;
    }

    // JDK 9+ uses jmods directory
    const jmodsExists = await fileExists(join(jdkPath, 'jmods'));
    if (jmodsExists) {
        const version = await detectJdkVersion(jdkPath);
        return { path: jdkPath, version };
    }

    // JDK 8 uses lib/rt.jar
    const rtJarExists = await fileExists(join(jdkPath, 'lib', 'rt.jar'));
    if (rtJarExists) {
        const version = await detectJdkVersion(jdkPath);
        return { path: jdkPath, version: version ?? '1.8' };
    }

    return undefined;
}

/**
 * Resolve the full project classpath from Maven/Gradle dependencies and JDK.
 */
export async function resolveProjectClasspath(options: {
    mavenDeps?: MavenDependency[];
    gradleDeps?: GradleDependency[];
    javaHome?: string;
    m2Root?: string;
    gradleHome?: string;
}): Promise<ResolvedClasspath> {
    const [mavenResult, gradleResult, jdkInfo] = await Promise.all([
        options.mavenDeps
            ? resolveMavenClasspath(options.mavenDeps, options.m2Root)
            : Promise.resolve({ resolved: [] as ResolvedDependency[], unresolvedCount: 0 }),
        options.gradleDeps
            ? resolveGradleClasspath(options.gradleDeps, options.gradleHome)
            : Promise.resolve({ resolved: [] as ResolvedDependency[], unresolvedCount: 0 }),
        resolveJdkPath(options.javaHome),
    ]);

    return {
        dependencies: [...mavenResult.resolved, ...gradleResult.resolved],
        jdkPath: jdkInfo?.path,
        jdkVersion: jdkInfo?.version,
        unresolvedCount: mavenResult.unresolvedCount + gradleResult.unresolvedCount,
    };
}
