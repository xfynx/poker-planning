import { useEffect, useRef, useState } from "react";

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissions can block the modern API even on HTTPS.
    }
  }

  // HTTP deployments do not expose navigator.clipboard.
  const focused = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;left:-9999px;top:0;font-size:16px";
  document.body.appendChild(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

export function InviteLink({ url }: { url: string }) {
  const [result, setResult] = useState<"copied" | "manual" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setResult(null);
    return () => clearTimeout(timer.current);
  }, [url]);

  async function copy() {
    clearTimeout(timer.current);
    const copied = await copyText(url);
    setResult(copied ? "copied" : "manual");
    if (copied) timer.current = setTimeout(() => setResult(null), 2500);
    else {
      input.current?.focus();
      input.current?.select();
    }
  }

  return (
    <div className="invite-link mb-5">
      <div className="invite-controls">
        <input ref={input} readOnly className="input" value={url} aria-label="Ссылка-приглашение"
          onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="button is-primary is-light" onClick={copy} disabled={!url}>
          {result === "copied" ? "Скопировано ✓" : "Копировать ссылку"}
        </button>
      </div>
      <p className={"help " + (result === "manual" ? "has-text-warning-dark" : "has-text-success-dark")} role="status" aria-live="polite">
        {result === "copied" ? "Ссылка скопирована — отправьте её команде." : result === "manual"
          ? "Браузер запретил копирование. Ссылка выделена: нажмите Ctrl+C / ⌘C или выберите «Копировать» в меню выделения."
          : "Поделитесь ссылкой, чтобы пригласить команду."}
      </p>
    </div>
  );
}
