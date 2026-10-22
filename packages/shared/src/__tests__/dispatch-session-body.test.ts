import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import ts from 'typescript';
import { DispatchSessionBodySchema } from '../validation/request-body.schema';

/**
 * M1-C2 — `DispatchSessionBodySchema` and `DispatchSessionRequest` describe the
 * same body (CLAUDE.md rule 10). The type-level half compiles a small virtual
 * file against the real sources with the TypeScript compiler (this package's
 * tsconfig excludes tests, so `pnpm typecheck` alone would not see it), and a
 * deliberately wrong control proves the assertion can fail.
 */

const VIRTUAL = resolve(__dirname, '__dispatch_body_assert__.ts');
const OPTIONS: ts.CompilerOptions = {
  strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, esModuleInterop: true, skipLibCheck: true, types: [],
};

function typeErrors(source: string): string[] {
  const host = ts.createCompilerHost(OPTIONS);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (file, lang, ...rest) => (file === VIRTUAL ? ts.createSourceFile(file, source, lang) : getSourceFile(file, lang, ...rest));
  host.fileExists = (file) => file === VIRTUAL || fileExists(file);
  host.readFile = (file) => (file === VIRTUAL ? source : readFile(file));
  const program = ts.createProgram([VIRTUAL], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(VIRTUAL)).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const assertion = (target: string) => `
import type { z } from 'zod';
import { DispatchSessionBodySchema } from '../validation/request-body.schema';
import type { DispatchSessionRequest } from '../types/api.types';
type Body = z.infer<typeof DispatchSessionBodySchema>;
type Target = ${target};
// Mutual assignability, key sets included: the schema accepts exactly the interface's shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? ([keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false) : false) : false;
type PersonaIdsOf<T> = T extends { personaIds?: infer P } ? P : never;
export const whole: Same<Body, Target> = true;
export const ids: Same<PersonaIdsOf<Body>, PersonaIdsOf<Target>> = true;
`;

describe('DispatchSessionBodySchema ↔ DispatchSessionRequest (type level)', () => {
  it('the schema infers the interface, and the interface satisfies the schema', () => {
    expect(typeErrors(assertion('DispatchSessionRequest'))).toEqual([]);
  }, 30_000);

  it('a mismatched interface is caught (control)', () => {
    expect(typeErrors(assertion('{ personaIds?: number[] }')).length).toBeGreaterThan(0);
    expect(typeErrors(assertion('{ personaIds?: string[]; force?: boolean }')).length).toBeGreaterThan(0);
  }, 30_000);
});

describe('DispatchSessionBodySchema (runtime)', () => {
  it('accepts an empty body and a list of persona ids', () => {
    expect(DispatchSessionBodySchema.parse({})).toEqual({});
    expect(DispatchSessionBodySchema.parse({ personaIds: ['critic', 'custom_board_advisor'] })).toEqual({ personaIds: ['critic', 'custom_board_advisor'] });
  });

  it('rejects bad shapes', () => {
    for (const bad of [{ personaIds: 'critic' }, { personaIds: [] }, { personaIds: ['Critic!'] }, { personaIds: ['critic', 'critic'] }, { personaIds: [1] }]) {
      expect(DispatchSessionBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
