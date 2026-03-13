/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    computeMavenJarPath,
    computeMavenSourceJarPath,
    computeGradleCacheDir,
    resolveMavenClasspath,
    resolveGradleClasspath,
    resolveJdkPath,
    resolveProjectClasspath,
    runMavenBuildClasspath,
} from './classpath-resolver.js';
import type { MavenDependency } from './maven.js';
import type { GradleDependency } from './gradle.js';

describe('classpath-resolver', () => {
    let tempDir: string;

    beforeAll(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'classpath-test-'));
    });

    afterAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe('Maven path computation', () => {
        it('computes correct JAR path for a dependency', () => {
            const path = computeMavenJarPath(
                'org.springframework',
                'spring-core',
                '6.1.0',
                '/fake/.m2/repository'
            );
            expect(path).toBe(
                '/fake/.m2/repository/org/springframework/spring-core/6.1.0/spring-core-6.1.0.jar'
            );
        });

        it('computes correct source JAR path', () => {
            const path = computeMavenSourceJarPath(
                'org.springframework',
                'spring-core',
                '6.1.0',
                '/fake/.m2/repository'
            );
            expect(path).toBe(
                '/fake/.m2/repository/org/springframework/spring-core/6.1.0/spring-core-6.1.0-sources.jar'
            );
        });

        it('handles deeply nested group IDs', () => {
            const path = computeMavenJarPath(
                'com.fasterxml.jackson.core',
                'jackson-databind',
                '2.16.0',
                '/repo'
            );
            expect(path).toBe(
                '/repo/com/fasterxml/jackson/core/jackson-databind/2.16.0/jackson-databind-2.16.0.jar'
            );
        });

        it('handles single-segment group IDs', () => {
            const path = computeMavenJarPath('junit', 'junit', '4.13.2', '/repo');
            expect(path).toBe('/repo/junit/junit/4.13.2/junit-4.13.2.jar');
        });
    });

    describe('Gradle path computation', () => {
        it('computes correct Gradle cache directory', () => {
            const dir = computeGradleCacheDir(
                'org.springframework',
                'spring-core',
                '6.1.0',
                '/fake/.gradle'
            );
            expect(dir).toBe(
                '/fake/.gradle/caches/modules-2/files-2.1/org.springframework/spring-core/6.1.0'
            );
        });
    });

    describe('Maven classpath resolution', () => {
        let m2Root: string;

        beforeAll(async () => {
            m2Root = join(tempDir, 'm2-repo');

            // Create a resolved dependency: spring-core with source JAR
            const springDir = join(m2Root, 'org', 'springframework', 'spring-core', '6.1.0');
            await mkdir(springDir, { recursive: true });
            await writeFile(join(springDir, 'spring-core-6.1.0.jar'), 'fake-jar');
            await writeFile(join(springDir, 'spring-core-6.1.0-sources.jar'), 'fake-sources');

            // Create a dependency without source JAR
            const commonsDir = join(m2Root, 'commons-io', 'commons-io', '2.15.0');
            await mkdir(commonsDir, { recursive: true });
            await writeFile(join(commonsDir, 'commons-io-2.15.0.jar'), 'fake-jar');
        });

        it('resolves existing Maven JARs', async () => {
            const deps: MavenDependency[] = [
                { groupId: 'org.springframework', artifactId: 'spring-core', version: '6.1.0' },
            ];
            const { resolved, unresolvedCount } = await resolveMavenClasspath(deps, m2Root);

            expect(resolved).toHaveLength(1);
            expect(resolved[0].jarPath).toContain('spring-core-6.1.0.jar');
            expect(resolved[0].sourceJarPath).toContain('spring-core-6.1.0-sources.jar');
            expect(resolved[0].scope).toBe('compile');
            expect(unresolvedCount).toBe(0);
        });

        it('resolves JAR without source JAR', async () => {
            const deps: MavenDependency[] = [
                { groupId: 'commons-io', artifactId: 'commons-io', version: '2.15.0' },
            ];
            const { resolved } = await resolveMavenClasspath(deps, m2Root);

            expect(resolved).toHaveLength(1);
            expect(resolved[0].sourceJarPath).toBeUndefined();
        });

        it('counts unresolved dependencies with versions', async () => {
            const deps: MavenDependency[] = [
                { groupId: 'com.nonexistent', artifactId: 'fake-lib', version: '1.0.0' },
            ];
            const { resolved, unresolvedCount } = await resolveMavenClasspath(deps, m2Root);

            expect(resolved).toHaveLength(0);
            expect(unresolvedCount).toBe(1);
        });

        it('skips dependencies without version', async () => {
            const deps: MavenDependency[] = [
                { groupId: 'com.example', artifactId: 'no-version' },
            ];
            const { resolved, unresolvedCount } = await resolveMavenClasspath(deps, m2Root);

            expect(resolved).toHaveLength(0);
            expect(unresolvedCount).toBe(0);
        });

        it('preserves scope from dependency', async () => {
            const deps: MavenDependency[] = [
                { groupId: 'org.springframework', artifactId: 'spring-core', version: '6.1.0', scope: 'test' },
            ];
            const { resolved } = await resolveMavenClasspath(deps, m2Root);

            expect(resolved[0].scope).toBe('test');
        });
    });

    describe('Gradle classpath resolution', () => {
        let gradleHome: string;

        beforeAll(async () => {
            gradleHome = join(tempDir, 'gradle-home');

            // Create Gradle modules cache structure with hash subdirectories
            const cacheDir = join(
                gradleHome, 'caches', 'modules-2', 'files-2.1',
                'org.springframework', 'spring-core', '6.1.0'
            );
            const hashDir = join(cacheDir, 'abc123def456');
            await mkdir(hashDir, { recursive: true });
            await writeFile(join(hashDir, 'spring-core-6.1.0.jar'), 'fake-jar');

            // Add source JAR in a different hash directory
            const sourceHashDir = join(cacheDir, 'fed654cba321');
            await mkdir(sourceHashDir, { recursive: true });
            await writeFile(join(sourceHashDir, 'spring-core-6.1.0-sources.jar'), 'fake-sources');
        });

        it('resolves existing Gradle cached JARs', async () => {
            const deps: GradleDependency[] = [
                { configuration: 'implementation', group: 'org.springframework', name: 'spring-core', version: '6.1.0' },
            ];
            const { resolved, unresolvedCount } = await resolveGradleClasspath(deps, gradleHome);

            expect(resolved).toHaveLength(1);
            expect(resolved[0].jarPath).toContain('spring-core-6.1.0.jar');
            expect(resolved[0].sourceJarPath).toContain('spring-core-6.1.0-sources.jar');
            expect(resolved[0].scope).toBe('implementation');
            expect(unresolvedCount).toBe(0);
        });

        it('counts unresolved Gradle dependencies', async () => {
            const deps: GradleDependency[] = [
                { configuration: 'implementation', group: 'com.nonexistent', name: 'fake-lib', version: '1.0.0' },
            ];
            const { resolved, unresolvedCount } = await resolveGradleClasspath(deps, gradleHome);

            expect(resolved).toHaveLength(0);
            expect(unresolvedCount).toBe(1);
        });

        it('skips Gradle dependencies without version', async () => {
            const deps: GradleDependency[] = [
                { configuration: 'implementation', group: 'com.example', name: 'no-version' },
            ];
            const { resolved, unresolvedCount } = await resolveGradleClasspath(deps, gradleHome);

            expect(resolved).toHaveLength(0);
            expect(unresolvedCount).toBe(0);
        });
    });

    describe('JDK path resolution', () => {
        it('returns undefined when no JAVA_HOME is available', async () => {
            const original = process.env.JAVA_HOME;
            delete process.env.JAVA_HOME;
            try {
                const result = await resolveJdkPath();
                expect(result).toBeUndefined();
            } finally {
                if (original !== undefined) {
                    process.env.JAVA_HOME = original;
                }
            }
        });

        it('detects JDK 9+ with jmods directory', async () => {
            const jdkPath = join(tempDir, 'jdk-17');
            await mkdir(join(jdkPath, 'jmods'), { recursive: true });
            await writeFile(join(jdkPath, 'release'), 'JAVA_VERSION="17.0.9"');

            const result = await resolveJdkPath(jdkPath);
            expect(result).toBeDefined();
            expect(result!.path).toBe(jdkPath);
            expect(result!.version).toBe('17.0.9');
        });

        it('detects JDK 8 with lib/rt.jar', async () => {
            const jdkPath = join(tempDir, 'jdk-8');
            await mkdir(join(jdkPath, 'lib'), { recursive: true });
            await writeFile(join(jdkPath, 'lib', 'rt.jar'), 'fake-rt');

            const result = await resolveJdkPath(jdkPath);
            expect(result).toBeDefined();
            expect(result!.path).toBe(jdkPath);
            expect(result!.version).toBe('1.8');
        });

        it('returns undefined for invalid JDK path', async () => {
            const result = await resolveJdkPath(join(tempDir, 'nonexistent-jdk'));
            expect(result).toBeUndefined();
        });
    });

    describe('resolveProjectClasspath', () => {
        let m2Root: string;
        let gradleHome: string;

        beforeAll(async () => {
            m2Root = join(tempDir, 'integration-m2');
            gradleHome = join(tempDir, 'integration-gradle');

            // Maven dependency
            const mavenDir = join(m2Root, 'org', 'slf4j', 'slf4j-api', '2.0.9');
            await mkdir(mavenDir, { recursive: true });
            await writeFile(join(mavenDir, 'slf4j-api-2.0.9.jar'), 'fake-jar');

            // Gradle dependency
            const gradleCacheDir = join(
                gradleHome, 'caches', 'modules-2', 'files-2.1',
                'com.google.guava', 'guava', '32.1.3-jre'
            );
            const hashDir = join(gradleCacheDir, 'aaa111');
            await mkdir(hashDir, { recursive: true });
            await writeFile(join(hashDir, 'guava-32.1.3-jre.jar'), 'fake-jar');
        });

        it('resolves combined Maven and Gradle dependencies', async () => {
            const result = await resolveProjectClasspath({
                mavenDeps: [
                    { groupId: 'org.slf4j', artifactId: 'slf4j-api', version: '2.0.9' },
                ],
                gradleDeps: [
                    { configuration: 'implementation', group: 'com.google.guava', name: 'guava', version: '32.1.3-jre' },
                ],
                m2Root,
                gradleHome,
            });

            expect(result.dependencies).toHaveLength(2);
            expect(result.dependencies[0].artifactId).toBe('slf4j-api');
            expect(result.dependencies[1].artifactId).toBe('guava');
            expect(result.unresolvedCount).toBe(0);
        });

        it('returns empty classpath with no dependencies', async () => {
            const result = await resolveProjectClasspath({});

            expect(result.dependencies).toHaveLength(0);
            expect(result.unresolvedCount).toBe(0);
        });

        it('tracks unresolved count across both build tools', async () => {
            const result = await resolveProjectClasspath({
                mavenDeps: [
                    { groupId: 'com.nonexistent', artifactId: 'fake-a', version: '1.0' },
                ],
                gradleDeps: [
                    { configuration: 'implementation', group: 'com.nonexistent', name: 'fake-b', version: '2.0' },
                ],
                m2Root,
                gradleHome,
            });

            expect(result.dependencies).toHaveLength(0);
            expect(result.unresolvedCount).toBe(2);
        });

        it('resolves JDK alongside dependencies', async () => {
            const jdkPath = join(tempDir, 'integration-jdk');
            await mkdir(join(jdkPath, 'jmods'), { recursive: true });
            await writeFile(join(jdkPath, 'release'), 'JAVA_VERSION="21.0.1"');

            const result = await resolveProjectClasspath({
                mavenDeps: [
                    { groupId: 'org.slf4j', artifactId: 'slf4j-api', version: '2.0.9' },
                ],
                javaHome: jdkPath,
                m2Root,
            });

            expect(result.dependencies).toHaveLength(1);
            expect(result.jdkPath).toBe(jdkPath);
            expect(result.jdkVersion).toBe('21.0.1');
        });
    });

    describe('runMavenBuildClasspath (real Maven resolution)', () => {
        const petclinicDir = join(__dirname, '..', '..', 'test-fixtures', 'spring-petclinic');

        it('resolves Spring PetClinic transitive dependencies via mvn', async () => {
            const { existsSync: exists } = await import('node:fs');
            if (!exists(join(petclinicDir, 'pom.xml'))) {
                return; // skip if PetClinic not cloned
            }

            const logger = {
                info: () => {},
                warn: () => {},
                error: () => {},
                log: () => {},
            };

            const result = await runMavenBuildClasspath(petclinicDir, logger as any);

            // Spring PetClinic has dozens of transitive dependencies
            expect(result).not.toBeNull();
            expect(result!.length).toBeGreaterThan(20);

            // Should include Spring Framework core libs
            const artifactNames = result!.map(d => d.artifactId);
            expect(artifactNames.some(n => n.includes('spring'))).toBe(true);

            // Every entry should point to a real .jar file
            for (const dep of result!) {
                expect(dep.jarPath).toMatch(/\.jar$/);
                expect(dep.groupId).toBeDefined();
                expect(dep.version).toBeDefined();
            }
        }, 120_000); // generous timeout for Maven
    });
});
