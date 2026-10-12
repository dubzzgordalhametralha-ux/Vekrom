import { Fragment, type ReactNode } from "react";

/**
 * Markdown mínimo renderizado como elementos React (nunca innerHTML: XSS impossível por construção).
 * Suporta ```bloco```, `código`, **negrito**, *itálico*, ~~riscado~~, links http(s), @menções e > citação.
 */
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n\s][^*\n]*\*|_[^_\n\s][^_\n]*_)|(~~[^~\n]+~~)|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])|(@[a-zA-Z0-9_.]{2,32})/g;

function inline(text: string, key: string, me?: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k} className="font-semibold text-ink-1">{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else if (m[4]) out.push(<s key={k} className="text-ink-3">{tok.slice(2, -2)}</s>);
    else if (m[5]) out.push(<a key={k} href={tok} target="_blank" rel="noopener noreferrer nofollow">{tok}</a>);
    else if (m[6]) out.push(<span key={k} className={`mention${me && tok.slice(1).toLowerCase() === me.toLowerCase() ? " ring-1 ring-volt/40" : ""}`}>{tok}</span>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, me }: { text: string; me?: string }) {
  const parts = text.split(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/g);
  return (
    <div className="md whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {parts.map((part, pi) =>
        pi % 2 === 1 ? (
          <pre key={pi}><code>{part.replace(/^\n|\n$/g, "")}</code></pre>
        ) : (
          <Fragment key={pi}>
            {part.split("\n").map((line, li, arr) => {
              const content = line.startsWith("> ") ? <blockquote>{inline(line.slice(2), `${pi}-${li}`, me)}</blockquote> : inline(line, `${pi}-${li}`, me);
              return (
                <Fragment key={li}>
                  {content}
                  {li < arr.length - 1 && !line.startsWith("> ") ? "\n" : null}
                </Fragment>
              );
            })}
          </Fragment>
        ),
      )}
    </div>
  );
}

/** true se a mensagem menciona o usuário. */
export function mentions(text: string, username?: string | null): boolean {
  return Boolean(username) && new RegExp(`(^|\\s)@${username!.replace(/[.]/g, "\\.")}\\b`, "i").test(text);
}
