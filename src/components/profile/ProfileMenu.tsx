import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SpritePreview } from "./SpritePreview";
import { LogOut, User as UserIcon, Shirt, Home, MapPin, RefreshCcw, StickyNote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Status = "available" | "busy" | "away";
const STATUS_LABEL: Record<Status, string> = {
  available: "Disponível",
  busy: "Ocupado",
  away: "Ausente",
};
const STATUS_COLOR: Record<Status, string> = {
  available: "#22c55e",
  busy: "#ef4444",
  away: "#a3a3a3",
};

type Props = {
  me: {
    id: string;
    display_name: string;
    avatar_color: string;
    sprite_id?: string | null;
    tagline?: string | null;
    status?: Status | null;
  };
  email: string;
  hasClaim: boolean;
  onEditCharacter: () => void;
  onEditProfile: () => void;
  onGoToMyDesk: () => void;
  onGoToLobby: () => void;
  onRestartOnboarding: () => void;
  onSignOut: () => void;
  onStatusChanged: () => void;
};

export function ProfileMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const status: Status = (p.me.status ?? "available") as Status;

  const setStatus = async (s: Status) => {
    await supabase.from("profiles").update({ status: s }).eq("id", p.me.id);
    p.onStatusChanged();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm relative shadow-soft"
          style={{ background: p.me.avatar_color }}
          title="Meu perfil"
        >
          {p.me.display_name.charAt(0).toUpperCase()}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
            style={{ background: STATUS_COLOR[status] }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="p-3 flex items-center gap-3 border-b">
          <div className="w-12 h-12 rounded-full overflow-hidden flex items-end justify-center" style={{ background: `${p.me.avatar_color}22` }}>
            <SpritePreview spriteId={p.me.sprite_id ?? "marcio"} size={48} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate" style={{ color: p.me.avatar_color }}>{p.me.display_name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
              {STATUS_LABEL[status]}
            </div>
          </div>
        </div>

        {p.me.tagline && (
          <div className="px-3 py-2 text-xs italic text-muted-foreground border-b">"{p.me.tagline}"</div>
        )}

        <div className="p-1 border-b">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1">Status</div>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left"
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}
              {status === s && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
            </button>
          ))}
        </div>

        <div className="p-1 border-b">
          <MenuItem icon={<Shirt className="w-4 h-4" />} label="Editar personagem" onClick={() => { setOpen(false); p.onEditCharacter(); }} />
          <MenuItem icon={<UserIcon className="w-4 h-4" />} label="Editar perfil" onClick={() => { setOpen(false); p.onEditProfile(); }} />
          <MenuItem icon={<MapPin className="w-4 h-4" />} label="Ir até minha mesa" hint="Ctrl+D" disabled={!p.hasClaim} onClick={() => { setOpen(false); p.onGoToMyDesk(); }} />
          <MenuItem icon={<Home className="w-4 h-4" />} label="Me leve ao saguão" onClick={() => { setOpen(false); p.onGoToLobby(); }} />
          <MenuItem icon={<RefreshCcw className="w-4 h-4" />} label="Refazer onboarding" onClick={() => { setOpen(false); p.onRestartOnboarding(); }} />
        </div>

        <div className="p-2 flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground truncate flex-1">{p.email}</div>
          <button
            onClick={() => { setOpen(false); p.onSignOut(); }}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-muted"
          >
            <LogOut className="w-3.5 h-3.5" /> Sair
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ icon, label, hint, disabled, onClick }: { icon: React.ReactNode; label: string; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted text-left disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {hint && <kbd className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">{hint}</kbd>}
    </button>
  );
}
