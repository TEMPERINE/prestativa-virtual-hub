# Mudança de atalhos de reunião para evitar conflitos

## Problema
Os atalhos atuais de reunião (`Ctrl+D`, `Ctrl+E`, `Ctrl+Alt+H`) conflitam com os atalhos do escritório (teleporte WASD, teleporte sala de feedback). O usuário pediu para alterar os atalhos da reunião.

## Solução
Alterar os modificadores dos atalhos de reunião de `Ctrl/Cmd` para `Alt`, que está livre no escritório:

| Ação | Atalho atual | Novo atalho |
|------|-------------|-------------|
| Mutar / desmutar microfone | `Ctrl/Cmd + D` | `Alt + M` |
| Ligar / desligar câmera | `Ctrl/Cmd + E` | `Alt + V` |
| Levantar / abaixar a mão | `Ctrl/Cmd + Alt + H` | `Alt + H` |

## Arquivos alterados
- `src/components/office/OfficeScene.tsx` — listener de `keydown` dos atalhos de reunião (linhas ~1262-1290)

## Escopo
Apenas a redefinição dos keybindings. Nenhuma outra funcionalidade muda.