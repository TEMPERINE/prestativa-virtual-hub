# VirtualOffice

PROJETO: PRESTATIVA OFFICE

Visão Geral

Quero criar um aplicativo próprio chamado Prestativa Office, que substituirá o Gather nas funções que realmente utilizamos no dia a dia.

O objetivo não é replicar todas as funcionalidades do Gather, mas criar uma solução mais simples, moderna, leve e totalmente alinhada à rotina da Prestativa Virtual.

O sistema deve transmitir a sensação de que a equipe está trabalhando dentro de um escritório real, mesmo estando distribuída remotamente.

A experiência deve ser intuitiva, agradável, profissional e com visual moderno.

O ambiente será utilizado diariamente por toda a equipe da empresa.

Objetivo Principal

Centralizar a interação da equipe em um único ambiente virtual onde seja possível:

Saber quem está online

Saber onde cada pessoa está

Conversar rapidamente

Fazer reuniões

Compartilhar tela

Trocar mensagens

Criar sensação de presença da equipe

O escritório virtual deve estimular proximidade e colaboração entre as pessoas.

Estrutura Inicial do Escritório

O layout será inspirado no escritório virtual atual da Prestativa, porém com uma aparência mais limpa, organizada e moderna.

Os ambientes iniciais serão:

Operação

Principal área do escritório.

Deve ser o ambiente com maior destaque visual.

Contém:

10 posições de atendimento

Cada posição com notebook

Apenas uma cadeira por estação

Layout aberto

Visual organizado

Sensação de central de operações

Supervisão

Posicionada visualmente próxima da operação.

A supervisora deve ter destaque visual.

Objetivo:

Fácil visualização pela equipe

Sensação de liderança acessível

Diretoria

Área aberta.

Não deve ser uma sala fechada.

Contém:

Mesa de Márcio

Mesa de Dani

Objetivo:

Demonstrar proximidade com a equipe

Reforçar cultura horizontal

Sala de Reunião

Uma sala fechada para reuniões formais.

Características:

Mesa para 16 pessoas

Telão

Ambiente elegante

Utilizada para reuniões internas e apresentações

Sala de Feedback

Sala menor.

Utilizada para:

Feedbacks

Conversas individuais

Alinhamentos rápidos

Capacidade para poucas pessoas.

Ambiente acolhedor.

Área de Descompressão

Espaço de convivência.

Elementos:

Sofás

Poltronas

Café

Plantas

Biblioteca

Objetivo:

Humanizar o ambiente

Estimular interação informal

Funcionalidades da Primeira Versão

Login

Cada colaboradora terá acesso individual.

Ao entrar:

Visualiza o escritório

Surge no mapa

Aparece para os demais usuários

Avatar

Cada colaboradora possui:

Nome

Avatar personalizado

Não é necessário sistema complexo de customização inicialmente.

Presença

Exibir:

Online

Offline

Posteriormente poderá haver mais status.

Movimentação

O usuário pode caminhar pelo escritório.

A movimentação deve ser simples e intuitiva.

Objetivo:

Criar sensação de presença física.

Lista da Equipe

Painel lateral mostrando:

Quem está online

Quem está offline

Com atualização em tempo real.

Chat

Chat privado

Conversa direta entre dois usuários.

Chat geral

Canal para comunicação de toda a empresa.

Chat por ambiente

Mensagens específicas de cada área.

Exemplo:

Operação

Sala de Reunião

Descompressão

Comunicação em Tempo Real

Esta é uma das partes mais importantes do projeto.

O aplicativo precisa permitir interação semelhante ao Gather.

Áudio

Os usuários podem conversar por voz.

Inicialmente o áudio pode funcionar por ambiente.

Exemplo:

Quem está na Sala de Reunião participa do mesmo áudio.

Quem está na Operação participa do áudio da Operação.

Vídeo

Os ambientes podem iniciar videoconferências.

Especialmente:

Sala de Reunião

Sala de Feedback

Compartilhamento de Tela

Funcionalidade essencial.

A equipe utiliza constantemente.

Deve ser extremamente simples:

Entrar na reunião → Compartilhar tela.

Experiência Desejada

O sistema deve passar a sensação de:

Escritório moderno

Startup de tecnologia

Ambiente profissional

Comunicação simples

Pouca burocracia

Facilidade de uso

Não queremos uma ferramenta cheia de recursos.

Queremos uma ferramenta que a equipe abra pela manhã e permaneça nela durante todo o expediente.

Plataforma

Inicialmente o sistema poderá funcionar online.

Porém o produto deve ser pensado desde o início para evoluir para um aplicativo instalável no computador.

Objetivo futuro:

Windows

MacOS

A ideia é que a colaboradora abra o Prestativa Office ao iniciar o trabalho e permaneça conectada durante todo o dia.

Não queremos depender exclusivamente de uma aba do navegador, pois isso facilita que o sistema fique minimizado, esquecido ou inativo.

O aplicativo deve ser concebido para futuramente funcionar como software desktop, mantendo a experiência de escritório virtual sempre presente para a equipe.

Filosofia do Projeto

Não estamos criando um clone do Gather.

Estamos criando uma ferramenta própria para equipes remotas.

A prioridade é:

Presença

Comunicação

Colaboração

Simplicidade

Estabilidade

Qualquer funcionalidade que aumente complexidade sem melhorar a experiência principal deve ser evitada nesta primeira versão.

O foco é entregar rapidamente uma solução elegante, leve e agradável que permita à Prestativa Virtual abandonar o Gather e operar integralmente dentro do Prestativa Office.

DIRETRIZ IMPORTANTE SOBRE O AMBIENTE VIRTUAL

Existe uma referência visual aprovada que servirá como base para todo o desenvolvimento do Prestativa Office.

O objetivo não é criar um layout novo.

O objetivo é recriar fielmente o escritório apresentado na referência visual, respeitando sua estrutura, distribuição dos ambientes e sensação de espaço.

Caso seja necessário, produziremos posteriormente todos os assets gráficos separadamente para garantir qualidade profissional.

Portanto, a arquitetura do sistema deve ser pensada para suportar um ambiente semelhante a um jogo 2D navegável.

Estrutura do Cenário

O cenário deve ser composto por camadas.

Exemplos:

Piso

Tapetes

Paredes

Portas

Mesas

Cadeiras

Plantas

Sofás

Monitores

Decoração

Cada elemento deve possuir comportamento próprio dentro do mapa.

Sistema de Camadas

O sistema deve prever elementos que ficam:

Abaixo do personagem

Exemplos:

Piso

Tapetes

Sombras

Marcações de ambiente

No mesmo plano do personagem

Exemplos:

Corredores

Áreas de circulação

Acima do personagem

Exemplos:

Mesas

Balcões

Estações de trabalho

Sofás

Divisórias

Isso é fundamental para criar a sensação correta de profundidade e interação.

Quando um avatar estiver atrás de uma mesa, a mesa deve aparecer visualmente à frente do personagem.

Quando estiver caminhando em uma área aberta, o personagem deve ficar totalmente visível.

Colisão

O ambiente deve possuir colisão.

Os usuários não devem atravessar:

Paredes

Mesas

Sofás

Objetos decorativos

Estruturas fixas

A movimentação deve respeitar o espaço físico do escritório.

Ambientes de Comunicação

O escritório deverá possuir zonas específicas de comunicação.

Cada ambiente deve ser tratado como uma área lógica independente.

Operação

Área principal das secretárias.

Contém:

10 estações de trabalho

1 estação da supervisora

Esta área possui comunicação própria.

Sala de Reunião

Ambiente para reuniões maiores.

Capacidade prevista:

16 pessoas sentadas

Ao entrar nesta área, os participantes podem compartilhar comunicação em grupo.

Sala de Feedback

Ambiente menor.

Voltado para:

feedbacks

alinhamentos

reuniões rápidas

Diretoria

Área aberta onde ficam:

Dani

Márcio

Pode ser utilizada para conversas rápidas e aproximação da liderança.

Área de Descompressão

Espaço social.

Utilizado para interação informal.

Estrutura de Crescimento

O projeto deve ser construído pensando que novos ambientes poderão ser adicionados futuramente.

Exemplos:

Auditório

Universidade Corporativa

Sala Comercial

Sala de Treinamentos

Por isso o sistema deve permitir expansão do mapa sem necessidade de reconstrução completa.

Objetivo Final

Queremos que o usuário tenha a sensação de estar dentro de um escritório virtual vivo.

Não estamos criando um dashboard.

Não estamos criando uma rede social.

Estamos criando um ambiente navegável onde presença, proximidade e comunicação são os elementos centrais da experiência.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://prestativa-virtual-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2c4196a3-d2a8-4547-9a95-fd2db0ce6f4b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
