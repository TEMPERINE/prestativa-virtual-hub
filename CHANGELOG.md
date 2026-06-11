# Changelog — Prestativa Virtual Office

Formato: [SemVer](https://semver.org/lang/pt-BR/) + canal (`-beta`, `-rc`, estável).
Atualize `src/lib/version.ts` ao publicar uma nova versão.

## v1.0.0 — 2026-06-11

Primeira versão estável do Prestativa Virtual Office.

### Adicionado
- Suporte a até 12 participantes simultâneos em reuniões via LiveKit.
- Compartilhamento de tela com picker nativo do Windows.
- Ícone oficial do aplicativo no instalador e taskbar.
- Gravação de reuniões (browser e desktop via Electron).
- Áudio espacial e vídeo peer-to-peer em espaços virtuais.

### Melhorado
- Estabilidade e performance das reuniões com infraestrutura LiveKit.
- Fluxo de seleção de tela para compartilhamento no desktop.

### Notas
- Versão estável — pronta para uso em produção.
- Operação Prestativa é o cliente piloto.

## v0.1.0-beta — 2026-06-08

Primeira versão beta para uso interno da operação Prestativa.

### Adicionado
- Conta Virtual Office com perfil, avatar e múltiplos espaços.
- Planos de conta: Essencial (nível 1), Pro (níveis 1-2), Premium (níveis 1-3).
- Editor de espaço: temas, props, portas e áreas de reunião.
- Reuniões com áudio espacial, vídeo peer-to-peer, compartilhamento de tela.
- Gravação de reuniões (browser e desktop via Electron).
- Tela de seleção de espaço quando o usuário pertence a mais de um.
- Página `/sobre` com versão e changelog.
- Badge de versão visível no rodapé.

### Notas
- Versão em beta — instabilidades esperadas.
- Operação Prestativa é o cliente piloto.
