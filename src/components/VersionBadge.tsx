import { Link } from "@tanstack/react-router";
import { APP_VERSION_LABEL } from "@/lib/version";

type Props = {
  fixed?: boolean;
};

export function VersionBadge({ fixed = true }: Props) {
  return (
    <Link
      to="/sobre"
      className={
        (fixed ? "fixed bottom-3 right-3 z-40 " : "") +
        "text-[10px] font-mono px-2 py-1 rounded-full bg-background/70 backdrop-blur border border-border text-muted-foreground hover:text-foreground transition"
      }
      title="Sobre esta versão"
    >
      {APP_VERSION_LABEL}
    </Link>
  );
}
