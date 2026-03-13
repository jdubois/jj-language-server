/*
 * Copyright 2025 jj-language-server contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parsePomContent } from './project/maven.js';
import { parseGradleContent } from './project/gradle.js';
import { getJdkType, getAutoImportedTypes, getAllJdkTypes, getJdkTypesByPackage } from './project/jdk-model.js';

const noopLogger = { info: () => {}, warn: () => {}, log: () => {}, error: () => {} } as any;

describe('Maven pom.xml parsing', () => {
    it('extracts basic project info', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.groupId).toBe('com.example');
        expect(result.artifactId).toBe('my-app');
        expect(result.version).toBe('1.0.0');
        expect(result.packaging).toBe('jar');
    });

    it('extracts dependencies', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-core</artifactId>
            <version>5.3.0</version>
        </dependency>
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.dependencies.length).toBe(2);
        expect(result.dependencies[0].groupId).toBe('org.springframework');
        expect(result.dependencies[0].artifactId).toBe('spring-core');
        expect(result.dependencies[1].scope).toBe('test');
    });

    it('extracts Java version from properties', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <properties>
        <maven.compiler.release>17</maven.compiler.release>
    </properties>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.javaVersion).toBe('17');
    });

    it('extracts modules for multi-module project', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>
    <modules>
        <module>core</module>
        <module>web</module>
    </modules>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.modules).toContain('core');
        expect(result.modules).toContain('web');
    });

    it('inherits groupId from parent', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <parent>
        <groupId>com.example</groupId>
        <version>1.0.0</version>
    </parent>
    <artifactId>my-app</artifactId>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.groupId).toBe('com.example');
        expect(result.version).toBe('1.0.0');
    });

    it('extracts dependencyManagement and applies managed versions', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework</groupId>
                <artifactId>spring-core</artifactId>
                <version>6.1.0</version>
            </dependency>
            <dependency>
                <groupId>org.springframework</groupId>
                <artifactId>spring-context</artifactId>
                <version>6.1.0</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-core</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-context</artifactId>
        </dependency>
    </dependencies>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.managedDependencies.length).toBe(2);
        expect(result.managedDependencies[0].version).toBe('6.1.0');
        // Dependencies should inherit versions from dependencyManagement
        expect(result.dependencies[0].version).toBe('6.1.0');
        expect(result.dependencies[1].version).toBe('6.1.0');
    });

    it('extracts repositories', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <repositories>
        <repository>
            <id>company-nexus</id>
            <name>Company Nexus</name>
            <url>https://nexus.company.com/repository/maven-releases/</url>
        </repository>
        <repository>
            <id>spring-milestones</id>
            <url>https://repo.spring.io/milestone</url>
        </repository>
    </repositories>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.repositories.length).toBe(2);
        expect(result.repositories[0].id).toBe('company-nexus');
        expect(result.repositories[0].url).toBe('https://nexus.company.com/repository/maven-releases/');
        expect(result.repositories[0].name).toBe('Company Nexus');
        expect(result.repositories[1].id).toBe('spring-milestones');
    });

    it('resolves property references in dependency versions', () => {
        const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <properties>
        <spring.version>6.1.0</spring.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework</groupId>
            <artifactId>spring-core</artifactId>
            <version>\${spring.version}</version>
        </dependency>
    </dependencies>
</project>`;
        const result = parsePomContent(pom, '/fake/pom.xml', noopLogger)!;
        expect(result.dependencies[0].version).toBe('6.1.0');
    });
});

describe('Gradle build parsing', () => {
    it('extracts string dependencies', () => {
        const content = `
plugins {
    id 'java'
}

dependencies {
    implementation 'org.springframework:spring-core:5.3.0'
    testImplementation 'junit:junit:4.13'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.dependencies.length).toBe(2);
        expect(result.dependencies[0].group).toBe('org.springframework');
        expect(result.dependencies[0].name).toBe('spring-core');
        expect(result.dependencies[0].version).toBe('5.3.0');
        expect(result.dependencies[1].configuration).toBe('testImplementation');
    });

    it('extracts plugins', () => {
        const content = `
plugins {
    id 'java'
    id 'org.springframework.boot' version '3.2.0'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.plugins).toContain('java');
        expect(result.plugins).toContain('org.springframework.boot');
    });

    it('extracts Java version from toolchain', () => {
        const content = `
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.javaVersion).toBe('21');
    });

    it('detects Kotlin DSL', () => {
        const content = `
plugins {
    id("java")
}

dependencies {
    implementation("org.springframework:spring-core:5.3.0")
}`;
        const result = parseGradleContent(content, '/fake/build.gradle.kts', noopLogger)!;
        expect(result.isKotlinDsl).toBe(true);
        expect(result.dependencies.length).toBe(1);
    });

    it('extracts sourceCompatibility', () => {
        const content = `
sourceCompatibility = '17'
targetCompatibility = '17'`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.sourceCompatibility).toBe('17');
        expect(result.targetCompatibility).toBe('17');
    });

    it('extracts dependencies without version (BOM-managed)', () => {
        const content = `
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    runtimeOnly 'com.h2database:h2'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.dependencies.length).toBe(2);
        expect(result.dependencies[0].group).toBe('org.springframework.boot');
        expect(result.dependencies[0].name).toBe('spring-boot-starter-web');
        expect(result.dependencies[0].version).toBeUndefined();
        expect(result.dependencies[1].configuration).toBe('runtimeOnly');
    });

    it('extracts map-style dependencies (Groovy DSL)', () => {
        const content = `
dependencies {
    implementation group: 'org.apache.commons', name: 'commons-lang3', version: '3.14.0'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.dependencies.length).toBe(1);
        expect(result.dependencies[0].group).toBe('org.apache.commons');
        expect(result.dependencies[0].name).toBe('commons-lang3');
        expect(result.dependencies[0].version).toBe('3.14.0');
    });

    it('extracts map-style dependencies (Kotlin DSL)', () => {
        const content = `
dependencies {
    implementation(group = "org.apache.commons", name = "commons-lang3", version = "3.14.0")
}`;
        const result = parseGradleContent(content, '/fake/build.gradle.kts', noopLogger)!;
        expect(result.isKotlinDsl).toBe(true);
        expect(result.dependencies.length).toBe(1);
        expect(result.dependencies[0].group).toBe('org.apache.commons');
        expect(result.dependencies[0].name).toBe('commons-lang3');
        expect(result.dependencies[0].version).toBe('3.14.0');
    });

    it('extracts all dependency configurations', () => {
        const content = `
dependencies {
    api 'group:api-lib:1.0'
    compileOnly 'group:compile-only-lib:1.0'
    runtimeOnly 'group:runtime-lib:1.0'
    annotationProcessor 'group:annotation-proc:1.0'
    testCompileOnly 'group:test-compile:1.0'
    testRuntimeOnly 'group:test-runtime:1.0'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        const configs = result.dependencies.map(d => d.configuration);
        expect(configs).toContain('api');
        expect(configs).toContain('compileOnly');
        expect(configs).toContain('runtimeOnly');
        expect(configs).toContain('annotationProcessor');
        expect(configs).toContain('testCompileOnly');
        expect(configs).toContain('testRuntimeOnly');
    });

    it('extracts plugins with apply plugin syntax', () => {
        const content = `
apply plugin: 'java'
apply plugin: 'war'
plugins {
    id 'org.springframework.boot' version '3.2.0'
}`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.plugins).toContain('java');
        expect(result.plugins).toContain('war');
        expect(result.plugins).toContain('org.springframework.boot');
    });

    it('extracts Java version from JavaVersion enum', () => {
        const content = `
sourceCompatibility = JavaVersion.VERSION_17`;
        const result = parseGradleContent(content, '/fake/build.gradle', noopLogger)!;
        expect(result.javaVersion).toBe('17');
    });

    it('parses real Spring PetClinic build.gradle', async () => {
        const { existsSync, readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const buildFile = join(__dirname, '..', 'test-fixtures', 'spring-petclinic', 'build.gradle');
        if (!existsSync(buildFile)) return; // skip if fixture not available

        const content = readFileSync(buildFile, 'utf-8');
        const result = parseGradleContent(content, buildFile, noopLogger)!;

        expect(result).not.toBeNull();
        expect(result.javaVersion).toBe('17');
        expect(result.plugins).toContain('java');
        expect(result.plugins).toContain('org.springframework.boot');
        // PetClinic has at least 10 dependencies
        expect(result.dependencies.length).toBeGreaterThanOrEqual(10);
        // Should find spring-boot-starter-data-jpa
        expect(result.dependencies.some(d => d.name === 'spring-boot-starter-data-jpa')).toBe(true);
    });
});

describe('JDK model', () => {
    it('getJdkType finds String', () => {
        const str = getJdkType('String')!;
        expect(str).toBeDefined();
        expect(str.qualifiedName).toBe('java.lang.String');
        expect(str.kind).toBe('class');
        expect(str.methods.length).toBeGreaterThan(10);
    });

    it('getJdkType finds by qualified name', () => {
        const list = getJdkType('java.util.List')!;
        expect(list).toBeDefined();
        expect(list.name).toBe('List');
        expect(list.typeParameters).toContain('E');
    });

    it('getJdkType returns undefined for unknown types', () => {
        expect(getJdkType('NonExistent')).toBeUndefined();
    });

    it('getAllJdkTypes returns all types', () => {
        const all = getAllJdkTypes();
        expect(all.length).toBeGreaterThan(30);
    });

    it('getAutoImportedTypes returns java.lang types', () => {
        const types = getAutoImportedTypes();
        expect(types.every(t => t.package === 'java.lang')).toBe(true);
        expect(types.some(t => t.name === 'String')).toBe(true);
        expect(types.some(t => t.name === 'Object')).toBe(true);
    });

    it('getJdkTypesByPackage returns correct types', () => {
        const utilTypes = getJdkTypesByPackage('java.util');
        expect(utilTypes.some(t => t.name === 'List')).toBe(true);
        expect(utilTypes.some(t => t.name === 'ArrayList')).toBe(true);
        expect(utilTypes.some(t => t.name === 'HashMap')).toBe(true);
    });

    it('JDK methods have correct structure', () => {
        const math = getJdkType('Math')!;
        const abs = math.methods.find(m => m.name === 'abs')!;
        expect(abs.isStatic).toBe(true);
        expect(abs.returnType).toBe('int');
        expect(abs.parameters.length).toBe(1);
    });

    it('JDK fields have correct structure', () => {
        const math = getJdkType('Math')!;
        const pi = math.fields.find(f => f.name === 'PI')!;
        expect(pi.isStatic).toBe(true);
        expect(pi.isFinal).toBe(true);
        expect(pi.type).toBe('double');
    });
});
