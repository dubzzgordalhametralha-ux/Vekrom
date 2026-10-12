import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { FileAudio, Film, Paperclip, SendHorizontal, X } from "lucide-react";
import { api, type Attachment } from "../../lib/api";
import { useLive } from "../../lib/store";
import { Spinner, Tip } from "../../components/ui";

const MAX_FILES = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,audio/*,video/mp4";

interface Pending {
  key: string;
  file: File;
  preview: string | null;
  done?: Attachment;
  error?: string;
}

function Typing({ channelKey }: { channelKey: string }) {
  const typing = useLive((s) => s.typing[channelKey]);
  const names = Object.values(typing ?? {}).map((t) => t.username);
  const who = names.length > 3 ? "Várias pessoas" : names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0];
  return (
    <div className="flex h-6 items-center gap-2 px-1 text-[12px] text-ink-3" aria-live="polite">
      {who && (
        <>
          <span className="flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className="typing-dot h-1 w-1 rounded-full bg-ink-2" style={{ animationDelay: `${i * 150}ms` }} />)}
          </span>
          <span>
            <strong className="font-semibold text-ink-2">{who}</strong> {names.length > 1 ? "estão" : "está"} digitando…
          </span>
        </>
      )}
    </div>
  );
}

export function Composer({
  placeholder,
  channelKey,
  onSend,
  onTyping,
  onEditLast,
  disabled,
}: {
  placeholder: string;
  channelKey: string;
  onSend: (content: string, attachments: Attachment[]) => void;
  onTyping?: () => void;
  onEditLast?: () => void;
  disabled?: string | null;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  // Rascunho por canal na troca (some ao recarregar: só conveniência).
  const drafts = useRef(new Map<string, string>());
  useEffect(() => {
    setText(drafts.current.get(channelKey) ?? "");
    setFiles([]);
    if (window.matchMedia("(pointer: fine)").matches) ta.current?.focus();
    return () => void drafts.current.set(channelKey, ta.current?.value ?? "");
  }, [channelKey]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [text]);

  const add = (list: FileList | File[]) => {
    setNotice("");
    const incoming = Array.from(list);
    const room = MAX_FILES - files.length;
    if (incoming.length > room) setNotice(`Até ${MAX_FILES} arquivos por mensagem.`);
    for (const file of incoming.slice(0, Math.max(0, room))) {
      if (file.size > MAX_BYTES) {
        setNotice(`${file.name} passa de 8 MB.`);
        continue;
      }
      const p: Pending = { key: `${file.name}-${file.size}-${Math.random()}`, file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
      setFiles((cur) => [...cur, p]);
      // Sobe na hora: quando a pessoa termina de escrever, já foi.
      api.upload(file).then(
        (r) => setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, done: { url: r.url, name: file.name.slice(0, 255), contentType: r.contentType, sizeBytes: r.sizeBytes } } : x))),
        (e: Error) => setFiles((cur) => cur.map((x) => (x.key === p.key ? { ...x, error: e.message } : x))),
      );
    }
  };

  const remove = (key: string) =>
    setFiles((cur) => {
      const f = cur.find((x) => x.key === key);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return cur.filter((x) => x.key !== key);
    });

  const uploading = files.some((f) => !f.done && !f.error);
  const ready = files.filter((f) => f.done).map((f) => f.done!);
  const canSend = !disabled && !uploading && (text.trim().length > 0 || ready.length > 0);

  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), ready);
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setText("");
    setFiles([]);
    drafts.current.delete(channelKey);
  };

  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) {
      e.preventDefault();
      add(pasted);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  };

  return (
    <div
      className="shrink-0 px-3 pb-[calc(10px+var(--safe-bottom))] sm:px-4 sm:pb-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <Typing channelKey={channelKey} />
      <div className={`rounded-xl bg-bg-3 ring-1 ring-inset transition-shadow duration-150 focus-within:ring-white/[0.16] ${dragging ? "ring-2 ring-volt/70" : "ring-white/[0.08]"}`}>
        {files.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-2.5 pb-0">
            {files.map((f) => (
              <div key={f.key} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-1 ring-1 ring-inset ring-white/[0.08]" title={f.error ?? f.file.name}>
                {f.preview ? (
                  <img src={f.preview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-ink-3">{f.file.type.startsWith("video/") ? <Film size={22} /> : <FileAudio size={22} />}</div>
                )}
                {!f.done && !f.error && <div className="absolute inset-0 grid place-items-center bg-black/50 text-ink-1"><Spinner /></div>}
                {f.error && <div className="absolute inset-0 grid place-items-center bg-danger/70 p-1 text-center text-[10px] font-semibold text-white">Falhou</div>}
                <button onClick={() => remove(f.key)} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white" aria-label={`Remover ${f.file.name}`}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 p-1.5">
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => (e.target.files && add(e.target.files), (e.target.value = ""))} />
          <Tip label="Anexar imagem, áudio ou vídeo">
            <button className="icon-btn h-10 w-10" onClick={() => fileInput.current?.click()} disabled={Boolean(disabled) || files.length >= MAX_FILES} aria-label="Anexar arquivo">
              <Paperclip size={19} />
            </button>
          </Tip>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            disabled={Boolean(disabled)}
            maxLength={2000}
            placeholder={disabled ?? placeholder}
            enterKeyHint="send"
            aria-label={placeholder}
            onPaste={onPaste}
            onChange={(e) => {
              setText(e.target.value);
              if (onTyping && Date.now() - lastTyping.current > 3000 && e.target.value) {
                lastTyping.current = Date.now();
                onTyping();
              }
            }}
            onKeyDown={(e) => {
              const touch = window.matchMedia("(pointer: coarse)").matches;
              if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              } else if (e.key === "ArrowUp" && !text) {
                onEditLast?.();
              }
            }}
            className="max-h-[40vh] min-h-10 flex-1 resize-none bg-transparent px-1.5 py-[9px] text-[15px] leading-[22px] text-ink-1 outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
          />
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Enviar"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-90 ${canSend ? "bg-volt text-volt-ink" : "text-ink-4 opacity-60"}`}
          >
            <SendHorizontal size={18} />
          </button>
        </div>
      </div>
      {notice && <p className="mt-1.5 px-1 text-[12px] text-warn">{notice}</p>}
    </div>
  );
}
