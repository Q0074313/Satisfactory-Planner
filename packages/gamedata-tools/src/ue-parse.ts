/**
 * Parser für die Unreal-Textserialisierung, wie sie in den Satisfactory-Docs
 * vorkommt, z. B. `((ItemClass="…Desc_IronIngot_C'",Amount=3))` oder
 * `(Min=(X=-400.000000,Y=-500.000000,Z=0.000000),IsValid=True)`.
 */

export type UeValue = string | UeValue[] | { [key: string]: UeValue };

export function parseUe(input: string): UeValue {
  let i = 0;
  const s = input.trim();

  function value(): UeValue {
    if (s[i] === '(') {
      i++;
      if (s[i] === ')') {
        i++;
        return [];
      }
      const ahead = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(s.slice(i, i + 128));
      return ahead ? struct() : list();
    }
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) throw new Error(`Unterminierter String an Position ${i}`);
      const str = s.slice(i + 1, end);
      i = end + 1;
      return str;
    }
    const start = i;
    while (i < s.length && s[i] !== ',' && s[i] !== ')') i++;
    return s.slice(start, i);
  }

  function struct(): { [key: string]: UeValue } {
    const out: { [key: string]: UeValue } = {};
    for (;;) {
      const eq = s.indexOf('=', i);
      const key = s.slice(i, eq);
      i = eq + 1;
      out[key] = value();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ')') {
        i++;
        return out;
      }
      throw new Error(`Unerwartetes Zeichen '${s[i]}' an Position ${i}`);
    }
  }

  function list(): UeValue[] {
    const out: UeValue[] = [];
    for (;;) {
      out.push(value());
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ')') {
        i++;
        return out;
      }
      throw new Error(`Unerwartetes Zeichen '${s[i]}' an Position ${i}`);
    }
  }

  if (s === '') return '';
  const result = value();
  return result;
}

/** Extrahiert den Klassennamen aus einem Objektpfad, z. B. `…/Desc_IronIngot.Desc_IronIngot_C'` → `Desc_IronIngot_C`. */
export function classNameFromPath(path: string): string {
  const cleaned = path.replace(/['"]/g, '');
  const dot = cleaned.lastIndexOf('.');
  const tail = dot >= 0 ? cleaned.slice(dot + 1) : cleaned;
  const colon = tail.indexOf(':');
  return colon >= 0 ? tail.slice(0, colon) : tail;
}

export function asList(v: UeValue | undefined): UeValue[] {
  if (v === undefined || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

export function asStruct(v: UeValue | undefined): { [key: string]: UeValue } {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
}

export function num(v: UeValue | undefined): number {
  if (typeof v !== 'string') return NaN;
  return Number.parseFloat(v);
}
