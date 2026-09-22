/**
 * Evaluates the C constant expressions that appear in `steam_api.json`.
 * Valve writes values such as `0x0`, `- 1`, `128 + 1`, `100 * 1024 * 1024`,
 * `0xffffffffffffffffull` and `( SteamItemInstanceID_t ) ~ 0`.
 */

type Token = { kind: "num"; value: bigint } | { kind: "op"; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      // A cast such as `( SteamItemInstanceID_t )`; the target type decides the width later.
      const close = src.indexOf(")", i);
      if (close === -1) throw new Error(`Unbalanced parenthesis in "${src}"`);
      const inside = src.slice(i + 1, close).trim();
      if (/^[A-Za-z_]\w*$/.test(inside)) {
        i = close + 1;
        continue;
      }
      tokens.push({ kind: "op", value: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ kind: "op", value: ")" });
      i++;
      continue;
    }
    if ("+-*~".includes(c)) {
      tokens.push({ kind: "op", value: c });
      i++;
      continue;
    }
    const num = /^(0[xX][0-9a-fA-F]+|\d+)(?:ull|ul|ll|lu|u|l|f)?/.exec(src.slice(i));
    if (!num) throw new Error(`Cannot parse "${src}" at offset ${i}`);
    tokens.push({ kind: "num", value: BigInt(num[1]) });
    i += num[0].length;
    continue;
  }
  return tokens;
}

/** Recursive descent over `+ - *` with unary `-` and `~`. */
function parse(tokens: Token[], width: number): bigint {
  let pos = 0;
  const mask = (1n << BigInt(width)) - 1n;

  const primary = (): bigint => {
    const t = tokens[pos];
    if (!t) throw new Error("Unexpected end of constant expression");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.value === "(") {
      pos++;
      const v = additive();
      if (tokens[pos]?.kind !== "op" || (tokens[pos] as { value: string }).value !== ")") {
        throw new Error("Expected )");
      }
      pos++;
      return v;
    }
    if (t.value === "-") {
      pos++;
      return -primary();
    }
    if (t.value === "~") {
      pos++;
      return ~primary() & mask;
    }
    throw new Error(`Unexpected token "${t.value}"`);
  };

  const multiplicative = (): bigint => {
    let left = primary();
    while (tokens[pos]?.kind === "op" && (tokens[pos] as { value: string }).value === "*") {
      pos++;
      left *= primary();
    }
    return left;
  };

  const additive = (): bigint => {
    let left = multiplicative();
    while (tokens[pos]?.kind === "op") {
      const op = (tokens[pos] as { value: string }).value;
      if (op !== "+" && op !== "-") break;
      pos++;
      left = op === "+" ? left + multiplicative() : left - multiplicative();
    }
    return left;
  };

  const value = additive();
  if (pos !== tokens.length) throw new Error("Trailing tokens in constant expression");
  return value;
}

/**
 * Evaluate a C constant expression to a bigint.
 * `width` is the bit width of the target type, used for `~`.
 * Integer suffixes are consumed per literal by the tokenizer, never stripped globally:
 * a trailing strip would eat the last digit of `0xFFFFFFFF`.
 */
export function evalConst(src: string, width = 32): bigint {
  return parse(tokenize(src), width);
}
