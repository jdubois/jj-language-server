/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { stat, readdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MavenDependency } from './maven.js';
import type { GradleDependency } from './gradle.js';
import type { Logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

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
 *
 * Strategy:
 *  1. Try running `mvn dependency:build-classpath` or `gradle dependencies`
 *     to get the real, fully-resolved transitive classpath (including downloads).
 *  2. Fall back to scanning local caches (~/.m2, ~/.gradle) if the build tool
 *     is not available or the command fails.
 */
export async function resolveProjectClasspath(options: {
    mavenDeps?: MavenDependency[];
    gradleDeps?: GradleDependency[];
    javaHome?: string;
    m2Root?: string;
    gradleHome?: string;
    projectRoot?: string;
    logger?: Logger;
}): Promise<ResolvedClasspath> {
    const logger = options.logger;
    const dependencies: ResolvedDependency[] = [];
    let unresolvedCount = 0;

    // ── Maven ──────────────────────────────────────────────────────────
    if (options.projectRoot && existsSync(join(options.projectRoot, 'pom.xml'))) {
        // Try real Maven resolution first
        const mavenResult = await runMavenBuildClasspath(options.projectRoot, logger);
        if (mavenResult) {
            dependencies.push(...mavenResult);
            logger?.info(`Maven: resolved ${mavenResult.length} dependencies via mvn dependency:build-classpath`);
        } else if (options.mavenDeps) {
            // Fall back to local cache scan
            logger?.info('Maven CLI not available or failed; falling back to local cache scan');
            const fallback = await resolveMavenClasspath(options.mavenDeps, options.m2Root);
            dependencies.push(...fallback.resolved);
            unresolvedCount += fallback.unresolvedCount;
        }
    } else if (options.mavenDeps) {
        const fallback = await resolveMavenClasspath(options.mavenDeps, options.m2Root);
        dependencies.push(...fallback.resolved);
        unresolvedCount += fallback.unresolvedCount;
    }

    // ── Gradle ─────────────────────────────────────────────────────────
    if (options.projectRoot && (
        existsSync(join(options.projectRoot, 'build.gradle')) ||
        existsSync(join(options.projectRoot, 'build.gradle.kts'))
    )) {
        const gradleResult = await runGradleDependencyClasspath(options.projectRoot, logger);
        if (gradleResult) {
            dependencies.push(...gradleResult);
            logger?.info(`Gradle: resolved ${gradleResult.length} dependencies via gradle`);
        } else if (options.gradleDeps) {
            logger?.info('Gradle CLI not available or failed; falling back to local cache scan');
            const fallback = await resolveGradleClasspath(options.gradleDeps, options.gradleHome);
            dependencies.push(...fallback.resolved);
            unresolvedCount += fallback.unresolvedCount;
        }
    } else if (options.gradleDeps) {
        const fallback = await resolveGradleClasspath(options.gradleDeps, options.gradleHome);
        dependencies.push(...fallback.resolved);
        unresolvedCount += fallback.unresolvedCount;
    }

    // ── JDK ────────────────────────────────────────────────────────────
    const jdkInfo = await resolveJdkPath(options.javaHome);

    return {
        dependencies,
        jdkPath: jdkInfo?.path,
        jdkVersion: jdkInfo?.version,
        unresolvedCount,
    };
}

// ── Real Maven resolution ─────────────────────────────────────────────────

/**
 * Run `mvn dependency:build-classpath` to get the fully-resolved classpath
 * including all transitive dependencies. Maven will download missing artifacts
 * automatically.
 */
export async function runMavenBuildClasspath(
    projectRoot: string,
    logger?: Logger,
): Promise<ResolvedDependency[] | null> {
    // Prefer the Maven wrapper (mvnw) if present, otherwise system mvn
    const mvnw = join(projectRoot, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
    const mvnCmd = existsSync(mvnw) ? mvnw : 'mvn';

    try {
        const { stdout } = await execFileAsync(
            mvnCmd,
            [
                'dependency:build-classpath',
                '-DincludeScope=runtime',   // runtime includes compile + runtime deps
                '-Dmdep.outputFile=/dev/stdout',
                '-q',       // quiet mode — only the classpath
                '--batch-mode',
                '--no-transfer-progress',
            ],
            {
                cwd: projectRoot,
                timeout: 120_000,   // 2 minutes
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, MAVEN_OPTS: process.env.MAVEN_OPTS ?? '' },
            },
        );

        return parseBuildClasspathOutput(stdout, projectRoot, logger);
    } catch (err: any) {
        logger?.info(`mvn dependency:build-classpath failed: ${err.message?.slice(0, 200)}`);

        // Also try with -Dmdep.outputFile writing to a temp file (some Maven versions need it)
        return runMavenBuildClasspathViaFile(projectRoot, mvnCmd, logger);
    }
}

/**
 * Fallback: write classpath to a temp file instead of stdout.
 */
async function runMavenBuildClasspathViaFile(
    projectRoot: string,
    mvnCmd: string,
    logger?: Logger,
): Promise<ResolvedDependency[] | null> {
    const { mkdtemp, readFile: rf, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const tmpDir = await mkdtemp(join(tmpdir(), 'jj-cp-'));
    const cpFile = join(tmpDir, 'classpath.txt');

    try {
        await execFileAsync(
            mvnCmd,
            [
                'dependency:build-classpath',
                '-DincludeScope=runtime',
                `-Dmdep.outputFile=${cpFile}`,
                '--batch-mode',
                '--no-transfer-progress',
            ],
            {
                cwd: projectRoot,
                timeout: 120_000,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        const content = await rf(cpFile, 'utf-8');
        return parseBuildClasspathOutput(content, projectRoot, logger);
    } catch (err: any) {
        logger?.info(`mvn dependency:build-classpath (file) also failed: ${err.message?.slice(0, 200)}`);
        return null;
    } finally {
        try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
}

/**
 * Parse the classpath string output from `mvn dependency:build-classpath`.
 * The output is a single line of JAR paths separated by the OS path delimiter.
 */
function parseBuildClasspathOutput(
    stdout: string,
    _projectRoot: string,
    _logger?: Logger,
): ResolvedDependency[] {
    // The output may contain multiple lines (e.g. multi-module projects).
    // Each relevant line is a classpath string separated by ':' (Unix) or ';' (Windows).
    const deps: ResolvedDependency[] = [];
    const seen = new Set<string>();

    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('[')) continue; // Skip Maven log lines

        for (const entry of trimmed.split(delimiter)) {
            const jarPath = entry.trim();
            if (!jarPath || !jarPath.endsWith('.jar') || seen.has(jarPath)) continue;
            seen.add(jarPath);

            const info = parseJarPathInfo(jarPath);
            const sourceJarPath = jarPath.replace(/\.jar$/, '-sources.jar');
            deps.push({
                groupId: info.groupId,
                artifactId: info.artifactId,
                version: info.version,
                jarPath,
                sourceJarPath: existsSync(sourceJarPath) ? sourceJarPath : undefined,
                scope: 'compile',
            });
        }
    }

    return deps;
}

/**
 * Extract groupId/artifactId/version from a Maven repository JAR path.
 * Example: ~/.m2/repository/org/springframework/spring-core/6.1.0/spring-core-6.1.0.jar
 */
function parseJarPathInfo(jarPath: string): { groupId: string; artifactId: string; version: string } {
    const m2Idx = jarPath.indexOf(join('.m2', 'repository'));
    if (m2Idx >= 0) {
        const relPath = jarPath.slice(m2Idx + join('.m2', 'repository').length + 1);
        const parts = relPath.split(sep);
        if (parts.length >= 4) {
            const version = parts[parts.length - 2];
            const artifactId = parts[parts.length - 3];
            const groupId = parts.slice(0, parts.length - 3).join('.');
            return { groupId, artifactId, version };
        }
    }
    // Fallback: extract from filename
    const fileName = jarPath.split(sep).pop() ?? '';
    const match = fileName.match(/^(.+?)-(\d[\d.]*(?:-[\w.]+)?)\.jar$/);
    if (match) {
        return { groupId: 'unknown', artifactId: match[1], version: match[2] };
    }
    return { groupId: 'unknown', artifactId: fileName.replace('.jar', ''), version: 'unknown' };
}

// ── Real Gradle resolution ────────────────────────────────────────────────

/**
 * Run Gradle to get the compile classpath. Tries the Gradle wrapper first.
 */
export async function runGradleDependencyClasspath(
    projectRoot: string,
    logger?: Logger,
): Promise<ResolvedDependency[] | null> {
    const gradlew = join(projectRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    const gradleCmd = existsSync(gradlew) ? gradlew : 'gradle';

    try {
        const { mkdtemp, writeFile, readFile: rf, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');

        const tmpDir = await mkdtemp(join(tmpdir(), 'jj-gradle-'));
        const cpFile = join(tmpDir, 'classpath.txt');

        // Strategy 1: Use a custom init script with lenient configuration
        // Override the Java toolchain to use whatever JDK is available,
        // then resolve the compileClasspath.
        const initScript = join(tmpDir, 'print-classpath.gradle');
        await writeFile(initScript, `
settingsEvaluated { settings ->
    settings.gradle.allprojects { proj ->
        proj.afterEvaluate {
            // Relax toolchain requirement to use whatever JDK is available
            try {
                proj.java {
                    toolchain {
                        languageVersion = JavaLanguageVersion.of(JavaVersion.current().majorVersion)
                    }
                }
            } catch (Exception e) {
                // not a java project or no java extension, skip
            }
            // Register our classpath-printing task
            proj.tasks.register('jjPrintClasspath') {
                doLast {
                    def cp = []
                    def configs = ['compileClasspath', 'runtimeClasspath', 'compile']
                    for (cfgName in configs) {
                        try {
                            def cfg = proj.configurations.findByName(cfgName)
                            if (cfg != null && cfg.canBeResolved) {
                                cp = cfg.resolve()
                                break
                            }
                        } catch (Exception e) {
                            // try next configuration
                        }
                    }
                    def f = new File("${cpFile.replace(/\\/g, '\\\\')}")
                    def existing = f.exists() ? f.text : ''
                    def newCp = existing ? existing + System.getProperty("path.separator") + cp.join(System.getProperty("path.separator")) : cp.join(System.getProperty("path.separator"))
                    f.text = newCp
                }
            }
        }
    }
}
`);

        try {
            await execFileAsync(
                gradleCmd,
                ['--init-script', initScript, 'jjPrintClasspath', '--quiet', '--no-daemon'],
                {
                    cwd: projectRoot,
                    timeout: 180_000,
                    maxBuffer: 10 * 1024 * 1024,
                },
            );
        } catch {
            // Strategy 2: Parse `gradle dependencies` output to find JAR coordinates,
            // then look them up in the Gradle cache
            logger?.info('Gradle init script failed, trying gradle dependencies output parsing');
            const depResult = await parseGradleDependenciesOutput(projectRoot, gradleCmd, logger);
            try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
            return depResult;
        }

        let content: string;
        try {
            content = await rf(cpFile, 'utf-8');
        } catch {
            // cpFile was never written — init script task didn't run
            try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }
            return null;
        }

        const deps: ResolvedDependency[] = [];
        const seen = new Set<string>();

        for (const entry of content.trim().split(delimiter)) {
            const jarPath = entry.trim();
            if (!jarPath || !jarPath.endsWith('.jar') || seen.has(jarPath)) continue;
            seen.add(jarPath);

            const info = parseJarPathInfo(jarPath);
            const sourceJarPath = jarPath.replace(/\.jar$/, '-sources.jar');
            deps.push({
                groupId: info.groupId,
                artifactId: info.artifactId,
                version: info.version,
                jarPath,
                sourceJarPath: existsSync(sourceJarPath) ? sourceJarPath : undefined,
                scope: 'compile',
            });
        }

        try { await rm(tmpDir, { recursive: true }); } catch { /* ignore */ }

        return deps.length > 0 ? deps : null;
    } catch (err: any) {
        logger?.info(`Gradle classpath resolution failed: ${err.message?.slice(0, 200)}`);
        return null;
    }
}

/**
 * Fallback: Run `gradle dependencies --configuration compileClasspath` and parse the
 * text output to extract dependency coordinates, then locate JARs in the Gradle cache.
 *
 * This approach works even when the init script fails (e.g. toolchain version mismatch).
 */
async function parseGradleDependenciesOutput(
    projectRoot: string,
    gradleCmd: string,
    logger?: Logger,
): Promise<ResolvedDependency[] | null> {
    // Write a minimal init script to relax toolchain requirements
    const { mkdtemp, writeFile: wf, rm: rmDir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const tmpDir = await mkdtemp(join(tmpdir(), 'jj-gradle-deps-'));
    const relaxScript = join(tmpDir, 'relax-toolchain.gradle');
    await wf(relaxScript, `
settingsEvaluated { settings ->
    settings.gradle.allprojects { proj ->
        proj.afterEvaluate {
            try {
                proj.java {
                    toolchain {
                        languageVersion = JavaLanguageVersion.of(JavaVersion.current().majorVersion)
                    }
                }
            } catch (Exception e) {}
        }
    }
}
`);

    try {
        const { stdout } = await execFileAsync(
            gradleCmd,
            ['--init-script', relaxScript, 'dependencies', '--configuration', 'compileClasspath', '--no-daemon', '--quiet'],
            {
                cwd: projectRoot,
                timeout: 120_000,
                maxBuffer: 10 * 1024 * 1024,
            },
        );

        return parseGradleDepTreeOutput(stdout, logger);
    } catch {
        // Try without specifying a configuration
        try {
            const { stdout } = await execFileAsync(
                gradleCmd,
                ['--init-script', relaxScript, 'dependencies', '--no-daemon', '--quiet'],
                {
                    cwd: projectRoot,
                    timeout: 120_000,
                    maxBuffer: 10 * 1024 * 1024,
                },
            );

            return parseGradleDepTreeOutput(stdout, logger);
        } catch (err: any) {
            logger?.info(`Gradle dependencies output also failed: ${err.message?.slice(0, 200)}`);
            return null;
        }
    } finally {
        try { await rmDir(tmpDir, { recursive: true }); } catch { /* ignore */ }
    }
}

/**
 * Parse Gradle `dependencies` command output. Each dependency line looks like:
 *   +--- org.springframework.boot:spring-boot-starter-web -> 3.2.0
 *   |    +--- org.springframework:spring-core:6.1.1
 *   \--- com.fasterxml.jackson.core:jackson-databind:2.16.0 (*)
 */
function parseGradleDepTreeOutput(
    stdout: string,
    logger?: Logger,
): ResolvedDependency[] | null {
    const deps: ResolvedDependency[] = [];
    const seen = new Set<string>();
    const gradleHome = join(homedir(), '.gradle');

    // Match lines like: +--- group:name:version or \--- group:name:version -> resolvedVersion
    const depLineRegex = /[+\\|]\-\-\-\s+(\S+):(\S+):(\S+?)(?:\s+->\s+(\S+))?(?:\s+\([\w*]+\))?$/;

    for (const line of stdout.split('\n')) {
        const match = line.match(depLineRegex);
        if (!match) continue;

        const group = match[1];
        const name = match[2];
        const version = match[4] ?? match[3]; // prefer resolved version
        const key = `${group}:${name}:${version}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Try to find the JAR in Gradle cache
        const cacheDir = join(gradleHome, 'caches', 'modules-2', 'files-2.1', group, name, version);
        let jarPath: string | undefined;
        let sourceJarPath: string | undefined;

        try {
            for (const hashDir of readdirSync(cacheDir)) {
                const hashPath = join(cacheDir, hashDir);
                try {
                    for (const file of readdirSync(hashPath)) {
                        if (file === `${name}-${version}.jar`) {
                            jarPath = join(hashPath, file);
                        } else if (file === `${name}-${version}-sources.jar`) {
                            sourceJarPath = join(hashPath, file);
                        }
                    }
                } catch { /* hash dir might not be readable */ }
            }
        } catch { /* cache dir doesn't exist = dependency not downloaded */ }

        if (jarPath) {
            deps.push({
                groupId: group,
                artifactId: name,
                version,
                jarPath,
                sourceJarPath,
                scope: 'compile',
            });
        }
    }

    logger?.info(`Parsed ${deps.length} dependencies from Gradle dependency tree`);
    return deps.length > 0 ? deps : null;
}
