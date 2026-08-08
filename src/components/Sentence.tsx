import { useEffect, useRef, useState } from 'react';

/**
 * The attacker sentence, and the flip.
 *
 * This is the one moment in the interface allowed to move. Only the words that
 * actually changed animate: the old phrasing strikes through in alarm red and
 * dissolves, the new phrasing rises in washed teal and cools to ink, like a
 * highlighter fading on paper. Everything unchanged stays perfectly still, so
 * the eye goes exactly where the meaning changed.
 */

interface SentenceProps {
  text: string;
  isUnique: boolean;
}

type Token = { text: string; state: 'same' | 'removed' | 'added' };

/**
 * Word-level diff via longest common subsequence.
 *
 * Sentences here are a dozen words, so the quadratic table is free and gives a
 * cleaner result than any heuristic: unchanged words are recognised as
 * unchanged even when the phrases around them move.
 */
function diffWords(before: string, after: string): Token[] {
  const a = before.split(/(\s+)/).filter((s) => s.length > 0);
  const b = after.split(/(\s+)/).filter((s) => s.length > 0);

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      tokens.push({ text: a[i], state: 'same' });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ text: a[i], state: 'removed' });
      i++;
    } else {
      tokens.push({ text: b[j], state: 'added' });
      j++;
    }
  }
  while (i < a.length) tokens.push({ text: a[i++], state: 'removed' });
  while (j < b.length) tokens.push({ text: b[j++], state: 'added' });
  return tokens;
}

export function Sentence({ text, isUnique }: SentenceProps) {
  const previous = useRef(text);
  const [tokens, setTokens] = useState<Token[]>([{ text, state: 'same' }]);

  useEffect(() => {
    if (previous.current === text) return;
    setTokens(diffWords(previous.current, text));
    previous.current = text;
    // Once the animation has played, settle to plain text so the sentence is
    // selectable and screen-reader-friendly rather than a pile of spans.
    const timer = setTimeout(() => setTokens([{ text, state: 'same' }]), 1500);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <p
      aria-live="polite"
      style={{
        fontFamily: 'var(--serif)',
        fontStyle: 'italic',
        fontSize: 'clamp(20px, 2.4vw, 30px)',
        lineHeight: 1.35,
        margin: 0,
        color: 'var(--ink)',
      }}
    >
      {tokens.map((token, index) =>
        token.state === 'same' ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} className={token.state === 'removed' ? 'flip-out' : 'flip-in'}>
            {token.text}
          </span>
        ),
      )}
      {isUnique && (
        <span
          className="mono"
          style={{
            marginLeft: 10,
            fontSize: 11,
            fontStyle: 'normal',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--alarm)',
            background: 'var(--alarm-wash)',
            border: '1px solid var(--alarm)',
            borderRadius: 2,
            padding: '2px 6px',
            verticalAlign: 'middle',
            whiteSpace: 'nowrap',
          }}
        >
          1 OF 1
        </span>
      )}
    </p>
  );
}
