import type { ObjectRef } from '../model/schema.ts';
import { findingKey, type Finding, type FindingLocation, type RuleDef } from './types.ts';

const rules = new Map<string, RuleDef>();

export function defineRule(def: RuleDef): RuleDef {
  if (rules.has(def.id)) throw new Error(`Regel ${def.id} doppelt definiert`);
  rules.set(def.id, def);
  return def;
}

export function getRule(id: string): RuleDef | undefined {
  return rules.get(id);
}

export function allRules(): RuleDef[] {
  return [...rules.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Erzeugt einen Befund mit den Standardangaben der Regel. */
export function makeFinding(
  rule: RuleDef,
  objects: ObjectRef[],
  text: { message: string; explanation: string; suggestion: string },
  opts: { location?: FindingLocation; severity?: RuleDef['severity']; keyExtra?: string } = {},
): Finding {
  const f: Finding = {
    key: findingKey(rule.id, objects, opts.keyExtra),
    ruleId: rule.id,
    severity: opts.severity ?? rule.severity,
    kind: rule.kind,
    certainty: rule.certainty,
    domain: rule.domain,
    objects,
    ...text,
  };
  if (opts.location) f.location = opts.location;
  return f;
}
