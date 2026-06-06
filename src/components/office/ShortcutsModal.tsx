import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

const SECTIONS: { title: string; rows: { keys: string[]; desc: string }[] }[] = [
  {
    title: "Movimento",
    rows: [
      { keys: ["W", "A", "S", "D"], desc: "Andar pelo escritório" },
      { keys: ["↑", "←", "↓", "→"], desc: "Andar (alternativa)" },
      { keys: ["Clique no chão"], desc: "Ir até o ponto" },
    ],
  },
  {
    title: "Reunião",
    rows: [
      { keys: ["Alt", "M"], desc: "Ligar/desligar microfone" },
      { keys: ["Alt", "V"], desc: "Ligar/desligar câmera" },
      { keys: ["Alt", "H"], desc: "Levantar / abaixar a mão" },
    ],
  },
  {
    title: "Atalhos rápidos",
    rows: [
      { keys: ["?"], desc: "Mostrar esta lista" },
      { keys: ["Esc"], desc: "Fechar diálogos abertos" },
    ],
  },
];

export function ShortcutsModal({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atalhos do teclado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{s.title}</div>
              <ul className="space-y-1.5">
                {s.rows.map((row, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-foreground/85">{row.desc}</span>
                    <span className="flex items-center gap-1">
                      {row.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="px-1.5 py-0.5 rounded-md border border-border bg-muted text-xs font-mono text-foreground/80 shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1">
            Dica: aperte <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">?</kbd> a qualquer momento para abrir este painel.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
