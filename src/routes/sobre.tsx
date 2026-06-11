import { createFileRoute, Link } from "@tanstack/react-router";
import { APP_NAME, APP_VERSION_LABEL, APP_CHANNEL } from "@/lib/version";

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: `Sobre — ${APP_NAME}` },
      { name: "description", content: `Informações de versão do ${APP_NAME}.` },
    ],
  }),
  component: SobrePage,
});

const CHANGELOG: Array<{ version: string; date: string; notes: string[] }> = [
  {
    version: "v1.0.0",
    date: "2026-06-11",
    notes: [
      "Primeira versão estável liberada.",
      "Suporte a até 12 participantes simultâneos em reuniões via LiveKit.",
      "Compartilhamento de tela com picker nativo do Windows.",
      "Ícone oficial do aplicativo no instalador e taskbar.",
      "Gravação de reuniões (browser e desktop via Electron).",
    ],
  },
  {
    version: "v0.1.0-beta",
    date: "2026-06-08",
    notes: [
      "Primeira versão beta liberada para a operação Prestativa.",
      "Espaços com níveis 1-3 conforme plano da conta.",
      "Editor de mapa com temas, props e portas.",
      "Reuniões com gravação, áudio espacial e compartilhamento de tela.",
    ],
  },
];

function SobrePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-8">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Voltar
          </Link>
        </div>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono px-2 py-1 rounded-full bg-muted">
              {APP_VERSION_LABEL}
            </span>
            {APP_CHANNEL === "beta" && (
              <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                Versão em teste
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            Esta é uma versão beta. Bugs e mudanças são esperados — reporte qualquer
            problema indicando a versão acima.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Histórico de versões</h2>
          <div className="space-y-6">
            {CHANGELOG.map((entry) => (
              <article key={entry.version} className="border-l-2 border-border pl-4">
                <header className="flex items-baseline gap-2 mb-2">
                  <span className="font-mono text-sm font-semibold">{entry.version}</span>
                  <span className="text-xs text-muted-foreground">{entry.date}</span>
                </header>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  {entry.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <footer className="text-xs text-muted-foreground pt-8 border-t border-border">
          © {new Date().getFullYear()} Prestativa. Todos os direitos reservados.
        </footer>
      </div>
    </div>
  );
}
