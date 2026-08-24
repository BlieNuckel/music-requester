import type { ParamDef } from "@shared/recommenderGraph";

export type FormulaSegment =
  { kind: "text"; text: string } | { kind: "param"; key: string };

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Split a formula into the text around its placeholders and the placeholders themselves,
 * so a node can render "weight x (1 + [0.5] x stars/10)" with a real input where the number
 * goes. A placeholder naming an unknown param is left as literal text rather than dropped:
 * a broken sentence is easier to notice than a silently missing term.
 */
export function parseFormula(
  formula: string,
  known: ReadonlySet<string>
): FormulaSegment[] {
  const segments: FormulaSegment[] = [];
  let cursor = 0;

  for (const match of formula.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: "text", text: formula.slice(cursor, start) });
    }
    if (known.has(match[1])) {
      segments.push({ kind: "param", key: match[1] });
    } else {
      segments.push({ kind: "text", text: match[0] });
    }
    cursor = start + match[0].length;
  }

  if (cursor < formula.length) {
    segments.push({ kind: "text", text: formula.slice(cursor) });
  }
  return segments;
}

/** The params a node's own formulas can interpolate: the ones it owns or reads. */
export function reachableParamKeys(
  params: ParamDef[],
  usesParams: ParamDef[]
): Set<string> {
  return new Set([...params, ...usesParams].map((param) => param.key));
}
