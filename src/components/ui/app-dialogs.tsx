// In-app substitutes for window.prompt() / window.confirm().
// Funciona no navegador E no Electron (popups nativos não abrem dentro do app desktop).
//
// Uso:
//   const name = await appPrompt({ title: "Novo nome", defaultValue: "..." });
//   if (name === null) return; // cancelado
//
//   const ok = await appConfirm({ title: "Excluir?", description: "...", destructive: true });
//   if (!ok) return;
//
// Monte <AppDialogsHost /> uma vez perto da raiz (já incluso em __root.tsx).

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PromptOpts = {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: "text" | "password";
  minLength?: number;
};

type ConfirmOpts = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PromptRequest = {
  kind: "prompt";
  opts: PromptOpts;
  resolve: (value: string | null) => void;
};

type ConfirmRequest = {
  kind: "confirm";
  opts: ConfirmOpts;
  resolve: (value: boolean) => void;
};

type Request = PromptRequest | ConfirmRequest;

type Listener = (req: Request) => void;
let listener: Listener | null = null;
const queue: Request[] = [];

function emit(req: Request) {
  if (listener) listener(req);
  else queue.push(req);
}

export function appPrompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => emit({ kind: "prompt", opts, resolve }));
}

export function appConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => emit({ kind: "confirm", opts, resolve }));
}

export function AppDialogsHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listener = (req) => {
      // se já existe um diálogo aberto, enfileira
      setCurrent((cur) => {
        if (cur) {
          queue.push(req);
          return cur;
        }
        if (req.kind === "prompt") setValue(req.opts.defaultValue ?? "");
        return req;
      });
    };
    // drenar fila pendente
    if (queue.length) {
      const next = queue.shift()!;
      if (next.kind === "prompt") setValue(next.opts.defaultValue ?? "");
      setCurrent(next);
    }
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (current?.kind === "prompt") {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [current]);

  const close = (result: string | null | boolean) => {
    if (!current) return;
    if (current.kind === "prompt") current.resolve(result as string | null);
    else current.resolve(result as boolean);
    // próximo da fila
    const next = queue.shift();
    if (next) {
      if (next.kind === "prompt") setValue(next.opts.defaultValue ?? "");
      setCurrent(next);
    } else {
      setCurrent(null);
      setValue("");
    }
  };

  if (!current) return null;

  if (current.kind === "prompt") {
    const o = current.opts;
    const minLen = o.minLength ?? 0;
    const canConfirm = value.length >= minLen;
    return (
      <Dialog open onOpenChange={(open) => { if (!open) close(null); }}>
        <DialogContent
          className="sm:max-w-md"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) {
              e.preventDefault();
              close(value);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{o.title}</DialogTitle>
            {o.description && <DialogDescription>{o.description}</DialogDescription>}
          </DialogHeader>
          <input
            ref={inputRef}
            type={o.inputType ?? "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={o.placeholder}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <DialogFooter>
            <button
              onClick={() => close(null)}
              className="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-muted/70"
            >
              {o.cancelLabel ?? "Cancelar"}
            </button>
            <button
              onClick={() => close(value)}
              disabled={!canConfirm}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {o.confirmLabel ?? "OK"}
            </button>
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  }




  const o = current.opts;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{o.title}</DialogTitle>
          {o.description && <DialogDescription>{o.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <button
            onClick={() => close(false)}
            className="px-4 py-2 rounded-lg bg-muted text-sm hover:bg-muted/70"
          >
            {o.cancelLabel ?? "Cancelar"}
          </button>
          <button
            onClick={() => close(true)}
            className={`px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 ${
              o.destructive
                ? "bg-red-500 text-white"
                : "bg-primary text-primary-foreground"
            }`}
          >
            {o.confirmLabel ?? "Confirmar"}
          </button>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  );
}
