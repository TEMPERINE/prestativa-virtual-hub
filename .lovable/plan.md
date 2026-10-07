# Padronizar avisos visuais do Office

## Avisos atuais afetados

| Grupo | Situação atual | Ajuste proposto |
|---|---|---|
| Comemoração do sino, ao vivo e pendente | Aviso próprio no topo da janela; pode sobrepor a barra e outros avisos | Usar a camada comum, abaixo da barra e na mesma pilha dos avisos informativos |
| Avisos rápidos | Entrada/saída da chamada, mão levantada, microfone/câmera, gravação, porta, mesa, teleporte, recadinhos e respostas aos chamados usam os toasts globais | Padronizar posição, largura, espaçamento e animação somente enquanto o Office estiver aberto; preservar conteúdo, duração e ações |
| Entrada em área | Aviso “Você entrou em…” aparece embaixo do mapa | Levar à mesma pilha informativa superior, preservando quando aparece e desaparece |
| Convite Aceitar/Recusar | Usa o toast global | Seguir o alinhamento comum e manter ações, duração e comportamento próprios |
| Chamado Seguir/Agora não e lista de chamados pendentes | Bloco próprio no canto superior direito | Alinhar ao mesmo eixo e largura, reservando espaço para não sobrepor os avisos; manter componente e comportamento próprios |
| Câmera pausada por privacidade | Popup com duas ações na parte inferior | Alinhar abaixo da barra, sem mudar as ações nem as regras de privacidade; preservar apresentação própria |

Os avisos de erro e sucesso mostrados no Office acompanham a mesma posição, mantendo sua distinção visual.

## Texto da comemoração pendente

Título exato: **🎉 Teve comemoração por aqui!**

Abaixo: **{nome} tocou o sino: {mensagem}**

Preservar remetente, mensagem, fechamento, duração, som e animação do sino. Remover apenas o tom de perda desse aviso.

## Padronização visual

- Uma camada visual comum, sem transformar todos os avisos num único componente.
- Centralizar na área útil visível do Office: descontar a largura real e as margens do painel Equipe quando aberto.
- Posicionar abaixo da barra superior, com 12 px de respiro.
- Largura máxima comum de 420 px, limitada ao espaço disponível.
- Empilhar verticalmente, com intervalo de 8 px e sem sobreposição entre comemoração, avisos rápidos e convites.
- Entrada suave por deslocamento curto e opacidade; respeitar redução de movimento.
- Permitir interação nos avisos, sem bloquear o restante do escritório.

## Fora da mudança

- Notificações do Windows/navegador, Service Worker, permissão e som.
- Onboarding e pedido de permissão de notificações: continuam como telas próprias.
- Aviso de reunião inativa e diálogo de nome da gravação: continuam como diálogos próprios, não como toasts.
- Menu do sino junto ao objeto, cartões das mesas, controles de reunião e indicadores de conexão: mantêm posições contextuais.
- Lógica do sino, Realtime, RTC, Presence, convites, gravação, banco e flags.
- Nenhuma publicação.

## Detalhes técnicos

Consolidar `OfficeToastLayer` no nível visual não escalado do Office, com geometria da barra e painel Equipe. Reaproveitar o Sonner existente para os avisos rápidos, coordenando seu espaço com os avisos próprios. A comemoração mantém seu componente e ciclo de vida; apenas seu destino visual muda. Não criar um segundo consumidor dos mesmos toasts nem alterar os centros de convites/notificações.

## Validação após aprovação

Conferir com Equipe aberta e fechada, múltiplos avisos simultâneos e espaço estreito; verificar texto exato, botões, fechamento e ausência de sobreposição. Executar os testes relevantes e conferir erros da prévia. Não publicar.
