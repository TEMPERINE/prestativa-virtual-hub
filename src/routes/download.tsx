import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import logoAsset from "@/assets/virtual-office-hero.png.asset.json";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Baixar Virtual Office" },
      { name: "description", content: "Baixe a versão mais recente do Virtual Office para Windows." },
      { property: "og:title", content: "Baixar Virtual Office" },
      { property: "og:description", content: "Versão mais recente para Windows." },
    ],
  }),
  component: DownloadPage,
});

type ReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
};

type Release = {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
  assets: ReleaseAsset[];
};

const REPO = "TEMPERINE/prestativa-virtual-hub";

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function DownloadPage() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => {
        if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
        return r.json();
      })
      .then((data: Release) => setRelease(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const exeAsset = release?.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));

  return (
    <div className="min-h-screen bg-[#faf9f8] flex items-center justify-center p-6">
      <div className="max-w-2xl w-full flex flex-col items-center">
        <div className="text-center mb-6">
          <img
            src={logoAsset.url}
            alt="Virtual Office Logo"
            className="mx-auto h-[240px] md:h-[300px] w-auto object-contain mb-2"
          />
          <p className="text-sm text-muted-foreground">
            Seu espaço virtual. Presença, proximidade, colaboração.
          </p>
        </div>

        <Card className="w-full shadow-soft border bg-background/80 backdrop-blur-sm rounded-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Virtual Office</CardTitle>
            <CardDescription>Baixe a versão mais recente para Windows</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading && (
              <div className="flex items-center justify-center gap-2 text-muted-foreground py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
                Buscando última versão...
              </div>
            )}

            {error && (
              <div className="space-y-3 text-center py-4">
                <p className="text-destructive">Não foi possível carregar a versão: {error}</p>
                <Button asChild variant="outline">
                  <a href={`https://github.com/${REPO}/releases/latest`} target="_blank" rel="noreferrer">
                    <Github className="mr-2 h-4 w-4" /> Ver no GitHub
                  </a>
                </Button>
              </div>
            )}

            {release && !loading && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl bg-muted/40">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Versão Atual</div>
                    <div className="text-xl font-bold text-foreground mt-0.5">{release.tag_name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Publicada em {new Date(release.published_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>

                  {exeAsset ? (
                    <Button asChild size="lg" className="gradient-primary text-primary-foreground font-semibold px-6">
                      <a href={exeAsset.browser_download_url}>
                        <Download className="mr-2 h-5 w-5" />
                        Baixar para Windows ({formatSize(exeAsset.size)})
                      </a>
                    </Button>
                  ) : (
                    <p className="text-muted-foreground text-sm">Nenhum instalador .exe encontrado.</p>
                  )}
                </div>

                {release.body && (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-foreground">Novidades desta versão</div>
                    <pre className="text-xs whitespace-pre-wrap bg-muted/60 p-4 rounded-xl max-h-48 overflow-auto border">
                      {release.body}
                    </pre>
                  </div>
                )}

                <div className="pt-4 border-t flex justify-between items-center">
                  <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                    <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">
                      <Github className="mr-2 h-4 w-4" /> Todas as versões
                    </a>
                  </Button>
                </div>
              </>
            )}

            <p className="text-xs text-muted-foreground text-center pt-2">
              Após instalado, o aplicativo se atualiza automaticamente quando novas versões forem publicadas.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
