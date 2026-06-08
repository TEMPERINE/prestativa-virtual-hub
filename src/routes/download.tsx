import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Baixar Prestativa Virtual Hub" },
      { name: "description", content: "Baixe a versão mais recente do Prestativa Virtual Hub para Windows." },
      { property: "og:title", content: "Baixar Prestativa Virtual Hub" },
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
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle className="text-3xl">Prestativa Virtual Hub</CardTitle>
          <CardDescription>Baixe a versão mais recente para Windows</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando última versão...
            </div>
          )}

          {error && (
            <div className="space-y-3">
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
              <div>
                <div className="text-sm text-muted-foreground">Versão</div>
                <div className="text-xl font-semibold">{release.tag_name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Publicada em {new Date(release.published_at).toLocaleDateString("pt-BR")}
                </div>
              </div>

              {exeAsset ? (
                <Button asChild size="lg" className="w-full">
                  <a href={exeAsset.browser_download_url}>
                    <Download className="mr-2 h-5 w-5" />
                    Baixar para Windows ({formatSize(exeAsset.size)})
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground">Nenhum instalador .exe encontrado nesta release.</p>
              )}

              {release.body && (
                <div>
                  <div className="text-sm font-medium mb-2">Novidades</div>
                  <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-64 overflow-auto">
                    {release.body}
                  </pre>
                </div>
              )}

              <div className="pt-2 border-t">
                <Button asChild variant="ghost" size="sm">
                  <a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">
                    <Github className="mr-2 h-4 w-4" /> Todas as versões
                  </a>
                </Button>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground pt-4 border-t">
            Após instalado, o aplicativo se atualiza automaticamente quando novas versões forem publicadas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
