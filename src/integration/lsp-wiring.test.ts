import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspServer } from '../lsp-server.js';
import { SourceJarCache } from '../project/source-jar.js';

describe('LSP Server Phase 9-10 Wiring', () => {
    let server: LspServer;
    const logger = { log: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    const lspClient = {
        publishDiagnostics: vi.fn(),
        showMessage: vi.fn(),
        logMessage: vi.fn(),
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        server = new LspServer({ logger, lspClient });
        server.initialize({ rootUri: null, capabilities: {} } as any);
    });

    describe('capabilities', () => {
        it('should advertise linkedEditingRangeProvider capability', () => {
            const result = server.initialize({ rootUri: null, capabilities: {} } as any);
            expect(result.capabilities.linkedEditingRangeProvider).toBe(true);
        });

        it('should advertise documentLinkProvider capability', () => {
            const result = server.initialize({ rootUri: null, capabilities: {} } as any);
            expect(result.capabilities.documentLinkProvider).toBeTruthy();
        });

        it('should advertise workspace folder support with change notifications', () => {
            const result = server.initialize({ rootUri: null, capabilities: {} } as any);
            expect(result.capabilities.workspace?.workspaceFolders?.supported).toBe(true);
            expect(result.capabilities.workspace?.workspaceFolders?.changeNotifications).toBe(true);
        });
    });

    describe('linked editing ranges', () => {
        it('should return linked editing ranges for identifier', () => {
            const source = `public class Foo {
    private int value;
    public int getValue() { return value; }
}`;
            server.didOpenTextDocument({
                textDocument: { uri: 'file:///test.java', languageId: 'java', version: 1, text: source },
            });
            const result = server.linkedEditingRange({
                textDocument: { uri: 'file:///test.java' },
                position: { line: 1, character: 16 },
            });
            expect(result).toBeTruthy();
            expect(result!.ranges.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('document links', () => {
        it('should find URLs in comments', () => {
            const source = `/**
 * See https://example.com/docs for details.
 */
public class MyClass {}`;
            server.didOpenTextDocument({
                textDocument: { uri: 'file:///links.java', languageId: 'java', version: 1, text: source },
            });
            const links = server.documentLinks({ textDocument: { uri: 'file:///links.java' } });
            expect(links.length).toBeGreaterThanOrEqual(1);
            expect(links[0].target).toBe('https://example.com/docs');
        });
    });

    describe('annotation processing', () => {
        it('should process Lombok @Data annotation and include class in document symbols', () => {
            const source = `import lombok.Data;

@Data
public class Person {
    private String name;
    private int age;
}`;
            server.didOpenTextDocument({
                textDocument: { uri: 'file:///person.java', languageId: 'java', version: 1, text: source },
            });
            const symbols = server.documentSymbol({ textDocument: { uri: 'file:///person.java' } });
            expect(symbols).toBeTruthy();
            const personClass = symbols!.find(s => s.name === 'Person');
            expect(personClass).toBeTruthy();
        });
    });

    describe('document cache', () => {
        it('should use document cache for version tracking', () => {
            const source = 'public class Cached {}';
            server.didOpenTextDocument({
                textDocument: { uri: 'file:///cached.java', languageId: 'java', version: 1, text: source },
            });
            server.didChangeTextDocument({
                textDocument: { uri: 'file:///cached.java', version: 2 },
                contentChanges: [{ text: source }],
            });
            const symbols = server.documentSymbol({ textDocument: { uri: 'file:///cached.java' } });
            expect(symbols).toBeTruthy();
        });
    });

    describe('workspace folder changes', () => {
        it('should handle workspace folder changes without error', () => {
            expect(() => {
                server.didChangeWorkspaceFolders({
                    added: [{ uri: 'file:///project-a', name: 'project-a' }],
                    removed: [],
                });
            }).not.toThrow();

            expect(() => {
                server.didChangeWorkspaceFolders({
                    added: [],
                    removed: [{ uri: 'file:///project-a', name: 'project-a' }],
                });
            }).not.toThrow();
        });
    });

    describe('source JAR navigation', () => {
        it('should advertise definition provider', () => {
            const result = server.initialize({ rootUri: null, capabilities: {} } as any);
            expect(result.capabilities.definitionProvider).toBe(true);
        });

        it('should handle virtual URI detection', () => {
            expect(SourceJarCache.isVirtualUri('jj-source-jar:///java/util/ArrayList.java')).toBe(true);
            expect(SourceJarCache.isVirtualUri('file:///src/Main.java')).toBe(false);
        });

        it('should extract qualified name from virtual URI', () => {
            expect(SourceJarCache.qualifiedNameFromUri('jj-source-jar:///java/util/ArrayList.java')).toBe('java.util.ArrayList');
        });

        it('should create virtual URI from qualified name', () => {
            expect(SourceJarCache.createVirtualUri('java.util.ArrayList')).toBe('jj-source-jar:///java/util/ArrayList.java');
        });

        it('should return null definition for unknown token', async () => {
            const source = 'public class Foo { UnknownType x; }';
            server.didOpenTextDocument({
                textDocument: { uri: 'file:///test.java', languageId: 'java', version: 1, text: source },
            });
            const result = await server.definition({
                textDocument: { uri: 'file:///test.java' },
                position: { line: 0, character: 25 },
            });
            // No workspace or jar index entries, so should return null
            expect(result).toBeNull();
        });
    });
});
